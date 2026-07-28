import { logger } from "../utils/logger";
import { useState, useMemo, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../utils/supabase";
import { C, FONT } from "../utils/colors";
import { resolveCategory, timeAgo } from "../utils/helpers";
import { generateExcelReport } from "../lib/exportReport";
import GlassCard from "./shared/GlassCard";
import Icon from "./shared/Icon";
import PlaidLinkButton from "./shared/PlaidLinkButton";
import { IS_IOS_NATIVE } from "../lib/platform";

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

export default function Profile({ profile, user, onSave, onSignOut, onDeleteAccount, onBack, autopilot, setAutopilot, bankConnected, bankName, bankCount, linkToken, getLinkToken, getReconnectToken, onPlaidSuccess, syncBankTransactions, syncingBank, lastSyncedAt, backgroundSyncing, onRefreshBalance, refreshingBalance, lastBalanceRefreshAt, isPro, onUpgrade, transactions = [] }) {
  const { t } = useTranslation();

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
  const inp = { width: "100%", padding: "13px 14px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 12, color: C.text, fontSize: 15, boxSizing: "border-box", fontFamily: FONT };

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

  function Toggle({ value, onChange }) {
    return (
      <div onClick={() => onChange(!value)} style={{ width: 44, height: 26, borderRadius: 99, background: value ? C.cyan + "33" : C.bgTertiary, border: `1px solid ${value ? C.cyan + "66" : C.border}`, position: "relative", cursor: "pointer", transition: "all 0.2s", flexShrink: 0 }}>
        <div style={{ position: "absolute", top: 3, left: value ? 20 : 3, width: 18, height: 18, borderRadius: 99, background: value ? C.cyan : C.faint, transition: "left 0.2s" }} />
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
            style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: 10, width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}
          >
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={C.muted} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
        )}
        <h2 style={{ margin: 0, fontSize: 26, fontWeight: 700 }}>{t("profile.title")}</h2>
      </div>

      <GlassCard>
        <div style={{ color: C.faint, fontSize: 10, letterSpacing: 1.2, fontWeight: 600, marginBottom: 8 }}>{t("profile.account_label")}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: showChangePw ? 14 : 0 }}>
          <div style={{ width: 42, height: 42, borderRadius: 14, background: C.cyan + "22", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Icon name="dollar" size={18} color={C.cyan} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{profile?.full_name || "User"}</div>
            <div style={{ color: C.muted, fontSize: 13 }}>{maskEmail(user.email)}</div>
          </div>
          <button
            onClick={() => { setShowChangePw(v => !v); setPwMsg(null); setNewPw(""); setConfirmPw(""); }}
            style={{ flexShrink: 0, background: "none", border: `1px solid ${C.border}`, borderRadius: 8, padding: "5px 10px", color: C.muted, fontSize: 12, fontWeight: 500, cursor: "pointer", fontFamily: FONT, whiteSpace: "nowrap" }}
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
              style={{ width: "100%", padding: "11px 14px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, color: C.text, fontSize: 14, boxSizing: "border-box", fontFamily: FONT }}
            />
            <input
              type="password"
              placeholder={t("profile.confirm_password")}
              value={confirmPw}
              onChange={e => setConfirmPw(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleChangePassword()}
              style={{ width: "100%", padding: "11px 14px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, color: C.text, fontSize: 14, boxSizing: "border-box", fontFamily: FONT }}
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
              {pwLoading ? t("profile.updating") : t("profile.update_password")}
            </button>
          </div>
        )}
      </GlassCard>

      {!isPro && (
        <div
          onClick={onUpgrade}
          style={{
            display: "flex", alignItems: "center", gap: 14,
            background: `linear-gradient(135deg, ${C.proAccent}18, #38B6FF0A)`,
            border: `1px solid ${C.proAccent}33`,
            borderRadius: 18, padding: "16px 18px",
            cursor: "pointer",
          }}
        >
          <div style={{
            width: 42, height: 42, borderRadius: 13, flexShrink: 0,
            background: `linear-gradient(135deg, ${C.proAccent}33, #38B6FF22)`,
            border: `1px solid ${C.proAccent}44`,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="#38B6FF" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 2 }}>{IS_IOS_NATIVE ? "Pro" : t("profile.upgrade_title")}</div>
            <div style={{ fontSize: 12, color: C.muted }}>{IS_IOS_NATIVE ? t("profile.pro_features_ios") : t("profile.upgrade_subtitle")}</div>
          </div>
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={C.faint} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </div>
      )}

      {/* ── PLAID BANK CONNECTION ── */}
      <GlassCard style={{ border: `1px solid ${bankConnected ? C.green + "44" : C.bankConnectBlue + "44"}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: bankConnected ? C.green + "22" : C.bankConnectBlue + "22", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name="bank" size={18} color={bankConnected ? C.green : C.bankConnectBlue} />
          </div>
          <div style={{ flex: 1 }}>
            <div className={bankConnected && bankName ? "ph-mask" : undefined} style={{ fontWeight: 700, fontSize: 15 }}>
              {bankConnected ? bankName || t("profile.bank_connected_name") : t("profile.connect_bank")}
            </div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
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
            <div style={{ background: C.green + "22", border: `1px solid ${C.green}44`, borderRadius: 100, padding: "3px 10px" }}>
              <span style={{ fontSize: 11, color: C.green, fontWeight: 600 }}>{t("profile.active")}</span>
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
              {syncingBank ? t("profile.syncing_btn") : t("profile.sync_transactions")}
            </button>
            {REFRESH_BALANCE_ENABLED && (
              <button onClick={onRefreshBalance} disabled={refreshingBalance || refreshCooldownActive}
                style={{ width: "100%", padding: 13, background: (refreshingBalance || refreshCooldownActive) ? C.bgTertiary : C.cyan + "18", border: `1px solid ${C.cyan}44`, borderRadius: 14, color: (refreshingBalance || refreshCooldownActive) ? C.faint : C.cyan, fontWeight: 600, fontSize: 14, cursor: (refreshingBalance || refreshCooldownActive) ? "not-allowed" : "pointer", fontFamily: FONT, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 8 }}>
                <Icon name="zap" size={15} color={(refreshingBalance || refreshCooldownActive) ? C.faint : C.cyan} strokeWidth={2} />
                {refreshingBalance
                  ? t("profile.refreshing_balance_btn")
                  : refreshCooldownActive
                    ? t("profile.refresh_balance_cooldown_btn", { min: refreshCooldownMinutesLeft })
                    : t("profile.refresh_balance_btn")}
              </button>
            )}
            <button
              onClick={getReconnectToken}
              style={{ width: "100%", padding: 12, background: C.yellow + "18", border: `1px solid ${C.yellow}44`, borderRadius: 14, color: C.yellow, fontWeight: 600, fontSize: 13, cursor: "pointer", fontFamily: FONT, display: "flex", alignItems: "center", justifyContent: "center", gap: 7, marginBottom: 8 }}>
              <Icon name="refresh-cw" size={13} color={C.yellow} strokeWidth={2.5} />
              {t("profile.reconnect_bank")}
            </button>
            <button
              onClick={() => { if (!isPro) { onUpgrade(); return; } getLinkToken(); }}
              style={{ width: "100%", padding: 12, background: isPro ? C.bankConnectBlue + "22" : C.bgTertiary, border: `1px solid ${isPro ? C.bankConnectBlue + "44" : C.border}`, borderRadius: 14, color: isPro ? "#4B8EFF" : C.faint, fontWeight: 600, fontSize: 13, cursor: "pointer", fontFamily: FONT, display: "flex", alignItems: "center", justifyContent: "center", gap: 7 }}>
              {isPro ? <Icon name="plus" size={13} color="#4B8EFF" strokeWidth={2.5} /> : <span>🔒</span>}
              {isPro ? t("profile.add_another_bank", { count: bankCount }) : t("profile.add_another_bank_pro")}
            </button>
          </>
        ) : linkToken ? (
          <PlaidLinkButton linkToken={linkToken} onSuccess={onPlaidSuccess} onExit={() => {}} autoOpen />
        ) : (
          <button onClick={getLinkToken}
            style={{ width: "100%", padding: 14, background: `linear-gradient(135deg,${C.bankConnectBlue},#2F80FF)`, border: "none", borderRadius: 14, color: "#fff", fontWeight: 700, fontSize: 15, cursor: "pointer", fontFamily: FONT, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, boxShadow: `0 4px 20px ${C.bankConnectBlue}66` }}>
            <Icon name="bank" size={17} color="#fff" strokeWidth={2} />
            {t("profile.connect_bank")}
          </button>
        )}

        {!bankConnected && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10, justifyContent: "center" }}>
            <Icon name="lock" size={11} color={C.faint} />
            <span style={{ fontSize: 11, color: C.faint }}>{t("profile.encryption")}</span>
          </div>
        )}
      </GlassCard>

      <GlassCard>
        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 16 }}>{t("profile.financial_settings")}</div>
        <div style={{ color: C.muted, fontSize: 12, fontWeight: 500, marginBottom: 6 }}>{t("profile.monthly_budget")}</div>
        <input style={{ ...inp, marginBottom: 8 }} type="number" value={budget} onChange={e => setBudget(e.target.value)} />
        {avgMonthlyIncome !== null && Number(budget) > avgMonthlyIncome && (
          <div style={{ fontSize: 12, color: C.amber, background: C.amber + "14", border: `1px solid ${C.amber}33`, borderRadius: 10, padding: "8px 12px", marginBottom: 8 }}>
            ⚠️ {t("profile.budget_exceeds_income", { amount: avgMonthlyIncome.toLocaleString() })}
          </div>
        )}
        {budgetSuggestion !== null ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: C.cyan + "12", border: `1px solid ${C.cyan}33`, borderRadius: 10, padding: "9px 12px", marginBottom: 14, gap: 8 }}>
            <div style={{ fontSize: 12, color: C.cyan, fontWeight: 500 }}>
              {t("profile.budget_suggestion", { amount: budgetSuggestion.toLocaleString() })}
            </div>
            <button
              onClick={() => setBudget(budgetSuggestion)}
              style={{ flexShrink: 0, padding: "5px 11px", background: C.cyan + "22", border: `1px solid ${C.cyan}55`, borderRadius: 8, color: C.cyan, fontWeight: 600, fontSize: 11, cursor: "pointer", fontFamily: FONT, whiteSpace: "nowrap" }}>
              {t("profile.use_this")}
            </button>
          </div>
        ) : (
          <div style={{ fontSize: 11, color: C.faint, marginBottom: 14, padding: "7px 10px", background: C.bgTertiary, borderRadius: 9 }}>
            {t("profile.not_enough_data")}
          </div>
        )}
        <div style={{ color: C.muted, fontSize: 12, fontWeight: 500, marginBottom: 6 }}>{t("profile.annual_savings_goal")}</div>
        <input style={{ ...inp, marginBottom: 18 }} type="number" value={goal} onChange={e => setGoal(e.target.value)} />
        <button onClick={async () => { await onSave({ monthly_budget: parseFloat(budget), savings_goal: parseFloat(goal) }); setSaved(true); setTimeout(() => setSaved(false), 2000); }}
          style={{ width: "100%", padding: 14, background: saved ? C.green : `linear-gradient(90deg,${C.cyan},${C.blue})`, border: "none", borderRadius: 12, color: saved ? C.bg : "#fff", fontWeight: 700, cursor: "pointer", transition: "background 0.3s", fontFamily: FONT }}>
          {saved ? t("profile.saved") : t("profile.save_settings")}
        </button>
      </GlassCard>

      <GlassCard>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 15 }}>{t("profile.autopilot_title")}</div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{t("profile.autopilot_subtitle")}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, background: C.green + "18", border: `1px solid ${C.green}33`, borderRadius: 100, padding: "4px 12px" }}>
            <div style={{ width: 6, height: 6, borderRadius: 99, background: C.green }} />
            <span style={{ fontSize: 11, color: C.green, fontWeight: 600 }}>{t("profile.autopilot_active")}</span>
          </div>
        </div>
        {[
          { key: "overspendAlerts",  icon: "bell",         color: C.yellow, title: t("profile.overspend_alerts"),   sub: t("profile.overspend_alerts_sub") },
          { key: "largeTxAlerts",   icon: "alert-circle", color: C.red,    title: t("profile.large_tx_alerts"),    sub: t("profile.large_tx_alerts_sub", { threshold: autopilot.largeTxThreshold }) },
          { key: "lowBalanceAlerts",icon: "dollar",       color: C.green,  title: t("profile.low_balance_alerts"), sub: t("profile.low_balance_alerts_sub", { threshold: autopilot.lowBalanceThreshold }) },
          { key: "unusualSpending", icon: "activity",     color: C.cyan,   title: t("profile.unusual_spending"),   sub: t("profile.unusual_spending_sub") },
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

      {/* ── NOTIFICATIONS & REPORTS ── */}
      <GlassCard>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
          <div style={{ width: 38, height: 38, borderRadius: 11, background: C.cyan + "18", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Icon name="bell" size={17} color={C.cyan} />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{t("profile.notifications_reports_title")}</div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 1 }}>{t("profile.notifications_reports_subtitle")}</div>
          </div>
        </div>

        {/* Email digest frequency */}
        <div style={{ fontSize: 12, color: C.muted, fontWeight: 500, marginBottom: 2 }}>{t("profile.email_digest_frequency")}</div>
        <div style={{ fontSize: 11, color: C.faint, marginBottom: 8 }}>{t("profile.email_digest_frequency_sub")}</div>
        <div style={{ display: "flex", gap: 6, marginBottom: 18 }}>
          {["weekly", "biweekly", "monthly", "off"].map(opt => (
            <button
              key={opt}
              onClick={() => setNotifPrefs(p => ({ ...p, frequency: opt }))}
              style={{ flex: 1, padding: "8px 0", borderRadius: 10, border: `1px solid ${notifPrefs.frequency === opt ? C.cyan + "88" : C.border}`, background: notifPrefs.frequency === opt ? C.cyan + "22" : C.bgTertiary, color: notifPrefs.frequency === opt ? C.cyan : C.muted, fontWeight: 600, fontSize: 11, cursor: "pointer", fontFamily: FONT, textTransform: "capitalize" }}
            >
              {t("profile.freq_" + opt)}
            </button>
          ))}
        </div>

        {/* Content toggles */}
        {notifPrefs.frequency !== "off" && (
          <>
            <div style={{ fontSize: 12, color: C.muted, fontWeight: 500, marginBottom: 10 }}>{t("profile.include_in_digest")}</div>
            {[
              { key: "include_spending",       label: t("profile.digest_spending") },
              { key: "include_balance",         label: t("profile.digest_balance") },
              { key: "include_upcoming_bills",  label: t("profile.digest_upcoming_bills") },
              { key: "include_ai_tip",          label: t("profile.digest_ai_tip") },
              { key: "include_market_update",   label: t("profile.digest_market_update") },
            ].map((item, i, arr) => (
              <div key={item.key}>
                {i > 0 && <div style={{ height: 1, background: C.sep, margin: "10px 0" }} />}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 14, color: C.text }}>{item.label}</span>
                  <Toggle value={notifPrefs[item.key]} onChange={v => setNotifPrefs(p => ({ ...p, [item.key]: v }))} />
                </div>
              </div>
            ))}
            <div style={{ height: 1, background: C.sep, margin: "16px 0" }} />
          </>
        )}

        {/* Excel report frequency — Pro only */}
        <div style={{ height: 1, background: C.sep, margin: "4px 0 20px" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
          <Icon name="file-text" size={13} color={isPro ? C.green : C.faint} />
          <span style={{ fontSize: 12, fontWeight: 500, color: isPro ? C.muted : C.faint }}>
            <span style={{ color: isPro ? C.green : C.faint, fontWeight: 700 }}>{t("profile.excel_label")}</span> {t("profile.excel_report_frequency")}
          </span>
          {!isPro && <span style={{ marginLeft: "auto", fontSize: 10, fontWeight: 700, color: C.faint, background: C.bgTertiary, border: `1px solid ${C.border}`, borderRadius: 99, padding: "2px 7px" }}>{t("common.pro_badge")}</span>}
        </div>
        <div style={{ fontSize: 11, color: C.faint, marginBottom: 8 }}>{t("profile.excel_report_sub")}</div>
        {isPro ? (
          <div style={{ display: "flex", gap: 6, marginBottom: 18 }}>
            {["monthly", "quarterly", "off"].map(opt => (
              <button
                key={opt}
                onClick={() => setNotifPrefs(p => ({ ...p, excel_frequency: opt }))}
                style={{ flex: 1, padding: "8px 0", borderRadius: 10, border: `1px solid ${notifPrefs.excel_frequency === opt ? C.blue + "88" : C.border}`, background: notifPrefs.excel_frequency === opt ? C.blue + "22" : C.bgTertiary, color: notifPrefs.excel_frequency === opt ? C.blue : C.muted, fontWeight: 600, fontSize: 11, cursor: "pointer", fontFamily: FONT, textTransform: "capitalize" }}
              >
                {t("profile.excel_freq_" + opt)}
              </button>
            ))}
          </div>
        ) : (
          <div onClick={onUpgrade} style={{ display: "flex", gap: 6, marginBottom: 18, cursor: "pointer", opacity: 0.45, pointerEvents: "auto" }}>
            {["monthly", "quarterly", "off"].map(opt => (
              <div key={opt} style={{ flex: 1, padding: "8px 0", borderRadius: 10, border: `1px solid ${C.border}`, background: C.bgTertiary, color: C.faint, fontWeight: 600, fontSize: 11, textAlign: "center", textTransform: "capitalize", userSelect: "none" }}>
                {t("profile.excel_freq_" + opt)}
              </div>
            ))}
          </div>
        )}

        <button
          onClick={saveNotifPrefs}
          disabled={notifSaving}
          style={{ width: "100%", padding: 13, background: notifSaved ? C.green : notifSaving ? C.bgTertiary : `linear-gradient(90deg,${C.cyan},${C.blue})`, border: "none", borderRadius: 12, color: notifSaved ? C.bg : notifSaving ? C.faint : "#fff", fontWeight: 700, fontSize: 14, cursor: notifSaving ? "default" : "pointer", transition: "background 0.3s", fontFamily: FONT }}
        >
          {notifSaved ? t("profile.saved") : notifSaving ? t("profile.saving") : t("profile.save_preferences")}
        </button>
      </GlassCard>

      <GlassCard style={{ border: `1px solid ${C.yellow}22` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <Icon name="info" size={15} color={C.yellow} />
          <span style={{ fontWeight: 600, fontSize: 14, color: C.yellow }}>{t("profile.legal_title")}</span>
        </div>
        <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.7 }}>
          {t("profile.legal_broker")}
        </div>
        <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.7, marginTop: 10 }}>
          {t("profile.legal_ai")}
        </div>
      </GlassCard>

      <GlassCard>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
          <Icon name="shield" size={15} color={C.cyan} />
          <span style={{ fontWeight: 600, fontSize: 15 }}>{t("profile.security_title")}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "4px 0" }}>
          <div style={{ width: 38, height: 38, borderRadius: 12, background: C.cyan + "18", border: `1px solid ${C.cyan}33`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Icon name="smartphone" size={17} color={C.cyan} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 500, color: C.text }}>{t("profile.face_id")}</div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{t("profile.face_id_sub")}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
            <div style={{ width: 44, height: 24, borderRadius: 12, background: C.sep, border: `1px solid ${C.border}`, display: "flex", alignItems: "center", padding: "0 3px", cursor: "not-allowed", opacity: 0.5 }}>
              <div style={{ width: 18, height: 18, borderRadius: 9, background: C.muted }} />
            </div>
            <span style={{ fontSize: 10, color: C.faint }}>{t("profile.face_id_coming")}</span>
          </div>
        </div>
      </GlassCard>

      <GlassCard>
        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 14 }}>{t("profile.coming_next")}</div>
        {[
          { label: t("profile.tax_reports"),      color: "#0891B2", icon: "file-text" },
          { label: t("profile.bill_negotiation"), color: "#D97706", icon: "zap" },
          { label: t("profile.credit_score"),     color: "#7C3AED", icon: "award" },
        ].map((item, i, arr) => (
          <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 14, padding: "11px 0", borderBottom: i < arr.length - 1 ? `1px solid ${C.sep}` : "none" }}>
            <div style={{ width: 38, height: 38, borderRadius: 12, background: item.color + "22", border: `1px solid ${item.color}33`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Icon name={item.icon} size={17} color={item.color} />
            </div>
            <span style={{ color: C.text, fontSize: 14, flex: 1 }}>{item.label}</span>
            <span style={{ fontSize: 10, fontWeight: 700, color: C.cyan, background: C.cyan + "18", border: `1px solid ${C.cyan}33`, borderRadius: 20, padding: "2px 8px", letterSpacing: 0.4, flexShrink: 0 }}>{t("profile.soon")}</span>
          </div>
        ))}
      </GlassCard>

      <button
        onClick={() => { if (!isPro) { onUpgrade(); return; } handleExport(); }}
        disabled={isPro && exporting}
        style={{ width: '100%', padding: '14px', background: '#1E293B', color: isPro ? '#7C3AED' : C.faint, border: `1px solid ${isPro ? '#334155' : C.border}`, borderRadius: 12, fontSize: 15, fontWeight: 600, cursor: (isPro && exporting) ? 'not-allowed' : 'pointer', marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, fontFamily: FONT }}
      >
        {!isPro && <span>🔒</span>}
        {isPro && exporting ? t("profile.generating") : t("profile.export_report")}
      </button>

      <button
        onClick={onSignOut}
        style={{ width: "100%", padding: "13px 0", borderRadius: 12, border: `1px solid ${C.border}`, background: "none", color: C.red, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: FONT }}
      >
        {t("profile.sign_out")}
      </button>

      <button
        onClick={() => { setShowDeleteConfirm(true); setDeleteInput(""); }}
        style={{ width: "100%", padding: "11px 0", borderRadius: 12, border: `1px solid ${C.red}33`, background: "none", color: C.red, fontSize: 13, fontWeight: 500, cursor: "pointer", fontFamily: FONT, marginBottom: 16, opacity: 0.7 }}
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
            style={{ width: "100%", maxWidth: 430, background: "#131C2E", borderRadius: "24px 24px 0 0", border: `1px solid ${C.red}33`, borderBottom: "none", padding: "28px 20px 40px", fontFamily: FONT }}
          >
            <div style={{ width: 36, height: 4, borderRadius: 99, background: C.border, margin: "0 auto 24px" }} />
            <div style={{ textAlign: "center", marginBottom: 20 }}>
              <div style={{ fontSize: 32, marginBottom: 10 }}>⚠️</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: C.text, marginBottom: 8 }}>{t("profile.delete_confirm_title")}</div>
              <div style={{ fontSize: 14, color: C.muted, lineHeight: 1.6 }}>
                {t("profile.delete_confirm_warning")}
              </div>
            </div>
            <div style={{ fontSize: 13, color: C.muted, marginBottom: 8 }}>{t("profile.delete_type_prefix")} <strong style={{ color: C.red }}>DELETE</strong> {t("profile.delete_type_suffix")}</div>
            <input
              type="text"
              value={deleteInput}
              onChange={e => setDeleteInput(e.target.value)}
              placeholder="DELETE"
              style={{ width: "100%", padding: "12px 14px", background: C.bg, border: `1px solid ${deleteInput === "DELETE" ? C.red : C.border}`, borderRadius: 12, color: C.text, fontSize: 15, boxSizing: "border-box", fontFamily: FONT, marginBottom: 14 }}
            />
            <button
              onClick={handleDeleteAccount}
              disabled={deleteInput !== "DELETE" || deleting}
              style={{ width: "100%", padding: 15, background: deleteInput === "DELETE" ? C.red : C.bgTertiary, border: "none", borderRadius: 14, color: deleteInput === "DELETE" ? "#fff" : C.faint, fontWeight: 700, fontSize: 15, cursor: deleteInput === "DELETE" ? "pointer" : "not-allowed", fontFamily: FONT, marginBottom: 10, transition: "background 0.2s" }}
            >
              {deleting ? t("profile.deleting") : t("profile.delete_permanently")}
            </button>
            <button
              onClick={() => setShowDeleteConfirm(false)}
              style={{ width: "100%", padding: 13, background: "none", border: `1px solid ${C.border}`, borderRadius: 14, color: C.muted, fontWeight: 500, fontSize: 14, cursor: "pointer", fontFamily: FONT }}
            >
              {t("profile.cancel")}
            </button>
          </div>
        </div>
      )}

      <div style={{ textAlign: "center", padding: "4px 0 8px", fontSize: 12, color: C.faint, fontFamily: FONT }}>
        <a href="/privacy.html" target="_blank" rel="noopener noreferrer" style={{ color: C.faint, textDecoration: "none" }}>{t("profile.privacy_policy")}</a>
        <span style={{ margin: "0 8px" }}>·</span>
        <a href="/terms.html" target="_blank" rel="noopener noreferrer" style={{ color: C.faint, textDecoration: "none" }}>{t("profile.terms_of_service")}</a>
        <span style={{ margin: "0 8px" }}>·</span>
        <a href="/cybersecurity.html" target="_blank" rel="noopener noreferrer" style={{ color: C.faint, textDecoration: "none" }}>{t("profile.cybersecurity_policy")}</a>
      </div>
    </div>
  );
}
