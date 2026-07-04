// supabase/functions/plaid-sync-transactions/index.ts
// Syncs transactions from all connected Plaid items for the authenticated user
// using the /transactions/sync endpoint (cursor-based, incremental).
//
// Normal sync — POST {} with user Bearer token
// → { added, modified, removed, synced }
//
// Admin full re-sync — POST { "action": "resync_all" } with service role Bearer token
// → { users_resynced, added, modified, removed }
// Resets all Plaid cursors, deletes previously synced transactions, re-fetches
// everything from Plaid with updated category mapping.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ── CORS ─────────────────────────────────────────────────────────────────────

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_URL') ?? 'https://app.arkonomy.com',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-firebase-appcheck',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extra },
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// PLAID CATEGORY MAPPING
// Uses Plaid's official personal_finance_category taxonomy.
// mapCategory() checks the detailed field first for subcategory overrides,
// then falls back to the primary field.
//
// personal_finance_category structure:
//   primary:  e.g. "FOOD_AND_DRINK"
//   detailed: e.g. "FOOD_AND_DRINK_GROCERIES"
// ═════════════════════════════════════════════════════════════════════════════

// Primary category → app category
const PRIMARY_MAP: Record<string, string> = {
  // ── Food ──────────────────────────────────────────────────────────────────
  FOOD_AND_DRINK:            'Food & Dining',  // restaurants, cafes, fast food, bars, coffee

  // ── Shopping ──────────────────────────────────────────────────────────────
  GENERAL_MERCHANDISE:       'Shopping',       // retail, department stores, online

  // ── Transport ─────────────────────────────────────────────────────────────
  TRANSPORTATION:            'Transport',      // Uber, Lyft, gas, parking, transit

  // ── Travel ────────────────────────────────────────────────────────────────
  TRAVEL:                    'Travel',         // hotels, flights, Airbnb, rental cars

  // ── Housing ───────────────────────────────────────────────────────────────
  RENT_AND_UTILITIES:        'Housing',        // rent, electricity, water, internet, phone
  HOME_IMPROVEMENT:          'Housing',        // contractors, hardware stores

  // ── Entertainment ─────────────────────────────────────────────────────────
  ENTERTAINMENT:             'Entertainment',  // Netflix, Spotify, movies, games, concerts

  // ── Health ────────────────────────────────────────────────────────────────
  MEDICAL:                   'Health',         // doctors, hospitals, pharmacies

  // ── Personal Care ─────────────────────────────────────────────────────────
  PERSONAL_CARE:             'Personal Care',  // hair salons, spa, beauty, laundry

  // ── Bills ─────────────────────────────────────────────────────────────────
  LOAN_PAYMENTS:             'Bills',          // student loans, car payments, credit cards
  BANK_FEES:                 'Bills',          // overdraft, foreign transaction, interest
  GENERAL_SERVICES:          'Bills',          // insurance, subscriptions, utilities, telecom
  GOVERNMENT_AND_NON_PROFIT: 'Bills',          // taxes, govt services, donations
  EDUCATION:                 'Bills',          // tuition, school fees, student loans

  // ── Income ────────────────────────────────────────────────────────────────
  INCOME:                    'Income',         // wages, dividends, interest, retirement, refunds
  TRANSFER_IN:               'Income',         // deposits, account transfers in

  // ── Transfers (excluded from spending totals) ─────────────────────────────
  TRANSFER_OUT:              'Transfer',       // withdrawals, account transfers out
};

