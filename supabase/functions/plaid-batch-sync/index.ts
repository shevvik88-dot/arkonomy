// supabase/functions/plaid-batch-sync/index.ts
// Called by a pg_cron job at 06:00 UTC every day.
// Incrementally syncs transactions for ALL users who have a connected Plaid bank.
// Must be invoked with the service role key — rejects any other token.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

// ── Plaid helpers (mirrors plaid-sync-transactions) ───────────────────────────

interface PlaidTransaction {
  transaction_id:              string;
  date:                        string;
  amount:                      number;
  name:                        string;
  merchant_name:               string | null;
  personal_finance_category?:  { primary: string; detailed: string } | null;
  pending:                     boolean;
}
interface PlaidRemovedTransaction { transaction_id: string }

const PRIMARY_MAP: Record<string, string> = {
  FOOD_AND_DRINK:            'Food & Dining',
  GENERAL_MERCHANDISE:       'Shopping',
  TRANSPORTATION:            'Transport',
  TRAVEL:                    'Travel',
  RENT_AND_UTILITIES:        'Housing',
  HOME_IMPROVEMENT:          'Housing',
  ENTERTAINMENT:             'Entertainment',
  MEDICAL:                   'Health',
  PERSONAL_CARE:             'Personal Care',
  LOAN_PAYMENTS:             'Bills',
  BANK_FEES:                 'Bills',
  GENERAL_SERVICES:          'Bills',
  GOVERNMENT_AND_NON_PROFIT: 'Bills',
  EDUCATION:                 'Bills',
  INCOME:                    'Income',
  TRANSFER_IN:               'Income',
  TRANSFER_OUT:              'Other',
};

const DETAILED_OVERRIDE: Array<[string, string]> = [
  ['FOOD_AND_DRINK_GROCERIES', 'Food & Dining'],
  ['GYMS_AND_FITNESS_CENTERS', 'Entertainment'],
  ['PHARMACIES_AND_SUPPLEMENTS', 'Health'],
  ['MORTGAGE', 'Housing'],
  ['BANK_FEES_ATM_FEES', 'Other'],
  ['CASH_ADVANCES_AND_LOANS', 'Other'],
  ['TRANSFER_IN_DEPOSIT', 'Income'],
  ['INCOME_WAGES', 'Income'],
  ['INCOME_TAX_REFUND', 'Income'],
  ['INCOME_DIVIDENDS', 'Income'],
  ['INCOME_INTEREST_EARNED', 'Income'],
  ['GENERAL_SERVICES_INSURANCE', 'Bills'],
  ['GENERAL_SERVICES_SUBSCRIPTION', 'Bills'],
];

function mapCategory(primary?: string, detailed?: string): string {
  if (detailed) {
    const d = detailed.toUpperCase();
    for (const [substr, cat] of DETAILED_OVERRIDE) {
      if (d.includes(substr)) return cat;
    }
  }
  if (!primary) return 'Other';
  return PRIMARY_MAP[primary.toUpperCase()] ?? 'Other';
}

function plaidTxToRow(tx: PlaidTransaction, userId: string) {
  const primaryCat = tx.personal_finance_category?.primary  ?? '';
  const detailCat  = tx.personal_finance_category?.detailed ?? '';
  const catName    = mapCategory(primaryCat, detailCat);
  const isIncome   = tx.amount < 0 || catName === 'Income';
  return {
    user_id:              userId,
    plaid_transaction_id: tx.transaction_id,
    date:                 tx.date,
    amount:               Math.abs(tx.amount),
    type:                 isIncome ? 'income' : 'expense',
    description:          tx.merchant_name ?? tx.name,
    category_name:        isIncome ? 'Income' : catName,
  };
}

