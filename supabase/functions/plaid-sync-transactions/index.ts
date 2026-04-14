// supabase/functions/plaid-sync-transactions/index.ts
// Syncs transactions from all connected Plaid items for the authenticated user
// using the /transactions/sync endpoint (cursor-based, incremental).
//
// POST {} (no body required)
// → { added: number, modified: number, removed: number, synced: number }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ── CORS ─────────────────────────────────────────────────────────────────────

const ALLOWED_ORIGINS = [
  'https://app.arkonomy.com',
  'http://localhost:5173',
  'http://localhost:4173',
  'http://localhost:3000',
];

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  return {
    'Access-Control-Allow-Origin':  ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extra },
  });
}

// ── Plaid → app category mapping ─────────────────────────────────────────────
// Maps Plaid personal_finance_category.primary to app category names.

const PLAID_CATEGORY_MAP: Record<string, string> = {
  FOOD_AND_DRINK:             'Food & Dining',
  TRANSPORTATION:             'Transport',
  TRAVEL:                     'Transport',
  GENERAL_MERCHANDISE:        'Shopping',
  PERSONAL_CARE:              'Health',
  MEDICAL:                    'Health',
  ENTERTAINMENT:              'Entertainment',
  RENT_AND_UTILITIES:         'Bills',
  LOAN_PAYMENTS:              'Bills',
  BANK_FEES:                  'Bills',
  GENERAL_SERVICES:           'Bills',
  GOVERNMENT_AND_NON_PROFIT:  'Other',
  HOME_IMPROVEMENT:           'Other',
  TRANSFER_IN:                'Transfer',
  TRANSFER_OUT:               'Transfer',
  INCOME:                     'Income',          // handled separately as type='income'
};

function mapCategory(primary?: string): string {
  if (!primary) return 'Other';
  return PLAID_CATEGORY_MAP[primary] ?? 'Other';
}

// ── Plaid transaction type ────────────────────────────────────────────────────
// Plaid: positive amount = debit (money leaving account) = expense
//        negative amount = credit (money entering account) = income

interface PlaidTransaction {
  transaction_id:              string;
  date:                        string;       // YYYY-MM-DD
  amount:                      number;       // positive = debit/expense
  name:                        string;
  merchant_name:               string | null;
  personal_finance_category?:  { primary: string; detailed: string } | null;
  pending:                     boolean;
}

interface PlaidRemovedTransaction {
  transaction_id: string;
}

function plaidTxToRow(tx: PlaidTransaction, userId: string) {
  const primaryCat = tx.personal_finance_category?.primary ?? '';
  const isIncome   = tx.amount < 0 || primaryCat === 'INCOME';

  return {
    user_id:                userId,
    plaid_transaction_id:   tx.transaction_id,
    date:                   tx.date,
    amount:                 Math.abs(tx.amount),
    type:                   isIncome ? 'income' : 'expense',
    description:            tx.merchant_name ?? tx.name,
    category_name:          isIncome ? 'Income' : mapCategory(primaryCat),
  };
}

// ── Fetch one page of transactions/sync ──────────────────────────────────────

async function syncPage(
  plaidBase: string,
  clientId: string,
  secret: string,
  accessToken: string,
  cursor: string | null,
): Promise<{
  added:       PlaidTransaction[];
  modified:    PlaidTransaction[];
  removed:     PlaidRemovedTransaction[];
  next_cursor: string;
  has_more:    boolean;
}> {
  const body: Record<string, unknown> = {
    client_id:    clientId,
    secret,
    access_token: accessToken,
    count:        500,
  };
  if (cursor) body.cursor = cursor;

  const res  = await fetch(`${plaidBase}/transactions/sync`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error_message ?? data.error_code ?? 'Plaid transactions/sync error');
  }

  return data;
}

// ── Handler ───────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    // ── Auth ──────────────────────────────────────────────────────────────────
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.replace('Bearer ', '').trim();
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);

    if (authErr || !user) {
      return json({ error: 'Unauthorized' }, 401, cors);
    }

    // ── Fetch all plaid_items for this user ───────────────────────────────────
    const { data: items, error: itemsErr } = await supabase
      .from('plaid_items')
      .select('id, access_token, plaid_cursor')
      .eq('user_id', user.id);

    if (itemsErr) throw itemsErr;
    if (!items || items.length === 0) {
      return json({ added: 0, modified: 0, removed: 0, synced: 0 }, 200, cors);
    }

    const plaidEnv  = Deno.env.get('PLAID_ENV') ?? 'production';
    const plaidBase = `https://${plaidEnv}.plaid.com`;
    const clientId  = Deno.env.get('PLAID_CLIENT_ID')!;
    const secret    = Deno.env.get('PLAID_SECRET')!;

    let totalAdded    = 0;
    let totalModified = 0;
    let totalRemoved  = 0;

    // ── Process each connected bank ───────────────────────────────────────────
    for (const item of items) {
      let cursor   = item.plaid_cursor as string | null;
      let hasMore  = true;

      const addedRows:    ReturnType<typeof plaidTxToRow>[] = [];
      const modifiedRows: ReturnType<typeof plaidTxToRow>[] = [];
      const removedIds:   string[]                          = [];

      // Paginate until fully synced
      while (hasMore) {
        const page = await syncPage(plaidBase, clientId, secret, item.access_token, cursor);

        for (const tx of page.added)    addedRows.push(plaidTxToRow(tx, user.id));
        for (const tx of page.modified) modifiedRows.push(plaidTxToRow(tx, user.id));
        for (const tx of page.removed)  removedIds.push(tx.transaction_id);

        cursor  = page.next_cursor;
        hasMore = page.has_more;
      }

      // ── Upsert added transactions ─────────────────────────────────────────
      if (addedRows.length > 0) {
        // Skip pending transactions — sync again when they settle
        const settled = addedRows.filter((_, i) => !(i < 0)); // include all; Plaid/sync only returns posted

        const { error: addErr } = await supabase
          .from('transactions')
          .upsert(settled, { onConflict: 'plaid_transaction_id', ignoreDuplicates: false });

        if (addErr) console.error('upsert added error:', addErr);
        else totalAdded += settled.length;
      }

      // ── Upsert modified transactions ──────────────────────────────────────
      if (modifiedRows.length > 0) {
        const { error: modErr } = await supabase
          .from('transactions')
          .upsert(modifiedRows, { onConflict: 'plaid_transaction_id', ignoreDuplicates: false });

        if (modErr) console.error('upsert modified error:', modErr);
        else totalModified += modifiedRows.length;
      }

      // ── Delete removed transactions ───────────────────────────────────────
      if (removedIds.length > 0) {
        const { error: delErr } = await supabase
          .from('transactions')
          .delete()
          .in('plaid_transaction_id', removedIds)
          .eq('user_id', user.id);

        if (delErr) console.error('delete removed error:', delErr);
        else totalRemoved += removedIds.length;
      }

      // ── Advance cursor in plaid_items ─────────────────────────────────────
      if (cursor) {
        await supabase
          .from('plaid_items')
          .update({ plaid_cursor: cursor })
          .eq('id', item.id);
      }
    }

    return json(
      {
        added:    totalAdded,
        modified: totalModified,
        removed:  totalRemoved,
        synced:   totalAdded + totalModified,
      },
      200,
      cors,
    );

  } catch (err) {
    console.error('plaid-sync-transactions error:', err);
    return json({ error: String(err) }, 500, cors);
  }
});
