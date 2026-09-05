// Integration tests for plaid-sync-transactions — real local Supabase
// stack, faked Plaid API.
//
// Covers: FINDING-E's cursor compare-and-swap (a concurrent sync that has
// already advanced the cursor must not be overwritten with a staler one),
// pagination, removed-transaction handling, the service-role gate on the
// admin actions, the non-production skip, and the Plaid→app category
// mapping applied on the way in.
//
// Requires `npx supabase start`.

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { installFakeFetch, json, localConfig } from './_helpers/mod.ts';
import { createTestUser } from './_helpers/mod.ts';
import { dbAdmin } from './_helpers/mod.ts';
import { handler } from '../plaid-sync-transactions/index.ts';

const SERVICE_KEY = localConfig.serviceRoleKey;

interface PlaidTx {
  transaction_id: string;
  account_id: string;
  date: string;
  amount: number;
  name: string;
  merchant_name: string | null;
  personal_finance_category: { primary: string; detailed: string } | null;
  pending: boolean;
}

// Cross-item dedup keys on (date, description, amount) — see
// syncItemTransactions. Two default fixtures must not collide on that key
// the way two real, distinct transactions wouldn't, so the default amount
// is unique per call unless the test overrides it on purpose.
let txSeq = 0;

function tx(over: Partial<PlaidTx> = {}): PlaidTx {
  txSeq += 1;
  return {
    transaction_id: `tx_${crypto.randomUUID()}`,
    account_id: 'acc_1',
    date: '2026-08-01',
    amount: 12.34 + txSeq,
    name: 'Corner Store',
    merchant_name: 'Corner Store',
    personal_finance_category: { primary: 'GENERAL_MERCHANDISE', detailed: 'GENERAL_MERCHANDISE_OTHER' },
    pending: false,
    ...over,
  };
}

function page(opts: {
  added?: PlaidTx[];
  modified?: PlaidTx[];
  removed?: { transaction_id: string }[];
  next_cursor: string;
  has_more?: boolean;
}) {
  return {
    added: opts.added ?? [],
    modified: opts.modified ?? [],
    removed: opts.removed ?? [],
    next_cursor: opts.next_cursor,
    has_more: opts.has_more ?? false,
  };
}

function syncReq(token: string | null, body: Record<string, unknown> = {}): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return new Request('http://localhost/plaid-sync-transactions', { method: 'POST', headers, body: JSON.stringify(body) });
}

async function addItem(
  userId: string,
  opts: { itemId?: string; cursor?: string | null; env?: string } = {},
): Promise<{ id: string; itemId: string }> {
  const itemId = opts.itemId ?? `item_${crypto.randomUUID()}`;
  const { data, error } = await dbAdmin()
    .from('plaid_items')
    .insert({
      user_id: userId,
      item_id: itemId,
      access_token: `at_${crypto.randomUUID()}`,
      plaid_cursor: opts.cursor ?? null,
      plaid_environment: opts.env ?? 'production',
    })
    .select('id')
    .single();
  if (error) throw new Error(`addItem: ${error.message}`);
  return { id: data!.id, itemId };
}

function stubAccounts(mock: ReturnType<typeof installFakeFetch>) {
  mock.on('POST', '/accounts/get', () => json({ accounts: [] }));
}

async function itemCursor(id: string): Promise<string | null> {
  const { data } = await dbAdmin().from('plaid_items').select('plaid_cursor').eq('id', id).single();
  return data!.plaid_cursor;
}

async function txRows(userId: string) {
  const { data } = await dbAdmin().from('transactions').select('*').eq('user_id', userId);
  return data ?? [];
}

async function cleanTx(userId: string) {
  await dbAdmin().from('transactions').delete().eq('user_id', userId);
}

Deno.test('happy path: added/modified persisted, cursor advanced', async () => {
  const mock = installFakeFetch();
  const user = await createTestUser({});
  const { id } = await addItem(user.id, { cursor: null });
  try {
    stubAccounts(mock);
    mock.on('POST', '/transactions/sync', () =>
      json(page({ added: [tx(), tx()], modified: [tx()], next_cursor: 'cur_1', has_more: false })));

    const res = await handler(syncReq(user.accessToken));
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.added, 2);
    assertEquals(body.modified, 1);
    assertEquals(body.removed, 0);
    assertEquals(body.synced, 3);

    assertEquals((await txRows(user.id)).length, 3);
    assertEquals(await itemCursor(id), 'cur_1');
  } finally {
    mock.restore();
    await cleanTx(user.id);
    await user.cleanup();
  }
});

