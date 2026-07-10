// test-delete-account-apis.mjs
//
// Standalone, disposable script — proves the two external API calls
// delete-account makes (Stripe subscription cancel, Plaid item/remove)
// actually work end-to-end. Uses Stripe TEST MODE and Plaid SANDBOX only —
// fully isolated from production. Does NOT call the deployed delete-account
// function and does NOT touch any production secret.
//
// Usage:
//   STRIPE_TEST_KEY=sk_test_... PLAID_CLIENT_ID=... PLAID_SANDBOX_SECRET=... node test-delete-account-apis.mjs

const STRIPE_TEST_KEY = process.env.STRIPE_TEST_KEY;
const PLAID_CLIENT_ID = process.env.PLAID_CLIENT_ID;
const PLAID_SANDBOX_SECRET = process.env.PLAID_SANDBOX_SECRET;

function must(name, val) {
  if (!val) { console.error(`Missing required env var: ${name}`); process.exit(1); }
  return val;
}

async function testStripe(key) {
  console.log('\n=== STRIPE — TEST MODE ===');
  if (!key.startsWith('sk_test_')) {
    console.error('STRIPE_TEST_KEY does not start with "sk_test_" — refusing to run against what might be a live key.');
    process.exit(1);
  }
  console.log('Confirmed sk_test_ key. No live Stripe data will be touched.');

  const auth = 'Basic ' + Buffer.from(key + ':').toString('base64');
  const form = (obj) => new URLSearchParams(obj);

  const custRes = await fetch('https://api.stripe.com/v1/customers', {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form({ email: 'delete-account-test@example.com', description: 'delete-account dry-run test' }),
  });
  const customer = await custRes.json();
  if (!custRes.ok) { console.error('Failed to create test customer:', customer); process.exit(1); }
  console.log('Created test customer:', customer.id);

  const prodRes = await fetch('https://api.stripe.com/v1/products', {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form({ name: 'delete-account test product' }),
  });
  const product = await prodRes.json();

  const priceRes = await fetch('https://api.stripe.com/v1/prices', {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form({ product: product.id, unit_amount: '999', currency: 'usd', 'recurring[interval]': 'month' }),
  });
  const price = await priceRes.json();

  const pmRes = await fetch('https://api.stripe.com/v1/payment_methods', {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form({ type: 'card', 'card[token]': 'tok_visa' }), // Stripe test-mode token, safe
  });
  const pm = await pmRes.json();
  await fetch(`https://api.stripe.com/v1/payment_methods/${pm.id}/attach`, {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form({ customer: customer.id }),
  });
  await fetch(`https://api.stripe.com/v1/customers/${customer.id}`, {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form({ 'invoice_settings[default_payment_method]': pm.id }),
  });

  const subRes = await fetch('https://api.stripe.com/v1/subscriptions', {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form({ customer: customer.id, 'items[0][price]': price.id }),
  });
  const subscription = await subRes.json();
  if (!subRes.ok) { console.error('Failed to create test subscription:', subscription); process.exit(1); }
  console.log('Created test subscription:', subscription.id, 'status:', subscription.status);

  // Mirror delete-account's exact logic: list({customer, status:'all'}) → filter → cancel
  const listRes = await fetch(`https://api.stripe.com/v1/subscriptions?customer=${customer.id}&status=all`, {
    headers: { Authorization: auth },
  });
  const list = await listRes.json();
  console.log(`subscriptions.list found ${list.data.length} subscription(s):`);
  for (const sub of list.data) {
    const wouldCancel = ['active', 'trialing', 'past_due'].includes(sub.status);
    console.log(`  - ${sub.id} status=${sub.status} would_cancel=${wouldCancel}`);
    if (wouldCancel) {
      const cancelRes = await fetch(`https://api.stripe.com/v1/subscriptions/${sub.id}`, {
        method: 'DELETE',
        headers: { Authorization: auth },
      });
      const cancelled = await cancelRes.json();
      console.log(`    -> cancel result: status=${cancelled.status} (expect "canceled")`);
    }
  }
  console.log('Test customer/subscription left in your Stripe TEST MODE dashboard — delete manually if you want, no cost either way.');
}

async function testPlaid(clientId, secret) {
  console.log('\n=== PLAID — SANDBOX ===');
  const base = 'https://sandbox.plaid.com';
  console.log(`Using ${base} — a production secret will simply be rejected here, it cannot touch real data.`);

  const ptRes = await fetch(`${base}/sandbox/public_token/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      secret,
      institution_id: 'ins_109508', // Plaid's sandbox test institution ("First Platypus Bank")
      initial_products: ['transactions'],
    }),
  });
  const pt = await ptRes.json();
  if (!ptRes.ok) { console.error('sandbox/public_token/create failed:', pt); process.exit(1); }
  console.log('Created sandbox public_token.');

  const exRes = await fetch(`${base}/item/public_token/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, secret, public_token: pt.public_token }),
  });
  const ex = await exRes.json();
  if (!exRes.ok) { console.error('item/public_token/exchange failed:', ex); process.exit(1); }
  console.log('Exchanged for access_token, item_id:', ex.item_id);

  // Mirror delete-account's exact logic: /item/remove — success is res.ok
  // with no error_code, NOT a "removed" boolean (that field only existed in
  // Plaid API versions 2019-05-29 and earlier; current versions return just
  // request_id on success).
  const rmRes = await fetch(`${base}/item/remove`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, secret, access_token: ex.access_token }),
  });
  const rm = await rmRes.json();
  console.log('item/remove response:', rm);
  const succeeded = rmRes.ok && !rm?.error_code;
  console.log(succeeded ? 'SUCCESS: res.ok and no error_code (matches delete-account\'s check)' : 'FAILED: see response above');
}

(async () => {
  console.log('delete-account API contract test — TEST MODE / SANDBOX ONLY. No production secrets used, no deployed function called.');
  const key    = must('STRIPE_TEST_KEY', STRIPE_TEST_KEY);
  const cid    = must('PLAID_CLIENT_ID', PLAID_CLIENT_ID);
  const secret = must('PLAID_SANDBOX_SECRET', PLAID_SANDBOX_SECRET);

  await testStripe(key);
  await testPlaid(cid, secret);

  console.log('\nAll checks complete.');
})();
