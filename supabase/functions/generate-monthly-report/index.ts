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

// ── Colour palette (dark-theme Excel) ────────────────────────────────────────
const ARGB = {
  headerBg:    'FF0D1F3C',
  headerFg:    'FF00C2FF',
  cellBg:      'FF0B1426',
  totalBg:     'FF111E33',
  sep:         'FF1E2D4A',
  textPrimary: 'FFE8EDF5',
  textMuted:   'FF9AA4B2',
  textFaint:   'FF4A5E7A',
  green:       'FF12D18E',
  greenBg:     'FF0A2218',
  greenBgLight:'FF0A2E1C',
  red:         'FFFF5C7A',
  redBg:       'FF2D0A12',
  redBgLight:  'FF3D0F18',
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

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
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

    // Optional: single-user targeting from POST body
    let targetUserId: string | null  = null;
    let emailOverride: string | null = null;
    if (req.method === 'POST') {
      try {
        const body = await req.json();
        targetUserId  = body?.userId ?? null;
        emailOverride = body?.email  ?? null;
      } catch { /* no body — cron call */ }
    }

    // ── Load profiles ─────────────────────────────────────────────────────────
    type Profile = { id: string; full_name: string | null; email: string | null; monthly_budget: number | null };
    let profiles: Profile[];

    if (targetUserId && emailOverride) {
      const { data: p } = await supabase
        .from('profiles').select('id, full_name, email, monthly_budget')
        .eq('id', targetUserId).single();
      profiles = [{ id: targetUserId, full_name: p?.full_name ?? null, email: emailOverride, monthly_budget: p?.monthly_budget ?? null }];
    } else {
      const q = supabase.from('profiles').select('id, full_name, email, monthly_budget');
      if (targetUserId) q.eq('id', targetUserId);
      const { data, error } = await q;
      if (error || !data?.length) {
        return new Response(JSON.stringify({ error: 'No users found', detail: error }), {
          status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
        });
      }
      profiles = data as Profile[];
    }

    const results: { userId: string; status: string; error?: string }[] = [];

    for (const user of profiles) {
      if (!user.email) continue;
      try {
        // ── Fetch all transactions ──────────────────────────────────────────
        const { data: txns, error: txErr } = await supabase
          .from('transactions')
          .select('date, amount, category_name, type')
          .eq('user_id', user.id)
          .order('date', { ascending: true });

        if (txErr) throw new Error(`DB error: ${txErr.message}`);

        if (!txns || txns.length === 0) {
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
        const now         = new Date();
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

        results.push({ userId: user.id, status: 'sent' });
      } catch (err) {
        console.error(`Report failed for user ${user.id}:`, err);
        results.push({ userId: user.id, status: 'failed', error: String(err) });
      }
    }

    return new Response(JSON.stringify({ results }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('generate-monthly-report error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// WORKBOOK BUILDER
// ═════════════════════════════════════════════════════════════════════════════

interface Tx { date: string; amount: number | string; category_name: string | null; type: string }

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
  const catHistAvg: Record<string, number> = {};
  for (const cat of EXPENSE_CATEGORIES) {
    const monthlyTotals = monthKeys.map(k =>
      byMonth[k]
        .filter(t => t.type === 'expense' && normCat(t.category_name) === cat)
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

  // ── Build data matrix  data[label][day0..dayN-1] ──────────────────────────
  const data: Record<string, number[]> = {};
  for (const lbl of ALL_ROW_LABELS) data[lbl] = new Array(days).fill(0);

  for (const t of txns) {
    const day = parseInt((t.date ?? '').slice(8, 10), 10);
    if (!day || day < 1 || day > days) continue;
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
        } else if (v > dailyBudget) {
          styleCell(cell, {
            fill: FILL.red,
            font: { color: { argb: ARGB.red }, size: 10 },
            alignment: { horizontal: 'right', vertical: 'middle' },
          });
        } else {
          styleCell(cell, {
            fill: FILL.green,
            font: { color: { argb: ARGB.green }, size: 10 },
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

    if (isIncome) {
      styleCell(totalCell, {
        fill: FILL.green,
        font: { bold: true, color: { argb: ARGB.green }, size: 11 },
        alignment: { horizontal: 'right', vertical: 'middle' },
        border: { left: { style: 'thin', color: { argb: ARGB.sep } } },
      });
    } else {
      const hist = catHistAvg[lbl] ?? 0;
      const over = hist > 0 && rowTotal > hist;
      styleCell(totalCell, {
        fill: over ? FILL.red : FILL.green,
        font: { bold: true, color: { argb: over ? ARGB.red : ARGB.green }, size: 11 },
        alignment: { horizontal: 'right', vertical: 'middle' },
        border: { left: { style: 'thin', color: { argb: ARGB.sep } } },
      });
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
      left: { style: 'medium', color: { argb: ARGB.sep } },
    },
  });
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

    // Totals per expense category
    const catTotals: Record<string, number> = {};
    let totalExpenses = 0;
    for (const cat of EXPENSE_CATEGORIES) {
      const v = txns
        .filter(t => t.type === 'expense' && normCat(t.category_name) === cat)
        .reduce((s, t) => s + Number(t.amount), 0);
      catTotals[cat]  = v;
      totalExpenses  += v;
    }
    const totalIncome = txns
      .filter(t => t.type === 'income')
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

// ═════════════════════════════════════════════════════════════════════════════
// EMAIL BODY
// ═════════════════════════════════════════════════════════════════════════════

function buildEmailHtml(name: string, reportLabel: string): string {
  const firstName = (name || '').split(' ')[0] || 'there';
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
      <div style="font-size:13px;color:#9AA4B2;line-height:1.7;">
        Your <strong style="color:#fff;">${reportLabel}</strong> financial report is attached as an Excel file — open it in Excel, Google Sheets, or Numbers.<br/><br/>
        Cells are color-coded: <span style="color:#FF5C7A;font-weight:600;">red</span> = over budget for that day,
        <span style="color:#12D18E;font-weight:600;">green</span> = within budget.
      </div>
    </div>

    <div style="background:#111E33;border:1px solid #FFB80022;border-radius:14px;padding:16px 20px;margin-bottom:24px;">
      <div style="font-size:11px;font-weight:700;color:#FFB800;letter-spacing:0.8px;text-transform:uppercase;margin-bottom:10px;">What's inside</div>
      <ul style="margin:0;padding-left:18px;color:#9AA4B2;font-size:13px;line-height:1.9;">
        <li>One sheet per month — full transaction history</li>
        <li>Rows = spending categories &amp; income</li>
        <li>Columns = every day of the month</li>
        <li>Red/green cells based on daily budget</li>
        <li>Summary sheet comparing all months side-by-side</li>
      </ul>
    </div>

    <div style="text-align:center;margin-bottom:28px;">
      <a href="https://arkonomy.app"
         style="display:inline-block;background:#2F80FF;color:#fff;text-decoration:none;font-size:14px;font-weight:700;padding:14px 32px;border-radius:12px;">
        Open Arkonomy →
      </a>
    </div>

  </div>

  <!-- Footer -->
  <div style="padding:20px 32px;border-top:1px solid #1E2D4A;text-align:center;">
    <div style="font-size:11px;color:#4A5E7A;line-height:1.6;">
      You're receiving this because you have an Arkonomy account.<br/>
      <a href="https://arkonomy.app" style="color:#4A5E7A;">Manage preferences</a>
    </div>
  </div>

</div>
</body>
</html>`;
}
