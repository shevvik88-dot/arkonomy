import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { usePostHog } from "@posthog/react";
import { C, FONT, RADIUS } from "../utils/colors";
import { fmt, parseDate, tCat, cleanMerchantName, sumAmounts } from "../utils/helpers";
import Icon from "./shared/Icon";
import GlassCard from "./shared/GlassCard";
import { ConnectBankPrompt } from "./shared/ConnectBankPrompt";
import { calculateHealthScore, generateHealthComment, getScoreLabel } from "../healthScore";
import { IS_IOS_NATIVE } from "../lib/platform";
import { useUSStorefront } from "../lib/storefront";
import { computeRecurringSummary, findDuplicateSubscriptions, findMerchantAliasCandidates } from "../utils/recurringSummary";
import { isFeatureEnabled } from "../lib/featureFlags";

// Maps findDuplicateSubscriptions' category labels to i18n keys for the "Similar service" badge.
const DUPLICATE_CATEGORY_I18N_KEY = {
  'AI assistant':    'insights.category_ai_assistant',
  'Cloud storage':   'insights.category_cloud_storage',
  'Video streaming': 'insights.category_video_streaming',
  'Music streaming': 'insights.category_music_streaming',
  'Fitness':         'insights.category_fitness',
  'News & media':    'insights.category_news_media',
};

const FORECAST_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function formatForecastDate(date) { return FORECAST_MONTHS[date.getMonth()] + ' ' + date.getFullYear(); }
function computeGoalForecast(remaining, monthlySurplus, numGoals) {
  if (remaining <= 0) return { type: 'complete' };
  const rate = Math.max(monthlySurplus, 0) / Math.max(numGoals, 1);
  if (rate >= 5) {
    const months = Math.ceil(remaining / rate);
    const date = new Date();
    date.setMonth(date.getMonth() + months);
    return { type: 'on_track', date, months, monthlyRate: Math.round(rate) };
  }
  const horizonMonths = 12;
  const needed = Math.ceil(remaining / horizonMonths);
  const targetDate = new Date();
  targetDate.setMonth(targetDate.getMonth() + horizonMonths);
  return { type: 'off_track', shortfall: Math.max(needed - Math.round(Math.max(rate, 0)), needed), targetDate };
}

// ── highlightNumbers ─────────────────────────────────────────────────────────
// Splits a string on $amounts and X% percentages and wraps them in bold
// colored spans: explicit negative (−$X / −X%) → red, positive → green,
// unsigned → accent color passed in (falls back to white).
function highlightNumbers(text, accentColor = "#FFFFFF") {
  if (!text) return text;
  const parts = String(text).split(/([-+]?\$[\d,]+(?:\.\d+)?|[-+]?\d+(?:\.\d+)?%)/g);
  return parts.map((part, i) => {
    if (!/^[-+]?\$|[-+]?\d.*%$/.test(part) || !/\d/.test(part)) return part;
    const isNeg = part.startsWith("-");
    const isPos = part.startsWith("+");
    const color = isNeg ? "#FF5C7A" : isPos ? "#12D18E" : accentColor;
    return (
      <span key={i} className="ph-mask" style={{ color, fontWeight: 700, fontSize: "1.05em" }}>{part}</span>
    );
  });
}

// Санитизация AI текста — убираем misleading фразы глобально
function sanitizeAiBody(text) {
  return (text || "")
    // Savings full gap — заменяем на безопасную формулировку
    .replace(/You can cover the full gap[^.]*\./gi,
      "You can cover the full gap using your available balance.\n→ A safer contribution is $200–$400 to keep your buffer stable.\n→ Larger deposits are possible, but may reduce your safety cushion.")
    // Слабые слова
    .replace(/appears to be a one-time event/gi, "is a one-time expense")
    .replace(/appears to be/gi, "is")
    .replace(/\bappears\b/gi, "is")
    .replace(/\blikely\b\s*/gi, "")
    .replace(/unless it does\./gi, "Monitor next month to confirm stability.")
    .replace(/unless it does/gi, "")
    .replace(/no action needed\./gi, "No changes needed now, but monitor next month to confirm stability.")
    .replace(/no action needed/gi, "No changes needed now — monitor next month to confirm stability")
    // Unsafe savings claims
    .replace(/You can safely move \$?([\d,]+)/gi, (_, n) => `You can move up to $${n}, but a safer amount is $200–$400 to keep your buffer stable`)
    .replace(/safely move/gi, "move")
    // Unsafe "Add $X now" когда X вне диапазона $200–$400 и баланс позволяет
    .replace(/Add \$?([\d,]+)\s*now/gi, (match, n) => {
      const num = Number(n.replace(/,/g, ""));
      // Оставляем суммы в диапазоне $50–$400 как есть, заменяем только >$400
      return num > 400 ? `Add $200–$400 safely` : match;
    })
    .replace(/  +/g, " ")
    .trim();
}

// ─── AI Brain: InsightCard ────────────────────────────────────

const INSIGHT_CONFIG = {
  cash_risk: {
    bg: "rgba(255,92,122,0.04)",
    border: "#FF5C7A",
    accent: "#FF5C7A",
    label: "AI Insight",
    Icon: ({ color }) => (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
        <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
      </svg>
    ),
  },
  category_spike: {
    bg: "rgba(255,184,0,0.04)",
    border: "#FFB800",
    accent: "#FFB800",
    label: "AI Insight",
    Icon: ({ color }) => (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>
        <polyline points="17 6 23 6 23 12"/>
      </svg>
    ),
  },
  overspending: {
    bg: "rgba(255,184,0,0.04)",
    border: "#FFB800",
    accent: "#FFB800",
    label: "AI Insight",
    Icon: ({ color }) => (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <line x1="12" y1="8" x2="12" y2="12"/>
        <line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
    ),
  },
  savings_opportunity: {
  bg: "rgba(18,209,142,0.04)",
  border: "#12D18E",
  accent: "#12D18E",
  label: "AI Insight",
  Icon: ({ color }) => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>
      <polyline points="17 6 23 6 23 12"/>
    </svg>
  ),
},
  goal_off_track: {
    bg: "rgba(167,139,250,0.04)",
    border: "#A78BFA",
    accent: "#A78BFA",
    label: "AI Insight",
    Icon: ({ color }) => (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <circle cx="12" cy="12" r="6"/>
        <circle cx="12" cy="12" r="2"/>
      </svg>
    ),
  },
  positive_progress: {
    bg: "rgba(0,194,255,0.04)",
    border: "#00C2FF",
    accent: "#00C2FF",
    label: "AI Insight",
    Icon: ({ color }) => (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
        <polyline points="22 4 12 14.01 9 11.01"/>
      </svg>
    ),
  },
};

function getSmartCta(insight, t) {
  if (!insight) return t("insights.cta_view_transactions");
  const { type, data } = insight;
  switch (type) {
    case "category_spike":      return data?.categoryName ? t("insights.cta_review_category", { category: tCat(data.categoryName, t) }) : t("insights.cta_view_transactions");
    case "overspending":        return t("insights.cta_view_transactions");
    case "cash_risk":           return t("insights.cta_review_recurring");
    case "savings_opportunity": return t("insights.cta_view_savings");
    case "goal_off_track":      return t("insights.cta_view_savings");
    case "positive_progress":   return t("insights.cta_improve_score");
    default:                    return t("insights.cta_view_transactions");
  }
}

