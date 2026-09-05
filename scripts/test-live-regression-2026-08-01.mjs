// test-live-regression-2026-08-01.mjs
//
// Post-deploy regression check for: alpaca-invest (NaN validation),
// stock-ai-analysis (symbol/name/numeric validation), market-data (rate
// limiting). Confirms (a) legitimate real requests still succeed, and
// (b) invalid input is now correctly rejected. No money moved — the
// alpaca-invest case only sends a deliberately invalid amount to prove
// the 400 rejection path, never a valid amount that would place an order.
//
// Usage (PowerShell):
//   $env:ARKONOMY_ACCESS_TOKEN = "<paste from browser, see below>"
//   $env:VITE_SUPABASE_ANON_KEY = "<same value as in your .env>"
//   node scripts/test-live-regression-2026-08-01.mjs
//
// To get ARKONOMY_ACCESS_TOKEN: while logged into app.arkonomy.com, open
// DevTools Console and run:
//   copy(JSON.parse(localStorage.getItem('sb-hvnkxxazjfesbxdkzuba-auth-token')).access_token)

const SUPABASE_URL = 'https://hvnkxxazjfesbxdkzuba.supabase.co';
const ACCESS_TOKEN = process.env.ARKONOMY_ACCESS_TOKEN;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;

if (!ACCESS_TOKEN) { console.error('Missing ARKONOMY_ACCESS_TOKEN'); process.exit(1); }
if (!ANON_KEY) { console.error('Missing VITE_SUPABASE_ANON_KEY'); process.exit(1); }

async function call(fn, body) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${ACCESS_TOKEN}`,
      'apikey': ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  let json;
  try { json = await res.json(); } catch { json = null; }
  return { status: res.status, json };
}

let pass = 0, fail = 0;
function check(label, condition, detail) {
  if (condition) { console.log(`PASS  ${label}`); pass++; }
  else { console.log(`FAIL  ${label}  —  ${detail}`); fail++; }
}

(async () => {
  console.log('=== alpaca-invest: invalid amount should be rejected (no order placed) ===');
  {
    const r = await call('alpaca-invest', { amount: 'abc', symbol: 'SPY' });
    console.log(JSON.stringify(r));
    check('alpaca-invest rejects amount:"abc"', r.status === 400, `got ${r.status}`);
  }

  console.log('\n=== stock-ai-analysis: legitimate request should still succeed ===');
  {
    const r = await call('stock-ai-analysis', {
      symbol: 'SPY', name: 'S&P 500', price: 452.31, changePct: 0.42,
      high52w: 460.1, low52w: 401.2, isCrypto: false,
    });
    console.log(JSON.stringify(r).slice(0, 300));
    check('stock-ai-analysis accepts SPY', r.status === 200 && !!r.json?.trend, `got ${r.status}`);
  }

  console.log('\n=== stock-ai-analysis: real dotted ticker (BRK.B) should still be accepted ===');
  {
    const r = await call('stock-ai-analysis', {
      symbol: 'BRK.B', name: 'Berkshire Hathaway Class B', price: 410.5, isCrypto: false,
    });
    console.log(JSON.stringify(r).slice(0, 300));
    check('stock-ai-analysis accepts BRK.B', r.status === 200, `got ${r.status}: ${JSON.stringify(r.json)}`);
  }

  console.log('\n=== stock-ai-analysis: garbage symbol should be rejected ===');
  {
    const r = await call('stock-ai-analysis', { symbol: '<script>alert(1)</script>', name: 'x' });
    console.log(JSON.stringify(r));
    check('stock-ai-analysis rejects garbage symbol', r.status === 400, `got ${r.status}`);
  }

  console.log('\n=== market-data: legitimate quote request should still succeed ===');
  {
    const r = await call('market-data', { type: 'quote', symbol: 'SPY' });
    console.log(JSON.stringify(r).slice(0, 300));
    check('market-data quote SPY', r.status === 200, `got ${r.status}: ${JSON.stringify(r.json)}`);
  }

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
})();
