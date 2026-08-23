// src/components/FinancialDiagnosis.jsx
// Phase 1 frontend flow for the Financial Diagnosis feature (see
// docs/financial-diagnosis-prompt.md). Entry point is a secondary link
// under Dashboard's TodaysLessonRow; this component owns the analysis
// animation + result screen, reached via App.jsx's screen === "financial-diagnosis".
//
// Color convention (per CLAUDE.md): gold = coach speaking/identity, ruby =
// action required, emerald = positive. Headline/explanation text never uses
// ruby (that's reserved for the one action button per problem card, per the
// spec's own instruction) — gold and ruby never share a UI signal.

import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { usePostHog } from "@posthog/react";
import { C, FONT, RADIUS, DASHBOARD_C as DC } from "../utils/colors";
import { callEdgeFunction } from "../lib/callEdgeFunction";
import { getCardQuestion } from "../utils/cardQuestions";
import { supabase } from "../utils/supabase";
import GlassCard from "./shared/GlassCard";
import Icon from "./shared/Icon";

// Artificial minimum per status line so the "coach working" steps are
// visible even when the edge function responds fast — spec: ~1.2-1.5s/line.
const STEP_INTERVAL_MS = 1400;

// Matches the weekly re-check cadence used for the cost estimate
// (2026-08-23) — an existing active diagnosis younger than this is shown
// straight away, no re-analysis animation, no fresh Claude call.
const RECENT_MS = 7 * 24 * 60 * 60 * 1000;

// One icon per taxonomy key, purely decorative on the problem card — not
// used for anything else, so an unrecognized/adapted key still renders fine
// via Icon's own "dollar" fallback.
const ISSUE_ICONS = {
  high_apr_debt: "credit",
  no_emergency_fund: "shield",
  subscription_leak: "repeat",
  overspending: "dollar",
  lifestyle_inflation: "trending-up",
  unstable_income_no_buffer: "bar-chart",
  no_goal: "target",
};

