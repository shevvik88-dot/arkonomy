// PENETRATION_TEST_PLAN.md 6.3 — signup IP rate limit.
//
// BEFORE the fix (git history of this file): 20 back-to-back POSTs straight
// to /auth/v1/signup from one IP all returned 200, no throttle at all.
//
// AFTER the fix: signup + confirmation-email resend are routed through the
// auth-signup edge function, which calls check_and_increment_ip_rate_limit
// (ip_rate_limits table, 1-hour rolling window) BEFORE proxying to GoTrue.
// Limits: auth-signup 10/IP/hr, auth-resend 5/IP/hr. Fail-open.
//
// This drives the deployed edge function and asserts the 11th signup / 6th
// resend from this source is a 429. Disposable @arkonomy-pentest.invalid
// emails; ip_rate_limits rows for the test scopes cleared before + after;
// any GoTrue-created users deleted via Admin API.
//
// Run: node scripts/test-signup-rate-limit-6.3.mjs

import {
  SUPABASE_URL, ANON_KEY, SERVICE_ROLE_KEY,
  disposableEmail, randomPassword, deleteUser,
} from './_lib-disposable-account.mjs';

const SIGNUP_LIMIT = 10;
const RESEND_LIMIT = 5;
const CREATED = [];

async function clearIpLimits() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/ip_rate_limits?scope=in.(auth-signup,auth-resend)`,
    { method: 'DELETE', headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, Prefer: 'return=minimal' } },
  );
  return res.status;
}

async function callAuthSignup(payload) {
  const t0 = Date.now();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/auth-signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON_KEY },
    body: JSON.stringify(payload),
  });
  const ms = Date.now() - t0;
  let body; try { body = await res.json(); } catch { body = null; }
  return { status: res.status, ms, body };
}

const run = async () => {
  console.log('=== 6.3 signup IP rate limit — against deployed auth-signup edge function ===\n');
  console.log(`cleared ip_rate_limits (test scopes): HTTP ${await clearIpLimits()}\n`);

  // ── signup: expect 200 for the first SIGNUP_LIMIT, 429 from the next ──
  console.log(`--- ${SIGNUP_LIMIT + 3} signups back-to-back (limit ${SIGNUP_LIMIT}/IP/hr) ---`);
  let firstSignup429 = null;
  for (let i = 1; i <= SIGNUP_LIMIT + 3; i++) {
    const email = disposableEmail(`sr${i}`);
    const r = await callAuthSignup({ mode: 'signup', email, password: randomPassword(), full_name: 'Pentest 6.3' });
    const id = r.body?.id || r.body?.user?.id;
    if (id && id !== '00000000-0000-0000-0000-000000000000') CREATED.push(id);
    const tag = r.status === 200 ? 'ok' : (r.status === 429 ? '429 RATE LIMITED' : `err ${JSON.stringify(r.body)}`);
    console.log(`#${String(i).padStart(2)}  HTTP ${r.status}  ${String(r.ms).padStart(5)}ms  ${tag}`);
    if (r.status === 429 && firstSignup429 === null) firstSignup429 = i;
  }

  // ── resend: fresh scope, expect 429 from the (RESEND_LIMIT+1)th ──
  console.log(`\n--- ${RESEND_LIMIT + 2} resends back-to-back (limit ${RESEND_LIMIT}/IP/hr) ---`);
  let firstResend429 = null;
  for (let i = 1; i <= RESEND_LIMIT + 2; i++) {
    const r = await callAuthSignup({ mode: 'resend', email: disposableEmail(`rs${i}`) });
    const tag = r.status < 400 ? 'ok' : (r.status === 429 ? '429 RATE LIMITED' : `HTTP ${r.status} ${JSON.stringify(r.body)}`);
    console.log(`#${String(i).padStart(2)}  HTTP ${r.status}  ${String(r.ms).padStart(5)}ms  ${tag}`);
    if (r.status === 429 && firstResend429 === null) firstResend429 = i;
  }

  console.log('\n--- result ---');
  const signupOk = firstSignup429 === SIGNUP_LIMIT + 1;
  const resendOk = firstResend429 === RESEND_LIMIT + 1;
  console.log(`signup: first 429 at #${firstSignup429 ?? 'NEVER'}  (expected #${SIGNUP_LIMIT + 1})  ${signupOk ? 'PASS' : 'FAIL'}`);
  console.log(`resend: first 429 at #${firstResend429 ?? 'NEVER'}  (expected #${RESEND_LIMIT + 1})  ${resendOk ? 'PASS' : 'FAIL'}`);

  // ── cleanup ──
  console.log('\n--- cleanup ---');
  console.log(`cleared ip_rate_limits (test scopes): HTTP ${await clearIpLimits()}`);
  let deleted = 0;
  for (const uid of CREATED) {
    try { await deleteUser(uid); deleted++; } catch (e) { console.log(`FAILED delete ${uid.slice(0, 8)}: ${e.message}`); }
  }
  console.log(`deleted ${deleted}/${CREATED.length} disposable accounts`);

  console.log(`\n=== ${signupOk && resendOk ? 'ALL PASS' : 'SOME FAILED'} ===`);
  process.exit(signupOk && resendOk ? 0 : 1);
};

run().catch((e) => { console.error(e); process.exit(1); });
