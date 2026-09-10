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
  return dbAdmin().from('profiles').select('checkout_pending_at, checkout_session_id, checkout_attempt_key').eq('id', id).single();
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
function mockCheckoutSessionRetrieve(
  mock: ReturnType<typeof installFakeFetch>,
  id: string,
  status: string,
  extra: Record<string, unknown> = {},
) {
  mock.on('GET', (u) => u.pathname === `/v1/checkout/sessions/${id}`, () =>
    json({ id, status, url: `https://checkout.stripe.com/pay/${id}`, ...extra }));
}

// stripe.subscriptions.retrieve(id) -> GET /v1/subscriptions/{id}
function mockSubscriptionRetrieve(mock: ReturnType<typeof installFakeFetch>, id: string, status: string) {
  mock.on('GET', (u) => u.pathname === `/v1/subscriptions/${id}`, () => json({ id, status }));
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

Deno.test('audit 2026-09-08 (rev: item 3): a failed checkout_session_id write 500s but keeps the mutex + idempotency key for the retry', async () => {
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

    // It created a live session, couldn't record its id, and 500s — but no
    // longer expires it: the retry re-creates under the SAME idempotency
    // key and Stripe hands back this exact session, which the retry then
    // records. Blowing it away would just cost the user a round-trip.
    assertEquals(newSessionsCreated(mock), 1);
    assertEquals(expired, false);
    const { data: p } = await profile(user.id);
    assert(p!.checkout_pending_at !== null);       // mutex retained for the reconciling retry
    assert(p!.checkout_attempt_key !== null);      // ...and so is the attempt identity
    assertEquals(p!.checkout_session_id, null);    // write was blocked
  } finally {
    mock.restore();
    await user.cleanup();
  }
});

// ── independent review of #97, P1a: Checkout A completes in the window
// between request B's findActiveSubscription and its retrieve(A). B must
// NOT mint a second session — 'complete' is not 'abandoned'.

Deno.test('review #97 P1a: a prior session that COMPLETED between the sub-check and retrieve blocks a new checkout (409, no new session)', async () => {
  const mock = installFakeFetch();
  const user = await createTestUser({
    plan: 'free',
    profile: { checkout_pending_at: new Date().toISOString(), checkout_session_id: 'cs_A' },
  });
  try {
    mockNoActiveSubscription(mock);                       // sub not visible yet (webhook lag)
    mockCheckoutSessionRetrieve(mock, 'cs_A', 'complete'); // ...but A already completed
    mockCheckoutSessionCreate(mock);                       // must NOT be called

    const res = await handler(checkoutReq(user.accessToken));
    assertEquals(res.status, 409);
    assertEquals((await res.json()).error, 'checkout_already_completed');
    assertEquals(newSessionsCreated(mock), 0);

    const { data: p } = await profile(user.id);
    assertEquals(p!.checkout_session_id, 'cs_A'); // guard not released
  } finally {
    mock.restore();
    await user.cleanup();
  }
});

Deno.test('review #97 P1a: a COMPLETED session whose subscription is itself already cancelled does let a fresh checkout through', async () => {
  const mock = installFakeFetch();
  const user = await createTestUser({
    plan: 'free',
    profile: { checkout_pending_at: new Date().toISOString(), checkout_session_id: 'cs_A' },
  });
  try {
    mockNoActiveSubscription(mock);
    mockCheckoutSessionRetrieve(mock, 'cs_A', 'complete', { subscription: 'sub_dead' });
    mockSubscriptionRetrieve(mock, 'sub_dead', 'canceled');
    const newId = mockCheckoutSessionCreate(mock);

    const res = await handler(checkoutReq(user.accessToken));
    assertEquals(res.status, 200);
    assertEquals(newSessionsCreated(mock), 1);
    const { data: p } = await profile(user.id);
    assertEquals(p!.checkout_session_id, newId);
  } finally {
    mock.restore();
    await user.cleanup();
  }
});

