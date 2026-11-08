const assert = require('node:assert/strict');
const test = require('node:test');
const { inspect, capture, compare, parseCandidateCsv } = require('./window.js');

const hash = n => '0x' + n.toString(16).padStart(64, '0');
const block = (n, parent = n - 1) => ({
  number: '0x' + n.toString(16), timestamp: '0x' + (1000 + n).toString(16),
  gasLimit: n === 3 ? '0x1c9c380' : '0x2dc6c0', hash: hash(n), parentHash: hash(parent),
});
const record = blocks => ({ chainId: '0x3e6', capturedAt: '2026-11-08T04:00:00Z', blocks });

test('checks continuity and groups observed gas limits', () => {
  const result = inspect(record([block(2), block(3)]));
  assert.equal(result.linked, true);
  assert.deepEqual(result.groups, [[3000000, 1], [30000000, 1]]);
  assert.equal(result.rows[1].gap, 1);
  assert.equal(inspect(record([block(2), block(3, 1)])).linked, false);
  assert.throws(() => inspect({ ...record([block(2), block(3)]), chainId: '0x3e7' }), /998/);
});

test('pins the end height and requests only allowlisted methods', async () => {
  const calls = [];
  const rpc = async (method, params) => {
    calls.push([method, params]);
    if (method === 'eth_chainId') return '0x3e6';
    return block(params[0] === 'latest' ? 3 : Number(params[0]));
  };
  const snapshot = await capture(rpc, 2, null);
  assert.equal(inspect(snapshot).rows.at(-1).height, 3);
  assert.deepEqual(calls, [['eth_chainId', []], ['eth_getBlockByNumber', ['latest', false]], ['eth_getBlockByNumber', ['0x2', false]]]);
  await assert.rejects(capture(async () => '0x3e7', 2, null), /998/);
  await assert.rejects(capture(rpc, 1000, null), /2–64/);
});

test('compares snapshots by height and preserves a minimal replay fixture', () => {
  const baseline = record([2, 3, 4, 5, 6, 7].map(n => block(n)));
  const candidate = { ...record([block(8), block(6), { ...block(5), gasLimit: '0x1' }, { ...block(4), hash: hash(99) }, block(3)]), endpoint: 'private', secret: 'discard' };
  const diff = compare(baseline, candidate);
  assert.equal(diff.matched, 2);
  assert.equal(diff.outside, 1);
  assert.deepEqual(diff.differences.map(({ height, kind }) => [height, kind]), [[2, 'coverage'], [4, 'hash'], [5, 'fields'], [7, 'missing']]);
  assert.deepEqual(diff.differences[2].fields, ['gasLimit']);
  assert.equal(diff.candidate.endpoint, undefined);
  assert.equal(diff.candidate.secret, undefined);
  assert.deepEqual(compare(diff.baseline, diff.candidate), diff);
});

test('treats equal and incomparable inputs differently', () => {
  const baseline = record([block(2), block(3)]);
  assert.equal(compare(baseline, baseline).matched, 2);
  assert.deepEqual(compare(baseline, baseline).differences, []);
  assert.throws(() => compare(baseline, record([block(5)])), /不重叠/);
  assert.throws(() => compare(baseline, record([block(2), block(2)])), /重复/);
  assert.throws(() => compare(baseline, { ...baseline, chainId: '0x3e7' }), /998/);
  assert.throws(() => compare(record([block(2), block(4)]), baseline), /基准.*连续/);
});

test('accepts a spreadsheet CSV without weakening chain or field checks', () => {
  const header = 'chainId,capturedAt,number,timestamp,gasLimit,hash,parentHash';
  const time = '2026-11-08T04:00:00Z';
  const row = `"998",${time},2,1002,3000000,${hash(2)},${hash(1)}`;
  const csv = `\uFEFF${header}\r\n${row}\r\n`;
  const snapshot = parseCandidateCsv(csv);
  assert.equal(compare(record([block(2), block(3)]), snapshot).matched, 1);
  assert.deepEqual(snapshot.blocks, [block(2)]);
  assert.throws(() => parseCandidateCsv(csv.replace('"998"', '999')), /998/);
  assert.throws(() => parseCandidateCsv(csv.replace('3000000', '3e6')), /Gas/);
  assert.throws(() => parseCandidateCsv(csv.replace('chainId,', '')), /表头/);
  assert.throws(() => parseCandidateCsv(csv + row.replace(time, '2026-11-08T04:01:00Z')), /同一取证时间/);
  assert.throws(() => parseCandidateCsv(csv.replace(time, '2026-02-31T04:00:00Z')), /时间/);
});
