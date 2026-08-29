import { useState, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { supabase, SUPABASE_URL, SUPABASE_KEY } from "../utils/supabase";
import { callEdgeFunction } from "../lib/callEdgeFunction";
import { getCachedDiagnosisLesson, setCachedDiagnosisLesson } from "../utils/diagnosisLessonCache";
import { DIAGNOSIS_RECENT_MS, hasSignificantEventSince } from "../utils/diagnosisFreshness";
import { getCachedAccounts, setCachedAccounts, sumDepositoryBalance, getCreditAccounts, sumCreditDebt, creditUtilization, sumInvestmentBalance, sumAlpacaPositionsValue } from "../utils/accountsCache";
import { C, FONT, CAT_COLORS, RADIUS, DASHBOARD_C as DC } from "../utils/colors";
import { fmt, fmtDate, parseDate, fmtPct, resolveCategory, tCat, sumAmounts } from "../utils/helpers";
import Icon from "./shared/Icon";
import GlassCard from "./shared/GlassCard";
import { ConnectBankPrompt } from "./shared/ConnectBankPrompt";
import { calculateHealthScore, generateHealthComment, getScoreLabel } from "../healthScore";
import { highlightNumbers } from "./Insights";
import UpcomingChargesCard from "./UpcomingChargesCard";
import { getUpcomingCharges, getUpcomingCardPayments } from '../utils/recurringSummary';
import { getTodaysLesson, getPersonalizedLessonNote, computeNextStreak } from '../utils/lessons';
import { getCardQuestion } from '../utils/cardQuestions';
import { useLongPress } from '../hooks/useLongPress';
import { BUFFER, isTransferCategory, calculateNetWorth } from "../shared/financialConstants";
import { AccordionSection } from "./Profile";


// ─── Health Score Gauge ──────────────────────────────────────────────────────
// ─── Health Score Bar (compact, inline, expandable) ─────────────────────────
function HealthScoreBar({ score, color, comment, breakdown, hasData = true, prevScore, cashPositionLow = false }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const label = getScoreLabel(score);

  if (!hasData) {
    return (
      <div style={{ background: DC.card, borderRadius: RADIUS.md, padding: "10px 14px", fontFamily: FONT }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: DC.faint, flexShrink: 0 }} />
          <span style={{ fontSize: 12, fontWeight: 500, color: DC.muted, flexShrink: 0 }}>{t("dashboard.health_score")}</span>
          <span style={{ fontSize: 12, color: DC.faint }}>{t("dashboard.connect_bank_score")}</span>
        </div>
      </div>
    );
  }

  const rows = [
    {
      key: "savings",
      label: t("insights.savings_rate_label"),
      pts: breakdown?.savings?.points ?? 0,
      max: 30,
      detail: breakdown?.savings?.rate != null
        ? t("dashboard.pct_income_saved", { pct: Math.round(breakdown.savings.rate * 100) })
        : null,
      na: !hasData,
    },
    {
      key: "budget",
      label: t("insights.budget_adherence"),
      pts: breakdown?.budget?.points ?? 0,
      max: 25,
      detail: null,
      na: !hasData,
    },
    {
      key: "recurring",
      label: t("insights.recurring_charges"),
      pts: breakdown?.recurring?.points ?? 0,
      max: 20,
      detail: breakdown?.recurring?.ratio != null
        ? t("dashboard.pct_income", { pct: Math.round(breakdown.recurring.ratio * 100) })
        : null,
      na: !hasData,
    },
    {
      key: "trend",
      label: t("insights.balance_trend"),
      pts: breakdown?.trend?.points ?? 0,
      max: 25,
      detail: (() => {
        const d = breakdown?.trend;
        if (!d) return null;
        const delta = d.thisBalance - d.lastBalance;
        return delta >= 0
          ? t("dashboard.vs_last_month_pos", { delta: Math.round(delta) })
          : t("dashboard.vs_last_month_neg", { delta: Math.round(Math.abs(delta)) });
      })(),
      na: !hasData,
    },
  ];

  return (
    <div
      onClick={() => setOpen(o => !o)}
      style={{
        background: DC.card,
        borderRadius: RADIUS.md,
        padding: "10px 14px",
        cursor: "pointer",
        fontFamily: FONT,
        userSelect: "none",
      }}
    >
      {/* ── Collapsed row ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {/* Colored dot */}
        <div style={{
          width: 8, height: 8, borderRadius: "50%",
          background: color,
          boxShadow: `0 0 6px ${color}88`,
          flexShrink: 0,
        }} />

        {/* Label */}
        <span style={{ fontSize: 12, fontWeight: 500, color: DC.muted, flexShrink: 0 }}>
          {t("dashboard.health_score")}
        </span>

        {/* Score number */}
        <span style={{ fontSize: 14, fontWeight: 800, color, letterSpacing: -0.3, flexShrink: 0 }}>
          {score}
        </span>

        {/* MoM delta */}
        {prevScore != null && prevScore !== score && (
          <span style={{ fontSize: 11, fontWeight: 700, color: score > prevScore ? DC.emerald : DC.ruby, flexShrink: 0 }}>
            {score > prevScore ? `↑${score - prevScore}` : `↓${prevScore - score}`}
          </span>
        )}

        {/* Divider */}
        <span style={{ fontSize: 12, color: DC.faint, flexShrink: 0 }}>·</span>

        {/* Comment — truncated, muted */}
        <span style={{
          fontSize: 12, color: DC.faint,
          overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis",
          flex: 1, minWidth: 0,
        }}>
          {t(label)} — {comment.rawCat ? t(comment.key, { cat: tCat(comment.rawCat, t), ...comment.params }) : t(comment.key)}
        </span>

        {/* Chevron */}
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none"
          stroke={DC.faint} strokeWidth="2.5" strokeLinecap="round"
          style={{ flexShrink: 0, transition: "transform 0.2s", transform: open ? "rotate(180deg)" : "none" }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>

      {cashPositionLow && (
        // Icon + wording deliberately distinct from the Health Score's own
        // "budget" breakdown row directly above this — this signal is real
        // bank balance vs a $1,000 safety buffer (liquidity risk right now),
        // not a spending-vs-plan verdict, and previously read as one more
        // budget-overrun flag sitting next to the score (budget/overspending-
        // signals investigation, 2026-08-26).
        <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 4, marginLeft: 16 }}>
          <Icon name="bank" size={11} color={DC.gold} strokeWidth={2} />
          <span style={{ fontSize: 11, color: DC.gold, fontWeight: 600 }}>
            {t("health.cash_buffer_low")}
          </span>
        </div>
      )}

      {/* ── Expanded breakdown ── */}
      {open && (
        <div
          onClick={e => e.stopPropagation()}
          style={{ marginTop: 12, borderTop: `1px solid ${DC.bg}`, paddingTop: 12 }}
        >
          {rows.map(row => {
            const pct = Math.round((row.pts / row.max) * 100);
            const barColor = pct >= 75 ? DC.emerald : pct >= 40 ? DC.gold : DC.ruby;
            return (
              <div key={row.key} style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
                  <span style={{ fontSize: 11, color: DC.muted }}>{row.label}</span>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
                    {row.detail && (
                      <span style={{ fontSize: 10, color: DC.faint }}>{row.detail}</span>
                    )}
                    <span style={{ fontSize: 11, fontWeight: 700, color: barColor }}>
                      {row.pts}<span style={{ fontWeight: 400, color: DC.faint }}>/{row.max}</span>
                    </span>
                  </div>
                </div>
                <div style={{ height: 3, background: DC.bg, borderRadius: RADIUS.full }}>
                  <div style={{
                    height: 3, borderRadius: RADIUS.full,
                    width: `${pct}%`,
                    background: barColor,
                    transition: "width 0.5s ease",
                  }} />
                </div>
              </div>
            );
          })}

          {/* Total */}
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            marginTop: 8, paddingTop: 8, borderTop: `1px solid ${DC.bg}`,
          }}>
            <span style={{ fontSize: 11, color: DC.muted, fontWeight: 600 }}>{t("dashboard.total_score")}</span>
            <span style={{ fontSize: 13, fontWeight: 800, color }}>
              {score}<span style={{ fontSize: 11, fontWeight: 400, color: DC.faint }}>/100</span>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function DonutChart({ data, size = 196, onCatClick, hideAmounts = false, capCount = null, paywalled = false, onUpgrade, sideLegend = false }) {
  const { t } = useTranslation();
  // Capped to capCount by default regardless of plan (Dashboard redesign,
  // 2026-08-28 — was Pro-only unbounded via the old lockList={!isPro}
  // prop, no visual cap and no "View all" for Pro at all). paywalled
  // controls what happens to the overflow once capped: Free gets the
  // existing blur+upgrade treatment, Pro gets a plain expand-in-place.
  const [expanded, setExpanded] = useState(false);
  const cx = size / 2, cy = size / 2;
  const outerR = size / 2 - 8;
  // Thinner ring (was 22px, then 10px, still heavier than the mockup) with a
  // wide center hole for the total-spent text. innerR derives from sw
  // directly now instead of an independent duplicate literal, so they can't
  // drift apart again — shrinking sw also grows the center hole for free.
  const sw = 7;
  const innerR = outerR - sw;
  const mid = (outerR + innerR) / 2;
  const [hovered, setHovered] = useState(null);

  const entries = Object.entries(data || {}).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, v]) => s + v, 0);

  if (total <= 0) return (
    <div style={{ height: size, display: "flex", alignItems: "center", justifyContent: "center", color: DC.faint, fontSize: 13, fontFamily: FONT }}>
      {t("dashboard.no_spending_data_short")}
    </div>
  );

  function polarToCart(angle) {
    const rad = ((angle - 90) * Math.PI) / 180;
    return { x: cx + mid * Math.cos(rad), y: cy + mid * Math.sin(rad) };
  }
  function arcPath(start, end) {
    const s = polarToCart(end), e = polarToCart(start);
    const large = end - start <= 180 ? 0 : 1;
    return `M ${s.x} ${s.y} A ${mid} ${mid} 0 ${large} 0 ${e.x} ${e.y}`;
  }

  let angle = 0;
  const gap = entries.length > 1 ? 3 : 0;
  const slices = entries.map(([cat, val]) => {
    const sweep = (val / total) * 360;
    const sl = { cat, val, start: angle, end: angle + sweep, color: CAT_COLORS[cat] || "#94A3B8" };
    angle += sweep;
    return sl;
  });

  return (
    <div style={{ display: "flex", flexDirection: sideLegend ? "row" : "column", alignItems: "center", gap: sideLegend ? 20 : 16, fontFamily: FONT }}>
      <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
        <svg width={size} height={size} style={{ display: "block" }}>
          <defs>
            <radialGradient id="cg" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor={DC.gold} stopOpacity="0.10" />
              <stop offset="100%" stopColor={DC.gold} stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle cx={cx} cy={cy} r={mid} fill="none" stroke={C.bgTertiary} strokeWidth={sw} />
          {slices.map((s, i) => {
            const startAdj = s.start + (i === 0 ? 0 : gap / 2);
            const endAdj = s.end - (i === slices.length - 1 ? 0 : gap / 2);
            if (endAdj - startAdj < 0.5) return null;
            const isHov = hovered === s.cat;
            if (endAdj - startAdj >= 359.5)
              return <circle key={i} cx={cx} cy={cy} r={mid} fill="none" stroke={s.color} strokeWidth={isHov ? sw + 4 : sw} style={{ filter: isHov ? `drop-shadow(0 0 6px ${s.color}66)` : 'none', cursor: "pointer", transition: "all 0.2s" }} onClick={() => onCatClick && onCatClick(s.cat)} onMouseEnter={() => setHovered(s.cat)} onMouseLeave={() => setHovered(null)} />;
            return (
              <path key={i} d={arcPath(startAdj, endAdj)} stroke={s.color} strokeWidth={isHov ? sw + 4 : sw} fill="none" strokeLinecap="round"
                style={{ filter: isHov ? `drop-shadow(0 0 6px ${s.color}66)` : 'none', cursor: onCatClick ? "pointer" : "default", transition: "all 0.2s" }}
                onClick={() => onCatClick && onCatClick(s.cat)}
                onMouseEnter={() => setHovered(s.cat)} onMouseLeave={() => setHovered(null)} />
            );
          })}
          <circle cx={cx} cy={cy} r={outerR} fill="url(#cg)" />
        </svg>
        <div style={{ position: "absolute", left: cx - innerR, top: cy - innerR, width: innerR * 2, height: innerR * 2, borderRadius: "50%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: sideLegend ? DC.bg : C.bgDeep, pointerEvents: "none" }}>
          {hovered ? (
            <>
              <div style={{ fontSize: 10, color: DC.text, fontWeight: 600, letterSpacing: 0.5, marginBottom: 2, textAlign: "center", padding: "0 4px" }}>{tCat(hovered, t)}</div>
              <div className="ph-mask" style={{ fontSize: 17, fontWeight: 800, color: CAT_COLORS[hovered] || DC.gold }}>{hideAmounts ? "••••" : `$${fmt((data[hovered] || 0), 0)}`}</div>
              <div style={{ fontSize: 11, color: DC.text, fontWeight: 600 }}>{Math.round(((data[hovered] || 0) / total) * 100)}%</div>
            </>
          ) : (
            <>
             <div className="ph-mask" style={{ fontSize: 20, fontWeight: 800, color: DC.text, letterSpacing: -0.5, marginBottom: 2 }}>{hideAmounts ? "••••" : `$${fmt(total, 0)}`}</div>
           <div style={{ fontSize: 10, color: DC.muted, letterSpacing: 0.5, fontWeight: 600 }}>{t("dashboard.total_spent")}</div>
            </>
          )}
        </div>
      </div>

      {(() => {
        // Free users see the top capCount categories in full (real value,
        // no teaser blur on the visible list) — only categories beyond
        // that are locked behind blur+upgrade. Pro users get the same
        // visual cap for scannability, but the overflow is a plain "View
        // all" expand, not a paywall. Once expanded (Pro only — Free's
        // hidden rows stay behind onUpgrade, never locally expandable),
        // capCount stops applying for the rest of this render. If there
        // are capCount or fewer categories total, there's nothing to cap —
        // show them all plainly regardless of plan.
        const lockedCount = capCount != null && !expanded ? Math.max(0, slices.length - capCount) : 0;
        const visibleSlices = lockedCount > 0 ? slices.slice(0, capCount) : slices;
        const hiddenSlices  = lockedCount > 0 ? slices.slice(capCount) : [];

        const row = (s, i) => (
          <div key={s.cat}
            onClick={() => onCatClick && onCatClick(s.cat)}
            style={sideLegend
              ? { display: "flex", alignItems: "center", gap: 8, cursor: onCatClick ? "pointer" : "default", padding: "3px 0" }
              : { display: "flex", alignItems: "center", gap: 10, cursor: onCatClick ? "pointer" : "default", padding: "6px 10px", borderRadius: RADIUS.sm, background: hovered === s.cat ? s.color + "18" : C.bgTertiary, border: `1px solid ${hovered === s.cat ? s.color + "44" : "transparent"}`, transition: "all 0.15s" }}
            onMouseEnter={() => setHovered(s.cat)} onMouseLeave={() => setHovered(null)}>
            <div style={{ width: 8, height: 8, borderRadius: RADIUS.full, background: s.color, flexShrink: 0, boxShadow: `0 0 6px ${s.color}88` }} />
            <span style={{ fontSize: 13, color: i === 0 ? DC.text : DC.muted, fontWeight: i === 0 ? 600 : 400, flex: 1 }}>{tCat(s.cat, t)}</span>
            <span className="ph-mask" style={{ fontSize: 13, fontWeight: 700, color: DC.text }}>{hideAmounts ? "••••" : `$${fmt(s.val, 0)}`}</span>
            {!sideLegend && <span style={{ fontSize: 11, color: s.color, fontWeight: i === 0 ? 700 : 500, minWidth: 36, textAlign: "right" }}>{Math.round((s.val / total) * 100)}%</span>}
            {!sideLegend && onCatClick && <Icon name="chevron" size={12} color={C.faint} />}
          </div>
        );

        return (
          <div style={{ display: "flex", flexDirection: "column", gap: sideLegend ? 8 : 6, flex: sideLegend ? 1 : "unset", minWidth: 0 }}>
            {visibleSlices.map(row)}
            {hiddenSlices.length > 0 && (
              paywalled ? (
                <div style={{ position: "relative" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, filter: "blur(3px)", userSelect: "none", pointerEvents: "none" }}>
                    {hiddenSlices.map(row)}
                  </div>
                  <div onClick={onUpgrade} style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: DC.muted, background: DC.card, padding: "5px 14px", borderRadius: RADIUS.lg, border: `1px solid ${DC.faint}33` }}>
                      {t("dashboard.unlock_more_categories", { count: lockedCount })}
                    </span>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setExpanded(true)}
                  style={{ display: "block", background: "none", border: "none", padding: "2px 0 0", margin: 0, cursor: "pointer", fontFamily: FONT, fontSize: 12, fontWeight: 600, color: DC.gold, textAlign: sideLegend ? "left" : "center" }}
                >
                  {t("dashboard.view_all_categories")} →
                </button>
              )
            )}
          </div>
        );
      })()}
    </div>
  );
}

