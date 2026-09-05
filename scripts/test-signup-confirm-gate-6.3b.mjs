// PENETRATION_TEST_PLAN.md 6.3 follow-up — is email confirmation actually a
// barrier to using a freshly-signed-up account's session (and therefore its
// fresh ai-chat / get-insights rate-limit budget)?
//
// 1. raw /auth/v1/signup (anon) — no Admin API
// 2. raw /auth/v1/token?grant_type=password on that unconfirmed account
// 3. if a session comes back: call get-insights twice, read x-ratelimit headers
//    / body to show the per-user budget is fresh.
// Cleanup: Admin API deleteUser.

import {
  SUPABASE_URL, ANON_KEY,
  disposableEmail, randomPassword, deleteUser, passwordSignIn,
} from './_lib-disposable-account.mjs';

const created = [];

const run = async () => {
  const email = disposableEmail('cg');
  const password = randomPassword();

  console.log('=== 6.3b — confirmation gate on login ===\n');

  const su = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON_KEY },
    body: JSON.stringify({ email, password }),
  });
  const suBody = await su.json();
  const id = suBody?.id || suBody?.user?.id;
  if (id) created.push(id);
  console.log(`signup            : HTTP ${su.status}  id=${id ? id.slice(0, 8) : '—'}  session=${!!suBody?.access_token}  confirmed_at=${suBody?.confirmed_at ?? 'null'}`);

  const si = await passwordSignIn(email, password);
  const siSession = !!si.body?.access_token;
  console.log(`password login    : HTTP ${si.status}  session=${siSession}  ${siSession ? '' : 'err=' + (si.body?.error_code || si.body?.code || si.body?.msg || si.body?.error_description || '')}`);

  if (siSession) {
    console.log('\n!! login succeeded WITHOUT email confirmation — fresh session obtained.');
    const token = si.body.access_token;
    for (let i = 1; i <= 2; i++) {
      const r = await fetch(`${SUPABASE_URL}/functions/v1/get-insights`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: ANON_KEY, Authorization: `Bearer ${token}` },
        body: JSON.stringify({}),
      });
      const rl = {
        limit: r.headers.get('x-ratelimit-limit'),
        remaining: r.headers.get('x-ratelimit-remaining'),
      };
      let b; try { b = await r.json(); } catch { b = null; }
      console.log(`  get-insights #${i}: HTTP ${r.status}  ratelimit=${JSON.stringify(rl)}  bodyKeys=${b ? Object.keys(b).join(',') : '—'}`);
    }
  } else {
    console.log('\nlogin blocked until email confirmed — confirmation is enforced for the session path.');
    console.log('(A real attacker uses a real disposable-inbox provider + the confirm link; .invalid cannot receive mail, so this test stops here.)');
  }

  console.log('\n--- cleanup ---');
  for (const uid of created) {
    try { const c = await deleteUser(uid); console.log(`deleted ${uid.slice(0, 8)} (HTTP ${c})`); }
    catch (e) { console.log(`FAILED delete ${uid.slice(0, 8)}: ${e.message}`); }
  }
};

run().catch((e) => { console.error(e); process.exit(1); });
