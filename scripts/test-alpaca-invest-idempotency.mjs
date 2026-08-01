// test-alpaca-invest-idempotency.mjs
//
// Standalone, disposable script — calls the DEPLOYED alpaca-invest function
// twice with a fixed 5s delay (well inside the 60s dedup window, and
// precisely controlled — unlike a manual double-click, which is hard to
// time exactly). First call should place a real $1 SPY order; second call
// should get back the 409 "already submitted" duplicate error.
//
// This places a REAL order on live Alpaca if the first call succeeds.
//
// Usage (PowerShell):
//   $env:ARKONOMY_ACCESS_TOKEN = "<paste from browser, see below>"
//   $env:VITE_SUPABASE_ANON_KEY = "<same value as in your .env>"
//   node scripts/test-alpaca-invest-idempotency.mjs
//
// To get ARKONOMY_ACCESS_TOKEN: while logged into app.arkonomy.com, open
// DevTools Console and run:
//   copy(JSON.parse(localStorage.getItem('sb-hvnkxxazjfesbxdkzuba-auth-token')).access_token)
// This copies your session token straight to the clipboard — paste it into
// the $env: line above, never into chat.

const SUPABASE_URL = 'https://hvnkxxazjfesbxdkzuba.supabase.co';
const ACCESS_TOKEN = process.env.ARKONOMY_ACCESS_TOKEN;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;

if (!ACCESS_TOKEN) { console.error('Missing ARKONOMY_ACCESS_TOKEN'); process.exit(1); }
if (!ANON_KEY) { console.error('Missing VITE_SUPABASE_ANON_KEY'); process.exit(1); }

async function invest(label) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/alpaca-invest`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${ACCESS_TOKEN}`,
      'apikey': ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ amount: 1, symbol: 'SPY' }),
  });
  const body = await res.json();
  console.log(`${label}: HTTP ${res.status}`, body);
  return { status: res.status, body };
}

(async () => {
  console.log('=== Call 1 ===');
  const first = await invest('Call 1');

  console.log('\nWaiting 5s (fixed, well inside the 60s window)...\n');
  await new Promise(r => setTimeout(r, 5000));

  console.log('=== Call 2 ===');
  const second = await invest('Call 2');

  console.log('\n=== Verdict ===');
  const pass = first.status === 200 && second.status === 409;
  console.log(pass
    ? 'PASS: first call placed the order, second call was correctly rejected as a duplicate.'
    : 'UNEXPECTED — check statuses above against expected (200, then 409).');
})();
