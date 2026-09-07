// Integration tests for alpaca-invest — real local Supabase stack (auth,
// profiles, the investments unique constraint), faked Alpaca API.
//
// Covers: the paid-Pro gate (E4 / PENETRATION_TEST_PLAN 6.4), FINDING-A's
// atomic pending-row dedup (duplicate request → 409 before Alpaca; failure
// paths release the reservation), input validation, and the stale-token
// teardown.
//
// Requires `npx supabase start`.

import {
  assert,
  assertEquals,
} from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { installFakeFetch, json } from './_helpers/mod.ts';
import { createTestUser } from './_helpers/mod.ts';
import { dbAdmin } from './_helpers/mod.ts';
import { handler } from '../alpaca-invest/index.ts';

const ALPACA = 'https://api.alpaca.markets';

function invReq(token: string | null, body: unknown): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return new Request('http://localhost/alpaca-invest', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function investmentsOf(userId: string) {
  return dbAdmin().from('investments').select('*').eq('user_id', userId);
}

Deno.test('happy path: paid Pro places an order, pending row is confirmed', async () => {
  const mock = installFakeFetch();
  const user = await createTestUser({ plan: 'pro', profile: { alpaca_access_token: 'tok_live' } });
  try {
    mock.on('GET', '/v2/account', () => json({ buying_power: '100000.00' }));
    // Random per run — a literal like 'ord_abc' would collide with the
    // investments.order_id UNIQUE constraint if an earlier crashed run ever
    // left an orphaned confirmed row behind.
    const orderId = `ord_${crypto.randomUUID()}`;
    mock.on('POST', '/v2/orders', () => json({ id: orderId, status: 'accepted' }));

    const res = await handler(invReq(user.accessToken, { amount: 25, symbol: 'SPY' }));
    assertEquals(res.status, 200);
    const bodyJson = await res.json();
    assertEquals(bodyJson.success, true);
    assertEquals(bodyJson.order_id, orderId);

    const { data: rows } = await investmentsOf(user.id);
    assertEquals(rows!.length, 1);
    assertEquals(rows![0].order_id, orderId);
    assertEquals(rows![0].status, 'accepted');
    assertEquals(mock.countMatching(`${ALPACA}/v2/orders`), 1);
  } finally {
    mock.restore();
    await user.cleanup();
  }
});

Deno.test('E4: a free user is blocked with 403 and zero side effects', async () => {
  const mock = installFakeFetch();
  const user = await createTestUser({ plan: 'free' });
  try {
    const res = await handler(invReq(user.accessToken, { amount: 25, symbol: 'SPY' }));
    assertEquals(res.status, 403);
    assertEquals((await res.json()).error, 'upgrade_required');

    const { data: rows } = await investmentsOf(user.id);
    assertEquals(rows!.length, 0);
    assertEquals(mock.calls.length, 0);
  } finally {
    mock.restore();
    await user.cleanup();
  }
});

Deno.test('E4: a Pro still inside the trial window is blocked with 403', async () => {
  const mock = installFakeFetch();
  const user = await createTestUser({
    plan: 'pro',
    trialEndsAt: new Date(Date.now() + 3 * 24 * 3600_000),
    profile: { alpaca_access_token: 'tok_live' },
  });
  try {
    const res = await handler(invReq(user.accessToken, { amount: 25, symbol: 'SPY' }));
    assertEquals(res.status, 403);
    const { data: rows } = await investmentsOf(user.id);
    assertEquals(rows!.length, 0);
    assertEquals(mock.calls.length, 0);
  } finally {
    mock.restore();
    await user.cleanup();
  }
});

Deno.test('FINDING-A: two concurrent identical requests → one 200, one 409, one order', async () => {
  const mock = installFakeFetch();
  const user = await createTestUser({ plan: 'pro', profile: { alpaca_access_token: 'tok_live' } });
  try {
    mock.on('GET', '/v2/account', () => json({ buying_power: '100000.00' }));
    mock.on('POST', '/v2/orders', () => json({ id: `ord_${crypto.randomUUID()}`, status: 'accepted' }));

    const [a, b] = await Promise.all([
      handler(invReq(user.accessToken, { amount: 30, symbol: 'SPY' })),
      handler(invReq(user.accessToken, { amount: 30, symbol: 'SPY' })),
    ]);
    const statuses = [a.status, b.status].sort();
    assertEquals(statuses, [200, 409]);

    const { data: rows } = await investmentsOf(user.id);
    assertEquals(rows!.length, 1);
    assertEquals(rows![0].status, 'accepted');
    assertEquals(mock.countMatching(`${ALPACA}/v2/orders`), 1);
  } finally {
    mock.restore();
    await user.cleanup();
  }
});

Deno.test('failure path: insufficient buying power → 400, reservation released, retry works', async () => {
  const mock = installFakeFetch();
  const user = await createTestUser({ plan: 'pro', profile: { alpaca_access_token: 'tok_live' } });
  try {
    let bp = '10.00';
    mock.on('GET', '/v2/account', () => json({ buying_power: bp }));
    mock.on('POST', '/v2/orders', () => json({ id: `ord_${crypto.randomUUID()}`, status: 'accepted' }));

    const first = await handler(invReq(user.accessToken, { amount: 50, symbol: 'SPY' }));
    assertEquals(first.status, 400);
    assert((await first.json()).error.startsWith('Insufficient buying power'));

    // Reservation must be gone, otherwise the retry below would 409 on its own dead row.
    const { data: afterFail } = await investmentsOf(user.id);
    assertEquals(afterFail!.length, 0);

    bp = '100000.00';
    const retry = await handler(invReq(user.accessToken, { amount: 50, symbol: 'SPY' }));
    assertEquals(retry.status, 200);
  } finally {
    mock.restore();
    await user.cleanup();
  }
});

Deno.test('failure path: Alpaca order rejected (500) → 400, reservation released', async () => {
  const mock = installFakeFetch();
  const user = await createTestUser({ plan: 'pro', profile: { alpaca_access_token: 'tok_live' } });
  try {
    mock.on('GET', '/v2/account', () => json({ buying_power: '100000.00' }));
    mock.on('POST', '/v2/orders', () => json({ message: 'internal' }, { status: 500 }));

    const res = await handler(invReq(user.accessToken, { amount: 40, symbol: 'SPY' }));
    assertEquals(res.status, 400);
    assertEquals((await res.json()).error, 'Order failed');

    const { data: rows } = await investmentsOf(user.id);
    assertEquals(rows!.length, 0);
  } finally {
    mock.restore();
    await user.cleanup();
  }
});

Deno.test('stale Alpaca token: /v2/account 401 → columns nulled, 400 alpaca_not_connected', async () => {
  const mock = installFakeFetch();
  const user = await createTestUser({
    plan: 'pro',
    profile: {
      alpaca_access_token: 'tok_stale',
      alpaca_refresh_token: 'ref_stale',
      alpaca_account_id: 'acct_1',
      alpaca_connected_at: new Date().toISOString(),
    },
  });
  try {
    mock.on('GET', '/v2/account', () => json({ message: 'unauthorized' }, { status: 401 }));

    const res = await handler(invReq(user.accessToken, { amount: 20, symbol: 'SPY' }));
    assertEquals(res.status, 400);
    assertEquals((await res.json()).error, 'alpaca_not_connected');

    const { data: prof } = await dbAdmin()
      .from('profiles')
      .select('alpaca_access_token, alpaca_refresh_token, alpaca_account_id, alpaca_connected_at')
      .eq('id', user.id)
      .single();
    assertEquals(prof!.alpaca_access_token, null);
    assertEquals(prof!.alpaca_refresh_token, null);
    assertEquals(prof!.alpaca_account_id, null);
    assertEquals(prof!.alpaca_connected_at, null);

    const { data: rows } = await investmentsOf(user.id);
    assertEquals(rows!.length, 0);
  } finally {
    mock.restore();
    await user.cleanup();
  }
});

Deno.test('validation: no auth header → 401', async () => {
  const mock = installFakeFetch();
  try {
    const res = await handler(invReq(null, { amount: 25 }));
    assertEquals(res.status, 401);
    assertEquals(mock.calls.length, 0);
  } finally {
    mock.restore();
  }
});

Deno.test('validation: amount < 1, malformed body, bad symbol → 400 with no side effects', async () => {
  const mock = installFakeFetch();
  const user = await createTestUser({ plan: 'pro', profile: { alpaca_access_token: 'tok_live' } });
  try {
    const tooSmall = await handler(invReq(user.accessToken, { amount: 0.5, symbol: 'SPY' }));
    assertEquals(tooSmall.status, 400);

    const badJson = await handler(invReq(user.accessToken, '{ not json'));
    assertEquals(badJson.status, 400);
    assertEquals((await badJson.json()).error, 'Invalid request body');

    const badSym = await handler(invReq(user.accessToken, { amount: 25, symbol: 'NOTASYMBOL' }));
    assertEquals(badSym.status, 400);

    const { data: rows } = await investmentsOf(user.id);
    assertEquals(rows!.length, 0);
    assertEquals(mock.calls.length, 0);
  } finally {
    mock.restore();
    await user.cleanup();
  }
});

Deno.test('not connected: paid Pro without an Alpaca token → 400, reservation released', async () => {
  const mock = installFakeFetch();
  const user = await createTestUser({ plan: 'pro' }); // no alpaca_access_token
  try {
    const res = await handler(invReq(user.accessToken, { amount: 25, symbol: 'SPY' }));
    assertEquals(res.status, 400);
    assertEquals((await res.json()).error, 'alpaca_not_connected');

    const { data: rows } = await investmentsOf(user.id);
    assertEquals(rows!.length, 0);
    assertEquals(mock.calls.length, 0);
  } finally {
    mock.restore();
    await user.cleanup();
  }
});

// ── Independent audit 2026-09-07, finding #4 ─────────────────────────────
// Stable per-operation idempotency (investments.id as client_order_id) and
// broker reconciliation after an ambiguous network outcome, replacing the
// old per-minute window_bucket scheme.

function ordersPostCount(mock: ReturnType<typeof installFakeFetch>): number {
  // countMatching('/v2/orders') would also match the reconciliation lookup
  // (GET /v2/orders:by_client_order_id?...), which contains that substring
  // too — count POSTs to the exact placement path explicitly instead.
  return mock.calls.filter((c) => c.method === 'POST' && new URL(c.url).pathname === '/v2/orders').length;
}

async function insertRow(userId: string, fields: Record<string, unknown>) {
  const { data, error } = await dbAdmin()
    .from('investments')
    .insert({ user_id: userId, ...fields })
    .select('id')
    .single();
  if (error) throw error;
  return data.id as string;
}

Deno.test('audit finding #4: an ambiguous network failure on order placement marks the row unknown, not deleted', async () => {
  const mock = installFakeFetch();
  const user = await createTestUser({ plan: 'pro', profile: { alpaca_access_token: 'tok_live' } });
  try {
    mock.on('GET', '/v2/account', () => json({ buying_power: '100000.00' }));
    mock.on('POST', '/v2/orders', () => { throw new TypeError('network error (simulated)'); });

    const res = await handler(invReq(user.accessToken, { amount: 60, symbol: 'SPY' }));
    assertEquals(res.status, 503);
    assertEquals((await res.json()).error, 'order_status_unknown');

    // The reservation must survive as the only trace of a possibly-accepted
    // order — deleting it here is exactly what let a retry double-buy.
    const { data: rows } = await investmentsOf(user.id);
    assertEquals(rows!.length, 1);
    assertEquals(rows![0].status, 'unknown');
    assertEquals(rows![0].order_id, null);
  } finally {
    mock.restore();
    await user.cleanup();
  }
});

Deno.test('audit finding #4: retrying after an ambiguous failure where the broker DID accept it syncs the row, places no second order', async () => {
  const mock = installFakeFetch();
  const user = await createTestUser({ plan: 'pro', profile: { alpaca_access_token: 'tok_live' } });
  try {
    const rowId = await insertRow(user.id, { symbol: 'SPY', amount: 60, status: 'unknown' });
    const brokerOrderId = `ord_${crypto.randomUUID()}`;
    mock.on('GET', '/v2/orders:by_client_order_id', () => json({ id: brokerOrderId, status: 'accepted' }));

    const res = await handler(invReq(user.accessToken, { amount: 60, symbol: 'SPY' }));
    assertEquals(res.status, 200);
    const bodyJson = await res.json();
    assertEquals(bodyJson.success, true);
    assertEquals(bodyJson.order_id, brokerOrderId);

    // No new order was placed — the earlier "ambiguous" attempt already went
    // through, and this retry only reconciled the existing row with it.
    assertEquals(ordersPostCount(mock), 0);
    assertEquals(mock.countMatching('/v2/orders:by_client_order_id'), 1);

    const { data: rows } = await investmentsOf(user.id);
    assertEquals(rows!.length, 1);
    assertEquals(rows![0].id, rowId);
    assertEquals(rows![0].order_id, brokerOrderId);
    assertEquals(rows![0].status, 'accepted');
  } finally {
    mock.restore();
    await user.cleanup();
  }
});

Deno.test('audit finding #4: retrying after an ambiguous failure where the broker never received it places the order now, reusing the row', async () => {
  const mock = installFakeFetch();
  const user = await createTestUser({ plan: 'pro', profile: { alpaca_access_token: 'tok_live' } });
  try {
    const rowId = await insertRow(user.id, { symbol: 'SPY', amount: 60, status: 'unknown' });
    mock.on('GET', '/v2/orders:by_client_order_id', () => json({ message: 'not found' }, { status: 404 }));
    mock.on('GET', '/v2/account', () => json({ buying_power: '100000.00' }));
    const brokerOrderId = `ord_${crypto.randomUUID()}`;
    mock.on('POST', '/v2/orders', () => json({ id: brokerOrderId, status: 'accepted' }));

    const res = await handler(invReq(user.accessToken, { amount: 60, symbol: 'SPY' }));
    assertEquals(res.status, 200);
    const bodyJson = await res.json();
    assertEquals(bodyJson.success, true);
    assertEquals(bodyJson.order_id, brokerOrderId);

    // Exactly one order was ever placed, reusing the existing row/id rather
    // than creating a second reservation.
    assertEquals(ordersPostCount(mock), 1);
    assertEquals(mock.calls.find((c) => c.method === 'POST' && c.url.includes('/v2/orders'))!.bodyText!.includes(`ark-${rowId}`), true);

    const { data: rows } = await investmentsOf(user.id);
    assertEquals(rows!.length, 1);
    assertEquals(rows![0].id, rowId);
    assertEquals(rows![0].order_id, brokerOrderId);
    assertEquals(rows![0].status, 'accepted');
  } finally {
    mock.restore();
    await user.cleanup();
  }
});

Deno.test('audit finding #4: a new purchase with a different amount is not blocked by an existing unknown row', async () => {
  const mock = installFakeFetch();
  const user = await createTestUser({ plan: 'pro', profile: { alpaca_access_token: 'tok_live' } });
  try {
    await insertRow(user.id, { symbol: 'SPY', amount: 60, status: 'unknown' });
    mock.on('GET', '/v2/account', () => json({ buying_power: '100000.00' }));
    const brokerOrderId = `ord_${crypto.randomUUID()}`;
    mock.on('POST', '/v2/orders', () => json({ id: brokerOrderId, status: 'accepted' }));

    const res = await handler(invReq(user.accessToken, { amount: 75, symbol: 'SPY' }));
    assertEquals(res.status, 200);
    assertEquals((await res.json()).order_id, brokerOrderId);
    assertEquals(ordersPostCount(mock), 1);

    const { data: rows } = await investmentsOf(user.id);
    assertEquals(rows!.length, 2); // the stale $60 unknown row is untouched
    const stale = rows!.find((r) => Number(r.amount) === 60);
    const fresh = rows!.find((r) => Number(r.amount) === 75);
    assertEquals(stale!.status, 'unknown');
    assertEquals(fresh!.status, 'accepted');
  } finally {
    mock.restore();
    await user.cleanup();
  }
});

Deno.test('audit finding #4: a new purchase of the same amount+symbol is not blocked once the prior operation reached a terminal status', async () => {
  const mock = installFakeFetch();
  const user = await createTestUser({ plan: 'pro', profile: { alpaca_access_token: 'tok_live' } });
  try {
    await insertRow(user.id, { symbol: 'SPY', amount: 60, order_id: `ord_${crypto.randomUUID()}`, status: 'accepted' });
    mock.on('GET', '/v2/account', () => json({ buying_power: '100000.00' }));
    const brokerOrderId = `ord_${crypto.randomUUID()}`;
    mock.on('POST', '/v2/orders', () => json({ id: brokerOrderId, status: 'accepted' }));

    const res = await handler(invReq(user.accessToken, { amount: 60, symbol: 'SPY' }));
    assertEquals(res.status, 200);
    assertEquals((await res.json()).order_id, brokerOrderId);
    assertEquals(ordersPostCount(mock), 1);

    const { data: rows } = await investmentsOf(user.id);
    assertEquals(rows!.length, 2); // both the old and the new purchase exist as separate rows
  } finally {
    mock.restore();
    await user.cleanup();
  }
});

// ── code-reviewer follow-up, same date: two gaps found in the first pass
// of finding #4's fix, closed before handoff.

Deno.test('audit finding #4 follow-up: two concurrent retries reconciling the same unknown row → exactly one places the order', async () => {
  const mock = installFakeFetch();
  const user = await createTestUser({ plan: 'pro', profile: { alpaca_access_token: 'tok_live' } });
  try {
    await insertRow(user.id, { symbol: 'SPY', amount: 60, status: 'unknown' });
    // Both concurrent requests read the same existingRow and both get 404
    // from reconciliation — without the compare-and-swap claim on the row
    // (status 'unknown' -> 'pending'), both would go on to POST /v2/orders
    // with the identical client_order_id.
    mock.on('GET', '/v2/orders:by_client_order_id', () => json({ message: 'not found' }, { status: 404 }));
    mock.on('GET', '/v2/account', () => json({ buying_power: '100000.00' }));
    const brokerOrderId = `ord_${crypto.randomUUID()}`;
    mock.on('POST', '/v2/orders', () => json({ id: brokerOrderId, status: 'accepted' }));

    const [a, b] = await Promise.all([
      handler(invReq(user.accessToken, { amount: 60, symbol: 'SPY' })),
      handler(invReq(user.accessToken, { amount: 60, symbol: 'SPY' })),
    ]);
    const statuses = [a.status, b.status].sort();
    assertEquals(statuses, [200, 409]);
    assertEquals(ordersPostCount(mock), 1);

    const { data: rows } = await investmentsOf(user.id);
    assertEquals(rows!.length, 1);
    assertEquals(rows![0].order_id, brokerOrderId);
    assertEquals(rows![0].status, 'accepted');
  } finally {
    mock.restore();
    await user.cleanup();
  }
});

Deno.test('audit finding #4 follow-up: Alpaca rejects the order as a duplicate client_order_id → reconciled, not released', async () => {
  const mock = installFakeFetch();
  const user = await createTestUser({ plan: 'pro', profile: { alpaca_access_token: 'tok_live' } });
  try {
    mock.on('GET', '/v2/account', () => json({ buying_power: '100000.00' }));
    // A real, synchronous rejection from Alpaca saying "this client_order_id
    // already exists" — the old code released the reservation unconditionally
    // on any !orderRes.ok, which for exactly this response would delete the
    // only trace of a real order placed under that id.
    mock.on('POST', '/v2/orders', () => json({ message: 'client order id already exists' }, { status: 422 }));
    const brokerOrderId = `ord_${crypto.randomUUID()}`;
    mock.on('GET', '/v2/orders:by_client_order_id', () => json({ id: brokerOrderId, status: 'accepted' }));

    const res = await handler(invReq(user.accessToken, { amount: 60, symbol: 'SPY' }));
    assertEquals(res.status, 200);
    const bodyJson = await res.json();
    assertEquals(bodyJson.success, true);
    assertEquals(bodyJson.order_id, brokerOrderId);

    const { data: rows } = await investmentsOf(user.id);
    assertEquals(rows!.length, 1); // not deleted — reconciled onto the existing row instead
    assertEquals(rows![0].order_id, brokerOrderId);
    assertEquals(rows![0].status, 'accepted');
  } finally {
    mock.restore();
    await user.cleanup();
  }
});
