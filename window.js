'use strict';

(() => {
  const endpoint = 'https://rpc.hyperliquid-testnet.xyz/evm';
  const chain = '0x3e6';
  const digest = /^0x[0-9a-f]{64}$/i;

  function quantity(value) {
    if (typeof value !== 'string' || !/^0x[0-9a-f]{1,13}$/i.test(value)) throw new Error('RPC 返回了无法识别的数值');
    return Number(value);
  }

  function row(block) {
    if (!digest.test(block?.hash) || !digest.test(block.parentHash)) throw new Error('RPC 返回了不完整的区块');
    return { height: quantity(block.number), time: quantity(block.timestamp), gasLimit: quantity(block.gasLimit),
      hash: block.hash.toLowerCase(), parent: block.parentHash.toLowerCase() };
  }

  function readRows(snapshot, minimum) {
    if (snapshot?.chainId !== chain) throw new Error('仅接受 HyperEVM 测试网链 ID 998');
    if (!Array.isArray(snapshot.blocks) || snapshot.blocks.length < minimum || snapshot.blocks.length > 64) throw new Error(`区块窗口必须为 ${minimum}–64 个区块`);
    if (typeof snapshot.capturedAt !== 'string' || !Number.isFinite(Date.parse(snapshot.capturedAt))) throw new Error('快照缺少有效的取证时间');
    return snapshot.blocks.map(row);
  }

  function inspect(snapshot) {
    const rows = readRows(snapshot, 2);
    const counts = new Map();
    let linked = true;
    rows.forEach((current, i) => {
      counts.set(current.gasLimit, (counts.get(current.gasLimit) || 0) + 1);
      const previous = rows[i - 1];
      current.gap = previous ? current.time - previous.time : null;
      if (previous && (current.height !== previous.height + 1 || current.parent !== previous.hash || current.gap < 0)) linked = false;
    });
    return { rows, linked, groups: [...counts.entries()].sort((a, b) => a[0] - b[0]) };
  }

  function evidence(block) {
    row(block);
    const { number, timestamp, gasLimit, hash, parentHash } = block;
    return { number, timestamp, gasLimit, hash, parentHash };
  }

  function minimalSnapshot(snapshot) {
    return { chainId: chain, capturedAt: new Date(snapshot.capturedAt).toISOString(), blocks: snapshot.blocks.map(evidence) };
  }

  const csvColumns = 'chainId,capturedAt,number,timestamp,gasLimit,hash,parentHash';

  function csvInteger(value, label) {
    if (!/^(?:\d{1,16}|0x[0-9a-f]{1,13})$/i.test(value)) throw new Error(`${label}须为整数`);
    const integer = Number(value);
    if (integer > 0xfffffffffffff) throw new Error(`${label}超出数值范围`);
    return '0x' + integer.toString(16);
  }

  function parseCandidateCsv(text) {
    const lines = text.replace(/^\uFEFF/, '').trim().split(/\r\n|\n|\r/);
    const cells = line => line.split(',').map(cell => cell.trim().replace(/^"([^"\r\n]*)"$/, '$1'));
    if (cells(lines.shift()).join(',') !== csvColumns) throw new Error('CSV 表头与模板不一致，请检查列名和顺序');
    if (!lines.length || lines.length > 64) throw new Error('CSV 须包含 1–64 行区块');
    let capturedAt;
    const blocks = lines.map((line, index) => {
      const values = cells(line);
      if (values.length !== 7) throw new Error(`CSV 第 ${index + 2} 行须有七列`);
      const [id, time, number, timestamp, gasLimit, hash, parentHash] = values;
      if (!['998', chain].includes(id.toLowerCase())) throw new Error('CSV 的 chainId 必须为测试网 998');
      if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(time) || !Number.isFinite(Date.parse(time))) {
        throw new Error('CSV 的取证时间须为 ISO UTC 文本');
      }
      const normalized = new Date(time).toISOString();
      if (normalized.slice(0, 19) !== time.slice(0, 19)) throw new Error('CSV 的取证时间无效');
      if (capturedAt && capturedAt !== normalized) throw new Error('CSV 各行须使用同一取证时间');
      capturedAt = normalized;
      return evidence({ number: csvInteger(number, '区块高度'), timestamp: csvInteger(timestamp, '区块时间'), gasLimit: csvInteger(gasLimit, 'Gas 上限'), hash, parentHash });
    });
    return { chainId: chain, capturedAt, blocks };
  }

  function compare(baseline, candidate) {
    const { rows: reference, linked } = inspect(baseline);
    if (!linked) throw new Error('基准快照必须按高度连续且父哈希衔接');
    const rows = readRows(candidate, 1);
    const byHeight = new Map(rows.map(item => [item.height, item]));
    if (byHeight.size !== rows.length) throw new Error('待查快照含重复高度');
    const first = reference[0].height;
    const last = reference.at(-1).height;
    const heights = rows.map(item => item.height);
    const from = Math.min(...heights);
    const to = Math.max(...heights);
    if (from > last || to < first) throw new Error('两份快照的高度范围不重叠');

    const differences = [];
    let matched = 0;
    for (const expected of reference) {
      const { height } = expected;
      const actual = byHeight.get(height);
      if (!actual) {
        differences.push({ height, kind: height < from || height > to ? 'coverage' : 'missing' });
      } else if (expected.hash !== actual.hash) {
        differences.push({ height, kind: 'hash', expected: expected.hash, actual: actual.hash });
      } else {
        const fields = ['parent', 'time', 'gasLimit'].filter(field => expected[field] !== actual[field]);
        if (fields.length) differences.push({ height, kind: 'fields', fields });
        else matched += 1;
      }
    }
    const outside = heights.filter(height => height < first || height > last).length;
    return { schema: 'hyperevm-window-comparison-v1', baseline: minimalSnapshot(baseline), candidate: minimalSnapshot(candidate), matched, outside, differences };
  }

  async function capture(rpc, count, end, signal) {
    if (!Number.isInteger(count) || count < 2 || count > 64) throw new Error('区块窗口必须为 2–64 个区块');
    if (end !== null && (!Number.isSafeInteger(end) || end < count - 1)) throw new Error('结束高度无效');
    const chainId = await rpc('eth_chainId', [], signal);
    if (chainId !== chain) throw new Error('RPC 返回的链 ID 并非测试网 998');
    const last = evidence(await rpc('eth_getBlockByNumber', [end === null ? 'latest' : '0x' + end.toString(16), false], signal));
    const tip = quantity(last.number);
    if (tip < count - 1 || (end !== null && tip !== end)) throw new Error('RPC 返回的结束高度不符合请求');
    const blocks = [];
    for (let start = tip - count + 1; start < tip; start += 16) {
      const requests = Array.from({ length: Math.min(16, tip - start) }, (_, i) =>
        ['eth_getBlockByNumber', ['0x' + (start + i).toString(16), false]]);
      const batch = rpc.batch ? await rpc.batch(requests, signal)
        : await Promise.all(requests.map(([method, params]) => rpc(method, params, signal)));
      batch.forEach((response, index) => {
        const block = evidence(response);
        if (quantity(block.number) !== start + index) throw new Error('RPC 返回了错误区块高度');
        blocks.push(block);
      });
    }
    blocks.push(last);
    return { chainId, capturedAt: new Date().toISOString(), endpoint, blocks };
  }

  function call(method, params, index) {
    if (method !== 'eth_chainId' && (method !== 'eth_getBlockByNumber' || params[1] !== false)) throw new Error('RPC 方法超出研究工具范围');
    return { jsonrpc: '2.0', id: index + 1, method, params };
  }

  async function send(payload, signal) {
    const response = await fetch(endpoint, {
      method: 'POST', signal, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (response.status === 401 || response.status === 403 || response.status === 451) throw new Error('RPC 拒绝访问，请使用本地样例');
    if (!response.ok) throw new Error(`RPC 暂不可用（HTTP ${response.status}）`);
    return response.json();
  }

  function result(data, id) {
    if (data?.id !== id || data.error || data.result == null) throw new Error('RPC 未返回所需区块，请检查高度或试用本地样例');
    return data.result;
  }

  async function rpc(method, params, signal) {
    return result(await send(call(method, params, 0), signal), 1);
  }

  rpc.batch = async (requests, signal) => {
    const replies = await send(requests.map(([method, params], index) => call(method, params, index)), signal);
    if (!Array.isArray(replies) || replies.length !== requests.length) throw new Error('RPC 返回的批量区块数不符');
    const byId = new Map(replies.map(reply => [reply.id, reply]));
    return requests.map((_, index) => result(byId.get(index + 1), index + 1));
  };

  const api = { inspect, capture, compare, parseCandidateCsv, rpc, endpoint };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else globalThis.BlockWindow = api;
})();