// ─── InsightCardGroup: только один insight expanded за раз ───
function InsightCardGroup({ insights, onAction }) {
  // Первый insight открыт по умолчанию (top priority)
  const [expandedIdx, setExpandedIdx] = useState(0);

  return (
    <div>
      {insights.map((ins, i) => (
        <InsightCard
          key={ins.type + i}
          insight={ins}
          expanded={expandedIdx === i}
          onToggle={() => setExpandedIdx(expandedIdx === i ? -1 : i)}
          onAction={onAction}
        />
      ))}
    </div>
  );
}

// expanded/onToggle are optional — pass both for controlled mode (e.g. InsightCardGroup's
// "only one open at a time"), omit both to let the card manage its own expand state.
export function InsightCard({ insight, onAction, expanded: expandedProp, onToggle }) {
  const { t, i18n } = useTranslation();
  const [expandedState, setExpandedState] = useState(false);
  const isControlled = expandedProp !== undefined;
  const expanded = isControlled ? expandedProp : expandedState;
  const toggle   = isControlled ? onToggle : () => setExpandedState(e => !e);

  if (!insight) return null;

  const cfg = INSIGHT_CONFIG[insight.type] ?? INSIGHT_CONFIG.overspending;
  const { headline, body: rawBody, action, range, breakdown: rawBreakdown, roundUpPrompt } = insight.rendered;
  const body = sanitizeAiBody(rawBody);
  const { accent, border, bg, label } = cfg;

  // Принудительно ограничиваем suggestedSave — никогда больше $400 (safe лимит)
  const SAFE_CAP = 400;
  const breakdown = rawBreakdown ? {
    ...rawBreakdown,
    suggestedSave: rawBreakdown.suggestedSave > SAFE_CAP ? SAFE_CAP : rawBreakdown.suggestedSave
  } : rawBreakdown;

  const cleanHeadline = (headline || "").replace(/~\$/, "$").trim();

  const isSavings = insight.type === "savings_opportunity";
  const isGoalOffTrack = insight.type === "goal_off_track";
  const goalContribution = isGoalOffTrack
    ? Number(insight.rendered?.contribution?.recommended ?? 0)
    : null;

  // Strict guard: hide CTA button when amount would be $0
  const showCtaButton = (() => {
    if (isSavings) return Number(breakdown?.suggestedSave) > 0;
    if (isGoalOffTrack) return goalContribution > 0;
    return true;
  })();


  return (
    <div
      onClick={toggle}
      style={{
        background: bg,
        border: `1px solid ${border}22`,
        borderRadius: RADIUS.md,
        padding: "12px 16px",
        marginBottom: 10,
        cursor: "pointer",
        fontFamily: FONT,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <div style={{ flexShrink: 0, marginTop: 2 }}>
          <cfg.Icon color={accent} />
        </div>
        <div style={{
          flex: 1, minWidth: 0,
          fontSize: 14, fontWeight: 700, color: "#FFFFFF",
          letterSpacing: -0.2, lineHeight: 1.35,
        }}>
          {highlightNumbers(cleanHeadline, accent)}
        </div>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={C.faint} strokeWidth="2.5" strokeLinecap="round" style={{ flexShrink: 0, marginTop: 3 }}>
          {expanded
            ? <polyline points="18 15 12 9 6 15"/>
            : <polyline points="6 9 12 15 18 9"/>
          }
        </svg>
      </div>

      {expanded && (
        <div style={{ marginTop: 12, borderTop: `1px solid ${border}14`, paddingTop: 12 }}>

          {/* goal_off_track: mini goal card instead of plain text */}
          {isGoalOffTrack ? (() => {
            const goalCurrent  = Number(insight.data?.monthlyActual ?? 0);
            const goalTarget   = Number(insight.data?.monthlyTarget ?? 0);
            const shortfallAmt = Number(insight.data?.shortfall ?? Math.max(goalTarget - goalCurrent, 0));
            const pct          = goalTarget > 0 ? Math.min((goalCurrent / goalTarget) * 100, 100) : 0;
            const monthlyRate  = goalTarget > 0 ? Math.ceil(shortfallAmt / 12) : 0;
            const targetDate   = (() => {
              const d = new Date();
              d.setMonth(d.getMonth() + 12);
              return d.toLocaleDateString(i18n.language || "en-US", { month: "short", year: "numeric" });
            })();
            return (
              <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: RADIUS.sm, padding: "12px 14px", marginBottom: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>{insight.data?.goalName || t("insights.goal_fallback_name")}</span>
                  <span style={{ fontSize: 12, color: accent, fontWeight: 600 }}>{pct.toFixed(0)}%</span>
                </div>
                <div style={{ height: 6, background: "rgba(255,255,255,0.08)", borderRadius: RADIUS.full, marginBottom: 6, overflow: "hidden", position: "relative" }}>
                  {pct === 0 && (
                    <div style={{ position: "absolute", inset: 0, borderRadius: RADIUS.full, background: `repeating-linear-gradient(90deg, ${accent}30 0px, ${accent}30 4px, transparent 4px, transparent 8px)` }} />
                  )}
                  {pct > 0 && (
                    <div style={{ height: "100%", width: `${pct}%`, background: `linear-gradient(90deg, ${accent}BB, ${accent})`, borderRadius: RADIUS.full }} />
                  )}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: C.muted + "99", marginBottom: 10 }}>
                  <span>${goalCurrent.toLocaleString("en-US", { maximumFractionDigits: 0 })} {t("insights.goal_saved")}</span>
                  <span>${goalTarget.toLocaleString("en-US", { maximumFractionDigits: 0 })} {t("insights.goal_label")}</span>
                </div>
                {monthlyRate > 0 && (
                  <div style={{ fontSize: 12, color: accent, fontWeight: 600 }}>
                    {t("insights.start_saving_mo", { amount: monthlyRate.toLocaleString("en-US", { maximumFractionDigits: 0 }), date: targetDate })}
                  </div>
                )}
              </div>
            );
          })() : (
            <p style={{ color: C.muted + "D9", fontSize: 13, lineHeight: 1.6, margin: "0 0 12px" }}>
              {highlightNumbers(body, accent)}
            </p>
          )}

          {isSavings && breakdown && (
            <div style={{
              background: "rgba(255,255,255,0.04)",
              borderRadius: RADIUS.sm,
              padding: "10px 12px",
              marginBottom: 14,
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 12, color: C.muted + "B3", minWidth: 110 }}>{t("insights.available")}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: "#FFFFFF" }}>
                  ${Number(breakdown.available || 0).toLocaleString("en-US", { maximumFractionDigits: 0 })}
                </span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <span style={{ fontSize: 12, color: C.muted + "B3", display: "block", paddingTop: 1 }}>{t("insights.safe_to_move")}</span>
                  <span style={{ fontSize: 11, color: C.muted + "99", display: "block", marginTop: 3, paddingLeft: 2 }}>
                    {t("insights.keeps_buffer", { amount: Number(breakdown.bufferAmount || 1000).toLocaleString("en-US", { maximumFractionDigits: 0 }) })}
                  </span>
                </div>
                <span style={{ fontSize: 13, fontWeight: 600, color: accent, paddingTop: 1 }}>
                  ${Number(breakdown.suggestedSave || 0).toLocaleString("en-US", { maximumFractionDigits: 0 })}
                </span>
              </div>
            </div>
          )}

          {/* Hide CTA when amount is 0 or missing */}
          {showCtaButton && (
            <button
              onClick={e => { e.stopPropagation(); onAction?.(action, insight.data); }}
              onPointerDown={e => { e.currentTarget.style.transform = "scale(0.98)"; e.currentTarget.style.boxShadow = `0 2px 10px ${accent}22`; }}
              onPointerUp={e => { const el = e.currentTarget; el.style.transform = "scale(1.03)"; el.style.boxShadow = `0 6px 24px ${accent}44`; setTimeout(() => { el.style.transform = "scale(1)"; el.style.boxShadow = `0 4px 20px ${accent}32`; }, 150); }}
              onPointerLeave={e => { e.currentTarget.style.transform = "scale(1)"; e.currentTarget.style.boxShadow = `0 4px 20px ${accent}32`; }}
              style={{
                width: "100%", padding: "13px 16px",
                background: accent, border: "none", borderRadius: RADIUS.sm,
                color: insight.type === "savings_opportunity" ? "#061A10" : "#fff",
                fontWeight: 800, fontSize: 15, cursor: "pointer",
                fontFamily: FONT,
                letterSpacing: -0.3,
                boxShadow: `0 4px 20px ${accent}32`,
                transition: "transform 0.12s ease, box-shadow 0.12s ease",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              }}
            >
              {isSavings && Number(breakdown?.suggestedSave) > 0
                ? <>
                    {t("insights.add_amount_safely", { amount: Number(breakdown.suggestedSave).toLocaleString("en-US", { maximumFractionDigits: 0 }) })}
                    <span style={{ fontSize: 10, fontWeight: 600, background: "rgba(0,0,0,0.15)", borderRadius: RADIUS.lg, padding: "2px 8px", whiteSpace: "nowrap" }}>
                      {t("insights.recommended_safe")}
                    </span>
                  </>
                : getSmartCta(insight, t)
              }
            </button>
          )}

          {/* Max amount secondary CTA — только для savings если было обрезано */}
          {isSavings && Number(rawBreakdown?.suggestedSave) > 0 && Number(rawBreakdown.suggestedSave) > SAFE_CAP && (
            <button
              onClick={e => { e.stopPropagation(); onAction?.(action, { ...insight.data, _useMax: true }); }}
              style={{ width: "100%", marginTop: 6, padding: "9px 16px", background: "transparent", border: `1px solid ${accent}33`, borderRadius: RADIUS.sm, color: accent, fontWeight: 500, fontSize: 12, cursor: "pointer", fontFamily: FONT, opacity: 0.7 }}
            >
              {t("insights.add_amount_max", { amount: Number(rawBreakdown.suggestedSave).toLocaleString("en-US", { maximumFractionDigits: 0 }) })}
            </button>
          )}

          {range && (
            <div style={{
              textAlign: "center", marginTop: 7, fontSize: 11,
              color: C.muted + "99", letterSpacing: 0.1,
            }}>
              {range.replace("Suggested range:", "Safe range:").replace("Flexible:", "Safe range:")}
            </div>
          )}

          {isSavings && insight.data?.roundUpMonthly > 0 && (
            <button
              onClick={e => { e.stopPropagation(); onAction?.("invest_alpaca", insight.data); }}
              style={{
                width: "100%", marginTop: 8, padding: "11px 16px",
                background: C.roundupAccentBg,
                border: `1px solid ${C.roundupAccentBorder}`,
                borderRadius: RADIUS.sm, color: C.roundupAccent,
                fontWeight: 600, fontSize: 13,
                cursor: "pointer", fontFamily: FONT,
                letterSpacing: -0.1,
                display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                transition: "background 0.15s",
              }}
              onPointerEnter={e => { e.currentTarget.style.background = C.roundupAccentBgHover; }}
              onPointerLeave={e => { e.currentTarget.style.background = C.roundupAccentBg; }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
              </svg>
              {t("insights.invest_spare_change", { amount: Math.floor(insight.data.roundUpMonthly) })}
            </button>
          )}

          {isSavings && roundUpPrompt && !(insight.data?.roundUpMonthly > 0) && (
            <div style={{
              marginTop: 6, textAlign: "center", fontSize: 12,
              color: C.muted + "CC", letterSpacing: 0.1, cursor: "pointer",
            }}>
              {t("insights.automate_roundups")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function HealthScore({ score, color, breakdown: rawBreakdown, comment, totalSpent = 0, budget = 3000, hasData = true, prevScore, cashPositionLow = false }) {
  const { t } = useTranslation();
  const [showBreakdown, setShowBreakdown] = useState(false);

  const label = getScoreLabel(score);
  const circumference = 2 * Math.PI * 28;
  const dash = (score / 100) * circumference;

  // Map the shared calculateHealthScore breakdown → display rows
  const breakdown = [
    {
      label: t("insights.savings_rate_label"),
      score: rawBreakdown.savings.points,
      max: 30,
      color: C.cyan,
      desc: rawBreakdown.savings.rate >= 0.2
        ? t("insights.on_target")
        : t("insights.currently_pct", { pct: Math.round(rawBreakdown.savings.rate * 100) }),
    },
    {
      label: t("insights.budget_adherence"),
      score: rawBreakdown.budget.points,
      max: 25,
      color: C.blue,
      desc: rawBreakdown.budget.points >= 20 ? t("insights.within_budget") : t("dashboard.over_budget"),
    },
    {
      label: t("insights.recurring_charges"),
      score: rawBreakdown.recurring.points,
      max: 20,
      color: C.purple,
      desc: rawBreakdown.recurring.ratio < 0.1
        ? t("insights.less_than_10pct")
        : t("dashboard.pct_income", { pct: Math.round(rawBreakdown.recurring.ratio * 100) }),
    },
    {
      label: t("insights.balance_trend"),
      score: rawBreakdown.trend.points,
      max: 25,
      color: C.yellow,
      desc: rawBreakdown.trend.thisBalance >= rawBreakdown.trend.lastBalance
        ? t("insights.improving")
        : t("insights.down"),
    },
  ];

  if (!hasData) {
    return (
      <GlassCard>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ position: "relative", width: 72, height: 72, flexShrink: 0 }}>
            <svg width={72} height={72}>
              <circle cx={36} cy={36} r={28} fill="none" stroke={C.bgTertiary} strokeWidth={6} />
            </svg>
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: C.faint, textAlign: "center", lineHeight: 1.3 }}>—</div>
            </div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, color: C.faint, fontWeight: 600, letterSpacing: 1, marginBottom: 4 }}>{t("insights.financial_health")}</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: C.muted, marginBottom: 4 }}>{t("insights.no_data")}</div>
            <div style={{ fontSize: 12, color: C.faint, lineHeight: 1.5 }}>{t("insights.no_data_body")}</div>
          </div>
        </div>
      </GlassCard>
    );
  }

  const budgetUsedPct = budget > 0 ? Math.round((totalSpent / budget) * 100) : 0;

  return (
    <GlassCard>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }} onClick={() => setShowBreakdown(v => !v)} >
        <div style={{ position: "relative", width: 72, height: 72, flexShrink: 0, cursor: "pointer" }}>
          <svg width={72} height={72} style={{ filter: `drop-shadow(0 0 8px ${color}55)` }}>
            <circle cx={36} cy={36} r={28} fill="none" stroke={C.bgTertiary} strokeWidth={6} />
            <circle cx={36} cy={36} r={28} fill="none" stroke={color} strokeWidth={6}
              strokeDasharray={`${dash} ${circumference}`} strokeLinecap="round"
              transform="rotate(-90 36 36)" style={{ transition: "stroke-dasharray 1s ease" }} />
          </svg>
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
            <div style={{ fontSize: 18, fontWeight: 800, color, lineHeight: 1 }}>{score}</div>
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 10, color: C.faint, fontWeight: 600, letterSpacing: 1, marginBottom: 4 }}>{t("insights.financial_health")}</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: C.text, marginBottom: 4 }}>
            {t(label)}{" "}
            <span style={{ color, fontSize: 13 }}>{score}/100</span>
            {prevScore != null && prevScore !== score && (
              <span style={{ fontSize: 12, fontWeight: 700, color: score > prevScore ? C.green : C.red, marginLeft: 6 }}>
                {score > prevScore ? `↑${score - prevScore}` : `↓${prevScore - score}`}
              </span>
            )}
          </div>
          {cashPositionLow && (
            <div style={{ fontSize: 11, color: C.yellow, fontWeight: 600, marginBottom: 2 }}>{t("health.cash_position_low")}</div>
          )}
          <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.5 }}>
            {comment ? (comment.rawCat ? t(comment.key, { cat: tCat(comment.rawCat, t), ...comment.params }) : t(comment.key)) : (score >= 75 ? t("insights.score_great") : score >= 50 ? t("insights.score_decent") : t("insights.score_focus"))}
          </div>
          <div style={{ fontSize: 11, color: C.faint, marginTop: 4 }}>{t("insights.tap_breakdown")}</div>
        </div>
      </div>

      {showBreakdown && (
        <div style={{ marginTop: 14, borderTop: `1px solid ${C.sep}`, paddingTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
          {breakdown.map(item => (
            <div key={item.label}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ fontSize: 12, color: C.muted }}>{item.label}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: item.color }}>{item.score}/{item.max} pts · {item.desc}</span>
              </div>
              <div style={{ height: 4, background: C.bgTertiary, borderRadius: RADIUS.full }}>
                <div style={{ height: 4, borderRadius: RADIUS.full, width: `${(item.score / item.max) * 100}%`, background: item.color, transition: "width 0.6s" }} />
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        {(() => {
          const rawRate = Math.round(rawBreakdown.savings.rate * 100);
          const isDeepDeficit = rawRate < -100;
          const savingsDisplay = isDeepDeficit ? null : rawRate; // null → custom label
          const savingsColor = rawRate < 0 ? C.red : rawRate < 10 ? C.yellow : C.cyan;
          return [
            { label: t("insights.savings_rate"), value: savingsDisplay, display: isDeepDeficit ? t("dashboard.deficit") : null, color: savingsColor },
            { label: t("insights.budget_used"), value: budgetUsedPct, color: budgetUsedPct > 100 ? C.red : budgetUsedPct > 70 ? C.yellow : C.cyan },
            { label: t("insights.recurring_label"), value: Math.min(99, Math.round(rawBreakdown.recurring.ratio * 100)), color: rawBreakdown.recurring.ratio > 0.25 ? C.red : rawBreakdown.recurring.ratio > 0.1 ? C.yellow : C.purple },
          ];
        })().map(item => (
          <div key={item.label} style={{ flex: 1, background: C.bgTertiary, borderRadius: RADIUS.sm, padding: "10px 8px", textAlign: "center" }}>
            <div style={{ fontSize: item.display ? 11 : 16, fontWeight: 700, color: item.color }}>{item.display ?? (item.value === null ? "N/A" : item.value + "%")}</div>
            <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>{item.label}</div>
          </div>
        ))}
      </div>
    </GlassCard>
  );
}

function WeeklySummary({ transactions }) {
  const { t } = useTranslation();
  const now = new Date();
  const todayIdx = (now.getDay() + 6) % 7; // Mon=0 … Sun=6
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - todayIdx);
  startOfWeek.setHours(0, 0, 0, 0);
  const startOfLastWeek = new Date(startOfWeek);
  startOfLastWeek.setDate(startOfWeek.getDate() - 7);

  // Daily totals Mon–Sun
  const dailyTotals = Array(7).fill(0);
  const thisWeekTxs = transactions.filter(t =>
    t.type === "expense" && t.category_name !== "Transfer" && parseDate(t.date) >= startOfWeek
  );
  thisWeekTxs.forEach(t => {
    const d = parseDate(t.date);
    const idx = Math.round((d - startOfWeek) / 86400000);
    if (idx >= 0 && idx < 7) dailyTotals[idx] += Math.abs(Number(t.amount) || 0);
  });

  const thisWeek = dailyTotals.reduce((s, v) => s + v, 0);
  if (thisWeek === 0) return null;

  const lastWeek = sumAmounts(
    transactions.filter(t => t.type === "expense" && t.category_name !== "Transfer" && parseDate(t.date) >= startOfLastWeek && parseDate(t.date) < startOfWeek)
  );

  const change = lastWeek > 0 ? ((thisWeek - lastWeek) / lastWeek) * 100 : null;
  const pos = change !== null && change <= 0;

  const maxDay = Math.max(...dailyTotals, 1);
  const DAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];
  const DAY_SHORT = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const todayLabel = t("day." + DAY_SHORT[todayIdx]);

  // Top category
  const catMap = {};
  thisWeekTxs.forEach(t => { const k = t.category_name || "Other"; catMap[k] = (catMap[k] || 0) + Number(t.amount); });
  const topCat = Object.entries(catMap).sort((a, b) => b[1] - a[1])[0];

  return (
    <GlassCard style={{ background: `linear-gradient(135deg,${C.blue}10,${C.card})`, border: `1px solid ${C.blue}30` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <div style={{ width: 32, height: 32, borderRadius: RADIUS.sm, background: C.blue + "22", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icon name="calendar" size={15} color={C.blue} />
        </div>
        <span style={{ fontWeight: 600, fontSize: 14, color: C.blue }}>{t("insights.this_week")}</span>
        {change !== null && (
          <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 600, color: pos ? C.green : C.red }}>
            {pos ? "↓" : "↑"}{Math.abs(change).toFixed(0)}% {t("insights.vs_last_week")}
          </span>
        )}
      </div>

      {/* Mon–Sun daily bars */}
      <div style={{ display: "flex", gap: 5, alignItems: "flex-end", height: 52, marginBottom: 10 }}>
        {dailyTotals.map((amt, i) => {
          const isToday = i === todayIdx;
          const isFuture = i > todayIdx;
          const barH = isFuture ? 0 : Math.max(amt > 0 ? 5 : 0, Math.round((amt / maxDay) * 42));
          return (
            <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
              <div style={{ flex: 1, width: "100%", display: "flex", alignItems: "flex-end" }}>
                <div style={{
                  width: "100%", height: barH,
                  background: isToday ? C.blue : C.blue + "55",
                  borderRadius: 3,
                  opacity: isFuture ? 0.12 : 1,
                  transition: "height 0.4s",
                }} />
              </div>
              <div style={{ fontSize: 10, color: isToday ? C.blue : C.faint, fontWeight: isToday ? 700 : 400 }}>
                {DAY_LABELS[i]}
              </div>
            </div>
          );
        })}
      </div>

      <div className="ph-mask" style={{ fontSize: 22, fontWeight: 800, color: C.text, marginBottom: 3 }}>${fmt(thisWeek)}</div>
      <div style={{ fontSize: 12, color: C.muted }}>
        {t("insights.week_start")}–{todayLabel}{topCat ? t("insights.mostly_cat", { cat: tCat(topCat[0], t) }) : ""}
      </div>
    </GlassCard>
  );
}

// Brand color + letter for subscription avatars
const BRAND_STYLES = {
  'claude':      { color: '#CC785C' }, 'anthropic':  { color: '#CC785C' },
  'openai':      { color: '#00A67E' }, 'chatgpt':    { color: '#00A67E' },
  'microsoft':   { color: '#00A4EF' }, 'office 365': { color: '#D83B01' },
  'apple':       { color: '#6E6E6E' }, 'icloud':     { color: '#3478F6' },
  'lemonade':    { color: '#FF0083' }, 'robinhood':  { color: '#00C805' },
  'rocket':      { color: '#F5490A' }, 'netflix':    { color: '#E50914' },
  'spotify':     { color: '#1DB954' }, 'hulu':       { color: '#1CE783' },
  'disney':      { color: '#113CCF' }, 'amazon':     { color: '#FF9900' },
  'hbo':         { color: '#651FFF' }, 'youtube':    { color: '#FF0000' },
  'google':      { color: '#4285F4' }, 'dropbox':    { color: '#0061FE' },
  'slack':       { color: '#4A154B' }, 'zoom':       { color: '#2D8CFF' },
  'github':      { color: '#24292E' }, 'adobe':      { color: '#FF0000' },
  'notion':      { color: '#37352F' }, 'figma':      { color: '#F24E1E' },
  'canva':       { color: '#00C4CC' }, 'nordvpn':    { color: '#4687FF' },
  'siriusxm':    { color: '#1B54BA' }, 'peacock':    { color: '#000000' },
  'paramount':   { color: '#0064FF' }, 'turbotax':   { color: '#1A6CD6' },
  'turbotenant': { color: '#12D18E' }, 'geico':      { color: '#00A74A' },
  'progressive': { color: '#0093D0' }, 'duolingo':   { color: '#58CC02' },
  'youtalk':     { color: '#6366F1' }, 'headspace':  { color: '#F47D31' },
  'calm':        { color: '#4A90D9' }, 'peloton':    { color: '#E31837' },
  'planet fitness': { color: '#6600CC' }, 'la fitness': { color: '#0063A5' },
  'crunchyroll': { color: '#F47521' }, 'tidal':      { color: '#000000' },
  'pandora':     { color: '#005483' }, 'audible':    { color: '#F8991C' },
  'golden one':      { color: '#4CAF50' },
  'atlanta postal':  { color: '#2196F3' },
};
const BRAND_DOMAINS = {
  // Streaming & subscriptions
  'netflix':    'netflix.com',       'spotify':    'spotify.com',
  'hulu':       'hulu.com',          'disney':     'disneyplus.com',
  'amazon':     'amazon.com',        'hbo':        'hbomax.com',
  'youtube':    'youtube.com',       'apple':      'apple.com',
  'icloud':     'icloud.com',        'google':     'google.com',
  'dropbox':    'dropbox.com',       'slack':      'slack.com',
  'zoom':       'zoom.us',           'github':     'github.com',
  'adobe':      'adobe.com',         'notion':     'notion.so',
  'figma':      'figma.com',         'canva':      'canva.com',
  'nordvpn':    'nordvpn.com',       'siriusxm':   'siriusxm.com',
  'peacock':    'peacocktv.com',     'paramount':  'paramountplus.com',
  'turbotax':   'turbotax.com',      'duolingo':   'duolingo.com',
  'headspace':  'headspace.com',     'calm':       'calm.com',
  'peloton':    'peloton.com',       'crunchyroll': 'crunchyroll.com',
  'tidal':      'tidal.com',         'pandora':    'pandora.com',
  'audible':    'audible.com',       'openai':     'openai.com',
  'chatgpt':    'chat.openai.com',   'claude':     'claude.ai',
  'microsoft':  'microsoft.com',
  'robinhood':  'robinhood.com',     'rocket':     'rocketmortgage.com',
  'turbotenant':'turbotenant.com',
  'planet fitness': 'planetfitness.com',
  'la fitness': 'lafitness.com',
  // Telecom & internet
  'verizon':    'verizon.com',       'comcast':    'comcast.com',
  'xfinity':    'xfinity.com',       'spectrum':   'spectrum.net',
  't-mobile':   't-mobile.com',      'tmobile':    't-mobile.com',
  'at&t':       'att.com',           'att ':       'att.com',
  'cox ':       'cox.com',           'frontier':   'frontier.com',
  'centurylink':'centurylink.com',   'boost':      'boostmobile.com',
  'cricket':    'cricketwireless.com','visible':    'visible.com',
  // Utilities
  'pg&e':       'pge.com',           'pge':        'pge.com',
  'con edison': 'coned.com',         'coned':      'coned.com',
  'duke energy':'duke-energy.com',   'dominion':   'dominionenergy.com',
  'national grid':'nationalgrid.com','xcel':       'xcelenergy.com',
  'eversource': 'eversource.com',    'dte':        'dteenergy.com',
  'consumers energy':'consumersenergy.com',
  'southern company':'southerncompany.com',
  'entergy':    'entergy.com',       'pseg':       'pseg.com',
  // Insurance
  'geico':      'geico.com',         'progressive':'progressive.com',
  'state farm': 'statefarm.com',     'allstate':   'allstate.com',
  'liberty mutual':'libertymutual.com','nationwide':'nationwide.com',
  'travelers':  'travelers.com',     'usaa':       'usaa.com',
  'aaa ':       'aaa.com',           'lemonade':   'lemonade.com',
  'farmers':    'farmers.com',       'metlife':    'metlife.com',
  'cigna':      'cigna.com',         'aetna':      'aetna.com',
  'humana':     'humana.com',        'blue cross': 'bcbs.com',
  // Credit unions & banks
  'golden one':     'goldenonecu.org',
  'atlanta postal': 'apcu.org',
  'navy federal':   'navyfederal.org',
  'penfed':         'penfed.org',
  'pentagon federal':'penfed.org',
  'patelco':        'patelco.org',
  'alliant':        'alliantcreditunion.com',
  'first tech':     'firsttechfed.com',
  'suncoast':       'suncoastcreditunion.com',
  'desert financial':'desertfinancial.com',
};
function getBrandStyle(name) {
  const lower = (name || '').toLowerCase();
  for (const [kw, style] of Object.entries(BRAND_STYLES)) {
    if (lower.includes(kw)) return { ...style, letter: kw[0].toUpperCase() };
  }
  return { color: '#475569', letter: (name || '?').trim()[0].toUpperCase() };
}
// Merchants that always render a letter avatar, no favicon attempt
const LETTER_AVATAR_ONLY = new Set(['golden one', 'atlanta postal']);

function MerchantFavicon({ name, color, letter }) {
  const lower = (name || '').toLowerCase();
  // Only try favicon if we have an explicitly known domain — never use auto-generated
  // guesses, since DuckDuckGo returns a generic arrow icon for unknown domains instead of 404.
  const knownDomain = useMemo(() => {
    if ([...LETTER_AVATAR_ONLY].some(kw => lower.includes(kw))) return null;
    const entry = Object.entries(BRAND_DOMAINS).find(([kw]) => lower.includes(kw));
    return entry ? entry[1] : null;
  }, [lower]);

  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => { setLoaded(false); setFailed(false); }, [name]);

  const showImg = knownDomain && !failed;
  return (
    <>
      {showImg && (
        <img
          key={knownDomain}
          src={`https://icons.duckduckgo.com/ip3/${knownDomain}.ico`}
          alt="" width={20} height={20}
          style={{ display: loaded ? 'block' : 'none', objectFit: 'contain', position: 'absolute', borderRadius: 3 }}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
        />
      )}
      <div style={{
        position: 'absolute', inset: 0,
        display: (showImg && loaded) ? 'none' : 'flex',
        alignItems: 'center', justifyContent: 'center',
        background: color, borderRadius: RADIUS.xs,
        fontSize: 13, fontWeight: 800, color: '#fff', fontFamily: FONT, letterSpacing: -0.3,
      }}>
        {letter}
      </div>
    </>
  );
}