async function syncPage(
  plaidBase: string, clientId: string, secret: string,
  accessToken: string, cursor: string | null,
) {
  const body: Record<string, unknown> = { client_id: clientId, secret, access_token: accessToken, count: 500 };
  if (cursor) body.cursor = cursor;
  const res  = await fetch(`${plaidBase}/transactions/sync`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_message ?? data.error_code ?? 'Plaid sync error');
  return data as {
    added: PlaidTransaction[]; modified: PlaidTransaction[];
    removed: PlaidRemovedTransaction[]; next_cursor: string; has_more: boolean;
  };
}

async function syncItem(
  supabase: ReturnType<typeof createClient>,
  plaidBase: string, clientId: string, secret: string,
  item: { id: string; access_token: string; plaid_cursor: string | null; user_id: string },
) {
  let cursor = item.plaid_cursor as string | null;
  let hasMore = true;
  const addedRows: ReturnType<typeof plaidTxToRow>[] = [];
  const modifiedRows: ReturnType<typeof plaidTxToRow>[] = [];
  const removedIds: string[] = [];

  while (hasMore) {
    const page = await syncPage(plaidBase, clientId, secret, item.access_token, cursor);
    for (const tx of page.added)    addedRows.push(plaidTxToRow(tx, item.user_id));
    for (const tx of page.modified) modifiedRows.push(plaidTxToRow(tx, item.user_id));
    for (const tx of page.removed)  removedIds.push(tx.transaction_id);
    cursor  = page.next_cursor;
    hasMore = page.has_more;
  }

  if (addedRows.length > 0)
    await supabase.from('transactions').upsert(addedRows, { onConflict: 'plaid_transaction_id', ignoreDuplicates: false });
  if (modifiedRows.length > 0)
    await supabase.from('transactions').upsert(modifiedRows, { onConflict: 'plaid_transaction_id', ignoreDuplicates: false });
  if (removedIds.length > 0)
    await supabase.from('transactions').delete().in('plaid_transaction_id', removedIds).eq('user_id', item.user_id);
  if (cursor)
    await supabase.from('plaid_items').update({ plaid_cursor: cursor }).eq('id', item.id);

  return { added: addedRows.length, modified: modifiedRows.length, removed: removedIds.length };
}

// ── Handler ───────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '').trim();

  if (token !== serviceKey) {
    return json({ error: 'Forbidden — service role key required' }, 403);
  }

  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey);
    const plaidEnv  = Deno.env.get('PLAID_ENV') ?? 'production';
    const plaidBase = `https://${plaidEnv}.plaid.com`;
    const clientId  = Deno.env.get('PLAID_CLIENT_ID')!;
    const secret    = Deno.env.get('PLAID_SECRET')!;

    const { data: items, error } = await supabase
      .from('plaid_items')
      .select('id, access_token, plaid_cursor, user_id');

    if (error) throw error;

    const now = new Date().toISOString();
    let totalAdded = 0, totalModified = 0, totalRemoved = 0;
    const usersSynced = new Set<string>();
    const errors: string[] = [];

    for (const item of (items ?? [])) {
      try {
        const counts = await syncItem(supabase, plaidBase, clientId, secret, item);
        totalAdded    += counts.added;
        totalModified += counts.modified;
        totalRemoved  += counts.removed;
        usersSynced.add(item.user_id);
      } catch (err) {
        console.error(`Batch sync failed for item ${item.id}:`, err);
        errors.push(`item ${item.id}: ${String(err)}`);
      }
    }

    // Stamp last_synced_at for every user we touched
    if (usersSynced.size > 0) {
      await supabase.from('profiles')
        .update({ last_synced_at: now })
        .in('id', [...usersSynced]);
    }

    return json({
      users_synced: usersSynced.size,
      added:        totalAdded,
      modified:     totalModified,
      removed:      totalRemoved,
      synced_at:    now,
      ...(errors.length > 0 ? { errors } : {}),
    });

  } catch (err) {
    console.error('plaid-batch-sync error:', err);
    return json({ error: String(err) }, 500);
  }
});
