// test-malformed-json-3.6.mjs
//
// Standalone, disposable script — PENETRATION_TEST_PLAN.md 3.6.
// Sends a raw, invalid-JSON body (an unquoted `Infinity` token, same
// non-standard payload that first surfaced this bug class in 3.5) to the
// 4 functions found to share alpaca-invest's unguarded `req.json()` shape:
// ai-chat, auth-login, plaid-exchange-token, stock-ai-analysis. All 4 were
// just redeployed with the same try/catch-and-400 fix already live on
// alpaca-invest (v73→v74). Expected result on every case: HTTP 400
// {"error":"Invalid request body"} — not 500.
//
// auth-login needs no bearer token (it IS the login endpoint). The other
// three require a real user session to get past their own auth check
// before the body is ever parsed.
//
// Usage (PowerShell):
//   $env:ARKONOMY_ACCESS_TOKEN = "<paste from browser, see below>"
//   $env:VITE_SUPABASE_ANON_KEY = "<same value as in your .env.local>"
//   node scripts/test-malformed-json-3.6.mjs
//
// To get ARKONOMY_ACCESS_TOKEN: while logged into app.arkonomy.com, open
// DevTools Console and run:
//   copy(JSON.parse(localStorage.getItem('sb-hvnkxxazjfesbxdkzuba-auth-token')).access_token)
// Paste into the $env: line above, never into chat.

const SUPABASE_URL = 'https://hvnkxxazjfesbxdkzuba.supabase.co';
const ACCESS_TOKEN = process.env.ARKONOMY_ACCESS_TOKEN;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;

if (!ANON_KEY) { console.error('Missing VITE_SUPABASE_ANON_KEY'); process.exit(1); }

const MALFORMED_BODY = '{"foo":Infinity}'; // raw, non-standard JSON token — invalid per RFC 8259

async function callFn(label, path, { needsAuth }) {
  if (needsAuth && !ACCESS_TOKEN) {
    console.log(`${label}: SKIPPED — needs ARKONOMY_ACCESS_TOKEN`);
    return null;
  }
  const headers = { 'apikey': ANON_KEY, 'Content-Type': 'application/json' };
  if (needsAuth) headers['Authorization'] = `Bearer ${ACCESS_TOKEN}`;

  const res = await fetch(`${SUPABASE_URL}/functions/v1/${path}`, {
    method: 'POST',
    headers,
    body: MALFORMED_BODY,
  });
  const body = await res.json().catch(() => null);
  const pass = res.status === 400;
  console.log(`${label}: HTTP ${res.status} — ${pass ? 'PASS (400 as expected)' : '*** FAIL — expected 400 ***'}`);
  console.log('    body:', JSON.stringify(body));
  return pass;
}

(async () => {
  console.log('Malformed-JSON battery (3.6) — every case should return 400, not 500.\n');

  const results = [];
  results.push(await callFn('auth-login',           'auth-login',           { needsAuth: false }));
  results.push(await callFn('ai-chat',               'ai-chat',               { needsAuth: true }));
  results.push(await callFn('plaid-exchange-token',  'plaid-exchange-token',  { needsAuth: true }));
  results.push(await callFn('stock-ai-analysis',     'stock-ai-analysis',     { needsAuth: true }));

  console.log('\n=== Verdict ===');
  const attempted = results.filter(r => r !== null);
  console.log(attempted.length > 0 && attempted.every(Boolean)
    ? `PASS: ${attempted.length}/${attempted.length} attempted cases returned 400.`
    : '*** Some case(s) did not return 400 — check output above. ***');
})();
