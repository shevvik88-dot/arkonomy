import _ExcelJS from 'exceljs/dist/exceljs.bare.min.js';
// CJS/UMD interop: Rolldown wraps the default differently depending on build mode
const ExcelJS = _ExcelJS?.default ?? _ExcelJS;

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Keyed by month number 1-12 so Jan is always blue regardless of data range
const MONTH_TAB_COLORS = {
  1: 'FF3B82F6', 2: 'FF8B5CF6', 3: 'FF10B981', 4: 'FFF59E0B',
  5: 'FFEC4899', 6: 'FF06B6D4', 7: 'FF84CC16', 8: 'FFF97316',
  9: 'FF14B8A6', 10: 'FF6366F1', 11: 'FFA855F7', 12: 'FF3B82F6',
};

const XL = {
  darkNavy:    'FF0F172A',
  altRow1:     'FF111827',
  altRow2:     'FF141E2E',
  header:      'FF1E293B',
  headerText:  'FF64748B',
  expenseText: 'FFEF4444',
  expenseBg:   'FF2A0F0F',
  incomeText:  'FF22C55E',
  incomeBg:    'FF0F2A1A',
  netBg:       'FF1E293B',
  pos:         'FF22C55E',
  neg:         'FFEF4444',
  text:        'FFE2E8F0',
  muted:       'FF94A3B8',
  amber:       'FFF59E0B',
  amberBg:     'FF1E293B',
};

const CAT_LABELS = {
  'Housing':        '🏠 Housing',
  'Food & Dining':  '☕ Food & Dining',
  'Food':           '☕ Food & Dining',
  'Shopping':       '🛍 Shopping',
  'Bills':          '📋 Bills',
  'Transport':      '🚗 Transport',
  'Transportation': '🚗 Transport',
  'Entertainment':  '🎬 Entertainment',
  'Transfers':      '🔄 Transfers',
  'Other':          '📦 Other',
  'Income':         '💰 Income',
};

function catLabel(cat) {
  return CAT_LABELS[cat] || `📦 ${cat}`;
}

function fill(cell, argb) {
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}

function font(cell, argb, bold = false, size = 11) {
  cell.font = { name: 'Calibri', size, bold, color: { argb } };
}

function align(cell, horizontal = 'left') {
  cell.alignment = { horizontal, vertical: 'middle', wrapText: false };
}

function styleCell(cell, bgArgb, fgArgb, bold = false, horizontal = 'left', numFmt = null) {
  fill(cell, bgArgb);
  font(cell, fgArgb, bold);
  align(cell, horizontal);
  if (numFmt) cell.numFmt = numFmt;
}

function autoFitCols(ws) {
  ws.columns.forEach(col => {
    let max = col.width || 8;
    col.eachCell({ includeEmpty: false }, cell => {
      const v = cell.value;
      if (v === null || v === undefined) return;
      let len;
      if (typeof v === 'number') {
        // approximate formatted width: digits + commas + decimal
        len = String(Math.round(Math.abs(v))).length + 4;
      } else {
        len = String(v).length;
      }
      if (len > max) max = len;
    });
    col.width = max + 2;
  });
}

