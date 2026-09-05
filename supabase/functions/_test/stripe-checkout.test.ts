// Integration tests for stripe-checkout — real local Supabase stack (auth,
// profiles' atomic checkout_pending_at check-and-set), faked Stripe API.
//
// Covers: FINDING-C's checkout_pending_at guard (PENETRATION_TEST_PLAN.md
// 4.1 — the one fix of the original 4 that had no regression test), the
// complementary already-has-an-active-subscription guard, the 15-minute
// stale-lock expiry, and auth/config validation.
//
// Requires `npx supabase start`.

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { installFakeFetch, json } from './_helpers/mod.ts';
import { createTestUser } from './_helpers/mod.ts';
import { dbAdmin } from './_helpers/mod.ts';
import { handler } from '../stripe-checkout/index.ts';

const STRIPE = 'https://api.stripe.com';

function checkoutReq(token: string | null): Request {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  return new Request('http://localhost/stripe-checkout', { method: 'POST', headers });
}

function profile(id: string) {
  return dbAdmin().from('profiles').select('checkout_pending_at, checkout_session_id').eq('id', id).single();
}

// No active Stripe customer/subscription for this user — the first guard
// (findActiveSubscription) short-circuits to "none found" without ever
// reaching subscriptions.list.
function mockNoActiveSubscription(mock: ReturnType<typeof installFakeFetch>) {
  mock.on('GET', '/v1/customers', () => json({ data: [] }));
}

function mockCheckoutSessionCreate(mock: ReturnType<typeof installFakeFetch>, id = `cs_${crypto.randomUUID()}`) {
  mock.on('POST', '/v1/checkout/sessions', () => json({ id, url: `https://checkout.stripe.com/pay/${id}` }));
  return id;
}

Deno.test('happy path: no existing lock, no active subscription -> session created, guard fields set', async () => {
  const mock = installFakeFetch();
  const user = await createTestUser({ plan: 'free' });
  try {
    mockNoActiveSubscription(mock);
    const sessionId = mockCheckoutSessionCreate(mock);

    const res = await handler(checkoutReq(user.accessToken));
    assertEquals(res.status, 200);
    const body = await res.json();
    assert(body.url.includes(sessionId));

    const { data: p } = await profile(user.id);
    assert(p!.checkout_pending_at !== null);
    assertEquals(p!.checkout_session_id, sessionId);
    assertEquals(mock.countMatching('/v1/checkout/sessions'), 1);
  } finally {
    mock.restore();
    await user.cleanup();
  }
});

Deno.test('FINDING-C: two concurrent checkout attempts from the same user -> one 200, one 409, one session', async () => {
  const mock = installFakeFetch();
  const user = await createTestUser({ plan: 'free' });
  try {
    mockNoActiveSubscription(mock);
    mockCheckoutSessionCreate(mock);

    const [a, b] = await Promise.all([
      handler(checkoutReq(user.accessToken)),
      handler(checkoutReq(user.accessToken)),
    ]);
    const statuses = [a.status, b.status].sort();
    assertEquals(statuses, [200, 409]);

    const loser = a.status === 409 ? a : b;
    assertEquals((await loser.json()).error, 'A checkout is already in progress. Please finish or cancel it before starting another.');

    // Exactly one Checkout Session was ever created with Stripe — the
    // atomic check-and-set on checkout_pending_at must reject the second
    // request BEFORE it reaches stripe.checkout.sessions.create(), not
    // after (that would double-bill on Stripe's side even if only one row
    // got recorded locally).
    assertEquals(mock.countMatching('/v1/checkout/sessions'), 1);

    const { data: p } = await profile(user.id);
    assert(p!.checkout_pending_at !== null);
    assert(p!.checkout_session_id !== null);
  } finally {
    mock.restore();
    await user.cleanup();
  }
});

Deno.test('FINDING-C: a fresh pending lock blocks a second attempt even with no in-flight race', async () => {
  const mock = installFakeFetch();
  const user = await createTestUser({
    plan: 'free',
    profile: { checkout_pending_at: new Date().toISOString(), checkout_session_id: 'cs_already_pending' },
  });
  try {
    mockNoActiveSubscription(mock);
    mockCheckoutSessionCreate(mock);

    const res = await handler(checkoutReq(user.accessToken));
    assertEquals(res.status, 409);
    assertEquals(mock.countMatching('/v1/checkout/sessions'), 0);

    const { data: p } = await profile(user.id);
    assertEquals(p!.checkout_session_id, 'cs_already_pending'); // untouched
  } finally {
    mock.restore();
    await user.cleanup();
  }
});

Deno.test('a pending lock older than 15 minutes is treated as stale and does not block', async () => {
  const mock = installFakeFetch();
  const staleAt = new Date(Date.now() - 16 * 60 * 1000).toISOString();
  const user = await createTestUser({
    plan: 'free',
    profile: { checkout_pending_at: staleAt, checkout_session_id: 'cs_abandoned' },
  });
  try {
    mockNoActiveSubscription(mock);
    const sessionId = mockCheckoutSessionCreate(mock);

    const res = await handler(checkoutReq(user.accessToken));
    assertEquals(res.status, 200);

    const { data: p } = await profile(user.id);
    assertEquals(p!.checkout_session_id, sessionId); // overwritten, guard released the stale lock
  } finally {
    mock.restore();
    await user.cleanup();
  }
});

Deno.test('an already-active Stripe subscription blocks with 409 before the pending-lock guard', async () => {
  const mock = installFakeFetch();
  const user = await createTestUser({ plan: 'free' });
  try {
    mock.on('GET', '/v1/customers', () => json({ data: [{ id: 'cus_existing', email: user.email }] }));
    mock.on('GET', '/v1/subscriptions', () => json({ data: [{ id: 'sub_1', status: 'active' }] }));
    mockCheckoutSessionCreate(mock);

    const res = await handler(checkoutReq(user.accessToken));
    assertEquals(res.status, 409);
    assertEquals((await res.json()).status, 'active');
    assertEquals(mock.countMatching('/v1/checkout/sessions'), 0);

    // The pending-lock guard never even ran — checkout_pending_at should
    // still be untouched (null), confirming the two guards are ordered
    // correctly (subscription check first, cheaper and more decisive).
    const { data: p } = await profile(user.id);
    assertEquals(p!.checkout_pending_at, null);
  } finally {
    mock.restore();
    await user.cleanup();
  }
});

Deno.test('validation: no auth header -> 401, no Stripe call, no lock taken', async () => {
  const mock = installFakeFetch();
  try {
    const res = await handler(checkoutReq(null));
    assertEquals(res.status, 401);
    assertEquals(mock.calls.length, 0);
  } finally {
    mock.restore();
  }
});

Deno.test('config: missing STRIPE_PRICE_ID -> 500, no side effects', async () => {
  const mock = installFakeFetch();
  const user = await createTestUser({ plan: 'free' });
  const saved = Deno.env.get('STRIPE_PRICE_ID')!;
  Deno.env.delete('STRIPE_PRICE_ID');
  try {
    const res = await handler(checkoutReq(user.accessToken));
    assertEquals(res.status, 500);
    assertEquals(mock.calls.length, 0);
  } finally {
    Deno.env.set('STRIPE_PRICE_ID', saved);
    mock.restore();
    await user.cleanup();
  }
});
