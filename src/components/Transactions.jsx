import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { C, FONT } from "../utils/colors";
import { fmt, fmtDate, parseDate, guessCategory, tCat } from "../utils/helpers";
import Icon from "./shared/Icon";

const CAT_COLORS = {
  "Housing":       "#60A5FA",
  "Bills":         "#A78BFA",
  "Subscriptions": "#A78BFA",
  "Shopping":      "#FB923C",
  "Food & Dining": "#F87171",
  "Transport":     "#2DD4BF",
  "Transportation":"#2DD4BF",
  "Entertainment": "#F472B6",
  "Health":        "#4ADE80",
  "Health & Fitness": "#34D399",
  "Personal Care": "#FBBF24",
  "Travel":        "#818CF8",
  "Education":     "#38BDF8",
  "Taxes":         "#F59E0B",
  "Government":    "#94A3B8",
  "Charity":       "#EC4899",
  "Fees":          "#EF4444",
  "Cost of Debt":  "#F97316",
  "Utilities":     "#67E8F9",
  "Transfers":     "#6366F1",
  "Other":         "#94A3B8",
  "Transfer":      "#475569",
  "Income":        "#34D399",
};

function CatIcon({ name, type, size = 18 }) {
  const map = {
    "Food & Dining": { color: "#F87171", icon: "food" },
    "Transport":     { color: "#2DD4BF", icon: "car" },
    "Shopping":      { color: "#FB923C", icon: "shopping" },
    "Entertainment": { color: "#F472B6", icon: "film" },
    "Health":        { color: "#4ADE80", icon: "heart" },
    "Bills":         { color: "#A78BFA", icon: "file" },
    "Subscriptions": { color: "#A78BFA", icon: "repeat" },
    "Housing":       { color: "#60A5FA", icon: "home" },
    "Personal Care": { color: "#FBBF24", icon: "heart" },
    "Travel":        { color: "#818CF8", icon: "activity" },
    "Cost of Debt":  { color: "#F97316", icon: "credit" },
    "income":        { color: "#34D399", icon: "dollar" },
    "default":       { color: "#94A3B8", icon: "credit" },
  };
  const key = type === "income" ? "income" : (map[name] ? name : "default");
  const { color, icon } = map[key];
  return (
    <div style={{ width: 42, height: 42, borderRadius: 13, background: color, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, boxShadow: `0 2px 8px ${color}44` }}>
      <Icon name={icon} size={size} color="#fff" strokeWidth={2} />
    </div>
  );
}