export default function FinancialDiagnosis({ onBack, onNavigate, onOpenChatWithMessage, onRequestAddGoal, lang }) {
  const { t } = useTranslation();
  const posthog = usePostHog();
  const [phase, setPhase] = useState("analyzing"); // analyzing | insufficient | result | error
  const [stepIndex, setStepIndex] = useState(0);
  const [result, setResult] = useState(null);
  const startedRef = useRef(false);
  // Holds whichever run (initial mount, or a "Re-check my finances" tap) is
  // currently in flight, so a single unmount effect can cancel either one —
  // runFreshAnalysis() can now fire from two different call sites.
  const activeRunCleanupRef = useRef(null);

  const STEPS = [
    t("diagnosis.step_debt"),
    t("diagnosis.step_subscriptions"),
    t("diagnosis.step_income_spending"),
  ];

  // Runs the actual analyzing-animation + financial-diagnosis call. Only
  // ever called when we've already decided a fresh diagnosis is needed —
  // callers (the mount effect, and the "Re-check my finances" button) do
  // that decision themselves.
  function runFreshAnalysis() {
    posthog?.capture("diagnosis_started");
    setResult(null);
    setStepIndex(0);
    setPhase("analyzing");

    let cancelled = false;
    let i = 0;
    const stepTimer = setInterval(() => {
      i++;
      if (i < STEPS.length) setStepIndex(i);
    }, STEP_INTERVAL_MS);
    const minDelay = new Promise(res => setTimeout(res, STEP_INTERVAL_MS * STEPS.length));

    Promise.all([callEdgeFunction("financial-diagnosis", { lang }), minDelay])
      .then(([data]) => {
        if (cancelled) return;
        clearInterval(stepTimer);
        if (data?.status === "insufficient_data") {
          setPhase("insufficient");
        } else if (data?.status === "diagnosed") {
          setResult(data);
          setPhase("result");
          posthog?.capture("diagnosis_completed", { healthy: !!data.healthy, issue_count: data.primary_issues?.length ?? 0 });
        } else {
          throw new Error(data?.error || "Unexpected response");
        }
      })
      .catch(() => {
        if (cancelled) return;
        clearInterval(stepTimer);
        setPhase("error");
      });

    activeRunCleanupRef.current = () => { cancelled = true; clearInterval(stepTimer); };
  }

  useEffect(() => {
    // Guard against double-fire in dev/StrictMode double-invoke — a fresh
    // run is rate-limited and writes a DB row, not idempotent-safe to fire
    // twice.
    if (startedRef.current) return;
    startedRef.current = true;

    let cancelled = false;

    // Re-run bug fix (2026-08-24): tapping the entry point used to always
    // re-run the full analysis, even with a perfectly good recent diagnosis
    // already on file. Check for one first — same RLS SELECT policy the
    // result screen itself relies on, no edge function round-trip, no
    // Claude call, no rate-limit spend — and show it immediately if it's
    // younger than RECENT_MS. Only fall through to a fresh run if there's
    // no active row, or it's stale, or (separately) the user explicitly
    // taps "Re-check my finances" on the result screen.
    supabase
      .from('diagnosis_profiles')
      .select('id, metrics, primary_issues, narrative, created_at')
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data: existing, error }) => {
        if (cancelled) return;
        const ageMs = existing ? Date.now() - new Date(existing.created_at).getTime() : Infinity;
        if (!error && existing && ageMs < RECENT_MS) {
          setResult({
            healthy: (existing.primary_issues || []).length === 0,
            primary_issues: existing.primary_issues,
            narrative: existing.narrative,
            metrics: existing.metrics,
            diagnosis_id: existing.id,
          });
          setPhase("result");
          posthog?.capture("diagnosis_viewed_cached", { age_days: Math.floor(ageMs / 86_400_000) });
          return;
        }
        runFreshAnalysis();
      });

    return () => { cancelled = true; activeRunCleanupRef.current?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Phase 2 navigation targets, per decision 2026-08-23:
  // - high_apr_debt: no dedicated credit-detail screen exists (see
  //   BACKLOG.md item 3, Level 4 — blocked on Plaid Liabilities) — reuses
  //   the existing long-press→AI-chat pattern from Dashboard's Credit Cards
  //   card instead of building a new screen.
  // - subscription_leak: navigates to the Subscriptions section on the
  //   Insights screen (already sorted by amount — computeRecurringSummary's
  //   own behavior, nothing extra needed here).
  // - no_emergency_fund / no_goal: navigates to Savings AND opens the
  //   "New goal" modal directly, not just the screen.
  function handleActionTap(issue) {
    posthog?.capture("diagnosis_action_tapped", { issue });
    if (issue === "high_apr_debt") {
      const worstCard = result?.metrics?.debts?.[0];
      const question = getCardQuestion("creditCards", { cardName: worstCard?.name, pct: result?.metrics?.worstUtilization }, t);
      if (question) onOpenChatWithMessage?.(question);
    } else if (issue === "subscription_leak") {
      onNavigate?.("insights");
    } else if (issue === "no_emergency_fund" || issue === "no_goal") {
      onRequestAddGoal?.();
    }
  }

  function Header() {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <button onClick={onBack} style={{ background: DC.card, border: `1px solid ${DC.faint}33`, borderRadius: RADIUS.sm, width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
          <Icon name="arrow-left" size={16} color={DC.text} />
        </button>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: DC.text, fontFamily: FONT }}>{t("diagnosis.title")}</h2>
      </div>
    );
  }

  return (
    <div style={{ padding: "16px 16px 32px", fontFamily: FONT }}>
      <Header />

      {phase === "analyzing" && (
        <GlassCard style={{ background: DC.card, border: `1px solid ${DC.gold}33`, textAlign: "center", padding: "40px 24px" }}>
          <div style={{ fontSize: 32, marginBottom: 16 }}>✨</div>
          <div className="ph-mask" style={{ fontSize: 15, fontWeight: 600, color: DC.gold, marginBottom: 6 }}>
            {STEPS[stepIndex]}
          </div>
          <div style={{ fontSize: 12, color: DC.faint }}>{t("diagnosis.analyzing_subtitle")}</div>
        </GlassCard>
      )}

      {phase === "insufficient" && (
        <GlassCard style={{ background: DC.card, border: `1px solid ${DC.faint}33`, textAlign: "center", padding: "32px 20px" }}>
          <Icon name="info" size={28} color={DC.faint} />
          <div style={{ fontSize: 16, fontWeight: 700, color: DC.text, marginTop: 12, marginBottom: 8 }}>{t("diagnosis.insufficient_title")}</div>
          <div style={{ fontSize: 13, color: DC.muted, lineHeight: 1.5 }}>{t("diagnosis.insufficient_body")}</div>
        </GlassCard>
      )}

      {phase === "error" && (
        <GlassCard style={{ background: DC.card, border: `1px solid ${DC.ruby}33`, textAlign: "center", padding: "32px 20px" }}>
          <Icon name="alert-circle" size={28} color={DC.ruby} />
          <div style={{ fontSize: 16, fontWeight: 700, color: DC.text, marginTop: 12, marginBottom: 8 }}>{t("diagnosis.error_title")}</div>
          <div style={{ fontSize: 13, color: DC.muted, lineHeight: 1.5, marginBottom: 16 }}>{t("diagnosis.error_body")}</div>
          <button onClick={onBack} style={{ background: DC.card, border: `1px solid ${DC.faint}33`, borderRadius: RADIUS.sm, padding: "10px 20px", color: DC.text, fontWeight: 600, fontSize: 13, cursor: "pointer", fontFamily: FONT }}>
            {t("diagnosis.retry_btn")}
          </button>
        </GlassCard>
      )}

      {phase === "result" && result && result.healthy && (
        <GlassCard style={{ background: DC.card, border: `1px solid ${DC.emerald}33` }}>
          <Icon name="check-circle" size={24} color={DC.emerald} />
          <div className="ph-mask" style={{ fontSize: 17, fontWeight: 700, color: DC.text, marginTop: 10, marginBottom: 8, lineHeight: 1.4 }}>
            {result.narrative?.headline}
          </div>
          <div className="ph-mask" style={{ fontSize: 13, color: DC.muted, lineHeight: 1.6 }}>
            {result.narrative?.encouragement}
          </div>
        </GlassCard>
      )}

      {phase === "result" && result && !result.healthy && (
        <>
          <div className="ph-mask" style={{ fontSize: 18, fontWeight: 700, color: DC.gold, lineHeight: 1.4, marginBottom: 16, padding: "0 4px" }}>
            {result.narrative?.headline}
          </div>
          {(result.narrative?.problems || []).map((p, i) => (
            <GlassCard key={i} style={{ background: DC.card, border: `1px solid ${DC.faint}33`, marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <Icon name={ISSUE_ICONS[p.issue] || "dollar"} size={16} color={DC.muted} />
                <div style={{ fontSize: 11, fontWeight: 700, color: DC.faint, letterSpacing: 0.5, textTransform: "uppercase" }}>
                  {t(`diagnosis.issue_${p.issue}`, { defaultValue: p.issue })}
                </div>
              </div>
              <div className="ph-mask" style={{ fontSize: 14, color: DC.text, lineHeight: 1.55, marginBottom: 14 }}>
                {p.explanation}
              </div>
              {p.action && (
                <button
                  onClick={() => handleActionTap(p.issue)}
                  className="ph-mask"
                  style={{ display: "block", width: "100%", boxSizing: "border-box", textAlign: "left", padding: "12px 14px", background: DC.ruby + "14", border: `1px solid ${DC.ruby}44`, borderRadius: RADIUS.sm, color: DC.ruby, fontWeight: 600, fontSize: 13, lineHeight: 1.4, cursor: "pointer", fontFamily: FONT }}
                >
                  {p.action}
                </button>
              )}
            </GlassCard>
          ))}
        </>
      )}

      {phase === "result" && result && (
        <button
          onClick={() => { posthog?.capture("diagnosis_recheck_tapped"); runFreshAnalysis(); }}
          style={{ display: "block", width: "100%", boxSizing: "border-box", textAlign: "center", padding: "12px 0", marginTop: 4, background: "none", border: `1px solid ${DC.faint}33`, borderRadius: RADIUS.sm, color: DC.muted, fontWeight: 600, fontSize: 13, cursor: "pointer", fontFamily: FONT }}
        >
          {t("diagnosis.recheck_btn")}
        </button>
      )}
    </div>
  );
}
