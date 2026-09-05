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
