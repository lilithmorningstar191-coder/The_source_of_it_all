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

  assert.ok(scan.includes('A discovery connector is untrusted opportunity data, not a payment processor'));
  assert.ok(scan.includes('const collected: string | null = null'));
  assert.ok(scan.includes('${collected ? "COMPLETED" : "DETECTED"}'));
  assert.ok(scan.includes('if (collected)'));
  assert.ok(scan.includes('creditCompletedCollection'));
  assert.ok(scan.includes('fabricated_results: false'));
});

test('ledger collection credit is idempotent by user and provider reference', async () => {
  const source = await read('src/lib/gmm/core.ts');
  const start = source.indexOf('async function creditCompletedCollection(');
  const end = source.indexOf('\nasync function runScan(', start);
  assert.notEqual(start, -1, 'creditCompletedCollection must exist');
  const credit = source.slice(start, end);
  assert.ok(credit.includes('const reference = `collection:${input.opportunityId}`'));
  assert.ok(credit.includes('where user_id = ${userId} and provider_reference = ${reference} limit 1'));
  assert.ok(credit.includes('if (existing.length) return'));
  assert.ok(credit.includes('cash_balance_unchanged=true'));
});

test('station collection accounting record is not represented as verified spendable cash', async () => {
  const source = await read('src/lib/gmm/core.ts');
  const start = source.indexOf('async function creditCompletedCollection(');
  const end = source.indexOf('\nasync function runScan(', start);
  const credit = source.slice(start, end);
  assert.ok(credit.includes('Accounting record only; spendable and transferable cash is read from live payment-provider balances'));
  assert.ok(credit.includes('cash_balance_unchanged=true'));
});
