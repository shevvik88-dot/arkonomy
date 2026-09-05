// PENETRATION_TEST_PLAN.md 6.4 / SECURITY_THREAT_MODEL.md E4
//
// alpaca-invest / alpaca-oauth-start / alpaca-portfolio had NO server-side
// plan check — the Pro paywall on investing lived only in React state.
//
// This test proves the gap AND verifies the fix, without moving a cent —
// a disposable account (no Alpaca token) calls the edge functions directly
// with its own JWT, and we flip its profiles.plan / trial_ends_at via
// service-role SQL between cases.
//
//   Case A  free (plan=free)                  → expect 403 upgrade_required (post-fix)
//                                               was 400 alpaca_not_connected (pre-fix)
//   Case B  trial (plan=pro, trial in future) → expect 403 (client blocks trial invest too)
//   Case C  paid  (plan=pro, trial_ends_at null) → expect 400 alpaca_not_connected
//                                               (passes the plan gate, stopped only by
//                                                the missing token — real Pro not broken)
//
// Run: node scripts/test-alpaca-invest-plan-gate-6.4.mjs

import {
  SUPABASE_URL, ANON_KEY, SERVICE_ROLE_KEY,
  disposableEmail, randomPassword, createDisposableUser, deleteUser, passwordSignIn,
} from './_lib-disposable-account.mjs';

async function patchProfile(userId, fields) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      Prefer: 'return=representation',
    },
    body: JSON.stringify(fields),
  });
  const b = await res.json();
  if (!res.ok) throw new Error(`patchProfile failed: ${res.status} ${JSON.stringify(b)}`);
  return b[0];
}

async function callFn(slug, token, body) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${slug}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON_KEY, Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let b; try { b = await res.json(); } catch { b = null; }
  return { status: res.status, body: b };
}

const run = async () => {
  const email = disposableEmail('pg64');
  const password = randomPassword();
  let userId = null;

  try {
    const user = await createDisposableUser(email, password);
    userId = user.id;
    console.log(`disposable account: ${userId.slice(0, 8)}  ${email}\n`);

    const si = await passwordSignIn(email, password);
    if (!si.body?.access_token) throw new Error(`login failed: ${JSON.stringify(si.body)}`);
    const token = si.body.access_token;

    const expect = (label, r, wantStatus, wantErr) => {
      const ok = r.status === wantStatus && (!wantErr || r.body?.error === wantErr);
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
      console.log(`      → HTTP ${r.status} ${JSON.stringify(r.body)}  (expected ${wantStatus}${wantErr ? ' ' + wantErr : ''})`);
      return ok;
    };

    let allPass = true;

    // ── Case A: free ────────────────────────────────────────────
    const pA = await patchProfile(userId, { plan: 'free', trial_ends_at: null });
    console.log(`Case A — plan=${pA.plan} trial_ends_at=${pA.trial_ends_at}`);
    allPass &= expect('A alpaca-invest (free)',       await callFn('alpaca-invest', token, { amount: 1, symbol: 'SPY' }), 403, 'upgrade_required');
    allPass &= expect('A alpaca-oauth-start (free)',  await callFn('alpaca-oauth-start', token, {}),                     403, 'upgrade_required');
    allPass &= expect('A alpaca-portfolio (free)',    await callFn('alpaca-portfolio', token, {}),                      403, 'upgrade_required');

    // ── Case B: active trial (plan=pro, trial_ends_at in the future) ──
    const future = new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString();
    const pB = await patchProfile(userId, { plan: 'pro', trial_ends_at: future });
    console.log(`\nCase B — plan=${pB.plan} trial_ends_at=${pB.trial_ends_at}`);
    allPass &= expect('B alpaca-invest (active trial)', await callFn('alpaca-invest', token, { amount: 1, symbol: 'SPY' }), 403, 'upgrade_required');

    // ── Case C: paid Pro (plan=pro, trial_ends_at null) ─────────
    const pC = await patchProfile(userId, { plan: 'pro', trial_ends_at: null });
    console.log(`\nCase C — plan=${pC.plan} trial_ends_at=${pC.trial_ends_at}`);
    allPass &= expect('C alpaca-invest (paid Pro, no token)', await callFn('alpaca-invest', token, { amount: 1, symbol: 'SPY' }), 400, 'alpaca_not_connected');
    allPass &= expect('C alpaca-portfolio (paid Pro, no token)', await callFn('alpaca-portfolio', token, {}), 400, 'alpaca_not_connected');

    // ── no side effects ────────────────────────────────────────
    const invRes = await fetch(`${SUPABASE_URL}/rest/v1/investments?user_id=eq.${userId}&select=id`, {
      headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
    });
    const inv = await invRes.json();
    console.log(`\ninvestments rows for this user: ${inv.length} (expected 0 — plan gate fires before the pending-row insert)`);

    console.log(`\n=== ${allPass && inv.length === 0 ? 'ALL PASS' : 'SOME FAILED'} ===`);
  } finally {
    if (userId) {
      const c = await deleteUser(userId);
      console.log(`cleanup: deleted ${userId.slice(0, 8)} (HTTP ${c})`);
    }
  }
};

run().catch((e) => { console.error(e); process.exit(1); });