Deno.test('pagination: multiple pages are drained, final cursor is the last page', async () => {
  const mock = installFakeFetch();
  const user = await createTestUser({});
  const { id } = await addItem(user.id, { cursor: null });
  try {
    stubAccounts(mock);
    let call = 0;
    mock.on('POST', '/transactions/sync', () => {
      call += 1;
      return call === 1
        ? json(page({ added: [tx(), tx()], next_cursor: 'cur_p1', has_more: true }))
        : json(page({ added: [tx()], next_cursor: 'cur_p2', has_more: false }));
    });

    const res = await handler(syncReq(user.accessToken));
    assertEquals(res.status, 200);
    assertEquals((await res.json()).added, 3);
    assertEquals((await txRows(user.id)).length, 3);
    assertEquals(await itemCursor(id), 'cur_p2');
    assertEquals(mock.countMatching('/transactions/sync'), 2);
  } finally {
    mock.restore();
    await cleanTx(user.id);
    await user.cleanup();
  }
});

Deno.test('FINDING-E: a concurrently-advanced cursor is not overwritten with a staler one', async () => {
  const mock = installFakeFetch();
  const user = await createTestUser({});
  const { id } = await addItem(user.id, { cursor: 'c0' });
  try {
    stubAccounts(mock);
    // Simulate the interleaving: another sync advances the cursor to 'c_other'
    // in the DB *before* this handler gets to its own compare-and-swap. The
    // handler started from 'c0', so its `WHERE plaid_cursor = 'c0'` update
    // matches 0 rows and the staler 'c1' it computed is never written.
    mock.on('POST', '/transactions/sync', async () => {
      await dbAdmin().from('plaid_items').update({ plaid_cursor: 'c_other' }).eq('id', id);
      return json(page({ added: [tx()], next_cursor: 'c1', has_more: false }));
    });

    const res = await handler(syncReq(user.accessToken));
    assertEquals(res.status, 200);
    assertEquals(await itemCursor(id), 'c_other'); // not clobbered back to 'c1'
  } finally {
    mock.restore();
    await cleanTx(user.id);
    await user.cleanup();
  }
});

Deno.test('FINDING-E: null-start CAS also refuses to write over a cursor set concurrently', async () => {
  const mock = installFakeFetch();
  const user = await createTestUser({});
  const { id } = await addItem(user.id, { cursor: null });
  try {
    stubAccounts(mock);
    mock.on('POST', '/transactions/sync', async () => {
      await dbAdmin().from('plaid_items').update({ plaid_cursor: 'c_first' }).eq('id', id);
      return json(page({ added: [tx()], next_cursor: 'c_second', has_more: false }));
    });

    const res = await handler(syncReq(user.accessToken));
    assertEquals(res.status, 200);
    assertEquals(await itemCursor(id), 'c_first');
  } finally {
    mock.restore();
    await cleanTx(user.id);
    await user.cleanup();
  }
});

Deno.test('removed transactions are deleted, scoped to the item owner', async () => {
  const mock = installFakeFetch();
  const user = await createTestUser({});
  const { id } = await addItem(user.id, { cursor: 'c0' });
  const doomed = `tx_${crypto.randomUUID()}`;
  await dbAdmin().from('transactions').insert({
    user_id: user.id, amount: 9.99, description: 'old', plaid_transaction_id: doomed, account_id: 'acc_1', type: 'expense',
  });
  try {
    stubAccounts(mock);
    mock.on('POST', '/transactions/sync', () =>
      json(page({ removed: [{ transaction_id: doomed }], next_cursor: 'c1', has_more: false })));

    const res = await handler(syncReq(user.accessToken));
    assertEquals(res.status, 200);
    assertEquals((await res.json()).removed, 1);

    const { data: gone } = await dbAdmin().from('transactions').select('id').eq('plaid_transaction_id', doomed);
    assertEquals(gone!.length, 0);
    assertEquals(await itemCursor(id), 'c1');
  } finally {
    mock.restore();
    await cleanTx(user.id);
    await user.cleanup();
  }
});

Deno.test('auth: a non-service, non-JWT token → 401 and no Plaid call', async () => {
  const mock = installFakeFetch();
  try {
    const res = await handler(syncReq('not-a-real-token'));
    assertEquals(res.status, 401);
    assertEquals(mock.calls.length, 0);
  } finally {
    mock.restore();
  }
});

Deno.test('a user with no connected items → synced:0, no Plaid call', async () => {
  const mock = installFakeFetch();
  const user = await createTestUser({});
  try {
    const res = await handler(syncReq(user.accessToken));
    assertEquals(res.status, 200);
    assertEquals(await res.json(), { added: 0, modified: 0, removed: 0, synced: 0 });
    assertEquals(mock.calls.length, 0);
  } finally {
    mock.restore();
    await user.cleanup();
  }
});

