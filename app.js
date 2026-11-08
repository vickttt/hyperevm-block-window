'use strict';

const element = id => document.getElementById(id);
const status = element('status');
const fetchButton = element('fetch');
const report = element('report');
const formatter = new Intl.NumberFormat('zh-CN');
const offlineOnly = document.querySelector('main').hasAttribute('data-offline-only');
if (offlineOnly) {
  fetchButton.hidden = true;
  element('live-params').hidden = true;
  element('live-note').textContent = '本版使用内置样例和本机快照。';
}
let snapshot;
let request;

function reset(message) {
  request?.abort();
  request = undefined;
  fetchButton.disabled = false;
  report.hidden = true;
  status.removeAttribute('data-alert');
  status.textContent = message;
  snapshot = undefined;
}

function show(data, source) {
  const { rows, groups, linked } = BlockWindow.inspect(data);
  const range = `${rows[0].height}–${rows.at(-1).height}`;
  status.textContent = linked ? `${rows.length} 个区块连续 · ${range}` : `${rows.length} 个区块有不连续项 · ${range}`;
  status.toggleAttribute('data-alert', !linked);
  element('provenance').textContent = `${source} · 取证时间 ${data.capturedAt} · HyperEVM 测试网 998`;
  element('groups').replaceChildren(...groups.map(([gasLimit, count]) => {
    const line = document.createElement('div');
    line.className = 'bar';
    const label = document.createElement('span');
    label.textContent = formatter.format(gasLimit);
    const bar = document.createElement('progress');
    bar.max = rows.length;
    bar.value = count;
    bar.setAttribute('aria-label', `${gasLimit} Gas，${count} 个区块`);
    const amount = document.createElement('span');
    amount.textContent = `${count} 个`;
    line.append(label, bar, amount);
    return line;
  }));
  element('rows').replaceChildren(...rows.map(block => {
    const tr = document.createElement('tr');
    for (const value of [block.height, new Date(block.time * 1000).toISOString().slice(11, 19), block.gap === null ? '—' : `${block.gap} 秒`, formatter.format(block.gasLimit), `${block.hash.slice(0, 12)}…`]) {
      tr.insertCell().textContent = value;
    }
    tr.lastElementChild.title = block.hash;
    return tr;
  }));
  snapshot = data;
  report.hidden = false;
}

function showError(error) {
  status.textContent = error.name === 'TimeoutError' || error instanceof TypeError
    ? '公开 RPC 暂不可用，请稍后重试或打开离线样例。' : error.message;
  status.setAttribute('data-alert', '');
}

fetchButton.addEventListener('click', async () => {
  if (offlineOnly) return;
  reset('正在读取公开测试网区块…');
  const current = new AbortController();
  request = current;
  fetchButton.disabled = true;
  try {
    const end = element('end').value;
    const signal = AbortSignal.any([current.signal, AbortSignal.timeout(40000)]);
    const data = await BlockWindow.capture(BlockWindow.rpc, Number(element('count').value), end === '' ? null : Number(end), signal);
    if (request === current) show(data, '实时读取官方测试网 RPC');
  } catch (error) {
    if (request === current) showError(error);
  } finally {
    if (request === current) fetchButton.disabled = false;
  }
});

element('sample').addEventListener('click', () => {
  reset('正在打开离线样例…');
  show(globalThis.evmSample, '本地随附样例，取自官方测试网 RPC');
});

async function readText(file) {
  if (file.size > 128 * 1024) throw new Error('文件不得超过 128 KB');
  return file.text();
}

async function readJson(file) {
  const text = await readText(file);
  try { return JSON.parse(text); }
  catch { throw new Error('无法读取 JSON 文件'); }
}

async function readCandidate(file) {
  return /\.csv$/i.test(file.name) ? BlockWindow.parseCandidateCsv(await readText(file)) : readJson(file);
}

element('import').addEventListener('change', async event => {
  const file = event.target.files[0];
  if (!file) return;
  reset('正在打开本地快照…');
  const current = new AbortController();
  request = current;
  try {
    const data = await readJson(file);
    if (request === current) show(data, '本地导入，声明的来源与时间未独立确认');
  } catch (error) {
    if (request === current) showError(error);
  } finally {
    event.target.value = '';
  }
});

for (const id of ['end', 'count']) element(id).addEventListener('input', () => reset('参数已更新，请重新查询。'));

