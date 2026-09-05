// supabase/functions/generate-monthly-report/index.ts
// Generates a monthly financial Excel report (.xlsx) and emails it via Resend.
// Each run rebuilds the full workbook with one sheet per month + a Summary sheet.
//
// Trigger: Supabase pg_cron — "0 8 1 * *" (1st of every month at 08:00 UTC)
// Manual:  POST /generate-monthly-report  { "userId": "...", "email": "..." }
//
// Required secrets (supabase secrets set KEY=value):
//   SUPABASE_URL              — auto-provided by runtime
//   SUPABASE_SERVICE_ROLE_KEY — auto-provided by runtime
//   RESEND_API_KEY            — https://resend.com (free tier: 100 emails/day)
//   REPORT_FROM               — verified sender, e.g. "Arkonomy <hello@arkonomy.app>"

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import ExcelJS from 'npm:exceljs@4.4.0';
import { initSentry, captureAndFlush } from '../_shared/sentry.ts';
import { isRealExpense, isRealIncome, isTransferCategory } from '../_shared/financialConstants.ts';

initSentry('generate-monthly-report');

// ── Colour palette (dark-theme Excel) ────────────────────────────────────────
// green/red fixed 2026-09-02: these used to be generic bright green/red
// (FF12D18E/FFFF5C7A) picked independently of the app's own design system.
// Now the exact hex the app itself uses for the same meaning — DASHBOARD_C
// (src/utils/colors.js): emerald "#2FB37D" for positive/income, ruby
// "#D64F5E" for negative/over-budget — so a user who knows what "Arkonomy
// green" and "Arkonomy red" look like in the app sees the same colors here.
// greenBg/redBg/*Light stay dark background TINTS (unreadable as solid
// fills on a dark sheet otherwise) but are now actually derived from those
// same two hex values — same hue and saturation, lightness dropped to ~8%
// (11% for the *Light row-tint variants) — rather than independently
// hand-picked dark shades that merely happened to be in the same color
// family. Same technique this codebase already uses for CAT_COLORS'
// desaturation remap (colors.js) — an HSL transform off a canonical color,
// not an arbitrary new pick.
const ARGB = {
  headerBg:    'FF0D1F3C',
  headerFg:    'FF00C2FF',
  cellBg:      'FF0B1426',
  totalBg:     'FF111E33',
  sep:         'FF1E2D4A',
  textPrimary: 'FFE8EDF5',
  // Brightened 2026-09-02 per design feedback (day-by-day expense numbers
  // hard to read) — same hue/saturation as the original FF9AA4B2, lightness
  // raised from 65% to 75% (contrast ratio against ARGB.totalBg goes from
  // 6.6:1 to 8.9:1). Only consumer is the populated expense day-cell font,
  // so this doesn't touch anything else's "muted" tone in the sheet.
  textMuted:   'FFB7BEC8',
  textFaint:   'FF4A5E7A',
  green:       'FF2FB37D', // DC.emerald, exact
  greenBg:     'FF082017', // DC.emerald, same H/S, L→8%
  greenBgLight:'FF0C2C1F', // DC.emerald, same H/S, L→11%
  red:         'FFD64F5E', // DC.ruby, exact
  redBg:       'FF21080B', // DC.ruby, same H/S, L→8%
  redBgLight:  'FF2E0B0E', // DC.ruby, same H/S, L→11%
  yellow:      'FFFFB800',
};

const FILL = {
  header: { type: 'pattern', pattern: 'solid', fgColor: { argb: ARGB.headerBg } },
  total:  { type: 'pattern', pattern: 'solid', fgColor: { argb: ARGB.totalBg  } },
  cell:   { type: 'pattern', pattern: 'solid', fgColor: { argb: ARGB.cellBg   } },
  green:  { type: 'pattern', pattern: 'solid', fgColor: { argb: ARGB.greenBg  } },
  red:    { type: 'pattern', pattern: 'solid', fgColor: { argb: ARGB.redBg    } },
  rowGreen: { type: 'pattern', pattern: 'solid', fgColor: { argb: ARGB.greenBgLight } },
  rowRed:   { type: 'pattern', pattern: 'solid', fgColor: { argb: ARGB.redBgLight   } },
} as const;

// Design-feedback fix (2026-09-02): the boundary between daily data and the
// Total/Budget/Difference summary columns only had a 'thin' border in
// ARGB.sep (the same muted tone used for every other internal separator in
// the sheet), so it didn't actually read as a boundary — same weight as
// every other cell edge. This is deliberately its own distinct style
// (thick + the header's own bright cyan) so it's visually unmistakable
// where per-day data ends and the summary begins, applied to every row
// that crosses it: header, each category row, Income, and the Daily
// Total/Grand Total row.
const STRONG_DIVIDER = { style: 'thick', color: { argb: ARGB.headerFg } } as const;

const EXPENSE_CATEGORIES = ['Housing', 'Food', 'Shopping', 'Bills', 'Transport', 'Entertainment', 'Other'];
const ALL_ROW_LABELS     = [...EXPENSE_CATEGORIES, 'Income'];

// ── Category normaliser ───────────────────────────────────────────────────────
const CAT_MAP: Record<string, string> = {
  housing: 'Housing', rent: 'Housing', mortgage: 'Housing',
  food: 'Food', groceries: 'Food', dining: 'Food', restaurant: 'Food', coffee: 'Food',
  shopping: 'Shopping', clothing: 'Shopping', retail: 'Shopping', amazon: 'Shopping',
  bills: 'Bills', utilities: 'Bills', subscription: 'Bills', insurance: 'Bills', phone: 'Bills',
  transport: 'Transport', transportation: 'Transport', travel: 'Transport', gas: 'Transport', uber: 'Transport', lyft: 'Transport',
  entertainment: 'Entertainment', leisure: 'Entertainment', streaming: 'Entertainment',
  income: 'Income', salary: 'Income', paycheck: 'Income', deposit: 'Income',
};