// Detailed subcategory overrides — checked BEFORE primary.
// Keys are substrings of Plaid's detailed field (which is always PRIMARY_SUFFIX).
// These override the primary mapping for specific subcategories that need
// a different category than their parent primary would give.
const DETAILED_OVERRIDE: Array<[substring: string, category: string]> = [
  // Food subcategories (all stay Food & Dining, but explicit for clarity)
  ['FOOD_AND_DRINK_GROCERIES',                  'Food & Dining'],
  ['FOOD_AND_DRINK_COFFEE',                     'Food & Dining'],
  ['FOOD_AND_DRINK_FAST_FOOD',                  'Food & Dining'],
  ['FOOD_AND_DRINK_RESTAURANT',                 'Food & Dining'],
  ['FOOD_AND_DRINK_BEER_WINE_AND_LIQUOR',       'Food & Dining'],

  // Shopping subcategories (under GENERAL_MERCHANDISE)
  ['CLOTHING_AND_APPAREL',                      'Shopping'],
  ['ELECTRONICS',                               'Shopping'],
  ['SPORTING_GOODS',                            'Shopping'],
  ['ONLINE_MARKETPLACES',                       'Shopping'],

  // Gyms → Entertainment (overrides PERSONAL_CARE primary → 'Personal Care')
  ['GYMS_AND_FITNESS_CENTERS',                  'Entertainment'],

  // Pharmacies → Health (MEDICAL primary already maps to Health, but explicit)
  ['PHARMACIES_AND_SUPPLEMENTS',                'Health'],

  // Mortgage → Housing (overrides LOAN_PAYMENTS primary → 'Bills')
  ['MORTGAGE',                                  'Housing'],

  // ATM withdrawals & fees → Transfer (excluded from spending, not "Other")
  ['BANK_FEES_ATM_FEES',                        'Transfer'],
  ['TRANSFER_OUT_WITHDRAWAL',                   'Transfer'],
  ['TRANSFER_OUT_ACCOUNT_TRANSFER',             'Transfer'],

  // Cash advances → Bills (it's real spending, not a transfer)
  ['CASH_ADVANCES_AND_LOANS',                   'Bills'],

  // Government & taxes → own category
  ['GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT',     'Taxes'],
  ['GOVERNMENT_AND_NON_PROFIT_GOVERNMENT_DEPARTMENTS_AND_AGENCIES', 'Government'],

  // Automotive services → Transport
  ['GENERAL_SERVICES_AUTOMOTIVE',               'Transport'],

  // Gyms & fitness → Health & Fitness (more specific than Entertainment)
  ['GYMS_AND_FITNESS_CENTERS',                  'Health & Fitness'],

  // Laundry & dry cleaning → Personal Care
  ['PERSONAL_CARE_LAUNDRY_AND_DRY_CLEANING',    'Personal Care'],

  // Charitable giving → Charity
  ['GOVERNMENT_AND_NON_PROFIT_DONATIONS',       'Charity'],

  // Specific income subtypes
  ['TRANSFER_IN_DEPOSIT',                       'Income'],
  ['INCOME_WAGES',                              'Income'],
  ['INCOME_TAX_REFUND',                         'Income'],
  ['INCOME_DIVIDENDS',                          'Income'],
  ['INCOME_INTEREST_EARNED',                    'Income'],

  // Insurance → Bills (under GENERAL_SERVICES)
  ['GENERAL_SERVICES_INSURANCE',                'Bills'],

  // Subscriptions → Bills
  ['GENERAL_SERVICES_SUBSCRIPTION',             'Bills'],
];

/**
 * Map a Plaid personal_finance_category to an app category name.
 * Checks `detailed` first for subcategory overrides, then falls back to `primary`.
 */
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

// ── Plaid transaction type ────────────────────────────────────────────────────

interface PlaidTransaction {
  transaction_id:             string;
  date:                       string;
  amount:                     number;       // positive = debit/expense, negative = credit/income
  name:                       string;
  merchant_name:              string | null;
  personal_finance_category?: { primary: string; detailed: string } | null;
  pending:                    boolean;
}

interface PlaidRemovedTransaction { transaction_id: string }

function plaidTxToRow(tx: PlaidTransaction, userId: string) {
  const primaryCat = tx.personal_finance_category?.primary  ?? '';
  const detailCat  = tx.personal_finance_category?.detailed ?? '';
  let   catName    = mapCategory(primaryCat, detailCat);
  // Income: Plaid credits are negative amounts, OR the category resolved to Income
  const isIncome   = tx.amount < 0 || catName === 'Income';

  const description = tx.merchant_name ?? tx.name ?? '';

  // Peer-to-peer transfers: visible in chart and counted in spending.
  // Override regardless of Plaid's category (Zelle rent → RENT_AND_UTILITIES → Housing
  // without this check, double-counting actual rent).
  if (!isIncome && /\bzelle\b|\bvenmo\b/i.test(description)) {
    catName = 'Transfers';
  }

  return {
    user_id:              userId,
    plaid_transaction_id: tx.transaction_id,
    date:                 tx.date,
    amount:               Math.abs(tx.amount),
    type:                 isIncome ? 'income' : 'expense',
    description,
    category_name:        isIncome ? 'Income' : catName,
  };
}

