# GMM Treasury–Ledger–Station–Settlement Integration Contract

Status: implementation contract / blocked on the real treasury debit interface  
Target: existing Get Money Machine NEW deployment  
Branch: `gmm/treasury-ledger-settlement-contract`  
Baseline production commit: `bbe295f9c965c53de547ebf2070c8614a99b8b46`

## 1. Required money-flow topology

```text
15 station source integrations
        |
        | source evidence + unique source transaction reference
        v
GMM station collection intake
        |
        | verified collection only
        v
GMM ledger (accounting subledger / authorization record)
        |
        | reconcile settled funds and available balance
        v
GMM treasury custody account (actual source of funds)
        |
        | authorized, atomic debit request
        v
GMM native settlement executor
        |
        | supported destination credit rail
        v
PayPal receiving account
        |
        | destination receipt / transaction lookup
        v
GMM reconciliation and final ledger status
```

The station discovery connector is not a payment rail. A discovered opportunity, estimated value, application, claim, award notice, or station status must never be treated as collected cash. A station collection is eligible for the completed-cash ledger only after a real source transaction has been verified.

The ledger is the GMM authorization and accounting source of truth. It is not, by itself, proof that an external custody account holds the corresponding cash. The treasury balance and ledger available balance must be reconciled before settlement.

PayPal is a receiving destination/reserve, not the source of funds for this flow. PayPal Payouts must not be used to pretend to debit the GMM treasury.

## 2. Station intake contract

Every station collection must include:

- stable station ID and owner ID;
- source/provider identifier;
- immutable source transaction or claim-payment reference;
- amount in integer minor units (USD cents), never floating-point arithmetic;
- currency;
- source status proving funds have settled (not merely pending, approved, estimated, or claimed);
- evidence/verification reference and timestamp;
- idempotency key derived from the source transaction identity.

Required behavior:

1. Reject unknown station IDs, owner mismatches, unsupported currencies, non-positive amounts, and untrusted discovery-only records.
2. Deduplicate on the source/provider transaction reference with a database uniqueness constraint.
3. Record the raw source evidence reference and normalized verification result.
4. Credit the station subledger and GMM ledger in one database transaction.
5. Do not mark a collection completed if the provider cannot independently confirm settled funds.
6. Preserve the source transaction ID on the station event, ledger row, and reconciliation record.

The current discovery scan in `src/lib/gmm/core.ts` deliberately sets discovered opportunity `collected` values to null. Preserve that fail-closed behavior. Implement a separate authenticated collection-verification adapter for each genuine station source; never turn discovery results into cash.

## 3. Ledger ↔ treasury reconciliation contract

The treasury integration must expose a supported, authenticated way to retrieve:

- treasury/custody account identity;
- settled available balance;
- pending/in-flight debits and credits;
- currency;
- provider snapshot/statement reference and timestamp;
- transaction-level activity or an equivalent reconciliation reference.

Reconciliation rules:

- Compare only settled, same-currency balances.
- Exclude estimates, pending items, unverified station records, and duplicated references.
- A ledger balance must not be represented as externally spendable treasury cash unless the treasury provider confirms it.
- A mismatch, stale snapshot, missing statement reference, or unavailable treasury API must block new settlement requests and create an alert.
- Store reconciliation snapshots and differences for audit; never silently overwrite ledger history to force a match.

## 4. Native settlement executor API contract

The existing GMM app adapter reads `GMM_NATIVE_TRANSFER_URL` and `GMM_NATIVE_TRANSFER_SECRET`, then POSTs an authenticated request. The endpoint must be implemented by the real treasury integration, not by a local mock.

### Request

```http
POST /v1/settlements
Authorization: Bearer <GMM_NATIVE_TRANSFER_SECRET>
Content-Type: application/json
Accept: application/json
Idempotency-Key: <stable-key>
```

```json
{
  "source": "GMM_LEDGER",
  "destination_type": "PAYPAL",
  "destination_id": "<verified-recipient-account-reference>",
  "amount": "500.00",
  "currency": "USD",
  "idempotency_key": "<stable-key>",
  "withdrawal_id": 123,
  "user_reference": "<GMM-owner-reference>"
}
```

### Required execution sequence

1. Authenticate the GMM service and authorize the owner/treasury scope.
2. Validate the destination against a previously verified recipient record; do not trust arbitrary client-supplied destination details.
3. Lock or atomically reserve the source funds at the actual treasury provider.
4. Verify settled available funds cover the requested amount and fees.
5. Persist the idempotency key and immutable request fingerprint before initiating movement.
6. Execute one debit/credit operation through the treasury's documented, authorized rail.
7. On timeout or uncertain provider response, return/retain a reconciliation-required state. Never issue a second debit with a new key.
8. Obtain a stable source debit reference and destination receipt/credit reference.
9. Expose a status lookup by idempotency key and settlement reference.
10. Return a completed result only when source debit and destination receipt are independently confirmed.

### Response

A successful HTTP response is not sufficient proof of settlement. The app's existing response validator requires a recognized status, stable reference, verified cleared source funds, matching amount/currency, and destination receipt for COMPLETED.

