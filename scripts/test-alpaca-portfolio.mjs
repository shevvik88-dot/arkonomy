// test-alpaca-portfolio.mjs
//
// Direct call to the deployed alpaca-portfolio function — confirms whether
// real Alpaca positions still exist (money-safety check) and whether the
// function itself works end-to-end, independent of any frontend/CORS issue
// (Node's fetch doesn't enforce CORS, so this isolates server-side behavior).
//
// Usage (PowerShell):
//   $env:ARKONOMY_ACCESS_TOKEN = "<paste from browser, see below>"
//   $env:VITE_SUPABASE_ANON_KEY = "<same value as in your .env>"
//   node scripts/test-alpaca-portfolio.mjs
//
// To get ARKONOMY_ACCESS_TOKEN: while logged into app.arkonomy.com, open
// DevTools Console and run:
//   copy(JSON.parse(localStorage.getItem('sb-hvnkxxazjfesbxdkzuba-auth-token')).access_token)

const SUPABASE_URL = 'https://hvnkxxazjfesbxdkzuba.supabase.co';
const ACCESS_TOKEN = process.env.ARKONOMY_ACCESS_TOKEN;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;

if (!ACCESS_TOKEN) { console.error('Missing ARKONOMY_ACCESS_TOKEN'); process.exit(1); }
if (!ANON_KEY) { console.error('Missing VITE_SUPABASE_ANON_KEY'); process.exit(1); }

(async () => {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/alpaca-portfolio`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${ACCESS_TOKEN}`,
      'apikey': ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });
  const body = await res.json();
  console.log(`HTTP ${res.status}`);
  console.log(JSON.stringify(body, null, 2));
})();