function downloadJson(data, name) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

element('export').addEventListener('click', () => {
  if (snapshot) downloadJson(snapshot, 'hyperevm-testnet-window.json');
});

const compareStatus = element('compare-status');
const compareResult = element('compare-result');
const baselineInput = element('baseline');
const candidateInput = element('candidate');
let selectedBaseline;
let comparison;
let compareRevision = 0;

function resetComparison(message) {
  compareRevision += 1;
  comparison = undefined;
  compareStatus.textContent = message;
  compareStatus.removeAttribute('data-alert');
  compareResult.hidden = true;
}

async function compareInputs(load) {
  resetComparison('正在读取对照材料…');
  const revision = compareRevision;
  try {
    const { baseline, candidate, demo } = await load();
    if (revision !== compareRevision) return;
    showComparison(BlockWindow.compare(baseline, candidate), demo === true);
  } catch (error) {
    if (revision !== compareRevision) return;
    compareStatus.textContent = error.message;
    compareStatus.setAttribute('data-alert', '');
  }
}

function showComparison(data, demo) {
  const { matched, outside, differences } = data;
  const labels = {
    coverage: ['未覆盖', '位于待查快照的首尾高度之外'],
    missing: ['窗口内缺块', '位于待查快照的首尾高度之间'],
    hash: ['区块哈希不同', '完整哈希见导出对照包'],
    fields: ['同哈希字段不一致', '不一致字段'],
  };
  const fieldNames = { parent: '父哈希', time: '区块时间', gasLimit: 'Gas 上限' };
  compareStatus.textContent = `${matched} 个匹配 · ${differences.length} 个基准高度有差异`;
  compareStatus.toggleAttribute('data-alert', differences.length > 0);
  const source = demo ? '演示反例由真实样本人工改动。' : '快照来源由提供者声明。';
  element('compare-note').textContent = `${source}待查快照有 ${outside} 个高度在基准范围之外。差异只反映这两份文件。`;
  element('differences').replaceChildren(...differences.map(item => {
    const tr = document.createElement('tr');
    const [label, description] = labels[item.kind];
    tr.insertCell().textContent = item.height;
    tr.insertCell().textContent = label;
    tr.insertCell().textContent = item.fields ? item.fields.map(field => fieldNames[field]).join('、') : description;
    return tr;
  }));
  element('difference-table').hidden = !differences.length;
  comparison = { ...data, demo };
  compareResult.hidden = false;
}

element('use-baseline').addEventListener('click', () => {
  if (!snapshot) return;
  selectedBaseline = snapshot;
  baselineInput.value = '';
  const note = element('baseline-note');
  note.textContent = '基准已选用上方结果。也可以重新选择基准文件。';
  note.hidden = false;
  resetComparison('已选基准，等待待查快照');
  candidateInput.focus();
});

baselineInput.addEventListener('change', () => {
  selectedBaseline = undefined;
  element('baseline-note').hidden = true;
  resetComparison('基准已更新，请重新对照');
});
candidateInput.addEventListener('change', () => resetComparison('待查快照已更新，请重新对照'));

element('compare').addEventListener('click', () => compareInputs(async () => {
  if ((!selectedBaseline && !baselineInput.files[0]) || !candidateInput.files[0]) throw new Error('请先选择基准和待查快照');
  const [baseline, candidate] = await Promise.all([selectedBaseline ?? readJson(baselineInput.files[0]), readCandidate(candidateInput.files[0])]);
  return { baseline, candidate };
}));

element('compare-demo').addEventListener('click', () => compareInputs(() => {
  const sample = globalThis.evmSample;
  const baseline = { ...sample, blocks: sample.blocks.slice(0, 6) };
  const blocks = baseline.blocks.slice(1);
  blocks.splice(1, 1);
  blocks[1] = { ...blocks[1], hash: `0x${'0'.repeat(64)}` };
  return { baseline, candidate: { ...baseline, blocks }, demo: true };
}));

element('import-comparison').addEventListener('change', event => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  compareInputs(async () => {
    const data = await readJson(file);
    if (data?.schema !== 'hyperevm-window-comparison-v1') throw new Error('该文件不是可复现对照包');
    return data;
  });
});

element('export-comparison').addEventListener('click', () => {
  if (comparison) downloadJson(comparison, 'hyperevm-window-comparison.json');
});
