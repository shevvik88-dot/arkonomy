import { useState, useEffect, useRef } from "react";
import { logger } from "../utils/logger";
import { useTranslation } from "react-i18next";
import { usePostHog } from "@posthog/react";
import { supabase } from "../utils/supabase";
import { C, FONT } from "../utils/colors";
import Icon from "./shared/Icon";
import PlaidLinkButton from "./shared/PlaidLinkButton";
import AppPreviewStep from "./AppPreviewStep";
import AhaMoment from "./AhaMoment";

export const TUTORIAL_STEPS = [
  { selector: '[data-tutorial="net-balance"]',      screen: "dashboard", title: "onboarding.tut_1_title", description: "onboarding.tut_1_desc" },
  { selector: '[data-tutorial="health-score"]',     screen: "dashboard", title: "onboarding.tut_2_title", description: "onboarding.tut_2_desc" },
  { selector: '[data-tutorial="ai-insight"]',       screen: "dashboard", title: "onboarding.tut_3_title", description: "onboarding.tut_3_desc" },
  { selector: '[data-tutorial="nav-transactions"]', screen: null,        title: "onboarding.tut_4_title", description: "onboarding.tut_4_desc" },
  { selector: '[data-tutorial="nav-markets"]',      screen: null,        title: "onboarding.tut_5_title", description: "onboarding.tut_5_desc" },
  { selector: '[data-tutorial="nav-savings"]',      screen: null,        title: "onboarding.tut_6_title", description: "onboarding.tut_6_desc" },
  { selector: '[data-tutorial="nav-insights"]',     screen: null,        title: "onboarding.tut_7_title", description: "onboarding.tut_7_desc" },
  { selector: '[data-tutorial="ask-coach"]',        screen: null,        title: "onboarding.tut_8_title", description: "onboarding.tut_8_desc" },
];

export const MINI_TOURS = {
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
    { selector: '[data-tutorial="nav-savings"]',  screen: "dashboard", title: "Step 2: Connect Investment Account", description: "In Savings, connect your investment account to enable automatic investing of your monthly round-ups" },
    { selector: '[data-tutorial="ask-coach"]',    screen: "dashboard", title: "Step 3: Ask AI for picks",         description: "Ask your AI advisor which assets fit your goals and risk profile before investing" },
  ],
  "budget": [
    { selector: '[data-tutorial="health-score"]', screen: "dashboard", title: "Budget drives your score",         description: "Your health score is calculated against your monthly budget — the tighter you stick to it, the higher it goes" },
    { selector: '[data-tutorial="settings-btn"]', screen: "dashboard", title: "Change your budget anytime",       description: "Tap the gear icon, scroll to 'Monthly Budget', and update the amount — changes take effect immediately" },
  ],
};

