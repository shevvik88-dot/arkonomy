// arkonomy v1
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createClient } from "@supabase/supabase-js";
import { App as CapApp } from "@capacitor/app";
import { usePlaidLink } from "react-plaid-link";
import { usePlaidOAuth, PLAID_REDIRECT_URI } from "./hooks/usePlaidOAuth";
import CheckInCard from "./components/CheckInCard";
import UpgradeModal from "./components/UpgradeModal";
import UpcomingChargesCard from "./components/UpcomingChargesCard";
import { usePlan } from "./hooks/usePlan";
import { usePushNotifications } from "./hooks/usePushNotifications";
import { detectRecurringCharges } from "./recurringDetector";
import { calculateHealthScore, generateHealthComment, getScoreLabel } from "./healthScore";

// ─── AI Brain: useInsights hook ───────────────────────────────
function useInsights(screen, userId) {
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!userId) return;
    supabase.functions
      .invoke("get-insights", { body: { userId } })
      .then(({ data: result, error }) => {
        if (error) { console.error("useInsights error:", error); return; }
        setData(result);
      });
  }, [userId]);

  if (!data) return { insight: null, allInsights: [], aiContext: null };

  const insight = screen === "insights"
    ? data.screens?.insights?.[0] ?? null
    : data.screens?.[screen] ?? null;

  return {
    insight,
    allInsights: data.screens?.insights ?? [],
    aiContext: data.screens?.ai ?? null,
  };
}