Deno.test('review #97 P1a: an EXPIRED prior session still releases the guard and lets a new checkout through', async () => {
  const mock = installFakeFetch();
  const user = await createTestUser({
    plan: 'free',
    profile: { checkout_pending_at: new Date().toISOString(), checkout_session_id: 'cs_A' },
  });
  try {
    mockNoActiveSubscription(mock);
    mockCheckoutSessionRetrieve(mock, 'cs_A', 'expired');
    const newId = mockCheckoutSessionCreate(mock);

    const res = await handler(checkoutReq(user.accessToken));
    assertEquals(res.status, 200);
    assertEquals(newSessionsCreated(mock), 1);
    const { data: p } = await profile(user.id);
    assertEquals(p!.checkout_session_id, newId);
  } finally {
    mock.restore();
    await user.cleanup();
  }
});

// ── independent review of #97, item 3: a lost response to
// sessions.create (or a failed checkout_session_id write right after) must
// not leave the mutex stuck or let a second concurrently-completable
// session through. stripe-checkout now stores a per-attempt idempotency
// key and passes it to Stripe, so a retry / concurrent request re-creates
// under the SAME key and Stripe returns the original session.

function idemKeysOnCreate(mock: ReturnType<typeof installFakeFetch>): string[] {
  return mock.calls
    .filter((c) => c.method === 'POST' && new URL(c.url).pathname === '/v1/checkout/sessions')
    .map((c) => c.headers.get('Idempotency-Key') || '');
}

Deno.test('review #97 item3: mutex held too long + no session id → the retry reconciles under the stable key, one session', async () => {
  const mock = installFakeFetch();
  // The lost attempt acquired the lock ~90s ago and never came back — past
  // the 30s reconcile threshold, well within the 15-min TTL.
  const heldAt = new Date(Date.now() - 90_000).toISOString();
  const attemptKey = `chk_${crypto.randomUUID()}_${Date.now() - 90_000}`;
  const user = await createTestUser({
    plan: 'free',
    profile: {
      checkout_pending_at: heldAt,        // lock held by the crashed/lost attempt
      checkout_session_id: null,          // its response never landed
      checkout_attempt_key: attemptKey,   // ...but its identity is durably stamped
    },
  });
  try {
    mockNoActiveSubscription(mock);
    mock.on('POST', '/v1/checkout/sessions', () => json({ id: 'cs_recon', url: 'https://checkout.stripe.com/pay/cs_recon' }));

    const res = await handler(checkoutReq(user.accessToken));
    assertEquals(res.status, 200);
    assert((await res.json()).url.includes('cs_recon'));
    assertEquals(newSessionsCreated(mock), 1);
    // The retry adopts the STORED checkout_attempt_key, so Stripe sees the
    // exact key the lost attempt used and returns the original session.
    assertEquals(idemKeysOnCreate(mock), [attemptKey]);

    const { data: p } = await profile(user.id);
    assertEquals(p!.checkout_session_id, 'cs_recon');   // now recorded
    assertEquals(p!.checkout_attempt_key, null);        // and the identity retired
  } finally {
    mock.restore();
    await user.cleanup();
  }
});

Deno.test('review #97 item3: the happy-path sessions.create carries a derived idempotency key (so a lost response is recoverable)', async () => {
  // FINDING-C already covers the double-click race (one 200, one 409). This
  // just pins the mechanism item 3 relies on: every create Stripe sees is
  // idempotency-keyed off (user id | checkout_pending_at).
  const mock = installFakeFetch();
  const user = await createTestUser({ plan: 'free' });
  try {
    mockNoActiveSubscription(mock);
    mock.on('POST', '/v1/checkout/sessions', () => json({ id: 'cs_one', url: 'https://checkout.stripe.com/pay/cs_one' }));

    const res = await handler(checkoutReq(user.accessToken));
    assertEquals(res.status, 200);
    assertEquals(newSessionsCreated(mock), 1);

    const keys = idemKeysOnCreate(mock);
    assertEquals(keys.length, 1);
    assert(new RegExp(`^chk_${user.id}_\\d+$`).test(keys[0]), `create carried a derived idempotency key, got ${JSON.stringify(keys[0])}`);

    const { data: p } = await profile(user.id);
    assertEquals(p!.checkout_session_id, 'cs_one');
    // A second call now hits the reuse path (checkout_session_id set) — not
    // relevant here, just confirming we didn't leave the mutex stuck.
    assert(p!.checkout_pending_at !== null);
  } finally {
    mock.restore();
    await user.cleanup();
  }
});

