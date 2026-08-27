import { logger } from "../utils/logger";
import { useState, useMemo, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../utils/supabase";
import { C, FONT, RADIUS, DASHBOARD_C as DC } from "../utils/colors";
import { resolveCategory, timeAgo } from "../utils/helpers";
import { generateExcelReport } from "../lib/exportReport";
import GlassCard from "./shared/GlassCard";
import Icon from "./shared/Icon";
import PlaidLinkButton from "./shared/PlaidLinkButton";
import { IS_IOS_NATIVE } from "../lib/platform";
import { useUSStorefront } from "../lib/storefront";

function maskEmail(email) {
  if (!email) return '';
  const [local, domain] = email.split('@');
  return `${local.slice(0, 2)}***@${domain}`;
}

// BLOCKED on Plaid's side, not a code issue: this Plaid client_id is not
// authorized for the transactions_refresh product (confirmed via a live
// test 2026-07-26 — Plaid returned INVALID_PRODUCT). The button, its
// handler (App.jsx refreshBalanceNow), the edge function, and the cooldown
// migration are all built and tested end-to-end except for a real
// successful Plaid call, which needs Plaid to grant product access first.
// Flip to true once that's confirmed. See BACKLOG.md #19.
const REFRESH_BALANCE_ENABLED = false;

function pwError(pw, t) {
  if (!pw) return null;
  const missing = [];
  if (pw.length < 8)      missing.push(t("profile.pw_needs_length"));
  if (!/[A-Z]/.test(pw)) missing.push(t("profile.pw_needs_uppercase"));
  if (!/[0-9]/.test(pw)) missing.push(t("profile.pw_needs_number"));
  return missing.length ? t("profile.pw_needs_prefix") + " " + missing.join(", ") : null;
}

// Reuses the same expand/collapse visual language as InsightCard
// (Insights.jsx's "Cut Transfer by $X" banner) — header row toggles on
// click, chevron flips, content revealed below a divider — rather than
// inventing a second collapsible pattern for the app. header is a full
// ReactNode (not a fixed icon/title/summary shape) so sections whose
// collapsed row is already rich (Bank & Sync's name/status/badge) don't
// need to squeeze into a generic layout.
//
// Defined at module scope, not nested inside Profile() (unlike the
// pre-existing Toggle below) — a component with its own useState defined
// inside a parent's render body gets recreated as a new component identity
// on every parent re-render, which would remount it and silently reset
// `expanded` back to defaultExpanded on every keystroke in the budget
// input, every toggle flip, etc. Toggle has no internal state, so nesting
// it was harmless; AccordionSection does, so it can't follow that pattern.
function AccordionSection({ header, defaultExpanded = false, borderColor, children }) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  return (
    <GlassCard style={{ background: DC.card, border: `1px solid ${borderColor || `${DC.faint}33`}` }}>
      <div onClick={() => setExpanded(e => !e)} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
        {header}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={DC.faint} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
          {expanded ? <polyline points="18 15 12 9 6 15" /> : <polyline points="6 9 12 15 18 9" />}
        </svg>
      </div>
      {expanded && (
        <div style={{ marginTop: 16, borderTop: `1px solid ${DC.faint}18`, paddingTop: 16 }}>
          {children}
        </div>
      )}
    </GlassCard>
  );
}