export function cleanMerchantName(raw) {
  if (!raw) return '';
  let s = raw.trim();

  // 0. Semicolon separator — take the last non-empty segment
  //    e.g. "Zelle ; Sunlit Styles" → "Sunlit Styles"
  if (s.includes(';')) {
    const parts = s.split(';').map(p => p.trim()).filter(Boolean);
    if (parts.length > 1) s = parts[parts.length - 1];
  }

  // 1a. Strip leading bank operation prefixes
  s = s.replace(/^(ACH\s+HOLD|ACH|POS\s+PURCHASE|POS|CHECKCARD|CHECK\s*CARD|PURCHASE|PREAUTH|PRE-AUTH|RECURRING\s+PMT|RECURRING|PYMT|PMT|DEBIT\s+CARD|DEBIT)\b\s*/i, '');

  // 1b. Strip leading 4-digit MMDD date codes (run AFTER prefix strip so "ACH 0420 X" → "0420 X" → "X")
  s = s.replace(/^\d{4}\s+/, '');

  // 2. Strip "ONLINE PAY[MENT]" suffix
  s = s.replace(/\s+ONLINE\s+PAY(?:MENT)?\s*$/i, '');

  // 3. Strip "Des:XXXX" and "Indn:XXXX" bank description codes
  s = s.replace(/\b(?:Des|Indn):\S+/gi, '');

  // 4. Strip "Sub XXXX" middle patterns — extract everything after "Sub "
  //    e.g. "Rent Reporting Sub Turbotenant" → "Turbotenant"
  const subMatch = s.match(/\bSub\s+(.+)/i);
  if (subMatch) s = subMatch[1].trim();

  // 5. Strip confirmation/reference codes: "Conf# ABC123", "Ref# 12345", "Trans# …"
  s = s.replace(/\b(?:Conf|Confirmation|Ref|Reference|Trans|Trace|Auth|Seq|Ck|Trn)[#:\s]*[\w-]{3,}/gi, '');

  // 6. Strip # followed by alphanumeric (reference IDs like "#000sgu59l")
  s = s.replace(/#[A-Za-z0-9]{3,}/g, '');

  // 7. Strip date patterns: "04/23", "04/23/2026", "MM/DD" style
  s = s.replace(/\b\d{1,2}\/\d{2}(?:\/\d{2,4})?\b/g, '');

  // 8. Strip trailing store/location numbers: "#1234" at end
  s = s.replace(/\s*#\s*\d{3,}\s*$/g, '');

  // 9. Strip long standalone digit sequences (8+ = reference numbers, not prices)
  s = s.replace(/\b\d{8,}\b/g, '');

  // 10. Strip "Id:XXXXX" ID code patterns
  s = s.replace(/\bId:\S+/gi, '');

  // 11. Strip street addresses — number followed by street name keywords
  s = s.replace(/\b\d+\s+\w+\s+(?:Blvd?|Blv|Ave?|St|Dr|Rd|Ln|Ct|Pl|Way|Pkwy|Hwy)\b.*/i, '');

  // 12. Strip corporate suffixes (including mid-string before address)
  s = s.replace(/,?\s*(Inc\.?|LLC\.?|Corp\.?|Ltd\.?|Co\.)\b.*/i, '');

  // 13. Strip trailing " Pos" suffix (e.g. "Deals By Del Pos")
  s = s.replace(/\s+Pos\s*$/i, '');

  // 14. Strip domain-style suffixes like ".Cco", ".Com", ".Net" that slip through
  s = s.replace(/\.\w{2,4}$/i, '');

  // 15. Strip everything after a comma if the remainder contains any digit mixed with letters
  //     e.g. "Youtalk Wan Chai, Xxxxx3261xx" → "Youtalk Wan Chai"
  s = s.replace(/,\s*[^,]*\d[^,]*$/, '');

  // 16. Strip ACH SEC-code suffixes: " Co Ppd", " Co Web", " Viktor Co", " Sheviakov Co"
  s = s.replace(/\s+(?:\w+\s+)?Co\s+(?:Ppd|Web|Tel|Ccd|Iat|Arc|Ctx|Mte|Pop|Rck|Trc)\s*$/i, '');
  // Personal name + " Co" at end (4+ char word = not "The Co", not "De Co" etc.)
  s = s.replace(/\s+[A-Za-z]{4,}\s+Co\s*$/i, '');

  // 6. Collapse whitespace
  s = s.replace(/\s+/g, ' ').trim();

  if (!s) return '';

  // 7. Title Case — lowercase everything then capitalize first letter of each word
  s = s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());

  // 7b. Fix possessive 'S → 's (title case incorrectly uppercases after apostrophe)
  s = s.replace(/'S\b/g, "'s");

  // 8. Brand-name corrections applied after title-casing
  const BRAND_FIX = [
    [/\bBkofamerica\b/i,         'Bank of America'],
    [/\bMcdonald'?s\b/i,         "McDonald's"],
    [/\bMcdonalds\b/i,           "McDonald's"],
    [/\bTrader\s+Joe'?s\b/i,     "Trader Joe's"],
    [/\bCvs\b/i,                 'CVS'],
    [/\bEbay\b/i,                'eBay'],
    [/\bPaypal\b/i,              'PayPal'],
    [/\bGithub\b/i,              'GitHub'],
    [/\bYoutube\b/i,             'YouTube'],
    [/\bLinkedin\b/i,            'LinkedIn'],
    [/\bWalmart\b/i,             'Walmart'],
    [/\bGood\s+Life\s+Restor\w*/i, 'Good Life Restoration'],
    [/\bYoutalk\b.*/i,             'YouTalk'],
    [/\bUsps\b/i,           'USPS'],
    [/\bAtm\b/i,            'ATM'],
    [/\bAch\b/i,            'ACH'],
    [/\bgolden\s*one\b.*/i, 'Golden One Credit Union'],
  ];
  for (const [pattern, replacement] of BRAND_FIX) {
    s = s.replace(pattern, replacement);
  }

  // 9. Truncate to 30 chars
  if (s.length > 30) s = s.slice(0, 29).trimEnd() + '…';

  return s;
}

function normalizeTxName(t) {
  const raw = (t.description || "").trim();
  const cat = (t.category_name || "").trim();

  if (raw && raw.toLowerCase() !== cat.toLowerCase()) {
    const cleaned = cleanMerchantName(raw);
    if (cleaned) return cleaned;
  }
  if (cat) return cat;
  if (t.type === "income") return "Income";
  return "Unknown";
}

function calcSummary(txs, prevTxs = []) {
  const realExpense = arr => arr.filter(t => t.type === "expense" && t.category_name !== "Transfer").reduce((s, t) => s + Number(t.amount), 0);
  const byIncome = arr => arr.filter(t => t.type === "income").reduce((s, t) => s + Number(t.amount), 0);
  const income  = byIncome(txs);
  const expense = realExpense(txs);
  const net     = income - expense;
  const pIncome  = byIncome(prevTxs);
  const pExpense = realExpense(prevTxs);
  const pNet     = pIncome - pExpense;
  const monthlyGap = Math.max(pExpense - expense, 0);
  const foodSpend  = txs.filter(t => t.type === "expense" && t.category_name === "Food & Dining").reduce((s, t) => s + Number(t.amount), 0);
  const foodGap    = Math.max(300 - foodSpend, 0);
  const surplus    = Math.min(Math.round(Math.max(monthlyGap, foodGap)), 200);
  return {
    income, expense, net, surplus,
    incomeVsPrev:  pIncome  > 0 ? ((income  - pIncome)  / pIncome)  * 100 : null,
    expenseVsPrev: pExpense > 0 ? ((expense - pExpense) / pExpense) * 100 : null,
    netVsPrev:     pNet !== 0   ? net - pNet : null,
  };
}

export function fmtMoney(n, sign = false) {
  const abs = Math.abs(n);
  let s;
  if (abs >= 1_000_000) s = "$" + (abs / 1_000_000).toFixed(1) + "M";
  else if (abs >= 10_000) s = "$" + Math.round(abs).toLocaleString("en-US");
  else {
    const isWhole = abs === Math.floor(abs);
    s = "$" + Number(abs).toLocaleString("en-US", { minimumFractionDigits: isWhole ? 0 : 2, maximumFractionDigits: isWhole ? 0 : 2 });
  }
  if (sign) s = (n >= 0 ? "+" : "−") + s;
  return s;
}

function fmtPct(pct) {
  if (pct === null || pct === undefined) return "—";
  const v = Number(pct);
  return (v >= 0 ? "+" : "") + v.toFixed(2) + "%";
}

function deriveSignal(t) {
  if (t.is_recurring) return "recurring";
  if (t.type === "expense" && Number(t.amount) > 500) return "spike";
  if (t.unusual) return "unusual";
  return null;
}

const SIGNAL_STYLE = {
  spike:     { label: "↑ Spike",     color: "#FF5C7A", bg: "rgba(255,92,122,0.13)" },
  unusual:   { label: "⚠ Unusual",   color: "#FFB800", bg: "rgba(255,184,0,0.13)"  },
  recurring: { label: "↻ Recurring", color: "#2F80FF", bg: "rgba(47,128,255,0.13)" },
};

const CAT_ICONS_MAP = {
  "Food & Dining": "food", "Transport": "car", "Shopping": "shopping",
  "Entertainment": "film", "Health": "heart", "Bills": "file", "Subscriptions": "repeat",
  "Travel": "plane", "Housing": "home", "Personal Care": "heart",
  "Transfer": "repeat", "Income": "dollar", "Cost of Debt": "credit",
};

export function useToasts() {
  const [toasts, setToasts]   = useState([]);
  const timers                = useRef({});

  const dismiss = (id) => {
    // Mark as exiting for slide-out animation, then remove after 300ms
    setToasts(prev => prev.map(x => x.id === id ? { ...x, exiting: true } : x));
    setTimeout(() => setToasts(prev => prev.filter(x => x.id !== id)), 300);
    clearTimeout(timers.current[id]);
    delete timers.current[id];
  };

  const show = (msg, type = "success", icon = null) => {
    const id = "t" + Date.now() + Math.random().toString(36).slice(2);
    setToasts(prev => [...prev.slice(-4), { id, msg, type, icon, exiting: false }]);
    timers.current[id] = setTimeout(() => dismiss(id), 4000);
  };

  return { toasts, show, dismiss };
}

export function ToastStack({ toasts, dismiss }) {
  const cfg = {
    success: { color: "#12D18E", border: "#12D18E33", icon: "check-circle" },
    warning: { color: "#FFB800", border: "#FFB80033", icon: "alert-circle" },
    danger:  { color: "#FF5C7A", border: "#FF5C7A33", icon: "alert-circle" },
    info:    { color: "#2F80FF", border: "#2F80FF33", icon: "bell" },
  };
  return (
    <div style={{ position: "fixed", bottom: 92, left: "50%", transform: "translateX(-50%)", display: "flex", flexDirection: "column", gap: 8, alignItems: "center", zIndex: 300, width: "100%", maxWidth: 400, padding: "0 16px", boxSizing: "border-box" }}>
      <style>{`
        @keyframes txIn  { from { opacity:0; transform:translateY(12px) scale(0.97) } to { opacity:1; transform:translateY(0) scale(1) } }
        @keyframes txOut { from { opacity:1; transform:translateY(0) scale(1) }         to { opacity:0; transform:translateY(8px) scale(0.97) } }
      `}</style>
      {toasts.map(t => {
        const c = cfg[t.type] || cfg.success;
        return (
          <div key={t.id} style={{
            display: "flex", alignItems: "flex-start", gap: 10,
            background: "rgba(9,18,34,0.97)", border: `1px solid ${c.border}`,
            borderRadius: 16, padding: "11px 12px 11px 12px",
            animation: `${t.exiting ? "txOut" : "txIn"} 0.25s ease forwards`,
            fontFamily: FONT, boxShadow: "0 4px 24px rgba(0,0,0,0.5)",
            width: "100%", boxSizing: "border-box", pointerEvents: "auto",
          }}>
            <div style={{ width: 24, height: 24, borderRadius: 12, background: c.color + "22", border: `1px solid ${c.color}55`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 }}>
              <Icon name={t.icon || c.icon} size={13} color={c.color} strokeWidth={2.2} />
            </div>
            <span style={{ fontSize: 13, fontWeight: 500, color: "#fff", flex: 1, lineHeight: 1.4, paddingTop: 3 }}>{t.msg}</span>
            {dismiss && (
              <button onClick={() => dismiss(t.id)} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: "2px 0 0 4px", flexShrink: 0 }}>×</button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function SummaryCards({ summary, onIncomeClick, onExpenseClick, onNetClick }) {
  const { t } = useTranslation();
  const hasIncPrev  = summary.incomeVsPrev  !== null;
  const hasExpPrev  = summary.expenseVsPrev !== null;
  const hasNetPrev  = summary.netVsPrev     !== null;

  const incomeCtx     = hasIncPrev ? fmtPct(summary.incomeVsPrev) + " " + t("transactions.ctx_vs_last_mo") : null;
  const incomeCtxClr  = hasIncPrev ? ((summary.incomeVsPrev ?? 0) >= 0 ? "#12D18E" : "#FF5C7A") : C.faint;

  const expVsBudgetPct = summary.income > 0 ? Math.round((summary.expense / summary.income) * 100) : null;
  const isOverBudget  = hasExpPrev ? (summary.expenseVsPrev ?? 0) > 10 : (expVsBudgetPct !== null && expVsBudgetPct > 80);
  const expenseCtx    = hasExpPrev
    ? fmtPct(summary.expenseVsPrev) + " " + t("transactions.ctx_vs_budget")
    : expVsBudgetPct !== null ? t("transactions.ctx_of_income", { pct: expVsBudgetPct }) : null;
  const expenseCtxClr = isOverBudget ? "#FF5C7A" : "#12D18E";

  const netCtx    = hasNetPrev
    ? fmtMoney(summary.netVsPrev, true) + " " + t("transactions.ctx_vs_last_mo")
    : summary.income > 0 ? fmtMoney(summary.income - summary.expense, true) + " " + t("transactions.ctx_net_balance") : null;
  const netCtxClr = hasNetPrev ? ((summary.netVsPrev ?? 0) >= 0 ? "#12D18E" : "#FF5C7A") : summary.net >= 0 ? "#12D18E" : "#FF5C7A";

  const cards = [
    { label: t("transactions.income"),   value: fmtMoney(summary.income),        valColor: "#12D18E",                                     ctx: incomeCtx,  ctxColor: incomeCtxClr,  badge: null,                                                           onClick: onIncomeClick },
    { label: t("transactions.filter_expense"), value: fmtMoney(summary.expense), valColor: "#FF5C7A",                                     ctx: expenseCtx, ctxColor: expenseCtxClr, badge: summary.income === 0 ? t("transactions.badge_no_income") : isOverBudget ? t("transactions.badge_over_budget") : summary.net < 0 ? null : t("transactions.badge_within_budget"), badgeOk: summary.income === 0 ? null : !isOverBudget, onClick: onExpenseClick },
    { label: t("dashboard.net"),         value: fmtMoney(summary.net, true),     valColor: summary.net > 0 ? "#12D18E" : summary.net < 0 ? "#FF5C7A" : "#FFB800", ctx: netCtx,     ctxColor: netCtxClr,     badge: summary.net > 0 ? t("transactions.badge_surplus") : summary.net < 0 ? t("transactions.badge_deficit") : t("transactions.badge_balanced"), badgeOk: summary.net > 0 ? true : summary.net < 0 ? false : null, highlight: true, highlightColor: summary.net > 0 ? "#12D18E" : summary.net < 0 ? "#FF5C7A" : "#FFB800", onClick: onNetClick },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 6, marginBottom: 8 }}>
      {cards.map(card => (
        <button key={card.label} onClick={card.onClick}
          style={{ background: card.highlight ? `${card.highlightColor}12` : C.card, border: `1px solid ${card.highlight ? `${card.highlightColor}33` : C.border}`, borderRadius: 14, padding: "12px 10px", display: "flex", flexDirection: "column", gap: 3, cursor: "pointer", textAlign: "left", fontFamily: FONT, minHeight: 90, transition: "transform 0.12s ease" }}
          onPointerDown={e => e.currentTarget.style.transform = "scale(0.96)"}
          onPointerUp={e => e.currentTarget.style.transform = ""}
          onPointerLeave={e => e.currentTarget.style.transform = ""}
        >
          <span style={{ fontSize: 10, fontWeight: 600, color: C.faint, letterSpacing: 0.5, textTransform: "uppercase" }}>{card.label}</span>
          <span style={{ fontSize: 15, fontWeight: 700, color: card.valColor, letterSpacing: -0.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{card.value}</span>
          {card.ctx
            ? <span style={{ fontSize: 10, color: card.ctxColor, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{card.ctx}</span>
            : <span style={{ fontSize: 10, color: C.faint }}>{t("transactions.this_month")}</span>
          }
          {card.badge && (
            <span style={{ fontSize: 9, fontWeight: 700, color: card.badgeOk === null ? "#FFB800" : card.badgeOk ? "#12D18E" : "#FF5C7A", background: card.badgeOk === null ? "rgba(255,184,0,0.12)" : card.badgeOk ? "rgba(18,209,142,0.12)" : "rgba(255,92,122,0.12)", padding: "2px 6px", borderRadius: 4, alignSelf: "flex-start", letterSpacing: 0.4, textTransform: "uppercase", marginTop: 2 }}>{card.badge}</span>
          )}
        </button>
      ))}
    </div>
  );
}

const INSIGHT_DEFS = [
  {
    type: "warning",
    priority: 1,
    accent: "#FFB800", icon: "alert-circle", label: "Heads up",
    show: s => (s.expenseVsPrev !== null && s.expenseVsPrev > 10) || (s._topExpenseAmt > 400),
    autoExpand: s => (s.expenseVsPrev > 30) || (s._topExpenseAmt > 500),
    compactHeadline: s => {
      const cat = s._topExpenseCat || "Transport";
      const amt = s._topExpenseAmt ? fmtMoney(Math.round(s._topExpenseAmt)) : null;
      return amt ? `You overspent on ${cat} — ${amt}` : `You're over budget on ${cat}`;
    },
    headline: s => {
      const cat = s._topExpenseCat || "Transport";
      if (s.expenseVsPrev > 10) {
        const extra = Math.round(s.expense - (s.expense / (1 + s.expenseVsPrev / 100)));
        return `You overspent by ${fmtMoney(extra)} this month`;
      }
      return `You're over budget on ${cat}`;
    },
    body: s => {
      const cat = s._topExpenseCat || "Transport";
      const amt = fmtMoney(Math.round(s._topExpenseAmt || 590));
      const isSpike = s._topExpenseAmt > 400;

      // Check if the top expense is a known recurring payment (e.g. rent via Turbotenant)
      const catLower = cat.toLowerCase();
      const isRecurring =
        // Category-based: top spending category or category of the biggest single tx
        (s._recurringCategories && (
          s._recurringCategories.has(catLower) ||
          s._recurringCategories.has(s._topExpenseTxCat || "")
        )) ||
        // Merchant-based: normalized description of biggest tx matches a known recurring merchant
        (s._recurringMerchants && s._topExpenseDesc && s._topExpenseDesc.length >= 3 &&
          [...s._recurringMerchants].some(m =>
            s._topExpenseDesc.includes(m) ||       // exact normalized match
            m.includes(s._topExpenseDesc) ||        // tx desc is substring of merchant key
            (s._topExpenseDesc.length >= 6 && m.includes(s._topExpenseDesc.slice(0, 12)))
          ));
      console.log("[AIInsightCard] isRecurring:", isRecurring, "| catLower:", catLower, "| _topExpenseTxCat:", s._topExpenseTxCat);

      const cause = `This increase was caused by ${amt} in ${cat}. Your usual ${cat.toLowerCase()} spending is much lower.`;
      const interpretation = isRecurring
        ? `→ This is a regular monthly expense, not a one-time event.`
        : isSpike
          ? `→ This appears to be a one-time expense, not a trend.`
          : `→ Your ${cat} spending is running above typical levels this month.`;
      const guidance = isRecurring
        ? `→ This charge recurs monthly — budget for it going forward.`
        : `→ No changes needed now, but monitor next month to confirm stability.`;
      return `${cause}\n\n${interpretation}\n${guidance}`;
    },
    p:     "Reduce spending",
    pMsg:  "Spending limit set",
    pType: "warning",
    s1:    "View breakdown",
    s2:    "Exclude this item",
    s2Msg: "Excluded from budget",
  },
  {
    type: "opportunity",
    priority: 2,
    accent: "#2F80FF", icon: "zap", label: "Opportunity",
    show: s => s.surplus >= 20 && s.income > s.expense,
    autoExpand: s => s.surplus >= 100,
    compactHeadline: s => `You can save ${fmtMoney(Math.round(s.surplus))} this month`,
    headline:        s => `You can save ${fmtMoney(Math.round(s.surplus))} this month`,
    body: s => {
      const safeAmt = Math.max(s.income - s.expense, 0);
      const rec = safeAmt < 800
        ? Math.min(Math.max(Math.round(safeAmt * 0.6), 50), 100)
        : Math.min(Math.max(Math.round(safeAmt * 0.6), 200), 400);
      const max = Math.round(s.surplus);
      return `You finished under budget this month — a good sign.\n\nA safe contribution this month is $${rec}–$${Math.min(rec + 100, max)} to keep your buffer stable.\n\n→ Moving even a small amount builds long-term momentum.`;
    },
    p:     "Move to savings",
    pMsg:  s => `${fmtMoney(Math.round(s.surplus))} moved to savings`,
    pType: "success",
    s1:    "View projection",
    s2:    "Adjust my goal",
  },
  {
    type: "positive",
    priority: 3,
    accent: "#12D18E", icon: "trending-up", label: "On track",
    show: s => (s.netVsPrev ?? 0) >= 0 && s.net > 0,
    autoExpand: () => false,
    compactHeadline: s => s.netVsPrev > 0
      ? `You're ${fmtMoney(Math.round(s.netVsPrev))} ahead this month`
      : "You're on a 3-week saving streak",
    headline: s => s.netVsPrev > 0
      ? `You're ${fmtMoney(Math.round(s.netVsPrev))} ahead this month`
      : "You're on a 3-week saving streak",
    body: s => {
      const ahead = s.netVsPrev > 0 ? fmtMoney(Math.round(s.netVsPrev)) : null;
      return ahead
        ? `You're ${ahead} ahead compared to last month — your spending discipline is working.\n\n→ Consider moving part of this surplus to savings to lock in the progress.`
        : `Your spending is stable and within budget this month.\n\n→ A consistent pattern like this is the foundation of financial health. Keep it up.`;
    },
    p:     "Boost savings",
    pMsg:  "Savings goal updated",
    pType: "success",
    s1:    "View trend",
    s2:    "Share progress",
    s2Msg: "Copied to clipboard",
  },
];

function shouldAutoExpand(def, enriched) {
  if (def.type === "positive") return false;
  return def.autoExpand ? def.autoExpand(enriched) : false;
}

function AIInsightCard({ summary, transactions, onAction }) {
  const { t } = useTranslation();
  const enriched = { ...summary };
  if (transactions && transactions.length > 0) {
    const expenses = transactions.filter(t => t.type === "expense");
    const bycat = expenses.reduce((a, t) => {
      const k = t.category_name || "Other";
      a[k] = (a[k] || 0) + Number(t.amount);
      return a;
    }, {});
    const top = Object.entries(bycat).sort((a, b) => b[1] - a[1])[0];
    if (top) { enriched._topExpenseCat = top[0]; enriched._topExpenseAmt = top[1]; }

    // Build a set of recurring merchant names and categories so the insight
    // body can avoid labelling known recurring charges as "one-time"
    const recurringMerchantNames = new Set();
    const recurringCategories = new Set([
      "rent", "mortgage", "bills", "utilities", "subscriptions",
      "insurance", "phone", "internet", "loan", "finance",
    ]);
    const merchantMap = {};
    expenses.forEach(t => {
      const raw = (t.description || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40);
      if (!raw || raw.length < 2) return;
      const mo = (t.date || "").slice(0, 7);
      if (!merchantMap[raw]) merchantMap[raw] = { months: new Set(), amounts: [] };
      merchantMap[raw].months.add(mo);
      merchantMap[raw].amounts.push(Number(t.amount));
    });
    Object.entries(merchantMap).forEach(([name, d]) => {
      if (d.months.size < 2) return;
      const spread = Math.max(...d.amounts) - Math.min(...d.amounts);
      if (spread <= 10) recurringMerchantNames.add(name);
    });
    enriched._recurringMerchants = recurringMerchantNames;
    enriched._recurringCategories = recurringCategories;
    // Normalize helper — same pipeline as merchantMap keys
    const norm = s => (s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
    // Top single transaction by amount — normalized description + its category
    const topTx = expenses.sort((a, b) => Number(b.amount) - Number(a.amount))[0];
    if (topTx) {
      enriched._topExpenseDesc    = norm(topTx.description);
      enriched._topExpenseTxCat   = (topTx.category_name || "").toLowerCase();
    }
    console.log("[AIInsightCard] _recurringMerchants:", [...recurringMerchantNames]);
    console.log("[AIInsightCard] _topExpenseDesc (normalized):", enriched._topExpenseDesc);
    console.log("[AIInsightCard] _topExpenseCat (highest total category):", enriched._topExpenseCat);
    console.log("[AIInsightCard] _topExpenseTxCat (category of biggest tx):", enriched._topExpenseTxCat);
  }

  const def = INSIGHT_DEFS
    .filter(d => d.show(enriched))
    .sort((a, b) => a.priority - b.priority)[0] || null;

  const autoExp = def ? shouldAutoExpand(def, enriched) : false;
  const [expanded, setExpanded] = useState(autoExp);
  const [paused,   setPaused]   = useState(false);
  const resumeRef = useRef(null);

  if (!def) {
    const hasPositiveState = summary.net >= 0 && summary.income > 0;
    return (
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: "13px 14px", marginBottom: 10, display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ width: 26, height: 26, minWidth: 26, borderRadius: 8, background: hasPositiveState ? "rgba(18,209,142,0.14)" : "rgba(74,94,122,0.14)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icon name={hasPositiveState ? "check-circle" : "info"} size={13} color={hasPositiveState ? "#12D18E" : C.faint} strokeWidth={2} />
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.text, fontFamily: FONT }}>{hasPositiveState ? t("transactions.on_track_month") : t("insights.no_data")}</div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 2, fontFamily: FONT }}>{hasPositiveState ? t("transactions.no_unusual") : t("transactions.add_to_see_insights")}</div>
        </div>
      </div>
    );
  }

  function pause() {
    setPaused(true);
    clearTimeout(resumeRef.current);
    resumeRef.current = setTimeout(() => setPaused(false), 15000);
  }

  const resolve = v => typeof v === "function" ? v(enriched) : v;

  function handleCTA(msgField, type) {
    pause();
    const msg = resolve(msgField);
    if (msg) onAction(msg, type);
  }

  const accent             = def.accent;
  const compactHeadlineText = resolve(def.compactHeadline) || resolve(def.headline);

  return (
    <div style={{ marginBottom: 10 }}>
      <style>{`.ins-anim{animation:insIn 0.28s ease forwards}@keyframes insIn{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}`}</style>
      <div className="ins-anim"
        style={{ background: accent + "0D", border: `1px solid ${accent}26`, borderRadius: 14, overflow: "hidden" }}>
        <div
          onClick={autoExp ? undefined : () => { setExpanded(e => !e); pause(); }}
          style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 13px", cursor: autoExp ? "default" : "pointer" }}>
          <div style={{ width: 22, height: 22, minWidth: 22, borderRadius: 7, background: accent + "20", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Icon name={def.icon} size={11} color={accent} strokeWidth={2.2} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: accent, letterSpacing: 0.6, textTransform: "uppercase", fontFamily: FONT, display: "block", marginBottom: 2 }}>{t("transactions.insight_" + def.type)}</span>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.text, letterSpacing: -0.15, fontFamily: FONT, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {compactHeadlineText}
            </div>
          </div>
          {!autoExp && (
            <div style={{ color: C.faint, fontSize: 13, marginLeft: 2, flexShrink: 0, transition: "transform 0.22s ease", transform: expanded ? "rotate(180deg)" : "rotate(0deg)", opacity: 0.6 }}>▾</div>
          )}
        </div>

        {expanded && (
          <div style={{ padding: "10px 13px 13px", borderTop: `1px solid ${accent}18` }}>
            <div style={{ fontSize: 12, color: "rgba(168,198,228,0.82)", lineHeight: 1.6, marginBottom: 12, fontFamily: FONT, whiteSpace: "pre-line" }}>
              {resolve(def.body)}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              <button onClick={() => handleCTA(def.pMsg, def.pType)}
                style={{ width: "100%", padding: "11px 16px", background: `linear-gradient(135deg,${accent},${accent}CC)`, border: "none", borderRadius: 10, color: "#fff", fontWeight: 600, fontSize: 13, cursor: "pointer", fontFamily: FONT, minHeight: 44, letterSpacing: -0.1, boxShadow: `0 3px 10px ${accent}32`, transition: "filter 0.12s" }}
                onPointerDown={e => e.currentTarget.style.filter = "brightness(0.84)"}
                onPointerUp={e => e.currentTarget.style.filter = ""}
                onPointerLeave={e => e.currentTarget.style.filter = ""}
              >{resolve(def.p)}</button>
              <div style={{ display: "flex", gap: 7 }}>
                <button onClick={() => handleCTA(null, "info")}
                  style={{ flex: 1, padding: "7px 8px", background: "transparent", border: `1px solid ${accent}28`, borderRadius: 10, color: accent, fontWeight: 500, fontSize: 11, cursor: "pointer", fontFamily: FONT, minHeight: 36, opacity: 0.75 }}
                >{def.s1}</button>
                <button onClick={() => handleCTA(def.s2Msg || null, "info")}
                  style={{ flex: 1, padding: "7px 8px", background: "transparent", border: `1px solid ${accent}18`, borderRadius: 10, color: accent, fontWeight: 400, fontSize: 11, cursor: "pointer", fontFamily: FONT, minHeight: 36, opacity: 0.55 }}
                >{def.s2}</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function QuickActionsMenu({ tx, onClose, onEdit, onDelete, onMoveToSavings, onFlag, onDuplicate }) {
  const { t } = useTranslation();
  const actions = [
    { label: t("transactions.action_edit"),          desc: t("transactions.action_edit_desc"),          icon: "edit",         color: "#2F80FF", fn: () => { onClose(); onEdit(tx); } },
    { label: t("transactions.action_move_savings"),  desc: t("transactions.action_move_savings_desc"),  icon: "target",       color: "#12D18E", fn: () => { onClose(); onMoveToSavings(tx); } },
    { label: t("transactions.action_flag"),          desc: t("transactions.action_flag_desc"),          icon: "alert-circle", color: "#FFB800", fn: () => { onClose(); onFlag(tx); } },
    { label: t("transactions.action_duplicate"),     desc: t("transactions.action_duplicate_desc"),     icon: "repeat",       color: "#2F80FF", fn: () => { onClose(); onDuplicate(tx); } },
    { label: t("transactions.delete"),               desc: t("transactions.action_delete_desc"),        icon: "x",            color: "#FF5C7A", danger: true, fn: () => { onClose(); onDelete(tx.id); } },
  ];
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 150, display: "flex", alignItems: "flex-end", maxWidth: 430, margin: "0 auto" }} onClick={onClose}>
      <div style={{ width: "100%", background: C.card, borderRadius: "22px 22px 0 0", border: `1px solid ${C.border}`, paddingBottom: 32, fontFamily: FONT }} onClick={e => e.stopPropagation()}>
        <div style={{ width: 32, height: 4, background: "rgba(255,255,255,0.11)", borderRadius: 2, margin: "10px auto 0" }} />
        <div style={{ fontSize: 16, fontWeight: 600, color: C.text, padding: "14px 18px 3px", letterSpacing: -0.3 }}>{normalizeTxName(tx)}</div>
        <div style={{ height: 1, background: C.sep, margin: "10px 0 2px" }} />
        {actions.map(a => (
          <button key={a.label} onClick={a.fn}
            style={{ width: "100%", display: "flex", alignItems: "center", gap: 14, padding: "13px 18px", background: "none", border: "none", cursor: "pointer", textAlign: "left", fontFamily: FONT, minHeight: 56 }}
            onPointerEnter={e => e.currentTarget.style.background = C.bgSecondary}
            onPointerLeave={e => e.currentTarget.style.background = "none"}
          >
            <div style={{ width: 36, height: 36, borderRadius: 10, background: a.color + "18", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Icon name={a.icon} size={15} color={a.color} strokeWidth={1.8} />
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 500, color: a.danger ? "#FF5C7A" : C.text }}>{a.label}</div>
              <div style={{ fontSize: 11, color: C.faint, marginTop: 1 }}>{a.desc}</div>
            </div>
          </button>
        ))}
        <button onClick={onClose} style={{ display: "block", width: "calc(100% - 32px)", margin: "4px 16px 0", padding: 13, textAlign: "center", fontSize: 13, fontWeight: 500, color: C.muted, background: C.bgSecondary, border: "none", borderRadius: 10, cursor: "pointer", fontFamily: FONT, minHeight: 48 }}>
          {t("transactions.cancel")}
        </button>
      </div>
    </div>
  );
}

function BreakdownSheet({ title, subtitle, rows, actionLabel, actionColor, onAction, onClose }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 150, display: "flex", alignItems: "flex-end", maxWidth: 430, margin: "0 auto" }} onClick={onClose}>
      <div style={{ width: "100%", background: C.card, borderRadius: "22px 22px 0 0", border: `1px solid ${C.border}`, maxHeight: "85vh", overflowY: "auto", paddingBottom: 32, fontFamily: FONT }} onClick={e => e.stopPropagation()}>
        <div style={{ width: 32, height: 4, background: "rgba(255,255,255,0.11)", borderRadius: 2, margin: "10px auto 0" }} />
        <div style={{ fontSize: 16, fontWeight: 600, color: C.text, padding: "14px 18px 3px", letterSpacing: -0.3 }}>{title}</div>
        <div style={{ fontSize: 12, color: C.faint, padding: "0 18px 12px" }}>{subtitle}</div>
        <div style={{ height: 1, background: C.sep, marginBottom: 2 }} />
        {rows.map((r, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "11px 18px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 11, flex: 1, minWidth: 0 }}>
              <div style={{ width: 32, height: 32, minWidth: 32, borderRadius: 9, background: r.color + "18", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Icon name={r.icon || "dollar"} size={14} color={r.color} strokeWidth={1.8} />
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</div>
                {r.sub && <div style={{ fontSize: 11, color: C.faint, marginTop: 1 }}>{r.sub}</div>}
              </div>
            </div>
            <div style={{ textAlign: "right", flexShrink: 0, paddingLeft: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.text, whiteSpace: "nowrap" }}>{r.amount}</div>
              {r.pct !== undefined && (
                <div style={{ height: 2, width: 60, background: "rgba(255,255,255,0.07)", borderRadius: 1, marginTop: 5, marginLeft: "auto" }}>
                  <div style={{ height: "100%", width: Math.min(r.pct, 100) + "%", background: r.color, borderRadius: 1 }} />
                </div>
              )}
            </div>
          </div>
        ))}
        {actionLabel && (
          <button onClick={() => { onAction(); onClose(); }} style={{ display: "block", width: "calc(100% - 32px)", margin: "10px 16px 0", padding: 13, textAlign: "center", fontSize: 14, fontWeight: 600, color: "#fff", background: actionColor, border: "none", borderRadius: 14, cursor: "pointer", fontFamily: FONT, minHeight: 48 }}>
            {actionLabel}
          </button>
        )}
      </div>
    </div>
  );
}

export function TxRow({ t, onDelete, onEdit, onLongPress, hideAmount = false }) {
  const { t: i18t } = useTranslation();
  const rowRef   = useRef(null);
  const bgLRef   = useRef(null);
  const bgRRef   = useRef(null);
  const startX   = useRef(0);
  const dragging = useRef(false);
  const moved    = useRef(false);
  const lpTimer  = useRef(null);
  const [swiped, setSwiped] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const signal      = deriveSignal(t);
  const isIncome    = t.type === "income";
  const catColor    = CAT_COLORS[t.category_name] || C.blue;
  const catIcon     = isIncome ? "dollar" : (CAT_ICONS_MAP[t.category_name] || "credit");
  const displayName = normalizeTxName(t);

  function resetSwipe() {
    if (!rowRef.current) return;
    rowRef.current.style.transition = "transform 0.28s cubic-bezier(.22,1,.36,1)";
    rowRef.current.style.transform  = "translateX(0)";
    if (bgLRef.current) bgLRef.current.style.opacity = "0";
    if (bgRRef.current) bgRRef.current.style.opacity = "0";
    setSwiped(null);
  }

  function onPD(e) {
    startX.current  = e.clientX;
    dragging.current = true;
    moved.current    = false;
    if (rowRef.current) rowRef.current.style.transition = "none";
    lpTimer.current = setTimeout(() => {
      if (!moved.current && dragging.current) {
        dragging.current = false;
        resetSwipe();
        onLongPress && onLongPress(t);
      }
    }, 480);
  }

  function onPM(e) {
    if (!dragging.current) return;
    const dx = e.clientX - startX.current;
    if (!moved.current && Math.abs(dx) > 6) { moved.current = true; clearTimeout(lpTimer.current); }
    if (!moved.current) return;
    const cl = Math.max(-82, Math.min(82, dx));
    if (rowRef.current) rowRef.current.style.transform = `translateX(${cl}px)`;
    if (bgLRef.current) bgLRef.current.style.opacity = cl >  14 ? String(Math.min(1, cl / 76))             : "0";
    if (bgRRef.current) bgRRef.current.style.opacity = cl < -14 ? String(Math.min(1, Math.abs(cl) / 76)) : "0";
  }

  function onPU(e) {
    clearTimeout(lpTimer.current);
    if (!dragging.current) return;
    dragging.current = false;
    const dx = e.clientX - startX.current;
    if (rowRef.current) rowRef.current.style.transition = "transform 0.28s cubic-bezier(.22,1,.36,1)";
    if (!moved.current) return;
    if (dx < -46) {
      rowRef.current.style.transform = "translateX(-76px)";
      if (bgRRef.current) bgRRef.current.style.opacity = "1";
      setSwiped("left");
    } else if (dx > 46) {
      rowRef.current.style.transform = "translateX(76px)";
      if (bgLRef.current) bgLRef.current.style.opacity = "1";
      setSwiped("right");
    } else {
      resetSwipe();
    }
  }

  function handleClick() {
    if (swiped === "right") { resetSwipe(); onEdit(t); return; }
    if (swiped === "left")  { resetSwipe(); setConfirmDelete(true); return; }
    onLongPress && onLongPress(t);
  }

  return (
    <div style={{ position: "relative", overflow: "hidden", borderRadius: 14, marginBottom: 2 }}>
      <div ref={bgLRef} onClick={() => { resetSwipe(); onEdit(t); }} style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 76, background: C.blue, borderRadius: "14px 0 0 14px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3, opacity: 0, transition: "opacity 0.14s", cursor: "pointer" }}>
        <Icon name="edit" size={16} color="#fff" strokeWidth={1.8} />
        <span style={{ fontSize: 10, fontWeight: 600, color: "#fff", fontFamily: FONT }}>{i18t("transactions.edit")}</span>
      </div>
      <div ref={bgRRef} onClick={() => { resetSwipe(); setConfirmDelete(true); }} style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 76, background: C.red, borderRadius: "0 14px 14px 0", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3, opacity: 0, transition: "opacity 0.14s", cursor: "pointer" }}>
        <Icon name="x" size={16} color="#fff" strokeWidth={2} />
        <span style={{ fontSize: 10, fontWeight: 600, color: "#fff", fontFamily: FONT }}>{i18t("transactions.delete")}</span>
      </div>
      {confirmDelete && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 24px" }} onClick={e => { if (e.target === e.currentTarget) setConfirmDelete(false); }}>
          <div style={{ background: "#111E33", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 18, padding: "24px 20px", width: "100%", maxWidth: 360, fontFamily: FONT }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: C.text, marginBottom: 8 }}>{i18t("transactions.delete_confirm_title")}</div>
            <div style={{ fontSize: 13, color: C.faint, marginBottom: 24 }}>{i18t("transactions.delete_confirm_body", { name: displayName })}</div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setConfirmDelete(false)} style={{ flex: 1, padding: "12px 0", borderRadius: 12, border: "1px solid rgba(255,255,255,0.12)", background: "transparent", color: C.text, fontSize: 15, fontWeight: 600, cursor: "pointer", fontFamily: FONT }}>{i18t("transactions.cancel")}</button>
              <button onClick={() => { setConfirmDelete(false); onDelete(t.id); }} style={{ flex: 1, padding: "12px 0", borderRadius: 12, border: "none", background: C.red, color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer", fontFamily: FONT }}>{i18t("transactions.delete")}</button>
            </div>
          </div>
        </div>
      )}
      <div ref={rowRef} onClick={handleClick} onPointerDown={onPD} onPointerMove={onPM} onPointerUp={onPU} onPointerLeave={e => { if (dragging.current) onPU(e); }} onPointerCancel={() => { dragging.current = false; moved.current = false; clearTimeout(lpTimer.current); resetSwipe(); }}
        style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: "12px 13px", display: "flex", alignItems: "center", gap: 11, cursor: "pointer", userSelect: "none", willChange: "transform", position: "relative", zIndex: 1, touchAction: "pan-y", minHeight: 64 }}>
        <div style={{ width: 40, height: 40, minWidth: 40, borderRadius: 11, background: catColor + "20", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Icon name={catIcon} size={16} color={catColor} strokeWidth={1.8} />
        </div>
        <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: C.text, letterSpacing: -0.15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: FONT }}>{displayName}</div>
          <div style={{ fontSize: 11, color: C.faint, marginTop: 2, display: "flex", alignItems: "center", gap: 4, overflow: "hidden", fontFamily: FONT }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flexShrink: 1 }}>{tCat(t.category_name || guessCategory(t.description, t.type) || "Other", i18t)} · {fmtDate(t.date)}</span>
            {signal && (
              <span style={{ fontSize: 10, fontWeight: 700, color: SIGNAL_STYLE[signal].color, background: SIGNAL_STYLE[signal].bg, padding: "1px 5px", borderRadius: 4, flexShrink: 0 }}>
                {i18t("transactions.signal_" + signal)}
              </span>
            )}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", flexShrink: 0, paddingLeft: 8, gap: 2 }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: isIncome ? "#12D18E" : "#FF5C7A", letterSpacing: -0.35, fontFamily: FONT }}>
            {hideAmount ? "••••" : `${isIncome ? "+" : "−"}${fmtMoney(Number(t.amount))}`}
          </span>
          {t._incomeTotal > 0 && !isIncome && Number(t.amount) > 0 && (
            (() => { const p = Math.round((Number(t.amount) / t._incomeTotal) * 100); return p >= 1 && p <= 500 ? <span style={{ fontSize: 11, color: "#7A8EA8", fontWeight: 600, fontFamily: FONT, letterSpacing: 0.1 }}>{p}%</span> : null; })()
          )}
        </div>
      </div>
    </div>
  );
}

export default function Transactions({ transactions, categories, onAdd, onDelete, onEdit, activeCatFilter, onClearCatFilter, insight, onInsightAction, onToast }) {
  const { t } = useTranslation();
  const [filter,          setFilter]          = useState("all");
  const [search,          setSearch]          = useState("");
  const [searchFocused,   setSearchFocused]   = useState(false);
  const [localCatFilter,  setLocalCatFilter]  = useState(null);
  const [showCatDropdown, setShowCatDropdown] = useState(false);
  const [visibleCount,    setVisibleCount]    = useState(50);
  const [sheet,           setSheet]           = useState(null);
  const [quickTx,         setQuickTx]         = useState(null);
  const [hintDone,        setHintDone]        = useState(false);
  const sentinelRef = useRef(null);

  // Reset visible count when filters change
  useEffect(() => { setVisibleCount(50); }, [filter, search, activeCatFilter, localCatFilter]);

  // IntersectionObserver — load 50 more when sentinel scrolls into view
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) setVisibleCount(n => n + 50);
    }, { rootMargin: "200px" });
    obs.observe(el);
    return () => obs.disconnect();
  }, [filter, search, activeCatFilter, localCatFilter]);
  const { toasts, show: _localToast, dismiss } = useToasts();
  const toast = onToast || _localToast;
  const catFilter = activeCatFilter || localCatFilter || null;

  const [monthOffset, setMonthOffset] = useState(() => {
    const now = new Date();
    const hasCurrentMonth = transactions.some(t => {
      const d = new Date(t.date + 'T00:00:00');
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    });
    if (!hasCurrentMonth && transactions.length > 0) return -1;
    return 0;
  });
  const realNow = new Date();
  const now     = new Date(realNow.getFullYear(), realNow.getMonth() + monthOffset, 1);
  const prevMo  = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const curTxs  = transactions.filter(t => { const d = parseDate(t.date); return d.getMonth() === now.getMonth()    && d.getFullYear() === now.getFullYear(); });
  const prevTxs = transactions.filter(t => { const d = parseDate(t.date); return d.getMonth() === prevMo.getMonth() && d.getFullYear() === prevMo.getFullYear(); });

  const hasCurrentIncome = curTxs.some(t => t.type === "income");
  const effectiveCurTxs = hasCurrentIncome ? curTxs : (() => {
    const lastIncome = [...transactions]
      .filter(t => t.type === "income")
      .sort((a, b) => new Date(b.date) - new Date(a.date))[0];
    return lastIncome ? [...curTxs, lastIncome] : curTxs;
  })();

  const summary = calcSummary(effectiveCurTxs, prevTxs);

  const monthTxs = transactions.filter(t => { const d = parseDate(t.date); return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear(); });
  let filtered = filter === "all" ? monthTxs : monthTxs.filter(t => t.type === filter);
  if (catFilter) filtered = filtered.filter(t => t.category_name === catFilter);
  if (search.trim()) {
    const q = search.trim().toLowerCase();
    filtered = filtered.filter(t =>
      (t.description || "").toLowerCase().includes(q) ||
      (t.category_name || "").toLowerCase().includes(q) ||
      String(t.amount).includes(q)
    );
  }

  const counts = {
    all:     monthTxs.length,
    expense: monthTxs.filter(t => t.type === "expense").length,
    income:  monthTxs.filter(t => t.type === "income").length,
  };

  const expenseMap  = transactions.filter(t => t.type === "expense" && t.category_name !== "Transfer").reduce((a, t) => { const k = t.category_name || "Other"; a[k] = (a[k] || 0) + Number(t.amount); return a; }, {});
  const expenseRows = Object.entries(expenseMap).sort((a, b) => b[1] - a[1]).map(([name, total], _, arr) => ({
    name, amount: fmtMoney(total), color: CAT_COLORS[name] || C.blue, icon: CAT_ICONS_MAP[name] || "credit",
    pct: Math.round((total / arr.reduce((s, [, v]) => s + v, 0)) * 100),
  }));

  function handleDelete(id)     { onDelete(id); toast("Deleted", "warning"); }
  function handleMoveToSavings(tx) { toast(fmtMoney(Number(tx.amount)) + " moved to savings", "success"); }
  function handleFlag(tx)       { toast("Flagged for review", "warning"); }
  function handleDuplicate(tx)  { onAdd({ amount: tx.amount, description: tx.description, category_id: tx.category_id, category_name: tx.category_name, date: tx.date, type: tx.type }); toast("Transaction duplicated", "info"); }

  const monthLabel = now.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  useEffect(() => { setVisibleCount(50); }, [monthOffset]);

  return (
    <div style={{ fontFamily: FONT }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: "0 0 6px", fontSize: 26, fontWeight: 700, letterSpacing: -0.6, color: C.text, lineHeight: 1.1 }}>{t("transactions.title")}</h2>
          <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
            <button onClick={() => setMonthOffset(o => o - 1)} style={{ background: "none", border: "none", cursor: "pointer", padding: "2px 6px 2px 0", color: C.muted, fontSize: 15, lineHeight: 1, fontFamily: FONT, display: "flex", alignItems: "center" }}>‹</button>
            <span style={{ fontSize: 13, fontWeight: 600, color: C.text, minWidth: 100, textAlign: "center" }}>{monthLabel}</span>
            <button onClick={() => setMonthOffset(o => Math.min(o + 1, 0))} disabled={monthOffset === 0} style={{ background: "none", border: "none", cursor: monthOffset === 0 ? "default" : "pointer", padding: "2px 0 2px 6px", color: monthOffset === 0 ? C.faint : C.muted, fontSize: 15, lineHeight: 1, fontFamily: FONT, display: "flex", alignItems: "center", opacity: monthOffset === 0 ? 0.3 : 1 }}>›</button>
          </div>
        </div>
        <button onClick={onAdd}
          style={{ width: 46, height: 46, minWidth: 46, borderRadius: "50%", background: `linear-gradient(135deg,${C.cyan},${C.blue})`, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: `0 4px 14px rgba(47,128,255,0.32), 0 0 0 5px rgba(47,128,255,0.08)`, transition: "transform 0.16s cubic-bezier(.22,1,.36,1), box-shadow 0.16s ease" }}
          onPointerDown={e => { e.currentTarget.style.transform = "scale(0.86)"; e.currentTarget.style.boxShadow = "0 2px 8px rgba(47,128,255,0.25), 0 0 0 2px rgba(47,128,255,0.08)"; }}
          onPointerUp={e => { const el = e.currentTarget; el.style.transform = "scale(1.04)"; el.style.boxShadow = "0 4px 18px rgba(47,128,255,0.4), 0 0 0 5px rgba(47,128,255,0.09)"; setTimeout(() => { el.style.transform = ""; el.style.boxShadow = "0 4px 20px rgba(47,128,255,0.45), 0 0 0 6px rgba(47,128,255,0.11)"; }, 120); }}
          onPointerLeave={e => { e.currentTarget.style.transform = ""; e.currentTarget.style.boxShadow = "0 4px 20px rgba(47,128,255,0.45), 0 0 0 6px rgba(47,128,255,0.11)"; }}
        >
          <Icon name="plus" size={18} color="#fff" strokeWidth={2.5} />
        </button>
      </div>

      {monthOffset === -1 && (() => {
        const currentMonthLabel = new Date().toLocaleString('en-US', { month: 'long' });
        return (
          <div style={{ fontSize: 12, color: "#F59E0B", background: "#F59E0B10", border: "1px solid #F59E0B30", borderRadius: 10, padding: "8px 12px", marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>
            <span>No transactions in {currentMonthLabel} yet — showing {monthLabel}.</span>
          </div>
        );
      })()}

      <SummaryCards
        summary={summary}
        onIncomeClick={() => setSheet({ title: "Income breakdown", subtitle: `${monthLabel} · ${fmtMoney(summary.income)} total`, rows: transactions.filter(t => t.type === "income").map(t => ({ name: normalizeTxName(t), sub: fmtDate(t.date), amount: fmtMoney(Number(t.amount), true), color: "#12D18E", icon: "dollar" })), actionLabel: "Move surplus to savings", actionColor: "#12D18E", onAction: () => toast("Surplus moved to savings", "success") })}
        onExpenseClick={() => setSheet({ title: "Expenses breakdown", subtitle: `${monthLabel} · ${fmtMoney(summary.expense)} total`, rows: expenseRows, actionLabel: "Set category limit", actionColor: "#FFB800", onAction: () => toast("Category limit saved", "success") })}
        onNetClick={() => setSheet({ title: "Net summary", subtitle: monthLabel, rows: [{ name: "Total income", amount: fmtMoney(summary.income, true), color: "#12D18E", icon: "trending-up", pct: 100 }, { name: "Total expenses", amount: fmtMoney(summary.expense), color: "#FF5C7A", icon: "trending-down", pct: Math.round(summary.expense / Math.max(summary.income, 1) * 100) }, { name: "Net balance", amount: fmtMoney(summary.net, true), color: "#12D18E", icon: "award", pct: Math.round(summary.net / Math.max(summary.income, 1) * 100) }], actionLabel: "Boost savings goal", actionColor: "#12D18E", onAction: () => toast("Savings goal updated", "success") })}
      />


      {/* Top expense this month */}
      {(() => {
        const topTx = curTxs.filter(t => t.type === "expense" && t.category_name !== "Transfer").sort((a, b) => Number(b.amount) - Number(a.amount))[0];
        if (!topTx) return null;
        return (
          <div
            onClick={() => setSearch(normalizeTxName(topTx))}
            style={{ background: C.bgSecondary, border: `1px solid ${C.border}`, borderRadius: 12, padding: "10px 14px", marginBottom: 8, display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, overflow: "hidden" }}>
              <div style={{ width: 6, height: 6, borderRadius: 99, background: C.yellow, flexShrink: 0 }} />
              <span style={{ fontSize: 12, color: C.muted, flexShrink: 0 }}>{t("transactions.top_expense")}</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{normalizeTxName(topTx)}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0, paddingLeft: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: C.red }}>{fmtMoney(Number(topTx.amount))}</span>
              <span style={{ fontSize: 13, color: C.faint }}>→</span>
            </div>
          </div>
        );
      })()}

      {catFilter && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, padding: "8px 12px", background: (CAT_COLORS[catFilter] || C.cyan) + "18", borderRadius: 12, border: `1px solid ${(CAT_COLORS[catFilter] || C.cyan)}33` }}>
          <div style={{ width: 8, height: 8, borderRadius: 99, background: CAT_COLORS[catFilter] || C.cyan }} />
          <span style={{ fontSize: 13, color: CAT_COLORS[catFilter] || C.cyan, fontWeight: 600, flex: 1 }}>{tCat(catFilter, t)}</span>
          <button onClick={onClearCatFilter} style={{ background: "none", border: "none", cursor: "pointer", display: "flex", padding: 4, minHeight: 28 }}>
            <Icon name="x" size={13} color={C.muted} strokeWidth={2.5} />
          </button>
        </div>
      )}

      {/* Search bar */}
      <div style={{ position: "relative", marginBottom: 10 }}>
        <div style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}>
          <Icon name="search" size={15} color={searchFocused ? C.blue : C.muted} />
        </div>
        <input
          type="text"
          placeholder={t("transactions.search")}
          value={search}
          onChange={e => setSearch(e.target.value)}
          onFocus={() => setSearchFocused(true)}
          onBlur={() => setSearchFocused(false)}
          style={{
            width: "100%",
            padding: "10px 36px 10px 36px",
            background: searchFocused ? "#1A2840" : C.bgTertiary,
            border: `1px solid ${searchFocused ? C.blue : search ? C.blue + "55" : "rgba(255,255,255,0.18)"}`,
            borderRadius: 12,
            color: C.text,
            fontSize: 14,
            outline: "none",
            boxSizing: "border-box",
            fontFamily: FONT,
            transition: "border-color 0.2s ease, background 0.2s ease",
          }}
        />
        {search && (
          <button onClick={() => setSearch("")} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", padding: 4, display: "flex", color: C.faint }}>
            <Icon name="x" size={14} color={C.faint} strokeWidth={2.5} />
          </button>
        )}
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
        {[{ key: "all", label: t("transactions.filter_all") }, { key: "expense", label: t("transactions.filter_expense") }, { key: "income", label: t("transactions.filter_income") }].map(f => {
          const on = filter === f.key;
          return (
            <button key={f.key} onClick={() => setFilter(f.key)}
              style={{ padding: "7px 14px", borderRadius: 20, border: `1px solid ${on ? C.blue : C.border}`, background: on ? C.blue : "transparent", color: on ? "#fff" : C.muted, cursor: "pointer", fontSize: 13, fontFamily: FONT, fontWeight: on ? 600 : 400, display: "flex", alignItems: "center", gap: 5, minHeight: 38, transition: "all 0.15s ease" }}>
              {f.label}
              <span style={{ fontSize: 11, background: on ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.07)", borderRadius: 8, padding: "1px 6px", color: on ? "rgba(255,255,255,0.9)" : C.faint }}>{counts[f.key]}</span>
            </button>
          );
        })}

        {/* Category filter chip */}
        {(() => {
          const cats = [...new Set(transactions.filter(t => t.category_name && t.category_name !== 'Transfer').map(t => t.category_name))].sort();
          const active = localCatFilter;
          return (
            <div style={{ position: "relative" }}>
              {showCatDropdown && <div onClick={() => setShowCatDropdown(false)} style={{ position: "fixed", inset: 0, zIndex: 98 }} />}
              <button
                onClick={() => setShowCatDropdown(v => !v)}
                style={{ padding: "7px 12px", borderRadius: 20, border: `1px solid ${active ? C.cyan : C.border}`, background: active ? C.cyan + "22" : "transparent", color: active ? C.cyan : C.muted, cursor: "pointer", fontSize: 13, fontFamily: FONT, fontWeight: active ? 600 : 400, display: "flex", alignItems: "center", gap: 4, minHeight: 38, transition: "all 0.15s ease" }}
              >
                {active ? tCat(active, t) : t("transactions.category")} <span style={{ fontSize: 10, opacity: 0.7 }}>▾</span>
              </button>
              {showCatDropdown && (
                <div style={{ position: "absolute", top: 44, left: 0, zIndex: 99, background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: "6px 0", boxShadow: "0 8px 32px rgba(0,0,0,0.55)", minWidth: 190, maxHeight: 260, overflowY: "auto" }}>
                  {active && (
                    <button onClick={() => { setLocalCatFilter(null); setShowCatDropdown(false); }} style={{ display: "flex", width: "100%", textAlign: "left", padding: "9px 14px", background: "none", border: "none", borderBottom: `1px solid ${C.sep}`, color: C.muted, fontSize: 12, cursor: "pointer", fontFamily: FONT, alignItems: "center", gap: 8 }}>
                      <Icon name="x" size={11} color={C.muted} strokeWidth={2.5} /> {t("transactions.clear_filter")}
                    </button>
                  )}
                  {cats.map(cat => (
                    <button key={cat} onClick={() => { setLocalCatFilter(cat); setShowCatDropdown(false); }}
                      style={{ display: "flex", width: "100%", textAlign: "left", padding: "9px 14px", background: cat === active ? C.cyan + "18" : "none", border: "none", color: cat === active ? C.cyan : C.text, fontSize: 13, cursor: "pointer", fontFamily: FONT, alignItems: "center", gap: 10 }}>
                      <div style={{ width: 8, height: 8, borderRadius: 99, background: CAT_COLORS[cat] || C.blue, flexShrink: 0 }} />
                      {tCat(cat, t)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })()}
      </div>

      {filtered.length === 0 ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: "36px 20px", textAlign: "center" }}>
          <div style={{ width: 56, height: 56, background: C.bgSecondary, borderRadius: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name="credit" size={24} color={C.faint} strokeWidth={1.6} />
          </div>
          <div style={{ fontSize: 15, fontWeight: 600, color: C.text }}>{search ? t("transactions.no_results_for", { query: search }) : filter === "all" ? t("transactions.no_transactions") : filter === "expense" ? t("transactions.no_expense") : t("transactions.no_income")}</div>
          <div style={{ fontSize: 13, color: C.faint, maxWidth: 220, lineHeight: 1.55 }}>{search ? t("transactions.try_different") : filter === "all" ? t("transactions.add_first_hint") : t("transactions.nothing_this_month")}</div>
          {!search && filter === "all" && <button onClick={onAdd} style={{ background: `linear-gradient(90deg,${C.cyan},${C.blue})`, border: "none", borderRadius: 12, padding: "12px 24px", color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 13, fontFamily: FONT, minHeight: 44 }}>{t("transactions.add_first_btn")}</button>}
        </div>
      ) : (() => {
        const visible = filtered.slice(0, visibleCount);
        const hasMore = filtered.length > visibleCount;

        // Group visible transactions by date with human-friendly headers
        const todayStr     = new Date().toISOString().slice(0, 10);
        const yesterdayStr = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
        function dateLabel(dateStr) {
          if (dateStr === todayStr)     return t("transactions.today");
          if (dateStr === yesterdayStr) return t("transactions.yesterday");
          const d = parseDate(dateStr);
          return d.toLocaleDateString("en-US", { month: "long", day: "numeric" });
        }
        const groups = [];
        let lastDate = null;
        for (const t of visible) {
          const d = (t.date || "").slice(0, 10);
          if (d !== lastDate) { groups.push({ date: d, label: dateLabel(d), txs: [] }); lastDate = d; }
          groups[groups.length - 1].txs.push(t);
        }
        return (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {groups.map(group => {
              const dayNet = group.txs.filter(t => t.category_name !== 'Transfer').reduce((s, t) => s + (t.type === 'income' ? Number(t.amount) : -Number(t.amount)), 0);
              const dayNetStr = dayNet === 0 ? null : dayNet < 0 ? `-$${fmt(Math.abs(dayNet))}` : `+$${fmt(dayNet)}`;
              const dayNetColor = dayNet < 0 ? C.red : C.green;
              return (
              <div key={group.date}>
                <div style={{ padding: "10px 4px 4px", fontSize: 11, fontWeight: 700, color: C.faint, letterSpacing: 0.6, textTransform: "uppercase", position: "sticky", top: 0, background: "transparent", backdropFilter: "blur(8px)", zIndex: 2, display: "flex", alignItems: "center", gap: 6 }}>
                  <span>{group.label}</span>
                  {dayNetStr && <span style={{ color: dayNetColor, fontSize: 12, fontWeight: 500, opacity: 0.6, letterSpacing: 0, textTransform: "none" }}>{dayNetStr}</span>}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  {group.txs.map(t => <TxRow key={t.id} t={{ ...t, _incomeTotal: summary.income }} onDelete={handleDelete} onEdit={onEdit} onLongPress={tx => setQuickTx(tx)} />)}
                </div>
              </div>
              );
            })}
            {/* Sentinel — observed by IntersectionObserver to trigger next batch */}
            <div ref={sentinelRef} style={{ height: 1 }} />
            {hasMore && (
              <div style={{ textAlign: "center", padding: "12px 0", fontSize: 12, color: C.faint }}>
                {t("transactions.loading_more")}
              </div>
            )}
          </div>
        );
      })()}

      {!hintDone && filtered.length > 0 && (
        <div style={{ marginTop: 8, padding: "8px 14px", background: "rgba(255,255,255,0.03)", borderRadius: 10, border: `1px solid rgba(255,255,255,0.05)`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, animation: "hintFade 0.3s ease forwards", animationDelay: "1.2s", opacity: 1 }}>
          <style>{`@keyframes hintFade{0%{opacity:1}100%{opacity:0;visibility:hidden}}`}</style>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 11, color: C.faint }}>{t("transactions.swipe_hint")}</span>
            <span style={{ fontSize: 11, fontWeight: 500, color: C.blue }}>{t("transactions.swipe_edit")}</span>
            <span style={{ fontSize: 10, color: C.faint }}>·</span>
            <span style={{ fontSize: 11, fontWeight: 500, color: C.red }}>{t("transactions.swipe_delete")}</span>
          </div>
          <button onClick={() => setHintDone(true)} style={{ width: 22, height: 22, background: "none", border: "none", cursor: "pointer", color: C.faint, fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT, opacity: 0.5 }}>×</button>
        </div>
      )}

      {sheet && <BreakdownSheet title={sheet.title} subtitle={sheet.subtitle} rows={sheet.rows} actionLabel={sheet.actionLabel} actionColor={sheet.actionColor} onAction={sheet.onAction} onClose={() => setSheet(null)} />}
      {quickTx && <QuickActionsMenu tx={quickTx} onClose={() => setQuickTx(null)} onEdit={tx => { setQuickTx(null); onEdit(tx); }} onDelete={id => { setQuickTx(null); handleDelete(id); }} onMoveToSavings={tx => { setQuickTx(null); handleMoveToSavings(tx); }} onFlag={tx => { setQuickTx(null); handleFlag(tx); }} onDuplicate={tx => { setQuickTx(null); handleDuplicate(tx); }} />}
      {!onToast && <ToastStack toasts={toasts} dismiss={dismiss} />}
    </div>
  );
}

const INCOME_CATS = [
  { name: "Salary", icon: "dollar", color: "#00A67E" },
  { name: "Freelance", icon: "star", color: "#00C2FF" },
  { name: "Transfer", icon: "repeat", color: "#60A5FA" },
  { name: "Dividends", icon: "activity", color: "#A78BFA" },
  { name: "Debt Repaid", icon: "check-circle", color: "#34D399" },
  { name: "Gift", icon: "heart", color: "#F97316" },
  { name: "Other Income", icon: "plus", color: "#94A3B8" },
];

export function AddTransactionModal({ categories, onAdd, onClose, existing }) {
  const { t } = useTranslation();
  const [amount, setAmount] = useState(existing ? String(existing.amount) : "");
  const [desc, setDesc] = useState(existing?.description || "");
  const [catId, setCatId] = useState(existing?.category_id || "");
  const [catName, setCatName] = useState(existing?.category_name || "");
  const [type, setType] = useState(existing?.type || "expense");
  const [date, setDate] = useState(existing?.date || localDateString());
  const [showCats, setShowCats] = useState(false);
  const isEdit = !!existing;

  const noSpinStyle = `input[type=number]::-webkit-inner-spin-button,input[type=number]::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}input[type=number]{-moz-appearance:textfield}`;
  const inp = { width: "100%", padding: "13px 14px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 12, color: C.text, fontSize: 15, outline: "none", boxSizing: "border-box", fontFamily: FONT };

  function switchType(typeName) { setType(typeName); setCatId(""); setCatName(""); setShowCats(false); }

  const displayCats = type === "income"
    ? INCOME_CATS.map((c, i) => ({ id: `income-${i}`, ...c }))
    : categories;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.82)", display: "flex", alignItems: "flex-end", zIndex: 100, maxWidth: 430, margin: "0 auto" }}>
      <style>{noSpinStyle}</style>
      <div style={{ background: C.card, width: "100%", borderRadius: "24px 24px 0 0", padding: 24, border: `1px solid ${C.border}`, maxHeight: "90vh", overflowY: "auto", fontFamily: FONT }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{isEdit ? t("transactions.edit_transaction") : t("transactions.add_transaction_modal")}</h3>
          <button onClick={onClose} style={{ background: C.bgSecondary, border: `1px solid ${C.border}`, borderRadius: 99, cursor: "pointer", width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name="x" size={14} color={C.muted} strokeWidth={2.5} />
          </button>
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          {["expense", "income"].map(typeOpt => (
            <button key={typeOpt} onClick={() => switchType(typeOpt)} style={{ flex: 1, padding: 11, borderRadius: 12, border: `1px solid ${type === typeOpt ? (typeOpt === "expense" ? C.red : C.green) : C.border}`, background: type === typeOpt ? (typeOpt === "expense" ? C.red + "18" : C.green + "18") : "transparent", color: type === typeOpt ? (typeOpt === "expense" ? C.red : C.green) : C.muted, cursor: "pointer", fontWeight: 600, textTransform: "capitalize", fontFamily: FONT }}>{t("transactions." + typeOpt)}</button>
          ))}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ position: "relative" }}>
            <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: C.muted, fontSize: 16, fontWeight: 600, pointerEvents: "none" }}>$</span>
            <input type="number" placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)} style={{ ...inp, paddingLeft: 30 }} />
          </div>
          <input style={inp} placeholder={t("transactions.description_optional")} value={desc} onChange={e => setDesc(e.target.value)} />
          <div>
            <button onClick={() => setShowCats(!showCats)} style={{ ...inp, display: "flex", alignItems: "center", gap: 12, cursor: "pointer", textAlign: "left" }}>
              {catName
                ? type === "income"
                  ? <><div style={{ width: 32, height: 32, borderRadius: 10, background: INCOME_CATS.find(c => c.name === catName)?.color || C.green, display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name={INCOME_CATS.find(c => c.name === catName)?.icon || "dollar"} size={15} color="#fff" strokeWidth={2} /></div><span style={{ color: C.text }}>{catName}</span></>
                  : <><CatIcon name={catName} type={type} size={15} /><span style={{ color: C.text }}>{catName}</span></>
                : <span style={{ color: C.muted }}>{type === "income" ? t("transactions.select_income_source") : t("transactions.select_category")}</span>
              }
              <span style={{ marginLeft: "auto" }}><Icon name="chevron" size={14} color={C.faint} /></span>
            </button>
            {showCats && (
              <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 12, marginTop: 4, overflow: "hidden", maxHeight: 240, overflowY: "auto" }}>
                {displayCats.map(c => (
                  <div key={c.id || c.name} onClick={() => { setCatId(c.id || c.name); setCatName(c.name); setShowCats(false); }}
                    style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 14px", cursor: "pointer", background: catName === c.name ? C.cyan + "10" : "transparent", borderBottom: `1px solid ${C.sep}` }}>
                    {type === "income"
                      ? <div style={{ width: 34, height: 34, borderRadius: 10, background: c.color, display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <Icon name={c.icon} size={15} color="#fff" strokeWidth={2} />
                        </div>
                      : <CatIcon name={c.name} type={type} size={15} />
                    }
                    <span style={{ color: C.text, fontSize: 14, fontWeight: 500 }}>{c.name}</span>
                    {catName === c.name && <Icon name="check-circle" size={14} color={C.cyan} style={{ marginLeft: "auto" }} />}
                  </div>
                ))}
              </div>
            )}
          </div>
          <input style={inp} type="date" value={date} onChange={e => setDate(e.target.value)} />
        </div>
        <button
          onClick={() => { if (!amount) return; onAdd({ amount: parseFloat(amount), description: desc || catName, category_id: type === "expense" ? (catId || null) : null, category_name: catName, date, type }); }}
          style={{ width: "100%", marginTop: 18, padding: 15, background: `linear-gradient(90deg,${type === "expense" ? C.red : C.green},${type === "expense" ? "#CC1A3A" : "#00A67E"})`, border: "none", borderRadius: 14, color: "#fff", fontWeight: 700, fontSize: 15, cursor: "pointer", fontFamily: FONT }}>
          {isEdit ? t("transactions.save_changes") : type === "expense" ? t("transactions.add_expense") : t("transactions.add_income")}
        </button>
      </div>
    </div>
  );
}

