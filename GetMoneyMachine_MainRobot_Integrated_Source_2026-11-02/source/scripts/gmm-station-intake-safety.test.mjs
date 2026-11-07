import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFile(path.join(root, p), 'utf8');

test('discovery connector responses cannot mark opportunities collected or credit the ledger', async () => {
  const source = await read('src/lib/gmm/core.ts');
  const start = source.indexOf('async function runScan(');
  const end = source.indexOf('\nasync function tickCycles(', start);
  assert.notEqual(start, -1, 'runScan must exist');
  assert.notEqual(end, -1, 'runScan boundary must exist');
  const scan = source.slice(start, end);

  assert.match(scan, /A discovery connector is untrusted opportunity data, not a payment processor/);
  assert.match(scan, /const collected: string \\| null = null/);
  assert.match(scan, /\$\\{collected \\? "COMPLETED" : "DETECTED"\\}/);
  assert.match(scan, /if \\(collected\\) \\{[\\s\\S]*?creditCompletedCollection/);
  assert.match(scan, /fabricated_results: false/);
});

test('ledger collection credit is idempotent by user and provider reference', async () => {
  const source = await read('src/lib/gmm/core.ts');
  const start = source.indexOf('async function creditCompletedCollection(');
  const end = source.indexOf('\nasync function runScan(', start);
  assert.notEqual(start, -1, 'creditCompletedCollection must exist');
  const credit = source.slice(start, end);
  assert.match(credit, /const reference = `collection:\\$\\{input\\.opportunityId\\}`/);
  assert.match(credit, /where user_id = \\$\\{userId\\} and provider_reference = \\$\\{reference\\} limit 1/);
  assert.match(credit, /if \\(existing\\.length\\) return/);
  assert.match(credit, /cash_balance_unchanged=true/);
});

test('station collection accounting record is not represented as verified spendable cash', async () => {
  const source = await read('src/lib/gmm/core.ts');
  const start = source.indexOf('async function creditCompletedCollection(');
  const end = source.indexOf('\nasync function runScan(', start);
  const credit = source.slice(start, end);
  assert.match(credit, /Accounting record only; spendable and transferable cash is read from live payment-provider balances/);
  assert.match(credit, /cash_balance_unchanged=true/);
});
