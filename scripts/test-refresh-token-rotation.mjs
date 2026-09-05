// test-refresh-token-rotation.mjs — PENETRATION_TEST_PLAN.md 1.2
//
// Uses a disposable Supabase Auth account (never the real personal
// account — see _lib-disposable-account.mjs header). Logs in once to get
// a real session, uses the refresh token once, then tries to replay the
// original (now-superseded) refresh token and expects rejection.

import {
  disposableEmail, randomPassword, createDisposableUser, deleteUser,
  passwordSignIn, refreshToken, redact,
} from './_lib-disposable-account.mjs';

(async () => {
  const email = disposableEmail('1-2');
  const password = randomPassword();
  console.log('Creating disposable account:', email);
  const user = await createDisposableUser(email, password);
  console.log('Created user id:', user.id);

  try {
    console.log('\n--- Step 1: password sign-in (S1) ---');
    const signIn = await passwordSignIn(email, password);
    console.log('status:', signIn.status);
    if (signIn.status !== 200) throw new Error('sign-in failed: ' + JSON.stringify(signIn.body));
    const s1AccessToken = signIn.body.access_token;
    const s1RefreshToken = signIn.body.refresh_token;
    console.log('S1 access_token:', redact(s1AccessToken));
    console.log('S1 refresh_token:', redact(s1RefreshToken));

    console.log('\n--- Step 2: use S1 refresh_token once (expect new pair S2) ---');
    const r1 = await refreshToken(s1RefreshToken);
    console.log('status:', r1.status);
    if (r1.status !== 200) throw new Error('first refresh failed: ' + JSON.stringify(r1.body));
    const s2AccessToken = r1.body.access_token;
    const s2RefreshToken = r1.body.refresh_token;
    console.log('S2 access_token:', redact(s2AccessToken));
    console.log('S2 refresh_token:', redact(s2RefreshToken));
    console.log('S1 and S2 refresh tokens differ:', s1RefreshToken !== s2RefreshToken);

    console.log('\n--- Step 3: replay original S1 refresh_token IMMEDIATELY (expect rejection, or grace-window echo of S2) ---');
    const r2 = await refreshToken(s1RefreshToken);
    console.log('status:', r2.status);
    const r2RefreshToken = r2.body?.refresh_token;
    console.log('replay returned refresh_token:', redact(r2RefreshToken));
    if (r2.status === 200 && r2RefreshToken === s2RefreshToken) {
      console.log('Replay returned the SAME pair as S2 — consistent with a short "reuse interval" grace window (retry-safety), not a fresh new session. Not itself a vulnerability.');
    } else if (r2.status === 200 && r2RefreshToken !== s2RefreshToken) {
      console.log('\n*** FINDING: replay minted a THIRD, distinct refresh token (neither S1 nor S2) — an old superseded refresh token can be used to keep generating unlimited new valid sessions. This is a real rotation failure, not grace-window tolerance. ***');
    } else {
      console.log('\nPASS: superseded refresh token rejected immediately (status ' + r2.status + ') — rotation enforced with no grace window.');
    }

    console.log('\n--- Step 4: does replay revoke the whole session? try S2 refresh_token now ---');
    const r3 = await refreshToken(s2RefreshToken);
    console.log('status:', r3.status);
    if (r3.status === 200) {
      console.log('S2 refresh_token still valid after the S1 replay attempt (replay did not cascade-revoke the family).');
    } else {
      console.log('*** S2 refresh_token also rejected after the S1 replay attempt — reuse detection revoked the whole token family (stricter, and worth documenting as the actual behavior). ***');
      console.log('body:', JSON.stringify(r3.body));
    }

    console.log('\n--- Step 5: wait 15s past any plausible reuse-interval grace window, then replay S1 refresh_token AGAIN ---');
    await new Promise(r => setTimeout(r, 15000));
    const r4 = await refreshToken(s1RefreshToken);
    console.log('status:', r4.status);
    const r4RefreshToken = r4.body?.refresh_token;
    console.log('body refresh_token:', redact(r4RefreshToken));
    if (r4.status === 200) {
      console.log('\n*** FINDING: S1 refresh_token STILL works 15s later, well past any short grace window — this is not reuse-interval tolerance, rotation/replay-detection is not enforced at all. A leaked-but-superseded refresh token remains replayable indefinitely. ***');
    } else {
      console.log('\nPASS: after the grace window, the superseded S1 refresh_token is now rejected (status ' + r4.status + ') — confirms Step 3 was grace-window tolerance, not a broken rotation.');
    }
  } finally {
    console.log('\nCleaning up disposable account...');
    const delStatus = await deleteUser(user.id);
    console.log('delete status:', delStatus);
  }
})().catch(e => { console.error('SCRIPT ERROR:', e); process.exit(1); });