// ─── InsightCardGroup: только один insight expanded за раз ───
function InsightCardGroup({ insights, onAction }) {
  // Первый insight открыт по умолчанию (top priority)
  const [expandedIdx, setExpandedIdx] = useState(0);

  return (
    <div>
      {insights.map((ins, i) => (
        <InsightCardControlled
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

// ─── InsightCardControlled: controlled expand версия ─────────
// Санитизация AI текста — убираем misleading фразы глобально
function sanitizeAiBody(text) {
  return (text || "")
    // Savings full gap — заменяем на безопасную формулировку
    .replace(/You can cover the full gap[^.]*\./gi,
      "You can cover the full gap using your available balance.\n→ A safer contribution is $200–$400 to keep your buffer stable.\n→ Larger deposits are possible, but may reduce your safety cushion.")
    // Слабые слова
    .replace(/appears to be a one-time event/gi, "is a one-time expense, not a trend")
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

function InsightCardControlled({ insight, expanded, onToggle, onAction }) {
  if (!insight) return null;

  const cfg = INSIGHT_CONFIG[insight.type] ?? INSIGHT_CONFIG.overspending;
  const { headline, body: rawBody, cta, action, range, breakdown: rawBreakdown, roundUpPrompt } = insight.rendered;
  const body = sanitizeAiBody(rawBody);
  const { accent, border, bg, label } = cfg;

  const SAFE_CAP = 400;
  const breakdown = rawBreakdown ? {
    ...rawBreakdown,
    suggestedSave: rawBreakdown.suggestedSave
      ? Math.min(Number(rawBreakdown.suggestedSave), SAFE_CAP)
      : rawBreakdown.suggestedSave,
  } : rawBreakdown;

  const cleanCta      = (cta || "").replace(/~/g, "").trim();
  const cleanHeadline = (headline || "").replace(/~\$/, "$").trim();
  const isSavings     = insight.type === "savings_opportunity";
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

  console.log('[InsightCardControlled] type:', insight.type,
    '| suggestedSave:', breakdown?.suggestedSave,
    '| goalContribution:', goalContribution,
    '| showCtaButton:', showCtaButton,
    '| cleanCta:', cleanCta);

  return (
    <div
      onClick={onToggle}
      style={{ background: bg, border: `1px solid ${border}22`, borderRadius: 16, padding: "14px 16px", marginBottom: 10, cursor: "pointer", fontFamily: "'Inter', -apple-system, sans-serif" }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 7 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <cfg.Icon color={accent} />
          <span style={{ fontSize: 10, fontWeight: 600, color: accent + "99", letterSpacing: 0.5 }}>{label}</span>
        </div>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#4A5E7A" strokeWidth="2.5" strokeLinecap="round">
          {expanded ? <polyline points="18 15 12 9 6 15"/> : <polyline points="6 9 12 15 18 9"/>}
        </svg>
      </div>

      <div style={{ fontSize: 16, fontWeight: 700, color: "#FFFFFF", letterSpacing: -0.35, lineHeight: 1.3, marginBottom: expanded ? 12 : 0 }}>
        {cleanHeadline}
      </div>

      {expanded && (
        <div style={{ borderTop: `1px solid ${border}14`, paddingTop: 12 }}>
          <p style={{ color: "rgba(154,164,178,0.85)", fontSize: 13, lineHeight: 1.6, margin: "0 0 12px", whiteSpace: "pre-line" }}>
            {body}
          </p>
          {isSavings && breakdown && (
            <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: 10, padding: "10px 12px", marginBottom: 14, display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 12, color: "rgba(154,164,178,0.7)", minWidth: 110 }}>Available</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: "#FFFFFF" }}>${Number(breakdown.available || 0).toLocaleString("en-US", { maximumFractionDigits: 0 })}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <span style={{ fontSize: 12, color: "rgba(154,164,178,0.7)", display: "block", paddingTop: 1 }}>Safe to move</span>
                  <span style={{ fontSize: 11, color: "rgba(154,164,178,0.60)", display: "block", marginTop: 3, paddingLeft: 2 }}>keeps ~${Number(breakdown.bufferAmount || 1000).toLocaleString("en-US", { maximumFractionDigits: 0 })} buffer</span>
                </div>
                <span style={{ fontSize: 13, fontWeight: 600, color: accent, paddingTop: 1 }}>${Number(breakdown.suggestedSave || 0).toLocaleString("en-US", { maximumFractionDigits: 0 })}</span>
              </div>
            </div>
          )}
          {showCtaButton && (
            <button
              onClick={e => { e.stopPropagation(); onAction?.(action, insight.data); }}
              style={{ width: "100%", padding: "13px 16px", background: accent, border: "none", borderRadius: 11, color: isSavings ? "#061A10" : "#fff", fontWeight: 800, fontSize: 15, cursor: "pointer", fontFamily: "'Inter', -apple-system, sans-serif", letterSpacing: -0.3, boxShadow: `0 4px 20px ${accent}32`, transition: "transform 0.12s ease", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
              onPointerDown={e => { e.stopPropagation(); e.currentTarget.style.transform = "scale(0.98)"; }}
              onPointerUp={e => { e.currentTarget.style.transform = ""; }}
              onPointerLeave={e => { e.currentTarget.style.transform = ""; }}
            >
              {isSavings && Number(breakdown?.suggestedSave) > 0
                ? <>
                    Add ${Number(breakdown.suggestedSave).toLocaleString("en-US", { maximumFractionDigits: 0 })} safely
                    <span style={{ fontSize: 10, fontWeight: 600, background: "rgba(0,0,0,0.15)", borderRadius: 20, padding: "2px 8px", whiteSpace: "nowrap" }}>
                      Recommended · safe amount
                    </span>
                  </>
                : getSmartCta(insight)}
            </button>
          )}
          {isSavings && Number(rawBreakdown?.suggestedSave) > 0 && Number(rawBreakdown.suggestedSave) > SAFE_CAP && (
            <button
              onClick={e => { e.stopPropagation(); onAction?.(action, { ...insight.data, _useMax: true }); }}
              style={{ width: "100%", marginTop: 6, padding: "9px 16px", background: "transparent", border: `1px solid ${accent}33`, borderRadius: 10, color: accent, fontWeight: 500, fontSize: 12, cursor: "pointer", fontFamily: "'Inter', -apple-system, sans-serif", opacity: 0.7 }}
            >
              Add ${Number(rawBreakdown.suggestedSave).toLocaleString("en-US", { maximumFractionDigits: 0 })} (max)
            </button>
          )}
          {range && (
            <div style={{ textAlign: "center", marginTop: 7, fontSize: 11, color: "rgba(154,164,178,0.60)", letterSpacing: 0.1 }}>
              {range.replace("Suggested range:", "Safe range:").replace("Flexible:", "Safe range:")}
            </div>
          )}
        </div>
      )}
    </div>
  );
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

function getSmartCta(insight) {
  if (!insight) return "View Transactions";
  const { type, data } = insight;
  switch (type) {
    case "category_spike":      return data?.categoryName ? `Review ${data.categoryName}` : "View Transactions";
    case "overspending":        return "View Transactions";
    case "cash_risk":           return "Review Recurring";
    case "savings_opportunity": return "View Savings";
    case "goal_off_track":      return "View Savings";
    case "positive_progress":   return "Improve Score";
    default:                    return "View Transactions";
  }
}

function InsightCard({ insight, onAction }) {
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (insight?.autoExpand) setExpanded(true);
  }, [insight?.type]);

  if (!insight) return null;

  const cfg = INSIGHT_CONFIG[insight.type] ?? INSIGHT_CONFIG.overspending;
  const { headline, body: rawBody, cta, action, range, breakdown: rawBreakdown, roundUpPrompt } = insight.rendered;
  const body = sanitizeAiBody(rawBody);
  const { accent, border, bg, label } = cfg;

  // Принудительно ограничиваем suggestedSave — никогда больше $400 (safe лимит)
  const SAFE_CAP = 400;
  const breakdown = rawBreakdown ? {
    ...rawBreakdown,
    suggestedSave: rawBreakdown.suggestedSave
      ? Math.min(Number(rawBreakdown.suggestedSave), SAFE_CAP)
      : rawBreakdown.suggestedSave,
  } : rawBreakdown;

  const cleanCta      = (cta || "").replace(/~/g, "").trim();
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

  console.log('[InsightCard] type:', insight.type,
    '| suggestedSave:', breakdown?.suggestedSave,
    '| goalContribution:', goalContribution,
    '| showCtaButton:', showCtaButton,
    '| cleanCta:', cleanCta);

  return (
    <div
      onClick={() => setExpanded(e => !e)}
      style={{
        background: bg,
        border: `1px solid ${border}22`,
        borderRadius: 16,
        padding: "14px 16px",
        marginBottom: 10,
        cursor: "pointer",
        fontFamily: "'Inter', -apple-system, sans-serif",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 7 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <cfg.Icon color={accent} />
          <span style={{
            fontSize: 10, fontWeight: 600,
            color: accent + "99",
            letterSpacing: 0.5,
          }}>
            {label}
          </span>
        </div>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#4A5E7A" strokeWidth="2.5" strokeLinecap="round">
          {expanded
            ? <polyline points="18 15 12 9 6 15"/>
            : <polyline points="6 9 12 15 18 9"/>
          }
        </svg>
      </div>

      <div style={{
        fontSize: 16, fontWeight: 700, color: "#FFFFFF",
        letterSpacing: -0.35, lineHeight: 1.3,
        marginBottom: expanded ? 12 : 0,
      }}>
        {cleanHeadline}
      </div>

      {expanded && (
        <div style={{ borderTop: `1px solid ${border}14`, paddingTop: 12 }}>
          <p style={{
            color: "rgba(154,164,178,0.85)",
            fontSize: 13, lineHeight: 1.6,
            margin: "0 0 12px",
          }}>
            {body}
          </p>

          {isSavings && breakdown && (
            <div style={{
              background: "rgba(255,255,255,0.04)",
              borderRadius: 10,
              padding: "10px 12px",
              marginBottom: 14,
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 12, color: "rgba(154,164,178,0.7)", minWidth: 110 }}>Available</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: "#FFFFFF" }}>
                  ${Number(breakdown.available || 0).toLocaleString("en-US", { maximumFractionDigits: 0 })}
                </span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <span style={{ fontSize: 12, color: "rgba(154,164,178,0.7)", display: "block", paddingTop: 1 }}>Safe to move</span>
                  <span style={{ fontSize: 11, color: "rgba(154,164,178,0.60)", display: "block", marginTop: 3, paddingLeft: 2 }}>
                    keeps ~${Number(breakdown.bufferAmount || 1000).toLocaleString("en-US", { maximumFractionDigits: 0 })} buffer
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
                background: accent, border: "none", borderRadius: 11,
                color: insight.type === "savings_opportunity" ? "#061A10" : "#fff",
                fontWeight: 800, fontSize: 15, cursor: "pointer",
                fontFamily: "'Inter', -apple-system, sans-serif",
                letterSpacing: -0.3,
                boxShadow: `0 4px 20px ${accent}32`,
                transition: "transform 0.12s ease, box-shadow 0.12s ease",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              }}
            >
              {isSavings && Number(breakdown?.suggestedSave) > 0
                ? <>
                    Add ${Number(breakdown.suggestedSave).toLocaleString("en-US", { maximumFractionDigits: 0 })} safely
                    <span style={{ fontSize: 10, fontWeight: 600, background: "rgba(0,0,0,0.15)", borderRadius: 20, padding: "2px 8px", whiteSpace: "nowrap" }}>
                      Recommended · safe amount
                    </span>
                  </>
                : getSmartCta(insight)
              }
            </button>
          )}

          {/* Max amount secondary CTA — только для savings если было обрезано */}
          {isSavings && Number(rawBreakdown?.suggestedSave) > 0 && Number(rawBreakdown.suggestedSave) > SAFE_CAP && (
            <button
              onClick={e => { e.stopPropagation(); onAction?.(action, { ...insight.data, _useMax: true }); }}
              style={{ width: "100%", marginTop: 6, padding: "9px 16px", background: "transparent", border: `1px solid ${accent}33`, borderRadius: 10, color: accent, fontWeight: 500, fontSize: 12, cursor: "pointer", fontFamily: "'Inter', -apple-system, sans-serif", opacity: 0.7 }}
            >
              Add ${Number(rawBreakdown.suggestedSave).toLocaleString("en-US", { maximumFractionDigits: 0 })} (max)
            </button>
          )}

          {range && (
            <div style={{
              textAlign: "center", marginTop: 7, fontSize: 11,
              color: "rgba(154,164,178,0.60)", letterSpacing: 0.1,
            }}>
              {range.replace("Suggested range:", "Safe range:").replace("Flexible:", "Safe range:")}
            </div>
          )}

          {isSavings && insight.data?.roundUpMonthly > 0 && (
            <button
              onClick={e => { e.stopPropagation(); onAction?.("invest_alpaca", insight.data); }}
              style={{
                width: "100%", marginTop: 8, padding: "11px 16px",
                background: "rgba(75,108,183,0.15)",
                border: "1px solid rgba(75,108,183,0.35)",
                borderRadius: 11, color: "#8BA7E8",
                fontWeight: 600, fontSize: 13,
                cursor: "pointer", fontFamily: "'Inter', -apple-system, sans-serif",
                letterSpacing: -0.1,
                display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                transition: "background 0.15s",
              }}
              onPointerEnter={e => { e.currentTarget.style.background = "rgba(75,108,183,0.25)"; }}
              onPointerLeave={e => { e.currentTarget.style.background = "rgba(75,108,183,0.15)"; }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
              </svg>
              Invest ${Math.floor(insight.data.roundUpMonthly)} in spare change via Alpaca
            </button>
          )}

          {isSavings && roundUpPrompt && !(insight.data?.roundUpMonthly > 0) && (
            <div style={{
              marginTop: 6, textAlign: "center", fontSize: 12,
              color: "rgba(154,164,178,0.80)", letterSpacing: 0.1, cursor: "pointer",
            }}>
              or automate this with round-ups →
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const fontLink = document.createElement("link");
fontLink.rel = "stylesheet";
fontLink.href = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap";
document.head.appendChild(fontLink);

const APP_VERSION = "1.0.1";
const FONT = "'Inter', -apple-system, BlinkMacSystemFont, sans-serif";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Alpaca OAuth — redirect URI points to the Supabase edge function which
// exchanges the code for tokens and then redirects back to https://app.arkonomy.com
const ALPACA_CLIENT_ID    = import.meta.env.VITE_ALPACA_CLIENT_ID ?? "";
const ALPACA_REDIRECT_URI = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/alpaca-oauth-callback`;
function alpacaOAuthUrl(userJwt) {
  const params = new URLSearchParams({
    response_type: "code",
    client_id:     ALPACA_CLIENT_ID,
    redirect_uri:  ALPACA_REDIRECT_URI,
    scope:         "account:write trading",
    state:         userJwt, // echoed back so the callback can identify the user
  });
  return `https://app.alpaca.markets/oauth/authorize?${params}`;
}

const C = {
  bg: "#0B1426", bgSecondary: "#0F1A2E", bgTertiary: "#162035",
  card: "#111E33", border: "#1E2D4A", sep: "#192840",
  blue: "#2F80FF", cyan: "#00C2FF", green: "#12D18E",
  red: "#FF5C7A", yellow: "#FFB800", purple: "#A78BFA",
  text: "#FFFFFF", muted: "#9AA4B2", faint: "#4A5E7A",
};

const CAT_COLORS = {
  "Housing":       "#60A5FA",
  "Bills":         "#A78BFA",
  "Subscriptions": "#A78BFA",
  "Shopping":      "#FB923C",
  "Food & Dining": "#F87171",
  "Transport":     "#2DD4BF",
  "Entertainment": "#F472B6",
  "Health":        "#4ADE80",
  "Personal Care": "#FBBF24",
  "Travel":        "#818CF8",
  "Other":         "#94A3B8",
  "Transfer":      "#94A3B8",
  "Income":        "#34D399",
};

function fmt(n, decimals = 2) {
  return Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

// Keyword-based category guesser — used as fallback when no category is assigned
function guessCategory(description, type = "expense") {
  if (!description) return null;
  const d = description.toLowerCase();
  if (type === "income") {
    if (/salary|payroll|direct.?deposit|wages|paycheck/.test(d)) return "Salary";
    if (/freelance|consulting|contract|self.?employ/.test(d)) return "Freelance";
    if (/refund|reimburs|cashback|cash.?back/.test(d)) return "Refund";
    return null;
  }
  if (/rent|lease|mortgage|apartment|hoa|homeowner/.test(d)) return "Housing";
  if (/grocery|groceries|supermarket|walmart|target|costco|trader.?joe|whole.?food|safeway|kroger|aldi|publix|h.e.b|wegman|food.?4.?less|sprouts/.test(d)) return "Food & Dining";
  if (/restaurant|mcdonald|burger.?king|pizza|subway|starbucks|chipotle|taco.?bell|wendy|dunkin|chick.?fil|panera|doordash|ubereats|uber.?eats|grubhub|postmates|instacart|coffee|cafe|diner|bistro|sushi|grill|tavern/.test(d)) return "Food & Dining";
  if (/uber|lyft|taxi|cab |parking|gas.?station|shell|chevron|exxon|bp |mobil|fuel|transit|metro|train|bus |amtrak|airline|delta|united|southwest|spirit|jetblue/.test(d)) return "Transportation";
  if (/netflix|hulu|spotify|disney\+|amazon.?prime|apple.?tv|youtube.?premium|hbo|peacock|paramount\+|subscription/.test(d)) return "Subscriptions";
  if (/doctor|physician|hospital|pharmacy|cvs|walgreens|rite.?aid|medical|dental|vision|health.?insur|urgent.?care|clinic/.test(d)) return "Healthcare";
  if (/electric|electricity|water.?bill|sewer|gas.?bill|utility|at&t|verizon|t-mobile|sprint|comcast|xfinity|spectrum|internet|phone.?bill/.test(d)) return "Utilities";
  if (/amazon|ebay|etsy|best.?buy|apple.?store|nike|zara|h&m|nordstrom|gap |old.?navy|macy|target\.com|walmart\.com/.test(d)) return "Shopping";
  if (/gym|fitness|planet.?fitness|equinox|crossfit|yoga|peloton|24.?hour/.test(d)) return "Health & Fitness";
  if (/movie|cinema|theater|concert|ticketmaster|stubhub|steam|playstation|xbox|spotify.?games|gaming/.test(d)) return "Entertainment";
  if (/tuition|university|college|student.?loan|udemy|coursera|skillshare|school/.test(d)) return "Education";
  if (/insurance|geico|state.?farm|progressive|allstate|travelers/.test(d)) return "Bills";
  if (/transfer|zelle|venmo|paypal|cash.?app|wire|ach/.test(d)) return "Transfer";
  return null;
}

// Parse a YYYY-MM-DD date string in LOCAL time (not UTC).
// new Date("2026-04-11") is parsed as UTC midnight, which shifts to the
// previous day for any UTC+ timezone. Appending T00:00:00 forces local time.
function timeAgo(iso) {
  if (!iso) return null;
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hr ago`;
  return `${Math.floor(s / 86400)} days ago`;
}

function parseDate(dateStr) {
  if (!dateStr) return new Date();
  return new Date(dateStr + "T00:00:00");
}

function localDateString(d = new Date()) {
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

function fmtDate(dateStr) {
  return parseDate(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function Icon({ name, size = 20, color = C.muted, strokeWidth = 1.8 }) {
  const p = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: color, strokeWidth, strokeLinecap: "round", strokeLinejoin: "round" };
  const icons = {
    home:            <svg {...p}><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,
    credit:          <svg {...p}><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>,
    target:          <svg {...p}><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>,
    activity:        <svg {...p}><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>,
    message:         <svg {...p}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>,
    settings:        <svg {...p}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
    "trending-up":   <svg {...p}><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>,
    "trending-down": <svg {...p}><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/></svg>,
    eye:             <svg {...p}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>,
    "eye-off":       <svg {...p}><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>,
    bell:            <svg {...p}><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>,
    "check-circle":  <svg {...p}><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>,
    "alert-circle":  <svg {...p}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>,
    zap:             <svg {...p}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>,
    dollar:          <svg {...p}><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>,
    food:            <svg {...p}><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg>,
    car:             <svg {...p}><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>,
    shopping:        <svg {...p}><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>,
    film:            <svg {...p}><rect x="2" y="2" width="20" height="20" rx="2"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/></svg>,
    heart:           <svg {...p}><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>,
    file:            <svg {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>,
    repeat:          <svg {...p}><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>,
    bank:            <svg {...p}><line x1="3" y1="22" x2="21" y2="22"/><line x1="6" y1="18" x2="6" y2="11"/><line x1="10" y1="18" x2="10" y2="11"/><line x1="14" y1="18" x2="14" y2="11"/><line x1="18" y1="18" x2="18" y2="11"/><polygon points="12 2 20 7 4 7"/></svg>,
    phone:           <svg {...p}><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>,
    send:            <svg {...p}><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>,
    plus:            <svg {...p}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
    x:               <svg {...p}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
    chevron:         <svg {...p}><polyline points="9 18 15 12 9 6"/></svg>,
    lock:            <svg {...p}><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>,
    star:            <svg {...p}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>,
    info:            <svg {...p}><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>,
    award:           <svg {...p}><circle cx="12" cy="8" r="6"/><path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11"/></svg>,
    calendar:        <svg {...p}><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
    "bar-chart":     <svg {...p}><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><line x1="2" y1="20" x2="22" y2="20"/></svg>,
    edit:            <svg {...p}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>,
    trash:           <svg {...p}><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>,
    search:          <svg {...p}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
    "arrow-left":    <svg {...p}><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>,
    "pie-chart":     <svg {...p}><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/></svg>,
    globe:           <svg {...p}><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>,
  };
  return icons[name] || icons["dollar"];
}

// ─── Health Score Gauge ──────────────────────────────────────────────────────
// ─── Health Score Bar (compact, inline, expandable) ─────────────────────────
function HealthScoreBar({ score, color, comment, breakdown, hasData = true }) {
  const [open, setOpen] = useState(false);
  const label = getScoreLabel(score);

  if (!hasData) {
    return (
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: "10px 14px", fontFamily: FONT }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: C.faint, flexShrink: 0 }} />
          <span style={{ fontSize: 12, fontWeight: 500, color: C.muted, flexShrink: 0 }}>Health Score</span>
          <span style={{ fontSize: 12, color: C.faint }}>— Connect your bank to see your score</span>
        </div>
      </div>
    );
  }

  const rows = [
    {
      key: "savings",
      label: "Savings rate",
      pts: breakdown?.savings?.points ?? 0,
      max: 30,
      detail: breakdown?.savings?.rate != null
        ? `${Math.round(breakdown.savings.rate * 100)}% of income saved`
        : null,
      na: !hasData,
    },
    {
      key: "budget",
      label: "Budget adherence",
      pts: breakdown?.budget?.points ?? 0,
      max: 25,
      detail: null,
      na: !hasData,
    },
    {
      key: "recurring",
      label: "Recurring charges",
      pts: breakdown?.recurring?.points ?? 0,
      max: 20,
      detail: breakdown?.recurring?.ratio != null
        ? `${Math.round(breakdown.recurring.ratio * 100)}% of income`
        : null,
      na: !hasData,
    },
    {
      key: "trend",
      label: "Balance trend",
      pts: breakdown?.trend?.points ?? 0,
      max: 25,
      detail: (() => {
        const d = breakdown?.trend;
        if (!d) return null;
        const delta = d.thisBalance - d.lastBalance;
        return delta >= 0
          ? `+$${Math.round(delta)} vs last month`
          : `-$${Math.round(Math.abs(delta))} vs last month`;
      })(),
      na: !hasData,
    },
  ];

  return (
    <div
      onClick={() => setOpen(o => !o)}
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 14,
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
        <span style={{ fontSize: 12, fontWeight: 500, color: C.muted, flexShrink: 0 }}>
          Health Score
        </span>

        {/* Score number */}
        <span style={{ fontSize: 14, fontWeight: 800, color, letterSpacing: -0.3, flexShrink: 0 }}>
          {score}
        </span>

        {/* Divider */}
        <span style={{ fontSize: 12, color: C.faint, flexShrink: 0 }}>·</span>

        {/* Comment — truncated, muted */}
        <span style={{
          fontSize: 12, color: C.faint,
          overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis",
          flex: 1, minWidth: 0,
        }}>
          {label} — {comment}
        </span>

        {/* Chevron */}
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none"
          stroke={C.faint} strokeWidth="2.5" strokeLinecap="round"
          style={{ flexShrink: 0, transition: "transform 0.2s", transform: open ? "rotate(180deg)" : "none" }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>

      {/* ── Expanded breakdown ── */}
      {open && (
        <div
          onClick={e => e.stopPropagation()}
          style={{ marginTop: 12, borderTop: `1px solid ${C.border}`, paddingTop: 12 }}
        >
          {rows.map(row => {
            const pct = Math.round((row.pts / row.max) * 100);
            const barColor = pct >= 75 ? C.green : pct >= 40 ? C.yellow : C.red;
            return (
              <div key={row.key} style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
                  <span style={{ fontSize: 11, color: C.muted }}>{row.label}</span>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
                    {row.detail && (
                      <span style={{ fontSize: 10, color: C.faint }}>{row.detail}</span>
                    )}
                    <span style={{ fontSize: 11, fontWeight: 700, color: barColor }}>
                      {row.pts}<span style={{ fontWeight: 400, color: C.faint }}>/{row.max}</span>
                    </span>
                  </div>
                </div>
                <div style={{ height: 3, background: "#1E2D4A", borderRadius: 99 }}>
                  <div style={{
                    height: 3, borderRadius: 99,
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
            marginTop: 8, paddingTop: 8, borderTop: `1px solid ${C.border}`,
          }}>
            <span style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>Total score</span>
            <span style={{ fontSize: 13, fontWeight: 800, color }}>
              {score}<span style={{ fontSize: 11, fontWeight: 400, color: C.faint }}>/100</span>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function GlassCard({ children, style = {} }) {
  return (
    <div style={{ background: C.card, borderRadius: 20, border: `1px solid ${C.border}`, padding: 20, fontFamily: FONT, ...style }}>
      {children}
    </div>
  );
}

function StatBadge({ value, suffix = "vs last month" }) {
  const pos = value >= 0;
  const color = pos ? C.green : C.red;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 3, background: color + "22", color, borderRadius: 100, padding: "2px 8px", fontSize: 10, fontWeight: 600, fontFamily: FONT, whiteSpace: "nowrap" }}>
      <Icon name={pos ? "trending-up" : "trending-down"} size={9} color={color} strokeWidth={2.5} />
      {pos ? "+" : ""}{Math.abs(value).toFixed(1)}% {suffix}
    </span>
  );
}

function DonutChart({ data, size = 196, onCatClick, hideAmounts = false, lockList = false, onUpgrade }) {
  const cx = size / 2, cy = size / 2;
  const outerR = size / 2 - 8;
const innerR = outerR - 22;
const mid = (outerR + innerR) / 2;
const sw = 22;
  const [hovered, setHovered] = useState(null);

  const entries = Object.entries(data).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, v]) => s + v, 0);

  if (total === 0) return (
    <div style={{ height: size, display: "flex", alignItems: "center", justifyContent: "center", color: C.faint, fontSize: 13, fontFamily: FONT }}>
      No spending data yet
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
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, fontFamily: FONT }}>
      <div style={{ position: "relative", width: size, height: size }}>
        <svg width={size} height={size} style={{ display: "block" }}>
          <defs>
            <radialGradient id="cg" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor={C.cyan} stopOpacity="0.10" />
              <stop offset="100%" stopColor={C.cyan} stopOpacity="0" />
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
        <div style={{ position: "absolute", left: cx - innerR, top: cy - innerR, width: innerR * 2, height: innerR * 2, borderRadius: "50%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#0e1829", pointerEvents: "none" }}>
          {hovered ? (
            <>
              <div style={{ fontSize: 10, color: "#ffffff", fontWeight: 600, letterSpacing: 0.5, marginBottom: 2, textAlign: "center", padding: "0 4px" }}>{hovered}</div>
              <div style={{ fontSize: 17, fontWeight: 800, color: CAT_COLORS[hovered] || C.cyan }}>{hideAmounts ? "••••" : `$${fmt((data[hovered] || 0), 0)}`}</div>
              <div style={{ fontSize: 11, color: "#ffffff", fontWeight: 600 }}>{Math.round(((data[hovered] || 0) / total) * 100)}%</div>
            </>
          ) : (
            <>
             <div style={{ fontSize: 20, fontWeight: 800, color: "#ffffff", letterSpacing: -0.5, marginBottom: 2 }}>{hideAmounts ? "••••" : `$${fmt(total, 0)}`}</div>
           <div style={{ fontSize: 10, color: "#9AA4B2", letterSpacing: 0.5, fontWeight: 600 }}>Total spent</div>
            </>
          )}
        </div>
      </div>

      <div style={{ position: "relative", width: "100%" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, filter: lockList ? "blur(3px)" : "none", userSelect: lockList ? "none" : "auto", pointerEvents: lockList ? "none" : "auto" }}>
          {slices.map((s, i) => (
            <div key={s.cat}
              onClick={() => onCatClick && onCatClick(s.cat)}
              style={{ display: "flex", alignItems: "center", gap: 10, cursor: onCatClick ? "pointer" : "default", padding: "6px 10px", borderRadius: 10, background: hovered === s.cat ? s.color + "18" : C.bgTertiary, border: `1px solid ${hovered === s.cat ? s.color + "44" : "transparent"}`, transition: "all 0.15s" }}
              onMouseEnter={() => setHovered(s.cat)} onMouseLeave={() => setHovered(null)}>
              <div style={{ width: 10, height: 10, borderRadius: 99, background: s.color, flexShrink: 0, boxShadow: `0 0 6px ${s.color}88` }} />
              <span style={{ fontSize: 13, color: i === 0 ? C.text : C.muted, fontWeight: i === 0 ? 600 : 400, flex: 1 }}>{s.cat}</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: i === 0 ? '#ffffff' : C.text }}>{hideAmounts ? "••••" : `$${fmt(s.val, 0)}`}</span>
              <span style={{ fontSize: 11, color: s.color, fontWeight: i === 0 ? 700 : 500, minWidth: 36, textAlign: "right" }}>{Math.round((s.val / total) * 100)}%</span>
              {onCatClick && <Icon name="chevron" size={12} color={C.faint} />}
            </div>
          ))}
        </div>
        {lockList && (
          <div onClick={onUpgrade} style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: C.muted, background: C.card, padding: "5px 14px", borderRadius: 20, border: `1px solid ${C.border}` }}>
              Unlock full breakdown →
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function HealthScore({ score, color, breakdown: rawBreakdown, comment, totalSpent = 0, budget = 3000, hasData = true, actualSavingsRate = null }) {
  const [showBreakdown, setShowBreakdown] = useState(false);

  const label = getScoreLabel(score);
  const circumference = 2 * Math.PI * 28;
  const dash = (score / 100) * circumference;

  // Map the shared calculateHealthScore breakdown → display rows
  const breakdown = [
    {
      label: "Savings Rate",
      score: rawBreakdown.savings.points,
      max: 30,
      color: C.cyan,
      desc: rawBreakdown.savings.rate >= 0.2
        ? "On target (20%+)"
        : `Currently ${Math.round(rawBreakdown.savings.rate * 100)}%`,
    },
    {
      label: "Budget Adherence",
      score: rawBreakdown.budget.points,
      max: 25,
      color: C.blue,
      desc: rawBreakdown.budget.points >= 20 ? "Within budget" : "Over budget",
    },
    {
      label: "Recurring Charges",
      score: rawBreakdown.recurring.points,
      max: 20,
      color: C.purple,
      desc: rawBreakdown.recurring.ratio < 0.1
        ? "< 10% of income"
        : `${Math.round(rawBreakdown.recurring.ratio * 100)}% of income`,
    },
    {
      label: "Balance Trend",
      score: rawBreakdown.trend.points,
      max: 25,
      color: C.yellow,
      desc: rawBreakdown.trend.thisBalance >= rawBreakdown.trend.lastBalance
        ? "Improving vs last month"
        : "Down vs last month",
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
            <div style={{ fontSize: 10, color: C.faint, fontWeight: 600, letterSpacing: 1, marginBottom: 4 }}>FINANCIAL HEALTH</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: C.muted, marginBottom: 4 }}>No data yet</div>
            <div style={{ fontSize: 12, color: C.faint, lineHeight: 1.5 }}>Connect your bank or add transactions to see your score.</div>
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
          <div style={{ fontSize: 10, color: C.faint, fontWeight: 600, letterSpacing: 1, marginBottom: 4 }}>FINANCIAL HEALTH</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: C.text, marginBottom: 4 }}>{label} <span style={{ color, fontSize: 13 }}>{score}/100</span></div>
          <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.5 }}>
            {score >= 75 ? "Great habits! Keep it up." : score >= 50 ? "Decent — small improvements can help." : "Focus on saving more and staying in budget."}
          </div>
          <div style={{ fontSize: 11, color: C.faint, marginTop: 4 }}>Tap for breakdown ›</div>
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
              <div style={{ height: 4, background: C.bgTertiary, borderRadius: 99 }}>
                <div style={{ height: 4, borderRadius: 99, width: `${(item.score / item.max) * 100}%`, background: item.color, transition: "width 0.6s" }} />
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        {(() => {
          const rawRate = actualSavingsRate !== null ? actualSavingsRate : Math.round(rawBreakdown.savings.rate * 100);
          const isDeepDeficit = rawRate < -100;
          const savingsDisplay = isDeepDeficit ? null : rawRate; // null → custom label
          const savingsColor = rawRate < 0 ? C.red : rawRate < 10 ? C.yellow : C.cyan;
          return [
            { label: "Savings Rate", value: savingsDisplay, display: isDeepDeficit ? "In deficit" : null, color: savingsColor },
            { label: "Budget Used", value: budgetUsedPct, color: budgetUsedPct > 100 ? C.red : budgetUsedPct > 70 ? C.yellow : C.cyan },
            { label: "Recurring", value: Math.min(99, Math.round(rawBreakdown.recurring.ratio * 100)), color: rawBreakdown.recurring.ratio > 0.25 ? C.red : rawBreakdown.recurring.ratio > 0.1 ? C.yellow : C.purple },
          ];
        })().map(item => (
          <div key={item.label} style={{ flex: 1, background: C.bgTertiary, borderRadius: 12, padding: "10px 8px", textAlign: "center" }}>
            <div style={{ fontSize: item.display ? 11 : 16, fontWeight: 700, color: item.color }}>{item.display ?? (item.value === null ? "N/A" : item.value + "%")}</div>
            <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>{item.label}</div>
          </div>
        ))}
      </div>
    </GlassCard>
  );
}

function WeeklySummary({ transactions }) {
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
    if (idx >= 0 && idx < 7) dailyTotals[idx] += Number(t.amount);
  });

  const thisWeek = dailyTotals.reduce((s, v) => s + v, 0);
  if (thisWeek === 0) return null;

  const lastWeek = transactions
    .filter(t => t.type === "expense" && t.category_name !== "Transfer" && parseDate(t.date) >= startOfLastWeek && parseDate(t.date) < startOfWeek)
    .reduce((s, t) => s + Number(t.amount), 0);

  const change = lastWeek > 0 ? ((thisWeek - lastWeek) / lastWeek) * 100 : null;
  const pos = change !== null && change <= 0;

  const maxDay = Math.max(...dailyTotals, 1);
  const DAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];
  const todayLabel = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][todayIdx];

  // Top category
  const catMap = {};
  thisWeekTxs.forEach(t => { const k = t.category_name || "Other"; catMap[k] = (catMap[k] || 0) + Number(t.amount); });
  const topCat = Object.entries(catMap).sort((a, b) => b[1] - a[1])[0];

  return (
    <GlassCard style={{ background: `linear-gradient(135deg,${C.blue}10,${C.card})`, border: `1px solid ${C.blue}30` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <div style={{ width: 32, height: 32, borderRadius: 10, background: C.blue + "22", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icon name="calendar" size={15} color={C.blue} />
        </div>
        <span style={{ fontWeight: 600, fontSize: 14, color: C.blue }}>This Week</span>
        {change !== null && (
          <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 600, color: pos ? C.green : C.red }}>
            {pos ? "↓" : "↑"}{Math.abs(change).toFixed(0)}% vs last week
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

      <div style={{ fontSize: 22, fontWeight: 800, color: C.text, marginBottom: 3 }}>${fmt(thisWeek)}</div>
      <div style={{ fontSize: 12, color: C.muted }}>
        Mon–{todayLabel}{topCat ? ` · mostly ${topCat[0]}` : ""}
      </div>
    </GlassCard>
  );
}

// Keywords that disqualify a merchant from appearing in either recurring section.
// Uses word-boundary padding (" name ") to avoid false partial matches.
const RECURRING_EXCLUDE = [
  // Credit card / bank payments
  "card payment","ccpymt","credit card","card online","online des:payment",
  "mobile banking","online banking","online payment","payment to ",
  // Person-to-person transfers
  "zelle","venmo","cash app","paypal",
  // Groceries & wholesale
  "trader joe","walmart","costco","grocery","grocer","supermarket",
  "safeway","kroger","albertsons","publix","aldi","whole food","sprouts",
  // General retail
  "home depot","dollar tree","dollar general","dollar store",
  "petsmart","petco","jcpenny","jcpenney","marshalls","tj maxx","ross store",
  "big lots","five below","amazon",
  // Restaurants & fast food
  "mcdonald","starbucks","chipotle","dunkin","taco bell","wendy",
  "burger king","pizza hut","domino","restaurant","bistro","diner",
  // Gas stations
  "chevron","exxon","mobil","arco","fuel",
];

// Shell matches too broadly with padding, check it as a whole-word match separately
function isRecurringExcluded(name) {
  const n = " " + name.toLowerCase() + " ";
  if (/ shell /.test(n)) return true;
  return RECURRING_EXCLUDE.some(k => n.includes(k));
}

function RecurringSummary({ transactions }) {
  // Group by merchant across calendar months — only flag if seen in 2+ distinct months
  const map = {};
  transactions
    .filter(t => t.type === "expense" && t.category_name !== "Transfer")
    .forEach(t => {
      const raw = (t.description || t.category_name || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40);
      if (!raw || raw.length < 3) return;
      const d = parseDate(t.date);
      const monthKey = `${d.getFullYear()}-${d.getMonth()}`;
      if (!map[raw]) map[raw] = { name: t.description || t.category_name || raw, months: new Set(), amounts: [], total: 0 };
      map[raw].months.add(monthKey);
      map[raw].amounts.push(Number(t.amount));
      map[raw].total += Number(t.amount);
    });

  const candidates = Object.values(map)
    .filter(m => m.months.size >= 2 && !isRecurringExcluded(m.name))
    .map(m => {
      const sorted = m.amounts.slice().sort((a, b) => a - b);
      const spread = sorted[sorted.length - 1] - sorted[0];
      return { name: m.name, months: m.months.size, avgMonthly: m.total / m.months.size, spread };
    })
    .sort((a, b) => b.avgMonthly - a.avgMonthly);

  // Subscriptions: consistent amount (spread ≤ $0.50) and under $100/mo
  const subscriptions   = candidates.filter(m => m.avgMonthly <  100 && m.spread <= 0.50);
  // Regular Payments: ≥ $100/mo fixed bills (rent, loan, insurance — no strict spread needed)
  const regularPayments = candidates.filter(m => m.avgMonthly >= 100);

  if (subscriptions.length === 0 && regularPayments.length === 0) return null;

  const subTotal     = subscriptions.reduce((s, m)   => s + m.avgMonthly, 0);
  const regularTotal = regularPayments.reduce((s, m) => s + m.avgMonthly, 0);

  function Section({ title, items, color, total, icon }) {
    if (items.length === 0) return null;
    return (
      <GlassCard style={{ background: `linear-gradient(135deg,${color}0D,${C.card})`, border: `1px solid ${color}30` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 10, background: color + "22", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name={icon} size={14} color={color} />
          </div>
          <span style={{ fontWeight: 600, fontSize: 14, color }}>{title}</span>
          <span style={{ marginLeft: "auto", fontSize: 14, fontWeight: 800, color }}>${fmt(total)}/mo</span>
        </div>
        {items.slice(0, 6).map((m, i) => (
          <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderTop: `1px solid ${C.sep}` }}>
            <span style={{ fontSize: 13, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, paddingRight: 8 }}>{m.name}</span>
            <span style={{ fontSize: 12, color: C.muted, flexShrink: 0 }}>{m.months} mo · <span style={{ color, fontWeight: 600 }}>${fmt(m.avgMonthly)}/mo</span></span>
          </div>
        ))}
      </GlassCard>
    );
  }

  return (
    <>
      <Section title="Subscriptions"    items={subscriptions}   color={C.purple} total={subTotal}     icon="repeat" />
      <Section title="Regular Payments" items={regularPayments} color={C.blue}   total={regularTotal} icon="file"   />
    </>
  );
}

function AuthScreen({ onAuth }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [resent, setResent] = useState(false);

  function friendlyError(msg) {
    if (!msg) return msg;
    if (msg.toLowerCase().includes("missing email or phone")) return "Email is required.";
    if (msg.toLowerCase().includes("invalid login credentials")) return "Incorrect email or password.";
    if (msg.toLowerCase().includes("email not confirmed")) return "Please confirm your email first.";
    return msg;
  }

  async function handleSubmit(e) {
    if (e) e.preventDefault();
    setError(""); setMsg(""); setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: name }, emailRedirectTo: 'https://app.arkonomy.com' } });
        if (error) throw error;
        setMsg("Check your email to confirm your account!");
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        onAuth(data.user);
      }
    } catch (e) { setError(friendlyError(e.message)); }
    finally { setLoading(false); }
  }

  async function handleResend() {
    setLoading(true);
    try {
      const { error } = await supabase.auth.resend({ type: "signup", email, options: { emailRedirectTo: 'https://app.arkonomy.com' } });
      if (error) throw error;
      setResent(true);
    } catch (e) { setError(friendlyError(e.message)); }
    finally { setLoading(false); }
  }

  async function handleForgotPassword() {
    setError(""); setMsg("");
    if (!email) { setError("Enter your email above, then tap Forgot password."); return; }
    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: 'https://app.arkonomy.com' });
      if (error) throw error;
      setMsg("Check your email for reset instructions.");
    } catch (e) { setError(friendlyError(e.message)); }
    finally { setLoading(false); }
  }

  const inp = { width: "100%", padding: "14px 16px", background: C.bgSecondary, border: `1px solid ${C.border}`, borderRadius: 14, color: C.text, fontSize: 15, outline: "none", boxSizing: "border-box", fontFamily: FONT };

  return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, fontFamily: FONT }}>
      <div style={{ width: "100%", maxWidth: 380 }}>
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <img src="https://i.postimg.cc/k4tv1XgB/Remove-the-dark-background-completely-make-it-tran-delpmaspu-removebg-preview.png" alt="Arkonomy" style={{ width: 280, height: 140, objectFit: "contain", display: "block", margin: "0 auto 16px" }} />
          <div style={{ fontSize: 22, fontWeight: 300, color: C.cyan, letterSpacing: 8, marginBottom: 4 }}>ARKONOMY</div>
          <div style={{ color: C.faint, fontSize: 11, letterSpacing: 3 }}>YOUR AI FINANCIAL AUTOPILOT</div>
        </div>
        <GlassCard>
          <h2 style={{ color: C.text, margin: "0 0 22px", fontSize: 20, fontWeight: 700 }}>{mode === "login" ? "Welcome back" : "Create account"}</h2>
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {mode === "signup" && <input style={inp} placeholder="Full name" value={name} onChange={e => setName(e.target.value)} autoComplete="name" />}
            <input style={inp} type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" />
            <input style={inp} type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} />
            {mode === "login" && (
              <div style={{ textAlign: "right", marginTop: -4 }}>
                <button type="button" onClick={handleForgotPassword} disabled={loading} style={{ background: "none", border: "none", color: C.cyan, fontSize: 13, cursor: "pointer", padding: 0, fontFamily: FONT, opacity: loading ? 0.5 : 1 }}>
                  Forgot password?
                </button>
              </div>
            )}
            {error && <div style={{ color: C.red, fontSize: 13, background: C.red + "18", padding: "10px 14px", borderRadius: 10 }}>{error}</div>}
            {msg && (
              <div style={{ color: C.green, fontSize: 13, background: C.green + "18", padding: "10px 14px", borderRadius: 10 }}>
                {msg}
                {mode === "signup" && (
                  <div style={{ marginTop: 8 }}>
                    {resent
                      ? <span style={{ color: C.cyan, fontWeight: 600 }}>Email sent!</span>
                      : <button type="button" onClick={handleResend} disabled={loading} style={{ background: "none", border: "none", color: C.cyan, fontSize: 13, cursor: "pointer", padding: 0, fontFamily: FONT, fontWeight: 600, opacity: loading ? 0.5 : 1 }}>Resend confirmation email</button>
                    }
                  </div>
                )}
              </div>
            )}
            <button type="submit" disabled={loading} style={{ width: "100%", marginTop: 8, padding: 15, background: `linear-gradient(90deg,${C.cyan},${C.blue})`, border: "none", borderRadius: 12, color: "#fff", fontWeight: 700, fontSize: 15, cursor: "pointer", opacity: loading ? 0.7 : 1, fontFamily: FONT }}>
              {loading ? "..." : mode === "login" ? "Sign In" : "Create Account"}
            </button>
          </form>
          <div style={{ textAlign: "center", marginTop: 18, color: C.muted, fontSize: 14 }}>
            {mode === "login" ? "No account? " : "Have account? "}
            <span onClick={() => { setMode(mode === "login" ? "signup" : "login"); setEmail(""); setPassword(""); setName(""); setError(""); setMsg(""); }} style={{ color: C.cyan, cursor: "pointer", fontWeight: 600 }}>
              {mode === "login" ? "Sign up free" : "Sign in"}
            </span>
          </div>
        </GlassCard>
      </div>
    </div>
  );
}

// ─── Tutorial ─────────────────────────────────────────────────
const TUTORIAL_STEPS = [
  { selector: '[data-tutorial="net-balance"]',   screen: "dashboard", title: "Your financial snapshot",         description: "See income, expenses and balance at a glance" },
  { selector: '[data-tutorial="health-score"]',  screen: "dashboard", title: "Your financial health score",     description: "Updated daily based on your spending habits" },
  { selector: '[data-tutorial="ai-insight"]',    screen: "dashboard", title: "AI-powered insights",             description: "Tap to see personalized recommendations" },
  { selector: '[data-tutorial="nav-transactions"]', screen: null,     title: "All your transactions",           description: "Automatically synced from your bank" },
  { selector: '[data-tutorial="nav-markets"]',   screen: null,        title: "Invest directly",                 description: "Buy stocks and crypto with spare change" },
  { selector: '[data-tutorial="nav-savings"]',   screen: null,        title: "Track your savings goals",        description: "Automate round-ups and build your wealth" },
  { selector: '[data-tutorial="nav-insights"]',  screen: null,        title: "Deep spending analysis",          description: "See where your money really goes" },
  { selector: '[data-tutorial="ai-chat"]',       screen: null,        title: "Ask anything about your finances", description: "Your personal AI advisor, always on hand" },
];

const MINI_TOURS = {
  "connect-bank": [
    { selector: '[data-tutorial="net-balance"]',  screen: "dashboard", title: "Your balance lives here",          description: "Once your bank is connected, your real balance, income and expenses update automatically" },
    { selector: '[data-tutorial="settings-btn"]', screen: "dashboard", title: "Open Settings to connect",         description: "Tap the gear icon → 'Connect Bank' to securely link your account via Plaid (read-only)" },
    { selector: '[data-tutorial="nav-transactions"]', screen: "dashboard", title: "Transactions sync automatically", description: "After linking, all past and future transactions appear here instantly" },
  ],
  "ai-insights": [
    { selector: '[data-tutorial="ai-insight"]',   screen: "dashboard", title: "Your AI insight card",             description: "After connecting your bank, the AI analyzes your actual spending and generates personalized tips" },
    { selector: '[data-tutorial="nav-insights"]', screen: "dashboard", title: "Full Insights tab",                description: "Deep health score, weekly summaries and spending breakdowns — all powered by AI" },
  ],
  "invest": [
    { selector: '[data-tutorial="nav-markets"]',  screen: "dashboard", title: "Step 1: Browse Markets",           description: "Tap Markets to see live prices for stocks, ETFs and crypto — tap any ticker for charts and AI analysis" },
    { selector: '[data-tutorial="nav-savings"]',  screen: "dashboard", title: "Step 2: Connect Alpaca",           description: "In Savings, connect your Alpaca account to enable automatic investing of your monthly round-ups" },
    { selector: '[data-tutorial="ai-chat"]',      screen: "dashboard", title: "Step 3: Ask AI for picks",         description: "Ask your AI advisor which assets fit your goals and risk profile before investing" },
  ],
  "budget": [
    { selector: '[data-tutorial="health-score"]', screen: "dashboard", title: "Budget drives your score",         description: "Your health score is calculated against your monthly budget — the tighter you stick to it, the higher it goes" },
    { selector: '[data-tutorial="settings-btn"]', screen: "dashboard", title: "Change your budget anytime",       description: "Tap the gear icon, scroll to 'Monthly Budget', and update the amount — changes take effect immediately" },
  ],
};

function TutorialOverlay({ stepIdx, totalSteps, steps, onNext, onSkip }) {
  const config = steps[stepIdx];
  const [rect, setRect] = useState(null);

  useEffect(() => {
    setRect(null);
    let cancelled = false;
    const tryFind = (attempt = 0) => {
      if (cancelled) return;
      const el = document.querySelector(config.selector);
      if (el) {
        el.scrollIntoView({ block: "nearest", behavior: "smooth" });
        setTimeout(() => {
          if (cancelled) return;
          const r = el.getBoundingClientRect();
          setRect({ top: r.top, left: r.left, width: r.width, height: r.height, bottom: r.bottom, right: r.right });
        }, 150);
      } else if (attempt < 20) {
        setTimeout(() => tryFind(attempt + 1), 100);
      }
    };
    setTimeout(() => tryFind(), 250);
    return () => { cancelled = true; };
  }, [config.selector]);

  const vw = typeof window !== "undefined" ? window.innerWidth : 390;
  const vh = typeof window !== "undefined" ? window.innerHeight : 844;

  if (!rect) return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1000, pointerEvents: "all" }} onClick={onSkip} />
  );

  const PAD = 10;
  const hL = Math.max(0, rect.left - PAD);
  const hT = Math.max(0, rect.top - PAD);
  const hR = Math.min(vw, rect.right + PAD);
  const hB = Math.min(vh, rect.bottom + PAD);
  const hW = hR - hL;
  const hH = hB - hT;

  const tooltipW = Math.min(290, vw - 32);
  const tooltipH = 175;
  const gap = 14;
  const above = (vh - hB - gap) < (tooltipH + 20);
  const tY = Math.max(8, above ? hT - gap - tooltipH : hB + gap);
  const tX = Math.max(16, Math.min(hL + hW / 2 - tooltipW / 2, vw - tooltipW - 16));

  const arrowX = Math.max(tX + 12, Math.min(hL + hW / 2 - 8, tX + tooltipW - 24));
  const arrowY = above ? tY + tooltipH : tY - 10;
  const bg = "rgba(0,0,0,0.82)";
  const panelBase = { position: "fixed", background: bg, zIndex: 1000, pointerEvents: "all", cursor: "default" };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, pointerEvents: "none" }}>
      {/* Dark panels surrounding the spotlight */}
      <div style={{ ...panelBase, top: 0, left: 0, right: 0, height: hT }} onClick={onSkip} />
      <div style={{ ...panelBase, top: hB, left: 0, right: 0, bottom: 0 }} onClick={onSkip} />
      <div style={{ ...panelBase, top: hT, left: 0, width: hL, height: hH }} onClick={onSkip} />
      <div style={{ ...panelBase, top: hT, left: hR, right: 0, height: hH }} onClick={onSkip} />

      {/* Highlight ring */}
      <div style={{
        position: "fixed", top: hT, left: hL, width: hW, height: hH,
        border: "2px solid #00C2FF", borderRadius: 14,
        boxShadow: "0 0 0 4px rgba(0,194,255,0.12), 0 0 28px rgba(0,194,255,0.35)",
        zIndex: 1001, pointerEvents: "none",
      }} />

      {/* Arrow */}
      <div style={{
        position: "fixed", left: arrowX, top: arrowY,
        width: 0, height: 0, zIndex: 1002, pointerEvents: "none",
        borderLeft: "8px solid transparent", borderRight: "8px solid transparent",
        ...(above ? { borderTop: "10px solid #111E33" } : { borderBottom: "10px solid #111E33" }),
      }} />

      {/* Tooltip */}
      <div style={{
        position: "fixed", top: tY, left: tX, width: tooltipW,
        background: "#111E33", border: "1px solid #1E2D4A",
        borderRadius: 16, padding: "16px",
        boxShadow: "0 8px 40px rgba(0,0,0,0.75)",
        zIndex: 1002, pointerEvents: "all",
        fontFamily: "'Inter',-apple-system,sans-serif",
      }}>
        <div style={{ fontSize: 10, color: "#4A5E7A", fontWeight: 700, letterSpacing: 1, marginBottom: 8 }}>
          STEP {stepIdx + 1} OF {totalSteps}
        </div>
        <div style={{ fontSize: 15, fontWeight: 800, color: "#fff", marginBottom: 6, lineHeight: 1.3 }}>
          {config.title}
        </div>
        <div style={{ fontSize: 12, color: "#9AA4B2", lineHeight: 1.6, marginBottom: 14 }}>
          {config.description}
        </div>
        <div style={{ display: "flex", gap: 3, marginBottom: 14 }}>
          {Array.from({ length: totalSteps }).map((_, i) => (
            <div key={i} style={{ height: 3, flex: 1, borderRadius: 99, background: i <= stepIdx ? "#00C2FF" : "#1E2D4A", transition: "background 0.3s" }} />
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onSkip} style={{ padding: "7px 14px", borderRadius: 8, border: "1px solid #1E2D4A", background: "none", color: "#4A5E7A", fontSize: 12, fontWeight: 500, cursor: "pointer", fontFamily: "'Inter',-apple-system,sans-serif" }}>
            Skip
          </button>
          <button onClick={onNext} style={{ padding: "7px 18px", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#00C2FF,#2F80FF)", color: "#000", fontSize: 12, fontWeight: 800, cursor: "pointer", fontFamily: "'Inter',-apple-system,sans-serif" }}>
            {stepIdx === totalSteps - 1 ? "Done ✓" : "Next →"}
          </button>
        </div>
      </div>
    </div>
  );
}

function HelpButton({ onRestart, onMiniTour }) {
  const [open, setOpen] = useState(false);
  const items = [
    { label: "Restart tutorial",        action: () => onRestart() },
    { label: "How to connect bank",     action: () => onMiniTour("connect-bank"), divider: true },
    { label: "How AI insights work",    action: () => onMiniTour("ai-insights") },
    { label: "How to invest",           action: () => onMiniTour("invest") },
    { label: "How to set budget",       action: () => onMiniTour("budget") },
  ];
  return (
    <>
      {open && <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 148 }} />}
      {open && (
        <div style={{
          position: "fixed", bottom: 114, left: "max(16px,calc((100vw - 430px)/2 + 16px))",
          background: "#111E33", border: "1px solid #1E2D4A",
          borderRadius: 14, padding: "6px 0", zIndex: 150,
          boxShadow: "0 8px 32px rgba(0,0,0,0.6)", minWidth: 228,
          fontFamily: "'Inter',-apple-system,sans-serif",
        }}>
          {items.map((item, i) => (
            <button key={i} onClick={() => { setOpen(false); item.action(); }} style={{
              display: "block", width: "100%", textAlign: "left",
              padding: "10px 16px", background: "none",
              border: "none",
              borderTop: item.divider ? "1px solid #1E2D4A" : "none",
              color: i === 0 ? "#00C2FF" : "#9AA4B2",
              fontSize: 13, fontWeight: i === 0 ? 700 : 400,
              cursor: "pointer", fontFamily: "'Inter',-apple-system,sans-serif",
            }}>
              {i === 0 ? "▶  " : "→  "}{item.label}
            </button>
          ))}
        </div>
      )}
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          position: "fixed", bottom: 70,
          left: "max(16px,calc((100vw - 430px)/2 + 16px))",
          width: 36, height: 36, borderRadius: "50%",
          background: open ? "#1E2D4A" : "#111E33",
          border: "1px solid #1E2D4A",
          color: open ? "#00C2FF" : "#9AA4B2",
          fontSize: 15, fontWeight: 800,
          cursor: "pointer", zIndex: 149,
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: "0 2px 16px rgba(0,0,0,0.4)",
          transition: "background 0.2s, color 0.2s",
        }}
      >
        ?
      </button>
    </>
  );
}

// ─── Onboarding ───────────────────────────────────────────────
function OnboardingFlow({ user, profile, linkToken, getLinkToken, onPlaidSuccess, onSaveProfile, onDone }) {
  const [step, setStep] = useState(1);
  const [budget, setBudget] = useState("3000");
  const [savingBudget, setSavingBudget] = useState(false);
  const TOTAL_STEPS = 4;

  const name = profile?.full_name?.split(" ")[0] || user?.user_metadata?.full_name?.split(" ")[0] || "there";

  const dots = (
    <div style={{ display: "flex", justifyContent: "center", gap: 8, marginBottom: 36 }}>
      {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
        <div key={i} style={{
          width: i + 1 === step ? 22 : 8, height: 8,
          borderRadius: 99,
          background: i + 1 <= step ? C.cyan : C.border,
          transition: "all 0.3s",
        }} />
      ))}
    </div>
  );

  const wrap = (children) => (
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", padding: "24px 20px", fontFamily: FONT }}>
      <div style={{ width: "100%", maxWidth: 390 }}>
        {dots}
        {children}
      </div>
    </div>
  );

  // ── Step 1: Welcome ───────────────────────────────────────────
  if (step === 1) return wrap(
    <div style={{ textAlign: "center" }}>
      <div style={{
        width: 80, height: 80, borderRadius: 24, margin: "0 auto 24px",
        background: `linear-gradient(135deg, ${C.cyan}33, ${C.blue}22)`,
        border: `1px solid ${C.cyan}44`,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <svg width={36} height={36} viewBox="0 0 24 24" fill="none" stroke={C.cyan} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
        </svg>
      </div>
      <div style={{ fontSize: 26, fontWeight: 800, color: C.text, marginBottom: 10, lineHeight: 1.2 }}>
        Welcome to Arkonomy,<br />{name}!
      </div>
      <div style={{ fontSize: 15, color: C.muted, lineHeight: 1.65, marginBottom: 40, maxWidth: 300, margin: "0 auto 40px" }}>
        Your AI financial autopilot. Connect your bank and get instant insights into your spending, savings, and financial health.
      </div>
      <button
        onClick={() => setStep(2)}
        style={{ width: "100%", padding: 16, background: `linear-gradient(135deg, ${C.cyan}, ${C.blue})`, border: "none", borderRadius: 16, color: "#000", fontWeight: 800, fontSize: 16, cursor: "pointer", fontFamily: FONT, boxShadow: `0 4px 24px ${C.cyan}44` }}
      >
        Get Started
      </button>
    </div>
  );

  // ── Step 2: Connect Bank ──────────────────────────────────────
  if (step === 2) return wrap(
    <div>
      <div style={{ textAlign: "center", marginBottom: 32 }}>
        <div style={{
          width: 72, height: 72, borderRadius: 22, margin: "0 auto 20px",
          background: "rgba(26,86,219,0.15)", border: "1px solid rgba(26,86,219,0.3)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <svg width={32} height={32} viewBox="0 0 24 24" fill="none" stroke="#2F80FF" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="22" x2="21" y2="22"/>
            <line x1="6" y1="18" x2="6" y2="11"/>
            <line x1="10" y1="18" x2="10" y2="11"/>
            <line x1="14" y1="18" x2="14" y2="11"/>
            <line x1="18" y1="18" x2="18" y2="11"/>
            <polygon points="12 2 20 7 4 7"/>
          </svg>
        </div>
        <div style={{ fontSize: 22, fontWeight: 800, color: C.text, marginBottom: 10 }}>Connect your bank</div>
        <div style={{ fontSize: 14, color: C.muted, lineHeight: 1.65 }}>
          Securely link your account via Plaid. Read-only access — Arkonomy can never move money.
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
        {["Instant transaction sync", "AI spending analysis", "Automatic recurring detection"].map(f => (
          <div key={f} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: C.bgSecondary, borderRadius: 12, border: `1px solid ${C.border}` }}>
            <div style={{ width: 20, height: 20, borderRadius: "50%", background: C.green + "22", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke={C.green} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </div>
            <span style={{ fontSize: 13, color: C.text }}>{f}</span>
          </div>
        ))}
      </div>

      {linkToken ? (
        <PlaidLinkButton
          linkToken={linkToken}
          onSuccess={async (tok, meta) => { await onPlaidSuccess(tok, meta); setStep(3); }}
          onExit={() => {}}
          autoOpen={false}
        />
      ) : (
        <button
          className="pulse-connect-bank"
          onClick={getLinkToken}
          style={{ width: "100%", padding: 16, background: `linear-gradient(135deg,#1A56DB,#2F80FF)`, border: "none", borderRadius: 16, color: "#fff", fontWeight: 800, fontSize: 16, cursor: "pointer", fontFamily: FONT, boxShadow: "0 4px 20px rgba(26,86,219,0.4)" }}
        >
          Connect Your Bank
        </button>
      )}

      <button
        onClick={() => setStep(3)}
        style={{ width: "100%", marginTop: 12, padding: "12px", background: "none", border: `1px solid ${C.border}`, borderRadius: 14, color: C.muted, fontWeight: 500, fontSize: 14, cursor: "pointer", fontFamily: FONT }}
      >
        Skip for now
      </button>
    </div>
  );

  // ── Step 3: Set Budget ────────────────────────────────────────
  if (step === 3) return wrap(
    <div>
      <div style={{ textAlign: "center", marginBottom: 32 }}>
        <div style={{
          width: 72, height: 72, borderRadius: 22, margin: "0 auto 20px",
          background: C.green + "18", border: `1px solid ${C.green}33`,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <svg width={32} height={32} viewBox="0 0 24 24" fill="none" stroke={C.green} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
          </svg>
        </div>
        <div style={{ fontSize: 22, fontWeight: 800, color: C.text, marginBottom: 10 }}>Set your monthly budget</div>
        <div style={{ fontSize: 14, color: C.muted, lineHeight: 1.65 }}>
          We'll track your spending against this and alert you when you're getting close.
        </div>
      </div>

      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 12, color: C.muted, fontWeight: 500, marginBottom: 8 }}>Monthly budget (USD)</div>
        <div style={{ position: "relative" }}>
          <span style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", fontSize: 18, fontWeight: 700, color: C.text }}>$</span>
          <input
            type="number"
            value={budget}
            onChange={e => setBudget(e.target.value)}
            style={{ width: "100%", padding: "16px 16px 16px 34px", background: C.bgSecondary, border: `2px solid ${C.cyan}44`, borderRadius: 14, color: C.text, fontSize: 22, fontWeight: 700, outline: "none", fontFamily: FONT, boxSizing: "border-box" }}
            placeholder="3000"
          />
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          {["1500", "2500", "3000", "5000"].map(v => (
            <button key={v} onClick={() => setBudget(v)}
              style={{ flex: 1, padding: "7px 0", borderRadius: 10, border: `1px solid ${budget === v ? C.cyan + "66" : C.border}`, background: budget === v ? C.cyan + "18" : C.bgSecondary, color: budget === v ? C.cyan : C.muted, fontSize: 12, fontWeight: budget === v ? 700 : 400, cursor: "pointer", fontFamily: FONT }}>
              ${v}
            </button>
          ))}
        </div>
      </div>

      <button
        onClick={async () => {
          setSavingBudget(true);
          const val = Math.max(100, Number(budget) || 3000);
          await onSaveProfile({ monthly_budget: val });
          setSavingBudget(false);
          setStep(4);
        }}
        disabled={savingBudget}
        style={{ width: "100%", padding: 16, background: `linear-gradient(135deg, ${C.green}, ${C.cyan})`, border: "none", borderRadius: 16, color: "#000", fontWeight: 800, fontSize: 16, cursor: "pointer", fontFamily: FONT, opacity: savingBudget ? 0.7 : 1 }}
      >
        {savingBudget ? "Saving..." : "Looks good"}
      </button>
    </div>
  );

  // ── Step 4: Done ──────────────────────────────────────────────
  return wrap(
    <div style={{ textAlign: "center" }}>
      <div style={{
        width: 88, height: 88, borderRadius: 28, margin: "0 auto 28px",
        background: `linear-gradient(135deg, ${C.green}33, ${C.cyan}22)`,
        border: `1px solid ${C.green}44`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 40,
      }}>
        🎉
      </div>
      <div style={{ fontSize: 28, fontWeight: 800, color: C.text, marginBottom: 12 }}>You're all set!</div>
      <div style={{ fontSize: 15, color: C.muted, lineHeight: 1.65, marginBottom: 44 }}>
        Your financial autopilot is ready. Head to your dashboard to see your insights.
      </div>
      <button
        onClick={onDone}
        style={{ width: "100%", padding: 16, background: `linear-gradient(135deg, ${C.cyan}, ${C.blue})`, border: "none", borderRadius: 16, color: "#000", fontWeight: 800, fontSize: 16, cursor: "pointer", fontFamily: FONT, boxShadow: `0 4px 24px ${C.cyan}44` }}
      >
        Go to Dashboard
      </button>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────
export default function App() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [screen, setScreen] = useState("dashboard");
  const [transactions, setTransactions] = useState([]);
  const [categories, setCategories] = useState([]);
  const [savings, setSavings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddTx, setShowAddTx] = useState(false);
  const [editTx, setEditTx] = useState(null);
  const [catFilter, setCatFilter] = useState(null);
  const [chatMessages, setChatMessages] = useState([{ role: "assistant", text: "Hi! I'm your Arkonomy AI assistant. Ask me anything about your finances." }]);
  const [chatInput, setChatInput] = useState("");
  const [autopilot, setAutopilot] = useState(() => {
    try {
      const saved = localStorage.getItem("arkonomy_autopilot");
      if (saved) return { overspendAlerts: true, largeTxAlerts: true, unusualSpending: true, largeTxThreshold: 200, lowBalanceAlerts: true, lowBalanceThreshold: 500, ...JSON.parse(saved) };
    } catch {}
    return { overspendAlerts: true, largeTxAlerts: true, unusualSpending: true, largeTxThreshold: 200, lowBalanceAlerts: true, lowBalanceThreshold: 500 };
  });
  const { toasts: alertToasts, show: showAlert, dismiss: dismissAlert } = useToasts();
  // Refs keep addTransaction (async) from using stale closures after awaits
  const showAlertRef = useRef(showAlert);
  showAlertRef.current = showAlert;
  // Stable ref to syncBankTransactions so onPlaidSuccess (useCallback [])
  // always calls the current version, not the mount-time stale closure.
  const syncBankTransactionsRef = useRef(null);
  const autopilotRef = useRef(autopilot);
  autopilotRef.current = autopilot;

  // ─── Plaid state ──────────────────────────────────────────────
  const [linkToken, setLinkToken] = useState(null);
  const [bankConnected, setBankConnected] = useState(false);
  const [bankName, setBankName] = useState(null);
  const [bankCount, setBankCount] = useState(0);
  const [syncingBank, setSyncingBank] = useState(false);
  const [alpacaToast, setAlpacaToast] = useState(null);
  const [alpacaConnected, setAlpacaConnected] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [proToast, setProToast] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [onboardingDone, setOnboardingDone] = useState(() => {
    try { return !!localStorage.getItem("arkonomy_onboarding_done"); } catch { return false; }
  });
  const [upcomingCharges, setUpcomingCharges] = useState([]);
  const [marketInitSymbol, setMarketInitSymbol] = useState(null);
  const [lastSyncedAt, setLastSyncedAt] = useState(() => {
    try { return localStorage.getItem("arkonomy_last_synced") || null; } catch { return null; }
  });
  const [backgroundSyncing, setBackgroundSyncing] = useState(false);
  const bgSyncRef = useRef(null);
  const [tutorialActive, setTutorialActive] = useState(false);
  const [tutorialStepIdx, setTutorialStepIdx] = useState(0);
  const [activeTourSteps, setActiveTourSteps] = useState(TUTORIAL_STEPS);
  const [chatBounced, setChatBounced] = useState(() => { try { return !!localStorage.getItem("arkonomy_chat_bounced"); } catch { return false; } });
  const tutorialStartedRef = useRef(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => { setUser(session?.user ?? null); setLoading(false); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => setUser(session?.user ?? null));
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => { if (user) { loadAll(); checkBankConnection(); } }, [user]);

  // Android back button: navigate to dashboard instead of closing the app
  useEffect(() => {
    let handler;
    CapApp.addListener("backButton", ({ canGoBack }) => {
      if (showChat) { setShowChat(false); return; }
      if (screen !== "dashboard") { setScreen("dashboard"); return; }
      // On dashboard with no modals, allow the OS to minimize (do nothing — Android handles it)
    }).then(h => { handler = h; });
    return () => { handler?.remove(); };
  }, [screen, showChat]);

  // Detect return from Stripe checkout or Alpaca OAuth
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    if (params.get("upgraded") === "true") {
      setProToast(true);
      window.history.replaceState({}, "", window.location.pathname);
      setTimeout(() => { if (user) loadAll(); }, 2000);
      setTimeout(() => setProToast(false), 6000);
    }

    if (params.get("alpaca_connected") === "true") {
      window.history.replaceState({}, "", window.location.pathname);
      // Refresh profile to pick up the new alpaca_access_token
      setTimeout(() => { if (user) loadAll(); }, 500);
      setAlpacaToast({ alpacaSuccess: true });
      setTimeout(() => setAlpacaToast(null), 5000);
    }

    if (params.get("alpaca_error")) {
      const errCode = params.get("alpaca_error");
      window.history.replaceState({}, "", window.location.pathname);
      const msgs = {
        missing_code:        "Alpaca connection cancelled.",
        token_exchange_failed: "Alpaca login failed — please try again.",
        auth_failed:         "Could not verify your session. Please log in again.",
        server_misconfigured: "Alpaca is not configured yet. Contact support.",
        network_error:       "Network error connecting to Alpaca.",
      };
      setAlpacaToast({ error: msgs[errCode] ?? `Alpaca error: ${errCode}` });
      setTimeout(() => setAlpacaToast(null), 6000);
    }
  }, []);

  // Register push notifications (no-op until VAPID key is configured)
  usePushNotifications(supabase, user?.id);

  // Persist autopilot toggles across reloads
  useEffect(() => {
    try { localStorage.setItem("arkonomy_autopilot", JSON.stringify(autopilot)); } catch {}
  }, [autopilot]);

  // Auto-sync on load: fires once when bank connection is confirmed
  useEffect(() => {
    if (bankConnected && !loading && user) {
      // Small delay so loadAll() can finish painting the UI first
      const t = setTimeout(() => bgSyncRef.current?.(), 1500);
      return () => clearTimeout(t);
    }
  }, [bankConnected, loading]);

  // Auto-sync every 4 hours
  useEffect(() => {
    if (!bankConnected || !user) return;
    const id = setInterval(() => bgSyncRef.current?.(), 4 * 60 * 60 * 1000);
    return () => clearInterval(id);
  }, [bankConnected, user]);

  // Auto-start tutorial once for users who haven't completed it
  useEffect(() => {
    if (!profile || loading) return;
    if (profile.tutorial_completed) return;
    if (tutorialActive || tutorialStartedRef.current) return;
    const stillOnboarding = !onboardingDone && transactions.length === 0 && !bankConnected;
    if (stillOnboarding) return;
    tutorialStartedRef.current = true;
    setTimeout(() => {
      setActiveTourSteps(TUTORIAL_STEPS);
      setTutorialStepIdx(0);
      setScreen("dashboard");
      setTutorialActive(true);
    }, 900);
  }, [profile, loading, onboardingDone, transactions.length, bankConnected]);

  async function loadAll() {
    setLoading(true);
    const [p, t, c, sv] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", user.id).single(),
      supabase.from("transactions").select("*").eq("user_id", user.id).order("date", { ascending: false }),
      supabase.from("categories").select("*").eq("user_id", user.id),
      supabase.from("savings").select("*").eq("user_id", user.id),
    ]);
    if (p.data) {
      setProfile(p.data);
      setAlpacaConnected(!!p.data.alpaca_access_token);
      if (p.data.last_synced_at) {
        setLastSyncedAt(p.data.last_synced_at);
        try { localStorage.setItem("arkonomy_last_synced", p.data.last_synced_at); } catch {}
      }
    }
    if (t.data) {
      setTransactions(t.data);
      // Detect recurring charges from loaded transactions
      const detected = detectRecurringCharges(t.data);
      setUpcomingCharges(detected);
      if (detected.length > 0) {
        console.log('[Arkonomy] Detected recurring charges:', detected);
      }
    }
    if (sv.data) setSavings(sv.data);
    if (c.data) { setCategories(c.data); if (c.data.length === 0) await seedCategories(); }
    setLoading(false);
  }

  async function checkBankConnection() {
    const { data } = await supabase
      .from("plaid_items")
      .select("institution_name")
      .eq("user_id", user.id);
    if (data && data.length > 0) {
      setBankConnected(true);
      setBankName(data[0].institution_name);
      setBankCount(data.length);
    }
  }

  async function getLinkToken() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      // Only send redirect_uri in native Capacitor context where deep link
      // OAuth handling is active. In a browser, the URI must be registered
      // in the Plaid Dashboard before it can be used — omitting it lets the
      // web flow work for all banks without that prerequisite.
      const isNative = typeof window !== "undefined" && Boolean(window.Capacitor);
      const body = isNative ? { redirect_uri: PLAID_REDIRECT_URI } : {};
      const res = await fetch(
        `${SUPABASE_URL}/functions/v1/plaid-link-token`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${session.access_token}`,
            "apikey": SUPABASE_KEY,
          },
          body: JSON.stringify(body),
        }
      );
      const data = await res.json();
      if (data.link_token) {
        setLinkToken(data.link_token);
      } else {
        const msg = data.error ?? data.message ?? "Failed to start bank connection";
        console.error("[Plaid] getLinkToken error:", data);
        showAlert(msg, "danger", "alert-circle");
      }
    } catch (err) {
      console.error("[Plaid] getLinkToken exception:", err);
      showAlert("Could not connect to bank service. Try again.", "danger", "alert-circle");
    }
  }

  const onPlaidSuccess = useCallback(async (public_token, metadata) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const exchangeRes = await fetch(
        `${SUPABASE_URL}/functions/v1/plaid-exchange-token`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${session.access_token}`,
            "apikey": SUPABASE_KEY,
          },
          body: JSON.stringify({
            public_token,
            institution_name: metadata.institution.name,
            institution_id: metadata.institution.institution_id,
          }),
        }
      );
      const exchangeData = await exchangeRes.json();
      if (!exchangeRes.ok || exchangeData.error) {
        console.error("[Plaid] exchange-token error:", exchangeData);
        showAlertRef.current(exchangeData.error ?? "Bank connection failed", "danger", "alert-circle");
        return;
      }
    } catch (err) {
      console.error("[Plaid] exchange-token exception:", err);
      showAlertRef.current("Bank connection failed. Try again.", "danger", "alert-circle");
      return;
    }
    setBankConnected(true);
    setBankName(metadata.institution.name);
    setLinkToken(null);
    await syncBankTransactionsRef.current();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function syncBankTransactions() {
    setSyncingBank(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        `${SUPABASE_URL}/functions/v1/plaid-sync-transactions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${session.access_token}`,
            "apikey": SUPABASE_KEY,
          },
        }
      );
      const data = await res.json();
      if (data.error) {
        console.error("[Plaid] sync-transactions error:", data);
      }
      // Always reload — even if synced=0 the user may have just connected
      // and needs to see existing transactions. Also covers the case where
      // the response is an error object (data.synced would be undefined).
      const now = new Date().toISOString();
      setLastSyncedAt(now);
      try { localStorage.setItem("arkonomy_last_synced", now); } catch {}
      supabase.from("profiles").update({ last_synced_at: now }).eq("id", user.id);
      await loadAll();
    } catch (err) {
      console.error("[Plaid] sync-transactions exception:", err);
      await loadAll();
    }
    setSyncingBank(false);
  }
  syncBankTransactionsRef.current = syncBankTransactions;

  // Background (silent) sync — no blocking UI change, just a subtle indicator
  async function bgSync() {
    if (backgroundSyncing || syncingBank) return;
    setBackgroundSyncing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const res = await fetch(`${SUPABASE_URL}/functions/v1/plaid-sync-transactions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`,
          "apikey": SUPABASE_KEY,
        },
      });
      const data = await res.json();
      if (!data.error) {
        const now = new Date().toISOString();
        setLastSyncedAt(now);
        try { localStorage.setItem("arkonomy_last_synced", now); } catch {}
        supabase.from("profiles").update({ last_synced_at: now }).eq("id", user.id);
        // Only reload UI if new data came in
        if ((data.synced ?? 0) > 0) await loadAll();
      }
    } catch (err) {
      console.error("[bgSync] error:", err);
    } finally {
      setBackgroundSyncing(false);
    }
  }
  bgSyncRef.current = bgSync;

  async function seedCategories() {
    const defaults = [
      { name: "Food & Dining", icon: "food", color: "#FF6B6B", budget: 600 },
      { name: "Transport", icon: "car", color: "#4ECDC4", budget: 300 },
      { name: "Shopping", icon: "shopping", color: "#F59E0B", budget: 400 },
      { name: "Entertainment", icon: "film", color: "#A78BFA", budget: 200 },
      { name: "Health", icon: "heart", color: "#F472B6", budget: 150 },
      { name: "Bills", icon: "file", color: "#60A5FA", budget: 800 },
    ];
    const { data } = await supabase.from("categories").insert(defaults.map(d => ({ ...d, user_id: user.id }))).select();
    if (data) setCategories(data);
  }

  async function signOut() {
    await supabase.auth.signOut();
    setUser(null); setProfile(null); setTransactions([]); setCategories([]); setSavings([]);
  }

  async function addTransaction(tx) {
    // Auto-assign category from description keywords if none provided
    if (!tx.category_name) {
      const guessed = guessCategory(tx.description, tx.type);
      if (guessed) { tx = { ...tx, category_name: guessed }; }
    }
    const { data } = await supabase.from("transactions").insert({ user_id: user.id, ...tx }).select().single();
    if (data) {
      // Update state first (pure — no side effects inside the updater)
      setTransactions(prev => [data, ...prev]);

      // ── Alert checks (run outside state updater so showAlert fires reliably) ──
      // autopilotRef.current used instead of autopilot to avoid stale closure after await
      if (tx.type === "expense") {
        const ap = autopilotRef.current;
        const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0,0,0,0);
        // Use current transactions + newly saved one for accurate totals
        const allTx = [data, ...transactions];
        const monthlyExpenses = allTx
          .filter(t => t.type === "expense" && new Date(t.date) >= monthStart)
          .reduce((s, t) => s + Number(t.amount), 0);
        const budget = profile?.monthly_budget || 3000;
        const remaining = budget - monthlyExpenses;

        console.log("[Autopilot] largeTxAlerts:", ap.largeTxAlerts, "amount:", Number(tx.amount), "threshold:", ap.largeTxThreshold);
        console.log("[Autopilot] overspendAlerts:", ap.overspendAlerts, "monthlyExpenses:", monthlyExpenses, "budget:", budget);

        // Helper: send push via fetch with explicit session JWT (avoids SDK auth edge cases)
        const sendPush = async (payload) => {
          try {
            const { data: { session } } = await supabase.auth.getSession();
            const token = session?.access_token ?? SUPABASE_KEY;
            await fetch(`${SUPABASE_URL}/functions/v1/push-notify`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`,
                "apikey": SUPABASE_KEY,
              },
              body: JSON.stringify({ user_id: user?.id, ...payload }),
            });
          } catch { /* fire-and-forget */ }
        };

        // 1. Large Transaction
        if (ap.largeTxAlerts && Number(tx.amount) > ap.largeTxThreshold) {
          showAlertRef.current(`Large transaction: ${fmtMoney(Number(tx.amount))} added to ${tx.category_name || "Uncategorized"}`, "warning", "alert-circle");
          sendPush({ title: "Large Transaction", body: `${fmtMoney(Number(tx.amount))} added to ${tx.category_name || "Uncategorized"}`, icon: "/icon-192.png", tag: "large-tx" });
        }
        // 2. Overspending Alert
        if (ap.overspendAlerts && monthlyExpenses > budget) {
          showAlertRef.current(`You've exceeded your monthly budget by ${fmtMoney(monthlyExpenses - budget)}`, "danger", "alert-circle");
          sendPush({ title: "Budget Exceeded", body: `Monthly spending exceeds your ${fmtMoney(budget)} budget by ${fmtMoney(monthlyExpenses - budget)}`, icon: "/icon-192.png", tag: "budget-exceeded" });
        }
        // 3. Low Balance Alert
        if (ap.lowBalanceAlerts && remaining < ap.lowBalanceThreshold && remaining >= 0) {
          showAlertRef.current(`Low balance warning: ${fmtMoney(remaining)} remaining in budget`, "warning", "dollar");
          sendPush({ title: "Low Balance", body: `${fmtMoney(remaining)} remaining in your monthly budget`, icon: "/icon-192.png", tag: "low-balance" });
        }
      }
    }
    setShowAddTx(false);
  }

  async function deleteTransaction(id) {
    await supabase.from("transactions").delete().eq("id", id);
    setTransactions(prev => prev.filter(t => t.id !== id));
  }

  async function updateTransaction(id, updates) {
    const { data } = await supabase.from("transactions").update(updates).eq("id", id).select().single();
    if (data) setTransactions(prev => prev.map(t => t.id === id ? data : t));
    setEditTx(null);
  }

  async function addSaving(sv) {
    const { data } = await supabase.from("savings").insert({ ...sv, user_id: user.id }).select().single();
    if (data) setSavings(prev => [...prev, data]);
  }

  async function updateSaving(id, current) {
    await supabase.from("savings").update({ current }).eq("id", id);
    setSavings(prev => prev.map(s => s.id === id ? { ...s, current } : s));
  }

  async function editSaving(id, updates) {
    await supabase.from("savings").update(updates).eq("id", id);
    setSavings(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
  }

  async function deleteSaving(id) {
    await supabase.from("savings").delete().eq("id", id);
    setSavings(prev => prev.filter(s => s.id !== id));
  }

  async function saveProfile(updates) {
    await supabase.from("profiles").update(updates).eq("id", user.id);
    setProfile(prev => ({ ...prev, ...updates }));
  }

  function startTutorial() {
    setActiveTourSteps(TUTORIAL_STEPS);
    setTutorialStepIdx(0);
    setScreen("dashboard");
    setTutorialActive(true);
  }

  function startMiniTour(tourId) {
    const steps = MINI_TOURS[tourId];
    if (!steps) return;
    setActiveTourSteps(steps);
    setTutorialStepIdx(0);
    if (steps[0].screen) setScreen(steps[0].screen);
    setTutorialActive(true);
  }

  function advanceTutorial() {
    const nextIdx = tutorialStepIdx + 1;
    if (nextIdx >= activeTourSteps.length) {
      finishTutorial();
      return;
    }
    const nextStep = activeTourSteps[nextIdx];
    if (nextStep.screen) setScreen(nextStep.screen);
    setTutorialStepIdx(nextIdx);
  }

  function finishTutorial() {
    setTutorialActive(false);
    setTutorialStepIdx(0);
    supabase.from("profiles").update({ tutorial_completed: true }).eq("id", user.id).then(() => {
      setProfile(p => p ? { ...p, tutorial_completed: true } : p);
    });
  }

  const now = new Date();
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

  // Если текущий месяц пустой — показываем последний активный месяц
  const rawThisMonth = transactions.filter(t => { const d = parseDate(t.date); return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear(); });
  const lastMonthTxs = transactions.filter(t => { const d = parseDate(t.date); return d.getMonth() === prevMonth.getMonth() && d.getFullYear() === prevMonth.getFullYear(); });

  const thisMonth = rawThisMonth.length > 0 ? rawThisMonth : lastMonthTxs;
  const lastMonth = rawThisMonth.length > 0 ? lastMonthTxs : (() => {
    const twoMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    return transactions.filter(t => { const d = parseDate(t.date); return d.getMonth() === twoMonthsAgo.getMonth() && d.getFullYear() === twoMonthsAgo.getFullYear(); });
  })();

  const isRealExpense = t => t.type === "expense" && t.category_name !== "Transfer";
  const totalSpent = thisMonth.filter(isRealExpense).reduce((s, t) => s + Number(t.amount), 0);
  const totalIncome = thisMonth.filter(t => t.type === "income").reduce((s, t) => s + Number(t.amount), 0);
  const totalTransfers = thisMonth.filter(t => t.category_name === "Transfer").reduce((s, t) => s + Number(t.amount), 0);
  const lastSpent = lastMonth.filter(isRealExpense).reduce((s, t) => s + Number(t.amount), 0);
  const lastIncome = lastMonth.filter(t => t.type === "income").reduce((s, t) => s + Number(t.amount), 0);

  const effectiveIncome = totalIncome > 0 ? totalIncome :
    [...transactions]
      .filter(t => t.type === "income")
      .sort((a, b) => new Date(b.date) - new Date(a.date))[0]
      ? Number([...transactions].filter(t => t.type === "income").sort((a, b) => new Date(b.date) - new Date(a.date))[0].amount)
      : 0;

  const spendingByCategory = {};
  thisMonth.filter(isRealExpense).forEach(t => { const k = t.category_name || "Other"; spendingByCategory[k] = (spendingByCategory[k] || 0) + Number(t.amount); });
  const prevSpendingByCategory = {};
  lastMonth.filter(isRealExpense).forEach(t => { const k = t.category_name || "Other"; prevSpendingByCategory[k] = (prevSpendingByCategory[k] || 0) + Number(t.amount); });

  const insightScreen =
    screen === "dashboard"    ? "home" :
    screen === "transactions" ? "transactions" :
    screen === "savings"      ? "savings" :
    screen === "insights"     ? "insights" : "home";

  const { insight, allInsights, aiContext } = useInsights(insightScreen, user?.id);

  useEffect(() => {
    if (!loading) window.hideSplash?.();
  }, [loading]);

  if (loading && !user) return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT }}>
      <div style={{ color: C.cyan, fontSize: 16, fontWeight: 500 }}>Loading Arkonomy {APP_VERSION}...</div>
    </div>
  );

  if (!user) return <AuthScreen onAuth={setUser} />;

  // Show onboarding for new users: no transactions and not yet completed
  const shouldOnboard = !loading && !onboardingDone && transactions.length === 0 && !bankConnected;
  if (shouldOnboard) return (
    <OnboardingFlow
      user={user}
      profile={profile}
      linkToken={linkToken}
      getLinkToken={getLinkToken}
      onPlaidSuccess={onPlaidSuccess}
      onSaveProfile={saveProfile}
      onDone={() => {
        try { localStorage.setItem("arkonomy_onboarding_done", "1"); } catch {}
        setOnboardingDone(true);
      }}
    />
  );

  const isShowingLastMonth = rawThisMonth.length === 0 && lastMonthTxs.length > 0;
  const { isPro } = usePlan(profile);
  const onUpgrade = () => setShowUpgradeModal(true);
  const shared = { transactions, categories, savings, profile, totalSpent, totalIncome: effectiveIncome, lastSpent, lastIncome, spendingByCategory, prevSpendingByCategory, totalTransfers, isShowingLastMonth, isPro, onUpgrade };

  function openMarket(symbol) {
    setMarketInitSymbol(symbol ?? null);
    setScreen("markets");
  }

  function handleInsightAction(action, data) {
    if (action === "reduce_category") {
      if (data?.categoryName) setCatFilter(data.categoryName);
      setScreen("transactions");
    } else if (action === "review_spending" || action === "view_bills") {
      setScreen("transactions");
    } else if (action === "move_to_savings" || action === "catch_up_goal") {
      setScreen("savings");
    } else if (action === "view_progress") {
      setScreen("insights");
    } else if (action === "invest_alpaca") {
      investAlpaca(data); setScreen("savings");
    } else {
      setScreen("transactions");
    }
  }

  async function connectAlpaca() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const url = alpacaOAuthUrl(session.access_token);
    window.open(url, "_blank", "noopener");
  }

  async function investAlpaca(data) {
    if (profile?.plan !== 'pro') { setShowUpgradeModal(true); return; }
    if (!alpacaConnected) { connectAlpaca(); return; }
    const amount = data?.roundUpMonthly;
    if (!amount || Number(amount) < 1) {
      setAlpacaToast({ error: "No round-up amount available" });
      setTimeout(() => setAlpacaToast(null), 4000);
      return;
    }
    setAlpacaToast({ loading: true, message: `Investing $${amount} in SPY…` });
    try {
      const { data: result, error } = await supabase.functions.invoke("alpaca-invest", {
        body: { amount: Number(amount), symbol: "SPY" },
      });
      console.log('Alpaca response:', result, 'error:', error);
      if (error || result?.error) {
        let errMsg = result?.error || error?.message || "Investment failed";
        let details = result?.details ? JSON.stringify(result.details) : '';
        if (error?.context) {
          try {
            const errBody = await error.context.json();
            console.log('Alpaca error body:', errBody);
            errMsg = errBody?.error || errMsg;
            details = errBody?.details ? JSON.stringify(errBody.details) : details;
          } catch {}
        }
        if (errMsg === 'alpaca_not_connected') {
          setAlpacaToast(null);
          connectAlpaca();
          return;
        } else if (errMsg.includes('Insufficient buying power') || errMsg.includes('not configured') || errMsg.includes('ALPACA_API_KEY')) {
          setAlpacaToast({ addFunds: true });
        } else {
          setAlpacaToast({ error: errMsg + (details ? ` | ${details}` : '') });
        }
      } else {
        setAlpacaToast({ success: true, message: result.message || `$${amount} invested in SPY` });
      }
    } catch (err) {
      setAlpacaToast({ error: String(err) });
    }
    setTimeout(() => setAlpacaToast(null), 5000);
  }

  async function sendChat(input) {
    if (!input.trim()) return;
    const userMsg = { role: "user", text: input };
    const updated = [...chatMessages, userMsg];
    setChatMessages(updated);
    setChatInput("");

    const ctx = {
      metrics: {
        currentBalance: totalIncome - totalSpent,
        currentMonthSpend: totalSpent,
        currentMonthIncome: effectiveIncome,
        monthlyBudget: Number(profile?.monthly_budget) || 3000,
        budgetUsedPct: Math.round((totalSpent / (Number(profile?.monthly_budget) || 3000)) * 100),
      },
      engine: {
        activeSignals: aiContext?.activeSignals ?? [],
        topInsight: aiContext?.topInsight ?? null,
      },
      topCategories: Object.entries(spendingByCategory)
        .sort((a, b) => b[1] - a[1]).slice(0, 5)
        .map(([name, amount]) => ({ name, amount: Math.round(amount) })),
      savingsGoals: savings.map(s => ({
        name: s.name, current: Number(s.current), target: Number(s.target),
        progressPct: s.target > 0 ? Math.round((s.current / s.target) * 100) : 0,
        remaining: Math.max(Number(s.target) - Number(s.current), 0),
      })),
      totalSaved: savings.reduce((s, sv) => s + Number(sv.current), 0),
      recentTransactions: transactions.slice(0, 8).map(t => ({
        description: t.description || t.category_name,
        amount: Number(t.amount), type: t.type,
        category: t.category_name, date: t.date,
      })),
    };

    const lid = Date.now();
    setChatMessages(prev => [...prev, { role: "assistant", text: "...", id: lid, loading: true }]);

    try {
      const res = await supabase.functions.invoke("ai-chat", {
        body: { messages: updated.filter(m => !m.loading), financialContext: ctx }
      });
      const reply = res.data?.reply || "Sorry, something went wrong.";
      setChatMessages(prev => prev.map(m => m.id === lid ? { role: "assistant", text: reply } : m));
    } catch {
      setChatMessages(prev => prev.map(m => m.id === lid ? { role: "assistant", text: "Could not reach AI. Check your connection." } : m));
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: FONT, maxWidth: 430, margin: "0 auto", position: "relative", overflow: "visible" }}>
      {/* Header */}
      <div style={{ padding: "12px 18px", display: "flex", justifyContent: "space-between", alignItems: "center", position: "sticky", top: 0, background: "rgba(11,20,38,0.99)", backdropFilter: "blur(20px)", zIndex: 50, borderBottom: `1px solid ${C.sep}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <img src="https://i.postimg.cc/k4tv1XgB/Remove-the-dark-background-completely-make-it-tran-delpmaspu-removebg-preview.png" alt="Arkonomy" style={{ width: 72, height: 36, objectFit: "contain" }} />
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ color: C.muted, fontSize: 12, fontWeight: 500 }}>{profile?.full_name || user.email?.split("@")[0]}</span>
              {isPro && <span style={{ fontSize: 9, fontWeight: 700, color: "#7C6BFF", background: "#7C6BFF18", border: "1px solid #7C6BFF44", borderRadius: 99, padding: "1px 6px", letterSpacing: 0.5 }}>PRO</span>}
            </div>
            {backgroundSyncing
              ? <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: C.green }}>
                  <div style={{ width: 5, height: 5, borderRadius: "50%", background: C.green, animation: "pulse 1.2s ease-in-out infinite" }} />
                  Syncing…
                </div>
              : <div style={{ color: C.faint, fontSize: 10 }}>AI Financial Autopilot</div>
            }
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button data-tutorial="settings-btn" onClick={() => setScreen("profile")} style={{ background: screen === "profile" ? C.cyan + "18" : C.bgSecondary, border: `1px solid ${screen === "profile" ? C.cyan + "44" : C.border}`, borderRadius: 10, width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <Icon name="settings" size={16} color={screen === "profile" ? C.cyan : C.muted} />
          </button>
          <button onClick={signOut} style={{ background: C.bgSecondary, border: `1px solid ${C.border}`, borderRadius: 10, padding: "7px 13px", color: C.muted, cursor: "pointer", fontSize: 13, fontFamily: FONT, fontWeight: 500 }}>Sign Out</button>
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: "14px 14px 85px" }}>
        {loading ? (
          <div style={{ color: C.muted, textAlign: "center", padding: 40 }}>Loading...</div>
        ) : (
          <>
            {screen === "dashboard" && <Dashboard {...shared} onNavigate={setScreen} onCatClick={cat => { setCatFilter(cat); setScreen("transactions"); }} insight={insight} onInsightAction={handleInsightAction} upcomingCharges={upcomingCharges} onOpenMarket={openMarket} />}
            {screen === "markets"   && <Markets profile={profile} user={user} onSaveProfile={saveProfile} initialSymbol={marketInitSymbol} onClearInit={() => setMarketInitSymbol(null)} alpacaConnected={alpacaConnected} onConnectAlpaca={connectAlpaca} />}
            {screen === "transactions" && <Transactions transactions={transactions} categories={categories} onAdd={() => setShowAddTx(true)} onDelete={deleteTransaction} onEdit={setEditTx} activeCatFilter={catFilter} onClearCatFilter={() => setCatFilter(null)} insight={insight} onInsightAction={handleInsightAction} onToast={showAlert} />}
            {screen === "savings" && <Savings savings={savings} onAdd={addSaving} onUpdate={updateSaving} onEdit={editSaving} onDelete={deleteSaving} totalIncome={totalIncome} totalSpent={totalSpent} transactions={transactions} insight={insight} onInsightAction={handleInsightAction} onInvestAlpaca={investAlpaca} isPro={isPro} onUpgrade={onUpgrade} alpacaConnected={alpacaConnected} onConnectAlpaca={connectAlpaca} bankConnected={bankConnected} userId={user.id} />}
            {screen === "insights" && <Insights {...shared} onOpenChat={msg => { setShowChat(true); sendChat(msg); }} allInsights={allInsights} onInsightAction={handleInsightAction} isPro={isPro} onUpgrade={onUpgrade} />}
            {screen === "profile" && <Profile profile={profile} user={user} onSave={saveProfile} autopilot={autopilot} setAutopilot={setAutopilot} bankConnected={bankConnected} bankName={bankName} bankCount={bankCount} linkToken={linkToken} getLinkToken={getLinkToken} onPlaidSuccess={onPlaidSuccess} syncBankTransactions={syncBankTransactions} syncingBank={syncingBank} lastSyncedAt={lastSyncedAt} backgroundSyncing={backgroundSyncing} isPro={isPro} onUpgrade={onUpgrade} transactions={transactions} />}
          </>
        )}
      </div>

      {showAddTx && <AddTransactionModal categories={categories} onAdd={addTransaction} onClose={() => setShowAddTx(false)} />}
      {editTx && <AddTransactionModal categories={categories} existing={editTx} onAdd={data => updateTransaction(editTx.id, data)} onClose={() => setEditTx(null)} />}
      <ToastStack toasts={alertToasts} dismiss={dismissAlert} />
      {proToast && (
        <div style={{
          position: "fixed", top: 24, left: "50%", transform: "translateX(-50%)",
          background: "linear-gradient(135deg, #7C6BFF22, #38B6FF11)",
          border: "1px solid #7C6BFF66",
          borderRadius: 16, padding: "16px 24px", zIndex: 10000,
          color: "#E8EDF5", fontFamily: "'DM Sans', sans-serif",
          textAlign: "center", boxShadow: "0 8px 32px rgba(124,107,255,0.3)",
          minWidth: 260,
        }}>
          <div style={{ fontSize: 28, marginBottom: 6 }}>⚡</div>
          <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 4 }}>Welcome to Pro!</div>
          <div style={{ fontSize: 13, color: "#7A8BA8" }}>Your account has been upgraded. Enjoy all features.</div>
        </div>
      )}
      {showUpgradeModal && <UpgradeModal onClose={() => setShowUpgradeModal(false)} supabase={supabase} />}

      {alpacaToast && (
        <div style={{
          position: "fixed", bottom: 90, left: "50%", transform: "translateX(-50%)",
          background: alpacaToast.addFunds ? "#1A1A0D" : alpacaToast.error ? "#2D1515" : alpacaToast.loading ? "#0D1F2D" : "#0D2A1F",
          border: `1px solid ${alpacaToast.addFunds ? "#F5C84244" : alpacaToast.error ? "#E05C5C44" : alpacaToast.loading ? "#4B6CB744" : "#12D18E44"}`,
          borderRadius: 14, padding: "14px 18px", zIndex: 9999,
          color: alpacaToast.addFunds ? "#F5C842" : alpacaToast.error ? "#E05C5C" : alpacaToast.loading ? "#8BA7E8" : "#12D18E",
          fontSize: 13, fontWeight: 600, fontFamily: FONT,
          boxShadow: "0 4px 24px rgba(0,0,0,0.5)", whiteSpace: "pre-wrap", maxWidth: 340,
          display: "flex", flexDirection: "column", gap: 10, alignItems: "center",
        }}>
          {alpacaToast.addFunds ? (
            <>
              <span>💰 Your Alpaca account needs funds. Add money first, then come back to invest.</span>
              <a
                href="https://app.alpaca.markets/brokerage/funding/deposit"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  background: "#F5C842", color: "#000", borderRadius: 8,
                  padding: "6px 16px", fontSize: 13, fontWeight: 700,
                  textDecoration: "none", display: "inline-block",
                }}
              >Add funds to Alpaca</a>
            </>
          ) : alpacaToast.alpacaSuccess ? (
            <>
              <span>✅ Alpaca connected! You can now invest directly from Arkonomy.</span>
            </>
          ) : alpacaToast.error ? `❌ ${alpacaToast.error}` : alpacaToast.loading ? `⏳ ${alpacaToast.message}` : `✅ ${alpacaToast.message}`}
        </div>
      )}

      {/* ── Floating AI Chat Button ─────────────────────────── */}
      {!showChat && (
        <button
          data-tutorial="ai-chat"
          className={chatBounced ? "" : "chat-bounce"}
          onAnimationEnd={() => { setChatBounced(true); try { localStorage.setItem("arkonomy_chat_bounced","1"); } catch {} }}
          onClick={() => setShowChat(true)}
          style={{
            position: "fixed",
            bottom: 88,
            right: "max(16px, calc((100vw - 430px) / 2 + 16px))",
            width: 56, height: 56,
            borderRadius: "50%",
            background: "linear-gradient(135deg, #7C6BFF, #00C2FF)",
            border: "none", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 4px 24px rgba(124,107,255,0.55)",
            zIndex: 90,
          }}
        >
          <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          <div style={{
            position: "absolute", top: -4, right: -4,
            background: "#12D18E", borderRadius: 99,
            padding: "2px 5px", fontSize: 8, fontWeight: 800,
            color: "#000", lineHeight: 1, letterSpacing: 0.3,
            border: "1.5px solid rgba(11,20,38,0.97)",
          }}>AI</div>
        </button>
      )}

      {/* ── Chat Modal ──────────────────────────────────────── */}
      {showChat && (
        <div
          onClick={() => setShowChat(false)}
          style={{
            position: "fixed", inset: 0, zIndex: 200,
            background: "rgba(7,12,24,0.78)",
            backdropFilter: "blur(6px)",
            display: "flex", alignItems: "flex-end", justifyContent: "center",
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: "100%", maxWidth: 430,
              height: "88vh",
              background: C.bg,
              borderRadius: "20px 20px 0 0",
              border: `1px solid ${C.border}`,
              borderBottom: "none",
              display: "flex", flexDirection: "column",
              overflow: "hidden",
              boxShadow: "0 -8px 48px rgba(0,0,0,0.7)",
            }}
          >
            {/* Modal header */}
            <div style={{ padding: "12px 16px 10px", display: "flex", alignItems: "center", gap: 10, borderBottom: `1px solid ${C.sep}`, flexShrink: 0 }}>
              <div style={{ width: 34, height: 34, borderRadius: 10, background: `linear-gradient(135deg,#7C6BFF22,#00C2FF18)`, border: `1px solid #7C6BFF33`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#00C2FF" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>AI Assistant</div>
                <div style={{ fontSize: 11, color: C.faint, display: "flex", alignItems: "center", gap: 4 }}>
                  <div style={{ width: 5, height: 5, borderRadius: 99, background: C.green }} />
                  Powered by Claude · knows your finances
                </div>
              </div>
              <button
                onClick={() => setShowChat(false)}
                style={{ background: C.bgSecondary, border: `1px solid ${C.border}`, borderRadius: 10, width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}
              >
                <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={C.muted} strokeWidth={2.5} strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            {/* Chat body */}
            <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", padding: "0 14px 14px" }}>
              <Chat messages={chatMessages} input={chatInput} setInput={setChatInput} onSend={msg => sendChat(msg ?? chatInput)} onClose={() => setShowChat(false)} />
            </div>
          </div>
        </div>
      )}

      <BottomNav screen={screen} setScreen={setScreen} />

      {/* ── Tutorial Overlay ───────────────────────────────────── */}
      {tutorialActive && (
        <TutorialOverlay
          stepIdx={tutorialStepIdx}
          totalSteps={activeTourSteps.length}
          steps={activeTourSteps}
          onNext={advanceTutorial}
          onSkip={finishTutorial}
        />
      )}

      {/* ── Help Button ────────────────────────────────────────── */}
      <HelpButton onRestart={startTutorial} onMiniTour={startMiniTour} />
    </div>
  );
}