Deno.test('review #97 item3: a failed checkout_session_id write keeps the mutex + key so the retry reconciles (no expire)', async () => {
  const mock = installFakeFetch();
  const user = await createTestUser({ plan: 'free' });
  try {
    mockNoActiveSubscription(mock);
    const sessionId = mockCheckoutSessionCreate(mock);
    let expired = false;
    mock.on('POST', (u) => u.pathname === `/v1/checkout/sessions/${sessionId}/expire`, () => { expired = true; return json({ id: sessionId, status: 'expired' }); });

    await withCheckoutSessionIdWriteBlocked(async () => {
      const res = await handler(checkoutReq(user.accessToken));
      assertEquals(res.status, 500);
    });

    assertEquals(newSessionsCreated(mock), 1);
    assertEquals(expired, false, 'the session is kept — a retry reconciles it under the idempotency key');
    const { data: p } = await profile(user.id);
    assert(p!.checkout_pending_at !== null, 'mutex retained for the reconciling retry');
    assert(p!.checkout_attempt_key !== null, 'attempt identity retained for the reconciling retry');
    assertEquals(p!.checkout_session_id, null); // still not recorded (write was blocked)
  } finally {
    mock.restore();
    await user.cleanup();
  }
});

// ── ROUND 5, risk 1a: Checkout A completes AFTER request B's
// findActiveSubscription came back empty, and the webhook clears B's view
// of the guard fields (checkout_session_id / checkout_pending_at → null)
// before B reads the profile. B then skips the reuse-or-close block
// entirely and, with only a pre-lock subscription check, mints a second
// concurrently-completable session. Fix: re-check for an active
// subscription AFTER the lock, right before sessions.create.

Deno.test('review ROUND5 1a: an active subscription that appears after the pre-lock check blocks session creation (409, no new session)', async () => {
  const mock = installFakeFetch();
  // Webhook already ran for Checkout A: guard fields cleared.
  const user = await createTestUser({
    plan: 'free',
    profile: { checkout_pending_at: null, checkout_session_id: null },
  });
  try {
    // findActiveSubscription: empty on the pre-lock call, active on the
    // post-lock re-check (A's subscription became visible in between).
    let custCall = 0;
    mock.on('GET', '/v1/customers', () => {
      custCall++;
      return custCall === 1 ? json({ data: [] }) : json({ data: [{ id: 'cus_A' }] });
    });
    mock.on('GET', '/v1/subscriptions', () => json({ data: [{ id: 'sub_A', status: 'active' }] }));
    mock.on('POST', '/v1/checkout/sessions', () => json({ id: 'cs_should_not_exist', url: 'x' })); // must NOT be called

    const res = await handler(checkoutReq(user.accessToken));
    assertEquals(res.status, 409);
    assertEquals((await res.json()).error, 'checkout_already_completed');
    assertEquals(newSessionsCreated(mock), 0);
    assert(custCall >= 2, 'the subscription check must run again after the lock');

    const { data: p } = await profile(user.id);
    assertEquals(p!.checkout_pending_at, null, 'the lock this request briefly took is released');
    assertEquals(p!.checkout_session_id, null);
  } finally {
    mock.restore();
    await user.cleanup();
  }
});

// ── ROUND 5, risk 1d: a lock older than the 15-min mutex TTL with no
// recorded session id. Its holder may have created a session at Stripe
// under chk_<user>_<epoch(that lock's checkout_pending_at)> and lost the
// response. A retry must reconcile under THAT key (Stripe returns the
// original), not acquire a fresh lock and mint a second session under a
// new key. Stripe idempotency keys are only retained ~24h, so past that
// there is nothing to dedupe against — return an explicit status instead
// of gambling on a second session.

