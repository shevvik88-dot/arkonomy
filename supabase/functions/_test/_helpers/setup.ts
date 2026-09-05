// MUST be the first import in every *.test.ts file in this folder, before
// any `../<function>/index.ts` import.
//
// Two jobs, both done at module-eval time (top-level await runs before the
// importing test file's other imports are evaluated):
//   1. Set ARK_EDGE_TEST so the handler modules skip their `Deno.serve(...)`
//      call on import — the tests invoke `handler(req)` directly.
//   2. Populate the env vars the handler modules read, some at import time
//      (corsHeaders / module consts) and some per-request, pointing them at
//      the local Supabase stack + dummy external-API creds (the external
//      calls are faked by fakeFetch.ts, so the values just need to exist).

import postgres from 'npm:postgres@3';
import { getLocalConfig } from './localStack.ts';

const cfg = await getLocalConfig();

// Apply the test-only compensating grants (see fixtures.sql for why). Uses
// the superuser DB_URL from `supabase status`, not a Supabase client.
{
  const sql = postgres(cfg.dbUrl, { max: 1 });
  try {
    const fixture = await Deno.readTextFile(new URL('./fixtures.sql', import.meta.url));
    await sql.unsafe(fixture);
  } finally {
    await sql.end();
  }
}

Deno.env.set('ARK_EDGE_TEST', '1');

Deno.env.set('SUPABASE_URL', cfg.apiUrl);
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', cfg.serviceRoleKey);
Deno.env.set('SUPABASE_ANON_KEY', cfg.anonKey);
Deno.env.set('APP_URL', 'http://localhost:5173');

// External APIs — all faked by fakeFetch.ts; these only need to be non-empty
// so the handlers don't bail on a missing-config check.
Deno.env.set('PLAID_ENV', 'production');            // → https://production.plaid.com
Deno.env.set('PLAID_CLIENT_ID', 'test-plaid-client-id');
Deno.env.set('PLAID_SECRET', 'test-plaid-secret');
Deno.env.set('STRIPE_SECRET_KEY', 'sk_test_edge_harness');
Deno.env.set('STRIPE_WEBHOOK_SECRET', 'whsec_edge_harness_secret');

// No SENTRY_DSN on purpose — initSentry() no-ops, captureAndFlush() is inert.

export { cfg as localConfig };
export const STRIPE_WEBHOOK_SECRET = 'whsec_edge_harness_secret';