// ─── Market Overview Card ─────────────────────────────��───────
function MarketOverview({ onOpenMarket }) {
  const [markets, setMarkets] = useState([]);
  const [news, setNews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("markets");
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const headers = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${session?.access_token ?? ""}`,
        "apikey": SUPABASE_KEY,
      };

      const [mRes, nRes] = await Promise.all([
        fetch(`${SUPABASE_URL}/functions/v1/market-data`, {
          method: "POST", headers, body: JSON.stringify({ type: "overview" }),
        }),
        fetch(`${SUPABASE_URL}/functions/v1/market-data`, {
          method: "POST", headers, body: JSON.stringify({ type: "news" }),
        }),
      ]);

      if (!mRes.ok) {
        const err = await mRes.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${mRes.status}`);
      }

      const mData = await mRes.json();
      const nData = await nRes.json().catch(() => ({}));

      if (mData?.markets) setMarkets(mData.markets);
      if (nData?.news) setNews(nData.news);
      setLastUpdated(new Date());
    } catch (e) {
      setError(e.message || "Could not load market data");
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, []);

  const MARKET_META = {
    SPY:  { label: "S&P 500",  icon: "bar-chart", color: "#2F80FF" },
    QQQ:  { label: "NASDAQ",   icon: "activity",  color: "#A78BFA" },
    BTC:  { label: "Bitcoin",  icon: "zap",        color: "#F59E0B" },
    ETH:  { label: "Ethereum", icon: "zap",        color: "#34D399" },
  };

  return (
    <GlassCard style={{ padding: "14px 16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: C.blue + "22", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name="bar-chart" size={14} color={C.blue} />
          </div>
          <span style={{ fontWeight: 600, fontSize: 14 }}>Markets</span>
          {lastUpdated && !loading && (
            <span style={{ fontSize: 10, color: C.faint }}>
              {lastUpdated.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          {["markets", "news"].map(t => (
            <button key={t} onClick={() => setTab(t)}
              style={{ padding: "4px 10px", borderRadius: 20, border: `1px solid ${tab === t ? C.blue : C.border}`, background: tab === t ? C.blue + "18" : "transparent", color: tab === t ? C.blue : C.faint, cursor: "pointer", fontSize: 11, fontWeight: tab === t ? 600 : 400, fontFamily: FONT, textTransform: "capitalize" }}>
              {t}
            </button>
          ))}
          <button onClick={load} style={{ background: "none", border: "none", cursor: "pointer", padding: "2px", display: "flex", opacity: loading ? 0.4 : 0.7 }}>
            <Icon name="repeat" size={13} color={C.muted} strokeWidth={2} />
          </button>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: "20px 0", color: C.faint, fontSize: 13 }}>
          <div style={{ display: "inline-flex", gap: 5, alignItems: "center" }}>
            {[0,1,2].map(i => (
              <span key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: C.blue, display: "inline-block", animation: `bop 1.2s ease ${i*0.2}s infinite` }} />
            ))}
            <style>{`@keyframes bop{0%,80%,100%{transform:translateY(0)}40%{transform:translateY(-5px)}}`}</style>
          </div>
          <div style={{ marginTop: 8, fontSize: 11 }}>Loading market data...</div>
        </div>
      ) : error ? (
        <div style={{ padding: "12px 14px", background: C.red + "10", borderRadius: 12, border: `1px solid ${C.red}22` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
            <Icon name="alert-circle" size={14} color={C.red} />
            <span style={{ fontSize: 12, color: C.red, fontWeight: 600 }}>Could not load market data</span>
          </div>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 10, lineHeight: 1.5 }}>{error}</div>
          <button onClick={load} style={{ marginTop: 10, padding: "7px 14px", background: C.blue + "22", border: `1px solid ${C.blue}44`, borderRadius: 8, color: C.blue, cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: FONT }}>
            Retry
          </button>
        </div>
      ) : tab === "markets" ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {markets.map(m => {
            const meta = MARKET_META[m.symbol] || { label: m.symbol, icon: "activity", color: C.cyan };
            const pos = (m.changePct ?? 0) >= 0;
            const chColor = pos ? C.green : C.red;
            return (
              <div key={m.symbol} onClick={() => onOpenMarket?.(m.symbol)} style={{ background: C.bgTertiary, borderRadius: 12, padding: "10px 12px", border: `1px solid ${C.border}`, cursor: "pointer" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                  <div style={{ width: 24, height: 24, borderRadius: 7, background: meta.color + "22", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Icon name={meta.icon} size={11} color={meta.color} strokeWidth={2.5} />
                  </div>
                  <span style={{ fontSize: 11, color: C.muted, fontWeight: 500 }}>{meta.label}</span>
                </div>
                <div style={{ fontSize: 15, fontWeight: 800, color: C.text, letterSpacing: -0.3 }}>
                  ${m.price != null ? Number(m.price).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 3 }}>
                  <Icon name={pos ? "trending-up" : "trending-down"} size={10} color={chColor} strokeWidth={2.5} />
                  <span style={{ fontSize: 11, color: chColor, fontWeight: 600 }}>
                    {m.changePct != null ? `${pos ? "+" : ""}${Number(m.changePct).toFixed(2)}%` : "—"}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
          {news.length === 0
            ? <div style={{ color: C.faint, fontSize: 12, textAlign: "center", padding: "16px 0" }}>No news available</div>
            : news.slice(0, 4).map((n, i) => (
              <a key={i} href={n.url} target="_blank" rel="noopener noreferrer"
                style={{ display: "flex", gap: 10, textDecoration: "none", padding: "10px 0", borderBottom: i < 3 ? `1px solid ${C.sep}` : "none" }}>
                {n.image && (
                  <img src={n.image} alt="" style={{ width: 52, height: 40, borderRadius: 8, objectFit: "cover", flexShrink: 0 }} onError={e => { e.target.style.display = "none"; }} />
                )}
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: C.text, lineHeight: 1.4, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{n.headline}</div>
                  <div style={{ fontSize: 10, color: C.faint, marginTop: 3 }}>{n.source} · {new Date(n.datetime * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</div>
                </div>
              </a>
            ))
          }
        </div>
      )}

      {!loading && !error && tab === "markets" && markets.length > 0 && (
        <div style={{ fontSize: 10, color: C.faint, marginTop: 10, textAlign: "right" }}>
          Powered by Finnhub · auto-refreshes every 60s
        </div>
      )}
    </GlassCard>
  );
}

// ─── Dashboard ────────────────────────────────────────────────
function Dashboard({ totalSpent, totalIncome, lastSpent, lastIncome, transactions, spendingByCategory, prevSpendingByCategory, profile, savings, onNavigate, onCatClick, insight, onInsightAction, isShowingLastMonth, isPro, onUpgrade, upcomingCharges = [], onOpenMarket }) {
  const [balanceVisible, setBalanceVisible] = useState(true);
  const m = (n, dec = 0) => balanceVisible ? `$${fmt(n, dec)}` : "••••";
  const budget = Number(profile?.monthly_budget) || 3000;
  const balance = totalIncome - totalSpent;
  const pct = budget > 0 ? (totalSpent / budget) * 100 : 0;
  const incomeChange = lastIncome > 0 ? ((totalIncome - lastIncome) / lastIncome) * 100 : 0;
  const expenseChange = lastSpent > 0 ? ((totalSpent - lastSpent) / lastSpent) * 100 : 0;
  const balColor = balance >= 0 ? C.green : C.red;

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
  const healthComment = generateHealthComment({
    score: healthScore,
    breakdown: scoreBreakdown,
    spendingByCategory,
    prevSpendingByCategory,
  });

  const checkInData = {
    spent:       totalSpent,
    budget:      budget,
    income:      totalIncome,
    savingsRate: totalIncome > 0 ? Math.round((totalIncome - totalSpent) / totalIncome * 100) : 0,
    day:         new Date().getDate(),
    spikePct: (() => {
      const spikes = Object.entries(spendingByCategory).map(([cat, amt]) => {
        const p = prevSpendingByCategory[cat] || 0;
        return p > 0 ? ((amt - p) / p) * 100 : 0;
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

      {/* 0a ── Onboarding welcome card (shown only when no transactions exist) */}
      {transactions.length === 0 && (
        <div style={{ background: "linear-gradient(135deg,#0D2A4A,#0B1A30)", borderRadius: 20, padding: "20px 18px", border: `1px solid ${C.cyan}33`, boxShadow: `0 4px 24px ${C.cyan}12` }}>
          <div style={{ fontSize: 22, marginBottom: 6 }}>👋</div>
          <div style={{ fontWeight: 700, fontSize: 17, color: C.text, marginBottom: 4 }}>Welcome to Arkonomy</div>
          <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.6, marginBottom: 16 }}>
            Get started by connecting your bank or adding your first transaction to see your financial health score.
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => onNavigate("profile")}
              style={{ flex: 1, padding: "11px 0", background: `linear-gradient(90deg,${C.cyan},${C.blue})`, border: "none", borderRadius: 12, color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: FONT, boxShadow: `0 4px 14px ${C.cyan}44` }}
            >
              Connect Bank
            </button>
            <button
              onClick={() => onNavigate("transactions")}
              style={{ flex: 1, padding: "11px 0", background: C.bgTertiary, border: `1px solid ${C.border}`, borderRadius: 12, color: C.text, fontWeight: 600, fontSize: 13, cursor: "pointer", fontFamily: FONT }}
            >
              Add Transaction
            </button>
          </div>
        </div>
      )}

      {/* 0b ── Upcoming Recurring Charges (highest priority) */}
      {upcomingCharges.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 2px" }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#FF9320", letterSpacing: 0.4 }}>UPCOMING CHARGES</span>
            <span style={{ fontSize: 10, color: "#4A5E7A", background: "#FF932018", border: "1px solid #FF932033", borderRadius: 4, padding: "1px 6px", fontWeight: 600 }}>{upcomingCharges.length}</span>
          </div>
          {upcomingCharges.map((charge, i) => (
            <UpcomingChargesCard key={`${charge.merchant}-${i}`} charge={charge} />
          ))}
        </div>
      )}

      {/* 1 ── Net Balance Card */}
      <div data-tutorial="net-balance" style={{ background: "linear-gradient(145deg,#0D1F3C,#0B1426)", borderRadius: 20, padding: "16px 18px", border: `1px solid #1E2D4A`, position: "relative", overflow: "hidden", boxShadow: "0 4px 32px rgba(0,194,255,0.08)" }}>
        <div style={{ position: "absolute", top: -30, right: -30, width: 110, height: 110, borderRadius: "50%", background: C.cyan + "0B", pointerEvents: "none" }} />

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
          <span style={{ fontSize: 10, color: C.muted, letterSpacing: 1, fontWeight: 600, textTransform: "uppercase" }}>Net Balance</span>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {isShowingLastMonth && (
              <span style={{ fontSize: 9, color: C.yellow, fontWeight: 600, background: C.yellow + "18", padding: "2px 7px", borderRadius: 99, letterSpacing: 0.3 }}>Mar data</span>
            )}
            <button onClick={() => setBalanceVisible(v => !v)} style={{ background: "none", border: "none", cursor: "pointer", padding: "2px", display: "flex" }}>
              <Icon name={balanceVisible ? "eye" : "eye-off"} size={15} color={C.faint} />
            </button>
          </div>
        </div>

        <div style={{ fontSize: 40, fontWeight: 800, letterSpacing: -1.5, color: balanceVisible ? balColor : C.text, lineHeight: 1.1, textShadow: balanceVisible ? `0 0 24px ${balColor}44` : "none" }}>
          {balanceVisible ? `$${fmt(balance)}` : "••••"}
        </div>
        <div style={{ fontSize: 9, color: balance <= 0 ? C.red : C.faint, marginBottom: 12, letterSpacing: 0.5 }}>{balance <= 0 ? "You're in deficit" : "Available balance"}</div>
        
        <div style={{ height: 1, background: "rgba(255,255,255,0.05)", marginBottom: 12 }} />

        <div style={{ display: "flex" }}>
          {[
            { label: "Income", value: m(totalIncome), dot: C.green, change: incomeChange },
            { label: "Expenses", value: m(totalSpent), dot: C.red, change: expenseChange, flip: true },
            { label: "Saved", value: m(Math.max(totalIncome - totalSpent, 0)), dot: C.cyan },
          ].map((item, i) => (
            <div key={item.label} style={{ flex: 1, paddingLeft: i > 0 ? 10 : 0, borderLeft: i > 0 ? `1px solid ${C.sep}` : "none", marginLeft: i > 0 ? 10 : 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 2 }}>
                <div style={{ width: 5, height: 5, borderRadius: 99, background: item.dot }} />
                <span style={{ fontSize: 9, color: C.muted, fontWeight: 500 }}>{item.label}</span>
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 3 }}>{item.value}</div>
              {item.change !== undefined && <StatBadge value={item.flip ? -item.change : item.change} suffix="" />}
            </div>
          ))}
        </div>
      </div>

      {/* 2 ── Financial Health Score */}
      <div data-tutorial="health-score">
        <HealthScoreBar score={healthScore} color={scoreColor} comment={healthComment} breakdown={scoreBreakdown} hasData={totalIncome > 0 || totalSpent > 0} />
      </div>

      {/* 2b ── AI Brain Insight */}
      <div data-tutorial="ai-insight">
        <InsightCard insight={insight?.type === 'savings_opportunity' && balance <= 0 ? null : insight} onAction={onInsightAction} />
      </div>

      {/* 3 ── Spending by Category */}
      <GlassCard style={{ padding: "14px 16px", boxShadow: "0 4px 24px rgba(0,0,0,0.12)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>Spending by Category</span>
          {isPro
            ? <span style={{ fontSize: 10, color: C.faint, background: C.bgTertiary, padding: "3px 8px", borderRadius: 99 }}>Tap to filter</span>
            : <span style={{ fontSize: 10, color: C.cyan + "AA", background: C.cyan + "10", padding: "3px 8px", borderRadius: 99, cursor: "pointer" }} onClick={onUpgrade}>Pro</span>
          }
        </div>
        {Object.keys(spendingByCategory).length === 0 ? (
          <div style={{ textAlign: "center", padding: "24px 0", color: C.faint, fontSize: 13 }}>
            No spending data yet. Connect your bank to get started.
          </div>
        ) : (
          <DonutChart data={spendingByCategory} size={152} onCatClick={isPro ? onCatClick : null} hideAmounts={!balanceVisible} lockList={!isPro} onUpgrade={onUpgrade} />
        )}
      </GlassCard>

      {/* 4 ── Monthly Budget */}
      {(() => {
        const isOver = totalSpent > budget;
        const overBy = totalSpent - budget;
        const remaining = budget - totalSpent;
        const barPct = isOver ? 100 : pct;
        const barColor = isOver ? C.red : pct > 70 ? C.yellow : `linear-gradient(90deg,${C.cyan},${C.blue})`;
        return (
          <GlassCard style={{ padding: "14px 16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>Monthly Budget</div>
                <div style={{ fontSize: 11, color: C.muted, marginTop: 1 }}>Spent {m(totalSpent)} of {m(budget)}</div>
              </div>
              <span style={{ color: isOver ? C.red : pct > 70 ? C.yellow : C.cyan, fontSize: 15, fontWeight: 800, display: "flex", alignItems: "baseline", gap: 4 }}>
                {`${Math.round(pct)}%`}{isOver && <span style={{ fontSize: 10, fontWeight: 600, color: C.red }}>Over</span>}
              </span>
            </div>
            <div style={{ height: 7, background: C.bgTertiary, borderRadius: 99, marginBottom: 6 }}>
              <div style={{ height: 7, borderRadius: 99, width: `${barPct}%`, background: barColor, transition: "width 0.6s", boxShadow: !isOver && pct <= 70 ? `0 0 8px ${C.cyan}44` : "none" }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              {isOver
                ? <span style={{ color: C.red, fontSize: 11, fontWeight: 600 }}>Over by {m(overBy)}</span>
                : <span style={{ color: C.green, fontSize: 11, fontWeight: 600 }}>{m(remaining)} remaining</span>
              }
              <span style={{ color: C.faint, fontSize: 11 }}>of {m(budget)}</span>
            </div>
          </GlassCard>
        );
      })()}

      {/* 5 ── Market Overview */}
      <MarketOverview onOpenMarket={onOpenMarket} />

      {/* 6 ── Recent Transactions */}
      <GlassCard style={{ padding: "14px 16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>Recent Transactions</span>
          <button onClick={() => onNavigate("transactions")} style={{ background: "none", border: "none", cursor: "pointer", color: C.cyan, fontSize: 12, fontWeight: 600, fontFamily: FONT, display: "flex", alignItems: "center", gap: 4, padding: 0 }}>
            View all <Icon name="chevron" size={12} color={C.cyan} />
          </button>
        </div>
        {transactions.length === 0
          ? <div style={{ color: C.muted, textAlign: "center", padding: "16px 0", fontSize: 13 }}>No transactions yet</div>
          : transactions.slice(0, 3).map((t, i, arr) => (
              <div key={t.id}>
                <TxRow t={t} hideAmount={!balanceVisible} />
                {i < arr.length - 1 && <div style={{ height: 1, background: C.sep }} />}
              </div>
            ))
        }
      </GlassCard>

    </div>
  );
}

// ─── Insights ─────────────────────────────────────────────────
function Insights({ totalSpent, totalIncome, lastSpent, lastIncome, spendingByCategory, prevSpendingByCategory, onOpenChat, transactions, savings, profile, allInsights, onInsightAction, isPro, onUpgrade }) {
  const monthlySavings = totalIncome - totalSpent;
  const savingsRate = totalIncome > 0 ? Math.round((monthlySavings / totalIncome) * 100) : 0;

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

  const insights = [];

  Object.entries(spendingByCategory).forEach(([cat, amount]) => {
    if (cat === "Transfer") return; // Transfer не анализируем
    const prev = prevSpendingByCategory[cat] || 0;
    if (prev > 0) {
      const change = ((amount - prev) / prev) * 100;
      if (change > 25) {
        const cause = `$${fmt(amount, 0)} this month vs $${fmt(prev, 0)} last month.`;
        const guidance = change > 100
          ? `→ This is a significant jump. Review recent ${cat} transactions to identify the cause and decide if action is needed.`
          : `→ This is elevated spending — not yet a confirmed trend. Monitor next month to decide if action is needed.`;
        insights.push({
          id: `u-${cat}`, icon: "trending-up",
          title: `${cat} up ${change.toFixed(0)}%`,
          desc: `${cause} Reducing could save ~$${fmt(amount - prev, 0)}/month.\n\n${guidance}`,
          severity: change > 50 ? "danger" : "warning",
          value: `+${change.toFixed(0)}%`,
          context: `My ${cat} spending is ${change.toFixed(0)}% higher than last month. What's driving this and how do I cut back?`
        });
      }
    }
  });

  if (savingsRate < 10 && totalIncome > 0) insights.push({
    id: "savings-low", icon: "target", title: "Low Savings Rate",
    desc: `You're saving ${savingsRate.toFixed(1)}% of income — well below the 20% target.\n\n→ This puts long-term financial stability at risk.\n→ Start with automating a small fixed amount each month to build the habit.`,
    severity: "warning", value: `${savingsRate.toFixed(1)}%`,
    context: `My savings rate is only ${savingsRate.toFixed(1)}%. How do I reach 20%?`
  });
  else if (savingsRate >= 20) insights.push({
    id: "savings-good", icon: "star", title: "Excellent Savings Rate",
    desc: `You're saving ${savingsRate.toFixed(1)}% of income — above the 20% recommended target.\n\n→ This is a strong financial habit.\n→ Consider putting part of this surplus into an investment account to grow it further.`,
    severity: "good", value: `${savingsRate.toFixed(1)}%`,
    context: `My savings rate is ${savingsRate.toFixed(1)}%. How should I best invest this surplus?`
  });

  const shopping = spendingByCategory["Shopping"] || 0;
  if (shopping > 300) insights.push({
    id: "shopping", icon: "shopping", title: "High Shopping Spend",
    desc: `You spent $${fmt(shopping, 0)} on shopping this month.\n\n→ This is above a healthy threshold for discretionary spending.\n→ A 30-day rule for non-essential purchases can reduce impulse buys by 20–40%.`,
    severity: "info", value: `$${fmt(shopping, 0)}`,
    context: `I spent $${fmt(shopping, 0)} on shopping. Help me build habits to reduce impulse purchases.`
  });

  if (insights.length === 0) {
    if (insightScore >= 70) {
      insights.push({ id: "all-good", icon: "check-circle", title: "You're on track!", desc: "Your spending looks healthy this month. Keep it up!", severity: "good", context: "My finances look healthy. What should I focus on to build long-term wealth?" });
    } else if (insightScore >= 50) {
      insights.push({ id: "neutral", icon: "info", title: "Some areas to watch", desc: "Your finances are mostly stable but there's room to improve. Small increases in savings or tighter budget tracking could push your score into the green.", severity: "info", context: "My financial health score is around 50-70. What are the highest-impact changes I can make?" });
    } else {
      insights.push({ id: "needs-work", icon: "alert-circle", title: "Attention needed", desc: "Your financial health score is below 50. Focus on reducing discretionary spending and building a consistent savings habit.", severity: "warning", context: "My financial health score is below 50. Where should I start to turn this around?" });
    }
  }

  const colors = { info: C.cyan, warning: C.yellow, danger: C.red, good: C.green };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ marginBottom: 4 }}>
        <h2 style={{ margin: "0 0 4px", fontSize: 22, fontWeight: 700 }}>Insights</h2>
        <div style={{ fontSize: 13, color: C.muted }}>AI-powered spending analysis</div>
      </div>

      {allInsights && allInsights.length > 0 && (
        <div>
          <InsightCardGroup insights={(isPro ? allInsights : allInsights.slice(0, 2)).filter(i => i.type !== 'savings_opportunity' || monthlySavings > 0)} onAction={onInsightAction} />
          {!isPro && allInsights.length > 2 && (
            <div
              onClick={onUpgrade}
              style={{
                marginTop: 8, padding: "18px 16px",
                background: "linear-gradient(180deg, rgba(11,20,38,0) 0%, rgba(11,20,38,0.9) 40%)",
                borderRadius: 14, textAlign: "center", cursor: "pointer",
                border: `1px solid #1E2D45`,
                display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
              }}
            >
              <span style={{ fontSize: 20 }}>🔒</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#E8EDF5" }}>{allInsights.length - 2} more insights locked</span>
              <span style={{ fontSize: 12, color: "#7A8BA8" }}>Upgrade to Pro to see all AI insights</span>
            </div>
          )}
        </div>
      )}

      <HealthScore score={insightScore} color={insightScoreColor} breakdown={insightScoreBreakdown} comment={insightScoreComment} totalSpent={totalSpent} budget={Number(profile?.monthly_budget) || 3000} hasData={totalIncome > 0 || totalSpent > 0} actualSavingsRate={savingsRate} />
      <WeeklySummary transactions={transactions || []} />
      <RecurringSummary transactions={transactions || []} />

      {/* Локальные инсайты — только если Edge Function не вернул данные */}
      {(!allInsights || allInsights.length === 0) && insights.map(ins => {
        const color = colors[ins.severity];
        return (
          <GlassCard key={ins.id}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ width: 44, height: 44, borderRadius: 14, background: color + "22", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: `0 0 14px ${color}33` }}>
                <Icon name={ins.icon} size={20} color={color} />
              </div>
              {ins.value && <span style={{ background: color + "22", color, borderRadius: 100, padding: "4px 12px", fontSize: 13, fontWeight: 700 }}>{ins.value}</span>}
            </div>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>{ins.title}</div>
            <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.7, marginBottom: 14 }}>{ins.desc}</div>
            <button onClick={() => onOpenChat?.(ins.context)} style={{ background: "none", border: "none", cursor: "pointer", color, fontSize: 13, fontWeight: 600, padding: 0, display: "flex", alignItems: "center", gap: 6, fontFamily: FONT }}>
              <Icon name="message" size={13} color={color} /> Ask AI about this <Icon name="chevron" size={13} color={color} />
            </button>
          </GlassCard>
        );
      })}

      {monthlySavings >= 50 && (
        <GlassCard style={{ background: `linear-gradient(135deg,${C.cyan}0D,${C.card})`, border: `1px solid ${C.cyan}30` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <Icon name="zap" size={16} color={C.cyan} />
            <span style={{ fontWeight: 600, fontSize: 15, color: C.cyan }}>Autopilot Tip</span>
          </div>
          <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.65 }}>
            Auto-invest your monthly surplus and let compound interest work. Even $50/month can grow to $30,000+ in 20 years at average market returns.
          </div>
        </GlassCard>
      )}

      <div style={{ fontSize: 11, color: C.faint, textAlign: "center", lineHeight: 1.6, padding: "0 8px" }}>
        AI insights are for informational purposes only and should not be considered financial advice.
      </div>
    </div>
  );
}

// ─── Category Icon ────────────────────────────────────────────
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

const TX_NAME_MAP = {
  "repair": "Car Repair", "car repair": "Car Repair", "repiar": "Car Repair",
  "coffe": "Coffee & Dining", "coffee": "Coffee & Dining", "cofee": "Coffee & Dining",
  "gym": "Gym", "groceries": "Groceries", "pharmacy": "Pharmacy",
  "uber": "Uber", "lyft": "Lyft", "amazon": "Amazon",
  "netflix": "Netflix", "spotify": "Spotify", "apple": "Apple",
  "salary": "Salary", "paycheck": "Salary", "payroll": "Salary",
  "freelance": "Freelance Income", "transfer": "Bank Transfer",
  "dividends": "Dividends", "refund": "Refund",
  "transaction": null, "payment": null, "deposit": null, "debit": null, "credit": null,
};

function normalizeTxName(t) {
  const raw   = (t.description || "").trim();
  const cat   = (t.category_name || "").trim();
  const lower = raw.toLowerCase();
  if (TX_NAME_MAP[lower] !== undefined) {
    const mapped = TX_NAME_MAP[lower];
    if (mapped) return mapped;
  } else if (raw && lower !== cat.toLowerCase()) {
    return raw.replace(/\b\w/g, c => c.toUpperCase());
  }
  if (cat) return cat;
  if (t.type === "income")  return "Income";
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

function fmtMoney(n, sign = false) {
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
  "Transfer": "repeat", "Income": "dollar",
};

function useToasts() {
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

function ToastStack({ toasts, dismiss }) {
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
  const hasIncPrev  = summary.incomeVsPrev  !== null;
  const hasExpPrev  = summary.expenseVsPrev !== null;
  const hasNetPrev  = summary.netVsPrev     !== null;

  const incomeCtx     = hasIncPrev ? fmtPct(summary.incomeVsPrev) + " vs last mo." : null;
  const incomeCtxClr  = hasIncPrev ? ((summary.incomeVsPrev ?? 0) >= 0 ? "#12D18E" : "#FF5C7A") : C.faint;

  const expVsBudgetPct = summary.income > 0 ? Math.round((summary.expense / summary.income) * 100) : null;
  const isOverBudget  = hasExpPrev ? (summary.expenseVsPrev ?? 0) > 10 : (expVsBudgetPct !== null && expVsBudgetPct > 80);
  const expenseCtx    = hasExpPrev
    ? fmtPct(summary.expenseVsPrev) + " vs budget"
    : expVsBudgetPct !== null ? expVsBudgetPct + "% of income" : null;
  const expenseCtxClr = isOverBudget ? "#FF5C7A" : "#12D18E";

  const netCtx    = hasNetPrev
    ? fmtMoney(summary.netVsPrev, true) + " vs last mo."
    : summary.income > 0 ? fmtMoney(summary.income - summary.expense, true) + " net balance" : null;
  const netCtxClr = hasNetPrev ? ((summary.netVsPrev ?? 0) >= 0 ? "#12D18E" : "#FF5C7A") : summary.net >= 0 ? "#12D18E" : "#FF5C7A";

  const cards = [
    { label: "Income",   value: fmtMoney(summary.income),        valColor: "#12D18E",                                     ctx: incomeCtx,  ctxColor: incomeCtxClr,  badge: null,                                                           onClick: onIncomeClick },
    { label: "Expenses", value: fmtMoney(summary.expense),       valColor: "#FF5C7A",                                     ctx: expenseCtx, ctxColor: expenseCtxClr, badge: summary.income === 0 ? "no income" : isOverBudget ? "over budget" : summary.net < 0 ? null : "within budget", badgeOk: summary.income === 0 ? null : !isOverBudget, onClick: onExpenseClick },
    { label: "Net",      value: fmtMoney(summary.net, true),     valColor: summary.net > 0 ? "#12D18E" : summary.net < 0 ? "#FF5C7A" : "#FFB800", ctx: netCtx,     ctxColor: netCtxClr,     badge: summary.net > 0 ? "on track" : summary.net < 0 ? "deficit" : "balanced", badgeOk: summary.net > 0 ? true : summary.net < 0 ? false : null, highlight: true, highlightColor: summary.net > 0 ? "#12D18E" : summary.net < 0 ? "#FF5C7A" : "#FFB800", onClick: onNetClick,
      safeAction: summary.net > 0
        ? `Surplus available this month`
        : summary.net < 0 ? `Overspending by ${fmtMoney(Math.abs(summary.net))}` : null,
      safeActionOk: summary.net >= 0,
    },
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
            : <span style={{ fontSize: 10, color: C.faint }}>this month</span>
          }
          {card.badge && (
            <span style={{ fontSize: 9, fontWeight: 700, color: card.badgeOk === null ? "#FFB800" : card.badgeOk ? "#12D18E" : "#FF5C7A", background: card.badgeOk === null ? "rgba(255,184,0,0.12)" : card.badgeOk ? "rgba(18,209,142,0.12)" : "rgba(255,92,122,0.12)", padding: "2px 6px", borderRadius: 4, alignSelf: "flex-start", letterSpacing: 0.4, textTransform: "uppercase", marginTop: 2 }}>{card.badge}</span>
          )}
          {card.safeAction && (
            <span style={{ fontSize: 9, color: card.safeActionOk ? "rgba(18,209,142,0.65)" : "rgba(255,92,122,0.65)", fontWeight: 500, lineHeight: 1.3, marginTop: 1 }}>{card.safeAction}</span>
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
      const cause = `This increase was caused by ${amt} in ${cat}. Your usual ${cat.toLowerCase()} spending is much lower.`;
      const interpretation = isSpike
        ? `→ This is a one-time expense, not a trend.`
        : `→ Your ${cat} spending is running above typical levels this month.`;
      const guidance = `→ No changes needed now, but monitor next month to confirm stability.`;
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
  const enriched = { ...summary };
  if (transactions && transactions.length > 0) {
    const bycat = transactions.filter(t => t.type === "expense").reduce((a, t) => {
      const k = t.category_name || "Other";
      a[k] = (a[k] || 0) + Number(t.amount);
      return a;
    }, {});
    const top = Object.entries(bycat).sort((a, b) => b[1] - a[1])[0];
    if (top) { enriched._topExpenseCat = top[0]; enriched._topExpenseAmt = top[1]; }
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
          <div style={{ fontSize: 13, fontWeight: 600, color: C.text, fontFamily: FONT }}>{hasPositiveState ? "You're on track this month" : "No data yet"}</div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 2, fontFamily: FONT }}>{hasPositiveState ? "No unusual activity detected" : "Add transactions to see insights"}</div>
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
            <span style={{ fontSize: 10, fontWeight: 700, color: accent, letterSpacing: 0.6, textTransform: "uppercase", fontFamily: FONT, display: "block", marginBottom: 2 }}>{def.label}</span>
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
  const actions = [
    { label: "Edit transaction",  desc: "Fix amount, category or date", icon: "edit",         color: "#2F80FF", fn: () => { onClose(); onEdit(tx); } },
    { label: "Move to savings",   desc: "Allocate to a goal",           icon: "target",       color: "#12D18E", fn: () => { onClose(); onMoveToSavings(tx); } },
    { label: "Flag as unusual",   desc: "Mark for review",              icon: "alert-circle", color: "#FFB800", fn: () => { onClose(); onFlag(tx); } },
    { label: "Duplicate",         desc: "Copy this transaction",        icon: "repeat",       color: "#2F80FF", fn: () => { onClose(); onDuplicate(tx); } },
    { label: "Delete",            desc: "Remove permanently",           icon: "x",            color: "#FF5C7A", danger: true, fn: () => { onClose(); onDelete(tx.id); } },
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
          Cancel
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

function TxRow({ t, onDelete, onEdit, onLongPress, hideAmount = false }) {
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
        <span style={{ fontSize: 10, fontWeight: 600, color: "#fff", fontFamily: FONT }}>Edit</span>
      </div>
      <div ref={bgRRef} onClick={() => { resetSwipe(); setConfirmDelete(true); }} style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 76, background: C.red, borderRadius: "0 14px 14px 0", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3, opacity: 0, transition: "opacity 0.14s", cursor: "pointer" }}>
        <Icon name="x" size={16} color="#fff" strokeWidth={2} />
        <span style={{ fontSize: 10, fontWeight: 600, color: "#fff", fontFamily: FONT }}>Delete</span>
      </div>
      {confirmDelete && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 24px" }} onClick={e => { if (e.target === e.currentTarget) setConfirmDelete(false); }}>
          <div style={{ background: "#111E33", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 18, padding: "24px 20px", width: "100%", maxWidth: 360, fontFamily: FONT }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: C.text, marginBottom: 8 }}>Delete this transaction?</div>
            <div style={{ fontSize: 13, color: C.faint, marginBottom: 24 }}>This will permanently remove <strong style={{ color: C.text }}>{displayName}</strong> from your records.</div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setConfirmDelete(false)} style={{ flex: 1, padding: "12px 0", borderRadius: 12, border: "1px solid rgba(255,255,255,0.12)", background: "transparent", color: C.text, fontSize: 15, fontWeight: 600, cursor: "pointer", fontFamily: FONT }}>Cancel</button>
              <button onClick={() => { setConfirmDelete(false); onDelete(t.id); }} style={{ flex: 1, padding: "12px 0", borderRadius: 12, border: "none", background: C.red, color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer", fontFamily: FONT }}>Delete</button>
            </div>
          </div>
        </div>
      )}
      <div ref={rowRef} onClick={handleClick} onPointerDown={onPD} onPointerMove={onPM} onPointerUp={onPU} onPointerLeave={e => { if (dragging.current) onPU(e); }}
        style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: "12px 13px", display: "flex", alignItems: "center", gap: 11, cursor: "pointer", userSelect: "none", willChange: "transform", position: "relative", zIndex: 1, touchAction: "pan-y", minHeight: 64 }}>
        <div style={{ width: 40, height: 40, minWidth: 40, borderRadius: 11, background: catColor + "20", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Icon name={catIcon} size={16} color={catColor} strokeWidth={1.8} />
        </div>
        <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: C.text, letterSpacing: -0.15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: FONT }}>{displayName}</div>
          <div style={{ fontSize: 11, color: C.faint, marginTop: 2, display: "flex", alignItems: "center", gap: 4, overflow: "hidden", fontFamily: FONT }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flexShrink: 1 }}>{t.category_name || guessCategory(t.description, t.type) || "Other"} · {fmtDate(t.date)}</span>
            {signal && (
              <span style={{ fontSize: 10, fontWeight: 700, color: SIGNAL_STYLE[signal].color, background: SIGNAL_STYLE[signal].bg, padding: "1px 5px", borderRadius: 4, flexShrink: 0 }}>
                {SIGNAL_STYLE[signal].label}
              </span>
            )}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", flexShrink: 0, paddingLeft: 8, gap: 2 }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: isIncome ? "#12D18E" : "#FF5C7A", letterSpacing: -0.35, fontFamily: FONT }}>
            {hideAmount ? "••••" : `${isIncome ? "+" : "−"}${fmtMoney(Number(t.amount))}`}
          </span>
          {t._incomeTotal > 0 && !isIncome && Number(t.amount) > 0 && (
            (() => { const p = Math.round((Number(t.amount) / t._incomeTotal) * 100); return p >= 1 && p <= 500 ? <span style={{ fontSize: 9, color: "rgba(74,94,122,0.8)", fontWeight: 400, fontFamily: FONT, letterSpacing: 0.1 }}>{p}%</span> : null; })()
          )}
        </div>
      </div>
    </div>
  );
}