Example shape (values are illustrative, not evidence of a real transfer):

```json
{
  "status": "COMPLETED",
  "reference": "provider-settlement-reference",
  "source_debit": {
    "status": "SETTLED",
    "reference": "source-debit-reference",
    "amount": "500.00",
    "currency": "USD",
    "cleared_funds_verified": true
  },
  "destination_receipt": {
    "status": "COMPLETED",
    "reference": "destination-credit-reference",
    "amount": "500.00",
    "currency": "USD"
  }
}
```

The production response schema must match `src/lib/gmm/native-transfer-contract.ts` exactly; extend that validator and its tests if additional receipt fields are required. Do not weaken validation to make an endpoint appear connected.

## 5. State machine and failure handling

Allowed lifecycle:

```text
REQUESTED -> RESERVED -> PROCESSING -> COMPLETED
                   |          |
                   v          v
                FAILED   RECONCILIATION_REQUIRED
```

- `COMPLETED`: only after verified source debit and destination receipt.
- `FAILED`: provider confirms no movement occurred and the reservation/debit is released.
- `RECONCILIATION_REQUIRED`: timeout, conflicting status, missing receipt, or uncertain movement.
- Retrying an uncertain request must reuse the original idempotency key and query provider status first.
- A duplicate request with the same key and same fingerprint returns the original settlement.
- A duplicate key with a different amount, currency, or destination is rejected.
- Never auto-retry an uncertain money movement with a new key.

## 6. Worker and station controls

The existing worker runner calls `/api/gmm/internal/worker/tick` and fails closed unless `GMM_API_URL` and `GMM_WORKER_SECRET` are configured. The route also requires the configured owner identity.

A production scheduler must be deployed as a separately observable Render cron/worker service only after the exact owner ID, API URL, and worker secret are securely configured. It must:

- run station cycles only for enabled, active, unpaused, non-emergency-stopped stations;
- respect each station's next-cycle time;
- record each cycle result and failures;
- never initiate a payout;
- honor the master Stop / emergency-stop control immediately;
- alert on missed cycles and repeated connector failures.

The Render workspace currently has the GMM NEW web service and GMM API web service. A separate scheduled worker was not present in the inspected service list. Do not claim continuous operation until the worker is deployed and its successful ticks are observed.

## 7. Security and operational requirements

- Keep all provider secrets in Render environment variables; never commit secrets or ask the owner to paste them into chat.
- Require HTTPS, service authentication, least-privilege treasury scopes, and key rotation.
- Use database transactions and uniqueness constraints for ledger posting and idempotency.
- Verify webhook signatures before processing; deduplicate provider event IDs.
- Keep append-only audit records for station intake, treasury snapshots, debit attempts, receipts, and reconciliation.
- Rate-limit and alert on repeated authorization failures.
- Keep the master kill switch fail-closed: Stop blocks new scans/collections and settlement initiation; it must not erase history or reverse already-confirmed provider transactions.
- Never display estimated, pending, or ledger-only amounts as verified spendable cash.

## 8. Deployment gates

Do not merge/deploy the treasury executor or enable live settlement until all gates pass:

- [ ] Identify the real legal custody institution/provider holding the GMM treasury funds.
- [ ] Obtain its documented, supported debit/transfer API and production authorization.
- [ ] Confirm source account identity and permitted destination rail.
- [ ] Implement and test provider-specific balance, debit, status lookup, and receipt adapters.
- [ ] Apply and verify production database migrations.
- [ ] Deploy the worker with secure owner and worker credentials.
- [ ] Verify all 15 station source adapters; discovery-only sources remain non-cash.
- [ ] Pass idempotency, duplicate, timeout, partial-failure, replay, and kill-switch tests.
- [ ] Reconcile treasury and ledger balances from provider evidence.
- [ ] Execute a separately authorized low-value live test and verify both source debit and destination receipt.
- [ ] Only then execute the requested $500 transfer and reconcile it end to end.

## 9. Current verified blockers

- The GMM NEW production service is live on Render and auto-deploys from the repository's `main` branch.
- The GMM API production service is live on Render and auto-deploys from its separate repository's `main` branch.
- The recovered GMM source contains the native settlement client and strict response validator, but no treasury-side debit executor implementation.
- The API repository search did not locate an implementation/configuration for `GMM_NATIVE_TRANSFER_URL`.
- The database could not be inspected through the Render read-only query connection because its external IP allowlist is empty. No database networking setting was changed.
- The actual custody provider, source account identity, supported debit API, and production credentials are not present in the recovered source.
- No live transfer has been initiated or claimed.

## 10. Acceptance criteria

The integration is complete only when one traceable transaction can be followed across all layers:

`station source transaction -> verified station collection -> GMM ledger entry -> treasury reconciliation -> authorized treasury debit -> settlement reference -> PayPal destination receipt -> final reconciled ledger state`.

Every link must carry stable references, exact USD amount/currency, timestamps, and auditable status. A green UI indicator, successful HTTP response, or internal ledger entry alone is not acceptance evidence.
