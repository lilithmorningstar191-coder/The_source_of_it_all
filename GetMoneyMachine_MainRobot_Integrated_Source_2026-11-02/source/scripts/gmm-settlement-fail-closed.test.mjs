import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFile(path.join(root, p), 'utf8');

test('native settlement is considered configured only when endpoint and secret are both present', async () => {
  const source = await read('src/lib/gmm/env.ts');
  assert.match(source, /Boolean\(env\("GMM_NATIVE_TRANSFER_URL"\) && env\("GMM_NATIVE_TRANSFER_SECRET"\)\)/);
});

test('native transfer adapter sends an authenticated idempotent GMM-ledger instruction over HTTPS', async () => {
  const source = await read('src/lib/gmm/native-transfer.ts');
  assert.match(source, /if \(!endpoint \|\| !secret\)[\s\S]*?No transfer was sent/);
  assert.match(source, /url\.protocol !== "https:"/);
  assert.match(source, /"Authorization": `Bearer \\$\{secret\}`/);
  assert.match(source, /"Idempotency-Key": input\.idempotencyKey/);
  assert.match(source, /source: "GMM_LEDGER"/);
  assert.match(source, /validateNativeTransferResponse\(body, \{ amount: input\.amount, currency: input\.currency \}\)/);
});

test('PayPal destination cannot silently fall back to the wrong-direction PayPal Payouts rail', async () => {
  const source = await read('src/lib/gmm/core.ts');
  const start = source.indexOf('export async function requestTransfer(');
  const end = source.indexOf('\nexport async function ', start + 1);
  assert.notEqual(start, -1, 'requestTransfer must exist');
  const transfer = source.slice(start, end);
  assert.match(transfer, /if \(dest\.type\.toUpperCase\(\) === "PAYPAL"\)/);
  assert.match(transfer, /PayPal Payouts debits the sender's existing PayPal balance/);
  assert.match(transfer, /throw new GmmError\([\s\S]*?409\)/);
});

test('completed settlement requires a confirmed destination receipt reference', async () => {
  const source = await read('src/lib/gmm/native-transfer-contract.ts');
  assert.match(source, /status === "COMPLETED"[\s\S]*?destination_receipt_confirmed !== true/);
  assert.match(source, /destination_receipt_reference/);
});