// ── Fetch one page of /transactions/sync ─────────────────────────────────────

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

// ── Core sync logic (shared by user sync + admin re-sync) ─────────────────────

async function syncItemTransactions(
  supabase:    ReturnType<typeof createClient>,
  plaidBase:   string,
  clientId:    string,
  secret:      string,
  item:        { id: string; access_token: string; plaid_cursor: string | null; user_id: string },
  seenKeys?:   Set<string>,  // cross-item dedup for users with multiple items at same bank
): Promise<{ added: number; modified: number; removed: number }> {
  let cursor  = item.plaid_cursor as string | null;
  let hasMore = true;

  const addedRows:    ReturnType<typeof plaidTxToRow>[] = [];
  const modifiedRows: ReturnType<typeof plaidTxToRow>[] = [];
  const removedIds:   string[]                          = [];

  while (hasMore) {
    const page = await syncPage(plaidBase, clientId, secret, item.access_token, cursor);
    for (const tx of page.added)    addedRows.push(plaidTxToRow(tx, item.user_id));
    for (const tx of page.modified) modifiedRows.push(plaidTxToRow(tx, item.user_id));
    for (const tx of page.removed)  removedIds.push(tx.transaction_id);
    cursor  = page.next_cursor;
    hasMore = page.has_more;
  }

  // Deduplicate across items from the same bank: skip rows whose
  // (date, description, amount) was already synced by a previous item.
  function dedup(rows: ReturnType<typeof plaidTxToRow>[]) {
    if (!seenKeys) return rows;
    return rows.filter(row => {
      const key = `${row.date}|${row.description}|${row.amount}`;
      if (seenKeys.has(key)) return false;
      seenKeys.add(key);
      return true;
    });
  }

  const dedupedAdded    = dedup(addedRows);
  const dedupedModified = dedup(modifiedRows);

  if (dedupedAdded.length > 0) {
    const { error } = await supabase
      .from('transactions')
      .upsert(dedupedAdded, { onConflict: 'plaid_transaction_id', ignoreDuplicates: false });
    if (error) console.error('upsert added error:', error);
  }

  if (dedupedModified.length > 0) {
    const { error } = await supabase
      .from('transactions')
      .upsert(dedupedModified, { onConflict: 'plaid_transaction_id', ignoreDuplicates: false });
    if (error) console.error('upsert modified error:', error);
  }

  if (removedIds.length > 0) {
    const { error } = await supabase
      .from('transactions')
      .delete()
      .in('plaid_transaction_id', removedIds)
      .eq('user_id', item.user_id);
    if (error) console.error('delete removed error:', error);
  }

  if (cursor) {
    await supabase
      .from('plaid_items')
      .update({ plaid_cursor: cursor })
      .eq('id', item.id);
  }

  return {
    added:    dedupedAdded.length,
    modified: dedupedModified.length,
    removed:  removedIds.length,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// HANDLER
// ═════════════════════════════════════════════════════════════════════════════

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const plaidEnv  = Deno.env.get('PLAID_ENV') ?? 'production';
    const plaidBase = `https://${plaidEnv}.plaid.com`;
    const clientId  = Deno.env.get('PLAID_CLIENT_ID')!;
    const secret    = Deno.env.get('PLAID_SECRET')!;

    const authHeader = req.headers.get('Authorization') ?? '';
    const token      = authHeader.replace('Bearer ', '').trim();

    // ── Admin re-sync mode ────────────────────────────────────────────────────
    // POST { "action": "resync_all" } with the service role key.
    // Resets all Plaid cursors, deletes all previously synced transactions,
    // then re-fetches everything from Plaid for every connected user.
    if (req.method === 'POST') {
      let body: Record<string, unknown> = {};
      try { body = await req.json(); } catch { /* no body */ }

      if (body?.action === 'resync_all') {
        if (token !== Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) {
          return json({ error: 'Forbidden — service role key required' }, 403, corsHeaders);
        }

        // 1. Delete all Plaid-synced transactions (leave manually entered ones)
        const { error: delErr } = await supabase
          .from('transactions')
          .delete()
          .not('plaid_transaction_id', 'is', null);
        if (delErr) throw new Error(`Failed to delete plaid transactions: ${delErr.message}`);

        // 2. Reset all cursors so sync restarts from the beginning
        const { error: cursorErr } = await supabase
          .from('plaid_items')
          .update({ plaid_cursor: null })
          .not('id', 'is', null);
        if (cursorErr) throw new Error(`Failed to reset cursors: ${cursorErr.message}`);

        // 3. Re-sync every connected bank item across all users
        const { data: allItems, error: itemsErr } = await supabase
          .from('plaid_items')
          .select('id, access_token, plaid_cursor, user_id');
        if (itemsErr) throw itemsErr;

        let totalAdded = 0, totalModified = 0, totalRemoved = 0;
        const usersSeen = new Set<string>();

        for (const item of (allItems ?? [])) {
          try {
            const counts = await syncItemTransactions(
              supabase, plaidBase, clientId, secret,
              { ...item, plaid_cursor: null },  // cursor already reset
            );
            totalAdded    += counts.added;
            totalModified += counts.modified;
            totalRemoved  += counts.removed;
            usersSeen.add(item.user_id);
          } catch (err) {
            console.error(`Re-sync failed for item ${item.id}:`, err);
          }
        }

        return json({
          action:         'resync_all',
          users_resynced: usersSeen.size,
          added:          totalAdded,
          modified:       totalModified,
          removed:        totalRemoved,
        }, 200, corsHeaders);
      }

      // ── Webhook-triggered per-item sync ────────────────────────────────────
      if (body?.action === 'sync_item' && body?.item_id) {
        if (token !== Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) {
          return json({ error: 'Forbidden — service role key required' }, 403, corsHeaders);
        }
        const { data: item, error: itemErr } = await supabase
          .from('plaid_items')
          .select('id, access_token, plaid_cursor, user_id')
          .eq('item_id', body.item_id as string)
          .single();
        if (itemErr || !item) return json({ error: 'Item not found' }, 404, corsHeaders);
        const counts = await syncItemTransactions(supabase, plaidBase, clientId, secret, item);
        await supabase.from('plaid_items').update({ error_code: null }).eq('id', item.id);
        return json({ action: 'sync_item', ...counts }, 200, corsHeaders);
      }
    }

    // ── Normal per-user sync ──────────────────────────────────────────────────
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return json({ error: 'Unauthorized' }, 401, corsHeaders);

    const { data: items, error: itemsErr } = await supabase
      .from('plaid_items')
      .select('id, access_token, plaid_cursor, user_id')
      .eq('user_id', user.id);

    if (itemsErr) throw itemsErr;
    if (!items || items.length === 0) {
      return json({ added: 0, modified: 0, removed: 0, synced: 0 }, 200, corsHeaders);
    }

    let totalAdded = 0, totalModified = 0, totalRemoved = 0;
    const seenKeys = new Set<string>();

    for (const item of items) {
      const counts = await syncItemTransactions(
        supabase, plaidBase, clientId, secret,
        { ...item, user_id: user.id },
        seenKeys,
      );
      totalAdded    += counts.added;
      totalModified += counts.modified;
      totalRemoved  += counts.removed;
    }

    return json(
      { added: totalAdded, modified: totalModified, removed: totalRemoved, synced: totalAdded + totalModified },
      200,
      corsHeaders,
    );

  } catch (err) {
    console.error('plaid-sync-transactions error:', err);
    return json({ error: "Internal Server Error" }, 500, corsHeaders);
  }
});
