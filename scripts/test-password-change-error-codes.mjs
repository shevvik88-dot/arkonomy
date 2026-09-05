// test-password-change-error-codes.mjs — probes exact GoTrue error codes for
// the Profile.jsx password-change fix, so the UI maps real codes instead of
// guessing. Disposable account only.

import {
  disposableEmail, randomPassword, createDisposableUser, deleteUser,
  passwordSignIn, updateUserPassword,
} from './_lib-disposable-account.mjs';

(async () => {
  const email = disposableEmail('pw-errs');
  const password = randomPassword();
  const user = await createDisposableUser(email, password);
  console.log('Created user id:', user.id);
  try {
    const signIn = await passwordSignIn(email, password);
    const access = signIn.body.access_token;

    console.log('\n--- Wrong current_password ---');
    const wrong = await updateUserPassword(access, randomPassword(), 'definitely-wrong-' + randomPassword());
    console.log('status:', wrong.status, 'body:', JSON.stringify(wrong.body));

    console.log('\n--- Correct current_password, but new === current ---');
    const same = await updateUserPassword(access, password, password);
    console.log('status:', same.status, 'body:', JSON.stringify(same.body));

    console.log('\n--- Correct current_password, weak new password (too short) ---');
    const weak = await updateUserPassword(access, 'a', password);
    console.log('status:', weak.status, 'body:', JSON.stringify(weak.body));

    console.log('\n--- Missing current_password entirely (baseline, already known) ---');
    const missing = await updateUserPassword(access, randomPassword());
    console.log('status:', missing.status, 'body:', JSON.stringify(missing.body));
  } finally {
    console.log('\nCleaning up...');
    await deleteUser(user.id);
  }
})().catch(e => { console.error('SCRIPT ERROR:', e); process.exit(1); });