export async function generateExcelReport(transactions) {
  console.log('[ExportReport] generateExcelReport called, transactions count:', transactions.length);
  // ── Group by month ──────────────────────────────────────────────
  const expCats = new Set();
  const months = {}; // { 'YYYY-MM': { byCat: { cat: total }, income: total, txList: [] } }

  for (const t of transactions) {
    if (!t.date) continue;
    const d = new Date(t.date + 'T00:00:00');
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

    if (!months[key]) months[key] = { byCat: {}, income: 0, txList: [] };

    const raw = t.resolvedCategory || 'Other';
    const cat = raw === 'Transfer' ? 'Transfers' : raw;
    months[key].txList.push({ ...t, resolvedCategory: cat });

    const amt = Math.abs(Number(t.amount) || 0);
    if (t.type === 'income') {
      months[key].income += amt;
    } else {
      months[key].byCat[cat] = (months[key].byCat[cat] || 0) + amt;
      if (cat !== 'Transfers') expCats.add(cat);
    }
  }

  const sortedMonths = Object.keys(months).sort();
  if (!sortedMonths.length) return;

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Arkonomy';
  wb.created = new Date();

  // ── Summary Sheet ───────────────────────────────────────────────
  const summary = wb.addWorksheet('Summary', {
    properties: { defaultRowHeight: 22 },
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  const totalCols = sortedMonths.length + 2; // col 1 = category label, last = Total

  summary.getColumn(1).width = 18;
  for (let i = 2; i <= totalCols - 1; i++) summary.getColumn(i).width = 8;
  summary.getColumn(totalCols).width = 12;

  // Header row
  {
    const row = summary.getRow(1);
    row.height = 26;
    const labels = [
      'Category',
      ...sortedMonths.map(m => {
        const [y, mo] = m.split('-');
        return `${MONTH_NAMES[parseInt(mo) - 1]} ${y}`;
      }),
      'Total',
    ];
    for (let c = 1; c <= totalCols; c++) {
      const cell = row.getCell(c);
      cell.value = labels[c - 1];
      styleCell(cell, XL.header, XL.headerText, true, c === 1 ? 'left' : 'center');
    }
  }

  // Expense category rows (Transfers included as row, excluded from totals)
  const cats = [...expCats].sort();
  // Also collect Transfers if present
  const transfersExist = sortedMonths.some(m => months[m].byCat['Transfers']);
  const allCatRows = [...cats, ...(transfersExist ? ['Transfers'] : [])];

  for (let ci = 0; ci < allCatRows.length; ci++) {
    const cat = allCatRows[ci];
    const bgArgb = ci % 2 === 0 ? XL.altRow1 : XL.altRow2;
    const row = summary.getRow(ci + 2);
    row.height = 20;

    row.getCell(1).value = catLabel(cat);
    styleCell(row.getCell(1), bgArgb, XL.text, false, 'left');

    let rowTotal = 0;
    for (let mi = 0; mi < sortedMonths.length; mi++) {
      const val = months[sortedMonths[mi]].byCat[cat] || 0;
      const cell = row.getCell(mi + 2);
      cell.value = val || null;
      styleCell(cell, bgArgb, XL.text, false, 'right', val ? '#,##0.00' : null);
      rowTotal += val;
    }
    const totCell = row.getCell(totalCols);
    totCell.value = rowTotal || null;
    styleCell(totCell, bgArgb, XL.text, true, 'right', rowTotal ? '#,##0.00' : null);
  }

  let nextRow = allCatRows.length + 2;

  // Expenses Total row (excludes Transfers)
  {
    const row = summary.getRow(nextRow++);
    row.height = 24;
    row.getCell(1).value = 'Expenses Total';
    styleCell(row.getCell(1), XL.expenseBg, XL.expenseText, true, 'left');
    let grand = 0;
    for (let mi = 0; mi < sortedMonths.length; mi++) {
      const val = cats.reduce((s, c) => s + (months[sortedMonths[mi]].byCat[c] || 0), 0);
      const cell = row.getCell(mi + 2);
      cell.value = val || null;
      styleCell(cell, XL.expenseBg, XL.expenseText, true, 'right', val ? '#,##0.00' : null);
      grand += val;
    }
    const tc = row.getCell(totalCols);
    tc.value = grand || null;
    styleCell(tc, XL.expenseBg, XL.expenseText, true, 'right', grand ? '#,##0.00' : null);
  }

  // Income row
  {
    const row = summary.getRow(nextRow++);
    row.height = 24;
    row.getCell(1).value = '💰 Income';
    styleCell(row.getCell(1), XL.incomeBg, XL.incomeText, true, 'left');
    let grand = 0;
    for (let mi = 0; mi < sortedMonths.length; mi++) {
      const val = months[sortedMonths[mi]].income;
      const cell = row.getCell(mi + 2);
      cell.value = val || null;
      styleCell(cell, XL.incomeBg, XL.incomeText, true, 'right', val ? '#,##0.00' : null);
      grand += val;
    }
    const tc = row.getCell(totalCols);
    tc.value = grand || null;
    styleCell(tc, XL.incomeBg, XL.incomeText, true, 'right', grand ? '#,##0.00' : null);
  }

  // Net Cash Flow row
  {
    const row = summary.getRow(nextRow);
    row.height = 24;
    row.getCell(1).value = 'Net Cash Flow';
    styleCell(row.getCell(1), XL.netBg, XL.text, true, 'left');
    let grandNet = 0;
    for (let mi = 0; mi < sortedMonths.length; mi++) {
      const inc = months[sortedMonths[mi]].income;
      const exp = cats.reduce((s, c) => s + (months[sortedMonths[mi]].byCat[c] || 0), 0);
      const net = inc - exp;
      const cell = row.getCell(mi + 2);
      cell.value = net !== 0 ? net : null;
      styleCell(cell, XL.netBg, net >= 0 ? XL.pos : XL.neg, true, 'right', net !== 0 ? '#,##0.00' : null);
      grandNet += net;
    }
    const tc = row.getCell(totalCols);
    tc.value = grandNet !== 0 ? grandNet : null;
    styleCell(tc, XL.netBg, grandNet >= 0 ? XL.pos : XL.neg, true, 'right', grandNet !== 0 ? '#,##0.00' : null);
  }

  autoFitCols(summary);

  // ── Per-Month Sheets (pivot: categories × all days) ─────────────
  const CAT_ORDER = [
    'Housing', 'Food & Dining', 'Shopping', 'Bills', 'Transport',
    'Entertainment', 'Government', 'Health', 'Other', 'Transfers', 'Income',
  ];
  const EXPENSE_CATS = new Set([
    'Housing', 'Food & Dining', 'Shopping', 'Bills', 'Transport',
    'Entertainment', 'Government', 'Health', 'Other',
  ]);

  sortedMonths.forEach(monthKey => {
    const [year, mo] = monthKey.split('-');
    const moNum = parseInt(mo);
    const mName = MONTH_NAMES[moNum - 1];
    const sheetName = `${mName} ${year}`;
    const tabArgb = MONTH_TAB_COLORS[moNum] || 'FF3B82F6';

    const ws = wb.addWorksheet(sheetName, {
      properties: { defaultRowHeight: 20, tabColor: { argb: tabArgb } },
      // freeze column A + title/header rows so category stays visible when scrolling right
      views: [{ state: 'frozen', xSplit: 1, ySplit: 2 }],
    });

    // Build pivot: cat → day → total
    const pivot = {};
    for (const t of months[monthKey].txList) {
      const d = new Date(t.date + 'T00:00:00');
      const day = d.getDate();
      const cat = t.type === 'income' ? 'Income' : (t.resolvedCategory || 'Other');
      if (!pivot[cat]) pivot[cat] = {};
      const amt = Math.abs(Number(t.amount) || 0);
      pivot[cat][day] = (pivot[cat][day] || 0) + amt;
    }

    // ALL days in the month (not just days with transactions)
    const daysInMonth = new Date(parseInt(year), moNum, 0).getDate();
    const allDays = Array.from({ length: daysInMonth }, (_, i) => i + 1);
    const totalCols = allDays.length + 2; // col 1 = Category, cols 2..N+1 = days, last = Total

    // Column widths (fixed per spec)
    ws.getColumn(1).width = 20;
    for (let i = 2; i <= totalCols - 1; i++) ws.getColumn(i).width = 9;
    ws.getColumn(totalCols).width = 13;

    const thickBorder = { style: 'medium', color: { argb: 'FF334155' } };

    // ── Row 1: Title (merged across all columns) ──
    ws.mergeCells(1, 1, 1, totalCols);
    const titleCell = ws.getRow(1).getCell(1);
    titleCell.value = `${mName} ${year} — Daily Transactions`;
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.darkNavy } };
    titleCell.font = { name: 'Calibri', size: 14, bold: true, color: { argb: XL.text } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(1).height = 30;

    // ── Row 2: Header — "Category" | 1 | 2 | ... | daysInMonth | Total ──
    const hRow = ws.getRow(2);
    hRow.height = 22;
    hRow.getCell(1).value = 'Category';
    styleCell(hRow.getCell(1), XL.header, XL.headerText, true, 'left');

    allDays.forEach((day, di) => {
      const cell = hRow.getCell(di + 2);
      cell.value = day;
      styleCell(cell, XL.header, XL.headerText, true, 'center');
    });

    const totHeaderCell = hRow.getCell(totalCols);
    totHeaderCell.value = 'Total';
    styleCell(totHeaderCell, XL.header, XL.headerText, true, 'center');
    totHeaderCell.border = { left: thickBorder };

    // ── Rows 3+: Category data rows ──
    CAT_ORDER.forEach((cat, ci) => {
      const row = ws.getRow(ci + 3);
      row.height = 20;

      let bgArgb, fgArgb;
      if (cat === 'Income') {
        bgArgb = XL.incomeBg; fgArgb = XL.incomeText;
      } else {
        bgArgb = ci % 2 === 0 ? XL.altRow1 : XL.altRow2;
        fgArgb = cat === 'Transfers' ? XL.muted : XL.text;
      }

      row.getCell(1).value = catLabel(cat);
      styleCell(row.getCell(1), bgArgb, fgArgb, false, 'left');

      let rowTotal = 0;
      allDays.forEach((day, di) => {
        const val = pivot[cat]?.[day] || 0;
        const cell = row.getCell(di + 2);
        cell.value = val || null;
        styleCell(cell, bgArgb, fgArgb, false, 'right', val ? '#,##0.00' : null);
        rowTotal += val;
      });

      const totCell = row.getCell(totalCols);
      totCell.value = rowTotal || null;
      styleCell(totCell, bgArgb, fgArgb, true, 'right', rowTotal ? '#,##0.00' : null);
      totCell.border = { left: thickBorder };
    });

    // ── Daily Total row ──
    const dtRowNum = CAT_ORDER.length + 3;
    const dtRow = ws.getRow(dtRowNum);
    dtRow.height = 22;
    dtRow.getCell(1).value = 'Daily Total';
    styleCell(dtRow.getCell(1), XL.amberBg, XL.amber, true, 'left');

    let grandTotal = 0;
    allDays.forEach((day, di) => {
      const daySum = [...EXPENSE_CATS].reduce((s, c) => s + (pivot[c]?.[day] || 0), 0);
      const cell = dtRow.getCell(di + 2);
      cell.value = daySum || null;
      styleCell(cell, XL.amberBg, XL.amber, true, 'right', daySum ? '#,##0.00' : null);
      grandTotal += daySum;
    });

    const grandCell = dtRow.getCell(totalCols);
    grandCell.value = grandTotal || null;
    styleCell(grandCell, XL.amberBg, XL.amber, true, 'right', grandTotal ? '#,##0.00' : null);
    grandCell.border = { left: thickBorder };
  });

  // ── Download ────────────────────────────────────────────────────
  const now = new Date();
  const fileName = `Arkonomy_Report_${MONTH_NAMES[now.getMonth()]}_${now.getFullYear()}.xlsx`;
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
