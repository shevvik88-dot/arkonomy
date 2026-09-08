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
import postgres from 'npm:postgres@3';
import { installFakeFetch, json } from './_helpers/mod.ts';
import { createTestUser } from './_helpers/mod.ts';
import { dbAdmin } from './_helpers/mod.ts';
import { localConfig } from './_helpers/mod.ts';
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

// stripe.checkout.sessions.retrieve(id) -> GET /v1/checkout/sessions/{id}
function mockCheckoutSessionRetrieve(mock: ReturnType<typeof installFakeFetch>, id: string, status: string) {
  mock.on('GET', (u) => u.pathname === `/v1/checkout/sessions/${id}`, () =>
    json({ id, status, url: `https://checkout.stripe.com/pay/${id}` }));
}

// Count only genuine new-session creations — POST to exactly
// /v1/checkout/sessions. mock.countMatching() is a substring match, so it
// also counts the GET /v1/checkout/sessions/{id} verification retrieves the
// session-reuse tests mock (and the Stripe SDK's automatic retry of a
// failed GET), which would make "no new session created" assertions flaky.
function newSessionsCreated(mock: ReturnType<typeof installFakeFetch>): number {
  return mock.calls.filter(
    (c) => c.method === 'POST' && new URL(c.url).pathname === '/v1/checkout/sessions',
  ).length;
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
    assertEquals(newSessionsCreated(mock), 1);
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
    assertEquals(newSessionsCreated(mock), 1);

    const { data: p } = await profile(user.id);
    assert(p!.checkout_pending_at !== null);
    assert(p!.checkout_session_id !== null);
  } finally {
    mock.restore();
    await user.cleanup();
  }
});

Deno.test('FINDING-C: a fresh checkout_pending_at with no session id yet blocks a concurrent second attempt', async () => {
  // The narrower window the local mutex still covers post-fix: an attempt
  // that acquired the lock but crashed before ever creating/storing a
  // Stripe session id at all — nothing to verify with Stripe yet, so this
  // must still be a plain time-based mutex.
  const mock = installFakeFetch();
  const user = await createTestUser({
    plan: 'free',
    profile: { checkout_pending_at: new Date().toISOString(), checkout_session_id: null },
  });
  try {
    mockNoActiveSubscription(mock);
    mockCheckoutSessionCreate(mock);

    const res = await handler(checkoutReq(user.accessToken));
    assertEquals(res.status, 409);
    assertEquals(newSessionsCreated(mock), 0);
  } finally {
    mock.restore();
    await user.cleanup();
  }
});

Deno.test('independent audit 2026-09-07: a still-open prior session is reused, not duplicated, regardless of lock age', async () => {
  // The old bug: once checkout_pending_at aged past its fixed 15-minute
  // TTL, a second attempt could mint a brand new session while the first
  // (created up to 24h earlier) was still perfectly completable — two live
  // sessions, two possible subscriptions. The lock here is already stale
  // by the old time-based rule; only the Stripe-verified status decides now.
  const mock = installFakeFetch();
  const staleAt = new Date(Date.now() - 16 * 60 * 1000).toISOString();
  const user = await createTestUser({
    plan: 'free',
    profile: { checkout_pending_at: staleAt, checkout_session_id: 'cs_still_open' },
  });
  try {
    mockNoActiveSubscription(mock);
    mockCheckoutSessionRetrieve(mock, 'cs_still_open', 'open');
    mockCheckoutSessionCreate(mock); // must NOT be called

    const res = await handler(checkoutReq(user.accessToken));
    assertEquals(res.status, 200);
    const body = await res.json();
    assert(body.url.includes('cs_still_open'));
    assertEquals(newSessionsCreated(mock), 0); // no new session created

    const { data: p } = await profile(user.id);
    assertEquals(p!.checkout_session_id, 'cs_still_open'); // untouched
  } finally {
    mock.restore();
    await user.cleanup();
  }
});

Deno.test('independent audit 2026-09-07: a Stripe-confirmed-closed prior session releases the guard and lets a new checkout through', async () => {
  const mock = installFakeFetch();
  // Local lock still looks "fresh" by the old time-based rule — must not
  // matter once Stripe confirms the session itself is done.
  const user = await createTestUser({
    plan: 'free',
    profile: { checkout_pending_at: new Date().toISOString(), checkout_session_id: 'cs_abandoned' },
  });
  try {
    mockNoActiveSubscription(mock);
    mockCheckoutSessionRetrieve(mock, 'cs_abandoned', 'expired');
    const sessionId = mockCheckoutSessionCreate(mock);

    const res = await handler(checkoutReq(user.accessToken));
    assertEquals(res.status, 200);
    assertEquals(newSessionsCreated(mock), 1); // exactly one new session

    const { data: p } = await profile(user.id);
    assertEquals(p!.checkout_session_id, sessionId); // replaced, not the old id
  } finally {
    mock.restore();
    await user.cleanup();
  }
});