Deno.test('a non-production item is skipped, not synced', async () => {
  const mock = installFakeFetch();
  const user = await createTestUser({});
  await addItem(user.id, { env: 'sandbox' });
  try {
    stubAccounts(mock);
    mock.on('POST', '/transactions/sync', () => json(page({ added: [tx()], next_cursor: 'x', has_more: false })));

    const res = await handler(syncReq(user.accessToken));
    assertEquals(res.status, 200);
    assertEquals((await res.json()).synced, 0);
    assertEquals(mock.countMatching('/transactions/sync'), 0);
  } finally {
    mock.restore();
    await cleanTx(user.id);
    await user.cleanup();
  }
});

Deno.test('admin resync_all: wrong token → 403; service-role key → runs on production items', async () => {
  const mock = installFakeFetch();
  const user = await createTestUser({});
  await addItem(user.id, { cursor: 'stale' });
  try {
    const forbidden = await handler(syncReq(user.accessToken, { action: 'resync_all' }));
    assertEquals(forbidden.status, 403);

    stubAccounts(mock);
    mock.on('POST', '/transactions/sync', () =>
      json(page({ added: [tx({ transaction_id: `tx_${user.id}_a` })], next_cursor: 'fresh', has_more: false })));

    const ok = await handler(syncReq(SERVICE_KEY, { action: 'resync_all' }));
    assertEquals(ok.status, 200);
    const body = await ok.json();
    assertEquals(body.action, 'resync_all');
    assert(body.users_resynced >= 1);
  } finally {
    mock.restore();
    await cleanTx(user.id);
    await user.cleanup();
  }
});

Deno.test('admin sync_item: 403 on wrong token, 404 unknown item, skipped for sandbox', async () => {
  const mock = installFakeFetch();
  const user = await createTestUser({});
  const sandbox = await addItem(user.id, { env: 'sandbox' });
  try {
    const forbidden = await handler(syncReq(user.accessToken, { action: 'sync_item', item_id: sandbox.itemId }));
    assertEquals(forbidden.status, 403);

    const missing = await handler(syncReq(SERVICE_KEY, { action: 'sync_item', item_id: 'nope' }));
    assertEquals(missing.status, 404);

    const skipped = await handler(syncReq(SERVICE_KEY, { action: 'sync_item', item_id: sandbox.itemId }));
    assertEquals(skipped.status, 200);
    assertEquals((await skipped.json()).skipped, true);
    assertEquals(mock.countMatching('/transactions/sync'), 0);
  } finally {
    mock.restore();
    await cleanTx(user.id);
    await user.cleanup();
  }
});

Deno.test('category mapping is applied on the way in', async () => {
  const mock = installFakeFetch();
  const user = await createTestUser({});
  await addItem(user.id, { cursor: 'c0' });
  try {
    stubAccounts(mock);
    const groceries = tx({
      transaction_id: 'tx_groc', amount: 40,
      personal_finance_category: { primary: 'RENT_AND_UTILITIES', detailed: 'FOOD_AND_DRINK_GROCERIES' },
    });
    const zelleRent = tx({
      transaction_id: 'tx_zelle', amount: 1500, name: 'Zelle payment to landlord', merchant_name: null,
      personal_finance_category: { primary: 'RENT_AND_UTILITIES', detailed: 'RENT_AND_UTILITIES_RENT' },
    });
    const paycheck = tx({
      transaction_id: 'tx_pay', amount: -3200, name: 'ACME PAYROLL', merchant_name: 'ACME',
      personal_finance_category: { primary: 'INCOME', detailed: 'INCOME_WAGES' },
    });
    const mystery = tx({ transaction_id: 'tx_unk', amount: 5, personal_finance_category: null });
    mock.on('POST', '/transactions/sync', () =>
      json(page({ added: [groceries, zelleRent, paycheck, mystery], next_cursor: 'c1', has_more: false })));

    await handler(syncReq(user.accessToken));
    const rows = await txRows(user.id);
    const by = (pid: string) => rows.find((r) => r.plaid_transaction_id === pid)!;

    assertEquals(by('tx_groc').category_name, 'Food & Dining');    // detailed override beats primary
    assertEquals(by('tx_zelle').category_name, 'Transfers');       // P2P description override
    assertEquals(by('tx_pay').type, 'income');                     // negative amount
    assertEquals(by('tx_pay').category_name, 'Income');
    assertEquals(by('tx_unk').category_name, 'Other');             // no category → Other
  } finally {
    mock.restore();
    await cleanTx(user.id);
    await user.cleanup();
  }
});