// ─── Cash Flow Forecast ──────────────────────────────────────
function Sparkline({ transactions, width = 62, height = 30 }) {
  const points = useMemo(() => {
    const now = new Date();
    const days = {};
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now); d.setDate(d.getDate() - i);
      days[d.toISOString().slice(0, 10)] = 0;
    }
    transactions.forEach(t => {
      const key = (t.date || '').slice(0, 10);
      if (!(key in days)) return;
      const amt = Number(t.amount);
      if (t.type === 'income') days[key] += amt;
      else if (t.type === 'expense' && !isTransferCategory(t)) days[key] -= amt;
    });
    let run = 0;
    return Object.keys(days).sort().map(k => { run += days[k]; return run; });
  }, [transactions]);
  if (points.length < 2) return null;
  const min = Math.min(...points), max = Math.max(...points);
  const range = max - min || 1;
  const pad = 3;
  const pts = points.map((v, i) => {
    const x = ((i / (points.length - 1)) * width).toFixed(1);
    const y = (height - pad - ((v - min) / range) * (height - pad * 2)).toFixed(1);
    return `${x},${y}`;
  }).join(' ');
  const up = points[points.length - 1] >= points[0];
  return (
    <svg width={width} height={height} style={{ display: 'block', flexShrink: 0, opacity: 0.9 }}>
      <polyline points={pts} fill="none" stroke={up ? DC.emerald : DC.ruby} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
function formatDateStr(d) {
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Projects account balance forward to targetDate: currentBalance + expected
// income - upcoming bills (recurring + scheduled one-off) - estimated
// remaining daily spend, all scoped to "referenceDate through targetDate".
// Single source for "what's left by date X" — used by both Cash Flow
// Forecast (targetDate = end of month) and the planned-payment form's live
// preview (targetDate = the payment's due date), so the two can't quietly
// diverge the way independently-reimplemented financial formulas have
// before in this project. Returns null if accountBalance isn't loaded yet.
function projectBalanceAt(transactions, accountBalance, targetDate, aliasMap, scheduledPayments = [], referenceDate = new Date()) {
  if (accountBalance == null) return null;

  const todayStart = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate());
  const daysUntil = Math.max(0, Math.round((targetDate - todayStart) / MS_PER_DAY));
  const curKey = `${referenceDate.getFullYear()}-${referenceDate.getMonth()}`;

  const isThisMonth = tx => {
    const d = new Date(tx.date + 'T00:00:00');
    return d.getMonth() === referenceDate.getMonth() && d.getFullYear() === referenceDate.getFullYear();
  };

  // ── 3-month avg daily spend (previous full months, not current) ──────────
  const avg3mDailySpend = (() => {
    const byMonth = {};
    for (const t of transactions) {
      if (t.type !== 'expense') continue;
      const d = new Date(t.date + 'T00:00:00');
      const k = `${d.getFullYear()}-${d.getMonth()}`;
      if (k === curKey) continue;
      byMonth[k] = (byMonth[k] || 0) + Math.abs(Number(t.amount));
    }
    const vals = Object.values(byMonth).slice(-3);
    if (!vals.length) {
      // No history — fall back to this month's daily rate
      const spent = transactions
        .filter(t => t.type === 'expense' && isThisMonth(t))
        .reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
      return spent / Math.max(referenceDate.getDate(), 1);
    }
    return vals.reduce((s, v) => s + v, 0) / vals.length / 30;
  })();

  // ── 3-month avg monthly income (previous full months, not current) ────────
  const avg3mIncome = (() => {
    const byMonth = {};
    for (const t of transactions) {
      if (t.type !== 'income') continue;
      const d = new Date(t.date + 'T00:00:00');
      const k = `${d.getFullYear()}-${d.getMonth()}`;
      if (k === curKey) continue;
      byMonth[k] = (byMonth[k] || 0) + Math.abs(Number(t.amount));
    }
    const vals = Object.values(byMonth).slice(-3);
    if (!vals.length) {
      return transactions
        .filter(t => t.type === 'income' && isThisMonth(t))
        .reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
    }
    return vals.reduce((s, v) => s + v, 0) / vals.length;
  })();

  // ── Formula ───────────────────────────────────────────────────────────────
  // projected = currentBalance + expectedIncome - upcomingBills - estimatedRemainingSpend
  const targetDateStr = formatDateStr(targetDate);
  const bills = [
    ...getUpcomingCharges(transactions, aliasMap, referenceDate, { maxDays: daysUntil, maxResults: Infinity }),
    ...getUpcomingCardPayments(transactions, aliasMap, referenceDate, { maxDays: daysUntil, maxResults: Infinity }),
  ];
  const billsTotal      = bills.reduce((s, c) => s + Number(c.amount), 0);
  const scheduledTotal  = scheduledPayments
    .filter(p => p.status === 'pending' && p.due_date <= targetDateStr)
    .reduce((s, p) => s + Number(p.amount), 0);
  const upcomingTotal           = billsTotal + scheduledTotal;
  const expectedIncome          = avg3mIncome * (daysUntil / 30);
  const estimatedRemainingSpend = avg3mDailySpend * daysUntil;
  const projectedRaw            = accountBalance + expectedIncome - upcomingTotal - estimatedRemainingSpend;

  return { projectedRaw, avg3mDailySpend, avg3mIncome, upcomingTotal, expectedIncome, estimatedRemainingSpend, daysUntil };
}

function CashFlowForecast({ accountBalance, transactions, balanceVisible, merchantAliasMap, scheduledPayments, bankConnected, onNavigate }) {
  const { t } = useTranslation();
  const today       = new Date();
  const dayOfMonth  = today.getDate();
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const remainingDays = daysInMonth - dayOfMonth;

  // Need at least 2 days of data for a meaningful rate
  if (dayOfMonth < 2 || transactions.length === 0) return null;

  // No bank connected — accountBalance will never populate, so the loading
  // skeleton below would render forever. Distinct from "still fetching"
  // (bankConnected true, accountBalance not yet loaded), which keeps the
  // skeleton since that resolves on its own.
  if (!bankConnected) {
    return <ConnectBankPrompt title={t('dashboard.cash_flow_forecast')} message={t('dashboard.connect_bank_forecast')} onNavigate={onNavigate} />;
  }

  // Wait for Plaid balance — fallback computed balance causes a visible flicker
  if (accountBalance === null) {
    return (
      <div style={{ background: `linear-gradient(145deg,${C.cardBgStart},${C.bg})`, borderRadius: RADIUS.lg, padding: '16px 18px', border: `1px solid ${C.border}` }}>
        <div style={{ fontSize: 10, color: C.muted, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 12 }}>{t('dashboard.cash_flow_forecast')}</div>
        <div style={{ height: 36, borderRadius: RADIUS.xs, background: C.bgTertiary, marginBottom: 10, width: '55%' }} />
        <div style={{ height: 8, borderRadius: RADIUS.full, background: C.bgTertiary, marginBottom: 14 }} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 0 }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{ paddingLeft: i > 0 ? 12 : 0, borderLeft: i > 0 ? `1px solid ${C.sep}` : 'none' }}>
              <div style={{ height: 8, borderRadius: RADIUS.xs, background: C.bgTertiary, marginBottom: 6, width: '60%' }} />
              <div style={{ height: 12, borderRadius: RADIUS.xs, background: C.bgTertiary, width: '80%' }} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const startBalance = accountBalance;
  const endOfMonthDate = new Date(today.getFullYear(), today.getMonth(), daysInMonth);
  const { projectedRaw, avg3mDailySpend, upcomingTotal } =
    projectBalanceAt(transactions, accountBalance, endOfMonthDate, merchantAliasMap, scheduledPayments, today);
  const projectedBalance        = Math.max(0, projectedRaw);

  if (avg3mDailySpend < 0.01 && upcomingTotal === 0) return null;

  const status = projectedRaw <= 0
    ? 'deficit'
    : startBalance > 0 && projectedRaw / startBalance < 0.12
    ? 'at_risk'
    : 'on_track';

  const S = {
    on_track: { label: t('dashboard.on_track'), color: C.green,  bg: C.green  + '15', border: C.green  + '38' },
    at_risk:  { label: t('dashboard.at_risk'),  color: C.yellow, bg: C.yellow + '12', border: C.yellow + '30' },
    deficit:  { label: t('dashboard.deficit'),  color: C.red,    bg: C.red    + '12', border: C.red    + '30' },
  }[status];

  const barPct = startBalance > 0
    ? Math.max(Math.min(projectedBalance / startBalance * 100, 100), 0)
    : 0;

  const endOfMonth = new Date(today.getFullYear(), today.getMonth(), daysInMonth)
    .toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  const mask  = n => balanceVisible ? (n < 0 ? `-$${fmt(Math.abs(n), 0)}` : `$${fmt(n, 0)}`) : '••••';

  return (
    <div style={{ background: `linear-gradient(145deg,${C.cardBgStart},${C.bg})`, borderRadius: RADIUS.lg, padding: '16px 18px', border: `1px solid ${S.border}`, position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: -24, right: -24, width: 90, height: 90, borderRadius: '50%', background: S.color + '09', pointerEvents: 'none' }} />

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontSize: 10, color: C.muted, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase' }}>{t('dashboard.cash_flow_forecast')}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, background: S.bg, border: `1px solid ${S.border}`, borderRadius: RADIUS.full, padding: '3px 9px' }}>
          <div style={{ width: 6, height: 6, borderRadius: RADIUS.full, background: S.color }} />
          <span style={{ fontSize: 11, fontWeight: 700, color: S.color, letterSpacing: 0.2 }}>{S.label}</span>
        </div>
      </div>

      {/* Projected balance */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 9, color: C.faint, fontWeight: 600, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 4 }}>
          {t('dashboard.projected_end_of_month', 'Projected end of month')}
        </div>
        <div className="ph-mask" style={{ fontSize: 34, fontWeight: 800, letterSpacing: -1, color: balanceVisible ? S.color : C.text, lineHeight: 1.1, textShadow: balanceVisible ? `0 0 20px ${S.color}30` : 'none' }}>
          {mask(projectedBalance)}
        </div>
        <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>
          {t('dashboard.projected_by_prefix')} <strong style={{ color: C.text }}>{endOfMonth}</strong>
          <span style={{ color: C.faint }}> · {t('dashboard.days_left', { count: remainingDays })}</span>
        </div>
      </div>

      {/* Burn-down bar */}
      <div style={{ height: 8, borderRadius: RADIUS.full, background: C.bgTertiary, overflow: 'hidden', marginBottom: 14 }}>
        <div style={{ height: '100%', width: `${barPct}%`, background: `linear-gradient(90deg,${S.color},${S.color}BB)`, borderRadius: RADIUS.full, transition: 'width 0.6s', boxShadow: barPct > 0 ? `0 0 8px ${S.color}40` : 'none' }} />
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 0 }}>
        {[
          { label: t('dashboard.balance_now'),    value: mask(startBalance),          color: C.text  },
          { label: t('dashboard.daily_avg'),      value: balanceVisible ? `$${fmt(avg3mDailySpend, 0)}${t('dashboard.per_day')}` : '••••', color: C.muted },
          { label: t('dashboard.upcoming_bills'), value: upcomingTotal > 0 ? mask(upcomingTotal) : '—', color: upcomingTotal > 0 ? C.yellow : C.faint },
        ].map((item, i) => (
          <div key={item.label} style={{ paddingLeft: i > 0 ? 12 : 0, borderLeft: i > 0 ? `1px solid ${C.sep}` : 'none', marginLeft: i > 0 ? 0 : 0 }}>
            <div style={{ fontSize: 9, color: C.faint, fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 3 }}>{item.label}</div>
            <div className="ph-mask" style={{ fontSize: 12, fontWeight: 700, color: item.color }}>{item.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Groups this month's expenses by day, keeping the full per-category
// breakdown — { [dayOfMonth]: { [category]: amount } }. Single source for
// both the grid's dominant-category coloring and the day-detail sheet's
// full breakdown, so they can't drift apart.
function groupExpensesByDay(transactions, year, month) {
  const byDay = {};
  transactions
    .filter(t => t.type === "expense" && !isTransferCategory(t))
    .forEach(t => {
      const d = parseDate(t.date);
      if (d.getFullYear() !== year || d.getMonth() !== month) return;
      const day = d.getDate();
      const cat = t.category_name || "Other";
      byDay[day] ??= {};
      byDay[day][cat] = (byDay[day][cat] || 0) + Number(t.amount);
    });
  return byDay;
}

// Signed net (income - expense) per day — separate from groupExpensesByDay,
// which is expense-only (drives the Level 2 day-detail category breakdown
// list, not cell color anymore). Now shares the same isTransferCategory
// exclusion as groupExpensesByDay (both forms) — was singular-"Transfer"-
// only here, tracked as tech debt in BACKLOG.md until the budget/
// overspending-signals investigation's Step 2 (2026-08-27) unified it.
function getDailyNet(transactions, year, month) {
  const net = {};
  transactions.forEach(t => {
    if (isTransferCategory(t)) return;
    const d = parseDate(t.date);
    if (d.getFullYear() !== year || d.getMonth() !== month) return;
    const day = d.getDate();
    const amt = Number(t.amount);
    net[day] = (net[day] || 0) + (t.type === "income" ? amt : -amt);
  });
  return net;
}

// Whole-thousands abbreviation past $1000 — a decimal ("$2.2k") barely saves
// width over the plain number ("$2211"), but dropping to whole "k" does
// ("$2k") and that's what the grid cell actually needs room for.
function fmtDayAmount(n) {
  const sign = n < 0 ? "-" : "+";
  const abs = Math.abs(n);
  if (abs >= 1000) return sign + "$" + Math.round(abs / 1000) + "k";
  return sign + "$" + Math.round(abs);
}

// For each remaining day of the current month, finds the dominant (largest
// amount) predicted charge — reuses the same getUpcomingCharges/
// getUpcomingCardPayments the carousel and Cash Flow Forecast already use,
// so the calendar can never disagree with them about what's coming up.
// scheduledPayments (user-added one-off future payments) are merged in as
// the same shape — a day with both a recurring charge and a scheduled
// payment shows whichever is larger, same tie-break as recurring vs card.
function getUpcomingChargesByDay(transactions, aliasMap, referenceDate, scheduledPayments = []) {
  const daysInMonth = new Date(referenceDate.getFullYear(), referenceDate.getMonth() + 1, 0).getDate();
  const remainingDays = daysInMonth - referenceDate.getDate();
  const all = [
    ...getUpcomingCharges(transactions, aliasMap, referenceDate, { maxDays: remainingDays, maxResults: Infinity }),
    ...getUpcomingCardPayments(transactions, aliasMap, referenceDate, { maxDays: remainingDays, maxResults: Infinity }),
    ...scheduledPayments
      .filter(p => p.status === "pending")
      // scheduledPaymentId marks this item as user-cancelable (recurring/card
      // projections have no id — nothing to cancel, they're derived, not stored)
      .map(p => ({ merchant: p.description, amount: Number(p.amount), expectedDate: p.due_date, category: p.category_name, scheduledPaymentId: p.id })),
  ];

  // The interval-based projection can occasionally overshoot into next
  // month by a day or two (e.g. a ~30-day cycle landing on Aug 1 when only
  // 30 days remained in July) — guard against that day number colliding
  // with a still-future day in the CURRENT month being rendered.
  const monthPrefix = `${referenceDate.getFullYear()}-${String(referenceDate.getMonth() + 1).padStart(2, "0")}`;
  const byDay = {};
  all.forEach(c => {
    if (!c.expectedDate.startsWith(monthPrefix)) return;
    const day = Number(c.expectedDate.slice(8, 10));
    byDay[day] ??= [];
    byDay[day].push(c);
  });

  const result = {};
  for (const [day, items] of Object.entries(byDay)) {
    const dominant = items.slice().sort((a, b) => b.amount - a.amount)[0];
    result[day] = dominant;
  }
  return result;
}

// Finds the single day (if any), within the rest of the current month,
// where the most upcoming bills land together — reuses the same
// recurring/card/scheduled-payment sources as getUpcomingChargesByDay
// above so this can never disagree with what the calendar grid itself
// would show for that day. Returns null when no day has 2+ bills
// clustering together (the common case — this is meant to be a rare
// flag, not a permanent fixture). Dashboard redesign, 2026-08-28 —
// replaces the old inline "Three bills land on the 9th" text that used
// to live inside the calendar card itself (removed at some point before
// this pass, per the numbering gap between items 5 and 7).
function getBillClusterAlert(transactions, aliasMap, referenceDate, scheduledPayments = []) {
  const daysInMonth = new Date(referenceDate.getFullYear(), referenceDate.getMonth() + 1, 0).getDate();
  const remainingDays = daysInMonth - referenceDate.getDate();
  const all = [
    ...getUpcomingCharges(transactions, aliasMap, referenceDate, { maxDays: remainingDays, maxResults: Infinity }),
    ...getUpcomingCardPayments(transactions, aliasMap, referenceDate, { maxDays: remainingDays, maxResults: Infinity }),
    ...scheduledPayments
      .filter(p => p.status === "pending")
      .map(p => ({ amount: Number(p.amount), expectedDate: p.due_date })),
  ];

  const monthPrefix = `${referenceDate.getFullYear()}-${String(referenceDate.getMonth() + 1).padStart(2, "0")}`;
  const byDay = {};
  all.forEach(c => {
    if (!c.expectedDate.startsWith(monthPrefix)) return;
    const day = Number(c.expectedDate.slice(8, 10));
    byDay[day] ??= { count: 0, total: 0 };
    byDay[day].count += 1;
    byDay[day].total += Number(c.amount);
  });

  let best = null;
  for (const [day, v] of Object.entries(byDay)) {
    if (v.count < 2) continue;
    if (!best || v.count > best.count || (v.count === best.count && v.total > best.total)) {
      best = { day: Number(day), count: v.count, total: v.total };
    }
  }
  return best;
}

const WEEKDAY_KEYS = ["weekday_mon", "weekday_tue", "weekday_wed", "weekday_thu", "weekday_fri", "weekday_sat", "weekday_sun"];

// Small day cell shared by the grid (level 1) and the day-detail strip
// (level 2) — same neutral net-color/red-ring rules as the full grid and
// compact week, different size and click behavior. emphasized (cyan ring)
// is this strip's own selection state, orthogonal to the money coloring —
// not part of the DASHBOARD_C consistency pass, left as-is.
function CalendarDayCell({ day, isToday, textColor, hasFutureCharge, size, emphasized, onClick, tooltip }) {
  return (
    <div
      onClick={onClick}
      style={{
        width: size, height: size, borderRadius: RADIUS.sm, flexShrink: 0,
        background: isToday ? DC.text : "transparent",
        border: isToday ? "none" : emphasized ? `2px solid ${C.cyan}` : hasFutureCharge ? `1.5px solid ${DC.ruby}` : `1px solid ${DC.faint}22`,
        display: "flex", alignItems: "center", justifyContent: "center",
        cursor: "pointer", position: "relative",
      }}
    >
      <span style={{ fontSize: 12, fontWeight: isToday || emphasized ? 700 : 500, color: isToday ? DC.bg : textColor }}>{day}</span>
      {tooltip}
    </div>
  );
}

// ─── Month Calendar — replaces Recent Transactions ─────────────────────────
// Level 1: classic grid (7 cols × N rows, Monday-first), same neutral system
// as the compact week above it: no per-category fill, digit color = that
// day's net sign (ruby/emerald), red ring = a known upcoming charge. Tapping
// any day selects it (no navigation) and opens level 2.
// Level 2: a bottom sheet (same interaction pattern as the "Other" spending
// breakdown sheet below) showing the selected day ± 2 neighbors as a small
// strip (same neutral cell system as level 1), plus the full category
// breakdown for the selected day. Tapping a
// past/today day in the strip navigates to Transactions filtered by that
// date; tapping a future day shows a tooltip — same rules as before, just
// scoped to the strip instead of the whole grid.
function MonthCalendar({ transactions, merchantAliasMap, onDayClick, onDayCategoryClick, scheduledPayments = [], onAddScheduledPayment, onCancelScheduledPayment, accountBalance, bankConnected, onNavigate, compactWeek = false }) {
  const { t } = useTranslation();
  const [selectedDay, setSelectedDay] = useState(null);
  const [tooltipDay, setTooltipDay] = useState(null);
  const [showAddPayment, setShowAddPayment] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const todayDate = now.getDate();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  // JS getDay() is Sunday-first (0-6) — convert to Monday-first (0=Mon..6=Sun)
  const leadingBlanks = (new Date(year, month, 1).getDay() + 6) % 7;

  const dayBreakdown = useMemo(() => groupExpensesByDay(transactions, year, month), [transactions, year, month]);
  const dailyNet = useMemo(() => getDailyNet(transactions, year, month), [transactions, year, month]);
  const futureByDay = useMemo(() => getUpcomingChargesByDay(transactions, merchantAliasMap, now, scheduledPayments), [transactions, merchantAliasMap, scheduledPayments]);

  if (!bankConnected) {
    return <ConnectBankPrompt title={t("dashboard.month_calendar_title")} message={t("dashboard.connect_bank_calendar")} onNavigate={onNavigate} />;
  }

  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  // Compact mode: just the current Mon-Sun week, clamped to this month (a
  // week straddling a month boundary shows fewer than 7 cells at the edge —
  // futureByDay is scoped to this month only, so cross-month days have no
  // data to show anyway). "View full month" below reveals the full grid
  // unchanged — this never replaces or loses that functionality.
  const todayDow = (now.getDay() + 6) % 7; // Monday-first
  const weekStart = Math.max(1, todayDate - todayDow);
  const weekEnd = Math.min(daysInMonth, todayDate - todayDow + 6);
  const weekDays = Array.from({ length: weekEnd - weekStart + 1 }, (_, i) => weekStart + i);
  const showCompact = compactWeek && !expanded;
  const visibleDays = showCompact ? weekDays : days;
  const visibleLeadingBlanks = showCompact ? 0 : leadingBlanks;

  // Second line under the day number. Past/today: honest signed net
  // (income - expense) — red/green because it's a real fact about that day.
  // Future: the single dominant predicted charge, always shown as an
  // outflow — deliberately NEUTRAL color (not red), because unlike the past
  // day's net this isn't "how the day nets out", just "a payment is
  // expected" — same red on both would make one color carry two different
  // meanings depending on where in the grid you're looking. White (not
  // blue) for the neutral case — blue read too close in tone to the
  // future-day backgrounds themselves even with the text-shadow; white
  // also doubles down on the future scale already being a distinct visual
  // language from past days, rather than blurring into it.
  function dayAmountInfo(day) {
    const isToday = day === todayDate;
    const isPast = day < todayDate;
    if (isPast || isToday) {
      const net = dailyNet[day];
      if (net == null) return null;
      return { text: fmtDayAmount(net), color: net < 0 ? DC.ruby : DC.emerald };
    }
    const info = futureByDay[day];
    if (!info) return null;
    return { text: fmtDayAmount(-info.amount), color: DC.muted };
  }

  function dateStr(day) {
    const pad = n => String(n).padStart(2, "0");
    return `${year}-${pad(month + 1)}-${pad(day)}`;
  }
  function goToDate(day) {
    onDayClick?.(dateStr(day));
  }
  function goToDateCategory(day, category) {
    onDayCategoryClick?.(dateStr(day), category);
  }

  const neighborStart = selectedDay ? Math.max(1, selectedDay - 2) : 1;
  const neighborEnd = selectedDay ? Math.min(daysInMonth, selectedDay + 2) : 1;
  const neighborDays = selectedDay ? Array.from({ length: neighborEnd - neighborStart + 1 }, (_, i) => neighborStart + i) : [];

  const selectedIsFuture = selectedDay && selectedDay > todayDate;
  const selectedCatEntries = selectedDay && !selectedIsFuture
    ? Object.entries(dayBreakdown[selectedDay] || {}).sort((a, b) => b[1] - a[1])
    : [];
  const selectedFutureInfo = selectedDay ? futureByDay[selectedDay] : null;

  return (
    <GlassCard style={compactWeek ? { padding: "14px 16px", background: DC.card, border: "none" } : { padding: "14px 16px" }}>
      {/* "This Month" label stripped for the Dashboard's compact-week usage
          (Dashboard redesign, 2026-08-28) — the bill-clustering alert now
          lives as its own separate compact line above this card, so the
          grid itself only needs to be the grid + "View full month" link.
          compactWeek is Dashboard's only current caller, so this
          effectively always hides it there; kept conditional rather than
          deleted in case a future non-compact caller wants the title
          back. */}
      {!compactWeek && (
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 10, color: C.text }}>{t("dashboard.month_calendar_title")}</div>
      )}
      <div style={showCompact ? { display: "flex", justifyContent: "space-between", marginBottom: 6 } : { display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, marginBottom: 6 }}>
        {WEEKDAY_KEYS.map(key => (
          <div key={key} style={showCompact ? { width: 30, textAlign: "center", fontSize: 10, color: DC.muted, fontWeight: 600 } : { textAlign: "center", fontSize: 10, color: C.muted, fontWeight: 600 }}>{t(`dashboard.${key}`)}</div>
        ))}
      </div>
      {showCompact ? (
        // Compact week — separate, deliberately minimal rendering from the
        // full grid below: no per-category fill, no amount line. Past days:
        // plain number, colored by that day's net (ruby=spent more, emerald=
        // earned more). Future days with a known upcoming charge: red ring,
        // not a fill — "something is due here," independent of size. Today
        // keeps the existing white-fill treatment, unchanged.
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          {weekDays.map(day => {
            const isToday = day === todayDate;
            const isPast = day < todayDate;
            const net = (isPast || isToday) ? dailyNet[day] : null;
            const hasFutureCharge = !isPast && !isToday && !!futureByDay[day];
            const textColor = isToday ? DC.bg : net == null ? DC.muted : net < 0 ? DC.ruby : net > 0 ? DC.emerald : DC.muted;
            return (
              <div
                key={day}
                onClick={() => setSelectedDay(day)}
                style={{
                  width: 30, height: 30, borderRadius: "50%",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: isToday ? DC.text : "transparent",
                  border: hasFutureCharge ? `1.5px solid ${DC.ruby}` : "none",
                  cursor: "pointer",
                }}
              >
                <span style={{ fontSize: 13, fontWeight: 600, color: textColor }}>{day}</span>
              </div>
            );
          })}
        </div>
      ) : (
      // Full grid — same neutral system as the compact week above (and the
      // Level 2 neighbor strip below, via CalendarDayCell), just with room
      // for the amount line underneath (compact only fits the digit). No
      // per-category fill anymore (that was dayColorAlpha/CAT_COLORS,
      // removed): digit color = that day's net sign, red ring = a known
      // upcoming charge, today = solid fill like the compact week's circle.
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
        {Array.from({ length: visibleLeadingBlanks }, (_, i) => <div key={`blank-${i}`} />)}
        {visibleDays.map(day => {
          const isToday = day === todayDate;
          const isPast = day < todayDate;
          const net = (isPast || isToday) ? dailyNet[day] : null;
          const hasFutureCharge = !isPast && !isToday && !!futureByDay[day];
          const textColor = isToday ? DC.bg : net == null ? DC.muted : net < 0 ? DC.ruby : net > 0 ? DC.emerald : DC.muted;
          const amountInfo = dayAmountInfo(day);
          return (
            <div key={day} style={{ aspectRatio: "1" }}>
              <div
                onClick={() => setSelectedDay(day)}
                style={{
                  width: "100%", height: "100%", borderRadius: RADIUS.sm,
                  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                  background: isToday ? DC.text : "transparent",
                  border: isToday ? "none" : hasFutureCharge ? `1.5px solid ${DC.ruby}` : `1px solid ${DC.faint}22`,
                  cursor: "pointer",
                }}
              >
                <span style={{ fontSize: 12, fontWeight: isToday ? 700 : 500, color: textColor, lineHeight: 1.1 }}>{day}</span>
                {amountInfo && (
                  <span style={{ fontSize: 8.5, fontWeight: 700, color: amountInfo.color, lineHeight: 1.1, marginTop: 3, whiteSpace: "nowrap" }}>{amountInfo.text}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      )}

      {compactWeek && (
        <button onClick={() => setExpanded(v => !v)} style={{ display: "block", background: "none", border: "none", padding: 0, marginTop: 10, cursor: "pointer", fontFamily: FONT, fontSize: 12, fontWeight: 600, color: DC.gold }}>
          {expanded ? t("dashboard.show_less") : t("dashboard.view_full_month")}
        </button>
      )}

      {selectedDay && (
        <div onClick={() => { setSelectedDay(null); setTooltipDay(null); }} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 180, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
          <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 430, background: C.card, borderRadius: "20px 20px 0 0", border: `1px solid ${C.border}`, padding: "0 0 32px", maxHeight: "75vh", display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "14px 0 0", display: "flex", justifyContent: "center" }}>
              <div style={{ width: 36, height: 4, borderRadius: RADIUS.full, background: "rgba(255,255,255,0.12)" }} />
            </div>
            <div style={{ padding: "12px 20px 10px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: `1px solid ${C.sep}`, flexShrink: 0 }}>
              <div>
                <div
                  onClick={() => { if (!selectedIsFuture) goToDate(selectedDay); }}
                  style={{ fontSize: 16, fontWeight: 700, color: C.text, cursor: selectedIsFuture ? "default" : "pointer" }}
                >
                  {new Date(year, month, selectedDay).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}
                </div>
                {!selectedIsFuture && (
                  <button onClick={() => goToDate(selectedDay)} style={{ background: "none", border: "none", padding: 0, marginTop: 2, cursor: "pointer", color: C.cyan, fontSize: 12, fontWeight: 600, fontFamily: FONT }}>
                    {t("dashboard.view_all_day_transactions")}
                  </button>
                )}
              </div>
              <button onClick={() => { setSelectedDay(null); setTooltipDay(null); }} aria-label={t("dashboard.close")} style={{ background: C.bgTertiary, border: `1px solid ${C.border}`, borderRadius: RADIUS.xs, width: 44, height: 44, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke={C.muted} strokeWidth={2.5} strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

            <div style={{ overflowY: "auto", padding: "16px 20px 0" }}>
              <div style={{ display: "flex", justifyContent: "center", gap: 8, marginBottom: 16 }}>
                {neighborDays.map(day => {
                  const isToday = day === todayDate;
                  const isPast = day < todayDate;
                  const isFuture = !isPast && !isToday;
                  const net = (isPast || isToday) ? dailyNet[day] : null;
                  const hasFutureCharge = isFuture && !!futureByDay[day];
                  const textColor = net == null ? DC.muted : net < 0 ? DC.ruby : net > 0 ? DC.emerald : DC.muted;
                  return (
                    <div key={day} style={{ position: "relative" }}>
                      <CalendarDayCell
                        day={day} isToday={isToday} textColor={textColor} hasFutureCharge={hasFutureCharge}
                        size={day === selectedDay ? 52 : 40}
                        emphasized={day === selectedDay}
                        onClick={() => {
                          if (isFuture) setTooltipDay(tooltipDay === day ? null : day);
                          else if (day === selectedDay) goToDate(day);
                          else setSelectedDay(day);
                        }}
                        tooltip={tooltipDay === day && isFuture && (
                          <div className="ph-mask" style={{ position: "absolute", top: "120%", left: "50%", transform: "translateX(-50%)", background: C.bgTertiary, border: `1px solid ${C.border}`, borderRadius: RADIUS.xs, padding: "6px 10px", whiteSpace: "nowrap", fontSize: 12, color: C.text, zIndex: 10, boxShadow: "0 4px 12px rgba(0,0,0,0.4)" }}>
                            {futureByDay[day] ? `${futureByDay[day].merchant} ~$${fmt(futureByDay[day].amount)}` : t("dashboard.no_bills_expected")}
                          </div>
                        )}
                      />
                    </div>
                  );
                })}
              </div>

              <div style={{ paddingBottom: 8 }}>
                {selectedIsFuture ? (
                  <div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 12 }}>
                      <div className="ph-mask" style={{ fontSize: 13, color: C.text }}>
                        {selectedFutureInfo ? `${selectedFutureInfo.merchant} ~$${fmt(selectedFutureInfo.amount)}` : t("dashboard.no_bills_expected")}
                      </div>
                      {selectedFutureInfo?.scheduledPaymentId && (
                        <button
                          onClick={() => onCancelScheduledPayment?.(selectedFutureInfo.scheduledPaymentId)}
                          aria-label={t("dashboard.cancel_planned_payment")}
                          style={{ background: C.red + "18", border: `1px solid ${C.red}33`, borderRadius: RADIUS.xs, width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}
                        >
                          <Icon name="x" size={12} color={C.red} />
                        </button>
                      )}
                    </div>
                    <button
                      onClick={() => setShowAddPayment(true)}
                      style={{ width: "100%", padding: "10px 14px", borderRadius: RADIUS.sm, border: `1px dashed ${C.border}`, background: "transparent", color: C.cyan, fontSize: 13, fontWeight: 600, fontFamily: FONT, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
                    >
                      <Icon name="plus" size={14} color={C.cyan} strokeWidth={2.5} />
                      {t("dashboard.add_planned_payment")}
                    </button>
                  </div>
                ) : selectedCatEntries.length === 0 ? (
                  <div style={{ fontSize: 13, color: C.muted }}>{t("dashboard.no_transactions")}</div>
                ) : (
                  selectedCatEntries.map(([cat, amount]) => (
                    <div key={cat} onClick={() => goToDateCategory(selectedDay, cat)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderTop: `1px solid ${C.sep}`, cursor: "pointer" }}>
                      <span style={{ fontSize: 13, color: C.text }}>{tCat(cat, t)}</span>
                      <span className="ph-mask" style={{ fontSize: 13, fontWeight: 600, color: CAT_COLORS[cat] || C.muted }}>${fmt(amount)}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {showAddPayment && selectedDay && (
        <AddPlannedPaymentModal
          dueDate={new Date(year, month, selectedDay)}
          transactions={transactions}
          merchantAliasMap={merchantAliasMap}
          scheduledPayments={scheduledPayments}
          accountBalance={accountBalance}
          onAdd={onAddScheduledPayment}
          onClose={() => setShowAddPayment(false)}
        />
      )}
    </GlassCard>
  );
}

// Form for a user-added one-off future payment ("send $500 to Ivan on the
// 15th") — shown from the calendar's Level 2 sheet for a future day. Reuses
// projectBalanceAt (same formula as Cash Flow Forecast) for the live "left
// after this" preview instead of a second balance calculation.
const PLANNED_PAYMENT_CATEGORIES = Object.keys(CAT_COLORS).filter(c => !["Transfer", "Transfers", "Income"].includes(c));

function AddPlannedPaymentModal({ dueDate, transactions, merchantAliasMap, scheduledPayments, accountBalance, onAdd, onClose }) {
  const { t } = useTranslation();
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState(PLANNED_PAYMENT_CATEGORIES[0]);
  const [saving, setSaving] = useState(false);

  const dueDateStr = formatDateStr(dueDate);
  const amountNum = Number(amount) || 0;

  const preview = useMemo(() => {
    if (amountNum <= 0) return null;
    const withThisPayment = [...scheduledPayments, { amount: amountNum, due_date: dueDateStr, status: "pending" }];
    return projectBalanceAt(transactions, accountBalance, dueDate, merchantAliasMap, withThisPayment);
  }, [amountNum, dueDateStr, transactions, accountBalance, merchantAliasMap, scheduledPayments, dueDate]);

  async function handleSave() {
    if (!(amountNum > 0) || !description.trim() || saving) return;
    setSaving(true);
    await onAdd?.({ amount: amountNum, description: description.trim(), category_name: category, due_date: dueDateStr });
    setSaving(false);
    onClose();
  }

  const inp = { width: "100%", padding: "13px 14px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: RADIUS.sm, color: C.text, fontSize: 15, boxSizing: "border-box", fontFamily: FONT };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.82)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 200 }}>
      <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 430, background: C.card, borderRadius: "24px 24px 0 0", padding: 24, border: `1px solid ${C.border}`, maxHeight: "90vh", overflowY: "auto", fontFamily: FONT }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{t("dashboard.add_planned_payment")}</h3>
          <button onClick={onClose} style={{ background: C.bgSecondary, border: `1px solid ${C.border}`, borderRadius: RADIUS.full, cursor: "pointer", width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name="x" size={14} color={C.muted} strokeWidth={2.5} />
          </button>
        </div>
        <div style={{ fontSize: 13, color: C.muted, marginBottom: 16 }}>
          {dueDate.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ position: "relative" }}>
            <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: C.muted, fontSize: 16, fontWeight: 600, pointerEvents: "none" }}>$</span>
            <input type="number" placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)} style={{ ...inp, paddingLeft: 30 }} />
          </div>
          <input style={inp} placeholder={t("dashboard.planned_payment_desc_placeholder")} value={description} onChange={e => setDescription(e.target.value)} />
          <select value={category} onChange={e => setCategory(e.target.value)} style={{ ...inp, cursor: "pointer" }}>
            {PLANNED_PAYMENT_CATEGORIES.map(c => <option key={c} value={c}>{tCat(c, t)}</option>)}
          </select>
        </div>

        {preview && (
          <div className="ph-mask" style={{ marginTop: 14, padding: "10px 14px", borderRadius: RADIUS.sm, background: C.bgTertiary, fontSize: 13, color: C.muted }}>
            {t("dashboard.balance_after_planned_payment", { amount: `$${fmt(Math.max(0, preview.projectedRaw), 0)}` })}
          </div>
        )}

        <button
          onClick={handleSave}
          disabled={!(amountNum > 0) || !description.trim() || saving}
          style={{ width: "100%", marginTop: 16, padding: 14, borderRadius: RADIUS.sm, border: "none", background: (amountNum > 0 && description.trim()) ? C.cyan : C.bgTertiary, color: (amountNum > 0 && description.trim()) ? "#04121F" : C.muted, fontSize: 15, fontWeight: 700, fontFamily: FONT, cursor: (amountNum > 0 && description.trim()) ? "pointer" : "default" }}
        >
          {saving ? t("dashboard.saving") : t("dashboard.save_planned_payment")}
        </button>
      </div>
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────
// Compact "coach" block — top of Dashboard, the highest-priority insight
// with inline-highlighted dollar amounts (ruby for warning-tier insights,
// gold for positive/neutral ones). Deliberately NOT a change to the shared
// InsightCard (used by Insights.jsx too) — a separate component so this
// pass stays scoped to Dashboard.jsx's own visual language.
const COACH_WARNING_TYPES = ['cash_risk', 'category_spike', 'overspending', 'debt_utilization', 'goal_off_track'];

function CoachBlock({ insight, onAction, onAskCoach, diagnosisCardState, diagnosisAccentColor, onOpenDiagnosis }) {
  const { t } = useTranslation();
  const headline = insight?.rendered?.headline;
  // Above any conditional return — a hook after one is a Rules of Hooks
  // violation (see Coding rules in CLAUDE.md). This card no longer bails
  // out entirely when there's no active coach insight (Dashboard
  // redesign, 2026-08-28): the Financial Diagnosis link now lives inside
  // this same card (previously its own standalone button below Today's
  // Lesson) and must stay visible even with no coach headline — a user
  // can have an active diagnosis with no live checkInEngine signal, or
  // vice versa, so neither half gates the other.
  const longPress = useLongPress(() => onAskCoach?.(headline));
  const accent = headline && COACH_WARNING_TYPES.includes(insight.type) ? DC.ruby : DC.gold;
  const { cta, action } = insight?.rendered || {};

  const diagnosisTitle = !diagnosisCardState || diagnosisCardState.type !== 'fresh'
    ? t("dashboard.financial_diagnosis_link")
    : diagnosisCardState.ageDays === 0 ? t("dashboard.financial_diagnosis_checked_today")
    : diagnosisCardState.ageDays === 1 ? t("dashboard.financial_diagnosis_checked_yesterday")
    : t("dashboard.financial_diagnosis_checked_days", { count: diagnosisCardState.ageDays });
  const diagnosisSubtitle =
    !diagnosisCardState ? t("dashboard.financial_diagnosis_subtitle")
    : diagnosisCardState.type === 'stale_event' ? t("dashboard.diagnosis_stale_event")
    : diagnosisCardState.type === 'stale_time' ? t("dashboard.diagnosis_stale_time")
    : diagnosisCardState.headline || null;

  return (
    <div {...longPress} style={{ background: DC.card, borderLeft: headline ? `3px solid ${accent}` : `3px solid transparent`, borderRadius: RADIUS.lg, padding: "16px 18px", fontFamily: FONT, userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none" }}>
      {headline && (
        <>
          <div style={{ fontSize: 13, color: DC.muted, fontWeight: 600, letterSpacing: 0.5, marginBottom: 6 }}>{t("dashboard.your_coach")}</div>
          <div className="ph-mask" style={{ fontSize: 17, fontWeight: 700, color: DC.text, lineHeight: 1.4 }}>
            {highlightNumbers(headline, accent)}
          </div>
          <button onClick={() => onAction?.(action, insight.data)} style={{ display: "flex", alignItems: "center", gap: 4, background: "none", border: "none", padding: 0, marginTop: 10, cursor: "pointer", fontFamily: FONT, fontSize: 14, fontWeight: 700, color: accent }}>
            {cta || t("dashboard.fix_this")}
            <Icon name="chevron" size={13} color={accent} />
          </button>
        </>
      )}

      {/* Financial Diagnosis — second, more prominent link in this same
          card (Dashboard redesign, 2026-08-28). "fresh" state's copy is
          now a single combined line ("Your financial diagnosis · checked
          X days ago") worded as the product differentiator it is, not the
          old two-line "Full diagnosis: checked X days ago" footnote
          treatment. */}
      <button
        onClick={onOpenDiagnosis}
        style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", boxSizing: "border-box", textAlign: "left", marginTop: headline ? 14 : 0, paddingTop: headline ? 14 : 0, borderTop: headline ? `1px solid ${DC.faint}18` : "none", background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: FONT }}
      >
        <Icon name="star" size={16} color={DC.gold} strokeWidth={1.8} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: diagnosisAccentColor }}>{diagnosisTitle}</span>
            <Icon name="chevron" size={12} color={diagnosisAccentColor} />
          </div>
          {diagnosisSubtitle && (
            <div className="ph-mask" style={{ fontSize: 12, color: DC.muted, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {diagnosisCardState?.type === 'fresh' && diagnosisCardState.headline
                ? highlightNumbers(diagnosisCardState.headline, diagnosisCardState.healthy ? DC.emerald : DC.ruby)
                : diagnosisSubtitle}
            </div>
          )}
        </div>
      </button>
    </div>
  );
}

// Subtitle shows the actual lesson title until completed today, then
// switches to the streak — same "tap = done" completion as decided (no
// separate confirm step). Lesson body itself is English-only for v1 (see
// utils/lessons.js header comment); the streak/chrome text around it is
// still localized normally.
function TodaysLessonRow({ lesson, streak, alreadyCompletedToday, onClick }) {
  const { t } = useTranslation();
  return (
    <div onClick={onClick} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 4px", cursor: "pointer" }}>
      <Icon name="zap" size={16} color={DC.gold} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: DC.muted }}>{t("dashboard.todays_lesson")}</div>
        <div style={{ fontSize: 11, color: DC.muted, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {alreadyCompletedToday && streak > 0 ? `🔥 ${t("dashboard.todays_lesson_streak", { count: streak })}` : lesson.title}
        </div>
      </div>
      <Icon name="chevron" size={13} color={DC.faint} />
    </div>
  );
}

// Compact 2-value Markets row for Dashboard (S&P 500 + Bitcoin only) — the
// full Markets experience (search/watchlist/buy/chart/news) already lives
// entirely independently on the Markets nav tab (Markets.jsx, a separate
// file/implementation, not shared with MarketOverview above), so trimming
// this down risks no functionality loss.
function MiniMarkets({ onOpenMarket }) {
  const { t } = useTranslation();
  const [markets, setMarkets] = useState([]);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch(`${SUPABASE_URL}/functions/v1/market-data`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${session?.access_token ?? ""}`, "apikey": SUPABASE_KEY },
          body: JSON.stringify({ type: "overview" }),
        });
        if (!res.ok) return;
        const data = await res.json();
        if (alive && data?.markets) setMarkets(data.markets);
      } catch {}
    }
    load();
    const timer = setInterval(load, 60000);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  const META = { SPY: { label: "S&P 500", symbol: "SPY" }, BTC: { label: "Bitcoin", symbol: "BTC" } };
  const rows = ["SPY", "BTC"].map(sym => ({ ...META[sym], data: markets.find(m => m.symbol === sym) }));

  return (
    <div>
      <div style={{ fontSize: 10, color: DC.muted, letterSpacing: 1, fontWeight: 600, textTransform: "uppercase", marginBottom: 8 }}>{t("dashboard.markets")}</div>
      <div style={{ display: "flex", gap: 8 }}>
      {rows.map(row => {
        const pos = (row.data?.changePct ?? 0) >= 0;
        return (
          <button key={row.symbol} onClick={() => onOpenMarket?.(row.symbol)} style={{ flex: 1, textAlign: "left", background: DC.card, borderRadius: RADIUS.md, padding: "14px 16px", border: "none", cursor: "pointer", fontFamily: FONT }}>
            <div style={{ fontSize: 10, color: DC.muted, letterSpacing: 1, fontWeight: 600, textTransform: "uppercase", marginBottom: 6 }}>{row.label}</div>
            <div style={{ fontSize: 15, fontWeight: 800, color: DC.text }}>
              {row.data?.price != null ? `$${Number(row.data.price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}
            </div>
            {row.data?.changePct != null && (
              <div style={{ fontSize: 11, fontWeight: 600, color: pos ? DC.emerald : DC.ruby, marginTop: 2 }}>
                {pos ? "+" : ""}{Number(row.data.changePct).toFixed(2)}%
              </div>
            )}
          </button>
        );
      })}
      </div>
    </div>
  );
}

export default function Dashboard({ totalSpent, totalIncome, lastSpent, lastIncome, transactions, spendingByCategory, prevSpendingByCategory, profile, savings, onNavigate, onCatClick, onMerchantClick, onDayClick, onDayCategoryClick, insight, onInsightAction, isShowingLastMonth, isPro, onUpgrade, upcomingCharges = [], onOpenMarket, bankConnected, userId, lastSyncedAt, hideWelcomeBanner = false, merchantAliasMap, scheduledPayments = [], onAddScheduledPayment, onCancelScheduledPayment, onOpenChat, lessonStreak = { current_streak: 0, last_completed_date: null }, onCompleteLesson, onOpenChatWithMessage, alpacaConnected = false }) {
  const { t, i18n } = useTranslation();
  const [balanceVisible, setBalanceVisible] = useState(true);
  const [accountBalance, setAccountBalance] = useState(null); // primary checking balance from Plaid
  const [creditAccounts, setCreditAccounts] = useState([]); // credit-card accounts from the same fetch
  // Net worth (Step 2.5, 2026-08-27) — Plaid investment accounts, from the
  // same accounts fetch below (no extra Plaid call), plus Alpaca stock
  // positions, fetched independently the same way Savings.jsx already does
  // (per-screen fetch, not lifted to a shared parent state).
  const [investTotal, setInvestTotal] = useState(0);
  const [alpacaPortfolio, setAlpacaPortfolio] = useState(null);
  const [otherBreakdown, setOtherBreakdown] = useState(false);
  const [showCashFlowSheet, setShowCashFlowSheet] = useState(false);
  const [showUpcomingSheet, setShowUpcomingSheet] = useState(false);
  const [showLessonSheet, setShowLessonSheet] = useState(false);
  const [showLongPressTip, setShowLongPressTip] = useState(false);
  const balanceFetchIdRef = useRef(0);
  const m = (n, dec = 0) => balanceVisible ? `$${fmt(n, dec)}` : "••••";

  // Coach block's "Review Credit Cards" CTA (action:'view_debt') scrolls to
  // the Credit Cards card already rendered below on this same screen —
  // debt_utilization insights only ever surface on the home screen
  // preference (get-insights SCREEN_PREFERENCES.home), so this card is
  // guaranteed to be present when the CTA is clickable. A brief highlight
  // flash is added on top of the plain scroll, since scrollIntoView is a
  // silent no-op when the card is already fully in view — without it, the
  // button could still look broken on taller viewports.
  const creditCardsRef = useRef(null);
  const [creditCardsHighlight, setCreditCardsHighlight] = useState(false);
  function scrollToCreditCards() {
    creditCardsRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    setCreditCardsHighlight(true);
    setTimeout(() => setCreditCardsHighlight(false), 1600);
  }

  // One-time tip, localStorage only (pure UI nicety, not worth a profile
  // column/migration) — shown once, dismissed either by the × or by the
  // first successful long-press itself (see handleCardLongPress).
  useEffect(() => {
    try {
      if (!localStorage.getItem('arkonomy_longpress_tip_seen')) setShowLongPressTip(true);
    } catch {}
  }, []);

  function dismissLongPressTip() {
    setShowLongPressTip(false);
    try { localStorage.setItem('arkonomy_longpress_tip_seen', '1'); } catch {}
  }

  // Intercept "Other" clicks — show breakdown instead of navigating
  function handleCatClick(cat) {
    if (cat === 'Other') { setOtherBreakdown(true); return; }
    onCatClick?.(cat);
  }

  function handleCardLongPress(cardKey, data) {
    const question = getCardQuestion(cardKey, data, t);
    if (question) onOpenChatWithMessage?.(question);
    if (showLongPressTip) dismissLongPressTip();
  }

  useEffect(() => {
    if (!bankConnected || !userId) return;
    const fetchId = ++balanceFetchIdRef.current;
    (async () => {
      try {
        let accounts = getCachedAccounts();
        if (!accounts) {
          const { data: { session } } = await supabase.auth.getSession();
          if (!session) return;
          const res = await fetch(`${SUPABASE_URL}/functions/v1/plaid-get-accounts`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${session.access_token}`, "apikey": SUPABASE_KEY },
            body: "{}",
          });
          if (!res.ok) return;
          const d = await res.json();
          accounts = d.accounts ?? [];
          if (accounts.length) setCachedAccounts(accounts);
        }
        if (!accounts.length) return;
        const bal = sumDepositoryBalance(accounts);
        if (bal != null && fetchId === balanceFetchIdRef.current) setAccountBalance(bal);
        if (fetchId === balanceFetchIdRef.current) setCreditAccounts(getCreditAccounts(accounts));
        if (fetchId === balanceFetchIdRef.current) setInvestTotal(sumInvestmentBalance(accounts));
      } catch {}
    })();
  }, [bankConnected, userId, lastSyncedAt]);

  // Alpaca stock positions for net worth (Step 2.5, 2026-08-27) — same
  // per-screen fetch pattern as Savings.jsx, not lifted to a shared parent
  // state (see that file's identical effect).
  useEffect(() => {
    if (!alpacaConnected) return;
    supabase.functions.invoke("alpaca-portfolio").then(({ data, error }) => {
      if (!error && data && !data.error) setAlpacaPortfolio(data);
    });
  }, [alpacaConnected]);
  // Hottest cards first (highest utilization) — cards with no computable
  // utilization (institution didn't return balance_available) sort last.
  // Shared by the compact Dashboard card and the AccordionSection body
  // when there are more than 2 (see item 3 in the main render below).
  const sortedCreditAccounts = [...creditAccounts].sort((a, b) => {
    const pa = creditUtilization(a), pb = creditUtilization(b);
    if (pa == null && pb == null) return 0;
    if (pa == null) return 1;
    if (pb == null) return -1;
    return pb - pa;
  });
  const budget = Number(profile?.monthly_budget) || 3000;
  const balance = totalIncome - totalSpent;
  // Same formula as Insights.jsx.availableSafe — for cashPositionLow parity between screens.
  const availableSafe = Math.max(0, Math.min(totalIncome - totalSpent - BUFFER, accountBalance != null ? accountBalance - BUFFER : Infinity));
  const cashPositionLow = availableSafe <= 0 && accountBalance != null;
  // Hoisted so the "Next up" render and its long-press callback below don't
  // independently recompute the same pick — single source, like everywhere
  // else in this file.
  const nextUpcomingCharge = upcomingCharges.length > 0
    ? [...upcomingCharges].sort((a, b) => a.daysUntil - b.daysUntil)[0]
    : null;

  // Bill-clustering alert (Dashboard redesign, 2026-08-28) — its own
  // compact line, separate from the calendar grid below (see
  // getBillClusterAlert's own comment).
  const billClusterAlert = useMemo(
    () => getBillClusterAlert(transactions, merchantAliasMap, new Date(), scheduledPayments),
    [transactions, merchantAliasMap, scheduledPayments]
  );

  // ── Card long-press → prefilled AI chat question ───────────────────────────
  // useLongPress itself must be called unconditionally at the top level (not
  // inside a render-time IIFE/conditional) — Rules of Hooks. The callbacks
  // read whatever card-specific data they need at press time from these
  // already-computed top-level values, so a single hook instance covers
  // both Credit Cards render branches (single-card vs multi-card).
  const cashFlowLongPress = useLongPress(() => handleCardLongPress('cashFlow'));
  const creditCardsLongPress = useLongPress(() => {
    const top = sortedCreditAccounts[0];
    if (!top) return;
    handleCardLongPress('creditCards', { cardName: top.name || top.official_name || t("dashboard.credit_cards_title"), pct: creditUtilization(top) });
  });
  const spendingLongPress = useLongPress(() => {
    const top = Object.entries(spendingByCategory).sort((a, b) => b[1] - a[1])[0];
    if (!top) return;
    handleCardLongPress('spending', { category: tCat(top[0], t) });
  });
  const healthScoreLongPress = useLongPress(() => handleCardLongPress('healthScore', { label: getScoreLabel(healthScore) }));
  const nextUpLongPress = useLongPress(() => {
    if (!nextUpcomingCharge) return;
    const dueDate = new Date(nextUpcomingCharge.expectedDate + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
    handleCardLongPress('nextUp', { merchant: nextUpcomingCharge.merchant, date: dueDate });
  });

  // ── Today's Lesson ────────────────────────────────────────────────────────
  const staticTodaysLesson = useMemo(() => getTodaysLesson(), []);
  // Financial Diagnosis Phase 2: if the user has an active diagnosis,
  // daily-lesson-v2 replaces the static rotation with one personalized to
  // their real issues + yesterday's transactions. Always called once per
  // day (decision 2026-08-23: one code path, no separate "does an active
  // diagnosis exist" pre-check) — the function itself early-returns cheaply
  // for users with no active diagnosis, and the result (including a
  // no-op/error outcome) is cached client-side by calendar date so it's
  // never re-fetched more than once/day regardless of outcome.
  const [diagnosisLesson, setDiagnosisLesson] = useState(null);
  useEffect(() => {
    if (!userId) return;
    const cached = getCachedDiagnosisLesson(userId);
    if (cached) {
      if (cached.lesson) setDiagnosisLesson(cached.lesson);
      return; // already resolved today (lesson or explicit null) — don't re-fetch
    }

    let cancelled = false;
    callEdgeFunction('daily-lesson-v2', { lang: i18n.language })
      .then(data => {
        if (cancelled) return;
        const lesson = data?.status === 'diagnosed_lesson' ? data.lesson : null;
        setDiagnosisLesson(lesson);
        setCachedDiagnosisLesson(userId, lesson);
      })
      .catch(() => { /* silent — falls back to the static lessons.js rotation below, no error UI for a background enhancement */ });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);
  const todaysLesson = diagnosisLesson || staticTodaysLesson;
  const lessonAlreadyDoneToday = computeNextStreak(lessonStreak.last_completed_date, lessonStreak.current_streak).alreadyCompletedToday;
  const lessonPersonalizedNote = useMemo(
    () => getPersonalizedLessonNote({ cashPositionLow, upcomingCharges, spendingByCategory }),
    [cashPositionLow, upcomingCharges, spendingByCategory]
  );

  // ── Financial Diagnosis entry-card state (2026-08-24) ────────────────────
  // Was a static link every time — now diagnosis-aware, same "Phase 2 wires
  // this row up" plan noted in the button's own comment below. null = no
  // active diagnosis (or not yet resolved) -> keep the original invite
  // framing. Otherwise one of 'fresh' / 'stale_time' / 'stale_event' — two
  // deliberately separate stale reasons (see diagnosisFreshness.js), not
  // collapsed into one generic "recheck" message, so the copy never claims
  // something happened when it's really just time passing.
  const [diagnosisCardState, setDiagnosisCardState] = useState(null);
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    supabase
      .from('diagnosis_profiles')
      .select('id, narrative, primary_issues, created_at')
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(async ({ data: existing, error }) => {
        if (cancelled || error || !existing) return;
        const ageMs = Date.now() - new Date(existing.created_at).getTime();
        const eventStale = await hasSignificantEventSince(existing.created_at);
        if (cancelled) return;
        setDiagnosisCardState({
          type: eventStale ? 'stale_event' : ageMs >= DIAGNOSIS_RECENT_MS ? 'stale_time' : 'fresh',
          headline: existing.narrative?.headline || '',
          // Same healthy/not-healthy determination FinancialDiagnosis.jsx's
          // own mount effect already uses, so both screens agree on the
          // same diagnosis row. Drives which color highlightNumbers() falls
          // back to below for unsigned dollar/percent figures in the
          // headline preview (2026-08-25) — ruby for a problem diagnosis,
          // emerald for a healthy one.
          healthy: (existing.primary_issues || []).length === 0,
          ageDays: Math.floor(ageMs / 86_400_000),
        });
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);
  // 'fresh' reads calm/already-seen (muted); no active diagnosis or either
  // stale reason keeps the original gold "worth a look" emphasis.
  const diagnosisNeedsAttention = !diagnosisCardState || diagnosisCardState.type !== 'fresh';
  const diagnosisAccentColor = diagnosisNeedsAttention ? DC.gold : DC.muted;

  // ── Health Score ──────────────────────────────────────────────────────────
  const SUB_CATS = ['Subscriptions', 'Bills', 'Utilities', 'Phone', 'Internet', 'Insurance'];
  const subscriptionSpend = SUB_CATS.reduce((s, cat) => s + (spendingByCategory[cat] || 0), 0);
  const { score: healthScore, color: scoreColor, breakdown: scoreBreakdown } = calculateHealthScore({
    totalIncome,
    totalSpent,
    lastIncome,
    lastSpent,
    budget,
    subscriptionSpend,
  });
  // healthScore.js is shared (weekly-report duplicates its formula too) —
  // not touching its returned hex directly, just mapping to the new
  // palette for display here.
  const dcScoreColor = scoreColor === '#FF5C7A' ? DC.ruby : scoreColor === '#FFB800' ? DC.gold : scoreColor === '#12D18E' ? DC.emerald : scoreColor;
  const healthComment = generateHealthComment({
    score: healthScore,
    breakdown: scoreBreakdown,
    spendingByCategory,
    prevSpendingByCategory,
  });
  const prevSubscriptionSpend = SUB_CATS.reduce((s, cat) => s + (prevSpendingByCategory[cat] || 0), 0);
  const { score: prevHealthScore } = (lastIncome > 0 || lastSpent > 0)
    ? calculateHealthScore({ totalIncome: lastIncome, totalSpent: lastSpent, lastIncome: 0, lastSpent: 0, budget, subscriptionSpend: prevSubscriptionSpend })
    : { score: null };

  const checkInData = {
    spent:       totalSpent,
    budget:      budget,
    income:      totalIncome,
    savingsRate: totalIncome > 0 ? Math.round((totalIncome - totalSpent) / totalIncome * 100) : 0,
    day:         new Date().getDate(),
    spikePct: (() => {
      const spikes = Object.entries(spendingByCategory).map(([cat, amt]) => {
        const p = prevSpendingByCategory[cat] || 0;
        // Same $15 threshold as get-insights' renderInsight baseTooSmallForPct
        // check: a tiny previous-month base turns a small real delta into a
        // meaningless %, so exclude it instead of letting it win the max.
        return p >= 15 ? ((amt - p) / p) * 100 : 0;
      });
      return spikes.length ? Math.round(Math.max(...spikes)) : 0;
    })(),
    catSpend: Object.values(spendingByCategory).length
      ? Math.max(...Object.values(spendingByCategory))
      : 0,
    cat: Object.entries(spendingByCategory).sort((a, b) => b[1] - a[1])[0]?.[0] || "Other",
  };

  return (
   <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>

      {/* 0a ── Onboarding welcome card (shown only when no transactions exist and no active trial toast) */}
      {transactions.length === 0 && !hideWelcomeBanner && (
        <div style={{ background: DC.card, borderRadius: RADIUS.lg, padding: "20px 18px" }}>
          <div style={{ fontSize: 22, marginBottom: 6 }}>👋</div>
          <div style={{ fontWeight: 700, fontSize: 17, color: DC.text, marginBottom: 4 }}>{t("dashboard.welcome_title")}</div>
          <div style={{ fontSize: 13, color: DC.muted, lineHeight: 1.6, marginBottom: 16 }}>
            {t("dashboard.welcome_body")}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {/* bankConnected but transactions.length===0 is the transient
                "already connected, first sync hasn't landed yet" state —
                showing "Connect Bank" there would be misleading, so only
                offer it to users who haven't connected at all. */}
            {!bankConnected && (
              <button
                onClick={() => onNavigate("profile")}
                style={{ flex: 1, padding: "11px 0", background: DC.gold, border: "none", borderRadius: RADIUS.sm, color: DC.bg, fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: FONT }}
              >
                {t("dashboard.connect_bank")}
              </button>
            )}
            <button
              onClick={() => onNavigate("transactions")}
              style={{ flex: 1, padding: "11px 0", background: DC.bg, border: `1px solid ${DC.faint}33`, borderRadius: RADIUS.sm, color: DC.text, fontWeight: 600, fontSize: 13, cursor: "pointer", fontFamily: FONT }}
            >
              {t("dashboard.add_transaction")}
            </button>
          </div>
        </div>
      )}

      {/* 0b ── One-time long-press tip — dismissed by the × or by the first
          successful long-press itself (handleCardLongPress), never shown again. */}
      {showLongPressTip && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, background: DC.card, border: `1px solid ${DC.gold}33`, borderRadius: RADIUS.md, padding: "10px 14px" }}>
          <Icon name="zap" size={14} color={DC.gold} />
          <div style={{ flex: 1, fontSize: 12, color: DC.muted }}>{t("dashboard.longpress_tip")}</div>
          <button onClick={dismissLongPressTip} aria-label={t("dashboard.close")} style={{ background: "none", border: "none", padding: 4, cursor: "pointer", display: "flex" }}>
            <Icon name="x" size={14} color={DC.faint} />
          </button>
        </div>
      )}

      {/* 1 ── Coach card: highest-priority insight + Financial Diagnosis
          entry point, both inside the same card now (Dashboard redesign,
          2026-08-28) — the diagnosis link used to be its own standalone
          button below Today's Lesson. */}
      <CoachBlock
        insight={insight?.type === 'savings_opportunity' && balance <= 0 ? null : insight}
        onAction={(action, data) => action === 'view_debt' ? scrollToCreditCards() : onInsightAction(action, data)}
        onAskCoach={headline => handleCardLongPress('coach', { headline })}
        diagnosisCardState={diagnosisCardState}
        diagnosisAccentColor={diagnosisAccentColor}
        onOpenDiagnosis={() => onNavigate("financial-diagnosis")}
      />

      {/* 2 ── Balance: one asymmetric card (real balance primary + sparkline, "Projected EOM" subordinate below) — gold border keeps it a visual anchor without competing with the coach card above. Tap opens the full Cash Flow Forecast sheet, same as before. */}
      {!bankConnected ? (
        <div data-tutorial="net-balance">
          <ConnectBankPrompt title={t("dashboard.account_balance")} message={t("dashboard.connect_bank_balance")} onNavigate={onNavigate} />
        </div>
      ) : (() => {
        const today = new Date();
        const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
        const endOfMonthDate = new Date(today.getFullYear(), today.getMonth(), daysInMonth);
        const { projectedRaw } = accountBalance != null
          ? projectBalanceAt(transactions, accountBalance, endOfMonthDate, merchantAliasMap, scheduledPayments, today)
          : { projectedRaw: null };
        const projectedBalance = projectedRaw != null ? Math.max(0, projectedRaw) : null;
        // Muted by default — subordinate to the real balance above it, per
        // spec (it's a forecast, not a fact) — except when it flags an
        // actual projected deficit, still worth a real warning color.
        const eomColor = projectedBalance == null ? DC.muted : projectedRaw <= 0 ? DC.ruby : DC.muted;
        return (
          <button data-tutorial="net-balance" {...cashFlowLongPress} onClick={() => setShowCashFlowSheet(true)} style={{ display: "block", width: "100%", boxSizing: "border-box", textAlign: "left", background: DC.card, borderRadius: RADIUS.md, padding: "16px 18px", border: `1.5px solid ${DC.gold}66`, cursor: "pointer", fontFamily: FONT, userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span style={{ fontSize: 10, color: DC.muted, letterSpacing: 1, fontWeight: 600, textTransform: "uppercase" }}>{t("dashboard.balance_short")}</span>
              <span onClick={e => { e.stopPropagation(); setBalanceVisible(v => !v); }} role="button" aria-label={balanceVisible ? t("dashboard.hide_balance") : t("dashboard.show_balance")} style={{ display: "flex", padding: 4 }}>
                <Icon name={balanceVisible ? "eye" : "eye-off"} size={13} color={DC.faint} />
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              {accountBalance != null ? (
                <div className="ph-mask" style={{ fontSize: 32, fontWeight: 800, letterSpacing: -1, color: DC.text, lineHeight: 1.1 }}>
                  {balanceVisible ? `$${fmt(accountBalance)}` : "••••"}
                </div>
              ) : (
                <div style={{ width: 120, height: 32, borderRadius: RADIUS.xs, background: `linear-gradient(90deg,${DC.card} 0%,#20263380 40%,${DC.card} 100%)`, backgroundSize: "200% 100%", animation: "bal-shimmer 1.4s ease-in-out infinite" }} />
              )}
              <Sparkline transactions={transactions} />
            </div>
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${DC.faint}18` }}>
              {projectedBalance != null ? (
                <span className="ph-mask" style={{ fontSize: 12, color: DC.faint }}>
                  {t("dashboard.projected_eom")} · <span style={{ fontWeight: 700, color: eomColor }}>{balanceVisible ? `$${fmt(projectedBalance)}` : "••••"}</span>
                </span>
              ) : (
                <div style={{ width: 100, height: 12, borderRadius: RADIUS.xs, background: `linear-gradient(90deg,${DC.card} 0%,#20263380 40%,${DC.card} 100%)`, backgroundSize: "200% 100%", animation: "bal-shimmer 1.4s ease-in-out infinite" }} />
              )}
            </div>
          </button>
        );
      })()}

      {/* 3 ── Credit Cards — compact single-line-per-card, collapsible via
          Settings' AccordionSection once there are more than 2 (replaces
          the old top-3 + "+N more" modal sheet — the accordion already
          reveals everything on expand, no separate sheet needed). */}
      {creditAccounts.length > 0 && (() => {
        const totalDebt = sumCreditDebt(creditAccounts);
        // Step 2.5 (2026-08-27): was accountBalance - totalDebt (cash minus
        // debt only, ignored investments/savings entirely) — see
        // calculateNetWorth()'s own comment for why that was wrong, not just
        // a different label from Savings.jsx's number.
        const totalSaved = (savings || []).reduce((s, sv) => s + Number(sv.current), 0);
        const investmentsTotal = investTotal + sumAlpacaPositionsValue(alpacaPortfolio);
        const netWorth = accountBalance != null
          ? calculateNetWorth({ cash: accountBalance, investments: investmentsTotal, savingsGoals: totalSaved, creditDebt: totalDebt })
          : null;
        const utilColorDC = (pct) => pct == null ? DC.faint : pct >= 0.70 ? DC.ruby : pct >= 0.30 ? DC.gold : DC.emerald;
        const netWorthLabel = netWorth != null
          ? `${t("dashboard.credit_cards_net_worth")}: ${balanceVisible ? (netWorth < 0 ? `-$${fmt(Math.abs(netWorth))}` : `$${fmt(netWorth)}`) : "••••"}`
          : null;

        // Exactly one card: the generic "Credit Cards" label + total-debt
        // header duplicated the single card's own name/balance below it.
        // Use the card's real name as the header instead, and fold Net
        // Worth into a small line next to utilization% rather than its own
        // prominent row — one card doesn't need two header lines.
        if (creditAccounts.length === 1) {
          const only = sortedCreditAccounts[0];
          const pct = creditUtilization(only);
          const color = utilColorDC(pct);
          return (
            <div ref={creditCardsRef} {...creditCardsLongPress} style={{ background: DC.card, borderRadius: RADIUS.md, padding: "16px", border: "none", outline: creditCardsHighlight ? `2px solid ${DC.gold}` : "2px solid transparent", outlineOffset: 2, transition: "outline-color 0.3s", userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: DC.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{only.name || only.official_name || t("dashboard.credit_cards_title")}</span>
                <span className="ph-mask" style={{ fontSize: 17, fontWeight: 800, color: DC.text }}>{m(Number(only.balance_current ?? 0))}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
                <span style={{ fontSize: 10, color: DC.muted, letterSpacing: 0.5, fontWeight: 600, textTransform: "uppercase" }}>{t("dashboard.credit_cards_utilization")}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color }}>{pct != null ? `${Math.round(pct * 100)}%` : "—"}</span>
              </div>
              {netWorthLabel && (
                <div className="ph-mask" style={{ fontSize: 11, color: DC.faint, marginTop: 6 }}>{netWorthLabel}</div>
              )}
            </div>
          );
        }

        const cardRow = (a, i) => (
          <div key={a.account_id || i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: i === 0 ? 0 : "8px 0 0" }}>
            <span style={{ fontSize: 13, color: DC.text, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name || a.official_name || t("dashboard.credit_cards_title")}</span>
            <span className="ph-mask" style={{ fontSize: 13, fontWeight: 600, color: DC.text }}>{m(Number(a.balance_current ?? 0))}</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: utilColorDC(creditUtilization(a)), minWidth: 34, textAlign: "right" }}>{(() => { const p = creditUtilization(a); return p != null ? `${Math.round(p * 100)}%` : "—"; })()}</span>
          </div>
        );

        const header = (
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span style={{ fontSize: 10, color: DC.muted, letterSpacing: 1, fontWeight: 600, textTransform: "uppercase" }}>{t("dashboard.credit_cards_title")}</span>
              <span className="ph-mask" style={{ fontSize: 17, fontWeight: 800, color: DC.ruby }}>{m(totalDebt)}</span>
            </div>
            {netWorthLabel && <div className="ph-mask" style={{ fontSize: 11, color: DC.faint, marginTop: 4 }}>{netWorthLabel}</div>}
          </div>
        );

        // 2 or fewer: shown directly, no accordion needed. More than 2:
        // collapsed by default behind the same AccordionSection Settings
        // uses (Profile.jsx) — header is the summary row above, body is
        // every card, no more truncating to a top-3 + separate sheet.
        if (sortedCreditAccounts.length <= 2) {
          return (
            <div ref={creditCardsRef} {...creditCardsLongPress} style={{ background: DC.card, borderRadius: RADIUS.md, padding: "16px", border: "none", outline: creditCardsHighlight ? `2px solid ${DC.gold}` : "2px solid transparent", outlineOffset: 2, transition: "outline-color 0.3s", userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none" }}>
              {header}
              <div style={{ marginTop: netWorthLabel ? 10 : 8 }}>
                {sortedCreditAccounts.map(cardRow)}
              </div>
            </div>
          );
        }

        return (
          <div ref={creditCardsRef} {...creditCardsLongPress} style={{ userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none" }}>
            <AccordionSection header={header} borderColor={creditCardsHighlight ? DC.gold : undefined}>
              {sortedCreditAccounts.map(cardRow)}
            </AccordionSection>
          </div>
        );
      })()}

      {/* 4 ── Next bill — calm/informational, deliberately no ruby/urgent accent (that's reserved for the coach card above). Full list is one tap away in the Upcoming sheet, unchanged. */}
      {nextUpcomingCharge && (() => {
        const next = nextUpcomingCharge;
        const dueDate = new Date(next.expectedDate + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
        return (
          <button onClick={() => setShowUpcomingSheet(true)} {...nextUpLongPress} style={{ display: "flex", flexDirection: "column", gap: 4, width: "100%", boxSizing: "border-box", background: DC.card, borderRadius: RADIUS.md, padding: "14px 16px", border: "none", cursor: "pointer", fontFamily: FONT, textAlign: "left", userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none" }}>
            <span style={{ fontSize: 10, color: DC.muted, letterSpacing: 1, fontWeight: 600, textTransform: "uppercase" }}>{t("dashboard.next_bill_label")}</span>
            <span className="ph-mask" style={{ fontSize: 14, color: DC.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              <span style={{ fontWeight: 600 }}>{next.merchant}</span>
              <span style={{ color: DC.faint }}> · {dueDate} — </span>
              <span style={{ fontWeight: 700 }}>${fmt(next.amount, 2)}</span>
            </span>
          </button>
        );
      })()}

      {/* 5 ── Bill-clustering alert (own compact line, NOT merged into the
          grid below) + the calendar grid itself, now stripped of the old
          "This Month" label and any inline clustering text — just the
          grid + "View full month" link, per the redesign spec's own
          fallback default (kept the day-grid for day-of-week context
          rather than reducing to just this one line). */}
      {billClusterAlert && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, background: DC.gold + "14", border: `1px solid ${DC.gold}33`, borderRadius: RADIUS.sm, padding: "10px 14px" }}>
          <Icon name="calendar" size={14} color={DC.gold} />
          <span className="ph-mask" style={{ fontSize: 12, fontWeight: 600, color: DC.text }}>
            {t("dashboard.bill_cluster_alert", {
              date: new Date(new Date().getFullYear(), new Date().getMonth(), billClusterAlert.day).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
              count: billClusterAlert.count,
              total: `$${fmt(billClusterAlert.total, 0)}`,
            })}
          </span>
        </div>
      )}
      <MonthCalendar transactions={transactions} merchantAliasMap={merchantAliasMap} onDayClick={onDayClick} onDayCategoryClick={onDayCategoryClick} scheduledPayments={scheduledPayments} onAddScheduledPayment={onAddScheduledPayment} onCancelScheduledPayment={onCancelScheduledPayment} accountBalance={accountBalance} bankConnected={bankConnected} onNavigate={onNavigate} compactWeek />

      {/* 6 ── Today's lesson (unchanged) */}
      <TodaysLessonRow lesson={todaysLesson} streak={lessonStreak.current_streak} alreadyCompletedToday={lessonAlreadyDoneToday} onClick={() => { setShowLessonSheet(true); onCompleteLesson?.(); }} />

      {/* 7 ── Spending by Category (donut + top-3 + "View all →" + side legend) */}
      <div {...spendingLongPress} style={{ background: DC.card, borderRadius: RADIUS.lg, padding: "14px 16px", userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <span style={{ fontWeight: 600, fontSize: 14, color: DC.muted }}>{t("dashboard.spending_by_category")}</span>
          {isPro
            ? <span style={{ fontSize: 10, color: DC.faint, background: DC.bg, padding: "3px 8px", borderRadius: RADIUS.full }}>{t("dashboard.tap_to_filter")}</span>
            : <span style={{ fontSize: 10, color: DC.gold, background: DC.gold + "18", padding: "3px 8px", borderRadius: RADIUS.full, cursor: "pointer" }} onClick={onUpgrade}>Pro</span>
          }
        </div>
        {Object.keys(spendingByCategory).length === 0 ? (
          <div style={{ textAlign: "center", padding: "24px 0", color: DC.faint, fontSize: 13 }}>
            {t("dashboard.no_spending_data")}
          </div>
        ) : (
          <DonutChart data={spendingByCategory} size={120} sideLegend onCatClick={isPro ? handleCatClick : null} hideAmounts={!balanceVisible} capCount={3} paywalled={!isPro} onUpgrade={onUpgrade} />
        )}
      </div>

      {/* 8 ── Financial Health Score — tone now matches severity (getScoreLabel fix, 2026-08-28): a near-floor score no longer reads as the same "Getting started" as a brand-new account. */}
      <div data-tutorial="health-score" {...healthScoreLongPress} style={{ userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none" }}>
        <HealthScoreBar score={healthScore} color={dcScoreColor} comment={healthComment} breakdown={scoreBreakdown} hasData={totalIncome > 0 || totalSpent > 0} prevScore={prevHealthScore} cashPositionLow={cashPositionLow} />
        <button
          onClick={() => onNavigate("insights")}
          style={{ display: "flex", alignItems: "center", gap: 4, margin: "6px 0 0 2px", background: "none", border: "none", cursor: "pointer", padding: 0, fontFamily: FONT }}
        >
          <span style={{ fontSize: 13, fontWeight: 600, color: DC.gold }}>{t("dashboard.view_insights")}</span>
          <Icon name="chevron" size={13} color={DC.gold} />
        </button>
      </div>

      {/* 9 ── Markets (unchanged) */}
      <MiniMarkets onOpenMarket={onOpenMarket} />

      {/* Ask your coach anything — unchanged, stays after Markets */}
      <button data-tutorial="ask-coach" onClick={() => onOpenChat?.()} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", background: DC.card, border: `1px solid ${DC.faint}33`, borderRadius: RADIUS.full, padding: "14px 20px", cursor: "pointer", fontFamily: FONT, marginTop: 4 }}>
        <span style={{ fontSize: 13, color: DC.muted }}>{t("dashboard.ask_coach_placeholder")}</span>
        <Icon name="chevron" size={14} color={DC.faint} />
      </button>

      {/* ── Cash Flow Forecast sheet (full burn-down bar + 3-stat grid, tapped from the compact Balance/End-of-month boxes) ── */}
      {showCashFlowSheet && (
        <div onClick={() => setShowCashFlowSheet(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 180, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
          <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 430, background: C.card, borderRadius: "20px 20px 0 0", border: `1px solid ${C.border}`, padding: "0 0 32px", maxHeight: "75vh", display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "14px 0 0", display: "flex", justifyContent: "center" }}>
              <div style={{ width: 36, height: 4, borderRadius: RADIUS.full, background: "rgba(255,255,255,0.12)" }} />
            </div>
            <div style={{ padding: "12px 20px 10px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: `1px solid ${C.sep}`, flexShrink: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>{t("dashboard.cash_flow_forecast")}</div>
              <button onClick={() => setShowCashFlowSheet(false)} aria-label={t("dashboard.close")} style={{ background: C.bgTertiary, border: `1px solid ${C.border}`, borderRadius: RADIUS.xs, width: 44, height: 44, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke={C.muted} strokeWidth={2.5} strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div style={{ overflowY: "auto", padding: "16px 20px" }}>
              <CashFlowForecast
                accountBalance={accountBalance}
                transactions={transactions}
                balanceVisible={balanceVisible}
                merchantAliasMap={merchantAliasMap}
                bankConnected={bankConnected}
                onNavigate={onNavigate}
                scheduledPayments={scheduledPayments}
              />
            </div>
          </div>
        </div>
      )}

      {showUpcomingSheet && (
        <div onClick={() => setShowUpcomingSheet(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 180, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
          <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 430, background: C.card, borderRadius: "20px 20px 0 0", border: `1px solid ${C.border}`, padding: "0 0 32px", maxHeight: "75vh", display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "14px 0 0", display: "flex", justifyContent: "center" }}>
              <div style={{ width: 36, height: 4, borderRadius: RADIUS.full, background: "rgba(255,255,255,0.12)" }} />
            </div>
            <div style={{ padding: "12px 20px 10px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: `1px solid ${C.sep}`, flexShrink: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>{t("dashboard.upcoming_charges")}</div>
              <button onClick={() => setShowUpcomingSheet(false)} aria-label={t("dashboard.close")} style={{ background: C.bgTertiary, border: `1px solid ${C.border}`, borderRadius: RADIUS.xs, width: 44, height: 44, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke={C.muted} strokeWidth={2.5} strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div style={{ overflowY: "auto", padding: "16px 20px" }}>
              <UpcomingChargesCard charges={upcomingCharges} />
            </div>
          </div>
        </div>
      )}

      {/* ── Today's Lesson sheet ── */}
      {showLessonSheet && (
        <div onClick={() => setShowLessonSheet(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 180, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
          <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 430, background: C.card, borderRadius: "20px 20px 0 0", border: `1px solid ${C.border}`, padding: "0 0 32px", maxHeight: "80vh", display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "14px 0 0", display: "flex", justifyContent: "center" }}>
              <div style={{ width: 36, height: 4, borderRadius: RADIUS.full, background: "rgba(255,255,255,0.12)" }} />
            </div>
            <div style={{ padding: "12px 20px 10px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: `1px solid ${C.sep}`, flexShrink: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>{t("dashboard.todays_lesson")}</div>
              <button onClick={() => setShowLessonSheet(false)} aria-label={t("dashboard.close")} style={{ background: C.bgTertiary, border: `1px solid ${C.border}`, borderRadius: RADIUS.xs, width: 44, height: 44, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke={C.muted} strokeWidth={2.5} strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div style={{ overflowY: "auto", padding: "16px 20px" }}>
              {lessonAlreadyDoneToday && lessonStreak.current_streak > 0 && (
                <div style={{ fontSize: 12, fontWeight: 700, color: C.yellow, marginBottom: 12 }}>
                  🔥 {t("dashboard.todays_lesson_streak", { count: lessonStreak.current_streak })}
                </div>
              )}
              <div style={{ fontSize: 11, color: C.faint, fontWeight: 600, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 4 }}>{todaysLesson.category}</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: C.text, marginBottom: 12 }}>{todaysLesson.title}</div>
              {/* Lesson content (lessons.js) is English-only for v1 — see
                  BACKLOG.md for the full RU/ES/PT translation task. Honest
                  notice instead of silently showing English under a
                  non-English UI, same principle as every other "don't fake
                  it" call in this codebase. Suppressed when showing a
                  diagnosisLesson — daily-lesson-v2 generates it in the
                  user's actual app language (responseLang), so the notice
                  would be actively false there, not just unnecessary. */}
              {!diagnosisLesson && !i18n.language?.startsWith('en') && (
                <div style={{ fontSize: 12, color: C.muted, background: C.bgTertiary, border: `1px solid ${C.border}`, borderRadius: RADIUS.sm, padding: "8px 12px", marginBottom: 12 }}>
                  {t("dashboard.todays_lesson_english_only")}
                </div>
              )}
              {lessonPersonalizedNote && (
                <div style={{ fontSize: 13, color: C.cyan, background: C.bgTertiary, border: `1px solid ${C.border}`, borderRadius: RADIUS.sm, padding: "10px 12px", marginBottom: 14 }}>
                  {lessonPersonalizedNote}
                </div>
              )}
              {todaysLesson.body.map((p, i) => (
                <p key={i} style={{ fontSize: 14, color: C.text, lineHeight: 1.5, margin: "0 0 12px" }}>{p}</p>
              ))}
              <div style={{ fontSize: 12, color: C.muted, background: C.bgTertiary, border: `1px solid ${C.border}`, borderRadius: RADIUS.sm, padding: "10px 12px", marginTop: 4 }}>
                <span style={{ fontWeight: 700, color: C.text }}>{t("dashboard.todays_lesson_tip")}: </span>
                {todaysLesson.tip}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── "Other" breakdown sheet ── */}
      {otherBreakdown && (() => {
        const now = new Date();
        const otherTxs = transactions.filter(t => {
          const d = new Date(t.date);
          return t.type === 'expense'
            && t.category_name !== 'Transfer'
            && resolveCategory(t) === 'Other'
            && d.getMonth() === now.getMonth()
            && d.getFullYear() === now.getFullYear();
        });
        // Group by description, sum amounts
        const grouped = {};
        otherTxs.forEach(t => {
          const key = (t.description || 'Unknown').trim();
          if (!grouped[key]) grouped[key] = { name: key, total: 0, count: 0 };
          grouped[key].total += Number(t.amount);
          grouped[key].count++;
        });
        const rows = Object.values(grouped).sort((a, b) => b.total - a.total).slice(0, 10);
        const otherTotal = sumAmounts(otherTxs);

        return (
          <div onClick={() => setOtherBreakdown(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 180, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
            <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 430, background: C.card, borderRadius: '20px 20px 0 0', border: `1px solid ${C.border}`, padding: '0 0 32px', maxHeight: '75vh', display: 'flex', flexDirection: 'column' }}>
              {/* Handle */}
              <div style={{ padding: '14px 0 0', display: 'flex', justifyContent: 'center' }}>
                <div style={{ width: 36, height: 4, borderRadius: RADIUS.full, background: 'rgba(255,255,255,0.12)' }} />
              </div>
              {/* Header */}
              <div style={{ padding: '12px 20px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${C.sep}`, flexShrink: 0 }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>{t("dashboard.whats_in_other")}</div>
                  <div className="ph-mask" style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>${fmt(otherTotal, 0)} {t("dashboard.this_month")} · {t("dashboard.transaction", { count: otherTxs.length })}</div>
                </div>
                <button onClick={() => setOtherBreakdown(false)} aria-label={t("dashboard.close")} style={{ background: C.bgTertiary, border: `1px solid ${C.border}`, borderRadius: RADIUS.xs, width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                  <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke={C.muted} strokeWidth={2.5} strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
              {/* List */}
              <div style={{ overflowY: 'auto', flex: 1, padding: '8px 0' }}>
                {rows.length === 0
                  ? <div style={{ padding: '24px 20px', textAlign: 'center', color: C.faint, fontSize: 13 }}>{t("dashboard.no_uncategorized")}</div>
                  : rows.map((row, i) => {
                    const pct = otherTotal > 0 ? (row.total / otherTotal) * 100 : 0;
                    return (
                      <div key={row.name} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 20px', borderBottom: i < rows.length - 1 ? `1px solid ${C.sep}` : 'none' }}>
                        <div style={{ width: 34, height: 34, borderRadius: RADIUS.sm, background: CAT_COLORS.Other + '22', border: `1px solid ${CAT_COLORS.Other}33`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={CAT_COLORS.Other} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.name}</div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
                            <div style={{ height: 3, borderRadius: RADIUS.full, background: CAT_COLORS.Other + '40', flex: 1, overflow: 'hidden' }}>
                              <div style={{ height: '100%', width: `${pct}%`, background: CAT_COLORS.Other, borderRadius: RADIUS.full }} />
                            </div>
                            <span style={{ fontSize: 10, color: C.faint, flexShrink: 0 }}>{Math.round(pct)}%</span>
                          </div>
                        </div>
                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          <div className="ph-mask" style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{balanceVisible ? `$${fmt(row.total, 0)}` : '••••'}</div>
                          {row.count > 1 && <div style={{ fontSize: 10, color: C.faint }}>{row.count} txns</div>}
                        </div>
                      </div>
                    );
                  })
                }
              </div>
              {/* Footer CTA */}
              <div style={{ padding: '12px 20px 0', flexShrink: 0 }}>
                <button onClick={() => { setOtherBreakdown(false); onCatClick?.('Other'); }} style={{ width: '100%', padding: '12px 0', background: C.bgTertiary, border: `1px solid ${C.border}`, borderRadius: RADIUS.sm, color: C.muted, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: FONT }}>
                  {t("dashboard.view_all_transactions")}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

    </div>
  );
}