export default function Profile({ profile, user, onSave, onSignOut, onDeleteAccount, onBack, autopilot, setAutopilot, bankConnected, bankName, bankCount, linkToken, getLinkToken, getReconnectToken, onPlaidSuccess, syncBankTransactions, syncingBank, lastSyncedAt, backgroundSyncing, onRefreshBalance, refreshingBalance, lastBalanceRefreshAt, isPro, onUpgrade, transactions = [] }) {
  const { t } = useTranslation();
  const isUSStorefront = useUSStorefront();
  const showRealUpgrade = !IS_IOS_NATIVE || isUSStorefront;

  // Client-side mirror of the server's 5-minute cooldown (see
  // check_and_set_balance_refresh RPC) — this is only for immediate button
  // feedback; the server call is the real enforcement. Ticks every 15s
  // while a cooldown is active so the "available in Xm" label counts down
  // without requiring a re-render from elsewhere.
  const [refreshTick, setRefreshTick] = useState(0);
  const refreshCooldownUntil = lastBalanceRefreshAt ? new Date(lastBalanceRefreshAt).getTime() + 5 * 60 * 1000 : null;
  const refreshCooldownActive = refreshCooldownUntil != null && Date.now() < refreshCooldownUntil;
  useEffect(() => {
    if (!refreshCooldownActive) return;
    const id = setInterval(() => setRefreshTick(v => v + 1), 15000);
    return () => clearInterval(id);
  }, [refreshCooldownActive]);
  const refreshCooldownMinutesLeft = refreshCooldownActive
    ? Math.max(1, Math.ceil((refreshCooldownUntil - Date.now()) / 60000))
    : 0;
  const [budget, setBudget] = useState(profile?.monthly_budget || 3000);
  const [goal, setGoal] = useState(profile?.savings_goal || 10000);
  const [budgetError, setBudgetError] = useState("");
  const [goalError, setGoalError] = useState("");
  const [saved, setSaved] = useState(false);
  const [showChangePw, setShowChangePw] = useState(false);
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwMsg, setPwMsg] = useState(null); // { type: "success"|"error", text }
  const [pwLoading, setPwLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteInput, setDeleteInput] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [notifPrefs, setNotifPrefs] = useState({
    frequency: "weekly",
    include_spending: true,
    include_balance: true,
    include_upcoming_bills: true,
    include_ai_tip: true,
    include_market_update: false,
    excel_frequency: "monthly",
    large_transaction_alerts: true,
  });
  const [notifSaved, setNotifSaved] = useState(false);
  const [notifSaving, setNotifSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("notification_preferences")
        .select("*")
        .eq("user_id", user.id)
        .single();
      if (data) setNotifPrefs({
        frequency:              data.frequency              ?? "weekly",
        include_spending:       data.include_spending       ?? true,
        include_balance:        data.include_balance        ?? true,
        include_upcoming_bills: data.include_upcoming_bills ?? true,
        include_ai_tip:         data.include_ai_tip         ?? true,
        include_market_update:  data.include_market_update  ?? false,
        excel_frequency:        data.excel_frequency        ?? "monthly",
        large_transaction_alerts: data.large_transaction_alerts ?? true,
      });
    })();
  }, []);

  async function saveNotifPrefs() {
    setNotifSaving(true);
    await supabase.from("notification_preferences").upsert(
      { user_id: user.id, ...notifPrefs },
      { onConflict: "user_id" }
    );
    setNotifSaving(false);
    setNotifSaved(true);
    setTimeout(() => setNotifSaved(false), 2000);
  }


  const handleExport = async () => {
    setExporting(true);
    try {
      const resolved = transactions.map(t => ({
        ...t,
        resolvedCategory: resolveCategory(t)
      }));
      await generateExcelReport(resolved);
    } catch (e) {
      logger.error('Export failed:', e);
    } finally {
      setExporting(false);
    }
  };

  async function handleChangePassword() {
    setPwMsg(null);
    if (!newPw || !confirmPw) { setPwMsg({ type: "error", text: t("profile.error_fill_both") }); return; }
    if (newPw !== confirmPw) { setPwMsg({ type: "error", text: t("profile.error_passwords_match") }); return; }
    const pwErr = pwError(newPw, t);
    if (pwErr) { setPwMsg({ type: "error", text: pwErr }); return; }
    setPwLoading(true);
    const { error } = await supabase.auth.updateUser({ password: newPw });
    setPwLoading(false);
    if (error) { setPwMsg({ type: "error", text: error.message }); return; }
    setPwMsg({ type: "success", text: t("profile.success_password") });
    setNewPw(""); setConfirmPw("");
    setTimeout(() => { setShowChangePw(false); setPwMsg(null); }, 2000);
  }
  const inp = { width: "100%", padding: "13px 14px", background: DC.bg, border: `1px solid ${DC.faint}33`, borderRadius: RADIUS.sm, color: DC.text, fontSize: 15, boxSizing: "border-box", fontFamily: FONT };

  const avgMonthlyIncome = useMemo(() => {
    const incomes = transactions.filter(t => t.type === "income");
    const byMonth = {};
    for (const t of incomes) {
      const month = (t.date || "").slice(0, 7);
      if (!month) continue;
      byMonth[month] = (byMonth[month] || 0) + Number(t.amount);
    }
    const months = Object.keys(byMonth);
    if (!months.length) return null;
    return Math.round(months.reduce((s, m) => s + byMonth[m], 0) / months.length);
  }, [transactions]);

  const budgetSuggestion = useMemo(() => {
    const expenses = transactions.filter(t => t.type === "expense");
    const byMonth = {};
    for (const t of expenses) {
      const month = (t.date || "").slice(0, 7);
      if (!month) continue;
      byMonth[month] = (byMonth[month] || 0) + Number(t.amount);
    }
    const months = Object.keys(byMonth);
    if (months.length < 2) return null;
    const avg = months.reduce((s, m) => s + byMonth[m], 0) / months.length;
    return Math.round(avg);
  }, [transactions]);

  // Settings restructure (2026-08-27): budget-vs-actual gap needs to be
  // visually loud, not a small "Use this" hint next to a budget that's
  // being blown every month — this is the same real number Insights/
  // Dashboard's "Budget Used %" already compares against, just surfaced
  // here with the actual dollar gap spelled out instead of implied.
  const budgetGapAmount = budgetSuggestion !== null ? budgetSuggestion - Number(budget) : null;
  const isOverBudgetVsHistory = budgetGapAmount !== null && budgetGapAmount > 0;

  // Autopilot's collapsed-row summary — real toggle count, not a static
  // "Active" badge that used to show regardless of how many rules were
  // actually on.
  const autopilotActiveCount = ["overspendAlerts", "largeTxAlerts", "lowBalanceAlerts", "unusualSpending"]
    .filter(k => autopilot[k]).length;

  // Notifications & Reports collapsed-row summary — large_transaction_alerts
  // is its own independent channel (see its own toggle below), not counted
  // as a "digest item".
  const digestItemCount = ["include_spending", "include_balance", "include_upcoming_bills", "include_ai_tip", "include_market_update"]
    .filter(k => notifPrefs[k]).length;
  const digestSummary = notifPrefs.frequency === "off"
    ? t("profile.notif_digest_off")
    : t("profile.notif_digest_summary", { freq: t("profile.freq_" + notifPrefs.frequency), count: digestItemCount });

  function Toggle({ value, onChange }) {
    return (
      <div onClick={() => onChange(!value)} style={{ width: 44, height: 26, borderRadius: RADIUS.full, background: value ? DC.gold + "33" : DC.bg, border: `1px solid ${value ? DC.gold + "66" : `${DC.faint}33`}`, position: "relative", cursor: "pointer", transition: "all 0.2s", flexShrink: 0 }}>
        <div style={{ position: "absolute", top: 3, left: value ? 20 : 3, width: 18, height: 18, borderRadius: RADIUS.full, background: value ? DC.gold : DC.faint, transition: "left 0.2s" }} />
      </div>
    );
  }

  async function handleDeleteAccount() {
    if (deleteInput !== "DELETE") return;
    setDeleting(true);
    try {
      await onDeleteAccount();
    } finally {
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, paddingBottom: 80 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {onBack && (
          <button
            onClick={onBack}
            style={{ background: "none", border: `1px solid ${DC.faint}33`, borderRadius: RADIUS.sm, width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}
          >
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={DC.muted} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
        )}
        <h2 style={{ margin: 0, fontSize: 26, fontWeight: 700 }}>{t("profile.title")}</h2>
      </div>

      <GlassCard style={{ background: DC.card, border: `1px solid ${DC.faint}33` }}>
        <div style={{ color: DC.faint, fontSize: 10, letterSpacing: 1.2, fontWeight: 600, marginBottom: 8 }}>{t("profile.account_label")}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: showChangePw ? 14 : 0 }}>
          <div style={{ width: 42, height: 42, borderRadius: RADIUS.md, background: DC.gold + "22", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Icon name="dollar" size={18} color={DC.gold} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{profile?.full_name || "User"}</div>
            <div style={{ color: DC.muted, fontSize: 13 }}>{maskEmail(user.email)}</div>
          </div>
          <button
            onClick={() => { setShowChangePw(v => !v); setPwMsg(null); setNewPw(""); setConfirmPw(""); }}
            style={{ flexShrink: 0, background: "none", border: `1px solid ${DC.faint}33`, borderRadius: RADIUS.xs, padding: "5px 10px", color: DC.muted, fontSize: 12, fontWeight: 500, cursor: "pointer", fontFamily: FONT, whiteSpace: "nowrap" }}
          >
            {showChangePw ? t("profile.cancel") : t("profile.change_password")}
          </button>
        </div>

        {showChangePw && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <input
              type="password"
              placeholder={t("profile.new_password")}
              value={newPw}
              onChange={e => setNewPw(e.target.value)}
              style={{ width: "100%", padding: "11px 14px", background: DC.bg, border: `1px solid ${DC.faint}33`, borderRadius: RADIUS.sm, color: DC.text, fontSize: 14, boxSizing: "border-box", fontFamily: FONT }}
            />
            <input
              type="password"
              placeholder={t("profile.confirm_password")}
              value={confirmPw}
              onChange={e => setConfirmPw(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleChangePassword()}
              style={{ width: "100%", padding: "11px 14px", background: DC.bg, border: `1px solid ${DC.faint}33`, borderRadius: RADIUS.sm, color: DC.text, fontSize: 14, boxSizing: "border-box", fontFamily: FONT }}
            />
            {pwMsg && (
              <div style={{ fontSize: 12, fontWeight: 500, padding: "8px 12px", borderRadius: RADIUS.xs, background: pwMsg.type === "success" ? DC.emerald + "14" : DC.ruby + "14", color: pwMsg.type === "success" ? DC.emerald : DC.ruby, border: `1px solid ${pwMsg.type === "success" ? DC.emerald + "33" : DC.ruby + "33"}` }}>
                {pwMsg.text}
              </div>
            )}
            <button
              onClick={handleChangePassword}
              disabled={pwLoading}
              style={{ width: "100%", padding: "11px 0", background: pwLoading ? `${DC.faint}33` : DC.gold, border: "none", borderRadius: RADIUS.sm, color: pwLoading ? DC.faint : DC.bg, fontWeight: 700, fontSize: 14, cursor: pwLoading ? "default" : "pointer", fontFamily: FONT }}
            >
              {pwLoading ? t("profile.updating") : t("profile.update_password")}
            </button>
          </div>
        )}
      </GlassCard>

      {!isPro && (
        <button
          type="button"
          onClick={onUpgrade}
          style={{
            display: "flex", alignItems: "center", gap: 14,
            width: "100%", textAlign: "left",
            background: `linear-gradient(135deg, ${C.proAccent}18, #38B6FF0A)`,
            border: `1px solid ${C.proAccent}33`,
            borderRadius: RADIUS.lg, padding: "16px 18px",
            cursor: "pointer", fontFamily: FONT,
          }}
        >
          <div style={{
            width: 42, height: 42, borderRadius: RADIUS.sm, flexShrink: 0,
            background: `linear-gradient(135deg, ${C.proAccent}33, #38B6FF22)`,
            border: `1px solid ${C.proAccent}44`,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="#38B6FF" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: DC.text, marginBottom: 2 }}>{showRealUpgrade ? t("profile.upgrade_title") : "Pro"}</div>
            <div style={{ fontSize: 12, color: DC.muted }}>{showRealUpgrade ? t("profile.upgrade_subtitle") : t("profile.pro_features_ios")}</div>
          </div>
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={DC.faint} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      )}

      {/* ── PLAID BANK CONNECTION ── */}
      <AccordionSection
        defaultExpanded
        borderColor={bankConnected ? DC.emerald + "44" : C.bankConnectBlue + "44"}
        header={
          <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
            <div style={{ width: 40, height: 40, borderRadius: RADIUS.sm, background: bankConnected ? DC.emerald + "22" : C.bankConnectBlue + "22", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Icon name="bank" size={18} color={bankConnected ? DC.emerald : C.bankConnectBlue} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className={bankConnected && bankName ? "ph-mask" : undefined} style={{ fontWeight: 700, fontSize: 15 }}>
                {bankConnected ? bankName || t("profile.bank_connected_name") : t("profile.connect_bank")}
              </div>
              <div style={{ fontSize: 12, color: DC.muted, marginTop: 2 }}>
                {bankConnected
                  ? backgroundSyncing
                    ? t("profile.syncing")
                    : lastSyncedAt
                      ? t("profile.last_synced", { time: timeAgo(lastSyncedAt) })
                      : t("profile.auto_sync")
                  : t("profile.sync_via_plaid")
                }
              </div>
            </div>
            {bankConnected && (
              <div style={{ background: DC.emerald + "22", border: `1px solid ${DC.emerald}44`, borderRadius: RADIUS.full, padding: "3px 10px", flexShrink: 0 }}>
                <span style={{ fontSize: 11, color: DC.emerald, fontWeight: 600 }}>{t("profile.active")}</span>
              </div>
            )}
          </div>
        }
      >
        {bankConnected && linkToken ? (
          <PlaidLinkButton linkToken={linkToken} onSuccess={onPlaidSuccess} onExit={() => {}} autoOpen />
        ) : bankConnected ? (
          <>
            <button onClick={syncBankTransactions} disabled={syncingBank}
              style={{ width: "100%", padding: 13, background: syncingBank ? `${DC.faint}33` : DC.emerald + "22", border: `1px solid ${DC.emerald}44`, borderRadius: RADIUS.md, color: DC.emerald, fontWeight: 600, fontSize: 14, cursor: syncingBank ? "not-allowed" : "pointer", fontFamily: FONT, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 8 }}>
              <Icon name="repeat" size={15} color={DC.emerald} strokeWidth={2} />
              {syncingBank ? t("profile.syncing_btn") : t("profile.sync_transactions")}
            </button>
            {REFRESH_BALANCE_ENABLED && (
              <button onClick={onRefreshBalance} disabled={refreshingBalance || refreshCooldownActive}
                style={{ width: "100%", padding: 13, background: (refreshingBalance || refreshCooldownActive) ? `${DC.faint}33` : DC.gold + "18", border: `1px solid ${DC.gold}44`, borderRadius: RADIUS.md, color: (refreshingBalance || refreshCooldownActive) ? DC.faint : DC.gold, fontWeight: 600, fontSize: 14, cursor: (refreshingBalance || refreshCooldownActive) ? "not-allowed" : "pointer", fontFamily: FONT, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 8 }}>
                <Icon name="zap" size={15} color={(refreshingBalance || refreshCooldownActive) ? DC.faint : DC.gold} strokeWidth={2} />
                {refreshingBalance
                  ? t("profile.refreshing_balance_btn")
                  : refreshCooldownActive
                    ? t("profile.refresh_balance_cooldown_btn", { min: refreshCooldownMinutesLeft })
                    : t("profile.refresh_balance_btn")}
              </button>
            )}
            <button
              onClick={getReconnectToken}
              style={{ width: "100%", padding: 12, background: DC.gold + "18", border: `1px solid ${DC.gold}44`, borderRadius: RADIUS.md, color: DC.gold, fontWeight: 600, fontSize: 13, cursor: "pointer", fontFamily: FONT, display: "flex", alignItems: "center", justifyContent: "center", gap: 7, marginBottom: 8 }}>
              <Icon name="refresh-cw" size={13} color={DC.gold} strokeWidth={2.5} />
              {t("profile.reconnect_bank")}
            </button>
            <button
              onClick={() => { if (!isPro) { onUpgrade(); return; } getLinkToken(); }}
              style={{ width: "100%", padding: 12, background: isPro ? C.bankConnectBlue + "22" : DC.bg, border: `1px solid ${isPro ? C.bankConnectBlue + "44" : `${DC.faint}33`}`, borderRadius: RADIUS.md, color: isPro ? "#4B8EFF" : DC.faint, fontWeight: 600, fontSize: 13, cursor: "pointer", fontFamily: FONT, display: "flex", alignItems: "center", justifyContent: "center", gap: 7 }}>
              {isPro ? <Icon name="plus" size={13} color="#4B8EFF" strokeWidth={2.5} /> : <span>🔒</span>}
              {isPro ? t("profile.add_another_bank", { count: bankCount }) : t("profile.add_another_bank_pro")}
            </button>
          </>
        ) : linkToken ? (
          <PlaidLinkButton linkToken={linkToken} onSuccess={onPlaidSuccess} onExit={() => {}} autoOpen />
        ) : (
          <button onClick={getLinkToken}
            style={{ width: "100%", padding: 14, background: `linear-gradient(135deg,${C.bankConnectBlue},#2F80FF)`, border: "none", borderRadius: RADIUS.md, color: "#fff", fontWeight: 700, fontSize: 15, cursor: "pointer", fontFamily: FONT, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, boxShadow: `0 4px 20px ${C.bankConnectBlue}66` }}>
            <Icon name="bank" size={17} color="#fff" strokeWidth={2} />
            {t("profile.connect_bank")}
          </button>
        )}

        {!bankConnected && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10, justifyContent: "center" }}>
            <Icon name="lock" size={11} color={DC.faint} />
            <span style={{ fontSize: 11, color: DC.faint }}>{t("profile.encryption")}</span>
          </div>
        )}
      </AccordionSection>

      {/* ── BUDGET & GOALS ── */}
      <AccordionSection
        defaultExpanded
        borderColor={isOverBudgetVsHistory ? DC.ruby + "33" : `${DC.faint}33`}
        header={
          <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
            <div style={{ width: 38, height: 38, borderRadius: RADIUS.sm, background: (isOverBudgetVsHistory ? DC.ruby : DC.gold) + "18", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Icon name="target" size={17} color={isOverBudgetVsHistory ? DC.ruby : DC.gold} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{t("profile.financial_settings")}</div>
              <div style={{ fontSize: 12, color: isOverBudgetVsHistory ? DC.ruby : DC.muted, marginTop: 1, fontWeight: isOverBudgetVsHistory ? 600 : 400 }}>
                {t("profile.budget_summary", { amount: Number(budget).toLocaleString() })}
              </div>
            </div>
          </div>
        }
      >
        <div style={{ color: DC.muted, fontSize: 12, fontWeight: 500, marginBottom: 6 }}>{t("profile.monthly_budget")}</div>
        <input style={{ ...inp, marginBottom: budgetError ? 4 : 8, border: budgetError ? `1px solid ${DC.ruby}` : inp.border }} type="number" value={budget} onChange={e => { setBudget(e.target.value); setBudgetError(""); }} />
        {budgetError && <div style={{ color: DC.ruby, fontSize: 12, fontWeight: 500, marginBottom: 8 }}>{budgetError}</div>}
        {avgMonthlyIncome !== null && Number(budget) > avgMonthlyIncome && (
          <div style={{ fontSize: 12, color: DC.gold, background: DC.gold + "14", border: `1px solid ${DC.gold}33`, borderRadius: RADIUS.sm, padding: "8px 12px", marginBottom: 8 }}>
            ⚠️ {t("profile.budget_exceeds_income", { amount: avgMonthlyIncome.toLocaleString() })}
          </div>
        )}
        {budgetSuggestion !== null ? (
          isOverBudgetVsHistory ? (
            // Escalated from a small gold hint to a real warning block when
            // the budget is genuinely being blown, not just off by a little —
            // this was easy to miss next to a $3,000 budget getting exceeded
            // every month (Settings restructure, 2026-08-27). Same real
            // budgetSuggestion figure Insights/Dashboard's "Budget Used %"
            // already compares against — the point is to explain WHY those
            // screens keep saying "over budget", not a new/different number.
            <div style={{ background: DC.ruby + "14", border: `1px solid ${DC.ruby}44`, borderRadius: RADIUS.sm, padding: "12px 14px", marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <Icon name="alert-circle" size={14} color={DC.ruby} />
                <span style={{ fontSize: 13, fontWeight: 700, color: DC.ruby }}>{t("profile.budget_gap_title")}</span>
              </div>
              <div style={{ fontSize: 12, color: DC.muted, lineHeight: 1.5, marginBottom: 10 }}>
                {t("profile.budget_gap_body", { avg: budgetSuggestion.toLocaleString(), gap: budgetGapAmount.toLocaleString(), budget: Number(budget).toLocaleString() })}
              </div>
              <button
                onClick={() => setBudget(budgetSuggestion)}
                style={{ width: "100%", padding: "9px 0", background: DC.ruby + "22", border: `1px solid ${DC.ruby}55`, borderRadius: RADIUS.xs, color: DC.ruby, fontWeight: 700, fontSize: 12, cursor: "pointer", fontFamily: FONT }}>
                {t("profile.budget_gap_cta", { amount: budgetSuggestion.toLocaleString() })}
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: DC.gold + "12", border: `1px solid ${DC.gold}33`, borderRadius: RADIUS.sm, padding: "9px 12px", marginBottom: 14, gap: 8 }}>
              <div style={{ fontSize: 12, color: DC.gold, fontWeight: 500 }}>
                {t("profile.budget_suggestion", { amount: budgetSuggestion.toLocaleString() })}
              </div>
              <button
                onClick={() => setBudget(budgetSuggestion)}
                style={{ flexShrink: 0, padding: "5px 11px", background: DC.gold + "22", border: `1px solid ${DC.gold}55`, borderRadius: RADIUS.xs, color: DC.gold, fontWeight: 600, fontSize: 11, cursor: "pointer", fontFamily: FONT, whiteSpace: "nowrap" }}>
                {t("profile.use_this")}
              </button>
            </div>
          )
        ) : (
          <div style={{ fontSize: 11, color: DC.faint, marginBottom: 14, padding: "7px 10px", background: DC.bg, borderRadius: RADIUS.sm }}>
            {t("profile.not_enough_data")}
          </div>
        )}
        <div style={{ color: DC.muted, fontSize: 12, fontWeight: 500, marginBottom: 6 }}>{t("profile.annual_savings_goal")}</div>
        <input style={{ ...inp, marginBottom: goalError ? 4 : 18, border: goalError ? `1px solid ${DC.ruby}` : inp.border }} type="number" value={goal} onChange={e => { setGoal(e.target.value); setGoalError(""); }} />
        {goalError && <div style={{ color: DC.ruby, fontSize: 12, fontWeight: 500, marginBottom: 14 }}>{goalError}</div>}
        <button onClick={async () => {
            const b = parseFloat(budget), g = parseFloat(goal);
            // Mirrors AddTransactionModal's amount guard (Transactions.jsx) — this
            // form had no validation at all before, and profiles.monthly_budget /
            // savings_goal are unbounded NUMERIC columns with no DB-side check,
            // so a negative value used to save silently and corrupt Health Score
            // and Insights' Budget Used % on other screens.
            let invalid = false;
            if (!Number.isFinite(b) || b <= 0) { setBudgetError(t("profile.budget_must_be_positive")); invalid = true; }
            if (!Number.isFinite(g) || g <= 0) { setGoalError(t("profile.goal_must_be_positive")); invalid = true; }
            if (invalid) return;
            const ok = await onSave({ monthly_budget: b, savings_goal: g });
            if (ok) { setSaved(true); setTimeout(() => setSaved(false), 2000); }
            else { setBudgetError(t("profile.save_failed")); }
          }}
          style={{ width: "100%", padding: 14, background: saved ? DC.emerald : DC.gold, border: "none", borderRadius: RADIUS.sm, color: saved ? DC.bg : DC.bg, fontWeight: 700, cursor: "pointer", transition: "background 0.3s", fontFamily: FONT }}>
          {saved ? t("profile.saved") : t("profile.save_settings")}
        </button>
      </AccordionSection>

      {/* ── AUTOPILOT (collapsed by default) ── */}
      <AccordionSection
        header={
          <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
            <div style={{ width: 38, height: 38, borderRadius: RADIUS.sm, background: DC.gold + "18", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Icon name="zap" size={17} color={DC.gold} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{t("profile.autopilot_title")}</div>
              <div style={{ fontSize: 12, color: DC.muted, marginTop: 1 }}>{t("profile.autopilot_summary", { count: autopilotActiveCount })}</div>
            </div>
          </div>
        }
      >
        {[
          { key: "overspendAlerts",  icon: "bell",         color: DC.gold,    title: t("profile.overspend_alerts"),   sub: t("profile.overspend_alerts_sub") },
          { key: "largeTxAlerts",   icon: "alert-circle", color: DC.ruby,    title: t("profile.large_tx_alerts"),    sub: t("profile.autopilot_large_tx_alerts_sub", { threshold: autopilot.largeTxThreshold }) },
          { key: "lowBalanceAlerts",icon: "dollar",       color: DC.emerald, title: t("profile.low_balance_alerts"), sub: t("profile.low_balance_alerts_sub", { threshold: autopilot.lowBalanceThreshold }) },
          { key: "unusualSpending", icon: "activity",     color: DC.gold,    title: t("profile.unusual_spending"),   sub: t("profile.unusual_spending_sub") },
        ].map((rule, i) => (
          <div key={rule.key}>
            {i > 0 && <div style={{ height: 1, background: `${DC.faint}22`, margin: "12px 0" }} />}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1 }}>
                <div style={{ width: 36, height: 36, borderRadius: RADIUS.sm, background: rule.color + "22", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <Icon name={rule.icon} size={16} color={rule.color} />
                </div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{rule.title}</div>
                  <div style={{ fontSize: 12, color: DC.muted, marginTop: 1 }}>{rule.sub}</div>
                </div>
              </div>
              <Toggle value={autopilot[rule.key]} onChange={v => setAutopilot(prev => ({ ...prev, [rule.key]: v }))} />
            </div>
          </div>
        ))}
      </AccordionSection>

      {/* ── NOTIFICATIONS & REPORTS (collapsed by default) ── */}
      <AccordionSection
        header={
          <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
            <div style={{ width: 38, height: 38, borderRadius: RADIUS.sm, background: DC.gold + "18", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Icon name="bell" size={17} color={DC.gold} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{t("profile.notifications_reports_title")}</div>
              <div style={{ fontSize: 12, color: DC.muted, marginTop: 1 }}>{digestSummary}</div>
            </div>
          </div>
        }
      >
        {/* Email digest frequency */}
        <div style={{ fontSize: 12, color: DC.muted, fontWeight: 500, marginBottom: 2 }}>{t("profile.email_digest_frequency")}</div>
        <div style={{ fontSize: 11, color: DC.faint, marginBottom: 8 }}>{t("profile.email_digest_frequency_sub")}</div>
        <div style={{ display: "flex", gap: 6, marginBottom: 18 }}>
          {["weekly", "biweekly", "monthly", "off"].map(opt => (
            <button
              key={opt}
              onClick={() => setNotifPrefs(p => ({ ...p, frequency: opt }))}
              style={{ flex: 1, padding: "8px 0", borderRadius: RADIUS.sm, border: `1px solid ${notifPrefs.frequency === opt ? DC.gold + "88" : `${DC.faint}33`}`, background: notifPrefs.frequency === opt ? DC.gold + "22" : DC.bg, color: notifPrefs.frequency === opt ? DC.gold : DC.muted, fontWeight: 600, fontSize: 11, cursor: "pointer", fontFamily: FONT, textTransform: "capitalize" }}
            >
              {t("profile.freq_" + opt)}
            </button>
          ))}
        </div>

        {/* Content toggles */}
        {notifPrefs.frequency !== "off" && (
          <>
            <div style={{ fontSize: 12, color: DC.muted, fontWeight: 500, marginBottom: 10 }}>{t("profile.include_in_digest")}</div>
            {[
              { key: "include_spending",       label: t("profile.digest_spending") },
              { key: "include_balance",         label: t("profile.digest_balance") },
              { key: "include_upcoming_bills",  label: t("profile.digest_upcoming_bills") },
              { key: "include_ai_tip",          label: t("profile.digest_ai_tip") },
              { key: "include_market_update",   label: t("profile.digest_market_update") },
            ].map((item, i, arr) => (
              <div key={item.key}>
                {i > 0 && <div style={{ height: 1, background: `${DC.faint}22`, margin: "10px 0" }} />}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 14, color: DC.text }}>{item.label}</span>
                  <Toggle value={notifPrefs[item.key]} onChange={v => setNotifPrefs(p => ({ ...p, [item.key]: v }))} />
                </div>
              </div>
            ))}
            <div style={{ height: 1, background: `${DC.faint}22`, margin: "16px 0" }} />
          </>
        )}

        {/* Large transaction alerts — independent of digest frequency, own email channel */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 2 }}>
          <div>
            <div style={{ fontSize: 14, color: DC.text }}>{t("profile.large_tx_alerts_title")}</div>
            <div style={{ fontSize: 11, color: DC.faint, marginTop: 1 }}>{t("profile.large_tx_alerts_sub")}</div>
          </div>
          <Toggle value={notifPrefs.large_transaction_alerts} onChange={v => setNotifPrefs(p => ({ ...p, large_transaction_alerts: v }))} />
        </div>
        <div style={{ height: 1, background: `${DC.faint}22`, margin: "16px 0" }} />

        {/* Excel report frequency — Pro only */}
        <div style={{ height: 1, background: `${DC.faint}22`, margin: "4px 0 20px" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
          <Icon name="file-text" size={13} color={isPro ? DC.emerald : DC.faint} />
          <span style={{ fontSize: 12, fontWeight: 500, color: isPro ? DC.muted : DC.faint }}>
            <span style={{ color: isPro ? DC.emerald : DC.faint, fontWeight: 700 }}>{t("profile.excel_label")}</span> {t("profile.excel_report_frequency")}
          </span>
          {!isPro && <span style={{ marginLeft: "auto", fontSize: 10, fontWeight: 700, color: DC.faint, background: DC.bg, border: `1px solid ${DC.faint}33`, borderRadius: RADIUS.full, padding: "2px 7px" }}>{t("common.pro_badge")}</span>}
        </div>
        <div style={{ fontSize: 11, color: DC.faint, marginBottom: 8 }}>{t("profile.excel_report_sub")}</div>
        {isPro ? (
          <div style={{ display: "flex", gap: 6, marginBottom: 18 }}>
            {["monthly", "quarterly", "off"].map(opt => (
              <button
                key={opt}
                onClick={() => setNotifPrefs(p => ({ ...p, excel_frequency: opt }))}
                style={{ flex: 1, padding: "8px 0", borderRadius: RADIUS.sm, border: `1px solid ${notifPrefs.excel_frequency === opt ? DC.gold + "88" : `${DC.faint}33`}`, background: notifPrefs.excel_frequency === opt ? DC.gold + "22" : DC.bg, color: notifPrefs.excel_frequency === opt ? DC.gold : DC.muted, fontWeight: 600, fontSize: 11, cursor: "pointer", fontFamily: FONT, textTransform: "capitalize" }}
              >
                {t("profile.excel_freq_" + opt)}
              </button>
            ))}
          </div>
        ) : (
          <div onClick={onUpgrade} style={{ display: "flex", gap: 6, marginBottom: 18, cursor: "pointer", opacity: 0.45, pointerEvents: "auto" }}>
            {["monthly", "quarterly", "off"].map(opt => (
              <div key={opt} style={{ flex: 1, padding: "8px 0", borderRadius: RADIUS.sm, border: `1px solid ${DC.faint}33`, background: DC.bg, color: DC.faint, fontWeight: 600, fontSize: 11, textAlign: "center", textTransform: "capitalize", userSelect: "none" }}>
                {t("profile.excel_freq_" + opt)}
              </div>
            ))}
          </div>
        )}

        <button
          onClick={saveNotifPrefs}
          disabled={notifSaving}
          style={{ width: "100%", padding: 13, background: notifSaved ? DC.emerald : notifSaving ? `${DC.faint}33` : DC.gold, border: "none", borderRadius: RADIUS.sm, color: notifSaved ? DC.bg : notifSaving ? DC.faint : DC.bg, fontWeight: 700, fontSize: 14, cursor: notifSaving ? "default" : "pointer", transition: "background 0.3s", fontFamily: FONT }}
        >
          {notifSaved ? t("profile.saved") : notifSaving ? t("profile.saving") : t("profile.save_preferences")}
        </button>
      </AccordionSection>

      <GlassCard style={{ background: DC.card, border: `1px solid ${DC.gold}22` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <Icon name="info" size={15} color={DC.gold} />
          <span style={{ fontWeight: 600, fontSize: 14, color: DC.gold }}>{t("profile.legal_title")}</span>
        </div>
        <div style={{ fontSize: 12, color: DC.muted, lineHeight: 1.7 }}>
          {t("profile.legal_broker")}
        </div>
        <div style={{ fontSize: 12, color: DC.muted, lineHeight: 1.7, marginTop: 10 }}>
          {t("profile.legal_ai")}
        </div>
      </GlassCard>

      <GlassCard style={{ background: DC.card, border: `1px solid ${DC.faint}33` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
          <Icon name="shield" size={15} color={DC.gold} />
          <span style={{ fontWeight: 600, fontSize: 15 }}>{t("profile.security_title")}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "4px 0" }}>
          <div style={{ width: 38, height: 38, borderRadius: RADIUS.sm, background: DC.gold + "18", border: `1px solid ${DC.gold}33`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Icon name="smartphone" size={17} color={DC.gold} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 500, color: DC.text }}>{t("profile.face_id")}</div>
            <div style={{ fontSize: 11, color: DC.muted, marginTop: 2 }}>{t("profile.face_id_sub")}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
            <div style={{ width: 44, height: 24, borderRadius: RADIUS.sm, background: `${DC.faint}22`, border: `1px solid ${DC.faint}33`, display: "flex", alignItems: "center", padding: "0 3px", cursor: "not-allowed", opacity: 0.5 }}>
              <div style={{ width: 18, height: 18, borderRadius: RADIUS.full, background: DC.muted }} />
            </div>
            <span style={{ fontSize: 10, color: DC.faint }}>{t("profile.face_id_coming")}</span>
          </div>
        </div>
      </GlassCard>

      {/* Raw hex, not migrated - treated as its own documented Pro-branding
          accent (same principle as C.proAccent/C.bankConnectBlue), not a
          generic old-palette duplicate. Not touched, per explicit decision. */}
      <button
        onClick={() => { if (!isPro) { onUpgrade(); return; } handleExport(); }}
        disabled={isPro && exporting}
        style={{ width: '100%', padding: '14px', background: '#1E293B', color: isPro ? '#7C3AED' : DC.faint, border: `1px solid ${isPro ? '#334155' : `${DC.faint}33`}`, borderRadius: RADIUS.sm, fontSize: 15, fontWeight: 600, cursor: (isPro && exporting) ? 'not-allowed' : 'pointer', marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, fontFamily: FONT }}
      >
        {!isPro && <span>🔒</span>}
        {isPro && exporting ? t("profile.generating") : t("profile.export_report")}
      </button>

      {/* Settings restructure (2026-08-27): moved below Export Report, out
          from between the functional settings blocks — a "Coming Soon" list
          doesn't belong sitting in the middle of accordion sections the
          user actually configures. Not an accordion itself (nothing to
          expand — every row is already just a label + "SOON" badge). */}
      <GlassCard style={{ background: DC.card, border: `1px solid ${DC.faint}33` }}>
        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 14 }}>{t("profile.coming_next")}</div>
        {/* Desaturated via the same HSL formula as CAT_COLORS/ASSET_TILES/
            MARKET_META - a 3-item identity legend, kept distinguishable
            rather than collapsed into gold. */}
        {[
          { label: t("profile.tax_reports"),      color: "#2E889E", icon: "file-text" },
          { label: t("profile.bill_negotiation"), color: "#9F6A2D", icon: "zap" },
          { label: t("profile.credit_score"),     color: "#7648C7", icon: "award" },
        ].map((item, i, arr) => (
          <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 14, padding: "11px 0", borderBottom: i < arr.length - 1 ? `1px solid ${DC.faint}22` : "none" }}>
            <div style={{ width: 38, height: 38, borderRadius: RADIUS.sm, background: item.color + "22", border: `1px solid ${item.color}33`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Icon name={item.icon} size={17} color={item.color} />
            </div>
            <span style={{ color: DC.text, fontSize: 14, flex: 1 }}>{item.label}</span>
            <span style={{ fontSize: 10, fontWeight: 700, color: DC.gold, background: DC.gold + "18", border: `1px solid ${DC.gold}33`, borderRadius: RADIUS.lg, padding: "2px 8px", letterSpacing: 0.4, flexShrink: 0 }}>{t("profile.soon")}</span>
          </div>
        ))}
      </GlassCard>

      <button
        onClick={onSignOut}
        style={{ width: "100%", padding: "13px 0", borderRadius: RADIUS.sm, border: `1px solid ${DC.faint}33`, background: "none", color: DC.ruby, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: FONT }}
      >
        {t("profile.sign_out")}
      </button>

      <button
        onClick={() => { setShowDeleteConfirm(true); setDeleteInput(""); }}
        style={{ width: "100%", padding: "11px 0", borderRadius: RADIUS.sm, border: `1px solid ${DC.ruby}33`, background: "none", color: DC.ruby, fontSize: 13, fontWeight: 500, cursor: "pointer", fontFamily: FONT, marginBottom: 16, opacity: 0.7 }}
      >
        {t("profile.delete_account")}
      </button>

      {showDeleteConfirm && (
        <div
          onClick={() => setShowDeleteConfirm(false)}
          style={{ position: "fixed", inset: 0, zIndex: 9000, background: "rgba(7,12,24,0.88)", display: "flex", alignItems: "flex-end", justifyContent: "center", backdropFilter: "blur(4px)" }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ width: "100%", maxWidth: 430, background: DC.card, borderRadius: "24px 24px 0 0", border: `1px solid ${DC.ruby}33`, borderBottom: "none", padding: "28px 20px 40px", fontFamily: FONT }}
          >
            <div style={{ width: 36, height: 4, borderRadius: RADIUS.full, background: `${DC.faint}33`, margin: "0 auto 24px" }} />
            <div style={{ textAlign: "center", marginBottom: 20 }}>
              <div style={{ fontSize: 32, marginBottom: 10 }}>⚠️</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: DC.text, marginBottom: 8 }}>{t("profile.delete_confirm_title")}</div>
              <div style={{ fontSize: 14, color: DC.muted, lineHeight: 1.6 }}>
                {t("profile.delete_confirm_warning")}
              </div>
            </div>
            <div style={{ fontSize: 13, color: DC.muted, marginBottom: 8 }}>{t("profile.delete_type_prefix")} <strong style={{ color: DC.ruby }}>DELETE</strong> {t("profile.delete_type_suffix")}</div>
            <input
              type="text"
              value={deleteInput}
              onChange={e => setDeleteInput(e.target.value)}
              placeholder="DELETE"
              style={{ width: "100%", padding: "12px 14px", background: DC.bg, border: `1px solid ${deleteInput === "DELETE" ? DC.ruby : `${DC.faint}33`}`, borderRadius: RADIUS.sm, color: DC.text, fontSize: 15, boxSizing: "border-box", fontFamily: FONT, marginBottom: 14 }}
            />
            <button
              onClick={handleDeleteAccount}
              disabled={deleteInput !== "DELETE" || deleting}
              style={{ width: "100%", padding: 15, background: deleteInput === "DELETE" ? DC.ruby : `${DC.faint}33`, border: "none", borderRadius: RADIUS.md, color: deleteInput === "DELETE" ? "#fff" : DC.faint, fontWeight: 700, fontSize: 15, cursor: deleteInput === "DELETE" ? "pointer" : "not-allowed", fontFamily: FONT, marginBottom: 10, transition: "background 0.2s" }}
            >
              {deleting ? t("profile.deleting") : t("profile.delete_permanently")}
            </button>
            <button
              onClick={() => setShowDeleteConfirm(false)}
              style={{ width: "100%", padding: 13, background: "none", border: `1px solid ${DC.faint}33`, borderRadius: RADIUS.md, color: DC.muted, fontWeight: 500, fontSize: 14, cursor: "pointer", fontFamily: FONT }}
            >
              {t("profile.cancel")}
            </button>
          </div>
        </div>
      )}

      <div style={{ textAlign: "center", padding: "4px 0 8px", fontSize: 12, color: DC.faint, fontFamily: FONT }}>
        <a href="/privacy.html" target="_blank" rel="noopener noreferrer" style={{ color: DC.faint, textDecoration: "none" }}>{t("profile.privacy_policy")}</a>
        <span style={{ margin: "0 8px" }}>·</span>
        <a href="/terms.html" target="_blank" rel="noopener noreferrer" style={{ color: DC.faint, textDecoration: "none" }}>{t("profile.terms_of_service")}</a>
        <span style={{ margin: "0 8px" }}>·</span>
        <a href="/cybersecurity.html" target="_blank" rel="noopener noreferrer" style={{ color: DC.faint, textDecoration: "none" }}>{t("profile.cybersecurity_policy")}</a>
      </div>
    </div>
  );
}