function Transactions({ transactions, categories, onAdd, onDelete, onEdit, activeCatFilter, onClearCatFilter, insight, onInsightAction, onToast }) {
  const [filter,   setFilter]   = useState("all");
  const [sheet,    setSheet]    = useState(null);
  const [quickTx,  setQuickTx]  = useState(null);
  const [hintDone, setHintDone] = useState(false);
  const { toasts, show: _localToast, dismiss } = useToasts();
  const toast = onToast || _localToast;
  const catFilter = activeCatFilter || null;

  const now    = new Date();
  const prevMo = new Date(now.getFullYear(), now.getMonth() - 1, 1);
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

  let filtered = filter === "all" ? transactions : transactions.filter(t => t.type === filter);
  if (catFilter) filtered = filtered.filter(t => t.category_name === catFilter);

  const counts = {
    all:     transactions.length,
    expense: transactions.filter(t => t.type === "expense").length,
    income:  transactions.filter(t => t.type === "income").length,
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

  return (
    <div style={{ fontFamily: FONT }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: "0 0 2px", fontSize: 26, fontWeight: 700, letterSpacing: -0.6, color: C.text, lineHeight: 1.1 }}>Transactions</h2>
          <div style={{ fontSize: 13, color: C.faint }}>{monthLabel}</div>
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

      <SummaryCards
        summary={summary}
        onIncomeClick={() => setSheet({ title: "Income breakdown", subtitle: `${monthLabel} · ${fmtMoney(summary.income)} total`, rows: transactions.filter(t => t.type === "income").map(t => ({ name: normalizeTxName(t), sub: fmtDate(t.date), amount: fmtMoney(Number(t.amount), true), color: "#12D18E", icon: "dollar" })), actionLabel: "Move surplus to savings", actionColor: "#12D18E", onAction: () => toast("Surplus moved to savings", "success") })}
        onExpenseClick={() => setSheet({ title: "Expenses breakdown", subtitle: `${monthLabel} · ${fmtMoney(summary.expense)} total`, rows: expenseRows, actionLabel: "Set category limit", actionColor: "#FFB800", onAction: () => toast("Category limit saved", "success") })}
        onNetClick={() => setSheet({ title: "Net summary", subtitle: monthLabel, rows: [{ name: "Total income", amount: fmtMoney(summary.income, true), color: "#12D18E", icon: "trending-up", pct: 100 }, { name: "Total expenses", amount: fmtMoney(summary.expense), color: "#FF5C7A", icon: "trending-down", pct: Math.round(summary.expense / Math.max(summary.income, 1) * 100) }, { name: "Net balance", amount: fmtMoney(summary.net, true), color: "#12D18E", icon: "award", pct: Math.round(summary.net / Math.max(summary.income, 1) * 100) }], actionLabel: "Boost savings goal", actionColor: "#12D18E", onAction: () => toast("Savings goal updated", "success") })}
      />

      {/* InsightCard только если связан с транзакциями */}
      {insight && ['category_spike', 'overspending', 'cash_risk'].includes(insight.type) && (
        <InsightCard insight={insight} onAction={onInsightAction} />
      )}

      {/* Top expense this month */}
      {(() => {
        const topTx = curTxs.filter(t => t.type === "expense" && t.category_name !== "Transfer").sort((a, b) => Number(b.amount) - Number(a.amount))[0];
        if (!topTx) return null;
        return (
          <div style={{ background: C.bgSecondary, border: `1px solid ${C.border}`, borderRadius: 12, padding: "10px 14px", marginBottom: 8, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 6, height: 6, borderRadius: 99, background: C.yellow, flexShrink: 0 }} />
              <span style={{ fontSize: 12, color: C.muted }}>Top expense this month:</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{normalizeTxName(topTx)}</span>
            </div>
            <span style={{ fontSize: 13, fontWeight: 700, color: C.red }}>{fmtMoney(Number(topTx.amount))}</span>
          </div>
        );
      })()}

      {catFilter && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, padding: "8px 12px", background: (CAT_COLORS[catFilter] || C.cyan) + "18", borderRadius: 12, border: `1px solid ${(CAT_COLORS[catFilter] || C.cyan)}33` }}>
          <div style={{ width: 8, height: 8, borderRadius: 99, background: CAT_COLORS[catFilter] || C.cyan }} />
          <span style={{ fontSize: 13, color: CAT_COLORS[catFilter] || C.cyan, fontWeight: 600, flex: 1 }}>{catFilter}</span>
          <button onClick={onClearCatFilter} style={{ background: "none", border: "none", cursor: "pointer", display: "flex", padding: 4, minHeight: 28 }}>
            <Icon name="x" size={13} color={C.muted} strokeWidth={2.5} />
          </button>
        </div>
      )}

      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        {[{ key: "all", label: "All" }, { key: "expense", label: "Expenses" }, { key: "income", label: "Income" }].map(f => {
          const on = filter === f.key;
          return (
            <button key={f.key} onClick={() => setFilter(f.key)}
              style={{ padding: "7px 14px", borderRadius: 20, border: `1px solid ${on ? C.blue : C.border}`, background: on ? C.blue : "transparent", color: on ? "#fff" : C.muted, cursor: "pointer", fontSize: 13, fontFamily: FONT, fontWeight: on ? 600 : 400, display: "flex", alignItems: "center", gap: 5, minHeight: 38, transition: "all 0.15s ease" }}>
              {f.label}
              <span style={{ fontSize: 11, background: on ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.07)", borderRadius: 8, padding: "1px 6px", color: on ? "rgba(255,255,255,0.9)" : C.faint }}>{counts[f.key]}</span>
            </button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: "36px 20px", textAlign: "center" }}>
          <div style={{ width: 56, height: 56, background: C.bgSecondary, borderRadius: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name="credit" size={24} color={C.faint} strokeWidth={1.6} />
          </div>
          <div style={{ fontSize: 15, fontWeight: 600, color: C.text }}>{filter === "all" ? "No transactions yet" : `No ${filter === "expense" ? "expense" : "income"} transactions`}</div>
          <div style={{ fontSize: 13, color: C.faint, maxWidth: 220, lineHeight: 1.55 }}>{filter === "all" ? "Add your first transaction to get started." : "Nothing recorded here this month."}</div>
          {filter === "all" && <button onClick={onAdd} style={{ background: `linear-gradient(90deg,${C.cyan},${C.blue})`, border: "none", borderRadius: 12, padding: "12px 24px", color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 13, fontFamily: FONT, minHeight: 44 }}>+ Add transaction</button>}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {filtered.map(t => <TxRow key={t.id} t={{ ...t, _incomeTotal: summary.income }} onDelete={handleDelete} onEdit={onEdit} onLongPress={tx => setQuickTx(tx)} />)}
        </div>
      )}

      {!hintDone && filtered.length > 0 && (
        <div style={{ marginTop: 8, padding: "8px 14px", background: "rgba(255,255,255,0.03)", borderRadius: 10, border: `1px solid rgba(255,255,255,0.05)`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, animation: "hintFade 0.3s ease forwards", animationDelay: "1.2s", opacity: 1 }}>
          <style>{`@keyframes hintFade{0%{opacity:1}100%{opacity:0;visibility:hidden}}`}</style>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 11, color: C.faint }}>Swipe</span>
            <span style={{ fontSize: 11, fontWeight: 500, color: C.blue }}>← Edit</span>
            <span style={{ fontSize: 10, color: C.faint }}>·</span>
            <span style={{ fontSize: 11, fontWeight: 500, color: C.red }}>Delete →</span>
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

function AddTransactionModal({ categories, onAdd, onClose, existing }) {
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

  function switchType(t) { setType(t); setCatId(""); setCatName(""); setShowCats(false); }

  const displayCats = type === "income"
    ? INCOME_CATS.map((c, i) => ({ id: `income-${i}`, ...c }))
    : categories;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.82)", display: "flex", alignItems: "flex-end", zIndex: 100, maxWidth: 430, margin: "0 auto" }}>
      <style>{noSpinStyle}</style>
      <div style={{ background: C.card, width: "100%", borderRadius: "24px 24px 0 0", padding: 24, border: `1px solid ${C.border}`, maxHeight: "90vh", overflowY: "auto", fontFamily: FONT }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{isEdit ? "Edit Transaction" : "Add Transaction"}</h3>
          <button onClick={onClose} style={{ background: C.bgSecondary, border: `1px solid ${C.border}`, borderRadius: 99, cursor: "pointer", width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name="x" size={14} color={C.muted} strokeWidth={2.5} />
          </button>
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          {["expense", "income"].map(t => (
            <button key={t} onClick={() => switchType(t)} style={{ flex: 1, padding: 11, borderRadius: 12, border: `1px solid ${type === t ? (t === "expense" ? C.red : C.green) : C.border}`, background: type === t ? (t === "expense" ? C.red + "18" : C.green + "18") : "transparent", color: type === t ? (t === "expense" ? C.red : C.green) : C.muted, cursor: "pointer", fontWeight: 600, textTransform: "capitalize", fontFamily: FONT }}>{t}</button>
          ))}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ position: "relative" }}>
            <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: C.muted, fontSize: 16, fontWeight: 600, pointerEvents: "none" }}>$</span>
            <input type="number" placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)} style={{ ...inp, paddingLeft: 30 }} />
          </div>
          <input style={inp} placeholder="Description / Merchant (optional)" value={desc} onChange={e => setDesc(e.target.value)} />
          <div>
            <button onClick={() => setShowCats(!showCats)} style={{ ...inp, display: "flex", alignItems: "center", gap: 12, cursor: "pointer", textAlign: "left" }}>
              {catName
                ? type === "income"
                  ? <><div style={{ width: 32, height: 32, borderRadius: 10, background: INCOME_CATS.find(c => c.name === catName)?.color || C.green, display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name={INCOME_CATS.find(c => c.name === catName)?.icon || "dollar"} size={15} color="#fff" strokeWidth={2} /></div><span style={{ color: C.text }}>{catName}</span></>
                  : <><CatIcon name={catName} type={type} size={15} /><span style={{ color: C.text }}>{catName}</span></>
                : <span style={{ color: C.muted }}>Select {type === "income" ? "income source" : "category"}</span>
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
          {isEdit ? "Save Changes" : `Add ${type === "expense" ? "Expense" : "Income"}`}
        </button>
      </div>
    </div>
  );
}

// ─── No-savings-account empty state (shared by all 3 pickers) ─────────────────
function SavingsAccountEmptyState({ onTrackManually }) {
  const [showSteps, setShowSteps] = useState(false);
  const steps = [
    { n: 1, text: "Go to your bank app (BofA, Chase, Wells Fargo, Ally, etc.)" },
    { n: 2, text: "Open a free savings account — takes about 2 minutes online" },
    { n: 3, text: "Come back to Arkonomy and reconnect your bank in Settings" },
  ];
  return (
    <div style={{ borderRadius: 14, border: `1px solid ${C.cyan}30`, background: `linear-gradient(135deg,${C.cyan}06,${C.bgTertiary})`, padding: "14px 16px" }}>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 10 }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: C.cyan + "16", border: `1px solid ${C.cyan}30`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 17 }}>
          🏦
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 3 }}>No savings account found</div>
          <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.6 }}>
            A dedicated savings account helps track real progress. Open one at your bank, then reconnect in Settings.
          </div>
        </div>
      </div>

      {showSteps && (
        <div style={{ margin: "10px 0", display: "flex", flexDirection: "column", gap: 8 }}>
          {steps.map(s => (
            <div key={s.n} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
              <div style={{ width: 20, height: 20, borderRadius: "50%", background: C.cyan + "22", border: `1px solid ${C.cyan}44`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 }}>
                <span style={{ fontSize: 10, fontWeight: 800, color: C.cyan }}>{s.n}</span>
              </div>
              <span style={{ fontSize: 12, color: C.muted, lineHeight: 1.55 }}>{s.text}</span>
            </div>
          ))}
        </div>
      )}

      <button
        onClick={() => setShowSteps(v => !v)}
        style={{ width: "100%", marginTop: 8, padding: "8px 0", borderRadius: 9, border: `1px solid ${C.cyan}40`, background: C.cyan + "0E", color: C.cyan, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: FONT }}
      >
        {showSteps ? "Hide steps ↑" : "Learn how to open a savings account →"}
      </button>
      <button
        onClick={onTrackManually}
        style={{ width: "100%", marginTop: 6, padding: "8px 0", borderRadius: 9, border: `1px solid ${C.border}`, background: "none", color: C.muted, fontSize: 12, fontWeight: 500, cursor: "pointer", fontFamily: FONT }}
      >
        Track manually instead
      </button>
    </div>
  );
}