export function TutorialOverlay({ stepIdx, totalSteps, steps, onNext, onSkip }) {
  const { t } = useTranslation();
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
      <div style={{ ...panelBase, top: 0, left: 0, right: 0, height: hT }} onClick={onSkip} />
      <div style={{ ...panelBase, top: hB, left: 0, right: 0, bottom: 0 }} onClick={onSkip} />
      <div style={{ ...panelBase, top: hT, left: 0, width: hL, height: hH }} onClick={onSkip} />
      <div style={{ ...panelBase, top: hT, left: hR, right: 0, height: hH }} onClick={onSkip} />

      <div style={{
        position: "fixed", top: hT, left: hL, width: hW, height: hH,
        border: "2px solid #00C2FF", borderRadius: 14,
        boxShadow: "0 0 0 4px rgba(0,194,255,0.12), 0 0 28px rgba(0,194,255,0.35)",
        zIndex: 1001, pointerEvents: "none",
      }} />

      <div style={{
        position: "fixed", left: arrowX, top: arrowY,
        width: 0, height: 0, zIndex: 1002, pointerEvents: "none",
        borderLeft: "8px solid transparent", borderRight: "8px solid transparent",
        ...(above ? { borderTop: "10px solid #111E33" } : { borderBottom: "10px solid #111E33" }),
      }} />

      <div style={{
        position: "fixed", top: tY, left: tX, width: tooltipW,
        background: "#111E33", border: "1px solid #1E2D4A",
        borderRadius: 16, padding: "16px",
        boxShadow: "0 8px 40px rgba(0,0,0,0.75)",
        zIndex: 1002, pointerEvents: "all",
        fontFamily: "'Inter',-apple-system,sans-serif",
      }}>
        <div style={{ fontSize: 10, color: C.faint, fontWeight: 700, letterSpacing: 1, marginBottom: 8 }}>
          {t("onboarding.step_of", { step: stepIdx + 1, total: totalSteps })}
        </div>
        <div style={{ fontSize: 15, fontWeight: 800, color: "#fff", marginBottom: 6, lineHeight: 1.3 }}>
          {t(config.title)}
        </div>
        <div style={{ fontSize: 12, color: "#9AA4B2", lineHeight: 1.6, marginBottom: 14 }}>
          {t(config.description)}
        </div>
        <div style={{ display: "flex", gap: 3, marginBottom: 14 }}>
          {Array.from({ length: totalSteps }).map((_, i) => (
            <div key={i} style={{ height: 3, flex: 1, borderRadius: 99, background: i <= stepIdx ? "#00C2FF" : "#1E2D4A", transition: "background 0.3s" }} />
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onSkip} style={{ padding: "7px 14px", minHeight: 44, borderRadius: 8, border: "1px solid #1E2D4A", background: "none", color: C.faint, fontSize: 12, fontWeight: 500, cursor: "pointer", fontFamily: "'Inter',-apple-system,sans-serif" }}>
            {t("onboarding.skip")}
          </button>
          <button onClick={onNext} style={{ padding: "7px 18px", minHeight: 44, borderRadius: 8, border: "none", background: "linear-gradient(135deg,#00C2FF,#2F80FF)", color: "#000", fontSize: 12, fontWeight: 800, cursor: "pointer", fontFamily: "'Inter',-apple-system,sans-serif" }}>
            {stepIdx === totalSteps - 1 ? t("onboarding.done_btn") : t("onboarding.next_btn")}
          </button>
        </div>
      </div>
    </div>
  );
}

export function HelpButton({ onRestart, onMiniTour }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const items = [
    { label: t("onboarding.help_restart"),      action: () => onRestart() },
    { label: t("onboarding.help_connect_bank"), action: () => onMiniTour("connect-bank"), divider: true },
    { label: t("onboarding.help_ai_insights"),  action: () => onMiniTour("ai-insights") },
    { label: t("onboarding.help_invest"),        action: () => onMiniTour("invest") },
    { label: t("onboarding.help_budget"),        action: () => onMiniTour("budget") },
  ];
  return (
    <div style={{ position: "relative" }}>
      {open && <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 148 }} />}
      {open && (
        <div style={{
          position: "absolute", top: 40, right: 0,
          background: "#111E33", border: "1px solid #1E2D4A",
          borderRadius: 14, padding: "6px 0", zIndex: 150,
          boxShadow: "0 8px 32px rgba(0,0,0,0.6)", minWidth: 220,
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
          width: 36, height: 36, borderRadius: "50%",
          background: open ? "#1E2D4A" : C.bgSecondary,
          border: `1px solid ${open ? C.cyan + "44" : C.border}`,
          color: open ? "#00C2FF" : "#9AA4B2",
          fontSize: 15, fontWeight: 800,
          cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          transition: "background 0.2s, color 0.2s",
          fontFamily: FONT,
        }}
      >
        ?
      </button>
    </div>
  );
}

export default function OnboardingFlow({ user, profile, linkToken, getLinkToken, onPlaidSuccess, onSaveProfile, trialCancelled, transactions = [], bankConnected }) {
  const { t } = useTranslation();
  const posthog = usePostHog();
  const [step, setStep] = useState(trialCancelled ? 6 : 1);
  const [budget, setBudget] = useState("3000");
  const [savingBudget, setSavingBudget] = useState(false);
  const [trialLoading, setTrialLoading] = useState(false);
  const [trialError, setTrialError] = useState("");
  const [showAha, setShowAha] = useState(false);
  const pendingFinalizeRef = useRef(null);
  const TOTAL_STEPS = 6;

  // A bank was connected during THIS onboarding pass — go through the
  // aha-moment interstitial before landing on Dashboard. "Skip for now"
  // on step 2 leaves bankConnected false, so this is a no-op for those users.
  function proceedToFinish(finalizeFn) {
    if (bankConnected) {
      pendingFinalizeRef.current = finalizeFn;
      setShowAha(true);
    } else {
      finalizeFn();
    }
  }

  async function startFreeTrial() {
    setTrialLoading(true);
    setTrialError("");
    try {
      const trialEnd = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const { error } = await supabase
        .from("profiles")
        .update({ trial_ends_at: trialEnd })
        .eq("id", user.id);
      if (error) {
        setTrialError("Could not start trial. Please try again.");
        setTrialLoading(false);
        return;
      }
      try { localStorage.setItem("arkonomy_onboarding_done", "1"); } catch {}
      posthog?.capture('onboarding_completed', { method: 'trial' });
      window.location.href = window.location.origin + "?trial_started=true";
    } catch (err) {
      logger.error("[startFreeTrial] failed:", err);
      setTrialError("Could not start trial. Please try again.");
      setTrialLoading(false);
    }
  }

  if (showAha) return <AhaMoment transactions={transactions} onDone={() => pendingFinalizeRef.current?.()} />;

  const displayName = profile?.full_name?.split(" ")[0]?.slice(0, 12) || user?.user_metadata?.full_name?.split(" ")[0]?.slice(0, 12) || "there";
  const name = displayName;

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
        {t("onboarding.welcome_title", { name })}
      </div>
      <div style={{ fontSize: 15, color: C.muted, lineHeight: 1.65, marginBottom: 40, maxWidth: 300, margin: "0 auto 40px" }}>
        {t("onboarding.welcome_body")}
      </div>
      <button
        onClick={() => setStep(2)}
        style={{ width: "100%", padding: 16, background: `linear-gradient(135deg, ${C.cyan}, ${C.blue})`, border: "none", borderRadius: 16, color: "#000", fontWeight: 800, fontSize: 16, cursor: "pointer", fontFamily: FONT, boxShadow: `0 4px 24px ${C.cyan}44` }}
      >
        {t("onboarding.get_started")}
      </button>
    </div>
  );

  if (step === 2) return wrap(
    <div>
      <div style={{ textAlign: "center", marginBottom: 32 }}>
        <div style={{
          width: 72, height: 72, borderRadius: 22, margin: "0 auto 20px",
          background: C.bankConnectBlue + "26", border: `1px solid ${C.bankConnectBlue}4D`,
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
        <div style={{ fontSize: 22, fontWeight: 800, color: C.text, marginBottom: 10 }}>{t("onboarding.connect_bank_title")}</div>
        <div style={{ fontSize: 14, color: C.muted, lineHeight: 1.65 }}>
          {t("onboarding.connect_bank_body")}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
        {[t("onboarding.feature_sync"), t("onboarding.feature_ai"), t("onboarding.feature_recurring")].map(f => (
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
          onSuccess={async (tok, meta) => { try { await onPlaidSuccess(tok, meta); setStep(3); } catch (err) { logger.error("[Plaid] onSuccess failed:", err); } }}
          onExit={() => {}}
          autoOpen={false}
        />
      ) : (
        <button
          className="pulse-connect-bank"
          onClick={getLinkToken}
          style={{ width: "100%", padding: 16, background: `linear-gradient(135deg,${C.bankConnectBlue},#2F80FF)`, border: "none", borderRadius: 16, color: "#fff", fontWeight: 800, fontSize: 16, cursor: "pointer", fontFamily: FONT, boxShadow: `0 4px 20px ${C.bankConnectBlue}66` }}
        >
          {t("onboarding.connect_bank_btn")}
        </button>
      )}

      <button
        onClick={() => setStep(3)}
        style={{ width: "100%", marginTop: 12, padding: "12px", background: "none", border: `1px solid ${C.border}`, borderRadius: 14, color: C.muted, fontWeight: 500, fontSize: 14, cursor: "pointer", fontFamily: FONT }}
      >
        {t("onboarding.skip_for_now")}
      </button>
    </div>
  );

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
        <div style={{ fontSize: 22, fontWeight: 800, color: C.text, marginBottom: 10 }}>{t("onboarding.set_budget_title")}</div>
        <div style={{ fontSize: 14, color: C.muted, lineHeight: 1.65 }}>
          {t("onboarding.set_budget_body")}
        </div>
      </div>

      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 12, color: C.muted, fontWeight: 500, marginBottom: 8 }}>{t("onboarding.monthly_budget")}</div>
        <div style={{ position: "relative" }}>
          <span style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", fontSize: 18, fontWeight: 700, color: C.text }}>$</span>
          <input
            type="number"
            value={budget}
            onChange={e => setBudget(e.target.value)}
            style={{ width: "100%", padding: "16px 16px 16px 34px", background: C.bgSecondary, border: `2px solid ${C.cyan}44`, borderRadius: 14, color: C.text, fontSize: 22, fontWeight: 700, fontFamily: FONT, boxSizing: "border-box" }}
            placeholder="3000"
          />
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          {["1500", "2500", "3000", "5000"].map(v => (
            <button key={v} onClick={() => setBudget(v)}
              style={{ flex: 1, padding: "7px 0", minHeight: 44, borderRadius: 10, border: `1px solid ${budget === v ? C.cyan + "66" : C.border}`, background: budget === v ? C.cyan + "18" : C.bgSecondary, color: budget === v ? C.cyan : C.muted, fontSize: 12, fontWeight: budget === v ? 700 : 400, cursor: "pointer", fontFamily: FONT }}>
              ${v}
            </button>
          ))}
        </div>
      </div>

      <button
        onClick={async () => {
          setSavingBudget(true);
          const val = Math.max(100, Number(budget) || 3000);
          try { await onSaveProfile({ monthly_budget: val }); } catch (err) { logger.error("[Onboarding] saveProfile failed:", err); }
          setSavingBudget(false);
          setStep(4);
        }}
        disabled={savingBudget}
        style={{ width: "100%", padding: 16, background: `linear-gradient(135deg, ${C.green}, ${C.cyan})`, border: "none", borderRadius: 16, color: "#000", fontWeight: 800, fontSize: 16, cursor: "pointer", fontFamily: FONT, opacity: savingBudget ? 0.7 : 1 }}
      >
        {savingBudget ? t("onboarding.saving") : t("onboarding.looks_good")}
      </button>
    </div>
  );

  if (step === 4) return (
    <AppPreviewStep onNext={() => setStep(5)} onBack={() => setStep(3)} />
  );

  if (step === 5) return wrap(
    <div>
      <div style={{ textAlign: "center", marginBottom: 28 }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: C.text, marginBottom: 8 }}>{t("onboarding.ready_title")}</div>
        <div style={{ fontSize: 14, color: C.muted }}>{t("onboarding.ready_subtitle")}</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
        {[
          { icon: "bank",        label: t("onboarding.feature_bank_sync"),    desc: t("onboarding.feature_bank_sync_sub"),    color: C.bankConnectBlue, bg: C.bankConnectBlue + "22", border: C.bankConnectBlue + "44" },
          { icon: "activity",    label: t("onboarding.feature_ai_insights"),  desc: t("onboarding.feature_ai_insights_sub"),  color: C.cyan,    bg: C.cyan + "18", border: C.cyan + "44" },
          { icon: "award",       label: t("onboarding.feature_health_score"), desc: t("onboarding.feature_health_score_sub"), color: C.green,   bg: C.green + "18", border: C.green + "44" },
          { icon: "trending-up", label: t("onboarding.feature_investing"),    desc: t("onboarding.feature_investing_sub"),    color: C.purple,  bg: C.purple + "18", border: C.purple + "44" },
        ].map(({ icon, label, desc, color, bg, border }) => (
          <div key={label} style={{ background: C.bgSecondary, border: `1px solid #1E293B`, borderRadius: 16, padding: "16px 14px" }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: bg, border: `1px solid ${border}`, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 10 }}>
              <Icon name={icon} size={19} color={color} strokeWidth={1.8} />
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.5 }}>{desc}</div>
          </div>
        ))}
      </div>
      <div style={{ textAlign: "center", fontSize: 12, color: C.faint, marginBottom: 20 }}>{t("onboarding.trusted")}</div>
      <button
        onClick={() => setStep(6)}
        style={{ width: "100%", padding: 16, background: `linear-gradient(135deg, ${C.cyan}, ${C.blue})`, border: "none", borderRadius: 16, color: "#000", fontWeight: 800, fontSize: 16, cursor: "pointer", fontFamily: FONT, boxShadow: `0 4px 24px ${C.cyan}44` }}
      >
        {t("onboarding.continue")}
      </button>
    </div>
  );

  function completeFree() {
    try { localStorage.setItem("arkonomy_onboarding_done", "1"); } catch {}
    posthog?.capture('onboarding_completed', { method: 'free' });
    window.location.reload();
  }

  // Only list perks that are actually gated by isPro (see usePlan.js
  // consumers) — Health Score has no isPro check anywhere and is free
  // from day one, so it doesn't belong here. AI Chat and AI Stock
  // Analysis are also ungated (rate-limited only, same limit for every
  // plan) — "AI spending insights" is specifically the Insights-tab
  // cards, where only the first 2 are free and the rest lock (Insights.jsx).
  const TRIAL_PERKS = [
    "Unlimited AI insights (Insights tab)",
    "Unlimited bank accounts",
    "Monthly Excel reports",
    "Investment tracking",
  ];

  return wrap(
    <div>
      {/* Icon */}
      <div style={{ textAlign: "center", marginBottom: 20 }}>
        <div style={{
          width: 72, height: 72, borderRadius: 22, margin: "0 auto 20px",
          background: C.green + "18",
          border: `1px solid ${C.green}44`,
          boxShadow: `0 0 32px ${C.green}33`,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <svg width={34} height={34} viewBox="0 0 24 24" fill="none" stroke={C.green} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
          </svg>
        </div>
        <div style={{ fontSize: 26, fontWeight: 800, color: C.text, marginBottom: 8, lineHeight: 1.2 }}>
          Try Pro free for 7 days
        </div>
        <div style={{ fontSize: 14, color: C.muted }}>No credit card required. Cancel anytime.</div>
      </div>

      {/* Feature list */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 28, padding: "16px", background: C.bgSecondary, borderRadius: 16, border: `1px solid ${C.border}` }}>
        {TRIAL_PERKS.map(p => (
          <div key={p} style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 20, height: 20, borderRadius: "50%", background: C.green + "22", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke={C.green} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </div>
            <span style={{ fontSize: 13, color: C.text }}>{p}</span>
          </div>
        ))}
      </div>

      {trialError && (
        <div style={{ color: C.red, fontSize: 13, background: C.red + "18", padding: "10px 14px", borderRadius: 10, marginBottom: 14 }}>
          {trialError}
        </div>
      )}

      <button
        onClick={() => proceedToFinish(startFreeTrial)}
        disabled={trialLoading}
        style={{ width: "100%", padding: 16, background: `linear-gradient(135deg, ${C.green}, ${C.cyan})`, border: "none", borderRadius: 16, color: "#000", fontWeight: 800, fontSize: 16, cursor: trialLoading ? "not-allowed" : "pointer", fontFamily: FONT, boxShadow: `0 4px 24px ${C.green}44`, opacity: trialLoading ? 0.7 : 1, marginBottom: 14 }}
      >
        {trialLoading ? "Starting trial…" : "Start Free Trial →"}
      </button>

      <button
        onClick={() => proceedToFinish(completeFree)}
        style={{ width: "100%", padding: 0, background: "none", border: "none", color: C.muted, fontWeight: 500, fontSize: 13, cursor: "pointer", fontFamily: FONT, textDecoration: "underline", textUnderlineOffset: 3 }}
      >
        Continue with Free plan
      </button>
    </div>
  );
}