function normCat(raw: string | null | undefined): string {
  if (!raw) return 'Other';
  const lower = raw.toLowerCase().trim();
  if (CAT_MAP[lower]) return CAT_MAP[lower];
  for (const k of Object.keys(CAT_MAP)) {
    if (lower.includes(k)) return CAT_MAP[k];
  }
  return EXPENSE_CATEGORIES.includes(raw) ? raw : 'Other';
}

// ── Date helpers ──────────────────────────────────────────────────────────────
function daysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

// ── Amount formatter ─────────────────────────────────────────────────────────
function fmt(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ═════════════════════════════════════════════════════════════════════════════
// CORS + SERVE
// ═════════════════════════════════════════════════════════════════════════════

// Same allow-list pattern as auth-login/market-data (2026-09-02, found
// while trying to manually trigger this function from a Vercel preview
// deployment for verification — preview subdomains get a fresh random
// hash on every push, so the previous single-origin CORS made this
// function's "User path" (manual on-demand trigger, see header comment)
// completely unreachable from any preview, only from production.
const PROD_ORIGIN = Deno.env.get('APP_URL') ?? 'https://app.arkonomy.com';
const ALLOWED_ORIGINS: (string | RegExp)[] = [
  PROD_ORIGIN,
  /^https:\/\/arkonomy-[a-z0-9-]+-shevvik88-dots-projects\.vercel\.app$/,
];

function resolveCorsHeaders(req: Request) {
  const origin = req.headers.get('origin') ?? '';
  const allowedOrigin = ALLOWED_ORIGINS.some(o => typeof o === 'string' ? o === origin : o.test(origin))
    ? origin
    : PROD_ORIGIN;
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };
}

