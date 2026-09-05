// test-weekly-report.mjs
//
// Manual single-user test of weekly-report — sends only to the account
// whose JWT is used (not the cron/all-users path). Use this to see the
// new "This Week / Last Week" box format live without waiting for the
// scheduled cron send.
//
// Usage (PowerShell):
//   $env:ARKONOMY_ACCESS_TOKEN = "<paste from browser, see below>"
//   $env:VITE_SUPABASE_ANON_KEY = "<same value as in your .env>"
//   node scripts/test-weekly-report.mjs
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
  const res = await fetch(`${SUPABASE_URL}/functions/v1/weekly-report`, {
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

  const result = body?.results?.[0];
  if (!result) { console.log('\nNo result entry — check the raw response above.'); return; }
  if (result.status === 'sent') console.log('\nPASS-ish: email sent. Check your inbox for the new This Week / Last Week boxes.');
  else if (result.status === 'skipped') console.log(`\nSkipped — reason: ${result.error}. "no_sections_enabled" means all digest content toggles are off in notification_preferences; "No transactions found" means the account has none synced.`);
  else console.log(`\nStatus: ${result.status} (${result.error ?? ''})`);
})();
