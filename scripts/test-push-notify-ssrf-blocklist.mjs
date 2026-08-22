// test-push-notify-ssrf-blocklist.mjs
//
// Standalone, disposable script — PENETRATION_TEST_PLAN.md 2.1 live
// verification of the push-notify allow-list fix (v57->v58,
// supabase/functions/push-notify/index.ts).
//
// Pre-condition (already done by Claude via service-role SQL before this
// script is run): the TEST ACCOUNT's profiles.push_subscription.endpoint
// was overwritten to a webhook.site test URL (a safe external address, not
// an internal/metadata address) — simulating the exact attack vector this
// finding describes (push_subscription is a client-writable column; a real
// attacker would do this same overwrite via a direct PostgREST update).
//
// This script calls the DEPLOYED push-notify function's Mode 1
// (POST {user_id, title, body}) with the test account's own JWT, exactly
// as a real authenticated attacker would. Expected result if the fix
// works: HTTP 400 { sent: 0, reason: 'invalid_endpoint' } — the request
// to webhook.site must NEVER be sent. If it instead returns
// { sent: 1 }, the allow-list did not block it — STOP, that's the SSRF
// firing for real against an external address.
//
// Usage (PowerShell):
//   $env:ARKONOMY_ACCESS_TOKEN = "<paste from browser, see below>"
//   $env:VITE_SUPABASE_ANON_KEY = "<same value as in your .env.local>"
//   node scripts/test-push-notify-ssrf-blocklist.mjs
//
// To get ARKONOMY_ACCESS_TOKEN: while logged into app.arkonomy.com as the
// test account, open DevTools Console and run:
//   copy(JSON.parse(localStorage.getItem('sb-hvnkxxazjfesbxdkzuba-auth-token')).access_token)
// This copies your session token straight to the clipboard — paste it into
// the $env: line above, never into chat.

const SUPABASE_URL = 'https://hvnkxxazjfesbxdkzuba.supabase.co';
const ACCESS_TOKEN = process.env.ARKONOMY_ACCESS_TOKEN;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;
const TEST_USER_ID = '90eb11c3-c1e9-4241-8362-9e15ce231c33';

if (!ACCESS_TOKEN) { console.error('Missing ARKONOMY_ACCESS_TOKEN'); process.exit(1); }
if (!ANON_KEY) { console.error('Missing VITE_SUPABASE_ANON_KEY'); process.exit(1); }

(async () => {
  console.log('Calling push-notify Mode 1 with a subscription.endpoint pointed at webhook.site.');
  console.log('Expecting: HTTP 400 { sent: 0, reason: "invalid_endpoint" } — allow-list blocks BEFORE any fetch to webhook.site.\n');

  const res = await fetch(`${SUPABASE_URL}/functions/v1/push-notify`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${ACCESS_TOKEN}`,
      'apikey': ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      user_id: TEST_USER_ID,
      title: 'SSRF allow-list live test',
      body: 'If you see this as a real push notification, the allow-list failed.',
    }),
  });

  const status = res.status;
  const data = await res.json().catch(() => null);
  console.log('HTTP status:', status);
  console.log('Response body:', JSON.stringify(data));

  if (status === 400 && data?.reason === 'invalid_endpoint') {
    console.log('\nPASS — blocked before reaching webhook.site, as expected.');
  } else if (data?.sent === 1) {
    console.log('\n*** FAIL — sent:1 means the request to webhook.site actually went out. SSRF NOT blocked. Stop and investigate. ***');
  } else {
    console.log('\nUNEXPECTED result shape — inspect manually before concluding pass/fail.');
  }
})();
