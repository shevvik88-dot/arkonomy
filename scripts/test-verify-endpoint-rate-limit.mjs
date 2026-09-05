// test-verify-endpoint-rate-limit.mjs — PENTEST S5 correction/follow-up.
//
// Supabase's own docs (guides/auth/rate-limits) say /auth/v1/verify IS
// rate-limited by IP address using a token-bucket algorithm — burst
// capacity 30 requests, refilling at a project-wide
// auth.rate_limits.verification.requests_per_hour rate — and this is
// NOT customizable via Dashboard/Management API (unlike rate_limit_otp,
// rate_limit_email_sent, etc., which are). The original S5 test
// (scripts/test-password-reset-token.mjs) only sent 15 wrong guesses —
// under the documented 30-request burst — so it could never have
// observed the real throttle. This script sends enough requests to
// actually cross the burst threshold and confirms a 429 shows up.
//
// Disposable account only.

import {
  disposableEmail, randomPassword, createDisposableUser, deleteUser,
  generateLink, SUPABASE_URL, ANON_KEY,
} from './_lib-disposable-account.mjs';

(async () => {
  const email = disposableEmail('verify-ratelimit');
  const password = randomPassword();
  const user = await createDisposableUser(email, password);
  console.log('Created user id:', user.id);

  try {
    const link = await generateLink('recovery', email);
    const realOtp = (link.body.properties ?? link.body).email_otp;
    console.log('Real OTP obtained (not printed) — length', realOtp.length);

    const TOTAL = 45; // past the documented 30-request burst
    console.log(`\nSending ${TOTAL} wrong-guess verify requests as fast as possible...`);
    const results = [];
    const start = Date.now();
    for (let i = 0; i < TOTAL; i++) {
      const wrong = String((Number(realOtp) + 1 + i) % 100000000).padStart(8, '0');
      const res = await fetch(`${SUPABASE_URL}/auth/v1/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: ANON_KEY },
        body: JSON.stringify({ type: 'recovery', email, token: wrong }),
      });
      results.push(res.status);
      if (res.status === 429) {
        const body = await res.json().catch(() => ({}));
        console.log(`  request #${i + 1}: 429 — ${JSON.stringify(body)}`);
      }
    }
    const elapsed = Date.now() - start;
    const counts = results.reduce((m, s) => (m[s] = (m[s] || 0) + 1, m), {});
    console.log(`\n${TOTAL} requests in ${elapsed}ms. Status counts:`, JSON.stringify(counts));
    const first429 = results.findIndex(s => s === 429);
    if (first429 === -1) {
      console.log(`\n*** ${TOTAL} requests all avoided 429 — either the real per-hour rate is generous enough, burst capacity is larger than documented, or the limit key isn't purely this IP for this request shape. Needs more data before concluding there's truly no limit. ***`);
    } else {
      console.log(`\nCONFIRMED: 429 first appeared at request #${first429 + 1} — matches the documented IP-based token-bucket (burst ~30). The rate limit IS real and active; the original S5 test's 15-request sample was simply under the burst threshold.`);
    }

    console.log('\n--- Sanity: is the real OTP still usable after all this? ---');
    const realCheck = await fetch(`${SUPABASE_URL}/auth/v1/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: ANON_KEY },
      body: JSON.stringify({ type: 'recovery', email, token: realOtp }),
    });
    console.log('real OTP verify status now:', realCheck.status);
  } finally {
    console.log('\nCleaning up...');
    await deleteUser(user.id);
  }
})().catch(e => { console.error('SCRIPT ERROR:', e); process.exit(1); });