Deno.test('independent audit 2026-09-07: a network failure verifying the prior session fails closed (no new session)', async () => {
  const mock = installFakeFetch();
  const user = await createTestUser({
    plan: 'free',
    profile: { checkout_pending_at: null, checkout_session_id: 'cs_unverifiable' },
  });
  try {
    mockNoActiveSubscription(mock);
    mock.on('GET', (u) => u.pathname === '/v1/checkout/sessions/cs_unverifiable', () => json({ error: { message: 'down' } }, { status: 500 }));
    mockCheckoutSessionCreate(mock); // must NOT be called

    const res = await handler(checkoutReq(user.accessToken));
    assertEquals(res.status, 500);
    assertEquals(newSessionsCreated(mock), 0);
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
    assertEquals(newSessionsCreated(mock), 0);

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

// ── independent audit follow-up 2026-09-08: the two write-failure paths
// 0ee0bfc added (profile read before the reuse check; checkout_session_id
// write after the session is live) had no automated coverage — the handoff
// called them out as review-only. Forced here at the DB. A column-level
// REVOKE is a no-op while the table-level privilege is held (Postgres
// semantics), so: block the SELECT by revoking it table-wide (the profile
// read is the first thing that touches profiles), and block just the
// checkout_session_id write with a column-scoped BEFORE UPDATE trigger so
// the mutex UPDATE on checkout_pending_at still goes through. Deno runs
// test files sequentially, so nothing else hits profiles in the window.

async function withProfileSelectDenied(fn: () => Promise<void>) {
  const sql = postgres(localConfig.dbUrl, { max: 1 });
  try {
    await sql.unsafe(`REVOKE SELECT ON public.profiles FROM service_role`);
    try { await fn(); }
    finally { await sql.unsafe(`GRANT SELECT ON public.profiles TO service_role`); }
  } finally {
    await sql.end();
  }
}

async function withCheckoutSessionIdWriteBlocked(fn: () => Promise<void>) {
  const sql = postgres(localConfig.dbUrl, { max: 1 });
  try {
    await sql.unsafe(`
      CREATE OR REPLACE FUNCTION _test_block_session_id() RETURNS trigger
        LANGUAGE plpgsql AS $fn$
      BEGIN
        IF NEW.checkout_session_id IS DISTINCT FROM OLD.checkout_session_id THEN
          RAISE EXCEPTION 'checkout_session_id write blocked for test';
        END IF;
        RETURN NEW;
      END $fn$;
      CREATE TRIGGER _test_block_session_id BEFORE UPDATE ON public.profiles
        FOR EACH ROW EXECUTE FUNCTION _test_block_session_id();
    `);
    try { await fn(); }
    finally {
      await sql.unsafe(`
        DROP TRIGGER IF EXISTS _test_block_session_id ON public.profiles;
        DROP FUNCTION IF EXISTS _test_block_session_id();
      `);
    }
  } finally {
    await sql.end();
  }
}

Deno.test('audit 2026-09-08: a failed profile read before the reuse check fails closed — 500, no session, no lock', async () => {
  const mock = installFakeFetch();
  const user = await createTestUser({ plan: 'free' });
  try {
    mockNoActiveSubscription(mock);
    mockCheckoutSessionCreate(mock); // must NOT be reached

    await withProfileSelectDenied(async () => {
      const res = await handler(checkoutReq(user.accessToken));
      assertEquals(res.status, 500);
    });

    assertEquals(newSessionsCreated(mock), 0);
    const { data: p } = await profile(user.id);
    assertEquals(p!.checkout_pending_at, null); // the mutex was never acquired
    assertEquals(p!.checkout_session_id, null);
  } finally {
    mock.restore();
    await user.cleanup();
  }
});

Deno.test('audit 2026-09-08: a failed checkout_session_id write expires the orphaned session, releases the lock, and 500s', async () => {
  const mock = installFakeFetch();
  const user = await createTestUser({ plan: 'free' });
  try {
    mockNoActiveSubscription(mock);
    const sessionId = mockCheckoutSessionCreate(mock);
    let expired = false;
    mock.on('POST', (u) => u.pathname === `/v1/checkout/sessions/${sessionId}/expire`, () => {
      expired = true;
      return json({ id: sessionId, status: 'expired' });
    });

    await withCheckoutSessionIdWriteBlocked(async () => {
      const res = await handler(checkoutReq(user.accessToken));
      assertEquals(res.status, 500);
    });

    // It DID create a live session (the mutex was acquired, Stripe call
    // made) — then, unable to record it, expired it and backed everything
    // out rather than hand back an untracked, still-payable URL.
    assertEquals(newSessionsCreated(mock), 1);
    assertEquals(expired, true);
    const { data: p } = await profile(user.id);
    assertEquals(p!.checkout_pending_at, null);  // mutex released for a clean retry
    assertEquals(p!.checkout_session_id, null);  // nothing stored
  } finally {
    mock.restore();
    await user.cleanup();
  }
});
