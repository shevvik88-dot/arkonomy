// test-alpaca-invest-amount-edge-cases.mjs
//
// Standalone, disposable script — PENETRATION_TEST_PLAN.md 3.1/3.2.
// Calls the DEPLOYED alpaca-invest function with a battery of bad `amount`
// values. By code inspection (supabase/functions/alpaca-invest/index.ts),
// every case here is expected to be rejected BEFORE any real Alpaca order
// is placed:
//   - amount < 1 or non-finite (negative/zero/NaN/Infinity as JSON, which
//     serializes to null) -> `!Number.isFinite(numAmount) || numAmount < 1`
//     guard, 400, before the pending-row insert even happens.
//   - amount = 1e308 (absurdly large but finite, passes the above guard)
//     -> should reach the buying-power check and get rejected there
//     ("Insufficient buying power"), still before any Alpaca order call.
//
// If any case unexpectedly returns 200/success, STOP — that means a real
// fractional market order was just placed with real money. Check the
// investments table and Alpaca dashboard immediately.
//
// Usage (PowerShell):
//   $env:ARKONOMY_ACCESS_TOKEN = "<paste from browser, see below>"
//   $env:VITE_SUPABASE_ANON_KEY = "<same value as in your .env.local>"
//   node scripts/test-alpaca-invest-amount-edge-cases.mjs
//
// To get ARKONOMY_ACCESS_TOKEN: while logged into app.arkonomy.com, open
// DevTools Console and run:
//   copy(JSON.parse(localStorage.getItem('sb-hvnkxxazjfesbxdkzuba-auth-token')).access_token)
// Paste into the $env: line above, never into chat.

const SUPABASE_URL = 'https://hvnkxxazjfesbxdkzuba.supabase.co';
const ACCESS_TOKEN = process.env.ARKONOMY_ACCESS_TOKEN;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;

if (!ACCESS_TOKEN) { console.error('Missing ARKONOMY_ACCESS_TOKEN'); process.exit(1); }
if (!ANON_KEY) { console.error('Missing VITE_SUPABASE_ANON_KEY'); process.exit(1); }

async function invest(label, rawBody) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/alpaca-invest`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${ACCESS_TOKEN}`,
      'apikey': ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: rawBody,
  });
  const body = await res.json().catch(() => null);
  const rejected = res.status >= 400;
  console.log(`${label}: HTTP ${res.status} — ${rejected ? 'REJECTED (expected)' : '*** SUCCEEDED — REAL ORDER LIKELY PLACED ***'}`);
  console.log('    body:', JSON.stringify(body));
  return rejected;
}

(async () => {
  console.log('alpaca-invest amount edge-case battery — every case should be rejected before touching Alpaca.\n');

  const results = [];
  // JSON.stringify(Infinity) / JSON.stringify(NaN) both serialize to `null`
  // per the JSON spec — sending the literal unquoted token isn't valid
  // JSON, so we build the body string by hand to actually exercise what a
  // hand-crafted malicious request (not JSON.stringify) could send.
  results.push(await invest('amount=-50',            JSON.stringify({ amount: -50, symbol: 'SPY' })));
  results.push(await invest('amount=0',               JSON.stringify({ amount: 0, symbol: 'SPY' })));
  results.push(await invest('amount="NaN" (string)',  JSON.stringify({ amount: 'NaN', symbol: 'SPY' })));
  results.push(await invest('amount=Infinity (raw token, non-standard JSON)', '{"amount":Infinity,"symbol":"SPY"}'));
  results.push(await invest('amount=null (JSON.stringify(Infinity) result)', JSON.stringify({ amount: JSON.stringify(Infinity) === 'null' ? null : Infinity, symbol: 'SPY' })));
  results.push(await invest('amount=1e308',           JSON.stringify({ amount: 1e308, symbol: 'SPY' })));

  console.log('\n=== Verdict ===');
  console.log(results.every(Boolean)
    ? 'PASS: all 6 bad-amount attempts were rejected before reaching Alpaca.'
    : '*** FAIL — at least one case succeeded. Check investments table + Alpaca dashboard for a real order. ***');
})();
