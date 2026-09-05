// test-password-change-post-rebase-2026-09-05.mjs
//
// Post-rebase re-verification of the current_password fix
// (security/password-change-and-s5, merged onto latest main 2026-09-05)
// against the LIVE Supabase project, before opening the PR.
//
// Disposable Supabase Auth account only (see _lib-disposable-account.mjs) —
// never the real personal account. Exercises the exact call
// Profile.jsx's handleChangePassword now makes:
//   supabase.auth.updateUser({ password, current_password })
//
// Expected: password change -> 200, sign-in with the NEW password -> 200,
// sign-in with the OLD password -> 400 (rejected, old password dead).

import {
  disposableEmail, randomPassword, createDisposableUser, deleteUser,
  passwordSignIn, updateUserPassword,
} from './_lib-disposable-account.mjs';

(async () => {
  const email = disposableEmail('rebase-verify');
  const oldPassword = randomPassword();
  console.log('Creating disposable account:', email);
  const user = await createDisposableUser(email, oldPassword);
  console.log('Created user id:', user.id);

  let allPassed = true;

  try {
    console.log('\n--- Step 1: sign in with the initial password (sanity check) ---');
    const signIn0 = await passwordSignIn(email, oldPassword);
    console.log('sign-in status:', signIn0.status);
    if (signIn0.status !== 200) throw new Error('initial sign-in failed: ' + JSON.stringify(signIn0.body));
    const accessToken = signIn0.body.access_token;

    console.log('\n--- Step 2: change password via the exact Profile.jsx shape (password + current_password) ---');
    const newPassword = randomPassword();
    const changeRes = await updateUserPassword(accessToken, newPassword, oldPassword);
    console.log('updateUser status:', changeRes.status);
    console.log('body:', JSON.stringify(changeRes.body));
    const step2Pass = changeRes.status === 200;
    console.log(step2Pass ? 'PASS: password change -> 200' : 'FAIL: expected 200');
    allPassed &&= step2Pass;

    console.log('\n--- Step 3: sign in with the NEW password ---');
    const signInNew = await passwordSignIn(email, newPassword);
    console.log('sign-in (new password) status:', signInNew.status);
    const step3Pass = signInNew.status === 200;
    console.log(step3Pass ? 'PASS: new password -> 200' : 'FAIL: expected 200');
    allPassed &&= step3Pass;

    console.log('\n--- Step 4: sign in with the OLD password (must be dead) ---');
    const signInOld = await passwordSignIn(email, oldPassword);
    console.log('sign-in (old password) status:', signInOld.status, JSON.stringify(signInOld.body));
    const step4Pass = signInOld.status === 400;
    console.log(step4Pass ? 'PASS: old password -> 400' : 'FAIL: expected 400');
    allPassed &&= step4Pass;

    console.log('\n=== RESULT:', allPassed ? 'ALL PASS' : 'FAILED', '===');
    if (!allPassed) process.exitCode = 1;
  } finally {
    console.log('\nCleaning up disposable account...');
    const delStatus = await deleteUser(user.id);
    console.log('delete status:', delStatus);
  }
})().catch(e => { console.error('SCRIPT ERROR:', e); process.exit(1); });