Deno.test('review ROUND5 1d: a >15min stale lock with no session id reconciles under the stable key, one session', async () => {
  const mock = installFakeFetch();
  const staleAt = new Date(Date.now() - 20 * 60_000).toISOString(); // 20 min ago
  const attemptKey = `chk_${crypto.randomUUID()}_${Date.now() - 20 * 60_000}`;
  const user = await createTestUser({
    plan: 'free',
    profile: { checkout_pending_at: staleAt, checkout_session_id: null, checkout_attempt_key: attemptKey },
  });
  try {
    mockNoActiveSubscription(mock);
    mock.on('POST', '/v1/checkout/sessions', () => json({ id: 'cs_recon_1d', url: 'https://checkout.stripe.com/pay/cs_recon_1d' }));

    const res = await handler(checkoutReq(user.accessToken));
    assertEquals(res.status, 200);
    assertEquals(newSessionsCreated(mock), 1);
    // The stored attempt key is adopted — not a fresh one.
    assertEquals(idemKeysOnCreate(mock), [attemptKey]);

    const { data: p } = await profile(user.id);
    assertEquals(p!.checkout_session_id, 'cs_recon_1d');
    assertEquals(p!.checkout_attempt_key, null);
  } finally {
    mock.restore();
    await user.cleanup();
  }
});

Deno.test('review ROUND5 1d: a stale attempt key older than the idempotency-key retention window returns an explicit reconcile status, no new session', async () => {
  const mock = installFakeFetch();
  const oldMs = Date.now() - 24 * 60 * 60_000; // 24h ago
  const attemptKey = `chk_${crypto.randomUUID()}_${oldMs}`;
  const user = await createTestUser({
    plan: 'free',
    profile: {
      checkout_pending_at: new Date(Date.now() - 20 * 60_000).toISOString(),
      checkout_session_id: null,
      checkout_attempt_key: attemptKey,
    },
  });
  try {
    mockNoActiveSubscription(mock);
    mock.on('POST', '/v1/checkout/sessions', () => json({ id: 'cs_should_not_exist', url: 'x' })); // must NOT be called

    const res = await handler(checkoutReq(user.accessToken));
    assertEquals(res.status, 409);
    assertEquals((await res.json()).error, 'checkout_reconcile_required');
    assertEquals(newSessionsCreated(mock), 0);
    // Identity untouched — the next retry lands here again, not on a fresh key.
    const { data: p } = await profile(user.id);
    assertEquals(p!.checkout_attempt_key, attemptKey);
  } finally {
    mock.restore();
    await user.cleanup();
  }
});

// ── ROUND 7 BLOCKER 1: the attempt identity is a dedicated column
// (checkout_attempt_key), stamped once and NEVER rewritten by a lock
// acquire or a recovery — no "restore" UPDATE whose failure/crash-window
// could leave a fresh seed. It survives a stop right after the lock, a lost
// sessions.create response, and any number of retries of an indeterminate
// old attempt.

Deno.test('review ROUND7 B1: a stop right after the lock acquire → the retry reuses the SAME stamped key', async () => {
  const mock = installFakeFetch();
  // Simulate "acquired the lock, then the isolate died before sessions.create":
  // a fresh lock timestamp, a durably-stamped key, no session id.
  const attemptKey = `chk_${crypto.randomUUID()}_${Date.now() - 90_000}`;
  const user = await createTestUser({
    plan: 'free',
    profile: {
      checkout_pending_at: new Date(Date.now() - 90_000).toISOString(), // >30s, <15min
      checkout_session_id: null,
      checkout_attempt_key: attemptKey,
    },
  });
  try {
    mockNoActiveSubscription(mock);
    mock.on('POST', '/v1/checkout/sessions', () => json({ id: 'cs_b1', url: 'https://checkout.stripe.com/pay/cs_b1' }));

    const res = await handler(checkoutReq(user.accessToken));
    assertEquals(res.status, 200);
    assertEquals(newSessionsCreated(mock), 1);
    assertEquals(idemKeysOnCreate(mock), [attemptKey], 'retry re-created under the exact stamped key');

    const { data: p } = await profile(user.id);
    assertEquals(p!.checkout_session_id, 'cs_b1');
    assertEquals(p!.checkout_attempt_key, null);
  } finally {
    mock.restore();
    await user.cleanup();
  }
});

