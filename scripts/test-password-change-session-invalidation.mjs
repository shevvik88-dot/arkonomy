// test-password-change-session-invalidation.mjs — PENETRATION_TEST_PLAN.md 1.3
//
// Disposable Supabase Auth account only (see _lib-disposable-account.mjs).
// Creates two independent sessions (A and B) for the same disposable user,
// changes the password from session A (same call Profile.jsx's
// handleChangePassword makes: supabase.auth.updateUser({ password })),
// then checks whether session B's access token and refresh token still
// work afterward.

import {
  disposableEmail, randomPassword, createDisposableUser, deleteUser,
  passwordSignIn, refreshToken, getUser, updateUserPassword, redact,
} from './_lib-disposable-account.mjs';

(async () => {
  const email = disposableEmail('1-3');
  const password = randomPassword();
  console.log('Creating disposable account:', email);
  const user = await createDisposableUser(email, password);
  console.log('Created user id:', user.id);

  try {
    console.log('\n--- Step 1: two independent sign-ins (session A, session B) ---');
    const signInA = await passwordSignIn(email, password);
    const signInB = await passwordSignIn(email, password);
    console.log('A status:', signInA.status, 'B status:', signInB.status);
    if (signInA.status !== 200 || signInB.status !== 200) {
      throw new Error('sign-in failed: ' + JSON.stringify({ a: signInA.body, b: signInB.body }));
    }
    const A = { access: signInA.body.access_token, refresh: signInA.body.refresh_token };
    const B = { access: signInB.body.access_token, refresh: signInB.body.refresh_token };
    console.log('A access:', redact(A.access), '| B access:', redact(B.access));
    console.log('Sessions are distinct (different access tokens):', A.access !== B.access);

    console.log('\n--- Step 2: sanity check — B works before password change ---');
    const beforeB = await getUser(B.access);
    console.log('GET /user with B access_token status (before):', beforeB.status);

    console.log('\n--- Step 3a: change password FROM session A, EXACTLY as Profile.jsx does it (no current_password field) ---');
    const newPassword = randomPassword();
    const bareChangeRes = await updateUserPassword(A.access, newPassword);
    console.log('updateUser status (bare, matches Profile.jsx code):', bareChangeRes.status);
    console.log('body:', JSON.stringify(bareChangeRes.body));
    if (bareChangeRes.status !== 200) {
      console.log('\n*** FINDING: the exact call Profile.jsx makes (supabase.auth.updateUser({ password })) fails live with this project\'s current Auth settings. Password change is broken for real users, independent of the 1.3 session-invalidation question. ***');
    }

    console.log('\n--- Step 3b: retry WITH current_password, to unblock the rest of the 1.3 test ---');
    const changeRes = await updateUserPassword(A.access, newPassword, password);
    console.log('updateUser status (with current_password):', changeRes.status);
    if (changeRes.status !== 200) throw new Error('password change failed even with current_password: ' + JSON.stringify(changeRes.body));
    console.log('Password changed successfully from session A (using current_password).');

    console.log('\n--- Step 4: is session B\'s ACCESS token still accepted? ---');
    const afterB = await getUser(B.access);
    console.log('GET /user with B access_token status (after):', afterB.status);
    if (afterB.status === 200) {
      console.log('B access token still authenticates post-change (expected for stateless JWTs until natural expiry — not itself the finding).');
    } else {
      console.log('B access token rejected post-change — access tokens are being actively revoked, not just left to expire.');
    }

    console.log('\n--- Step 5: is session B\'s REFRESH token still usable to mint a new access token? (the real test) ---');
    const refreshB = await refreshToken(B.refresh);
    console.log('refresh B status:', refreshB.status);
    console.log('body:', JSON.stringify(refreshB.body));
    if (refreshB.status === 200) {
      console.log('\n*** FINDING: session B could still refresh and obtain a new access token AFTER the password change from session A. Password change does NOT invalidate other sessions. ***');
    } else {
      console.log('\nPASS: session B\'s refresh token was rejected after the password change from session A — other sessions are invalidated.');
    }

    console.log('\n--- Step 6: sanity — session A itself still works with the NEW password ---');
    const reSignInA = await passwordSignIn(email, newPassword);
    console.log('re-sign-in with new password status:', reSignInA.status);
  } finally {
    console.log('\nCleaning up disposable account...');
    const delStatus = await deleteUser(user.id);
    console.log('delete status:', delStatus);
  }
})().catch(e => { console.error('SCRIPT ERROR:', e); process.exit(1); });
