// Integration tests for plaid-batch-sync — real local Supabase stack,
// faked Plaid API.
//
// Covers the independent-audit fix (2026-09-07): a DB write failure for one
// item must not advance that item's cursor or get silently swallowed, and
// must not block other items' syncs (mirrors plaid-sync-transactions.test.ts).
//
// Requires `npx supabase start`.

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { installFakeFetch, json, localConfig } from './_helpers/mod.ts';
import { createTestUser } from './_helpers/mod.ts';
import { dbAdmin } from './_helpers/mod.ts';
import { handler } from '../plaid-batch-sync/index.ts';

const SERVICE_KEY = localConfig.serviceRoleKey;

interface PlaidTx {
  transaction_id: string;
  date: string;
  amount: number;
  name: string;
  merchant_name: string | null;
  personal_finance_category: { primary: string; detailed: string } | null;
  pending: boolean;
}

function tx(over: Partial<PlaidTx> = {}): PlaidTx {
  return {
    transaction_id: `tx_${crypto.randomUUID()}`,
    date: '2026-08-01',
    amount: 12.34,
    name: 'Corner Store',
    merchant_name: 'Corner Store',
    personal_finance_category: { primary: 'GENERAL_MERCHANDISE', detailed: 'GENERAL_MERCHANDISE_OTHER' },
    pending: false,
    ...over,
  };
}

function page(opts: {
  added?: PlaidTx[];
  removed?: { transaction_id: string }[];
  next_cursor: string;
  has_more?: boolean;
}) {
  return {
    added: opts.added ?? [],
    modified: [],
    removed: opts.removed ?? [],
    next_cursor: opts.next_cursor,
    has_more: opts.has_more ?? false,
  };
}

function batchReq(token: string | null): Request {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  return new Request('http://localhost/plaid-batch-sync', { method: 'POST', headers });
}

async function addItem(userId: string, opts: { cursor?: string | null } = {}): Promise<{ id: string; accessToken: string }> {
  const accessToken = `at_${crypto.randomUUID()}`;
  const { data, error } = await dbAdmin()
    .from('plaid_items')
    .insert({
      user_id: userId,
      item_id: `item_${crypto.randomUUID()}`,
      access_token: accessToken,
      plaid_cursor: opts.cursor ?? null,
      plaid_environment: 'production',
    })
    .select('id')
    .single();
  if (error) throw new Error(`addItem: ${error.message}`);
  return { id: data!.id, accessToken };
}

async function itemCursor(id: string): Promise<string | null> {
  const { data } = await dbAdmin().from('plaid_items').select('plaid_cursor').eq('id', id).single();
  return data!.plaid_cursor;
}

async function cleanTx(userId: string) {
  await dbAdmin().from('transactions').delete().eq('user_id', userId);
}

Deno.test('happy path: added persisted, cursor advanced, user stamped last_synced_at', async () => {
  const mock = installFakeFetch();
  const user = await createTestUser({});
  const { id } = await addItem(user.id, { cursor: null });
  try {
    mock.on('POST', '/transactions/sync', () => json(page({ added: [tx()], next_cursor: 'cur_1' })));

    const res = await handler(batchReq(SERVICE_KEY));
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.added, 1);
    assertEquals(body.users_synced, 1);
    assertEquals(await itemCursor(id), 'cur_1');
  } finally {
    mock.restore();
    await cleanTx(user.id);
    await user.cleanup();
  }
});

Deno.test('independent audit 2026-09-07: a DB write failure does not advance the cursor and is reported, not swallowed', async () => {
  // amount: 0 fails transactions_amount_positive (amount > 0) — a real DB
  // constraint violation, not a mocked error.
  const mock = installFakeFetch();
  const user = await createTestUser({});
  const { id } = await addItem(user.id, { cursor: 'c0' });
  try {
    mock.on('POST', '/transactions/sync', () => json(page({ added: [tx({ amount: 0 })], next_cursor: 'c1' })));

    const res = await handler(batchReq(SERVICE_KEY));
    assertEquals(res.status, 200); // batch endpoint reports per-item errors, doesn't fail the whole run
    const body = await res.json();
    assertEquals(body.added, 0);
    assertEquals(body.users_synced, 0); // failed item's user is never marked synced
    assertEquals(body.errors?.length, 1);
    assertEquals(await itemCursor(id), 'c0'); // not advanced to c1
  } finally {
    mock.restore();
    await cleanTx(user.id);
    await user.cleanup();
  }
});

Deno.test('one item failing does not block another item succeeding', async () => {
  const user1 = await createTestUser({});
  const user2 = await createTestUser({});
  const good = await addItem(user1.id, { cursor: 'g0' });
  const bad  = await addItem(user2.id, { cursor: 'b0' });
  const mock = installFakeFetch();
  try {
    mock.on('POST', '/transactions/sync', async (req) => {
      const body = await req.clone().json();
      return body.access_token === good.accessToken
        ? json(page({ added: [tx({ transaction_id: 'tx_good' })], next_cursor: 'g1' }))
        : json(page({ added: [tx({ transaction_id: 'tx_bad', amount: 0 })], next_cursor: 'b1' }));
    });

    const res = await handler(batchReq(SERVICE_KEY));
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.added, 1);
    assertEquals(body.users_synced, 1);
    assertEquals(body.errors?.length, 1);

    assertEquals(await itemCursor(good.id), 'g1');
    assertEquals(await itemCursor(bad.id), 'b0');
  } finally {
    mock.restore();
    await cleanTx(user1.id);
    await cleanTx(user2.id);
    await user1.cleanup();
    await user2.cleanup();
  }
});

Deno.test('auth: wrong token -> 403, no Plaid call', async () => {
  const mock = installFakeFetch();
  try {
    const res = await handler(batchReq('not-the-service-key'));
    assertEquals(res.status, 403);
    assertEquals(mock.calls.length, 0);
  } finally {
    mock.restore();
  }
});