function SavingsGoalCard({ sv, pct, goalColor, remaining, months, onUpdate, onEdit, onDelete, plaidAccounts = [], getGoalIcon, insight, safeSavingsAmount, maxSavingsAmount, monthlySurplus, userId }) {
  const [mode, setMode] = useState(null);
  const [customAmt, setCustomAmt] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(sv.name);
  const [editTarget, setEditTarget] = useState(String(sv.target));
  const [editAccountId, setEditAccountId] = useState(sv.plaid_account_id || "");
  const [editAccountName, setEditAccountName] = useState(sv.plaid_account_name || "");
  const [showMoveMoney, setShowMoveMoney] = useState(false);

  // ── Reminder state ─────────────────────────────────────────────────────────
  // null = not yet loaded, false = no reminder, object = existing reminder
  const [reminder, setReminder] = useState(null);
  const [loadingReminder, setLoadingReminder] = useState(false);
  const [reminderDay, setReminderDay] = useState(1);   // 1 = Monday default
  const [reminderAmt, setReminderAmt] = useState("");
  const [savingReminder, setSavingReminder] = useState(false);
  const [editingReminder, setEditingReminder] = useState(false);

  const DAYS = [
    { label: "Mon", dow: 1 }, { label: "Tue", dow: 2 }, { label: "Wed", dow: 3 },
    { label: "Thu", dow: 4 }, { label: "Fri", dow: 5 }, { label: "Sat", dow: 6 },
    { label: "Sun", dow: 0 },
  ];
  const DAY_NAMES = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

  async function openMoveMoney() {
    setShowMoveMoney(true);
    if (reminder !== null || !userId) return;
    setLoadingReminder(true);
    const { data } = await supabase.from("savings_reminders")
      .select("*").eq("goal_id", sv.id).eq("user_id", userId).maybeSingle();
    setReminder(data || false);
    if (data) { setReminderDay(data.day_of_week); setReminderAmt(String(data.amount)); }
    setLoadingReminder(false);
  }

  async function saveReminder() {
    const amt = parseFloat(reminderAmt);
    if (!amt || amt <= 0 || !userId) return;
    setSavingReminder(true);
    const { data } = await supabase.from("savings_reminders")
      .upsert({ user_id: userId, goal_id: sv.id, day_of_week: reminderDay, amount: amt, updated_at: new Date().toISOString() },
               { onConflict: "user_id,goal_id" })
      .select().single();
    if (data) {
      setReminder(data);
      setEditingReminder(false);
      // Send confirmation push (fire-and-forget)
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (!session) return;
        fetch(`${SUPABASE_URL}/functions/v1/push-notify`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${session.access_token}`, "apikey": SUPABASE_KEY },
          body: JSON.stringify({ user_id: userId, title: "Reminder set! 💰", body: `Every ${DAY_NAMES[reminderDay]} — transfer $${amt.toFixed(2)} to ${sv.name}`, icon: "/icon-192.png", tag: "savings-reminder-set" }),
        }).catch(() => {});
      });
    }
    setSavingReminder(false);
  }

  async function cancelReminder() {
    if (!userId) return;
    await supabase.from("savings_reminders").delete().eq("goal_id", sv.id).eq("user_id", userId);
    setReminder(false);
    setReminderAmt("");
    setEditingReminder(false);
  }

  // ── Linked Plaid account: derive real balance & progress ────────────────────
  const linkedAccount = sv.plaid_account_id
    ? plaidAccounts.find(a => a.account_id === sv.plaid_account_id) ?? null
    : null;

  const displayBalance  = linkedAccount != null
    ? (linkedAccount.balance_available ?? linkedAccount.balance_current ?? sv.current)
    : sv.current;
  const displayPct      = sv.target > 0 ? Math.min((displayBalance / sv.target) * 100, 100) : 0;
  const displayRemaining = Math.max(sv.target - displayBalance, 0);
  const isLinked = linkedAccount != null;

  const aiContribution = (() => {
    if (isLinked) return null; // linked goals don't use AI contribution buttons
    if (safeSavingsAmount > 0) return safeSavingsAmount;
    if (insight && insight.type === 'goal_off_track' && insight.data?.goalId === sv.id) {
      return insight.rendered?.contribution?.recommended ?? null;
    }
    return null;
  })();

  function confirm() {
    const val = parseFloat(customAmt);
    if (!val || val <= 0) return;
    const next = mode === "deposit"
      ? Number(sv.current) + val
      : Math.max(Number(sv.current) - val, 0);
    onUpdate(sv.id, next);
    setMode(null);
    setCustomAmt("");
  }

  const accentColor = mode === "deposit" ? C.green : mode === "withdraw" ? C.red : goalColor;

  return (
    <GlassCard>
      <style>{`input[type=number]::-webkit-inner-spin-button,input[type=number]::-webkit-outer-spin-button{-webkit-appearance:none}input[type=number]{-moz-appearance:textfield}`}</style>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <div style={{ width: 44, height: 44, borderRadius: 14, background: goalColor + "22", border: `1px solid ${goalColor}44`, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: `0 0 12px ${goalColor}33` }}>
            <Icon name={getGoalIcon(sv.name)} size={20} color={goalColor} />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{sv.name}</div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
              {isLinked
                ? <>${displayBalance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span style={{ color: C.green, fontWeight: 600 }}>live</span> / ${fmt(sv.target, 0)}</>
                : <>${fmt(sv.current, 0)} / ${fmt(sv.target, 0)}{months && <span style={{ color: C.cyan, fontWeight: 500 }}> · ~{months}mo</span>}</>
              }
            </div>
            {sv.plaid_account_name && (
              <div style={{ display: "inline-flex", alignItems: "center", gap: 4, marginTop: 4, background: C.green + "10", border: `1px solid ${C.green}28`, borderRadius: 20, padding: "2px 8px" }}>
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke={C.green} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="22" x2="21" y2="22"/><line x1="6" y1="18" x2="6" y2="11"/><line x1="10" y1="18" x2="10" y2="11"/><line x1="14" y1="18" x2="14" y2="11"/><line x1="18" y1="18" x2="18" y2="11"/><polygon points="12 2 20 7 4 7"/></svg>
                <span style={{ fontSize: 10, color: C.green, fontWeight: 600 }}>{sv.plaid_account_name}</span>
              </div>
            )}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {/* Edit */}
          <button
            onClick={() => { setEditing(v => !v); setConfirmDelete(false); setEditName(sv.name); setEditTarget(String(sv.target)); setEditAccountId(sv.plaid_account_id || ""); setEditAccountName(sv.plaid_account_name || ""); }}
            style={{ width: 28, height: 28, borderRadius: 8, background: editing ? C.blue + "22" : C.bgTertiary, border: `1px solid ${editing ? C.blue + "44" : C.border}`, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
          >
            <Icon name="edit" size={12} color={editing ? C.blue : C.faint} strokeWidth={2} />
          </button>
          {/* Delete */}
          <button
            onClick={() => { setConfirmDelete(v => !v); setEditing(false); }}
            style={{ width: 28, height: 28, borderRadius: 8, background: confirmDelete ? C.red + "18" : C.bgTertiary, border: `1px solid ${confirmDelete ? C.red + "44" : C.border}`, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
          >
            <Icon name="trash" size={12} color={confirmDelete ? C.red : C.faint} strokeWidth={2} />
          </button>
          {/* Progress % */}
          <div style={{ background: goalColor + "22", borderRadius: 100, padding: "4px 10px" }}>
            <span style={{ color: goalColor, fontWeight: 700, fontSize: 13 }}>{displayPct.toFixed(0)}%</span>
          </div>
        </div>
      </div>

      <div style={{ height: 10, background: C.bgTertiary, borderRadius: 99, marginBottom: 8, overflow: "hidden" }}>
        <div style={{ height: 10, borderRadius: 99, width: `${displayPct}%`, background: `linear-gradient(90deg,${goalColor},${goalColor}BB)`, transition: "width 0.6s", boxShadow: `0 0 12px ${goalColor}55` }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: confirmDelete || editing ? 12 : 14 }}>
        <span style={{ color: C.text, fontWeight: 600 }}>
          ${displayBalance.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })} {isLinked ? "available" : "saved"}
        </span>
        <span style={{ color: C.muted }}>${fmt(displayRemaining, 0)} to go</span>
      </div>

      {/* ── Confirm delete ── */}
      {confirmDelete && (
        <div style={{ marginBottom: 14, padding: "12px 14px", background: C.red + "0E", border: `1px solid ${C.red}28`, borderRadius: 12, display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ flex: 1, fontSize: 13, color: C.muted }}>Delete <strong style={{ color: C.text }}>{sv.name}</strong>?</span>
          <button
            onClick={() => { onDelete(sv.id); }}
            style={{ padding: "6px 14px", borderRadius: 8, border: "none", background: C.red, color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: FONT }}
          >Delete</button>
          <button
            onClick={() => setConfirmDelete(false)}
            style={{ padding: "6px 12px", borderRadius: 8, border: `1px solid ${C.border}`, background: "none", color: C.muted, fontSize: 12, fontWeight: 500, cursor: "pointer", fontFamily: FONT }}
          >Cancel</button>
        </div>
      )}

      {/* ── Inline edit form ── */}
      {editing && (
        <div style={{ marginBottom: 14, padding: "14px", background: C.bgTertiary, borderRadius: 12, border: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.muted, letterSpacing: 0.5, marginBottom: 12, textTransform: "uppercase" }}>Edit Goal</div>

          {/* Name */}
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 4 }}>Goal name</div>
          <input
            value={editName}
            onChange={e => setEditName(e.target.value)}
            style={{ width: "100%", padding: "10px 12px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, color: C.text, fontSize: 13, outline: "none", boxSizing: "border-box", fontFamily: FONT, marginBottom: 10 }}
          />

          {/* Target */}
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 4 }}>Target amount ($)</div>
          <input
            type="number"
            value={editTarget}
            onChange={e => setEditTarget(e.target.value)}
            style={{ width: "100%", padding: "10px 12px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, color: C.text, fontSize: 13, outline: "none", boxSizing: "border-box", fontFamily: FONT, marginBottom: 12 }}
          />

          {/* Account selector — savings accounts only */}
          {plaidAccounts.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: C.muted, marginBottom: 6 }}>
                Savings account <span style={{ color: C.faint }}>(optional)</span>
              </div>
              {(() => {
                const cardSavings = plaidAccounts.filter(a => a.subtype === "savings" || a.type === "savings");
                return cardSavings.length > 0 ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                    <div onClick={() => { setEditAccountId(""); setEditAccountName(""); }}
                      style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 8, border: `1px solid ${!editAccountId ? C.cyan + "55" : C.border}`, background: !editAccountId ? C.cyan + "08" : C.bg, cursor: "pointer" }}>
                      <span style={{ fontSize: 12, color: !editAccountId ? C.text : C.muted }}>Track manually</span>
                      {!editAccountId && <svg style={{ marginLeft: "auto" }} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={C.cyan} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
                    </div>
                    {cardSavings.map(acc => {
                      const label = `${acc.name}${acc.mask ? ` ••••${acc.mask}` : ""}`;
                      const bal = acc.balance_available ?? acc.balance_current;
                      const sel = editAccountId === acc.account_id;
                      return (
                        <div key={acc.account_id} onClick={() => { setEditAccountId(acc.account_id); setEditAccountName(label); }}
                          style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 8, border: `1px solid ${sel ? C.green + "55" : C.border}`, background: sel ? C.green + "08" : C.bg, cursor: "pointer" }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12, color: C.text, fontWeight: sel ? 600 : 400, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</div>
                            {acc.institution_name && <div style={{ fontSize: 10, color: C.faint }}>{acc.institution_name}</div>}
                          </div>
                          {bal != null && <span style={{ fontSize: 12, fontWeight: 600, color: sel ? C.green : C.muted, flexShrink: 0 }}>${bal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>}
                          {sel && <svg style={{ flexShrink: 0 }} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={C.green} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <SavingsAccountEmptyState onTrackManually={() => { setEditAccountId(""); setEditAccountName(""); }} />
                );
              })()}
            </div>
          )}

          {/* Save / Cancel */}
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => {
                if (!editName.trim() || !editTarget) return;
                onEdit(sv.id, { name: editName.trim(), target: parseFloat(editTarget), plaid_account_id: editAccountId || null, plaid_account_name: editAccountName || null });
                setEditing(false);
              }}
              style={{ flex: 1, padding: "9px 0", borderRadius: 10, border: "none", background: `linear-gradient(90deg,${C.green},#00A67E)`, color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: FONT }}
            >Save</button>
            <button
              onClick={() => setEditing(false)}
              style={{ flex: 1, padding: "9px 0", borderRadius: 10, border: `1px solid ${C.border}`, background: "none", color: C.muted, fontSize: 13, fontWeight: 500, cursor: "pointer", fontFamily: FONT }}
            >Cancel</button>
          </div>
        </div>
      )}

      {isLinked && (
        <div style={{ marginBottom: 10, padding: "8px 12px", background: C.green + "0A", border: `1px solid ${C.green}20`, borderRadius: 10, display: "flex", alignItems: "center", gap: 6 }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={C.green} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
          <span style={{ fontSize: 11, color: C.green, fontWeight: 600 }}>Your money stays in your bank · synced automatically</span>
        </div>
      )}
      <button
        onClick={openMoveMoney}
        style={{ width: "100%", padding: "11px 16px", background: C.bgTertiary, border: `1px solid ${C.border}`, borderRadius: 11, color: C.text, fontWeight: 600, fontSize: 14, cursor: "pointer", fontFamily: FONT, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        Move Money
      </button>

      {showMoveMoney && (
        <div onClick={() => setShowMoveMoney(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)", zIndex: 200, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
          <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 430, background: C.card, borderRadius: "22px 22px 0 0", border: `1px solid ${C.border}`, padding: 24, paddingBottom: 36, fontFamily: FONT, maxHeight: "90vh", overflowY: "auto" }}>
            <div style={{ width: 32, height: 4, background: "rgba(255,255,255,0.11)", borderRadius: 2, margin: "0 auto 20px" }} />

            {/* Header */}
            <div style={{ width: 44, height: 44, borderRadius: 14, background: C.green + "18", border: `1px solid ${C.green}33`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={C.green} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="22" x2="21" y2="22"/><line x1="6" y1="18" x2="6" y2="11"/><line x1="10" y1="18" x2="10" y2="11"/><line x1="14" y1="18" x2="14" y2="11"/><line x1="18" y1="18" x2="18" y2="11"/><polygon points="12 2 20 7 4 7"/></svg>
            </div>
            <div style={{ fontSize: 18, fontWeight: 800, color: C.text, textAlign: "center", marginBottom: 8 }}>Move Money</div>
            {isLinked && (
              <>
                <div style={{ fontSize: 13, color: C.muted, textAlign: "center", lineHeight: 1.65, marginBottom: 20 }}>
                  Transfer funds directly in your{" "}
                  <strong style={{ color: C.text }}>{linkedAccount.institution_name || sv.plaid_account_name || "bank"} app</strong>.
                  <br />Your balance here updates automatically when Arkonomy syncs.
                </div>

                {/* Linked account card */}
                <div style={{ background: C.bgSecondary, borderRadius: 12, padding: "12px 14px", marginBottom: 20, border: `1px solid ${C.border}` }}>
                  <div style={{ fontSize: 11, color: C.faint, fontWeight: 600, letterSpacing: 0.5, marginBottom: 6 }}>LINKED ACCOUNT</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{sv.plaid_account_name}</div>
                  {linkedAccount.balance_available != null && (
                    <div style={{ fontSize: 12, color: C.muted, marginTop: 3 }}>
                      Available: <strong style={{ color: C.green }}>${linkedAccount.balance_available.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
                    </div>
                  )}
                </div>
              </>
            )}

                {/* ── Weekly reminder section ── */}
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 12 }}>Set a weekly reminder</div>

                  {loadingReminder ? (
                    <div style={{ fontSize: 12, color: C.faint, textAlign: "center", padding: "12px 0" }}>Loading…</div>
                  ) : reminder && !editingReminder ? (
                    /* Existing reminder display */
                    <div style={{ background: C.green + "0D", border: `1px solid ${C.green}30`, borderRadius: 12, padding: "12px 14px" }}>
                      <div style={{ fontSize: 12, color: C.faint, fontWeight: 600, letterSpacing: 0.5, marginBottom: 4 }}>ACTIVE REMINDER</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 10 }}>
                        Every {DAY_NAMES[reminder.day_of_week]} · ${Number(reminder.amount).toFixed(2)}
                      </div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button onClick={() => setEditingReminder(true)}
                          style={{ flex: 1, padding: "8px 0", borderRadius: 9, border: `1px solid ${C.border}`, background: C.bgTertiary, color: C.muted, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: FONT }}>
                          Edit
                        </button>
                        <button onClick={cancelReminder}
                          style={{ flex: 1, padding: "8px 0", borderRadius: 9, border: `1px solid ${C.red}33`, background: C.red + "0D", color: C.red, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: FONT }}>
                          Cancel reminder
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* Set / edit reminder form */
                    <div style={{ background: C.bgTertiary, borderRadius: 12, padding: "14px" }}>
                      {/* Day chips */}
                      <div style={{ fontSize: 12, color: C.muted, marginBottom: 8 }}>Remind me every</div>
                      <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
                        {DAYS.map(d => (
                          <button key={d.dow} onClick={() => setReminderDay(d.dow)}
                            style={{ flex: 1, padding: "7px 0", borderRadius: 9, border: `1px solid ${reminderDay === d.dow ? C.cyan + "66" : C.border}`, background: reminderDay === d.dow ? C.cyan + "18" : "transparent", color: reminderDay === d.dow ? C.cyan : C.muted, fontSize: 11, fontWeight: reminderDay === d.dow ? 700 : 400, cursor: "pointer", fontFamily: FONT }}>
                            {d.label}
                          </button>
                        ))}
                      </div>

                      {/* Amount input */}
                      <div style={{ fontSize: 12, color: C.muted, marginBottom: 6 }}>Remind me to transfer</div>
                      <div style={{ position: "relative", marginBottom: 14 }}>
                        <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", fontSize: 15, fontWeight: 700, color: C.muted, pointerEvents: "none" }}>$</span>
                        <input type="number" placeholder="0.00" value={reminderAmt} onChange={e => setReminderAmt(e.target.value)}
                          style={{ width: "100%", padding: "11px 12px 11px 26px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, color: C.text, fontSize: 15, fontWeight: 600, outline: "none", boxSizing: "border-box", fontFamily: FONT }} />
                      </div>

                      <button onClick={saveReminder} disabled={savingReminder || !reminderAmt}
                        style={{ width: "100%", padding: "11px 0", borderRadius: 10, border: "none", background: (!reminderAmt || savingReminder) ? C.bgSecondary : `linear-gradient(90deg,${C.cyan},${C.blue})`, color: (!reminderAmt || savingReminder) ? C.faint : "#000", fontSize: 13, fontWeight: 700, cursor: (!reminderAmt || savingReminder) ? "default" : "pointer", fontFamily: FONT }}>
                        {savingReminder ? "Saving…" : "Set Reminder"}
                      </button>
                      {editingReminder && (
                        <button onClick={() => setEditingReminder(false)}
                          style={{ width: "100%", marginTop: 8, padding: "9px 0", borderRadius: 10, border: `1px solid ${C.border}`, background: "none", color: C.muted, fontSize: 12, cursor: "pointer", fontFamily: FONT }}>
                          Cancel
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Got it */}
                <button onClick={() => setShowMoveMoney(false)} style={{ width: "100%", padding: 14, background: C.bgSecondary, border: `1px solid ${C.border}`, borderRadius: 14, color: C.muted, fontWeight: 500, fontSize: 14, cursor: "pointer", fontFamily: FONT }}>
                  Got it
                </button>
              </div>
            </div>
          )}
      {!isLinked && (
        <>
          {aiContribution > 0 ? (
            <div style={{ marginBottom: 10 }}>
              <button
                onClick={() => onUpdate(sv.id, Number(sv.current) + aiContribution)}
                style={{ width: "100%", padding: "12px 16px", marginBottom: 6, background: goalColor, border: "none", borderRadius: 11, color: "#fff", fontWeight: 800, fontSize: 14, cursor: "pointer", fontFamily: FONT, letterSpacing: -0.2, boxShadow: `0 4px 16px ${goalColor}44`, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, transition: "transform 0.12s ease, box-shadow 0.12s ease" }}
                onPointerDown={e => { e.currentTarget.style.transform = "scale(0.98)"; }}
                onPointerUp={e => { e.currentTarget.style.transform = "scale(1.02)"; setTimeout(() => { e.currentTarget.style.transform = "scale(1)"; }, 120); }}
                onPointerLeave={e => { e.currentTarget.style.transform = "scale(1)"; }}
              >
                Add ${aiContribution} to savings
                <span style={{ fontSize: 10, fontWeight: 600, background: "rgba(255,255,255,0.20)", borderRadius: 20, padding: "2px 8px", letterSpacing: 0.2, whiteSpace: "nowrap" }}>
                  Recommended · Keeps your buffer safe
                </span>
              </button>
              {maxSavingsAmount > aiContribution && (
                <button
                  onClick={() => onUpdate(sv.id, Number(sv.current) + Math.round(maxSavingsAmount))}
                  style={{ width: "100%", padding: "9px 16px", background: "transparent", border: `1px solid ${C.border}`, borderRadius: 10, color: C.muted, fontWeight: 600, fontSize: 12, cursor: "pointer", fontFamily: FONT, transition: "border-color 0.15s" }}
                  onPointerEnter={e => e.currentTarget.style.borderColor = C.faint}
                  onPointerLeave={e => e.currentTarget.style.borderColor = C.border}
                >
                  Add ${Math.round(maxSavingsAmount)} (max)
                </button>
              )}
            </div>
          ) : (
            <div style={{ marginBottom: 10, padding: "10px 14px", background: "rgba(255,255,255,0.03)", borderRadius: 10, fontSize: 12, color: C.muted, lineHeight: 1.5, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#FFB800" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginRight: 6 }}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              Increase your income or reduce spending to start saving
            </div>
          )}

          {monthlySurplus > 0 && (
            <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
              {[10, 25, 50, 100].map(amt => (
                <button key={amt} onClick={() => onUpdate(sv.id, Number(sv.current) + amt)}
                  style={{ flex: 1, padding: "8px 0", background: goalColor + "15", border: `1px solid ${goalColor}40`, borderRadius: 10, color: goalColor + "CC", cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: FONT, transition: "all 0.15s" }}>
                  +${amt}
                </button>
              ))}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, marginBottom: mode ? 10 : 0 }}>
            {monthlySurplus > 0 && (
              <button onClick={() => { setMode(mode === "deposit" ? null : "deposit"); setCustomAmt(""); }}
                style={{ flex: 1, padding: "10px 0", borderRadius: 10, border: `1px solid ${mode === "deposit" ? C.green : C.border}`, background: mode === "deposit" ? C.green + "20" : C.bgTertiary, color: mode === "deposit" ? C.green : C.muted, cursor: "pointer", fontWeight: 600, fontSize: 13, fontFamily: FONT, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                <Icon name="plus" size={14} color={mode === "deposit" ? C.green : C.muted} strokeWidth={2.5} /> Deposit
              </button>
            )}
            <button onClick={() => { setMode(mode === "withdraw" ? null : "withdraw"); setCustomAmt(""); }}
              style={{ flex: 1, padding: "10px 0", borderRadius: 10, border: `1px solid ${mode === "withdraw" ? C.red : C.border}`, background: mode === "withdraw" ? C.red + "20" : C.bgTertiary, color: mode === "withdraw" ? C.red : C.muted, cursor: "pointer", fontWeight: 600, fontSize: 13, fontFamily: FONT, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
              <Icon name="trending-down" size={14} color={mode === "withdraw" ? C.red : C.muted} strokeWidth={2.5} /> Withdraw
            </button>
          </div>

          {mode && (
            <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
              <div style={{ flex: 1, position: "relative" }}>
                <span style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", color: C.muted, fontSize: 15, fontWeight: 700, pointerEvents: "none" }}>$</span>
                <input autoFocus type="number" placeholder="0.00" value={customAmt} onChange={e => setCustomAmt(e.target.value)} onKeyDown={e => e.key === "Enter" && confirm()}
                  style={{ width: "100%", padding: "12px 12px 12px 28px", background: C.bg, border: `2px solid ${accentColor}66`, borderRadius: 10, color: C.text, fontSize: 15, outline: "none", boxSizing: "border-box", fontFamily: FONT }} />
              </div>
              <button onClick={confirm} style={{ padding: "12px 20px", background: accentColor, border: "none", borderRadius: 10, color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: FONT }}>
                {mode === "deposit" ? "Add" : "Withdraw"}
              </button>
              <button onClick={() => { setMode(null); setCustomAmt(""); }} style={{ padding: "12px", background: C.bgTertiary, border: `1px solid ${C.border}`, borderRadius: 10, cursor: "pointer", display: "flex", alignItems: "center" }}>
                <Icon name="x" size={14} color={C.muted} strokeWidth={2.5} />
              </button>
            </div>
          )}
        </>
      )}
    </GlassCard>
  );
}

function Savings({ savings, onAdd, onUpdate, onEdit, onDelete, totalIncome, totalSpent, transactions, insight, onInsightAction, onInvestAlpaca, isPro, onUpgrade, alpacaConnected, onConnectAlpaca, bankConnected, userId }) {
  // ── All useState calls grouped together first (Rules of Hooks) ───────────────
  const [showAdd, setShowAdd]               = useState(false);
  const [selectedPreset, setSelectedPreset] = useState(null); // { name, target, icon, color }
  const [newName, setNewName]               = useState("");
  const [newTarget, setNewTarget]           = useState("");
  const [newAccountId, setNewAccountId]     = useState("");
  const [newAccountName, setNewAccountName] = useState("");
  const [plaidAccounts, setPlaidAccounts]   = useState([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [accountsError, setAccountsError]   = useState(null);
  const [roundupEnabled, setRoundupEnabled] = useState(false);
  const [roundupMultiplier, setRoundupMultiplier] = useState(1);
  const [showAlpacaSheet, setShowAlpacaSheet] = useState(false);
  const [accountLinkMode, setAccountLinkMode] = useState("auto"); // "auto" | "manual"

  // ── Fetch Plaid accounts ──────────────────────────────────────────────────────
  async function fetchPlaidAccounts() {
    setLoadingAccounts(true);
    setAccountsError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { console.warn("[plaid-get-accounts] no session"); setLoadingAccounts(false); return; }
      console.log("[plaid-get-accounts] fetching with token prefix:", session.access_token?.slice(0, 20));
      const res = await fetch(`${SUPABASE_URL}/functions/v1/plaid-get-accounts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`,
          "apikey": SUPABASE_KEY,
        },
        body: "{}",
      });
      const d = await res.json();
      console.log("[plaid-get-accounts] HTTP", res.status, "response:", JSON.stringify(d));
      if (!res.ok) { setAccountsError(d.error || d.message || `HTTP ${res.status}`); return; }
      if (d.accounts) {
        setPlaidAccounts(d.accounts);
        console.log("[plaid-get-accounts] loaded", d.accounts.length, "accounts");
      }
    } catch (err) {
      console.error("[plaid-get-accounts] exception:", err);
      setAccountsError(String(err));
    } finally {
      setLoadingAccounts(false);
    }
  }

  useEffect(() => {
    if (bankConnected) fetchPlaidAccounts();
  }, [bankConnected]);

  // Only savings-subtype accounts are valid sources for goal tracking
  const savingsAccounts = plaidAccounts.filter(a => a.subtype === "savings" || a.type === "savings");

  const BASE_MONTHLY = totalSpent > 0 ? Math.floor(totalSpent * 0.03 * 100) / 100 : 26;
  const roundupMonth = parseFloat((BASE_MONTHLY * roundupMultiplier).toFixed(2));
  const roundupTotal = parseFloat((roundupMonth * 3.2).toFixed(2));
  const roundupYearly = Math.round(roundupMonth * 12 / 10) * 10;

  const inp = { width: "100%", padding: "12px 14px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 12, color: C.text, fontSize: 14, outline: "none", boxSizing: "border-box", marginBottom: 10, fontFamily: FONT };

  const totalSaved     = savings.reduce((s, sv) => s + Number(sv.current), 0);
  const monthlySurplus = totalIncome - totalSpent;

  // Доступный баланс = месячный профицит (что реально можно отложить в этом месяце)
  const availableBalance = Math.max(monthlySurplus, 0);
  // Keep up to 50% of surplus as buffer (capped at $500), so small surpluses can still generate a savings recommendation
  const safetyBuffer = Math.min(500, availableBalance * 0.5);

  // safeAmount = сколько можно безопасно отложить
  const safeAmount = Math.max(availableBalance - safetyBuffer, 0);

  // recommendedAmount = CLAMP(safeAmount * 0.6, safeMin, safeMax)
  // Fallback $50–$100 только если safeAmount реально мал (< $800)
  const SAFE_MIN = 200;
  const SAFE_MAX = 400;
  const recommendedAmount = safeAmount <= 0
    ? 0
    : safeAmount < 800
      ? Math.min(Math.max(Math.round(safeAmount * 0.6), 50), 100)
      : Math.min(Math.max(Math.round(safeAmount * 0.6), SAFE_MIN), SAFE_MAX);

  // safeSavingsAmount = то что передаётся в SavingsGoalCard как primary CTA
  const safeSavingsAmount = recommendedAmount;
  const maxSavingsAmount  = Math.round(safeAmount);

  function getGoalIcon(name) {
    const n = (name || "").toLowerCase();
    if (n.includes("vacat") || n.includes("trip")) return "target";
    if (n.includes("car")   || n.includes("vehicle")) return "car";
    if (n.includes("house") || n.includes("home"))    return "bank";
    if (n.includes("phone") || n.includes("tech"))    return "phone";
    if (n.includes("emergency") || n.includes("fund")) return "lock";
    return "star";
  }

  function monthsToGoal(sv) {
    const remaining = Number(sv.target) - Number(sv.current);
    if (monthlySurplus <= 0 || remaining <= 0) return null;
    return Math.ceil(remaining / (monthlySurplus * 0.5));
  }

  const projMap = { 1: roundupMonth, 2: roundupMonth * 2, 5: roundupMonth * 5, 10: roundupMonth * 10 };
  const currentProjMonthly = Math.round(projMap[roundupMultiplier]);
  const currentProjYearly  = Math.round(currentProjMonthly * 12 / 10) * 10;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h2 style={{ margin: "0 0 2px", fontSize: 26, fontWeight: 700 }}>Savings Goals</h2>
          <div style={{ fontSize: 13, color: C.muted }}>Track your progress</div>
        </div>
        <button onClick={() => setShowAdd(!showAdd)} style={{ background: C.green, border: "none", borderRadius: 22, padding: "9px 16px", color: "#000", fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 5, fontSize: 14, fontFamily: FONT, boxShadow: `0 0 20px ${C.green}44` }}>
          <Icon name="plus" size={14} color="#000" strokeWidth={2.5} /> Goal
        </button>
      </div>

      {insight && ['savings_opportunity', 'goal_off_track'].includes(insight.type) && monthlySurplus > 0 && savings.length > 0 && (insight.type !== 'goal_off_track' || savings.some(sv => sv.id === insight.data?.goalId)) && (
        <InsightCard insight={insight} onAction={onInsightAction} />
      )}

      {(totalSaved > 0 || monthlySurplus > 0) && (
        <div style={{ background: monthlySurplus < 0 ? "linear-gradient(135deg,#2A0D0D,#261426)" : "linear-gradient(135deg,#0D2A1F,#0B1426)", borderRadius: 20, padding: 20, border: `1px solid ${monthlySurplus < 0 ? C.red : C.green}30` }}>
          <div style={{ display: "flex", marginBottom: safeSavingsAmount > 0 ? 14 : 0 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 10, color: C.faint, fontWeight: 500, letterSpacing: 0.5, marginBottom: 4 }}>TOTAL SAVED</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: C.green }}>${fmt(totalSaved, 0)}</div>
            </div>
            <div style={{ flex: 1, paddingLeft: 20, borderLeft: `1px solid ${C.sep}` }}>
              <div style={{ fontSize: 10, color: monthlySurplus < 0 ? C.red : C.faint, fontWeight: 500, letterSpacing: 0.5, marginBottom: 4 }}>{monthlySurplus < 0 ? "MONTHLY DEFICIT" : "MONTHLY SURPLUS"}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: monthlySurplus >= 0 ? C.green : C.red }}>${fmt(Math.abs(monthlySurplus), 0)}</div>
            </div>
          </div>
          {safeSavingsAmount > 0 && maxSavingsAmount > 0 && (
            <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: 12, padding: "10px 14px", fontSize: 12, color: C.muted, lineHeight: 1.6 }}>
              💡 You can move up to <strong style={{ color: C.text }}>${fmt(maxSavingsAmount, 0)}</strong>, but a safer amount is <strong style={{ color: C.green }}>${fmt(safeSavingsAmount, 0)}–${fmt(Math.min(safeSavingsAmount + 100, maxSavingsAmount), 0)}</strong> to keep your buffer stable.
            </div>
          )}
        </div>
      )}

      <div style={{ background: "linear-gradient(135deg,#0D2233,#0B1426)", borderRadius: 20, padding: 20, border: `1px solid ${C.cyan}30`, position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: -20, right: -20, width: 100, height: 100, borderRadius: "50%", background: C.cyan + "0A", pointerEvents: "none" }} />
        {!alpacaConnected && (
          <div style={{ textAlign: "center", padding: "8px 0 4px" }}>
            <div style={{ width: 44, height: 44, borderRadius: 14, background: C.cyan + "18", border: `1px solid ${C.cyan}33`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px" }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={C.cyan} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>
              </svg>
            </div>
            <div style={{ fontWeight: 700, fontSize: 15, color: C.text, marginBottom: 6 }}>Spare Change Investing</div>
            <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.6, marginBottom: 16 }}>
              Connect Alpaca to enable spare change investing — automatically invest your round-ups.
            </div>
            <button onClick={() => { if (!isPro) { onUpgrade(); return; } onConnectAlpaca?.(); }}
              style={{ width: "100%", padding: "12px 16px", background: isPro ? `linear-gradient(135deg,#7B5EA7,#4B6CB7)` : C.bgTertiary, border: isPro ? "none" : `1px solid ${C.border}`, borderRadius: 12, color: isPro ? "#fff" : C.faint, fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: FONT, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, boxShadow: isPro ? "0 4px 16px rgba(75,108,183,0.35)" : "none" }}>
              {isPro ? "Connect Alpaca" : <><span>🔒</span> Connect Alpaca — Pro only</>}
            </button>
          </div>
        )}
        {alpacaConnected && <>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: C.cyan + "22", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: `0 0 8px ${C.cyan}22` }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.cyan} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <path d="M12 6v2m0 8v2M9.5 9.5C9.5 8.1 10.6 7 12 7s2.5 1.1 2.5 2.5c0 2.5-5 2.5-5 5C9.5 15.9 10.6 17 12 17s2.5-1.1 2.5-2.5"/>
              </svg>
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>Spare change from your spending</div>
              {roundupEnabled ? (
                <div style={{ fontSize: 12, color: C.green, marginTop: 2, fontWeight: 500 }}>Round-up tracking is ON</div>
              ) : (
                <div style={{ marginTop: 2 }}>
                  <div style={{ fontSize: 12, color: C.muted, fontWeight: 500 }}>Round-up tracking is OFF</div>
                  <div style={{ fontSize: 11, color: C.faint, marginTop: 1 }}>Turn on to track spare change</div>
                </div>
              )}
            </div>
          </div>
          <div onClick={() => { if (!isPro) { onUpgrade(); return; } setRoundupEnabled(v => !v); }} style={{ width: 44, height: 26, borderRadius: 99, background: roundupEnabled ? C.cyan + "33" : C.bgTertiary, border: `1px solid ${roundupEnabled ? C.cyan + "66" : C.border}`, position: "relative", cursor: "pointer", transition: "all 0.22s", flexShrink: 0 }}>
            <div style={{ position: "absolute", top: 3, left: roundupEnabled ? 20 : 3, width: 18, height: 18, borderRadius: 99, background: roundupEnabled ? C.cyan : C.faint, transition: "left 0.2s", boxShadow: "0 1px 4px rgba(0,0,0,0.4)" }} />
          </div>
        </div>

        <div style={{ display: "flex", gap: 0, marginBottom: 12, paddingBottom: 12, borderBottom: `1px solid ${C.sep}` }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, color: C.faint, fontWeight: 500, letterSpacing: 0.5, marginBottom: 3 }}>THIS MONTH</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: roundupEnabled ? C.cyan : C.faint }}>{roundupEnabled ? `$${fmt(roundupMonth, 2)}` : "$0.00"}</div>
            <div style={{ fontSize: 11, color: C.faint, marginTop: 2 }}>Based on your purchases</div>
          </div>
          <div style={{ flex: 1, paddingLeft: 16, borderLeft: `1px solid ${C.sep}` }}>
            <div style={{ fontSize: 10, color: C.faint, fontWeight: 500, letterSpacing: 0.5, marginBottom: 3 }}>ALL TIME</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: roundupEnabled ? C.green : C.faint }}>{roundupEnabled ? `$${fmt(roundupTotal, 2)}` : "$0.00"}</div>
          </div>
        </div>

        {roundupMonth >= 1 && monthlySurplus > 0 && (
          <button onClick={() => { if (!isPro) { onUpgrade(); return; } if (!alpacaConnected) { onConnectAlpaca?.(); return; } setShowAlpacaSheet(true); }}
            style={{ width: "100%", padding: "12px 16px", marginBottom: 12, background: isPro && alpacaConnected ? `linear-gradient(135deg, #7B5EA7, #4B6CB7)` : "#1E2D45", border: isPro && alpacaConnected ? "none" : `1px solid #2D3F58`, borderRadius: 11, color: isPro && alpacaConnected ? "#fff" : "#7A8BA8", fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: FONT, letterSpacing: -0.2, boxShadow: isPro && alpacaConnected ? "0 4px 16px rgba(75,108,183,0.35)" : "none", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, transition: "transform 0.12s ease" }}
            onPointerDown={e => { e.currentTarget.style.transform = "scale(0.98)"; }}
            onPointerUp={e => { e.currentTarget.style.transform = "scale(1.02)"; setTimeout(() => { e.currentTarget.style.transform = ""; }, 120); }}
            onPointerLeave={e => { e.currentTarget.style.transform = ""; }}
          >
            {!isPro
              ? <><span>🔒</span> Invest via Alpaca — Pro only</>
              : !alpacaConnected
              ? <><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>Connect Alpaca to invest</>
              : <><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>Invest ${Math.floor(roundupMonth)} via Alpaca</>
            }
          </button>
        )}

        {monthlySurplus >= 0 ? (
          <>
            <div style={{ fontSize: 11, color: C.faint, marginBottom: 12 }}>Small amounts like this are easiest to invest regularly.</div>

            <div style={{ display: "flex", alignItems: "flex-start", gap: 7, marginBottom: 12, fontSize: 12, opacity: 1 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={roundupEnabled ? "#12D18E" : "#4A5E7A"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
                <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>
              </svg>
              {roundupEnabled ? (
                <span style={{ color: C.muted }}>≈ <strong style={{ color: C.green }}>${currentProjMonthly}/month</strong>{" "}→ ~${currentProjYearly}/year at current pace</span>
              ) : (
                <span><span style={{ color: C.muted }}>Turn on to track <strong style={{ color: C.cyan }}>~${currentProjMonthly}/month</strong> in spare change</span><br /><span style={{ fontSize: 11, color: C.faint }}>≈ ${currentProjYearly}/year, without noticing</span></span>
              )}
            </div>

            <div style={{ fontSize: 12, color: C.muted, marginBottom: 8 }}>Multiplier</div>
            <div style={{ display: "flex", gap: 6 }}>
              {[1, 2, 5, 10].map(m => (
                <button key={m} onClick={() => setRoundupMultiplier(m)}
                  style={{ flex: 1, padding: "8px 0", borderRadius: 10, border: `1px solid ${roundupMultiplier === m ? C.cyan : C.border}`, background: roundupMultiplier === m ? C.cyan + "22" : "transparent", color: roundupMultiplier === m ? C.cyan : C.muted, cursor: "pointer", fontSize: 13, fontWeight: 700, fontFamily: FONT, transform: roundupMultiplier === m ? "scale(1.04)" : "scale(1)", boxShadow: roundupMultiplier === m ? `0 0 10px ${C.cyan}33` : "none", transition: "all 0.15s" }}>
                  {m}x
                </button>
              ))}
            </div>

            <div style={{ marginTop: 10, fontSize: 12, color: C.muted, minHeight: 18 }}>
              {roundupEnabled
                ? <>At {roundupMultiplier}x you track <strong style={{ color: C.cyan }}>~${currentProjMonthly}/month</strong> in spare change</>
                : <>At {roundupMultiplier}x you'd track <strong style={{ color: "rgba(154,164,178,0.45)" }}>~${currentProjMonthly}/month</strong></>
              }
            </div>
          </>
        ) : (
          <div style={{ padding: "10px 14px", background: C.bgTertiary, border: `1px solid ${C.border}`, borderRadius: 12, fontSize: 12, color: C.muted, lineHeight: 1.5 }}>
            Once your spending is balanced, round-up savings will unlock automatically.
          </div>
        )}
        </>}
      </div>

      {showAlpacaSheet && (
        <div onClick={() => setShowAlpacaSheet(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)", zIndex: 150, display: "flex", alignItems: "flex-end", maxWidth: 430, margin: "0 auto" }}>
          <div onClick={e => e.stopPropagation()} style={{ width: "100%", background: C.card, borderRadius: "22px 22px 0 0", border: `1px solid ${C.border}`, padding: 24, fontFamily: FONT }}>
            <div style={{ width: 32, height: 4, background: "rgba(255,255,255,0.11)", borderRadius: 2, margin: "0 auto 20px" }} />
            <div style={{ textAlign: "center", marginBottom: 20 }}>
              <div style={{ fontSize: 36, fontWeight: 800, color: C.text, letterSpacing: -1 }}>${Math.floor(roundupMonth)}</div>
              <div style={{ fontSize: 13, color: C.muted, marginTop: 4 }}>to invest via Alpaca</div>
            </div>
            <div style={{ background: C.bgSecondary, borderRadius: 14, padding: "14px 16px", marginBottom: 20, border: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.65 }}>
                This amount comes from your round-ups, tracked based on your purchases.{" "}<strong style={{ color: C.text, fontWeight: 600 }}>Money stays in your account</strong> until you confirm — we don't move anything automatically.
              </div>
            </div>
            <button onClick={() => { setShowAlpacaSheet(false); onInvestAlpaca?.({ roundUpMonthly: roundupMonth }); }} style={{ width: "100%", padding: 15, marginBottom: 10, background: `linear-gradient(135deg, #7B5EA7, #4B6CB7)`, border: "none", borderRadius: 14, color: "#fff", fontWeight: 700, fontSize: 15, cursor: "pointer", fontFamily: FONT, boxShadow: "0 4px 20px rgba(75,108,183,0.35)" }}>
              Confirm investment
            </button>
            <button onClick={() => setShowAlpacaSheet(false)} style={{ width: "100%", padding: 14, background: C.bgSecondary, border: `1px solid ${C.border}`, borderRadius: 14, color: C.muted, fontWeight: 500, fontSize: 14, cursor: "pointer", fontFamily: FONT }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {showAdd && savings.length > 0 && (
        <GlassCard>
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 14 }}>New Savings Goal</div>
          <input style={inp} placeholder="Goal name (e.g. Vacation, Emergency Fund)" value={newName} onChange={e => setNewName(e.target.value)} />
          <input style={inp} type="number" placeholder="Target amount ($)" value={newTarget} onChange={e => setNewTarget(e.target.value)} />

          {/* Account selector — savings accounts only */}
          {bankConnected && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 12, color: C.muted, fontWeight: 500, marginBottom: 6 }}>
                Savings account <span style={{ color: C.faint }}>(optional — track real balance)</span>
              </div>
              {loadingAccounts ? (
                <div style={{ fontSize: 12, color: C.faint, padding: "10px 14px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 12 }}>Loading accounts…</div>
              ) : accountsError ? (
                <div style={{ fontSize: 12, color: C.red, padding: "10px 14px", background: C.red + "0A", border: `1px solid ${C.red}22`, borderRadius: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>Could not load accounts: {accountsError}</span>
                  <button onClick={fetchPlaidAccounts} style={{ background: "none", border: "none", color: C.cyan, fontSize: 12, cursor: "pointer", fontFamily: FONT, fontWeight: 600, marginLeft: 8 }}>Retry</button>
                </div>
              ) : savingsAccounts.length > 0 ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div onClick={() => { setNewAccountId(""); setNewAccountName(""); }}
                    style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 10, border: `1px solid ${!newAccountId ? C.cyan + "55" : C.border}`, background: !newAccountId ? C.cyan + "08" : C.bg, cursor: "pointer" }}>
                    <div style={{ width: 28, height: 28, borderRadius: 8, background: C.bgTertiary, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={C.faint} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </div>
                    <span style={{ fontSize: 13, color: !newAccountId ? C.text : C.muted }}>Track manually (no bank link)</span>
                    {!newAccountId && <svg style={{ marginLeft: "auto" }} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.cyan} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
                  </div>
                  {savingsAccounts.map(acc => {
                    const label = `${acc.name}${acc.mask ? ` ••••${acc.mask}` : ""}`;
                    const balance = acc.balance_available ?? acc.balance_current;
                    const selected = newAccountId === acc.account_id;
                    return (
                      <div key={acc.account_id} onClick={() => { setNewAccountId(acc.account_id); setNewAccountName(label); }}
                        style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 10, border: `1px solid ${selected ? C.green + "55" : C.border}`, background: selected ? C.green + "08" : C.bg, cursor: "pointer" }}>
                        <div style={{ width: 28, height: 28, borderRadius: 8, background: C.green + "18", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={C.green} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="22" x2="21" y2="22"/><line x1="6" y1="18" x2="6" y2="11"/><line x1="10" y1="18" x2="10" y2="11"/><line x1="14" y1="18" x2="14" y2="11"/><line x1="18" y1="18" x2="18" y2="11"/><polygon points="12 2 20 7 4 7"/></svg>
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, color: C.text, fontWeight: selected ? 600 : 400, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</div>
                          {acc.institution_name && <div style={{ fontSize: 11, color: C.faint }}>{acc.institution_name}</div>}
                        </div>
                        <div style={{ textAlign: "right", flexShrink: 0 }}>
                          {balance != null && <div style={{ fontSize: 13, fontWeight: 700, color: selected ? C.green : C.text }}>${balance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>}
                          <div style={{ fontSize: 10, color: C.faint, textTransform: "capitalize" }}>{acc.subtype}</div>
                        </div>
                        {selected && <svg style={{ flexShrink: 0, marginLeft: 4 }} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.green} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
                      </div>
                    );
                  })}
                </div>
              ) : accountLinkMode === "manual" ? (
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", background: C.bgSecondary, border: `1px solid ${C.border}`, borderRadius: 10 }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={C.cyan} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  <span style={{ fontSize: 12, color: C.muted, fontWeight: 500 }}>Tracking manually</span>
                </div>
              ) : (
                <SavingsAccountEmptyState onTrackManually={() => { setNewAccountId(""); setNewAccountName(""); setAccountLinkMode("manual"); }} />
              )}
            </div>
          )}

          <button onClick={() => {
            if (!newName || !newTarget) return;
            onAdd({ name: newName, target: parseFloat(newTarget), current: 0, icon: "star", color: C.green, plaid_account_id: newAccountId || null, plaid_account_name: newAccountName || null });
            setShowAdd(false); setNewName(""); setNewTarget(""); setNewAccountId(""); setNewAccountName(""); setAccountLinkMode("auto");
          }} style={{ width: "100%", padding: 13, background: `linear-gradient(90deg,${C.green},#00A67E)`, border: "none", borderRadius: 12, color: C.bg, fontWeight: 700, cursor: "pointer", fontFamily: FONT }}>
            Create Goal
          </button>
        </GlassCard>
      )}

      {savings.length === 0 ? (
        <GlassCard style={{ padding: "24px 20px", textAlign: "center" }}>
          <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 52, height: 52, borderRadius: 16, background: C.green + "14", border: `1px solid ${C.green}22`, marginBottom: 14, animation: "goalFloat 3s ease-in-out infinite" }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={C.green} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>
            </svg>
          </div>
          <style>{`@keyframes goalFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}`}</style>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Start your first goal</div>
          <div style={{ fontSize: 13, color: C.muted, marginBottom: 20, lineHeight: 1.5 }}>Build your first $1,000.<br /><span style={{ color: C.faint, fontSize: 12 }}>Start with small automatic savings</span></div>
          {(() => {
            const PRESETS = [
              { name: "Emergency Fund", target: 1000, icon: "lock",   color: C.green, accentSvg: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.green} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg> },
              { name: "Vacation",       target: 2000, icon: "target", color: C.cyan,  accentSvg: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.cyan}  strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/></svg> },
            ];
            return (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, textAlign: "left" }}>
                {PRESETS.map(p => {
                  const isSelected = selectedPreset?.name === p.name;
                  return (
                    <div key={p.name}
                      onClick={() => { setSelectedPreset(isSelected ? null : p); setShowAdd(false); setNewAccountId(""); setNewAccountName(""); setAccountLinkMode("auto"); }}
                      style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: isSelected ? p.color + "10" : C.bgSecondary, border: `1px solid ${isSelected ? p.color + "55" : C.border}`, borderRadius: 12, padding: "13px 14px", cursor: "pointer", transition: "all 0.15s" }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{ width: 36, height: 36, borderRadius: 10, background: p.color + "18", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                          {p.accentSvg}
                        </div>
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{p.name}</div>
                          <div style={{ fontSize: 12, color: C.muted, marginTop: 1 }}>Target: ${p.target.toLocaleString()}</div>
                        </div>
                      </div>
                      {isSelected
                        ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={p.color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                        : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.faint} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                      }
                    </div>
                  );
                })}

                {/* Create button — shown when a preset is selected */}
                {selectedPreset && (
                  <button
                    onClick={() => {
                      onAdd({ name: selectedPreset.name, target: selectedPreset.target, current: 0, icon: selectedPreset.icon, color: selectedPreset.color, plaid_account_id: null, plaid_account_name: null });
                      setSelectedPreset(null);
                    }}
                    style={{ width: "100%", padding: 13, background: `linear-gradient(90deg,${selectedPreset.color},${selectedPreset.color}CC)`, border: "none", borderRadius: 12, color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: FONT }}
                  >
                    Create {selectedPreset.name}
                  </button>
                )}

                <div onClick={() => { setShowAdd(true); setSelectedPreset(null); }}
                  style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 8, background: C.bgSecondary, border: `1px dashed ${C.border}`, borderRadius: 12, padding: "13px 14px", cursor: "pointer", color: C.muted, fontSize: 14, fontWeight: 500, transition: "color 0.15s, border-color 0.15s" }}
                  onPointerEnter={e => { e.currentTarget.style.color = C.text; e.currentTarget.style.borderColor = C.muted; }}
                  onPointerLeave={e => { e.currentTarget.style.color = C.muted; e.currentTarget.style.borderColor = C.border; }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  Custom goal
                </div>
              </div>
            );
          })()}
        </GlassCard>
      ) : (
        savings.map(sv => {
          const pct       = sv.target > 0 ? Math.min((Number(sv.current) / Number(sv.target)) * 100, 100) : 0;
          const goalColor = sv.color || C.green;
          const remaining = Math.max(Number(sv.target) - Number(sv.current), 0);
          const months    = monthsToGoal(sv);
          return <SavingsGoalCard key={sv.id} sv={sv} pct={pct} goalColor={goalColor} remaining={remaining} months={months} onUpdate={onUpdate} onEdit={onEdit} onDelete={onDelete} plaidAccounts={plaidAccounts} getGoalIcon={getGoalIcon} insight={insight} safeSavingsAmount={safeSavingsAmount} maxSavingsAmount={maxSavingsAmount} monthlySurplus={monthlySurplus} userId={userId} />;
        })
      )}
    </div>
  );
}

