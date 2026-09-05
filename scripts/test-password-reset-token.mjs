// test-password-reset-token.mjs — PENETRATION_TEST_PLAN.md 1.4
//
// Disposable Supabase Auth account only (see _lib-disposable-account.mjs).
// Uses the Admin API's generate_link (type: 'recovery') to get the exact
// same kind of token AuthScreen.jsx's resetPasswordForEmail() would email
// to the user, without needing real inbox access — the Admin API returns
// the token/hashed_token/action_link directly. Inspects its shape, then
// verifies it once (single-use check) and attempts a second verification
// (replay check).

import {
  disposableEmail, randomPassword, createDisposableUser, deleteUser,
  generateLink, verifyOtp, redact, SUPABASE_URL, ANON_KEY,
} from './_lib-disposable-account.mjs';

(async () => {
  const email = disposableEmail('1-4');
  const password = randomPassword();
  console.log('Creating disposable account:', email);
  const user = await createDisposableUser(email, password);
  console.log('Created user id:', user.id);

  try {
    console.log('\n--- Step 1: generate a recovery link (same token type as resetPasswordForEmail) ---');
    const link = await generateLink('recovery', email);
    console.log('status:', link.status);
    if (link.status !== 200) throw new Error('generate_link failed: ' + JSON.stringify(link.body));

    const props = link.body.properties ?? link.body;
    console.log('Response keys:', Object.keys(link.body));
    console.log('properties keys:', Object.keys(props));

    const tokenHash = props.hashed_token;
    const emailOtp = props.email_otp;
    console.log('hashed_token:', redact(tokenHash));
    console.log('hashed_token length:', tokenHash?.length, '| charset sample check (hex-like?):', /^[a-f0-9]+$/i.test(tokenHash ?? ''));
    if (emailOtp) {
      console.log('email_otp (the short code, if this project shows one):', emailOtp, '| length:', emailOtp.length, '| numeric-only:', /^\d+$/.test(emailOtp));
    } else {
      console.log('No separate short email_otp field returned — token is the hashed_token/link form only.');
    }
    console.log('verification_type:', props.verification_type);
    console.log('redirect_to:', props.redirect_to);
    // Look for any expiry-related field GoTrue includes.
    for (const k of Object.keys(link.body)) {
      if (/expire|expiry|exp/i.test(k)) console.log(`expiry field found: ${k} =`, link.body[k]);
    }
    for (const k of Object.keys(props)) {
      if (/expire|expiry|exp/i.test(k)) console.log(`expiry field found (properties): ${k} =`, props[k]);
    }

    console.log('\n--- Step 2: verify the token once (expect success) ---');
    const v1 = await verifyOtp('recovery', tokenHash);
    console.log('status:', v1.status);
    if (v1.status !== 200) throw new Error('first verify failed: ' + JSON.stringify(v1.body));
    console.log('Verify succeeded, got session for user:', v1.body.user?.id === user.id);

    console.log('\n--- Step 3: replay the SAME token_hash a second time (expect rejection, single-use) ---');
    const v2 = await verifyOtp('recovery', tokenHash);
    console.log('status:', v2.status);
    console.log('body:', JSON.stringify(v2.body));
    if (v2.status === 200) {
      console.log('\n*** FINDING: recovery token was accepted a second time — not single-use. ***');
    } else {
      console.log('\nPASS: recovery token rejected on replay — single-use enforced.');
    }

    console.log('\n--- Step 4: is the short numeric email_otp independently exploitable via email+token (not the hashed_token/link)? ---');
    console.log('Generating a FRESH recovery link to get a fresh, unused email_otp...');
    const link2 = await generateLink('recovery', email);
    const props2 = link2.body.properties ?? link2.body;
    const otp2 = props2.email_otp;
    console.log('fresh email_otp:', otp2, '(this is what a brute-forcer would be guessing)');

    console.log('\nAttempting /auth/v1/verify with { type: recovery, email, token: <8-digit otp> } directly (bypassing hashed_token entirely)...');
    const res = await fetch(`${SUPABASE_URL}/auth/v1/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: ANON_KEY },
      body: JSON.stringify({ type: 'recovery', email, token: otp2 }),
    });
    const body = await res.json();
    console.log('status:', res.status);
    console.log('body:', JSON.stringify(body));
    if (res.status === 200) {
      console.log('\nConfirmed: the 8-digit numeric code alone (with email) is a valid, independent path to a session — not just a display artifact. Now checking whether a WRONG guess is rate-limited...');
      // We already consumed otp2, so do the brute-force-shape check on a freshly
      // generated (still-valid) OTP without consuming it — fire N wrong guesses
      // first, then confirm the real one still works afterward (proves wrong
      // guesses aren't burning attempts against a lockout that would otherwise
      // protect it, and there's no throttle slowing a brute-force campaign down).
      const link3 = await generateLink('recovery', email);
      const otp3 = (link3.body.properties ?? link3.body).email_otp;
      console.log('\nFresh OTP for brute-force-shape probe (not printed in full — only used programmatically):', redact(otp3));
      const wrongGuesses = 15;
      let rejectedCount = 0;
      const start = Date.now();
      for (let i = 0; i < wrongGuesses; i++) {
        const wrong = String((Number(otp3) + 1 + i) % 100000000).padStart(8, '0');
        const r = await fetch(`${SUPABASE_URL}/auth/v1/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: ANON_KEY },
          body: JSON.stringify({ type: 'recovery', email, token: wrong }),
        });
        if (r.status !== 200) rejectedCount++;
      }
      const elapsedMs = Date.now() - start;
      console.log(`${wrongGuesses} wrong guesses sent in ${elapsedMs}ms (${(elapsedMs / wrongGuesses).toFixed(0)}ms/req avg), ${rejectedCount}/${wrongGuesses} rejected as expected.`);
      const verifyReal = await fetch(`${SUPABASE_URL}/auth/v1/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: ANON_KEY },
        body: JSON.stringify({ type: 'recovery', email, token: otp3 }),
      });
      console.log('Real OTP still works after 15 wrong guesses:', verifyReal.status === 200, '(status ' + verifyReal.status + ')');
      if (verifyReal.status === 200 && rejectedCount === wrongGuesses) {
        console.log('\n*** FINDING: no lockout/rate-limit observed on /auth/v1/verify wrong-guess attempts for an 8-digit numeric recovery code — this endpoint is NOT covered by auth-login\'s check_login_lockout (that RPC is only called from the auth-login edge function, not from GoTrue\'s own /verify endpoint). 8 digits = 10^8 = 100,000,000 possibilities; at the observed per-request latency this is impractical to brute-force serially from one IP within a short TTL, but there is no structural throttle stopping a distributed/parallel attempt, and this needs to be weighed against the token\'s actual TTL (see recovery_sent_at / project OTP-expiry setting, not returned directly in this response). ***');
      }
    } else {
      console.log('\nThe short numeric code alone was NOT accepted independently — recovery is only completable via the full hashed_token/action_link, which has 224 bits of entropy (56 hex chars) and is not brute-forceable. The email_otp field is either unused by this flow or requires additional context this test didn\'t supply.');
    }
  } finally {
    console.log('\nCleaning up disposable account...');
    const delStatus = await deleteUser(user.id);
    console.log('delete status:', delStatus);
  }
})().catch(e => { console.error('SCRIPT ERROR:', e); process.exit(1); });