Deno.test('review ROUND7 B1: a reconcile_required attempt keeps its identity across a 31s-later retry (no new session)', async () => {
  const mock = installFakeFetch();
  const attemptKey = `chk_${crypto.randomUUID()}_${Date.now() - 24 * 60 * 60_000}`; // >23h → reconcile_required
  const user = await createTestUser({
    plan: 'free',
    profile: {
      checkout_pending_at: new Date(Date.now() - 20 * 60_000).toISOString(),
      checkout_session_id: null,
      checkout_attempt_key: attemptKey,
    },
  });
  try {
    mockNoActiveSubscription(mock);
    mock.on('POST', '/v1/checkout/sessions', () => json({ id: 'cs_must_not_exist', url: 'x' })); // must NEVER be called

    const r1 = await handler(checkoutReq(user.accessToken));
    assertEquals(r1.status, 409);
    assertEquals((await r1.json()).error, 'checkout_reconcile_required');
    assertEquals(newSessionsCreated(mock), 0);
    const { data: p1 } = await profile(user.id);
    assertEquals(p1!.checkout_attempt_key, attemptKey, 'identity untouched — no restore, no rewrite');

    // "31s later" — still indeterminate, still no session, still the same key.
    const r2 = await handler(checkoutReq(user.accessToken));
    assertEquals(r2.status, 409);
    assertEquals((await r2.json()).error, 'checkout_reconcile_required');
    assertEquals(newSessionsCreated(mock), 0);
    const { data: p2 } = await profile(user.id);
    assertEquals(p2!.checkout_attempt_key, attemptKey);
  } finally {
    mock.restore();
    await user.cleanup();
  }
});

Deno.test('review ROUND7 B1: a lost sessions.create response → the retry returns the SAME Stripe session under the same key', async () => {
  const mock = installFakeFetch();
  const attemptKey = `chk_${crypto.randomUUID()}_${Date.now() - 20 * 60_000}`;
  const user = await createTestUser({
    plan: 'free',
    profile: {
      checkout_pending_at: new Date(Date.now() - 20 * 60_000).toISOString(),
      checkout_session_id: null,
      checkout_attempt_key: attemptKey,
    },
  });
  try {
    mockNoActiveSubscription(mock);
    // Stripe de-dupes on the idempotency key → same session id every call.
    mock.on('POST', '/v1/checkout/sessions', () => json({ id: 'cs_orig', url: 'https://checkout.stripe.com/pay/cs_orig' }));

    // Attempt 1: session created, but its checkout_session_id write is lost.
    await withCheckoutSessionIdWriteBlocked(async () => {
      const r1 = await handler(checkoutReq(user.accessToken));
      assertEquals(r1.status, 500);
    });
    assertEquals(idemKeysOnCreate(mock), [attemptKey]);
    const { data: p1 } = await profile(user.id);
    assertEquals(p1!.checkout_attempt_key, attemptKey, 'key retained, unchanged, for the retry');
    assertEquals(p1!.checkout_session_id, null);

    // Attempt 2: same key → Stripe returns cs_orig → one session ever.
    const r2 = await handler(checkoutReq(user.accessToken));
    assertEquals(r2.status, 200);
    assert((await r2.json()).url.includes('cs_orig'));
    assertEquals(idemKeysOnCreate(mock), [attemptKey, attemptKey]);
    const { data: p2 } = await profile(user.id);
    assertEquals(p2!.checkout_session_id, 'cs_orig');
    assertEquals(p2!.checkout_attempt_key, null);
  } finally {
    mock.restore();
    await user.cleanup();
  }
});