function RecurringSummary({ transactions, onOpenChat, merchantAliasMap, merchantAliases, onDecideMerchantAlias }) {
  const tRec = useTranslation().t;
  const posthog = usePostHog();
  const { subscriptions, regularPayments, subTotal, regularTotal, possiblyCancelled } = computeRecurringSummary(transactions, new Date(), merchantAliasMap);
  const aliasCandidates = findMerchantAliasCandidates(transactions, merchantAliases || []);
  // Example flag usage: kill-switch for the "ask about subscription" icon.
  // defaultValue true — same as before this flag existed — so nothing changes
  // in prod until a flag with this key is created and turned off.
  const askAboutSubscriptionEnabled = isFeatureEnabled('insights-ask-about-subscription', true);

  if (subscriptions.length === 0 && regularPayments.length === 0 && possiblyCancelled.length === 0 && aliasCandidates.length === 0) return null;

  const duplicateCategoryByName = new Map();
  findDuplicateSubscriptions(subscriptions).forEach(d => d.items.forEach(item => duplicateCategoryByName.set(item.name, d.category)));

  function SectionRec({ title, items, color, total, icon, showAskAction, duplicateCategoryByName }) {
    if (items.length === 0) return null;
    return (
      <GlassCard style={{ background: `linear-gradient(135deg,${color}0D,${C.card})`, border: `1px solid ${color}30` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: RADIUS.sm, background: color + "22", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name={icon} size={14} color={color} />
          </div>
          <span style={{ fontWeight: 600, fontSize: 14, color }}>{title}</span>
          <span className="ph-mask" style={{ marginLeft: "auto", fontSize: 14, fontWeight: 800, color }}>${fmt(total)}/mo</span>
        </div>
        {items.slice(0, 6).map((m, i) => {
          const brand = getBrandStyle(m.name);
          const displayName = cleanMerchantName(m.name) || m.name;
          const dupCategory = duplicateCategoryByName?.get(m.name);
          return (
            <div key={i} style={{ padding: "7px 0", borderTop: `1px solid ${C.sep}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 28, height: 28, borderRadius: RADIUS.xs, background: brand.color + "22", border: `1px solid ${brand.color}44`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, overflow: "hidden", position: "relative" }}>
                  <MerchantFavicon name={m.name} color={brand.color} letter={brand.letter} />
                </div>
                <span style={{ fontSize: 13, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{displayName}</span>
                <span style={{ fontSize: 12, color: C.muted, flexShrink: 0 }}>{m.months} mo · <span className="ph-mask" style={{ color, fontWeight: 600 }}>${fmt(m.avgMonthly)}/mo</span></span>
                {showAskAction && (
                  <button
                    onClick={() => { posthog?.capture('subscription_ai_inquiry_started'); onOpenChat?.(tRec("insights.ask_about_subscription", { merchant: displayName })); }}
                    aria-label={tRec("insights.ask_about_subscription", { merchant: displayName })}
                    style={{ background: "none", border: "none", cursor: "pointer", padding: 4, margin: "-4px -4px -4px 0", display: "flex", alignItems: "center", flexShrink: 0 }}
                  >
                    <Icon name="search" size={14} color={C.muted} />
                  </button>
                )}
              </div>
              {dupCategory && (
                <div style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: 38, marginTop: 3, fontSize: 11, color: C.muted }}>
                  <Icon name="info" size={11} color={C.muted} />
                  {tRec("insights.similar_service", { category: tRec(DUPLICATE_CATEGORY_I18N_KEY[dupCategory] || dupCategory) })}
                </div>
              )}
            </div>
          );
        })}
      </GlassCard>
    );
  }

  return (
    <>
      <SectionRec title={tRec("insights.subscriptions")}    items={subscriptions}   color={C.purple} total={subTotal}     icon="repeat" showAskAction={askAboutSubscriptionEnabled} duplicateCategoryByName={duplicateCategoryByName} />
      <SectionRec title={tRec("insights.regular_payments")} items={regularPayments} color={C.blue}   total={regularTotal} icon="file"   />
      {possiblyCancelled.length > 0 && (
        <GlassCard style={{ background: `linear-gradient(135deg,${C.yellow}0D,${C.card})`, border: `1px solid ${C.yellow}30` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: RADIUS.sm, background: C.yellow + "22", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Icon name="alert-circle" size={14} color={C.yellow} />
            </div>
            <span style={{ fontWeight: 600, fontSize: 14, color: C.yellow }}>{tRec("insights.possibly_cancelled")}</span>
          </div>
          {possiblyCancelled.slice(0, 6).map((m, i) => {
            const brand = getBrandStyle(m.name);
            const displayName = cleanMerchantName(m.name) || m.name;
            return (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderTop: `1px solid ${C.sep}` }}>
                <div style={{ width: 28, height: 28, borderRadius: RADIUS.xs, background: brand.color + "22", border: `1px solid ${brand.color}44`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, overflow: "hidden", position: "relative" }}>
                  <MerchantFavicon name={m.name} color={brand.color} letter={brand.letter} />
                </div>
                <span style={{ fontSize: 13, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{displayName}</span>
                <span className="ph-mask" style={{ fontSize: 12, color: C.muted, flexShrink: 0 }}>${fmt(m.avgMonthly)}/mo · {tRec("insights.last_charged_days_ago", { days: m.daysSinceLast })}</span>
              </div>
            );
          })}
        </GlassCard>
      )}
      {aliasCandidates.length > 0 && (
        <GlassCard style={{ background: `linear-gradient(135deg,${C.cyan}0D,${C.card})`, border: `1px solid ${C.cyan}30` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: RADIUS.sm, background: C.cyan + "22", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Icon name="refresh-cw" size={14} color={C.cyan} />
            </div>
            <span style={{ fontWeight: 600, fontSize: 14, color: C.cyan }}>{tRec("insights.same_payment_title")}</span>
          </div>
          {aliasCandidates.slice(0, 6).map((c, i) => {
            const olderName = cleanMerchantName(c.older.name) || c.older.name;
            const newerName = cleanMerchantName(c.newer.name) || c.newer.name;
            return (
              <div key={i} style={{ padding: "9px 0", borderTop: i > 0 ? `1px solid ${C.sep}` : "none" }}>
                <div className="ph-mask" style={{ fontSize: 13, color: C.text, marginBottom: 6 }}>
                  {olderName} (${fmt(c.older.amount)}/mo) &harr; {newerName} (${fmt(c.newer.amount)}/mo)
                </div>
                <div style={{ fontSize: 11, color: C.muted, marginBottom: 8 }}>{tRec("insights.same_payment_hint")}</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={() => onDecideMerchantAlias?.(c.older.key, c.newer.key, "confirmed")}
                    style={{ display: "flex", alignItems: "center", gap: 6, background: C.green + "22", border: `1px solid ${C.green}44`, borderRadius: RADIUS.xs, padding: "6px 10px", color: C.green, fontSize: 12, fontWeight: 600, cursor: "pointer" }}
                  >
                    <Icon name="check" size={13} color={C.green} />
                    {tRec("insights.same_payment_confirm")}
                  </button>
                  <button
                    onClick={() => onDecideMerchantAlias?.(c.older.key, c.newer.key, "rejected")}
                    style={{ display: "flex", alignItems: "center", gap: 6, background: "transparent", border: `1px solid ${C.sep}`, borderRadius: RADIUS.xs, padding: "6px 10px", color: C.muted, fontSize: 12, fontWeight: 600, cursor: "pointer" }}
                  >
                    <Icon name="x" size={13} color={C.muted} />
                    {tRec("insights.same_payment_reject")}
                  </button>
                </div>
              </div>
            );
          })}
        </GlassCard>
      )}
    </>
  );
}

export default function Insights({ totalSpent, totalIncome, lastSpent, lastIncome, spendingByCategory, prevSpendingByCategory, onOpenChat, transactions, savings, profile, allInsights, onInsightAction, isPro, onUpgrade, plaidBalance, merchantAliasMap, merchantAliases, onDecideMerchantAlias, bankConnected, onNavigate }) {
  const { t } = useTranslation();
  const isUSStorefront = useUSStorefront();
  const showRealUpgrade = !IS_IOS_NATIVE || isUSStorefront;
  const hasNoData = totalIncome === 0 && totalSpent === 0;

  if (hasNoData) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ marginBottom: 4 }}>
          <h2 style={{ margin: "0 0 4px", fontSize: 22, fontWeight: 700 }}>{t("insights.title")}</h2>
          <div style={{ fontSize: 13, color: C.muted }}>{t("insights.subtitle")}</div>
        </div>
        {bankConnected ? (
          <GlassCard>
            <div style={{ fontSize: 15, fontWeight: 600, color: C.muted, marginBottom: 4 }}>{t("insights.no_data")}</div>
            <div style={{ fontSize: 12, color: C.faint, lineHeight: 1.5 }}>{t("insights.no_data_body")}</div>
          </GlassCard>
        ) : (
          <ConnectBankPrompt title={t("insights.title")} message={t("dashboard.connect_bank_insights")} onNavigate={onNavigate} />
        )}
      </div>
    );
  }
  const monthlySavings = totalIncome - totalSpent;
  const savingsRate = totalIncome > 0 ? Math.round((monthlySavings / totalIncome) * 100) : 0;
  const BUFFER = 1000;
  const availableSafe = Math.max(0, Math.min(monthlySavings - BUFFER, (plaidBalance != null ? plaidBalance - BUFFER : Infinity)));

  // ── Health Score (shared calculation — same as Dashboard) ─────
  const SUB_CATS = ['Subscriptions', 'Bills', 'Utilities', 'Phone', 'Internet', 'Insurance'];
  const subscriptionSpend = SUB_CATS.reduce((s, cat) => s + (spendingByCategory[cat] || 0), 0);
  const { score: insightScore, color: insightScoreColor, breakdown: insightScoreBreakdown } = calculateHealthScore({
    totalIncome,
    totalSpent,
    lastIncome,
    lastSpent,
    budget: Number(profile?.monthly_budget) || 3000,
    subscriptionSpend,
  });
  const insightScoreComment = generateHealthComment({
    score: insightScore,
    breakdown: insightScoreBreakdown,
    spendingByCategory,
    prevSpendingByCategory,
  });
  const prevSubscriptionSpend = SUB_CATS.reduce((s, cat) => s + (prevSpendingByCategory[cat] || 0), 0);
  const { score: prevInsightScore } = (lastIncome > 0 || lastSpent > 0)
    ? calculateHealthScore({ totalIncome: lastIncome, totalSpent: lastSpent, lastIncome: 0, lastSpent: 0, budget: Number(profile?.monthly_budget) || 3000, subscriptionSpend: prevSubscriptionSpend })
    : { score: null };

  const insights = [];

  Object.entries(spendingByCategory).forEach(([cat, amount]) => {
    if (cat === "Transfer") return; // Transfer не анализируем
    const prev = prevSpendingByCategory[cat] || 0;
    if (prev > 0) {
      const change = ((amount - prev) / prev) * 100;
      if (change > 25) {
        const catLabel = tCat(cat, t);
        const cause = t("insights.cat_spike_cause", { amount: fmt(amount, 0), prevAmount: fmt(prev, 0), savings: fmt(amount - prev, 0) });
        const guidance = change > 100
          ? t("insights.cat_spike_guidance_significant", { cat: catLabel })
          : t("insights.cat_spike_guidance_elevated");
        insights.push({
          id: `u-${cat}`, icon: "trending-up",
          title: t("insights.cat_spike_title", { cat: catLabel, pct: change.toFixed(0) }),
          desc: `${cause}\n\n${guidance}`,
          severity: change > 50 ? "danger" : "warning",
          value: `+${change.toFixed(0)}%`,
          context: t("insights.cat_spike_context", { cat: catLabel, pct: change.toFixed(0) })
        });
      }
    }
  });

  if (savingsRate < 10 && totalIncome > 0) insights.push({
    id: "savings-low", icon: "target", title: t("insights.low_savings_title"),
    desc: t("insights.low_savings_desc", { rate: savingsRate.toFixed(1) }),
    severity: "warning", value: `${savingsRate.toFixed(1)}%`,
    context: t("insights.low_savings_context", { rate: savingsRate.toFixed(1) })
  });
  else if (savingsRate >= 20) insights.push({
    id: "savings-good", icon: "star", title: t("insights.high_savings_title"),
    desc: availableSafe > 0
      ? t("insights.high_savings_desc_surplus", { rate: savingsRate.toFixed(1) })
      : t("insights.high_savings_desc_low_cash", { rate: savingsRate.toFixed(1) }),
    severity: "good", value: `${savingsRate.toFixed(1)}%`,
    context: availableSafe > 0
      ? t("insights.high_savings_context_surplus", { rate: savingsRate.toFixed(1) })
      : t("insights.high_savings_context_low_cash", { rate: savingsRate.toFixed(1) })
  });

  const shopping = spendingByCategory["Shopping"] || 0;
  if (shopping > 300) insights.push({
    id: "shopping", icon: "shopping", title: t("insights.high_shopping_title"),
    desc: t("insights.high_shopping_desc", { amount: fmt(shopping, 0) }),
    severity: "info", value: `$${fmt(shopping, 0)}`,
    context: t("insights.high_shopping_context", { amount: fmt(shopping, 0) })
  });

  if (insights.length === 0) {
    if (insightScore >= 70) {
      insights.push({ id: "all-good", icon: "check-circle", title: t("insights.on_track"), desc: t("insights.score_good_desc"), severity: "good", context: t("insights.score_good_context") });
    } else if (insightScore >= 50) {
      insights.push({ id: "neutral", icon: "info", title: t("insights.some_areas"), desc: t("insights.score_mid_desc"), severity: "info", context: t("insights.score_mid_context") });
    } else {
      insights.push({ id: "needs-work", icon: "alert-circle", title: t("insights.attention_needed"), desc: t("insights.score_low_desc"), severity: "warning", context: t("insights.score_low_context") });
    }
  }

  const colors = { info: C.cyan, warning: C.yellow, danger: C.red, good: C.green };


  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ marginBottom: 4 }}>
        <h2 style={{ margin: "0 0 4px", fontSize: 22, fontWeight: 700 }}>{t("insights.title")}</h2>
        <div style={{ fontSize: 13, color: C.muted }}>{t("insights.subtitle")}</div>
      </div>

      {allInsights && allInsights.length > 0 && (
        <div>
          <InsightCardGroup insights={(isPro ? allInsights : allInsights.slice(0, 2)).filter(i => {
            if (i.type === 'savings_opportunity' && monthlySavings <= 0) return false;
            if (i.type === 'goal_off_track') {
              const goal = (savings ?? []).find(sv => sv.id === i.data?.goalId);
              if (!goal || Number(goal.target) >= 50000) return false;
            }
            return true;
          })} onAction={onInsightAction} />
          {!isPro && allInsights.length > 2 && (
            <div
              onClick={onUpgrade}
              style={{
                marginTop: 8, padding: "18px 16px",
                background: "linear-gradient(180deg, rgba(11,20,38,0) 0%, rgba(11,20,38,0.9) 40%)",
                borderRadius: RADIUS.md, textAlign: "center", cursor: "pointer",
                border: `1px solid #1E2D45`,
                display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
              }}
            >
              <span style={{ fontSize: 20 }}>🔒</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#E8EDF5" }}>{t("insights.insights_locked", { count: allInsights.length - 2 })}</span>
              <span style={{ fontSize: 12, color: "#7A8BA8" }}>{showRealUpgrade ? t("insights.upgrade_to_pro") : t("insights.included_with_pro")}</span>
            </div>
          )}
        </div>
      )}

      <HealthScore score={insightScore} color={insightScoreColor} breakdown={insightScoreBreakdown} comment={insightScoreComment} totalSpent={totalSpent} budget={Number(profile?.monthly_budget) || 3000} hasData={totalIncome > 0 || totalSpent > 0} prevScore={prevInsightScore} cashPositionLow={availableSafe <= 0 && plaidBalance != null} />
      <WeeklySummary transactions={transactions || []} />
      <RecurringSummary transactions={transactions || []} onOpenChat={onOpenChat} merchantAliasMap={merchantAliasMap} merchantAliases={merchantAliases} onDecideMerchantAlias={onDecideMerchantAlias} />

      {/* Локальные инсайты — только если Edge Function не вернул данные */}
      {(!allInsights || allInsights.length === 0) && insights.map(ins => {
        const color = colors[ins.severity];
        return (
          <GlassCard key={ins.id}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ width: 44, height: 44, borderRadius: RADIUS.md, background: color + "22", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: `0 0 14px ${color}33` }}>
                <Icon name={ins.icon} size={20} color={color} />
              </div>
              {ins.value && <span className="ph-mask" style={{ background: color + "22", color, borderRadius: RADIUS.full, padding: "4px 12px", fontSize: 13, fontWeight: 700 }}>{ins.value}</span>}
            </div>
            <div className="ph-mask" style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>{ins.title}</div>
            <div className="ph-mask" style={{ fontSize: 13, color: C.muted, lineHeight: 1.7, marginBottom: 14 }}>{ins.desc}</div>
            <button onClick={() => onOpenChat?.(ins.context)} style={{ background: "none", border: "none", cursor: "pointer", color, fontSize: 13, fontWeight: 600, padding: 0, display: "flex", alignItems: "center", gap: 6, fontFamily: FONT }}>
              <Icon name="message" size={13} color={color} /> {t("insights.ask_ai_about_this")} <Icon name="chevron" size={13} color={color} />
            </button>
          </GlassCard>
        );
      })}

      {monthlySavings >= 50 && (
        <GlassCard style={{ background: `linear-gradient(135deg,${C.cyan}0D,${C.card})`, border: `1px solid ${C.cyan}30` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <Icon name="zap" size={16} color={C.cyan} />
            <span style={{ fontWeight: 600, fontSize: 15, color: C.cyan }}>{t("insights.autopilot_tip")}</span>
          </div>
          <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.65 }}>
            {t("insights.autopilot_tip_body")}
          </div>
        </GlassCard>
      )}

      {/* Savings goal progress */}
      {savings && savings.length > 0 && (() => {
        const surplus = totalIncome - totalSpent;
        const active = savings.filter(sv => Number(sv.target) > 0 && Number(sv.current) < Number(sv.target));
        if (active.length === 0) return null;
        const totalSaved = active.reduce((s, sv) => s + Number(sv.current), 0);
        const totalTarget = active.reduce((s, sv) => s + Number(sv.target), 0);
        const overallPct = totalTarget > 0 ? Math.min((totalSaved / totalTarget) * 100, 100) : 0;
        return (
          <GlassCard style={{ background: `linear-gradient(135deg,${C.green}10,${C.card})`, border: `1px solid ${C.green}35` }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 32, height: 32, borderRadius: RADIUS.sm, background: C.green + "22", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: `0 0 10px ${C.green}33` }}>
                  <Icon name="target" size={14} color={C.green} />
                </div>
                <span style={{ fontWeight: 700, fontSize: 14, color: C.green }}>{t("insights.goal_progress")}</span>
              </div>
              <div style={{ background: C.green + "22", borderRadius: RADIUS.full, padding: "3px 10px" }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: C.green }}>{overallPct.toFixed(0)}% {t("insights.pct_total")}</span>
              </div>
            </div>
            <div style={{ height: 5, background: C.bgTertiary, borderRadius: RADIUS.full, marginBottom: 14, overflow: "visible" }}>
              <div style={{ height: '100%', width: `${overallPct}%`, background: `linear-gradient(90deg,${C.green}CC,${C.green})`, borderRadius: RADIUS.full, boxShadow: overallPct > 0 ? `0 0 8px ${C.green}55, 0 0 16px ${C.green}22` : 'none', transition: "width 0.6s ease" }} />
            </div>
            {active.slice(0, 3).map((sv, i) => {
              const cur = Number(sv.current), tgt = Number(sv.target);
              const pct = Math.min((cur / tgt) * 100, 100);
              const fc  = computeGoalForecast(tgt - cur, surplus, savings.length);
              return (
                <div key={sv.id} style={{ marginTop: i > 0 ? 12 : 0, paddingTop: i > 0 ? 12 : 0, borderTop: i > 0 ? `1px solid ${C.sep}` : 'none' }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 5 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{sv.name}</span>
                    <span className="ph-mask" style={{ fontSize: 11, color: C.muted }}>${fmt(cur, 0)} / ${fmt(tgt, 0)}</span>
                  </div>
                  <div style={{ height: 6, background: C.bgTertiary, borderRadius: RADIUS.full, marginBottom: 4, overflow: "visible" }}>
                    <div style={{ height: '100%', width: `${pct}%`, background: `linear-gradient(90deg,${C.green}AA,${C.green})`, borderRadius: RADIUS.full, boxShadow: pct > 0 ? `0 0 8px ${C.green}44` : 'none', transition: "width 0.6s ease" }} />
                  </div>
                  {fc.type !== 'complete' && (
                    <div className="ph-mask" style={{ fontSize: 11, color: fc.type === 'on_track' ? C.green : C.yellow, lineHeight: 1.4 }}>
                      {fc.type === 'on_track'
                        ? t("insights.on_track_for", { date: formatForecastDate(fc.date) })
                        : t("insights.need_more_for", { amount: fmt(fc.shortfall, 0), date: formatForecastDate(fc.targetDate) })}
                    </div>
                  )}
                </div>
              );
            })}
          </GlassCard>
        );
      })()}

      <div style={{ fontSize: 11, color: C.faint, textAlign: "center", lineHeight: 1.5, padding: "0 8px", opacity: 0.55 }}>
        {t("chat.disclaimer")}
      </div>
    </div>
  );
}