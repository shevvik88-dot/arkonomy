# Edge function regression tests

Deno tests for the race-condition / security fixes on the money- and
bank-path edge functions. One file per target:

| File | Target | Guards |
|---|---|---|
| `requirePaidPlan.test.ts` | `_shared/requirePaidPlan.ts` | paid-Pro gate (E4 / PENETRATION_TEST_PLAN 6.4) — unit, no stack |
| `alpaca-invest.test.ts` | `alpaca-invest` | FINDING-A pending-row dedup, plan gate, validation, stale-token teardown |
| `stripe-webhook.test.ts` | `stripe-webhook` | FINDING-B `event_id` idempotency, signature verification, subscription lifecycle |
| `plaid-sync.test.ts` | `plaid-sync-transactions` | FINDING-E cursor compare-and-swap, service-role gate, category mapping |

## Running

```sh
npx supabase start      # the integration tests need the local stack
npm run test:edge
```

`requirePaidPlan.test.ts` runs without the stack; the other three create
disposable auth users on the local stack and fake the external APIs
(Alpaca, Plaid) — no real broker/bank/Stripe call is ever made.

## How it works

- `_helpers/setup.ts` sets `ARK_EDGE_TEST` (so the handler modules skip
  their `Deno.serve(...)` call on import) and points the Supabase env vars
  at the local stack. It must be the first import in every test file
  (`_helpers/mod.ts` re-exports it first).
- Each function's `index.ts` now exports `handler(req)` and only calls
  `Deno.serve(handler)` when `ARK_EDGE_TEST` is unset — deployed behaviour
  is unchanged.
- `_helpers/fakeFetch.ts` intercepts calls to `*.alpaca.markets` /
  `*.plaid.com` / `*.stripe.com` and passes everything else (the local
  stack) straight through.

## TODO — follow-up

- Wire `npm run test:edge` into CI (`.github/workflows/`) with a
  `supabase start` step. Deliberately out of scope for the PR that added
  these tests; tracked as a separate change.
