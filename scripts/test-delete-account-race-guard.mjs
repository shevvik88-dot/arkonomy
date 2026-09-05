// test-delete-account-race-guard.mjs
//
// Standalone, disposable script — calls the DEPLOYED delete-account
// function against the TEST ACCOUNT with dry_run:false, while a synthetic
// 'pending' investments row (symbol='PENTEST') is already in place
// (inserted separately via service-role SQL before running this).
//
// Verifies the delete-account race-guard fix (PENTEST_PLAN.md 3.3/6.2):
// the pending-investment poll runs BEFORE any Stripe/Plaid/deletion side
// effect, so as long as the synthetic row is genuinely 'pending', the
// expected result is a clean 409 after ~7-8s with ZERO other side effects
// (no Stripe cancel, no Plaid revoke, no row deleted) — not an actual
// account deletion.
//
// Do NOT run this without first confirming a 'pending' investments row
// exists for the target account (ask Claude to set it up via SQL first).
//
// Usage (PowerShell):
//   $env:ARKONOMY_ACCESS_TOKEN = "<paste from browser, see below>"
//   $env:VITE_SUPABASE_ANON_KEY = "<same value as in your .env.local>"
//   node scripts/test-delete-account-race-guard.mjs
//
// To get ARKONOMY_ACCESS_TOKEN: while logged into app.arkonomy.com as the
// test account, open DevTools Console and run:
//   copy(JSON.parse(localStorage.getItem('sb-hvnkxxazjfesbxdkzuba-auth-token')).access_token)
// This copies your session token straight to the clipboard — paste it into
// the $env: line above, never into chat.

const SUPABASE_URL = 'https://hvnkxxazjfesbxdkzuba.supabase.co';
const ACCESS_TOKEN = process.env.ARKONOMY_ACCESS_TOKEN;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;

if (!ACCESS_TOKEN) { console.error('Missing ARKONOMY_ACCESS_TOKEN'); process.exit(1); }
if (!ANON_KEY) { console.error('Missing VITE_SUPABASE_ANON_KEY'); process.exit(1); }

(async () => {
  console.log('Calling delete-account with dry_run:false — expecting a 409 block (pending investment guard), NOT an actual deletion.');
  const start = Date.now();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/delete-account`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${ACCESS_TOKEN}`,
      'apikey': ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ dry_run: false }),
  });
  const elapsed = Date.now() - start;
  const body = await res.json();
  console.log(`HTTP ${res.status} after ${elapsed}ms`, body);

  console.log('\n=== Verdict ===');
  if (res.status === 409) {
    console.log('PASS: correctly blocked with 409 — the pending-investment guard is working.');
  } else if (res.status === 200 && body?.success) {
    console.log('FAIL — account was actually deleted! The guard did not block despite the pending row.');
  } else {
    console.log('UNEXPECTED — check status/body above.');
  }
})();