const CHAT_SUGGESTIONS = [
  "What did I spend most on this month?",
  "Am I on track with my budget?",
  "How can I save more money?",
  "What are my recurring charges?",
];

function Chat({ messages, input, setInput, onSend, onClose }) {
  const bottomRef = useRef(null);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const isWelcomeOnly = messages.length === 1 && messages[0].role === "assistant";

  function sendSuggestion(text) { setInput(text); onSend(text); }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: onClose ? "100%" : "auto", paddingBottom: onClose ? 0 : 80 }}>
      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10, marginTop: 10, marginBottom: 10 }}>
        {messages.map((m, i) => (
          <div key={i} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", background: m.role === "user" ? `linear-gradient(90deg,${C.cyan},${C.blue})` : C.card, color: m.role === "user" ? "#fff" : C.text, padding: "12px 16px", borderRadius: m.role === "user" ? "18px 18px 4px 18px" : "18px 18px 18px 4px", maxWidth: "82%", fontSize: 14, border: m.role === "assistant" ? `1px solid ${C.border}` : "none", lineHeight: 1.65, fontWeight: m.role === "user" ? 500 : 400 }}>
            {m.loading
              ? <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                  {[0,1,2].map(j => <span key={j} style={{ width: 6, height: 6, borderRadius: "50%", background: C.muted, display: "inline-block", animation: `bop 1.2s ease-in-out ${j*0.2}s infinite` }} />)}
                  <style>{`@keyframes bop{0%,80%,100%{transform:translateY(0)}40%{transform:translateY(-6px)}}`}</style>
                </span>
              : m.text}
          </div>
        ))}
        {isWelcomeOnly && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
            {CHAT_SUGGESTIONS.map(q => (
              <button
                key={q}
                onClick={() => sendSuggestion(q)}
                style={{ alignSelf: "flex-start", background: C.bgTertiary, border: `1px solid ${C.border}`, borderRadius: 20, padding: "8px 14px", color: C.muted, fontSize: 13, cursor: "pointer", fontFamily: FONT, textAlign: "left" }}
                onPointerEnter={e => { e.currentTarget.style.borderColor = C.cyan + "66"; e.currentTarget.style.color = C.text; }}
                onPointerLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.muted; }}
              >
                {q}
              </button>
            ))}
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      <div style={{ fontSize: 10, color: C.faint, textAlign: "center", marginBottom: 8, lineHeight: 1.5, flexShrink: 0 }}>
        AI insights are for informational purposes only and should not be considered financial advice.
      </div>
      <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
        <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && onSend()} placeholder="Ask about your finances..." style={{ flex: 1, padding: "13px 16px", background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, color: C.text, fontSize: 14, outline: "none", fontFamily: FONT }} />
        <button onClick={onSend} style={{ padding: "13px 18px", background: `linear-gradient(90deg,${C.cyan},${C.blue})`, border: "none", borderRadius: 14, cursor: "pointer", display: "flex", alignItems: "center" }}>
          <Icon name="send" size={16} color="#fff" strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}