Deno.serve(async (req) => {
  const CORS = resolveCorsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const resendKey = Deno.env.get('RESEND_API_KEY');
    const fromAddr  = Deno.env.get('REPORT_FROM') ?? 'Arkonomy <noreply@arkonomy.app>';

    if (!resendKey) {
      return new Response(JSON.stringify({ error: 'RESEND_API_KEY not configured' }), {
        status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // ── Auth ──────────────────────────────────────────────────────────────────
    // Cron path:  Authorization: Bearer <service_role_key>  → sends to all users
    // User path:  Authorization: Bearer <user_jwt>          → sends only to that user
    const token = req.headers.get('Authorization')?.replace('Bearer ', '') ?? '';
    if (!token) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const isCron = token === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    // ── Load profiles ─────────────────────────────────────────────────────────
    const EXCEL_PREFS_SELECT = 'excel_frequency,next_excel_at';
    type Profile = { id: string; full_name: string | null; email: string | null; monthly_budget: number | null; _prefs?: any };
    let profiles: Profile[];

    if (isCron) {
      // Batch mode — cron job only; email always comes from DB.
      // notification_preferences.user_id references auth.users, not profiles,
      // so PostgREST can't embedded-join profiles+notification_preferences
      // (no FK between the two tables) — fetch separately and merge here.
      const { data: profileRows, error: profileErr } = await supabase
        .from('profiles').select('id, full_name, email, monthly_budget');
      if (profileErr || !profileRows?.length) {
        return new Response(JSON.stringify({ error: 'No users found', detail: profileErr }), {
          status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
        });
      }
      const { data: prefsRows, error: prefsErr } = await supabase
        .from('notification_preferences')
        .select(`${EXCEL_PREFS_SELECT},user_id`)
        .in('user_id', profileRows.map(p => p.id));
      if (prefsErr) {
        return new Response(JSON.stringify({ error: 'Failed to load notification preferences', detail: prefsErr }), {
          status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
        });
      }
      const prefsByUser = new Map((prefsRows ?? []).map((p: any) => [p.user_id, p]));
      profiles = profileRows.map(p => ({ ...(p as Profile), _prefs: prefsByUser.get(p.id) ?? null }));
    } else {
      // User mode — validate JWT; email always comes from DB, never from request body
      const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
      if (authErr || !user) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401, headers: { ...CORS, 'Content-Type': 'application/json' },
        });
      }
      const { data: p, error: profileErr } = await supabase
        .from('profiles').select('id, full_name, email, monthly_budget')
        .eq('id', user.id).single();
      if (profileErr || !p) {
        return new Response(JSON.stringify({ error: 'User profile not found' }), {
          status: 404, headers: { ...CORS, 'Content-Type': 'application/json' },
        });
      }
      profiles = [{ ...(p as Profile), _prefs: null }];
    }

    const results: { userId: string; status: string; error?: string }[] = [];

    const DEFAULT_EXCEL_PREFS = { excel_frequency: 'monthly', next_excel_at: null as string | null };

    for (const user of profiles) {
      if (!user.email) continue;
      try {
        const now = new Date();
        const excelPrefs = { ...DEFAULT_EXCEL_PREFS, ...(user._prefs ?? {}) };

        // Cron-only: respect excel_frequency & schedule
        if (isCron) {
          if (excelPrefs.excel_frequency === 'off') {
            results.push({ userId: user.id, status: 'skipped', error: 'excel_frequency=off' }); continue;
          }
          if (excelPrefs.next_excel_at && new Date(excelPrefs.next_excel_at) > now) {
            results.push({ userId: user.id, status: 'skipped', error: 'not_due_yet' }); continue;
          }
        }

        // ── Fetch all transactions (paginated) ───────────────────────────────
        // Bug fix (2026-09-02): this used to be a single unbounded .select()
        // with no .limit(), silently capped at PostgREST's default 1000-row
        // "Max Rows" project setting. Confirmed live: this account has 1,328
        // transactions, and the 1000th row (ordered ascending) lands on
        // 2026-05-11 — an exact match for the report stopping at May while
        // real activity continued through August. Not a date-calculation
        // bug — `now` is never used to bound this fetch at all, only for the
        // email's report-month label below, which is why the email said
        // "August 2026" while the actual sheets stopped in May: two
        // unrelated pieces of the function agreeing on nothing.
        //
        // Paginate with .range() until a page comes back short — scales to
        // any transaction count instead of re-capping at the next
        // round-number threshold.
        const PAGE_SIZE = 1000;
        const txns: Tx[] = [];
        for (let from = 0; ; from += PAGE_SIZE) {
          const { data: page, error: txErr } = await supabase
            .from('transactions')
            .select('date, amount, category_name, type, description')
            .eq('user_id', user.id)
            .order('date', { ascending: true })
            .range(from, from + PAGE_SIZE - 1);

          if (txErr) throw new Error(`DB error: ${txErr.message}`);
          if (!page || page.length === 0) break;
          txns.push(...(page as Tx[]));
          if (page.length < PAGE_SIZE) break;
        }

        if (txns.length === 0) {
          results.push({ userId: user.id, status: 'skipped', error: 'No transactions found' });
          continue;
        }

        const monthlyBudget = Number(user.monthly_budget ?? 3000);

        // ── Build workbook ──────────────────────────────────────────────────
        const workbook = await buildWorkbook(txns, monthlyBudget);

        // ── Encode to base64 ────────────────────────────────────────────────
        const rawBuffer  = await workbook.xlsx.writeBuffer();
        const uint8      = new Uint8Array(rawBuffer as ArrayBuffer);
        let   binary     = '';
        const CHUNK      = 8192;
        for (let i = 0; i < uint8.length; i += CHUNK) {
          binary += String.fromCharCode(...uint8.subarray(i, i + CHUNK));
        }
        const base64 = btoa(binary);

        // ── Determine report label (previous calendar month) ────────────────
        const reportDate  = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const reportLabel = reportDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        const filename    = `Arkonomy_Report_${reportDate.getFullYear()}.xlsx`;

        // ── Send via Resend ─────────────────────────────────────────────────
        const res = await fetch('https://api.resend.com/emails', {
          method:  'POST',
          headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from:        fromAddr,
            to:          [user.email],
            subject:     `Your Arkonomy Monthly Report — ${reportLabel}`,
            html:        buildEmailHtml(user.full_name || user.email, reportLabel),
            attachments: [{ filename, content: base64 }],
          }),
        });

        const resBody = await res.json();
        if (!res.ok) throw new Error(resBody.message ?? JSON.stringify(resBody));

        // Update next_excel_at after successful send (cron only)
        if (isCron) {
          const freqDays = excelPrefs.excel_frequency === 'quarterly' ? 90 : 30;
          const nextAt = new Date(now.getTime() + freqDays * 86_400_000).toISOString();
          await supabase.from('notification_preferences').upsert(
            { user_id: user.id, ...DEFAULT_EXCEL_PREFS, ...excelPrefs, next_excel_at: nextAt },
            { onConflict: 'user_id' }
          );
        }

        results.push({ userId: user.id, status: 'sent' });
      } catch (err) {
        console.error(`Report failed for user ${user.id}:`, err);
        results.push({ userId: user.id, status: 'failed', error: "Internal Server Error" });
      }
    }

    return new Response(JSON.stringify({ results }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('generate-monthly-report error:', err);
    await captureAndFlush(err, { function_name: 'generate-monthly-report' });
    return new Response(JSON.stringify({ error: "Internal Server Error" }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// WORKBOOK BUILDER
// ═════════════════════════════════════════════════════════════════════════════

interface Tx { date: string; amount: number | string; category_name: string | null; type: string; description?: string | null }

async function buildWorkbook(txns: Tx[], monthlyBudget: number): Promise<InstanceType<typeof ExcelJS.Workbook>> {
  const wb       = new ExcelJS.Workbook();
  wb.creator     = 'Arkonomy';
  wb.created     = new Date();
  wb.modified    = new Date();
  wb.company     = 'Arkonomy';

  // Group by "YYYY-MM"
  const byMonth: Record<string, Tx[]> = {};
  for (const t of txns) {
    const key = (t.date ?? '').slice(0, 7);
    if (!key || key.length < 7) continue;
    (byMonth[key] ??= []).push(t);
  }

  const monthKeys = Object.keys(byMonth).sort();
  if (monthKeys.length === 0) throw new Error('No valid transaction dates');

  // Historical average per expense category (across all months)
  // isRealExpense fix (2026-09-02, see data-matrix loop in addMonthSheet for
  // full rationale): excludes Transfer/Transfers/Zelle/Venmo, same as every
  // other consumer of this predicate.
  const catHistAvg: Record<string, number> = {};
  for (const cat of EXPENSE_CATEGORIES) {
    const monthlyTotals = monthKeys.map(k =>
      byMonth[k]
        .filter(t => isRealExpense(t) && normCat(t.category_name) === cat)
        .reduce((s, t) => s + Number(t.amount), 0)
    );
    catHistAvg[cat] = monthlyTotals.reduce((a, b) => a + b, 0) / (monthlyTotals.length || 1);
  }

  // One sheet per month (chronological)
  for (const key of monthKeys) {
    addMonthSheet(wb, key, byMonth[key], monthlyBudget, catHistAvg);
  }

  // Summary sheet (always last)
  addSummarySheet(wb, monthKeys, byMonth, monthlyBudget);

  return wb;
}

// ─── Month Sheet ─────────────────────────────────────────────────────────────

function addMonthSheet(
  wb: InstanceType<typeof ExcelJS.Workbook>,
  monthKey: string,
  txns: Tx[],
  monthlyBudget: number,
  catHistAvg: Record<string, number>,
) {
  const [y, m] = monthKey.split('-').map(Number);
  const days   = daysInMonth(y, m);
  const label  = monthLabel(monthKey);

  // Daily budget threshold for cell colouring
  const dailyBudget = monthlyBudget / days;

  const ws = wb.addWorksheet(label, {
    properties: { tabColor: { argb: ARGB.headerFg } },
    views: [{ state: 'frozen', xSplit: 1, ySplit: 1 }],
  });

  // ── Column widths ──────────────────────────────────────────────────────────
  ws.getColumn(1).width = 16;                            // Category name
  for (let d = 2; d <= days + 1; d++) ws.getColumn(d).width = 7.5;
  ws.getColumn(days + 2).width = 13;                     // Total
  ws.getColumn(days + 3).width = 13;                     // Budget
  ws.getColumn(days + 4).width = 13;                     // Difference

  // ── Build data matrix  data[label][day0..dayN-1] ──────────────────────────
  const data: Record<string, number[]> = {};
  for (const lbl of ALL_ROW_LABELS) data[lbl] = new Array(days).fill(0);

  for (const t of txns) {
    const day = parseInt((t.date ?? '').slice(8, 10), 10);
    if (!day || day < 1 || day > days) continue;
    // Transfer exclusion fix (2026-09-02): this used to fall through
    // normCat() straight into the 'Other' bucket, since "Transfer"/
    // "Transfers" isn't in CAT_MAP and isn't one of the 7 EXPENSE_CATEGORIES
    // — same class of bug already fixed everywhere else in the app
    // (Transactions, AI chat, Dashboard, Insights, financial-diagnosis all
    // use isRealExpense/isRealIncome/isTransferCategory to exclude Transfer/
    // Zelle/Venmo from "real spending"/"real income"). This report was the
    // one surface still counting transfers as expenses, so a user comparing
    // the downloaded report against the in-app numbers for the same month
    // saw two different Total Expenses figures. Skipped here (not sent to
    // 'Other' or 'Income') so it matches every other consumer exactly. Both
    // legs are dropped — including an incoming Zelle/Venmo credit that would
    // otherwise land in the Income row (2026-09-03).
    if (isTransferCategory(t)) continue;
    const cat = t.type === 'income' ? 'Income' : normCat(t.category_name);
    if (data[cat] !== undefined) data[cat][day - 1] += Number(t.amount);
  }

  // ── Row 1: header ──────────────────────────────────────────────────────────
  const hdrRow = ws.getRow(1);
  hdrRow.height = 24;

  styleCell(hdrRow.getCell(1), {
    value: 'Category', fill: FILL.header,
    font: { bold: true, color: { argb: ARGB.headerFg }, size: 11 },
    alignment: { horizontal: 'left', vertical: 'middle' },
    border: { bottom: { style: 'medium', color: { argb: ARGB.sep } } },
  });

  for (let d = 1; d <= days; d++) {
    styleCell(hdrRow.getCell(d + 1), {
      value: d, fill: FILL.header,
      font: { bold: true, color: { argb: ARGB.headerFg }, size: 10 },
      alignment: { horizontal: 'center', vertical: 'middle' },
      border: { bottom: { style: 'medium', color: { argb: ARGB.sep } } },
    });
  }

  styleCell(hdrRow.getCell(days + 2), {
    value: 'Total', fill: FILL.header,
    font: { bold: true, color: { argb: ARGB.headerFg }, size: 11 },
    alignment: { horizontal: 'right', vertical: 'middle' },
    border: { bottom: { style: 'medium', color: { argb: ARGB.sep } }, left: STRONG_DIVIDER },
  });

  styleCell(hdrRow.getCell(days + 3), {
    value: 'Budget', fill: FILL.header,
    font: { bold: true, color: { argb: ARGB.headerFg }, size: 11 },
    alignment: { horizontal: 'right', vertical: 'middle' },
    border: { bottom: { style: 'medium', color: { argb: ARGB.sep } } },
  });

  styleCell(hdrRow.getCell(days + 4), {
    value: 'Difference', fill: FILL.header,
    font: { bold: true, color: { argb: ARGB.headerFg }, size: 11 },
    alignment: { horizontal: 'right', vertical: 'middle' },
    border: { bottom: { style: 'medium', color: { argb: ARGB.sep } } },
  });

  // ── Data rows ──────────────────────────────────────────────────────────────
  ALL_ROW_LABELS.forEach((lbl, idx) => {
    const row      = ws.getRow(idx + 2);
    const isIncome = lbl === 'Income';
    const vals     = data[lbl];
    const rowTotal = vals.reduce((a, b) => a + b, 0);

    row.height = 19;

    // Category name
    styleCell(row.getCell(1), {
      value: lbl, fill: FILL.total,
      font: { bold: true, color: { argb: ARGB.textPrimary }, size: 11 },
      alignment: { horizontal: 'left', vertical: 'middle' },
    });

    // Day cells
    for (let d = 0; d < days; d++) {
      const v    = vals[d];
      const cell = row.getCell(d + 2);

      if (v > 0) {
        cell.value  = v;
        cell.numFmt = '#,##0.00';

        if (isIncome) {
          styleCell(cell, {
            fill: FILL.green,
            font: { color: { argb: ARGB.green }, size: 10 },
            alignment: { horizontal: 'right', vertical: 'middle' },
          });
        } else {
          // Fixed 2026-09-02: this used to compare a single category's
          // single-day amount against `dailyBudget` (monthlyBudget/days) —
          // the whole month's TOTAL daily budget across all 7 categories
          // combined, not a per-category threshold. A $40 grocery day was
          // being judged against ~$200+/day of total household budget, so
          // it was almost always "under" and rendered green — identical to
          // an income cell. Confirmed via git blame: present since this
          // function's original commit, not a regression.
          //
          // No threshold at this granularity now, by design (2026-09-02
          // decision): a single day's spend in one category is too noisy a
          // sample to judge against anything, and the report already has
          // two correctly-scoped over/under signals — the row total vs.
          // that category's own historical monthly average, and the Daily
          // Total row vs. the full daily budget. A third, noisier per-cell
          // check would just flag ordinary purchases as if something's
          // wrong. Flat neutral tint for every expense day-cell instead —
          // reuses the same total/structural tone (ARGB.totalBg +
          // textMuted) the rest of the sheet already uses for "present but
          // not being judged," so it doesn't invent a new color meaning.
          styleCell(cell, {
            fill: FILL.total,
            font: { color: { argb: ARGB.textMuted }, size: 10 },
            alignment: { horizontal: 'right', vertical: 'middle' },
          });
        }
      } else {
        styleCell(cell, {
          fill: FILL.cell,
          font: { color: { argb: ARGB.textFaint }, size: 10 },
          alignment: { horizontal: 'right', vertical: 'middle' },
        });
      }
    }

    // Row total
    const totalCell = row.getCell(days + 2);
    totalCell.value  = rowTotal;
    totalCell.numFmt = '$#,##0.00';

    // Budget / Difference (2026-09-02): makes the Total column's red/green
    // self-explanatory without a legend — the numbers next to it justify
    // the color instead of the reader having to remember what it means.
    //
    // Source for "Budget": checked for a real per-category budget first —
    // the categories table does have a `budget` column, populated with
    // real values on this account (Bills $800, Shopping $400, etc.) — but
    // its category names don't line up with this report's fixed 7-bucket
    // taxonomy ("Food & Dining" vs. this report's "Food", a "Health"
    // budget with no matching report row at all, no row for "Housing" or
    // "Other"), and it's not read anywhere else in the app — no UI exists
    // to view or edit it today, so it's most likely an orphaned column
    // from a removed feature, not a live source of truth. Using it here
    // would also disagree with the Total cell's own color, which is
    // already decided by catHistAvg — showing a *different* number next
    // to that color would undermine the "self-explanatory" goal rather
    // than serve it. catHistAvg is the one already driving the coloring,
    // already scoped to the exact same 7 categories, so it's what "Budget"
    // shows here too.
    //
    // Difference = Budget − Total (not Total − Budget): a positive
    // difference means budget left over (underspending), negative means
    // the category ran over — the standard "remaining" convention most
    // budget templates use, and the one that actually matches "negative
    // = overspending" as asked for (Total − Budget would flip that sign).
    const budgetCell = row.getCell(days + 3);
    const diffCell   = row.getCell(days + 4);

    if (isIncome) {
      styleCell(totalCell, {
        fill: FILL.green,
        font: { bold: true, color: { argb: ARGB.green }, size: 11 },
        alignment: { horizontal: 'right', vertical: 'middle' },
        border: { left: STRONG_DIVIDER },
      });
      // No income-target concept exists anywhere in this app — left blank
      // rather than fabricating a number with nothing real behind it.
      styleCell(budgetCell, {
        value: '—', fill: FILL.total,
        font: { color: { argb: ARGB.textFaint }, size: 11 },
        alignment: { horizontal: 'right', vertical: 'middle' },
      });
      styleCell(diffCell, {
        value: '—', fill: FILL.total,
        font: { color: { argb: ARGB.textFaint }, size: 11 },
        alignment: { horizontal: 'right', vertical: 'middle' },
      });
    } else {
      const hist = catHistAvg[lbl] ?? 0;
      const over = hist > 0 && rowTotal > hist;
      styleCell(totalCell, {
        fill: over ? FILL.red : FILL.green,
        font: { bold: true, color: { argb: over ? ARGB.red : ARGB.green }, size: 11 },
        alignment: { horizontal: 'right', vertical: 'middle' },
        border: { left: STRONG_DIVIDER },
      });

      if (hist > 0) {
        const diff = hist - rowTotal;
        styleCell(budgetCell, {
          value: hist, numFmt: '$#,##0.00', fill: FILL.total,
          font: { color: { argb: ARGB.textPrimary }, size: 11 },
          alignment: { horizontal: 'right', vertical: 'middle' },
        });
        // Design feedback (2026-09-02): Difference is the number that
        // actually answers "am I over or under" — Total and Budget are
        // supporting context for it, not equals. Bumped a size above the
        // other two (13 vs. 11) so it reads as the dominant one of the
        // three, not just another same-weight column.
        styleCell(diffCell, {
          value: diff, numFmt: '$#,##0.00',
          fill: diff < 0 ? FILL.red : FILL.green,
          font: { bold: true, color: { argb: diff < 0 ? ARGB.red : ARGB.green }, size: 13 },
          alignment: { horizontal: 'right', vertical: 'middle' },
        });
      } else {
        // No history yet (e.g. this category's first month) — same guard
        // the Total cell's own color already uses (hist > 0); a $0
        // "Budget" here would misrepresent a category with literally no
        // baseline as maximally over budget.
        styleCell(budgetCell, {
          value: '—', fill: FILL.total,
          font: { color: { argb: ARGB.textFaint }, size: 11 },
          alignment: { horizontal: 'right', vertical: 'middle' },
        });
        styleCell(diffCell, {
          value: '—', fill: FILL.total,
          font: { color: { argb: ARGB.textFaint }, size: 11 },
          alignment: { horizontal: 'right', vertical: 'middle' },
        });
      }
    }
  });

  // ── Daily totals row ───────────────────────────────────────────────────────
  const dailyTotals = new Array(days).fill(0);
  for (const cat of EXPENSE_CATEGORIES) {
    for (let d = 0; d < days; d++) dailyTotals[d] += data[cat][d];
  }
  const grandTotal = dailyTotals.reduce((a, b) => a + b, 0);

  const totalsRowIdx = ALL_ROW_LABELS.length + 2;
  const totalsRow    = ws.getRow(totalsRowIdx);
  totalsRow.height   = 22;

  styleCell(totalsRow.getCell(1), {
    value: 'Daily Total', fill: FILL.total,
    font: { bold: true, color: { argb: ARGB.textPrimary }, size: 11 },
    alignment: { horizontal: 'left', vertical: 'middle' },
    border: { top: { style: 'medium', color: { argb: ARGB.sep } } },
  });

  for (let d = 0; d < days; d++) {
    const v    = dailyTotals[d];
    const cell = totalsRow.getCell(d + 2);

    cell.numFmt = '$#,##0.00';
    cell.value  = v > 0 ? v : null;

    const over = v > dailyBudget;
    styleCell(cell, {
      fill: over ? FILL.red : FILL.green,
      font: { bold: true, color: { argb: v > 0 ? (over ? ARGB.red : ARGB.green) : ARGB.textFaint }, size: 10 },
      alignment: { horizontal: 'right', vertical: 'middle' },
      border: { top: { style: 'medium', color: { argb: ARGB.sep } } },
    });
  }

  // Grand total (bottom-right) — red if over monthly budget
  const grandCell       = totalsRow.getCell(days + 2);
  grandCell.value       = grandTotal;
  grandCell.numFmt      = '$#,##0.00';
  const grandOver       = grandTotal > monthlyBudget;
  styleCell(grandCell, {
    fill: grandOver ? FILL.red : FILL.green,
    font: { bold: true, color: { argb: grandOver ? ARGB.red : ARGB.green }, size: 12 },
    alignment: { horizontal: 'right', vertical: 'middle' },
    border: {
      top:  { style: 'medium', color: { argb: ARGB.sep } },
      left: STRONG_DIVIDER,
    },
  });

  // Budget / Difference for the Daily Total row (2026-09-02) — same
  // treatment as the category rows, at the whole-month scale: monthlyBudget
  // is the comparable figure already driving this row's own red/green
  // (dailyBudget = monthlyBudget/days), so it's what "Budget" shows here.
  const monthDiff = monthlyBudget - grandTotal;
  styleCell(totalsRow.getCell(days + 3), {
    value: monthlyBudget, numFmt: '$#,##0.00', fill: FILL.total,
    font: { bold: true, color: { argb: ARGB.textPrimary }, size: 12 },
    alignment: { horizontal: 'right', vertical: 'middle' },
    border: { top: { style: 'medium', color: { argb: ARGB.sep } } },
  });
  // Same dominance treatment as the category rows' Difference cell — one
  // size above Total/Budget's 12 (here: 14) so it's the visually loudest
  // of the three at this row too.
  styleCell(totalsRow.getCell(days + 4), {
    value: monthDiff, numFmt: '$#,##0.00',
    fill: monthDiff < 0 ? FILL.red : FILL.green,
    font: { bold: true, color: { argb: monthDiff < 0 ? ARGB.red : ARGB.green }, size: 14 },
    alignment: { horizontal: 'right', vertical: 'middle' },
    border: { top: { style: 'medium', color: { argb: ARGB.sep } } },
  });

  extendDarkBackground(ws, totalsRowIdx, days + 4);
}

// ─── Summary Sheet ────────────────────────────────────────────────────────────

function addSummarySheet(
  wb: InstanceType<typeof ExcelJS.Workbook>,
  monthKeys: string[],
  byMonth: Record<string, Tx[]>,
  monthlyBudget: number,
) {
  // Remove previous summary sheet if it exists (so we always have a fresh one)
  const old = wb.getWorksheet('Summary');
  if (old) wb.removeWorksheet(old.id);

  const ws = wb.addWorksheet('Summary', {
    properties: { tabColor: { argb: ARGB.yellow } },
    views: [{ state: 'frozen', xSplit: 1, ySplit: 1 }],
  });

  const colHeaders = [...EXPENSE_CATEGORIES, 'Income', 'Total Expenses'];

  // Column widths
  ws.getColumn(1).width = 18;
  colHeaders.forEach((_, i) => { ws.getColumn(i + 2).width = 14; });

  // ── Header row ──────────────────────────────────────────────────────────────
  const hdr = ws.getRow(1);
  hdr.height = 24;

  styleCell(hdr.getCell(1), {
    value: 'Month', fill: FILL.header,
    font: { bold: true, color: { argb: ARGB.headerFg }, size: 11 },
    alignment: { horizontal: 'left', vertical: 'middle' },
    border: { bottom: { style: 'medium', color: { argb: ARGB.sep } } },
  });

  colHeaders.forEach((label, i) => {
    styleCell(hdr.getCell(i + 2), {
      value: label, fill: FILL.header,
      font: { bold: true, color: { argb: ARGB.headerFg }, size: 11 },
      alignment: { horizontal: 'right', vertical: 'middle' },
      border: { bottom: { style: 'medium', color: { argb: ARGB.sep } } },
    });
  });

  // ── One row per month ────────────────────────────────────────────────────────
  monthKeys.forEach((key, idx) => {
    const txns = byMonth[key];
    const row  = ws.getRow(idx + 2);
    row.height = 20;

    // Totals per expense category — isRealExpense excludes Transfer/
    // Transfers/Zelle/Venmo (2026-09-02, see addMonthSheet's data-matrix
    // loop for full rationale), so this sheet's Total Expenses column
    // agrees with every other surface in the app for the same month.
    const catTotals: Record<string, number> = {};
    let totalExpenses = 0;
    for (const cat of EXPENSE_CATEGORIES) {
      const v = txns
        .filter(t => isRealExpense(t) && normCat(t.category_name) === cat)
        .reduce((s, t) => s + Number(t.amount), 0);
      catTotals[cat]  = v;
      totalExpenses  += v;
    }
    const totalIncome = txns
      .filter(isRealIncome)
      .reduce((s, t) => s + Number(t.amount), 0);

    const overBudget = totalExpenses > monthlyBudget;
    const rowFill    = { type: 'pattern', pattern: 'solid', fgColor: { argb: overBudget ? ARGB.redBg : ARGB.greenBg } } as const;

    // Month name cell
    styleCell(row.getCell(1), {
      value: monthLabel(key), fill: FILL.total,
      font: { bold: true, color: { argb: ARGB.textPrimary }, size: 11 },
      alignment: { horizontal: 'left', vertical: 'middle' },
    });

    // Category columns
    EXPENSE_CATEGORIES.forEach((cat, ci) => {
      const v    = catTotals[cat];
      const cell = row.getCell(ci + 2);
      cell.value  = v;
      cell.numFmt = '$#,##0.00';
      styleCell(cell, {
        fill: rowFill as { type: 'pattern'; pattern: 'solid'; fgColor: { argb: string } },
        font: { color: { argb: v > 0 ? ARGB.textPrimary : ARGB.textFaint }, size: 11 },
        alignment: { horizontal: 'right', vertical: 'middle' },
      });
    });

    // Income column
    const incomeCell = row.getCell(EXPENSE_CATEGORIES.length + 2);
    incomeCell.value  = totalIncome;
    incomeCell.numFmt = '$#,##0.00';
    styleCell(incomeCell, {
      fill: rowFill as { type: 'pattern'; pattern: 'solid'; fgColor: { argb: string } },
      font: { color: { argb: ARGB.green }, size: 11 },
      alignment: { horizontal: 'right', vertical: 'middle' },
    });

    // Total Expenses column (last — coloured red/green)
    const totalCell = row.getCell(EXPENSE_CATEGORIES.length + 3);
    totalCell.value  = totalExpenses;
    totalCell.numFmt = '$#,##0.00';
    styleCell(totalCell, {
      fill: overBudget ? FILL.red : FILL.green,
      font: { bold: true, color: { argb: overBudget ? ARGB.red : ARGB.green }, size: 11 },
      alignment: { horizontal: 'right', vertical: 'middle' },
      border: { left: { style: 'thin', color: { argb: ARGB.sep } } },
    });
  });

  extendDarkBackground(ws, monthKeys.length + 1, colHeaders.length + 1);
}

// ═════════════════════════════════════════════════════════════════════════════
// CELL HELPER
// ═════════════════════════════════════════════════════════════════════════════

interface CellStyle {
  value?:     unknown;
  fill?:      unknown;
  font?:      unknown;
  alignment?: unknown;
  border?:    unknown;
  numFmt?:    string;
}

function styleCell(cell: ExcelJS.Cell, opts: CellStyle) {
  if (opts.value !== undefined) cell.value = opts.value as ExcelJS.CellValue;
  if (opts.fill)      cell.fill      = opts.fill      as ExcelJS.Fill;
  if (opts.font)      cell.font      = opts.font      as ExcelJS.Font;
  if (opts.alignment) cell.alignment = opts.alignment as ExcelJS.Alignment;
  if (opts.border)    cell.border    = opts.border    as ExcelJS.Borders;
  if (opts.numFmt)    cell.numFmt    = opts.numFmt;
}

// Fixed 2026-09-02 (design feedback): ExcelJS only styles cells it's told
// to — anything outside the table's used range keeps the spreadsheet
// engine's own default white cell background, which read as a jarring
// white edge below/right of the dark table on typical screen sizes.
// Neither sheet type in this workbook (month sheets, Summary) had any
// handling for this before — this is new, applied identically to both so
// the treatment is consistent everywhere the workbook has a table.
//
// lastRow/lastCol (the caller's args) are already each sheet's real
// content extent, computed from that sheet's actual data, not a guess:
// month sheets pass `days + 4` (a 28-day February vs. a 31-day August
// ends the table 3 columns apart) and the Daily Total row index; the
// Summary sheet passes `monthKeys.length + 1`, which grows or shrinks
// with how many months of transaction history the account actually has.
// So the boundary itself was always per-sheet dynamic — what changed
// here (2026-09-02 follow-up) is the MARGIN painted past that boundary:
// was a flat 40 rows / 6 columns regardless of sheet size, which could
// be far more than needed on a small account or (in principle) still
// not enough on an unusually wide one. Now a small fixed margin added on
// top of the real, per-sheet boundary — enough to avoid a hard white
// cutoff right at the table edge, without painting dozens of rows/columns
// nothing will ever use.
function extendDarkBackground(ws: ExcelJS.Worksheet, lastRow: number, lastCol: number) {
  const EXTRA_ROWS = 12;
  const EXTRA_COLS = 4;
  const fill: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ARGB.cellBg } };
  const totalCols = lastCol + EXTRA_COLS;

  // Below the table: full width (table columns + the extra margin), so the
  // bottom edge is never a straight white cutoff either.
  for (let r = lastRow + 1; r <= lastRow + EXTRA_ROWS; r++) {
    const row = ws.getRow(r);
    for (let c = 1; c <= totalCols; c++) row.getCell(c).fill = fill;
  }

  // Right of the table: every row the table actually uses.
  for (let r = 1; r <= lastRow; r++) {
    const row = ws.getRow(r);
    for (let c = lastCol + 1; c <= totalCols; c++) row.getCell(c).fill = fill;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// EMAIL BODY
// ═════════════════════════════════════════════════════════════════════════════

const esc = (s: string) => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

function buildEmailHtml(name: string, reportLabel: string): string {
  const firstName = esc((name || '').split(' ')[0] || 'there');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>Arkonomy Monthly Report</title>
</head>
<body style="margin:0;padding:0;background:#060E1C;font-family:'Inter',Arial,sans-serif;color:#FFFFFF;">
<div style="max-width:520px;margin:0 auto;background:#060E1C;">

  <!-- Header -->
  <div style="background:linear-gradient(135deg,#0D1F3C,#0B1426);padding:28px 32px;border-bottom:1px solid #1E2D4A;">
    <div style="font-size:22px;font-weight:800;letter-spacing:-0.5px;">
      Arkonomy
      <span style="font-size:10px;font-weight:600;color:#FFB800;background:#FFB80018;border:1px solid #FFB80033;border-radius:99px;padding:2px 8px;margin-left:8px;vertical-align:middle;letter-spacing:0.5px;">MONTHLY REPORT</span>
    </div>
    <div style="font-size:13px;color:#9AA4B2;margin-top:4px;">${reportLabel} &middot; Hi ${firstName}</div>
  </div>

  <!-- Body -->
  <div style="padding:28px 32px;">

    <div style="background:#111E33;border:1px solid #1E2D4A;border-radius:14px;padding:20px;margin-bottom:20px;">
      <div style="font-size:15px;font-weight:700;margin-bottom:8px;">Your monthly report is attached</div>
      <!-- Fixed 2026-09-02: this legend text still had the old generic
           #12D18E/#FF5C7A hex hardcoded — the 2026-09-02 DC.emerald/DC.ruby
           color-system migration updated the ARGB palette used in the
           workbook itself but missed this HTML string, so the email body's
           own color explanation didn't match what the attached spreadsheet
           actually used. Now #2FB37D/#D64F5E, same as ARGB.green/red. -->
      <div style="font-size:13px;color:#9AA4B2;line-height:1.7;">
        Your <strong style="color:#fff;">${reportLabel}</strong> financial report is attached as an Excel file — open it in Excel, Google Sheets, or Numbers.<br/><br/>
        <span style="color:#2FB37D;font-weight:600;">Green</span> = income. Category and daily totals turn
        <span style="color:#D64F5E;font-weight:600;">red</span> when they're over your budget or your usual average for that category —
        individual day-by-day expense amounts are left neutral, since a single day's spend in one category isn't enough on its own to flag as a problem.
      </div>
    </div>

    <div style="background:#111E33;border:1px solid #FFB80022;border-radius:14px;padding:16px 20px;margin-bottom:24px;">
      <div style="font-size:11px;font-weight:700;color:#FFB800;letter-spacing:0.8px;text-transform:uppercase;margin-bottom:10px;">What's inside</div>
      <ul style="margin:0;padding-left:18px;color:#9AA4B2;font-size:13px;line-height:1.9;">
        <li>One sheet per month — full transaction history</li>
        <li>Rows = spending categories &amp; income</li>
        <li>Columns = every day of the month</li>
        <li>Category &amp; daily totals turn red when over budget/average</li>
        <li>Budget &amp; Difference columns next to each total</li>
        <li>Summary sheet comparing all months side-by-side</li>
      </ul>
    </div>

    <div style="text-align:center;margin-bottom:28px;">
      <a href="https://app.arkonomy.com"
         style="display:inline-block;background:#2F80FF;color:#fff;text-decoration:none;font-size:14px;font-weight:700;padding:14px 32px;border-radius:12px;">
        Open Arkonomy →
      </a>
    </div>

  </div>

  <!-- Footer -->
  <div style="padding:20px 32px;border-top:1px solid #1E2D4A;text-align:center;">
    <div style="font-size:11px;color:#4A5E7A;line-height:1.6;">
      You're receiving this because you have an Arkonomy account.<br/>
      <a href="https://app.arkonomy.com" style="color:#4A5E7A;">Manage preferences</a>
    </div>
  </div>

</div>
</body>
</html>`;
}