// ─── Plaid Link Button ────────────────────────────────────────
function PlaidLinkButton({ linkToken, onSuccess, onExit, autoOpen = false }) {
  const { receivedRedirectUri, clearRedirectUri } = usePlaidOAuth();

  // When resuming after OAuth redirect: token must be null and receivedRedirectUri
  // is passed instead. Plaid Link uses it to complete the OAuth handshake.
  const isOAuthResume = Boolean(receivedRedirectUri);
  const { open, ready } = usePlaidLink({
    token: isOAuthResume ? null : linkToken,
    receivedRedirectUri: receivedRedirectUri ?? undefined,
    onSuccess: (public_token, metadata) => {
      clearRedirectUri();
      onSuccess(public_token, metadata);
    },
    onExit: (err, metadata) => {
      clearRedirectUri();
      onExit?.(err, metadata);
    },
  });

  // Auto-open Plaid Link as soon as the SDK is ready — eliminates the
  // two-click problem where the user clicks a button, the token loads,
  // and then they have to click a second button to actually open Plaid.
  useEffect(() => {
    if (autoOpen && ready) open();
  }, [autoOpen, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <button
      onClick={() => open()}
      disabled={!ready}
      style={{
        width: "100%", padding: 14,
        background: ready ? "linear-gradient(135deg,#1A56DB,#2F80FF)" : "rgba(26,86,219,0.4)",
        border: "none", borderRadius: 14,
        color: "#fff", fontWeight: 700, fontSize: 15,
        cursor: ready ? "pointer" : "not-allowed",
        fontFamily: FONT,
        display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
        boxShadow: ready ? "0 4px 20px rgba(26,86,219,0.4)" : "none",
        transition: "all 0.2s",
      }}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="3" y1="22" x2="21" y2="22"/>
        <line x1="6" y1="18" x2="6" y2="11"/>
        <line x1="10" y1="18" x2="10" y2="11"/>
        <line x1="14" y1="18" x2="14" y2="11"/>
        <line x1="18" y1="18" x2="18" y2="11"/>
        <polygon points="12 2 20 7 4 7"/>
      </svg>
      {ready ? "Connect Your Bank" : "Loading..."}
    </button>
  );
}

// ─── Profile / Settings ───────────────────────────────────────
function Profile({ profile, user, onSave, autopilot, setAutopilot, bankConnected, bankName, bankCount, linkToken, getLinkToken, onPlaidSuccess, syncBankTransactions, syncingBank, lastSyncedAt, backgroundSyncing, isPro, onUpgrade, transactions = [] }) {
  const [budget, setBudget] = useState(profile?.monthly_budget || 3000);
  const [goal, setGoal] = useState(profile?.savings_goal || 10000);
  const [saved, setSaved] = useState(false);
  const [showChangePw, setShowChangePw] = useState(false);
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwMsg, setPwMsg] = useState(null); // { type: "success"|"error", text }
  const [pwLoading, setPwLoading] = useState(false);

  async function handleChangePassword() {
    setPwMsg(null);
    if (!newPw || !confirmPw) { setPwMsg({ type: "error", text: "Please fill in both fields." }); return; }
    if (newPw !== confirmPw) { setPwMsg({ type: "error", text: "Passwords don't match." }); return; }
    if (newPw.length < 6) { setPwMsg({ type: "error", text: "Password must be at least 6 characters." }); return; }
    setPwLoading(true);
    const { error } = await supabase.auth.updateUser({ password: newPw });
    setPwLoading(false);
    if (error) { setPwMsg({ type: "error", text: error.message }); return; }
    setPwMsg({ type: "success", text: "Password updated successfully." });
    setNewPw(""); setConfirmPw("");
    setTimeout(() => { setShowChangePw(false); setPwMsg(null); }, 2000);
  }
  const inp = { width: "100%", padding: "13px 14px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 12, color: C.text, fontSize: 15, outline: "none", boxSizing: "border-box", fontFamily: FONT };

  const budgetSuggestion = useMemo(() => {
    const expenses = transactions.filter(t => t.type === "expense");
    const byMonth = {};
    for (const t of expenses) {
      const month = (t.date || "").slice(0, 7); // "YYYY-MM"
      if (!month) continue;
      byMonth[month] = (byMonth[month] || 0) + Number(t.amount);
    }
    const months = Object.keys(byMonth);
    if (months.length < 2) return null;
    const avg = months.reduce((s, m) => s + byMonth[m], 0) / months.length;
    return Math.round(avg);
  }, [transactions]);

  function Toggle({ value, onChange }) {
    return (
      <div onClick={() => onChange(!value)} style={{ width: 44, height: 26, borderRadius: 99, background: value ? C.cyan + "33" : C.bgTertiary, border: `1px solid ${value ? C.cyan + "66" : C.border}`, position: "relative", cursor: "pointer", transition: "all 0.2s", flexShrink: 0 }}>
        <div style={{ position: "absolute", top: 3, left: value ? 20 : 3, width: 18, height: 18, borderRadius: 99, background: value ? C.cyan : C.faint, transition: "left 0.2s" }} />
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, paddingBottom: 80 }}>
      <h2 style={{ margin: 0, fontSize: 26, fontWeight: 700 }}>Settings</h2>

      <GlassCard>
        <div style={{ color: C.faint, fontSize: 10, letterSpacing: 1.2, fontWeight: 600, marginBottom: 8 }}>ACCOUNT</div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: showChangePw ? 14 : 0 }}>
          <div style={{ width: 42, height: 42, borderRadius: 14, background: C.cyan + "22", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Icon name="dollar" size={18} color={C.cyan} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{profile?.full_name || "User"}</div>
            <div style={{ color: C.muted, fontSize: 13 }}>{user.email}</div>
          </div>
          <button
            onClick={() => { setShowChangePw(v => !v); setPwMsg(null); setNewPw(""); setConfirmPw(""); }}
            style={{ flexShrink: 0, background: "none", border: `1px solid ${C.border}`, borderRadius: 8, padding: "5px 10px", color: C.muted, fontSize: 12, fontWeight: 500, cursor: "pointer", fontFamily: FONT, whiteSpace: "nowrap" }}
          >
            {showChangePw ? "Cancel" : "Change Password"}
          </button>
        </div>

        {showChangePw && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <input
              type="password"
              placeholder="New password"
              value={newPw}
              onChange={e => setNewPw(e.target.value)}
              style={{ width: "100%", padding: "11px 14px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, color: C.text, fontSize: 14, outline: "none", boxSizing: "border-box", fontFamily: FONT }}
            />
            <input
              type="password"
              placeholder="Confirm new password"
              value={confirmPw}
              onChange={e => setConfirmPw(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleChangePassword()}
              style={{ width: "100%", padding: "11px 14px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, color: C.text, fontSize: 14, outline: "none", boxSizing: "border-box", fontFamily: FONT }}
            />
            {pwMsg && (
              <div style={{ fontSize: 12, fontWeight: 500, padding: "8px 12px", borderRadius: 8, background: pwMsg.type === "success" ? C.green + "14" : C.red + "14", color: pwMsg.type === "success" ? C.green : C.red, border: `1px solid ${pwMsg.type === "success" ? C.green + "33" : C.red + "33"}` }}>
                {pwMsg.text}
              </div>
            )}
            <button
              onClick={handleChangePassword}
              disabled={pwLoading}
              style={{ width: "100%", padding: "11px 0", background: pwLoading ? C.bgTertiary : `linear-gradient(90deg,${C.cyan},${C.blue})`, border: "none", borderRadius: 10, color: pwLoading ? C.faint : "#000", fontWeight: 700, fontSize: 14, cursor: pwLoading ? "default" : "pointer", fontFamily: FONT }}
            >
              {pwLoading ? "Updating…" : "Update Password"}
            </button>
          </div>
        )}
      </GlassCard>

      {!isPro && (
        <div
          onClick={onUpgrade}
          style={{
            display: "flex", alignItems: "center", gap: 14,
            background: "linear-gradient(135deg, #7C6BFF18, #38B6FF0A)",
            border: "1px solid #7C6BFF33",
            borderRadius: 18, padding: "16px 18px",
            cursor: "pointer",
          }}
        >
          <div style={{
            width: 42, height: 42, borderRadius: 13, flexShrink: 0,
            background: "linear-gradient(135deg, #7C6BFF33, #38B6FF22)",
            border: "1px solid #7C6BFF44",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="#38B6FF" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 2 }}>Upgrade to Pro</div>
            <div style={{ fontSize: 12, color: C.muted }}>Unlock AI insights, investing & more — $9.99/mo</div>
          </div>
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={C.faint} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </div>
      )}

      {/* ── PLAID BANK CONNECTION ── */}
      <GlassCard style={{ border: `1px solid ${bankConnected ? C.green + "44" : "#1A56DB44"}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: bankConnected ? C.green + "22" : "#1A56DB22", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name="bank" size={18} color={bankConnected ? C.green : "#1A56DB"} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>
              {bankConnected ? bankName || "Bank Connected" : "Connect Your Bank"}
            </div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
              {bankConnected
                ? backgroundSyncing
                  ? "Syncing now…"
                  : lastSyncedAt
                    ? `Last synced: ${timeAgo(lastSyncedAt)}`
                    : "✓ Auto-sync enabled"
                : "Sync real transactions via Plaid"
              }
            </div>
          </div>
          {bankConnected && (
            <div style={{ background: C.green + "22", border: `1px solid ${C.green}44`, borderRadius: 100, padding: "3px 10px" }}>
              <span style={{ fontSize: 11, color: C.green, fontWeight: 600 }}>Active</span>
            </div>
          )}
        </div>

        {bankConnected && linkToken ? (
          <PlaidLinkButton linkToken={linkToken} onSuccess={onPlaidSuccess} onExit={() => {}} autoOpen />
        ) : bankConnected ? (
          <>
            <button onClick={syncBankTransactions} disabled={syncingBank}
              style={{ width: "100%", padding: 13, background: syncingBank ? C.bgTertiary : C.green + "22", border: `1px solid ${C.green}44`, borderRadius: 14, color: C.green, fontWeight: 600, fontSize: 14, cursor: syncingBank ? "not-allowed" : "pointer", fontFamily: FONT, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 8 }}>
              <Icon name="repeat" size={15} color={C.green} strokeWidth={2} />
              {syncingBank ? "Syncing..." : "Sync Transactions"}
            </button>
            <button
              onClick={() => { if (!isPro) { onUpgrade(); return; } getLinkToken(); }}
              style={{ width: "100%", padding: 12, background: isPro ? "#1A56DB22" : C.bgTertiary, border: `1px solid ${isPro ? "#1A56DB44" : C.border}`, borderRadius: 14, color: isPro ? "#4B8EFF" : C.faint, fontWeight: 600, fontSize: 13, cursor: "pointer", fontFamily: FONT, display: "flex", alignItems: "center", justifyContent: "center", gap: 7 }}>
              {isPro ? <Icon name="plus" size={13} color="#4B8EFF" strokeWidth={2.5} /> : <span>🔒</span>}
              {isPro ? `Add Another Bank (${bankCount} connected)` : "Add Another Bank — Pro only"}
            </button>
          </>
        ) : linkToken ? (
          <PlaidLinkButton linkToken={linkToken} onSuccess={onPlaidSuccess} onExit={() => {}} autoOpen />
        ) : (
          <button onClick={getLinkToken}
            style={{ width: "100%", padding: 14, background: "linear-gradient(135deg,#1A56DB,#2F80FF)", border: "none", borderRadius: 14, color: "#fff", fontWeight: 700, fontSize: 15, cursor: "pointer", fontFamily: FONT, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, boxShadow: "0 4px 20px rgba(26,86,219,0.4)" }}>
            <Icon name="bank" size={17} color="#fff" strokeWidth={2} />
            Connect Your Bank
          </button>
        )}

        {!bankConnected && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10, justifyContent: "center" }}>
            <Icon name="lock" size={11} color={C.faint} />
            <span style={{ fontSize: 11, color: C.faint }}>256-bit encryption · Read-only access</span>
          </div>
        )}
      </GlassCard>

      <GlassCard>
        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 16 }}>Financial Settings</div>
        <div style={{ color: C.muted, fontSize: 12, fontWeight: 500, marginBottom: 6 }}>Monthly Budget ($)</div>
        <input style={{ ...inp, marginBottom: 8 }} type="number" value={budget} onChange={e => setBudget(e.target.value)} />
        {budgetSuggestion !== null ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: C.cyan + "12", border: `1px solid ${C.cyan}33`, borderRadius: 10, padding: "9px 12px", marginBottom: 14, gap: 8 }}>
            <div style={{ fontSize: 12, color: C.cyan, fontWeight: 500 }}>
              Based on your history: <strong>${budgetSuggestion.toLocaleString()}/month avg</strong>
            </div>
            <button
              onClick={() => setBudget(budgetSuggestion)}
              style={{ flexShrink: 0, padding: "5px 11px", background: C.cyan + "22", border: `1px solid ${C.cyan}55`, borderRadius: 8, color: C.cyan, fontWeight: 600, fontSize: 11, cursor: "pointer", fontFamily: FONT, whiteSpace: "nowrap" }}>
              Use this
            </button>
          </div>
        ) : (
          <div style={{ fontSize: 11, color: C.faint, marginBottom: 14, padding: "7px 10px", background: C.bgTertiary, borderRadius: 9 }}>
            Not enough data yet — we'll suggest a budget after 2 months of transactions.
          </div>
        )}
        <div style={{ color: C.muted, fontSize: 12, fontWeight: 500, marginBottom: 6 }}>Annual Savings Goal ($)</div>
        <input style={{ ...inp, marginBottom: 18 }} type="number" value={goal} onChange={e => setGoal(e.target.value)} />
        <button onClick={async () => { await onSave({ monthly_budget: parseFloat(budget), savings_goal: parseFloat(goal) }); setSaved(true); setTimeout(() => setSaved(false), 2000); }}
          style={{ width: "100%", padding: 14, background: saved ? C.green : `linear-gradient(90deg,${C.cyan},${C.blue})`, border: "none", borderRadius: 12, color: saved ? C.bg : "#fff", fontWeight: 700, cursor: "pointer", transition: "background 0.3s", fontFamily: FONT }}>
          {saved ? "Saved!" : "Save Settings"}
        </button>
      </GlassCard>

      <GlassCard>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 15 }}>Autopilot</div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>Smart alerts & rules</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, background: C.green + "18", border: `1px solid ${C.green}33`, borderRadius: 100, padding: "4px 12px" }}>
            <div style={{ width: 6, height: 6, borderRadius: 99, background: C.green }} />
            <span style={{ fontSize: 11, color: C.green, fontWeight: 600 }}>Active</span>
          </div>
        </div>
        {[
          { key: "overspendAlerts",  icon: "bell",         color: C.yellow, title: "Overspending Alerts",  sub: "Alert when monthly spending exceeds budget" },
          { key: "largeTxAlerts",   icon: "alert-circle", color: C.red,    title: "Large Transactions",   sub: `Alert for purchases over $${autopilot.largeTxThreshold}` },
          { key: "lowBalanceAlerts",icon: "dollar",       color: C.green,  title: "Low Budget Warning",   sub: `Alert when less than $${autopilot.lowBalanceThreshold} remains in budget` },
          { key: "unusualSpending", icon: "activity",     color: C.cyan,   title: "Unusual Spending",     sub: "Alert when category up 25%+ vs last month" },
        ].map((rule, i) => (
          <div key={rule.key}>
            {i > 0 && <div style={{ height: 1, background: C.sep, margin: "12px 0" }} />}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: rule.color + "22", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <Icon name={rule.icon} size={16} color={rule.color} />
                </div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{rule.title}</div>
                  <div style={{ fontSize: 12, color: C.muted, marginTop: 1 }}>{rule.sub}</div>
                </div>
              </div>
              <Toggle value={autopilot[rule.key]} onChange={v => setAutopilot(prev => ({ ...prev, [rule.key]: v }))} />
            </div>
          </div>
        ))}
      </GlassCard>

      <GlassCard style={{ border: `1px solid ${C.yellow}22` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <Icon name="info" size={15} color={C.yellow} />
          <span style={{ fontWeight: 600, fontSize: 14, color: C.yellow }}>Legal & Disclosures</span>
        </div>
        <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.7 }}>
          Investment accounts and brokerage services are provided by <span style={{ color: C.text, fontWeight: 500 }}>Alpaca Securities LLC</span>, a registered broker-dealer and member of FINRA and SIPC. Arkonomy is not a broker-dealer and does not provide investment advice.
        </div>
        <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.7, marginTop: 10 }}>
          AI insights are for informational purposes only and should not be considered financial advice.
        </div>
      </GlassCard>

      <GlassCard>
        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 14 }}>Coming Next</div>
        {[
          { label: "Auto-Invest (Alpaca)", color: "#059669", icon: "activity" },
          { label: "Subscription Tracker", color: "#7C3AED", icon: "repeat" },
          { label: "Tax Tagging", color: "#0891B2", icon: "tag" },
        ].map((item, i, arr) => (
          <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 14, padding: "11px 0", borderBottom: i < arr.length - 1 ? `1px solid ${C.sep}` : "none" }}>
            <div style={{ width: 38, height: 38, borderRadius: 12, background: item.color + "22", border: `1px solid ${item.color}33`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Icon name={item.icon} size={17} color={item.color} />
            </div>
            <span style={{ color: C.muted, fontSize: 14, flex: 1 }}>{item.label}</span>
            <Icon name="chevron" size={16} color={C.faint} />
          </div>
        ))}
      </GlassCard>

      <div style={{ textAlign: "center", padding: "24px 0 8px", fontSize: 12, color: C.faint, fontFamily: FONT }}>
        <a href="/privacy.html" target="_blank" rel="noopener noreferrer" style={{ color: C.faint, textDecoration: "none" }}>Privacy Policy</a>
        <span style={{ margin: "0 8px" }}>·</span>
        <a href="/terms.html" target="_blank" rel="noopener noreferrer" style={{ color: C.faint, textDecoration: "none" }}>Terms of Service</a>
        <span style={{ margin: "0 8px" }}>·</span>
        <a href="/cybersecurity.html" target="_blank" rel="noopener noreferrer" style={{ color: C.faint, textDecoration: "none" }}>Cybersecurity Policy</a>
      </div>
    </div>
  );
}

// ─── Markets Helpers ──────────────────────────────────────────

const DEFAULT_WATCHLIST = ["SPY", "QQQ", "BTC", "ETH"];

const MARKET_META = {
  SPY:  { label: "S&P 500",  color: "#2F80FF", icon: "bar-chart", isCrypto: false },
  QQQ:  { label: "NASDAQ",   color: "#A78BFA", icon: "activity",  isCrypto: false },
  BTC:  { label: "Bitcoin",  color: "#F59E0B", icon: "zap",       isCrypto: true  },
  ETH:  { label: "Ethereum", color: "#34D399", icon: "zap",       isCrypto: true  },
  SOL:  { label: "Solana",   color: "#9945FF", icon: "zap",       isCrypto: true  },
  DOGE: { label: "Dogecoin", color: "#C2A633", icon: "zap",       isCrypto: true  },
};

const TRENDING = [
  { symbol: "AAPL", name: "Apple Inc.",   color: "#9AA4B2" },
  { symbol: "TSLA", name: "Tesla, Inc.",  color: "#E05C5C" },
  { symbol: "NVDA", name: "NVIDIA Corp.", color: "#76B900" },
];

const SECTORS = [
  { name: "Tech",       etf: "XLK", color: "#2F80FF", stocks: ["AAPL", "MSFT", "NVDA"]  },
  { name: "Finance",    etf: "XLF", color: "#A78BFA", stocks: ["JPM",  "BAC",  "GS"]    },
  { name: "Energy",     etf: "XLE", color: "#F59E0B", stocks: ["XOM",  "CVX",  "COP"]   },
  { name: "Healthcare", etf: "XLV", color: "#34D399", stocks: ["UNH",  "JNJ",  "ABBV"]  },
  { name: "Consumer",   etf: "XLY", color: "#FF6B9D", stocks: ["AMZN", "HD",   "MCD"]   },
];

// Alpaca uses BTCUSD / ETHUSD for crypto orders
const ALPACA_SYMBOL_MAP = { BTC: "BTCUSD", ETH: "ETHUSD", SOL: "SOLUSD", DOGE: "DOGEUSD" };
function alpacaSym(s) { return ALPACA_SYMBOL_MAP[s] ?? s; }

function fmtPrice(n, isCrypto = false) {
  if (n == null) return "—";
  if (isCrypto && n >= 1000) return "$" + Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (isCrypto) return "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  return "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function callMarketData(body) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/market-data`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${session?.access_token ?? ""}`,
      "apikey": SUPABASE_KEY,
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

// ─── Price Chart (SVG, no dependencies) ───────────────────────
function PriceChart({ candles = [], color, height = 130 }) {
  if (!candles.length) return (
    <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center", color: C.faint, fontSize: 12 }}>
      No chart data
    </div>
  );

  const prices = candles.map((c) => c.c).filter(p => typeof p === "number" && isFinite(p));
  if (prices.length < 2) {
    // Not enough points to draw a line — duplicate the single point to form a flat line
    if (prices.length === 1) prices.push(prices[0]);
    else return (
      <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center", color: C.faint, fontSize: 12 }}>
        No chart data
      </div>
    );
  }

  const min    = Math.min(...prices);
  const max    = Math.max(...prices);
  const range  = max - min || 1;
  const W = 320, PAD = 6;
  const isPositive = prices[prices.length - 1] >= prices[0];
  const lineColor  = color ?? (isPositive ? C.green : C.red);
  const gradId = `cg_${lineColor.replace("#", "")}`;

  const pts = prices.map((p, i) => {
    const x = PAD + (i / (prices.length - 1)) * (W - PAD * 2);
    const y = PAD + (1 - (p - min) / range) * (height - PAD * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const linePath = `M ${pts.join(" L ")}`;
  const fillPath = `${linePath} L ${(W - PAD).toFixed(1)},${height} L ${PAD},${height} Z`;

  return (
    <svg viewBox={`0 0 ${W} ${height}`} style={{ width: "100%", height, display: "block" }} preserveAspectRatio="none">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={lineColor} stopOpacity="0.25" />
          <stop offset="100%" stopColor={lineColor} stopOpacity="0"    />
        </linearGradient>
      </defs>
      <path d={fillPath} fill={`url(#${gradId})`} />
      <path d={linePath} fill="none" stroke={lineColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ─── Stock Detail Screen ───────────────────────────────────────
function StockDetail({ symbol, onBack, user, alpacaConnected, onConnectAlpaca }) {
  const meta    = MARKET_META[symbol] ?? { label: symbol, color: C.cyan, icon: "activity", isCrypto: false };
  const [tab, setTab]         = useState("overview");
  const [period, setPeriod]   = useState("1M");
  const [stats, setStats]     = useState(null);
  const [candles, setCandles] = useState([]);
  const [ai, setAi]           = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState(null);
  const [loadingStats, setLoadingStats]   = useState(true);
  const [loadingChart, setLoadingChart]   = useState(false);
  const [chartError, setChartError]       = useState(null);
  const [buyAmt, setBuyAmt]   = useState("100");
  const [buying, setBuying]   = useState(false);
  const [buyResult, setBuyResult] = useState(null);
  const [hintDismissed, setHintDismissed] = useState(false);

  // Use a ref so loadAi always reads the latest stats without being in effect deps
  const statsRef = useRef(null);
  useEffect(() => {
    setLoadingStats(true);
    callMarketData({ type: "stats", symbol })
      .then(d => { statsRef.current = d; setStats(d); setLoadingStats(false); })
      .catch(() => setLoadingStats(false));
  }, [symbol]);

  useEffect(() => {
    setLoadingChart(true);
    setChartError(null);
    callMarketData({ type: "chart", symbol, period })
      .then(d => {
        if (d?.error) {
          console.error("[Chart] API error:", d.error);
          setChartError(d.error);
          setCandles([]);
        } else {
          setCandles(d?.candles ?? []);
        }
        setLoadingChart(false);
      })
      .catch(err => {
        console.error("[Chart] fetch error:", err);
        setChartError(String(err));
        setLoadingChart(false);
      });
  }, [symbol, period]);

  // Use a ref to guard against double-invocation (StrictMode / fast deps)
  const aiCalledRef = useRef(false);

  async function runAiAnalysis() {
    if (aiCalledRef.current) return;
    aiCalledRef.current = true;
    setAiLoading(true);
    setAiError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const s = statsRef.current;
      const res = await fetch(`${SUPABASE_URL}/functions/v1/stock-ai-analysis`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session?.access_token ?? ""}`,
          "apikey": SUPABASE_KEY,
        },
        body: JSON.stringify({
          symbol,
          name:      s?.name ?? symbol,
          price:     s?.price ?? null,
          pe:        s?.pe ?? null,
          high52w:   s?.high52w ?? null,
          low52w:    s?.low52w ?? null,
          changePct: s?.changePct ?? null,
          isCrypto:  meta.isCrypto,
        }),
      });
      if (!res.ok && res.status !== 200) {
        let errMsg = `HTTP ${res.status}`;
        try { const j = await res.json(); errMsg = j.error ?? errMsg; } catch {}
        throw new Error(errMsg);
      }
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setAi(data);
    } catch (e) {
      console.error("[AI Analysis] error:", e);
      setAiError(e.message ?? "Analysis failed");
    } finally {
      setAiLoading(false);
    }
  }

  useEffect(() => {
    if (tab === "ai") runAiAnalysis();
  }, [tab]);

  async function handleBuy() {
    if (buying || !buyAmt || Number(buyAmt) < 1) return;
    setBuying(true);
    setBuyResult(null);
    try {
      const { data: result, error } = await supabase.functions.invoke("alpaca-invest", {
        body: { amount: Number(buyAmt), symbol: alpacaSym(symbol) },
      });
      if (error) {
        // supabase.functions.invoke wraps non-2xx in FunctionsHttpError —
        // the real error body is in error.context, not error.message
        let msg = error.message ?? "Order failed";
        try {
          const body = typeof error.context?.json === "function"
            ? await error.context.json()
            : null;
          if (body?.error)   msg = body.error;
          if (body?.details) console.error("[Buy] Alpaca details:", body.details);
        } catch {}
        console.error("[Buy] invoke error:", msg);
        if (msg.includes("Insufficient buying power") || msg.includes("not configured") || msg.includes("ALPACA_API_KEY")) {
          setBuyResult({ notConnected: true });
        } else {
          setBuyResult({ error: msg });
        }
      } else if (result?.error) {
        if (result.error.includes("Insufficient buying power") || result.error.includes("not configured")) {
          setBuyResult({ notConnected: true });
        } else {
          setBuyResult({ error: result.error });
        }
      } else {
        setBuyResult({ success: true, message: result?.message ?? `$${buyAmt} order placed` });
      }
    } catch (e) { setBuyResult({ error: String(e) }); }
    setBuying(false);
  }

  const isPos = (stats?.changePct ?? 0) >= 0;
  const chColor = isPos ? C.green : C.red;
  const PERIODS = ["1D", "1W", "1M", "1Y"];
  const TABS = ["overview", "chart", "ai", "buy"];

  return (
    <div style={{ display: "flex", flexDirection: "column", paddingBottom: 80, fontFamily: FONT }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
        <button onClick={onBack} style={{ background: C.bgSecondary, border: `1px solid ${C.border}`, borderRadius: 10, width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}>
          <Icon name="arrow-left" size={16} color={C.text} />
        </button>
        <div style={{ width: 38, height: 38, borderRadius: 12, background: meta.color + "22", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Icon name={meta.icon} size={17} color={meta.color} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{meta.label || symbol}</div>
          <div style={{ fontSize: 12, color: C.muted }}>{symbol}</div>
        </div>
        {stats && (
          <div style={{ textAlign: "right" }}>
            <div style={{ fontWeight: 800, fontSize: 20, letterSpacing: -0.5 }}>{fmtPrice(stats.price, meta.isCrypto)}</div>
            <div style={{ fontSize: 12, color: chColor, fontWeight: 600 }}>{fmtPct(stats.changePct)}</div>
          </div>
        )}
      </div>

      {/* AI hint banner */}
      {!hintDismissed && tab !== "ai" && (
        <div onClick={() => { setTab("ai"); setHintDismissed(true); }}
          style={{ background: C.cyan + "10", border: `1px solid ${C.cyan}33`, borderRadius: 10, padding: "9px 12px", marginBottom: 12, display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
          <span style={{ fontSize: 13 }}>💡</span>
          <span style={{ fontSize: 12, color: C.cyan, flex: 1 }}>Get AI analysis on this stock → AI tab</span>
          <button onClick={e => { e.stopPropagation(); setHintDismissed(true); }}
            style={{ background: "none", border: "none", color: C.faint, cursor: "pointer", fontSize: 14, padding: 0, lineHeight: 1 }}>×</button>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 16, background: C.bgSecondary, borderRadius: 12, padding: 4 }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{ flex: 1, padding: "7px 0", borderRadius: 9, border: "none", background: tab === t ? C.card : "transparent", color: tab === t ? C.text : C.faint, fontWeight: tab === t ? 700 : 400, fontSize: 12, cursor: "pointer", fontFamily: FONT, textTransform: "capitalize" }}>
            {t === "ai" ? "AI" : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW TAB ─────────────────────────────────────── */}
      {tab === "overview" && (
        <GlassCard>
          {loadingStats ? (
            <div style={{ color: C.faint, fontSize: 13, textAlign: "center", padding: "20px 0" }}>Loading stats...</div>
          ) : stats?.error ? (
            <div style={{ color: C.red, fontSize: 12 }}>Could not load stats</div>
          ) : (
            <>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 14 }}>Key Statistics</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {[
                  { label: "Price",        value: fmtPrice(stats?.price, meta.isCrypto) },
                  { label: "Change",       value: fmtPct(stats?.changePct), color: (stats?.changePct ?? 0) >= 0 ? C.green : C.red },
                  !meta.isCrypto && { label: "P/E Ratio",    value: stats?.pe != null ? Number(stats.pe).toFixed(1) : "—" },
                  !meta.isCrypto && { label: "Market Cap",   value: stats?.marketCap != null ? "$" + (Number(stats.marketCap) > 1000 ? (Number(stats.marketCap)/1000).toFixed(1) + "T" : Number(stats.marketCap).toFixed(0) + "B") : "—" },
                  { label: "52w High",     value: fmtPrice(stats?.high52w, meta.isCrypto) },
                  { label: "52w Low",      value: fmtPrice(stats?.low52w, meta.isCrypto) },
                  !meta.isCrypto && { label: "Beta",         value: stats?.beta != null ? Number(stats.beta).toFixed(2) : "—" },
                  !meta.isCrypto && { label: "Div. Yield",   value: stats?.dividendYield != null ? Number(stats.dividendYield).toFixed(2) + "%" : "—" },
                ].filter(Boolean).map((s) => (
                  <div key={s.label} style={{ background: C.bgSecondary, borderRadius: 10, padding: "10px 12px" }}>
                    <div style={{ fontSize: 10, color: C.faint, fontWeight: 500, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>{s.label}</div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: s.color ?? C.text }}>{s.value}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </GlassCard>
      )}

      {/* ── CHART TAB ────────────────────────────────────────── */}
      {tab === "chart" && (
        <GlassCard>
          <div style={{ display: "flex", gap: 4, marginBottom: 14 }}>
            {PERIODS.map(p => (
              <button key={p} onClick={() => setPeriod(p)}
                style={{ flex: 1, padding: "5px 0", borderRadius: 8, border: `1px solid ${period === p ? meta.color + "66" : C.border}`, background: period === p ? meta.color + "18" : "transparent", color: period === p ? meta.color : C.faint, fontWeight: period === p ? 700 : 400, fontSize: 12, cursor: "pointer", fontFamily: FONT }}>
                {p}
              </button>
            ))}
          </div>
          {loadingChart ? (
            <div style={{ height: 130, display: "flex", alignItems: "center", justifyContent: "center", color: C.faint, fontSize: 12 }}>Loading chart...</div>
          ) : chartError ? (
            <div style={{ background: C.red + "12", border: `1px solid ${C.red}33`, borderRadius: 10, padding: "12px 14px", margin: "4px 0" }}>
              <div style={{ fontSize: 13, color: C.red, fontWeight: 600, marginBottom: 4 }}>Chart unavailable</div>
              <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.5 }}>
                {chartError}
              </div>
            </div>
          ) : (
            <>
              <PriceChart candles={candles} color={meta.color} height={140} />
              {candles.length > 0 ? (
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
                  <span style={{ fontSize: 11, color: C.faint }}>
                    {new Date(candles[0].t * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </span>
                  <span style={{ fontSize: 11, color: C.faint }}>
                    {new Date(candles[candles.length - 1].t * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </span>
                </div>
              ) : (
                <div style={{ fontSize: 12, color: C.faint, textAlign: "center", marginTop: 8 }}>
                  No data for {period} — {meta.isCrypto ? "try 1W or 1M" : "intraday (1D) requires Finnhub premium; try 1W, 1M or 1Y"}
                </div>
              )}
              <div style={{ fontSize: 10, color: C.faint, textAlign: "right", marginTop: 6 }}>Powered by Finnhub</div>
            </>
          )}
        </GlassCard>
      )}

      {/* ── AI TAB ───────────────────────────────────────────── */}
      {tab === "ai" && (
        <GlassCard style={{ border: `1px solid ${C.cyan}22` }}>
          <style>{`@keyframes aiDot{0%,80%,100%{transform:translateY(0);opacity:0.4}40%{transform:translateY(-5px);opacity:1}}`}</style>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
            <div style={{ width: 30, height: 30, borderRadius: 8, background: C.cyan + "18", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Icon name="activity" size={14} color={C.cyan} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>AI Analysis</div>
              <div style={{ fontSize: 11, color: C.faint }}>Powered by Claude</div>
            </div>
            {aiError && !aiLoading && (
              <button onClick={() => { aiCalledRef.current = false; setAi(null); setAiError(null); runAiAnalysis(); }}
                style={{ background: C.bgSecondary, border: `1px solid ${C.border}`, borderRadius: 8, padding: "4px 10px", color: C.muted, fontSize: 12, cursor: "pointer", fontFamily: FONT }}>
                Retry
              </button>
            )}
          </div>

          {aiLoading ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: "28px 0" }}>
              <div style={{ display: "flex", gap: 6 }}>
                {[0,1,2].map(i => (
                  <span key={i} style={{ width: 8, height: 8, borderRadius: "50%", background: C.cyan, display: "inline-block", animation: `aiDot 1.2s ease-in-out ${i*0.2}s infinite` }} />
                ))}
              </div>
              <div style={{ fontSize: 13, color: C.muted }}>Analyzing {symbol}...</div>
            </div>
          ) : aiError ? (
            <div style={{ background: C.red + "12", border: `1px solid ${C.red}33`, borderRadius: 10, padding: "12px 14px" }}>
              <div style={{ fontSize: 13, color: C.red, fontWeight: 600, marginBottom: 4 }}>Analysis unavailable</div>
              <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.5 }}>
                {aiError.includes("ANTHROPIC_API_KEY")
                  ? "ANTHROPIC_API_KEY is not configured in Supabase secrets. Run: supabase secrets set ANTHROPIC_API_KEY=your_key"
                  : aiError}
              </div>
            </div>
          ) : ai ? (
            <>
              {ai.trend ? (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 11, color: C.cyan, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>Trend Analysis</div>
                  <div style={{ fontSize: 13, color: C.text, lineHeight: 1.6 }}>{ai.trend}</div>
                </div>
              ) : null}
              {Array.isArray(ai.risks) && ai.risks.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 11, color: C.yellow, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Key Risks</div>
                  {ai.risks.map((r, i) => (
                    <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6 }}>
                      <div style={{ width: 5, height: 5, borderRadius: "50%", background: C.yellow, marginTop: 5, flexShrink: 0 }} />
                      <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.5 }}>{String(r)}</div>
                    </div>
                  ))}
                </div>
              )}
              {ai.analystView ? (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 11, color: C.purple, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>Market Observers Note</div>
                  <div style={{ fontSize: 13, color: C.text, lineHeight: 1.6 }}>{ai.analystView}</div>
                </div>
              ) : null}
              {ai.disclaimer ? (
                <div style={{ background: C.bgSecondary, borderRadius: 10, padding: "10px 12px", border: `1px solid ${C.border}` }}>
                  <div style={{ fontSize: 11, color: C.faint, lineHeight: 1.6 }}>{ai.disclaimer}</div>
                </div>
              ) : null}
            </>
          ) : (
            /* Blank state — should rarely be seen, but never show an empty card */
            <div style={{ textAlign: "center", padding: "24px 0", color: C.faint, fontSize: 13 }}>
              Tap Retry to load analysis
              <div style={{ marginTop: 12 }}>
                <button onClick={() => { aiCalledRef.current = false; runAiAnalysis(); }}
                  style={{ background: C.cyan + "18", border: `1px solid ${C.cyan}44`, borderRadius: 10, padding: "8px 20px", color: C.cyan, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: FONT }}>
                  Analyze {symbol}
                </button>
              </div>
            </div>
          )}
        </GlassCard>
      )}

      {/* ── BUY TAB ──────────────────────────────────────────── */}
      {tab === "buy" && (
        <>
          {/* ── Alpaca not connected: show connect prompt ──────── */}
          {!alpacaConnected ? (
            <GlassCard style={{ marginBottom: 12, textAlign: "center", padding: "28px 20px" }}>
              <div style={{ width: 52, height: 52, borderRadius: 16, background: C.cyan + "18", border: `1px solid ${C.cyan}33`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}>
                <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={C.cyan} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" /><polyline points="16 7 22 7 22 13" />
                </svg>
              </div>
              <div style={{ fontSize: 17, fontWeight: 700, color: C.text, marginBottom: 6 }}>Connect Your Alpaca Account</div>
              <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.6, marginBottom: 20 }}>
                Link your free Alpaca brokerage account to buy stocks and ETFs directly from Arkonomy.
              </div>
              <div style={{ background: "rgba(245,200,66,0.07)", border: "1px solid rgba(245,200,66,0.35)", borderRadius: 12, padding: "14px 16px", marginBottom: 16, textAlign: "left" }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#F5C842", marginBottom: 8, letterSpacing: 0.3 }}>Authorize Arkonomy</div>
                <div style={{ fontSize: 12, color: "#C8B86A", lineHeight: 1.65 }}>
                  By allowing Arkonomy to access your Alpaca account, you are granting Arkonomy access to your account information and authorization to place transactions at your direction.
                </div>
                <div style={{ fontSize: 12, color: "#C8B86A", lineHeight: 1.65, marginTop: 8 }}>
                  Alpaca does not warrant or guarantee that Arkonomy will work as advertised or expected. Before authorizing, learn more about Arkonomy at{" "}
                  <a href="https://arkonomy.com" target="_blank" rel="noopener noreferrer" style={{ color: "#F5C842", textDecoration: "underline" }}>arkonomy.com</a>.
                </div>
              </div>
              <button
                onClick={onConnectAlpaca}
                style={{ width: "100%", padding: "14px 0", background: `linear-gradient(90deg,${C.cyan},${C.blue})`, border: "none", borderRadius: 12, color: "#000", fontWeight: 700, fontSize: 15, cursor: "pointer", fontFamily: FONT, marginBottom: 10 }}
              >
                Connect Alpaca Account
              </button>
              <div style={{ fontSize: 11, color: C.faint, lineHeight: 1.6 }}>
                Free to open · No minimums · Powered by Alpaca Securities
              </div>
            </GlassCard>
          ) : (
          <GlassCard style={{ marginBottom: 12 }}>
            <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 16 }}>Buy {meta.label || symbol}</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 18 }}>
              <div style={{ background: C.bgSecondary, borderRadius: 10, padding: "10px 12px" }}>
                <div style={{ fontSize: 10, color: C.faint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>Current Price</div>
                <div style={{ fontSize: 15, fontWeight: 700 }}>{fmtPrice(stats?.price, meta.isCrypto)}</div>
              </div>
              <div style={{ background: C.bgSecondary, borderRadius: 10, padding: "10px 12px" }}>
                <div style={{ fontSize: 10, color: C.faint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>Est. Shares</div>
                <div style={{ fontSize: 15, fontWeight: 700 }}>
                  {stats?.price && buyAmt ? (Number(buyAmt) / stats.price).toFixed(4) : "—"}
                </div>
              </div>
            </div>

            <div style={{ color: C.muted, fontSize: 12, fontWeight: 500, marginBottom: 6 }}>Amount (USD)</div>
            <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
              <input
                type="number" value={buyAmt}
                onChange={e => setBuyAmt(e.target.value)}
                style={{ flex: 1, padding: "13px 14px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 12, color: C.text, fontSize: 16, outline: "none", fontFamily: FONT }}
                placeholder="100"
              />
            </div>
            {["25","50","100","250"].map(amt => (
              <button key={amt} onClick={() => setBuyAmt(amt)}
                style={{ marginRight: 8, marginBottom: 14, padding: "5px 12px", background: buyAmt === amt ? meta.color + "22" : C.bgSecondary, border: `1px solid ${buyAmt === amt ? meta.color + "55" : C.border}`, borderRadius: 99, color: buyAmt === amt ? meta.color : C.muted, fontSize: 12, fontWeight: buyAmt === amt ? 700 : 400, cursor: "pointer", fontFamily: FONT }}>
                ${amt}
              </button>
            ))}

            <button onClick={handleBuy} disabled={buying || !buyAmt || Number(buyAmt) < 1}
              style={{ width: "100%", padding: 15, background: buying ? C.bgTertiary : `linear-gradient(90deg,${meta.color},${meta.color}BB)`, border: "none", borderRadius: 13, color: buying ? C.faint : "#fff", fontWeight: 700, fontSize: 15, cursor: buying ? "not-allowed" : "pointer", fontFamily: FONT }}>
              {buying ? "Placing order..." : `Buy $${buyAmt || "—"} of ${symbol}`}
            </button>

            {buyResult && (
              (buyResult.notConnected || buyResult.noFunds) ? (
                <div style={{ marginTop: 14, padding: "18px 16px", background: C.bgSecondary, border: `1px solid ${C.border}`, borderRadius: 14, textAlign: "center" }}>
                  <div style={{ width: 40, height: 40, borderRadius: 12, background: C.cyan + "18", border: `1px solid ${C.cyan}33`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 10px" }}>
                    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={C.cyan} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" /><polyline points="16 7 22 7 22 13" />
                    </svg>
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 4 }}>
                    Connect Alpaca to invest
                  </div>
                  <div style={{ fontSize: 13, color: C.muted, marginBottom: 14, lineHeight: 1.5 }}>
                    Create a free Alpaca account to start investing
                  </div>
                  <a
                    href="https://app.alpaca.markets"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ display: "inline-block", padding: "11px 28px", background: `linear-gradient(90deg,${C.cyan},${C.blue})`, borderRadius: 10, color: "#000", fontWeight: 700, fontSize: 14, textDecoration: "none", fontFamily: FONT }}
                  >
                    Open Alpaca
                  </a>
                  <div style={{ fontSize: 11, color: C.faint, marginTop: 10 }}>
                    After creating your account, return here to invest
                  </div>
                </div>
              ) : (
                <div style={{ marginTop: 12, padding: "10px 14px", background: buyResult.success ? C.green + "12" : C.red + "12", border: `1px solid ${buyResult.success ? C.green : C.red}33`, borderRadius: 10 }}>
                  <div style={{ fontSize: 13, color: buyResult.success ? C.green : C.red, fontWeight: 600 }}>
                    {buyResult.success ? "✓ " + buyResult.message : "✗ " + buyResult.error}
                  </div>
                </div>
              )
            )}
          </GlassCard>
          )}

          {alpacaConnected && (
          <div style={{ padding: "0 2px" }}>
            <div style={{ fontSize: 10, color: C.faint, lineHeight: 1.7 }}>
              Investment accounts through Alpaca Securities LLC, a registered broker-dealer, member FINRA/SIPC.
              Arkonomy is not a broker-dealer and does not provide investment advice.
              Past performance does not guarantee future results. Market orders execute at prevailing prices.
              You are making the final investment decision.
            </div>
          </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Markets Screen ────────────────────────────────────────────
function Markets({ profile, user, onSaveProfile, initialSymbol, onClearInit, alpacaConnected, onConnectAlpaca }) {
  const defaultWatchlist = profile?.watchlist ?? DEFAULT_WATCHLIST;

  const [watchlist, setWatchlist]       = useState(defaultWatchlist);
  const [editMode, setEditMode]         = useState(false);
  const [addQuery, setAddQuery]         = useState("");
  const [addResults, setAddResults]     = useState([]);
  const [searchingAdd, setSearchingAdd] = useState(false);
  const [quotes, setQuotes]             = useState({});
  const [loadingQuotes, setLoadingQuotes] = useState(true);
  const [selectedSymbol, setSelectedSymbol] = useState(initialSymbol ?? null);
  const [exploreQuery, setExploreQuery] = useState("");
  const [exploreResults, setExploreResults] = useState([]);
  const [searchingExplore, setSearchingExplore] = useState(false);
  const [dragging, setDragging]         = useState(null);
  const [dragList, setDragList]         = useState(watchlist);
  const dragRef = useRef(watchlist);
  const [extraQuotes, setExtraQuotes]   = useState({});
  const [loadingExtra, setLoadingExtra] = useState(true);
  const [activeSector, setActiveSector] = useState(null);
  const [loadingSectorStocks, setLoadingSectorStocks] = useState(false);

  // When parent passes an initialSymbol (e.g. from dashboard card tap), open it
  useEffect(() => {
    if (initialSymbol) { setSelectedSymbol(initialSymbol); onClearInit?.(); }
  }, [initialSymbol]);

  // Fetch trending + sector-ETF quotes on mount
  useEffect(() => {
    const syms = [...new Set([...TRENDING.map(t => t.symbol), ...SECTORS.map(s => s.etf)])];
    Promise.allSettled(syms.map(s => callMarketData({ type: "quote", symbol: s }))).then(results => {
      const map = {};
      syms.forEach((s, i) => { if (results[i].status === "fulfilled") map[s] = results[i].value; });
      setExtraQuotes(map);
      setLoadingExtra(false);
    });
  }, []);

  async function toggleSector(sector) {
    if (activeSector?.name === sector.name) { setActiveSector(null); return; }
    setActiveSector(sector);
    const missing = sector.stocks.filter(s => !extraQuotes[s]);
    if (missing.length > 0) {
      setLoadingSectorStocks(true);
      const results = await Promise.allSettled(missing.map(s => callMarketData({ type: "quote", symbol: s })));
      setExtraQuotes(prev => {
        const next = { ...prev };
        missing.forEach((s, i) => { if (results[i].status === "fulfilled") next[s] = results[i].value; });
        return next;
      });
      setLoadingSectorStocks(false);
    }
  }

  // Load quotes for all watchlist items
  async function loadQuotes(list) {
    setLoadingQuotes(true);
    const results = await Promise.allSettled(list.map(s => callMarketData({ type: "quote", symbol: s })));
    const map = {};
    list.forEach((s, i) => {
      if (results[i].status === "fulfilled") map[s] = results[i].value;
    });
    setQuotes(map);
    setLoadingQuotes(false);
  }

  useEffect(() => { loadQuotes(watchlist); }, []);

  function saveWatchlist(list) {
    setWatchlist(list);
    dragRef.current = list;
    onSaveProfile({ watchlist: list });
  }

  function removeFromWatchlist(sym) {
    const next = watchlist.filter(s => s !== sym);
    saveWatchlist(next);
    setDragList(next);
  }

  // Drag-to-reorder (touch)
  function onDragStart(e, idx) {
    const y = e.touches ? e.touches[0].clientY : e.clientY;
    setDragging({ idx, startY: y, curY: y });
    setDragList([...watchlist]);
  }
  function onDragMove(e) {
    if (!dragging) return;
    const y = e.touches ? e.touches[0].clientY : e.clientY;
    setDragging(d => d ? { ...d, curY: y } : null);
    const delta = y - dragging.startY;
    const ITEM_H = 56;
    const moved = Math.round(delta / ITEM_H);
    if (moved === 0) return;
    const newIdx = Math.max(0, Math.min(dragRef.current.length - 1, dragging.idx + moved));
    if (newIdx !== dragging.idx) {
      const next = [...dragRef.current];
      const [item] = next.splice(dragging.idx, 1);
      next.splice(newIdx, 0, item);
      dragRef.current = next;
      setDragList([...next]);
      setDragging(d => d ? { ...d, idx: newIdx, startY: y } : null);
    }
  }
  function onDragEnd() {
    if (dragging) saveWatchlist(dragRef.current);
    setDragging(null);
  }

  // Add-to-watchlist search
  const addSearchTimer = useRef(null);
  function onAddQueryChange(q) {
    setAddQuery(q);
    clearTimeout(addSearchTimer.current);
    if (!q.trim()) { setAddResults([]); return; }
    addSearchTimer.current = setTimeout(async () => {
      setSearchingAdd(true);
      const d = await callMarketData({ type: "search", query: q });
      setAddResults(d.results ?? []);
      setSearchingAdd(false);
    }, 400);
  }

  // Explore search
  const exploreTimer = useRef(null);
  function onExploreChange(q) {
    setExploreQuery(q);
    clearTimeout(exploreTimer.current);
    if (!q.trim()) { setExploreResults([]); return; }
    exploreTimer.current = setTimeout(async () => {
      setSearchingExplore(true);
      const d = await callMarketData({ type: "search", query: q });
      setExploreResults(d.results ?? []);
      setSearchingExplore(false);
    }, 400);
  }

  function addToWatchlist(sym) {
    if (watchlist.includes(sym) || watchlist.length >= 12) return;
    const next = [...watchlist, sym];
    saveWatchlist(next);
    setDragList(next);
    loadQuotes(next);
    setAddQuery("");
    setAddResults([]);
  }

  if (selectedSymbol) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <StockDetail symbol={selectedSymbol} onBack={() => setSelectedSymbol(null)} user={user} alpacaConnected={alpacaConnected} onConnectAlpaca={onConnectAlpaca} />
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, paddingBottom: 80 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0, fontSize: 26, fontWeight: 700 }}>Markets</h2>
        <button onClick={() => { setEditMode(e => !e); setDragList([...watchlist]); }}
          style={{ padding: "6px 14px", background: editMode ? C.cyan + "22" : C.bgSecondary, border: `1px solid ${editMode ? C.cyan + "55" : C.border}`, borderRadius: 10, color: editMode ? C.cyan : C.muted, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: FONT }}>
          {editMode ? "Done" : "Edit"}
        </button>
      </div>

      {/* ── WATCHLIST ──────────────────────────────────────── */}
      <GlassCard style={{ padding: "14px 16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>Watchlist</span>
          <span style={{ fontSize: 11, color: C.faint }}>{watchlist.length}/12</span>
        </div>

        {/* Edit mode: draggable list */}
        {editMode ? (
          <>
            <div
              onMouseMove={onDragMove} onMouseUp={onDragEnd}
              onTouchMove={onDragMove} onTouchEnd={onDragEnd}
              style={{ touchAction: "none" }}
            >
              {dragList.map((sym, idx) => {
                const meta = MARKET_META[sym] ?? { label: sym, color: C.cyan, icon: "activity" };
                return (
                  <div key={sym}
                    style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: idx < dragList.length - 1 ? `1px solid ${C.sep}` : "none", userSelect: "none", opacity: dragging?.idx === idx ? 0.5 : 1 }}>
                    <div
                      onMouseDown={e => onDragStart(e, idx)}
                      onTouchStart={e => onDragStart(e, idx)}
                      style={{ cursor: "grab", padding: "4px 6px", color: C.faint, fontSize: 14 }}>⋮⋮</div>
                    <div style={{ width: 32, height: 32, borderRadius: 9, background: meta.color + "22", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <Icon name={meta.icon} size={13} color={meta.color} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{meta.label || sym}</div>
                      <div style={{ fontSize: 11, color: C.faint }}>{sym}</div>
                    </div>
                    <button onClick={() => removeFromWatchlist(sym)}
                      style={{ background: C.red + "18", border: `1px solid ${C.red}33`, borderRadius: 8, width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                      <Icon name="x" size={12} color={C.red} />
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Add new */}
            {watchlist.length < 12 && (
              <div style={{ marginTop: 14 }}>
                <div style={{ position: "relative" }}>
                  <Icon name="search" size={14} color={C.faint} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }} />
                  <input
                    value={addQuery}
                    onChange={e => onAddQueryChange(e.target.value)}
                    placeholder="Search ticker or company name..."
                    style={{ width: "100%", padding: "10px 12px 10px 34px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, color: C.text, fontSize: 13, outline: "none", boxSizing: "border-box", fontFamily: FONT }}
                  />
                </div>
                {searchingAdd && <div style={{ color: C.faint, fontSize: 12, marginTop: 8 }}>Searching...</div>}
                {addResults.map(r => (
                  <div key={r.symbol} onClick={() => addToWatchlist(r.symbol)}
                    style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: `1px solid ${C.sep}`, cursor: "pointer" }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{r.symbol}</div>
                      <div style={{ fontSize: 11, color: C.faint }}>{r.description}</div>
                    </div>
                    <div style={{ background: C.green + "18", border: `1px solid ${C.green}33`, borderRadius: 8, padding: "3px 10px", fontSize: 12, color: C.green, fontWeight: 600 }}>
                      {watchlist.includes(r.symbol) ? "Added" : "+ Add"}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          /* Normal mode: 2-col grid */
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {watchlist.map(sym => {
              const meta = MARKET_META[sym] ?? { label: sym, color: C.cyan, icon: "activity", isCrypto: false };
              const q    = quotes[sym];
              const pos  = (q?.changePct ?? 0) >= 0;
              return (
                <div key={sym} onClick={() => setSelectedSymbol(sym)}
                  style={{ background: C.bgTertiary, borderRadius: 12, padding: "10px 12px", border: `1px solid ${C.border}`, cursor: "pointer" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                    <div style={{ width: 24, height: 24, borderRadius: 7, background: meta.color + "22", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <Icon name={meta.icon} size={11} color={meta.color} strokeWidth={2.5} />
                    </div>
                    <span style={{ fontSize: 11, color: C.muted, fontWeight: 500 }}>{meta.label || sym}</span>
                  </div>
                  {loadingQuotes ? (
                    <div style={{ height: 20, background: C.border, borderRadius: 4, width: "70%", marginBottom: 4 }} />
                  ) : (
                    <>
                      <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: -0.3 }}>
                        {fmtPrice(q?.price, meta.isCrypto)}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 3 }}>
                        <Icon name={pos ? "trending-up" : "trending-down"} size={10} color={pos ? C.green : C.red} strokeWidth={2.5} />
                        <span style={{ fontSize: 11, color: pos ? C.green : C.red, fontWeight: 600 }}>
                          {fmtPct(q?.changePct)}
                        </span>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </GlassCard>

      {/* ── EXPLORE ────────────────────────────────────────── */}
      <GlassCard>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12 }}>Explore Stocks</div>
        <div style={{ position: "relative", marginBottom: 12 }}>
          <div style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}>
            <Icon name="search" size={14} color={C.faint} />
          </div>
          <input
            value={exploreQuery}
            onChange={e => onExploreChange(e.target.value)}
            placeholder="Search any stock, ETF or crypto..."
            style={{ width: "100%", padding: "11px 12px 11px 34px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 12, color: C.text, fontSize: 14, outline: "none", boxSizing: "border-box", fontFamily: FONT }}
          />
        </div>
        {searchingExplore && <div style={{ color: C.faint, fontSize: 12, textAlign: "center", padding: "8px 0" }}>Searching...</div>}
        {exploreResults.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {exploreResults.map((r, i) => (
              <div key={r.symbol} onClick={() => setSelectedSymbol(r.symbol)}
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: i < exploreResults.length - 1 ? `1px solid ${C.sep}` : "none", cursor: "pointer" }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{r.symbol}</div>
                  <div style={{ fontSize: 12, color: C.faint, marginTop: 1 }}>{r.description}</div>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 11, color: C.faint, background: C.bgSecondary, borderRadius: 6, padding: "2px 7px" }}>{r.type}</span>
                  <Icon name="chevron" size={14} color={C.faint} />
                </div>
              </div>
            ))}
          </div>
        ) : !exploreQuery && (
          <>
            {/* ── Trending Today ──────────────────────────────── */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.faint, letterSpacing: 1, textTransform: "uppercase", marginBottom: 10 }}>Trending Today</div>
              {TRENDING.map((t, i) => {
                const q = extraQuotes[t.symbol];
                const pos = (q?.changePct ?? 0) >= 0;
                return (
                  <div key={t.symbol} onClick={() => setSelectedSymbol(t.symbol)}
                    style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 6px", borderBottom: i < TRENDING.length - 1 ? `1px solid ${C.sep}` : "none", cursor: "pointer" }}>
                    <div style={{ width: 36, height: 36, borderRadius: 10, background: t.color + "1A", border: `1px solid ${t.color}30`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <span style={{ fontSize: 10, fontWeight: 800, color: t.color, letterSpacing: -0.3 }}>{t.symbol.slice(0, 2)}</span>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.name}</div>
                      <div style={{ fontSize: 11, color: C.faint }}>{t.symbol}</div>
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      {loadingExtra
                        ? <div style={{ width: 48, height: 12, background: C.border, borderRadius: 4 }} />
                        : <>
                            <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{fmtPrice(q?.price)}</div>
                            <div style={{ fontSize: 11, fontWeight: 600, color: pos ? C.green : C.red }}>{fmtPct(q?.changePct)}</div>
                          </>
                      }
                    </div>
                  </div>
                );
              })}
            </div>

            {/* ── Sectors ──────────────────────────────────────── */}
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.faint, letterSpacing: 1, textTransform: "uppercase", marginBottom: 10 }}>Sectors</div>
              <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 6, scrollbarWidth: "none", msOverflowStyle: "none" }}>
                {SECTORS.map(sector => {
                  const q = extraQuotes[sector.etf];
                  const pct = q?.changePct ?? null;
                  const pos = (pct ?? 0) >= 0;
                  const active = activeSector?.name === sector.name;
                  return (
                    <button key={sector.name} onClick={() => toggleSector(sector)} style={{
                      flexShrink: 0, minWidth: 80, padding: "8px 12px", borderRadius: 12, textAlign: "left",
                      background: active ? sector.color + "18" : C.bgTertiary,
                      border: `1px solid ${active ? sector.color + "55" : C.border}`,
                      cursor: "pointer", fontFamily: FONT,
                    }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: active ? sector.color : C.text, marginBottom: 3 }}>{sector.name}</div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: loadingExtra ? C.faint : pos ? C.green : C.red }}>
                        {loadingExtra ? "—" : fmtPct(pct)}
                      </div>
                    </button>
                  );
                })}
              </div>

              {activeSector && (
                <div style={{ marginTop: 10, borderRadius: 12, border: `1px solid ${C.border}`, overflow: "hidden" }}>
                  {loadingSectorStocks
                    ? <div style={{ padding: "12px 14px", color: C.faint, fontSize: 12 }}>Loading...</div>
                    : activeSector.stocks.map((sym, i) => {
                        const q = extraQuotes[sym];
                        const pos = (q?.changePct ?? 0) >= 0;
                        return (
                          <div key={sym} onClick={() => setSelectedSymbol(sym)}
                            style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", cursor: "pointer", borderTop: i > 0 ? `1px solid ${C.sep}` : "none", background: C.bgTertiary }}>
                            <div style={{ width: 28, height: 28, borderRadius: 8, background: activeSector.color + "18", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                              <span style={{ fontSize: 9, fontWeight: 800, color: activeSector.color }}>{sym.slice(0, 2)}</span>
                            </div>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{sym}</div>
                            </div>
                            <div style={{ textAlign: "right" }}>
                              <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{fmtPrice(q?.price)}</div>
                              <div style={{ fontSize: 11, fontWeight: 600, color: pos ? C.green : C.red }}>{fmtPct(q?.changePct)}</div>
                            </div>
                            <Icon name="chevron" size={12} color={C.faint} />
                          </div>
                        );
                      })
                  }
                </div>
              )}
            </div>
          </>
        )}
      </GlassCard>

      {/* Legal disclaimer */}
      <div style={{ padding: "4px 2px" }}>
        <div style={{ fontSize: 10, color: C.faint, lineHeight: 1.7 }}>
          Investment accounts through Alpaca Securities LLC, a registered broker-dealer, member FINRA/SIPC.
          Arkonomy is not a broker-dealer and does not provide investment advice.
          Past performance does not guarantee future results.
        </div>
      </div>
    </div>
  );
}

// ─── Bottom Nav ───────────────────────────────────────────────
function BottomNav({ screen, setScreen, insightCount = 1 }) {
  const tabs = [
    { id: "dashboard",    label: "Home",     icon: "home"      },
    { id: "transactions", label: "Txns",     icon: "credit"    },
    { id: "markets",      label: "Markets",  icon: "bar-chart" },
    { id: "savings",      label: "Savings",  icon: "target"    },
    { id: "insights",     label: "Insights", icon: "activity"  },
  ];
  return (
    <div className="cap-bottom-nav" style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 430, background: "rgba(11,20,38,0.97)", backdropFilter: "blur(24px)", borderTop: `1px solid ${C.sep}`, display: "flex", padding: "10px 0 20px", zIndex: 50 }}>
      {tabs.map(tab => {
        const active = screen === tab.id;
        return (
          <button key={tab.id} data-tutorial={`nav-${tab.id}`} onClick={() => setScreen(tab.id)} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, background: "none", border: "none", cursor: "pointer", padding: "4px 0", position: "relative" }}>
            <Icon name={tab.icon} size={22} color={active ? C.blue : C.faint} strokeWidth={active ? 2.2 : 1.8} />
            <span style={{ fontSize: 10, color: active ? C.blue : C.faint, fontWeight: active ? 700 : 400, fontFamily: FONT }}>{tab.label}</span>
            {active && <div style={{ width: 4, height: 4, borderRadius: 99, background: C.blue, boxShadow: `0 0 6px ${C.blue}` }} />}
          </button>
        );
      })}
    </div>
  );
}
