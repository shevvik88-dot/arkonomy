import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import i18n from "../i18n";
import { supabase, SUPABASE_URL, SUPABASE_KEY } from "../utils/supabase";
import { C, FONT } from "../utils/colors";
import { fmt } from "../utils/helpers";
import GlassCard from "./shared/GlassCard";
import Icon from "./shared/Icon";

const ACCOUNTS_CACHE_KEY = "arkonomy_accounts_v1";
const ACCOUNTS_CACHE_TTL = 60 * 60 * 1000; // 1 hour

function getCachedAccounts() {
  try {
    const raw = localStorage.getItem(ACCOUNTS_CACHE_KEY);
    if (!raw) return null;
    const { ts, accounts } = JSON.parse(raw);
    if (Date.now() - ts > ACCOUNTS_CACHE_TTL) return null;
    return accounts;
  } catch { return null; }
}
function setCachedAccounts(accounts) {
  try {
    localStorage.setItem(ACCOUNTS_CACHE_KEY, JSON.stringify({ ts: Date.now(), accounts }));
  } catch {}
}

// ─── No-savings-account empty state (shared by all 3 pickers) ─────────────────
function SavingsAccountEmptyState({ onTrackManually }) {
  const { t } = useTranslation();
  const [showSteps, setShowSteps] = useState(false);
  const steps = [
    { n: 1, text: t("savings.go_to_bank_app") },
    { n: 2, text: t("savings.open_savings_account") },
    { n: 3, text: t("savings.reconnect_bank") },
  ];
  return (
    <div style={{ borderRadius: 14, border: `1px solid ${C.cyan}30`, background: `linear-gradient(135deg,${C.cyan}06,${C.bgTertiary})`, padding: "14px 16px" }}>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 10 }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: C.cyan + "16", border: `1px solid ${C.cyan}30`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 17 }}>
          🏦
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 3 }}>{t("savings.no_savings_account")}</div>
          <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.6 }}>
            {t("savings.no_savings_account_body")}
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
        {showSteps ? t("savings.hide_steps") : t("savings.learn_savings_account")}
      </button>
      <button
        onClick={onTrackManually}
        style={{ width: "100%", marginTop: 6, padding: "8px 0", borderRadius: 9, border: `1px solid ${C.border}`, background: "none", color: C.muted, fontSize: 12, fontWeight: 500, cursor: "pointer", fontFamily: FONT }}
      >
        {t("savings.track_manually_instead")}
      </button>
    </div>
  );
}

function formatForecastDate(date) {
  return date.toLocaleDateString(i18n.language || "en-US", { month: "short", year: "numeric" });
}

function computeGoalForecast(remaining, monthlySurplus, numGoals) {
  if (remaining <= 0) return { type: 'complete' };
  const rate = Math.max(monthlySurplus, 0) * 0.5 / Math.max(numGoals, 1);
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

function SavingsGoalCard({ sv, pct, goalColor, remaining, months, onUpdate, onEdit, onDelete, plaidAccounts = [], getGoalIcon, insight, safeSavingsAmount, maxSavingsAmount, monthlySurplus, numGoals, userId }) {
  const { t } = useTranslation();
  const [mode, setMode] = useState(null);
  const [customAmt, setCustomAmt] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editing, setEditing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editName, setEditName] = useState(sv.name);
  const [editTarget, setEditTarget] = useState(String(sv.target));
  const [editAccountId, setEditAccountId] = useState(sv.plaid_account_id || "");
  const [editAccountName, setEditAccountName] = useState(sv.plaid_account_name || "");
  const [showMoveMoney, setShowMoveMoney] = useState(false);

  const [reminder, setReminder] = useState(null);
  const [loadingReminder, setLoadingReminder] = useState(false);
  const [reminderDays, setReminderDays] = useState([1]);
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
    if (data) {
      const days = Array.isArray(data.day_of_week) ? data.day_of_week : [data.day_of_week];
      setReminderDays(days);
      setReminderAmt(String(data.amount));
    }
    setLoadingReminder(false);
  }

  async function saveReminder() {
    const amt = parseFloat(reminderAmt);
    if (!amt || amt <= 0 || !userId || reminderDays.length === 0) return;
    setSavingReminder(true);
    const { data } = await supabase.from("savings_reminders")
      .upsert({ user_id: userId, goal_id: sv.id, day_of_week: reminderDays, amount: amt, updated_at: new Date().toISOString() },
               { onConflict: "user_id,goal_id" })
      .select().single();
    if (data) {
      setReminder(data);
      setEditingReminder(false);
      const dayLabel = reminderDays.length === 7 ? "every day" : reminderDays.map(d => DAY_NAMES[d]).join(", ");
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (!session) return;
        fetch(`${SUPABASE_URL}/functions/v1/push-notify`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${session.access_token}`, "apikey": SUPABASE_KEY },
          body: JSON.stringify({ user_id: userId, title: "Reminder set! 💰", body: `${dayLabel} — transfer $${amt.toFixed(2)} to ${sv.name}`, icon: "/icon-192.png", tag: "savings-reminder-set" }),
        }).catch(() => {});
      });
    }
    setSavingReminder(false);
  }

  async function cancelReminder() {
    if (!userId) return;
    await supabase.from("savings_reminders").delete().eq("goal_id", sv.id).eq("user_id", userId);
    setReminder(false);
    setReminderDays([1]);
    setReminderAmt("");
    setEditingReminder(false);
  }

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
    if (isLinked) return null;
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
          <div style={{ width: 44, height: 44, minWidth: 44, minHeight: 44, borderRadius: 14, background: goalColor + "22", border: `1px solid ${goalColor}44`, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: `0 0 12px ${goalColor}33`, flexShrink: 0, overflow: "hidden" }}>
            <Icon name={getGoalIcon(sv.name)} size={20} color={goalColor} />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{sv.name}</div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
              {isLinked
                ? <>${displayBalance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span style={{ color: C.green, fontWeight: 600 }}>live</span> / ${fmt(sv.target, 0)}</>
                : <>${fmt(sv.current, 0)} / ${fmt(sv.target, 0)}{months && <span style={{ color: C.cyan, fontWeight: 500 }}> · {t("savings.months_short", { count: months })}</span>}</>
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
          <div style={{ background: goalColor + "22", borderRadius: 100, padding: "4px 10px" }}>
            <span style={{ color: goalColor, fontWeight: 700, fontSize: 13 }}>{displayPct.toFixed(0)}%</span>
          </div>
          <div style={{ position: "relative" }}>
            <button
              onClick={e => { e.stopPropagation(); setMenuOpen(v => !v); }}
              style={{ width: 28, height: 28, borderRadius: 8, background: menuOpen ? C.bgTertiary : "none", border: `1px solid ${menuOpen ? C.border : "transparent"}`, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill={C.faint} stroke="none">
                <circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/>
              </svg>
            </button>
            {menuOpen && (
              <>
                <div style={{ position: "fixed", inset: 0, zIndex: 99 }} onClick={() => setMenuOpen(false)} />
                <div style={{ position: "absolute", top: "calc(100% + 4px)", right: 0, background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, boxShadow: "0 4px 24px rgba(0,0,0,0.45)", minWidth: 130, zIndex: 100, overflow: "hidden" }}>
                  <button
                    onClick={e => { e.stopPropagation(); setEditing(true); setConfirmDelete(false); setEditName(sv.name); setEditTarget(String(sv.target)); setEditAccountId(sv.plaid_account_id || ""); setEditAccountName(sv.plaid_account_name || ""); setMenuOpen(false); }}
                    style={{ width: "100%", padding: "11px 14px", background: "none", border: "none", color: C.text, fontSize: 13, fontWeight: 500, cursor: "pointer", display: "flex", alignItems: "center", gap: 9, fontFamily: FONT, textAlign: "left" }}
                  >
                    <Icon name="edit" size={13} color={C.muted} strokeWidth={2} />
                    {t("savings.edit_goal")}
                  </button>
                  <div style={{ height: 1, background: C.sep, margin: "0 10px" }} />
                  <button
                    onClick={e => { e.stopPropagation(); setConfirmDelete(true); setEditing(false); setMenuOpen(false); }}
                    style={{ width: "100%", padding: "11px 14px", background: "none", border: "none", color: C.red, fontSize: 13, fontWeight: 500, cursor: "pointer", display: "flex", alignItems: "center", gap: 9, fontFamily: FONT, textAlign: "left" }}
                  >
                    <Icon name="trash" size={13} color={C.red} strokeWidth={2} />
                    {t("savings.delete_goal")}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div style={{ height: 10, background: C.bgTertiary, borderRadius: 99, marginBottom: 8, overflow: "hidden", position: "relative" }}>
        {displayPct === 0 && (
          <div style={{ position: "absolute", inset: 0, borderRadius: 99, background: `repeating-linear-gradient(90deg, ${goalColor}28 0px, ${goalColor}28 5px, transparent 5px, transparent 10px)` }} />
        )}
        <div style={{ height: 10, borderRadius: 99, width: `${displayPct}%`, background: displayPct > 0 ? `linear-gradient(90deg,${goalColor}CC,${goalColor},${goalColor}EE)` : 'transparent', transition: "width 0.6s cubic-bezier(.4,0,.2,1)", boxShadow: displayPct > 0 ? `0 0 10px ${goalColor}66, 0 0 20px ${goalColor}33` : 'none' }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: confirmDelete || editing ? 12 : 14 }}>
        <span style={{ color: C.text, fontWeight: 600 }}>
          ${displayBalance.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })} {isLinked ? t("savings.available_label") : t("savings.saved_balance")}
        </span>
        <span style={{ color: C.muted }}>${fmt(displayRemaining, 0)} {t("savings.to_go")}</span>
      </div>

      {confirmDelete && (
        <div style={{ marginBottom: 14, padding: "12px 14px", background: C.red + "0E", border: `1px solid ${C.red}28`, borderRadius: 12, display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ flex: 1, fontSize: 13, color: C.muted }}>{t("transactions.delete_confirm_title")} <strong style={{ color: C.text }}>{sv.name}</strong>?</span>
          <button
            onClick={() => { onDelete(sv.id); }}
            style={{ padding: "6px 14px", borderRadius: 8, border: "none", background: C.red, color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: FONT }}
          >{t("savings.delete")}</button>
          <button
            onClick={() => setConfirmDelete(false)}
            style={{ padding: "6px 12px", borderRadius: 8, border: `1px solid ${C.border}`, background: "none", color: C.muted, fontSize: 12, fontWeight: 500, cursor: "pointer", fontFamily: FONT }}
          >{t("savings.cancel")}</button>
        </div>
      )}

      {editing && (
        <div style={{ marginBottom: 14, padding: "14px", background: C.bgTertiary, borderRadius: 12, border: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.muted, letterSpacing: 0.5, marginBottom: 12, textTransform: "uppercase" }}>{t("savings.edit_goal_title")}</div>

          <div style={{ fontSize: 12, color: C.muted, marginBottom: 4 }}>{t("savings.goal_name")}</div>
          <input
            value={editName}
            onChange={e => setEditName(e.target.value)}
            style={{ width: "100%", padding: "10px 12px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, color: C.text, fontSize: 13, outline: "none", boxSizing: "border-box", fontFamily: FONT, marginBottom: 10 }}
          />

          <div style={{ fontSize: 12, color: C.muted, marginBottom: 4 }}>{t("savings.target_amount")}</div>
          <input
            type="number"
            value={editTarget}
            onChange={e => setEditTarget(e.target.value)}
            style={{ width: "100%", padding: "10px 12px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, color: C.text, fontSize: 13, outline: "none", boxSizing: "border-box", fontFamily: FONT, marginBottom: 12 }}
          />

          {plaidAccounts.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: C.muted, marginBottom: 6 }}>
                {t("savings.savings_account_optional")}
              </div>
              {(() => {
                const cardSavings = plaidAccounts.filter(a => a.subtype === "savings" || a.type === "savings");
                return cardSavings.length > 0 ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                    <div onClick={() => { setEditAccountId(""); setEditAccountName(""); }}
                      style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 8, border: `1px solid ${!editAccountId ? C.cyan + "55" : C.border}`, background: !editAccountId ? C.cyan + "08" : C.bg, cursor: "pointer" }}>
                      <span style={{ fontSize: 12, color: !editAccountId ? C.text : C.muted }}>{t("savings.track_manually")}</span>
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

          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => {
                if (!editName.trim() || !editTarget) return;
                onEdit(sv.id, { name: editName.trim(), target: parseFloat(editTarget), plaid_account_id: editAccountId || null, plaid_account_name: editAccountName || null });
                setEditing(false);
              }}
              style={{ flex: 1, padding: "9px 0", borderRadius: 10, border: "none", background: `linear-gradient(90deg,${C.green},#00A67E)`, color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: FONT }}
            >{t("savings.save")}</button>
            <button
              onClick={() => setEditing(false)}
              style={{ flex: 1, padding: "9px 0", borderRadius: 10, border: `1px solid ${C.border}`, background: "none", color: C.muted, fontSize: 13, fontWeight: 500, cursor: "pointer", fontFamily: FONT }}
            >{t("savings.cancel")}</button>
          </div>
        </div>
      )}

      {!confirmDelete && !editing && (() => {
        const fc = computeGoalForecast(displayRemaining, monthlySurplus, numGoals ?? 1);
        if (fc.type === 'complete') return null;
        const onTrack = fc.type === 'on_track';
        const fcColor = onTrack ? C.green : C.yellow;
        return (
          <div style={{ marginBottom: 12, padding: '10px 12px', background: fcColor + '0D', border: `1px solid ${fcColor}28`, borderRadius: 11, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill={fcColor} stroke="none" style={{ flexShrink: 0, marginTop: 1 }}>
              <path d="M12 1.5l2.09 5.26L19.5 7.5l-3.82 3.73.9 5.27L12 13.77l-4.58 2.73.9-5.27L4.5 7.5l5.41-.74z"/>
            </svg>
            <span style={{ fontSize: 12, color: fcColor, lineHeight: 1.55 }}>
              {onTrack
                ? t("savings.on_track_goal", { date: formatForecastDate(fc.date) })
                : t("savings.not_on_track", { shortfall: fmt(fc.shortfall, 0), date: formatForecastDate(fc.targetDate) })
              }
            </span>
          </div>
        );
      })()}

      {isLinked && (
        <div style={{ marginBottom: 10, padding: "8px 12px", background: C.green + "0A", border: `1px solid ${C.green}20`, borderRadius: 10, display: "flex", alignItems: "center", gap: 6 }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={C.green} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
          <span style={{ fontSize: 11, color: C.green, fontWeight: 600 }}>{t("savings.money_stays")}</span>
        </div>
      )}
      <button
        onClick={openMoveMoney}
        style={{ width: "100%", padding: "11px 16px", background: C.bgTertiary, border: `1px solid ${C.border}`, borderRadius: 11, color: C.text, fontWeight: 600, fontSize: 14, cursor: "pointer", fontFamily: FONT, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        {isLinked ? t("savings.move_money") : t("savings.set_reminder")}
      </button>

      {showMoveMoney && (
        <div onClick={() => setShowMoveMoney(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)", zIndex: 200, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
          <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 430, background: C.card, borderRadius: "22px 22px 0 0", border: `1px solid ${C.border}`, padding: 24, paddingBottom: 36, fontFamily: FONT, maxHeight: "90vh", overflowY: "auto" }}>
            <div style={{ width: 32, height: 4, background: "rgba(255,255,255,0.11)", borderRadius: 2, margin: "0 auto 20px" }} />

            <div style={{ width: 44, height: 44, borderRadius: 14, background: C.green + "18", border: `1px solid ${C.green}33`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={C.green} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="22" x2="21" y2="22"/><line x1="6" y1="18" x2="6" y2="11"/><line x1="10" y1="18" x2="10" y2="11"/><line x1="14" y1="18" x2="14" y2="11"/><line x1="18" y1="18" x2="18" y2="11"/><polygon points="12 2 20 7 4 7"/></svg>
            </div>
            <div style={{ fontSize: 18, fontWeight: 800, color: C.text, textAlign: "center", marginBottom: 8 }}>{isLinked ? t("savings.move_money_title") : t("savings.set_reminder_title")}</div>
            {isLinked && (
              <>
                <div style={{ fontSize: 13, color: C.muted, textAlign: "center", lineHeight: 1.65, marginBottom: 20 }}>
                  {t("savings.transfer_in_app", { bank: linkedAccount.institution_name || sv.plaid_account_name || "bank" })}
                </div>

                <div style={{ background: C.bgSecondary, borderRadius: 12, padding: "12px 14px", marginBottom: 20, border: `1px solid ${C.border}` }}>
                  <div style={{ fontSize: 11, color: C.faint, fontWeight: 600, letterSpacing: 0.5, marginBottom: 6 }}>{t("savings.linked_account")}</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{sv.plaid_account_name}</div>
                  {linkedAccount.balance_available != null && (
                    <div style={{ fontSize: 12, color: C.muted, marginTop: 3 }}>
                      Available: <strong style={{ color: C.green }}>${linkedAccount.balance_available.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
                    </div>
                  )}
                </div>
              </>
            )}

                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 10 }}>{t("savings.set_weekly_reminder")}</div>
                  {!isLinked && (
                    <div style={{ background: C.bgSecondary, border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 12px", marginBottom: 14, fontSize: 12, color: C.faint, lineHeight: 1.55 }}>
                      {t("savings.no_real_money")}
                    </div>
                  )}

                  {loadingReminder ? (
                    <div style={{ fontSize: 12, color: C.faint, textAlign: "center", padding: "12px 0" }}>{t("savings.loading")}</div>
                  ) : reminder && !editingReminder ? (
                    <div style={{ background: C.green + "0D", border: `1px solid ${C.green}30`, borderRadius: 12, padding: "12px 14px" }}>
                      <div style={{ fontSize: 12, color: C.faint, fontWeight: 600, letterSpacing: 0.5, marginBottom: 4 }}>{t("savings.active_reminder")}</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 10 }}>
                        {(() => {
                          const days = Array.isArray(reminder.day_of_week) ? reminder.day_of_week : [reminder.day_of_week];
                          const label = days.length === 7 ? "Every day" : days.map(d => DAY_NAMES[d]).join(", ");
                          return `${label} · $${Number(reminder.amount).toFixed(2)}`;
                        })()}
                      </div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button onClick={() => {
                          const days = Array.isArray(reminder.day_of_week) ? reminder.day_of_week : [reminder.day_of_week];
                          setReminderDays(days);
                          setEditingReminder(true);
                        }}
                          style={{ flex: 1, padding: "8px 0", borderRadius: 9, border: `1px solid ${C.border}`, background: C.bgTertiary, color: C.muted, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: FONT }}>
                          {t("savings.edit")}
                        </button>
                        <button onClick={cancelReminder}
                          style={{ flex: 1, padding: "8px 0", borderRadius: 9, border: `1px solid ${C.red}33`, background: C.red + "0D", color: C.red, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: FONT }}>
                          {t("savings.cancel_reminder")}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ background: C.bgTertiary, borderRadius: 12, padding: "14px" }}>
                      <div style={{ fontSize: 12, color: C.muted, marginBottom: 8 }}>{t("savings.remind_every")}</div>
                      <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
                        {DAYS.map(d => {
                          const sel = reminderDays.includes(d.dow);
                          return (
                            <button key={d.dow} onClick={() => setReminderDays(prev =>
                              sel ? (prev.length > 1 ? prev.filter(x => x !== d.dow) : prev) : [...prev, d.dow]
                            )}
                              style={{ flex: 1, padding: "7px 0", borderRadius: 9, border: `1px solid ${sel ? C.cyan + "66" : C.border}`, background: sel ? C.cyan + "18" : "transparent", color: sel ? C.cyan : C.muted, fontSize: 11, fontWeight: sel ? 700 : 400, cursor: "pointer", fontFamily: FONT }}>
                              {d.label}
                            </button>
                          );
                        })}
                      </div>

                      <div style={{ fontSize: 12, color: C.muted, marginBottom: 6 }}>{t("savings.remind_transfer")}</div>
                      <div style={{ position: "relative", marginBottom: 14 }}>
                        <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", fontSize: 15, fontWeight: 700, color: C.muted, pointerEvents: "none" }}>$</span>
                        <input type="number" placeholder="0.00" value={reminderAmt} onChange={e => setReminderAmt(e.target.value)}
                          style={{ width: "100%", padding: "11px 12px 11px 26px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, color: C.text, fontSize: 15, fontWeight: 600, outline: "none", boxSizing: "border-box", fontFamily: FONT }} />
                      </div>

                      <button onClick={saveReminder} disabled={savingReminder || !reminderAmt}
                        style={{ width: "100%", padding: "11px 0", borderRadius: 10, border: "none", background: (!reminderAmt || savingReminder) ? C.bgSecondary : `linear-gradient(90deg,${C.cyan},${C.blue})`, color: (!reminderAmt || savingReminder) ? C.faint : "#000", fontSize: 13, fontWeight: 700, cursor: (!reminderAmt || savingReminder) ? "default" : "pointer", fontFamily: FONT }}>
                        {savingReminder ? t("savings.saving") : t("savings.set_reminder")}
                      </button>
                      {editingReminder && (
                        <button onClick={() => setEditingReminder(false)}
                          style={{ width: "100%", marginTop: 8, padding: "9px 0", borderRadius: 10, border: `1px solid ${C.border}`, background: "none", color: C.muted, fontSize: 12, cursor: "pointer", fontFamily: FONT }}>
                          {t("savings.cancel")}
                        </button>
                      )}
                    </div>
                  )}
                </div>

                <button onClick={() => setShowMoveMoney(false)} style={{ width: "100%", padding: 14, background: C.bgSecondary, border: `1px solid ${C.border}`, borderRadius: 14, color: C.muted, fontWeight: 500, fontSize: 14, cursor: "pointer", fontFamily: FONT }}>
                  {t("savings.got_it")}
                </button>
              </div>
            </div>
          )}

      {!isLinked && (
        <div style={{ marginTop: 10, paddingBottom: 14 }}>
          <div style={{ fontSize: 11, color: C.faint, marginBottom: 6 }}>{t("savings.log_transfer")}</div>
          <div style={{ display: "flex", gap: 6 }}>
            {[10, 25, 50, 100].map(amt => (
              <button key={amt} onClick={() => onUpdate(sv.id, Number(sv.current) + amt)}
                style={{ flex: 1, padding: "8px 0", background: goalColor + "15", border: `1px solid ${goalColor}40`, borderRadius: 10, color: goalColor + "CC", cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: FONT }}>
                +${amt}
              </button>
            ))}
          </div>
        </div>
      )}
    </GlassCard>
  );
}

const CRYPTO_ORANGE = "#F97316";

function AssetAllocationBar({ plaidAccounts, totalSaved }) {
  const { t } = useTranslation();
  const cashTotal = plaidAccounts
    .filter(a => a.type === 'depository')
    .reduce((s, a) => s + Math.max(a.balance_available ?? a.balance_current ?? 0, 0), 0);
  const stocksTotal = plaidAccounts
    .filter(a => a.type === 'investment' && a.subtype !== 'crypto' && a.subtype !== 'digital currency')
    .reduce((s, a) => s + Math.max(a.balance_current ?? 0, 0), 0);
  const cryptoTotal = plaidAccounts
    .filter(a => a.subtype === 'crypto' || a.subtype === 'digital currency')
    .reduce((s, a) => s + Math.max(a.balance_current ?? 0, 0), 0);
  const goalsTotal = Math.max(totalSaved, 0);

  const total = cashTotal + stocksTotal + cryptoTotal + goalsTotal;
  if (total <= 0) return null;

  const allSegments = [
    { label: t("savings.cash"),          value: cashTotal,   color: C.blue   },
    { label: t("savings.stocks"),        value: stocksTotal, color: C.green  },
    { label: t("savings.crypto"),        value: cryptoTotal, color: CRYPTO_ORANGE },
    { label: t("savings.savings_goals"), value: goalsTotal,  color: C.purple },
  ];
  const segments = allSegments.filter(s => s.value > 0).map(s => ({
    ...s,
    pct: (s.value / total) * 100,
  }));

  return (
    <div style={{ background: C.card, borderRadius: 20, padding: 20, border: `1px solid ${C.border}` }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
        <div style={{ fontSize: 10, color: C.faint, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase' }}>{t("savings.asset_allocation")}</div>
      </div>
      <div style={{ fontSize: 26, fontWeight: 800, color: C.text, letterSpacing: -0.5, marginBottom: 16 }}>
        ${fmt(total, 0)}
        <span style={{ fontSize: 13, fontWeight: 400, color: C.muted, marginLeft: 8, letterSpacing: 0 }}>{t("savings.net_worth")}</span>
      </div>

      <div style={{ height: 20, borderRadius: 99, overflow: 'hidden', display: 'flex', marginBottom: 18, background: C.bgTertiary }}>
        {segments.map(s => (
          <div key={s.label} style={{ width: `${s.pct}%`, background: s.color, minWidth: s.pct > 0 ? 6 : 0 }} />
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 16px' }}>
        {allSegments.map(s => {
          const pct = total > 0 ? Math.round((s.value / total) * 100) : 0;
          return (
            <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 10, height: 10, borderRadius: 3, background: s.color, flexShrink: 0, opacity: s.value > 0 ? 1 : 0.25 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 10, color: C.faint, fontWeight: 500, letterSpacing: 0.3, marginBottom: 1 }}>{s.label}</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: s.value > 0 ? C.text : C.faint }}>
                  ${fmt(s.value, 0)}
                </div>
              </div>
              <div style={{
                fontSize: 11, fontWeight: 700,
                color: s.value > 0 ? s.color : C.faint,
                background: s.value > 0 ? s.color + '18' : 'transparent',
                border: `1px solid ${s.value > 0 ? s.color + '33' : C.border}`,
                borderRadius: 99, padding: '2px 7px', flexShrink: 0,
              }}>
                {pct}%
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function Savings({ savings, onAdd, onUpdate, onEdit, onDelete, totalIncome, totalSpent, transactions, insight, onInsightAction, onInvestAlpaca, isPro, isTrial, onUpgrade, alpacaConnected, onConnectAlpaca, bankConnected, userId, InsightCard }) {
  const { t } = useTranslation();
  const [showAdd, setShowAdd]               = useState(false);
  const goalFormRef = useRef(null);
  const [selectedPreset, setSelectedPreset] = useState(null);
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
  const [accountLinkMode, setAccountLinkMode] = useState("auto");

  async function fetchPlaidAccounts() {
    const cached = getCachedAccounts();
    if (cached) { setPlaidAccounts(cached); return; }

    setLoadingAccounts(true);
    setAccountsError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setLoadingAccounts(false); return; }
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
      if (!res.ok) { setAccountsError(d.error || d.message || `HTTP ${res.status}`); return; }
      if (d.accounts) {
        setPlaidAccounts(d.accounts);
        setCachedAccounts(d.accounts);
      }
    } catch (err) {
      setAccountsError(String(err));
    } finally {
      setLoadingAccounts(false);
    }
  }

  useEffect(() => {
    if (bankConnected) fetchPlaidAccounts();
  }, [bankConnected]);

  const savingsAccounts = plaidAccounts.filter(a => a.subtype === "savings" || a.type === "savings");

  const BASE_MONTHLY = totalSpent > 0 ? Math.floor(totalSpent * 0.03 * 100) / 100 : 26;
  const roundupMonth = parseFloat((BASE_MONTHLY * roundupMultiplier).toFixed(2));
  const roundupTotal = parseFloat((roundupMonth * 3.2).toFixed(2));
  const roundupYearly = Math.round(roundupMonth * 12 / 10) * 10;

  const inp = { width: "100%", padding: "12px 14px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 12, color: C.text, fontSize: 14, outline: "none", boxSizing: "border-box", marginBottom: 10, fontFamily: FONT };

  const totalSaved     = savings.reduce((s, sv) => s + Number(sv.current), 0);
  const monthlySurplus = totalIncome - totalSpent;

  const availableBalance = Math.max(monthlySurplus, 0);
  const safetyBuffer = Math.min(500, availableBalance * 0.5);
  const safeAmount = Math.max(availableBalance - safetyBuffer, 0);

  const SAFE_MIN = 200;
  const SAFE_MAX = 400;
  const recommendedAmount = safeAmount <= 0
    ? 0
    : safeAmount < 800
      ? Math.min(Math.max(Math.round(safeAmount * 0.6), 50), 100)
      : Math.min(Math.max(Math.round(safeAmount * 0.6), SAFE_MIN), SAFE_MAX);

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
      <AssetAllocationBar plaidAccounts={plaidAccounts} totalSaved={totalSaved} />

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h2 style={{ margin: "0 0 2px", fontSize: 26, fontWeight: 700 }}>{t("savings.savings_goals")}</h2>
          <div style={{ fontSize: 13, color: C.muted }}>{t("savings.track_progress")}</div>
        </div>
        <button onClick={() => { const next = !showAdd; setShowAdd(next); if (next) setTimeout(() => goalFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 60); }} style={{ background: C.green, border: "none", borderRadius: 22, padding: "9px 16px", color: "#000", fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 5, fontSize: 14, fontFamily: FONT, boxShadow: `0 0 20px ${C.green}44` }}>
          <Icon name="plus" size={14} color="#000" strokeWidth={2.5} /> Goal
        </button>
      </div>

      {InsightCard && insight && ['savings_opportunity', 'goal_off_track'].includes(insight.type) && monthlySurplus > 0 && savings.length > 0 && (insight.type !== 'goal_off_track' || savings.some(sv => sv.id === insight.data?.goalId && Number(sv.target) < 50000)) && (
        <InsightCard insight={insight} onAction={onInsightAction} />
      )}

      {(totalSaved > 0 || monthlySurplus > 0) && (
        <div style={{ background: monthlySurplus < 0 ? "linear-gradient(135deg,#2A0D0D,#261426)" : "linear-gradient(135deg,#0D2A1F,#0B1426)", borderRadius: 20, padding: 20, border: `1px solid ${monthlySurplus < 0 ? C.red : C.green}30` }}>
          <div style={{ display: "flex", marginBottom: safeSavingsAmount > 0 ? 14 : 0 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 10, color: C.faint, fontWeight: 500, letterSpacing: 0.5, marginBottom: 4 }}>{t("savings.total_saved")}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: C.green }}>${fmt(totalSaved, 0)}</div>
            </div>
            <div style={{ flex: 1, paddingLeft: 20, borderLeft: `1px solid ${C.sep}` }}>
              <div style={{ fontSize: 10, color: monthlySurplus < 0 ? C.red : C.faint, fontWeight: 500, letterSpacing: 0.5, marginBottom: 4 }}>{monthlySurplus < 0 ? t("savings.monthly_deficit") : t("savings.monthly_surplus")}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: monthlySurplus >= 0 ? C.green : C.red }}>${fmt(Math.abs(monthlySurplus), 0)}</div>
            </div>
          </div>
          {safeSavingsAmount > 0 && maxSavingsAmount > 0 && (
            <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: 12, padding: "10px 14px", fontSize: 12, color: C.muted, lineHeight: 1.6 }}>
              {t("savings.move_tip", { max: fmt(maxSavingsAmount, 0), safe: fmt(safeSavingsAmount, 0), safeMax: fmt(Math.min(safeSavingsAmount + 100, maxSavingsAmount), 0) })}
            </div>
          )}
        </div>
      )}

      {false && <div style={{ background: "linear-gradient(135deg,#0D2233,#0B1426)", borderRadius: 20, padding: 20, border: `1px solid ${C.cyan}30`, position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: -20, right: -20, width: 100, height: 100, borderRadius: "50%", background: C.cyan + "0A", pointerEvents: "none" }} />
        {!alpacaConnected && (
          (!isPro || isTrial) ? (
            <div style={{ position: "relative" }}>
              <div style={{ filter: "blur(3px)", pointerEvents: "none", userSelect: "none", textAlign: "center", padding: "8px 0 4px" }}>
                <div style={{ width: 44, height: 44, borderRadius: 14, background: C.cyan + "18", border: `1px solid ${C.cyan}33`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px" }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={C.cyan} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>
                  </svg>
                </div>
                <div style={{ fontWeight: 700, fontSize: 15, color: C.text, marginBottom: 6 }}>{t("savings.spare_change_title")}</div>
                <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.6, marginBottom: 16 }}>
                  {t("savings.spare_change_connect")}
                </div>
                <button style={{ width: "100%", padding: "12px 16px", background: `linear-gradient(135deg,#7B5EA7,#4B6CB7)`, border: "none", borderRadius: 12, color: "#fff", fontWeight: 700, fontSize: 14, fontFamily: FONT, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, boxShadow: "0 4px 16px rgba(75,108,183,0.35)" }}>
                  {t("savings.connect_alpaca")}
                </button>
              </div>
              <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, pointerEvents: "none" }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: C.text, background: C.card, padding: "5px 14px", borderRadius: 20, border: `1px solid ${C.border}`, pointerEvents: "none" }}>{t("savings.pro_only")}</span>
                <button onClick={onUpgrade} style={{ padding: "11px 22px", background: `linear-gradient(135deg,#7C6BFF,#38B6FF)`, border: "none", borderRadius: 12, color: "#000", fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: FONT, pointerEvents: "all" }}>
                  {t("savings.upgrade_pro")}
                </button>
              </div>
            </div>
          ) : (
            <div style={{ textAlign: "center", padding: "8px 0 4px" }}>
              <div style={{ width: 44, height: 44, borderRadius: 14, background: C.cyan + "18", border: `1px solid ${C.cyan}33`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px" }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={C.cyan} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>
                </svg>
              </div>
              <div style={{ fontWeight: 700, fontSize: 15, color: C.text, marginBottom: 6 }}>{t("savings.spare_change_title")}</div>
              <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.6, marginBottom: 16 }}>
                {t("savings.spare_change_connect")}
              </div>
              <button onClick={() => onConnectAlpaca?.()}
                style={{ width: "100%", padding: "12px 16px", background: `linear-gradient(135deg,#7B5EA7,#4B6CB7)`, border: "none", borderRadius: 12, color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: FONT, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, boxShadow: "0 4px 16px rgba(75,108,183,0.35)" }}>
                {t("savings.connect_alpaca")}
              </button>
            </div>
          )
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
              <div style={{ fontWeight: 700, fontSize: 15 }}>{t("savings.spare_change_from")}</div>
              {roundupEnabled ? (
                <div style={{ fontSize: 12, color: C.green, marginTop: 2, fontWeight: 500 }}>{t("savings.roundups_on")}</div>
              ) : (
                <div style={{ marginTop: 2 }}>
                  <div style={{ fontSize: 12, color: C.muted, fontWeight: 500 }}>{t("savings.roundups_off")}</div>
                  <div style={{ fontSize: 11, color: C.faint, marginTop: 1 }}>{t("savings.turn_on_roundups")}</div>
                </div>
              )}
            </div>
          </div>
          <div onClick={() => { if (!isPro || isTrial) { onUpgrade(); return; } setRoundupEnabled(v => !v); }} style={{ width: 44, height: 26, borderRadius: 99, background: roundupEnabled ? C.cyan + "33" : C.bgTertiary, border: `1px solid ${roundupEnabled ? C.cyan + "66" : C.border}`, position: "relative", cursor: "pointer", transition: "all 0.22s", flexShrink: 0 }}>
            <div style={{ position: "absolute", top: 3, left: roundupEnabled ? 20 : 3, width: 18, height: 18, borderRadius: 99, background: roundupEnabled ? C.cyan : C.faint, transition: "left 0.2s", boxShadow: "0 1px 4px rgba(0,0,0,0.4)" }} />
          </div>
        </div>

        <div style={{ display: "flex", gap: 0, marginBottom: 12, paddingBottom: 12, borderBottom: `1px solid ${C.sep}` }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, color: C.faint, fontWeight: 500, letterSpacing: 0.5, marginBottom: 3 }}>{t("savings.this_month")}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: roundupEnabled ? C.cyan : C.faint }}>{roundupEnabled ? `$${fmt(roundupMonth, 2)}` : "$0.00"}</div>
            <div style={{ fontSize: 11, color: C.faint, marginTop: 2 }}>{t("savings.based_on_purchases")}</div>
          </div>
          <div style={{ flex: 1, paddingLeft: 16, borderLeft: `1px solid ${C.sep}` }}>
            <div style={{ fontSize: 10, color: C.faint, fontWeight: 500, letterSpacing: 0.5, marginBottom: 3 }}>{t("savings.all_time")}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: roundupEnabled ? C.green : C.faint }}>{roundupEnabled ? `$${fmt(roundupTotal, 2)}` : "$0.00"}</div>
          </div>
        </div>

        {roundupMonth >= 1 && monthlySurplus > 0 && (
          <button onClick={() => { if (!isPro || isTrial) { onUpgrade(); return; } if (!alpacaConnected) { onConnectAlpaca?.(); return; } setShowAlpacaSheet(true); }}
            style={{ width: "100%", padding: "12px 16px", marginBottom: 12, background: isPro && alpacaConnected ? `linear-gradient(135deg, #7B5EA7, #4B6CB7)` : "#1E2D45", border: isPro && alpacaConnected ? "none" : `1px solid #2D3F58`, borderRadius: 11, color: isPro && alpacaConnected ? "#fff" : "#7A8BA8", fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: FONT, letterSpacing: -0.2, boxShadow: isPro && alpacaConnected ? "0 4px 16px rgba(75,108,183,0.35)" : "none", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, transition: "transform 0.12s ease" }}
            onPointerDown={e => { e.currentTarget.style.transform = "scale(0.98)"; }}
            onPointerUp={e => { e.currentTarget.style.transform = "scale(1.02)"; setTimeout(() => { e.currentTarget.style.transform = ""; }, 120); }}
            onPointerLeave={e => { e.currentTarget.style.transform = ""; }}
          >
            {(!isPro || isTrial)
              ? <><span>🔒</span> {t("savings.invest_alpaca_pro")}</>
              : !alpacaConnected
              ? <><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>{t("savings.connect_to_invest")}</>
              : <><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>{t("savings.invest_amount", { amount: Math.floor(roundupMonth) })}</>
            }
          </button>
        )}

        {monthlySurplus >= 0 ? (
          <>
            <div style={{ fontSize: 11, color: C.faint, marginBottom: 12 }}>{t("savings.small_amounts")}</div>

            <div style={{ display: "flex", alignItems: "flex-start", gap: 7, marginBottom: 12, fontSize: 12, opacity: 1 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={roundupEnabled ? "#12D18E" : "#4A5E7A"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
                <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>
              </svg>
              {roundupEnabled ? (
                <span style={{ color: C.muted }}>{t("savings.roundup_proj_on", { monthly: currentProjMonthly, yearly: currentProjYearly })}</span>
              ) : (
                <span style={{ color: C.muted }}>{t("savings.roundup_proj_off", { monthly: currentProjMonthly, yearly: currentProjYearly })}</span>
              )}
            </div>

            <div style={{ fontSize: 12, color: C.muted, marginBottom: 8 }}>{t("savings.multiplier")}</div>
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
                ? t("savings.at_mult_on", { n: roundupMultiplier, monthly: currentProjMonthly })
                : t("savings.at_mult_off", { n: roundupMultiplier, monthly: currentProjMonthly })}
            </div>
          </>
        ) : (
          <div style={{ padding: "10px 14px", background: C.bgTertiary, border: `1px solid ${C.border}`, borderRadius: 12, fontSize: 12, color: C.muted, lineHeight: 1.5 }}>
            {t("savings.once_balanced")}
          </div>
        )}
        </>}
      </div>}

      {showAlpacaSheet && (
        <div onClick={() => setShowAlpacaSheet(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)", zIndex: 150, display: "flex", alignItems: "flex-end", maxWidth: 430, margin: "0 auto" }}>
          <div onClick={e => e.stopPropagation()} style={{ width: "100%", background: C.card, borderRadius: "22px 22px 0 0", border: `1px solid ${C.border}`, padding: 24, fontFamily: FONT }}>
            <div style={{ width: 32, height: 4, background: "rgba(255,255,255,0.11)", borderRadius: 2, margin: "0 auto 20px" }} />
            <div style={{ textAlign: "center", marginBottom: 20 }}>
              <div style={{ fontSize: 36, fontWeight: 800, color: C.text, letterSpacing: -1 }}>${Math.floor(roundupMonth)}</div>
              <div style={{ fontSize: 13, color: C.muted, marginTop: 4 }}>{t("savings.to_invest")}</div>
            </div>
            <div style={{ background: C.bgSecondary, borderRadius: 14, padding: "14px 16px", marginBottom: 20, border: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.65 }}>
                {t("savings.roundup_body")}
              </div>
            </div>
            <button onClick={() => { setShowAlpacaSheet(false); onInvestAlpaca?.({ roundUpMonthly: roundupMonth }); }} style={{ width: "100%", padding: 15, marginBottom: 10, background: `linear-gradient(135deg, #7B5EA7, #4B6CB7)`, border: "none", borderRadius: 14, color: "#fff", fontWeight: 700, fontSize: 15, cursor: "pointer", fontFamily: FONT, boxShadow: "0 4px 20px rgba(75,108,183,0.35)" }}>
              {t("savings.confirm_investment")}
            </button>
            <button onClick={() => setShowAlpacaSheet(false)} style={{ width: "100%", padding: 14, background: C.bgSecondary, border: `1px solid ${C.border}`, borderRadius: 14, color: C.muted, fontWeight: 500, fontSize: 14, cursor: "pointer", fontFamily: FONT }}>
              {t("savings.cancel")}
            </button>
          </div>
        </div>
      )}

      {showAdd && savings.length > 0 && (
        <div ref={goalFormRef}>
        <GlassCard>
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 14 }}>{t("savings.new_goal")}</div>
          <input style={inp} placeholder={t("savings.goal_placeholder")} value={newName} onChange={e => setNewName(e.target.value)} />
          <input style={inp} type="number" placeholder={t("savings.target_amount_label")} value={newTarget} onChange={e => setNewTarget(e.target.value)} />

          {bankConnected && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 12, color: C.muted, fontWeight: 500, marginBottom: 6 }}>
                {t("savings.savings_account_label")}
              </div>
              {loadingAccounts ? (
                <div style={{ fontSize: 12, color: C.faint, padding: "10px 14px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 12 }}>{t("savings.loading_accounts")}</div>
              ) : accountsError ? (
                <div style={{ fontSize: 12, color: C.red, padding: "10px 14px", background: C.red + "0A", border: `1px solid ${C.red}22`, borderRadius: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>{t("savings.could_not_load_accounts", { error: accountsError })}</span>
                  <button onClick={fetchPlaidAccounts} style={{ background: "none", border: "none", color: C.cyan, fontSize: 12, cursor: "pointer", fontFamily: FONT, fontWeight: 600, marginLeft: 8 }}>{t("savings.retry")}</button>
                </div>
              ) : savingsAccounts.length > 0 ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div onClick={() => { setNewAccountId(""); setNewAccountName(""); }}
                    style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 10, border: `1px solid ${!newAccountId ? C.cyan + "55" : C.border}`, background: !newAccountId ? C.cyan + "08" : C.bg, cursor: "pointer" }}>
                    <div style={{ width: 28, height: 28, borderRadius: 8, background: C.bgTertiary, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={C.faint} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </div>
                    <span style={{ fontSize: 13, color: !newAccountId ? C.text : C.muted }}>{t("savings.track_manually_no_link")}</span>
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
                  <span style={{ fontSize: 12, color: C.muted, fontWeight: 500 }}>{t("savings.tracking_manually")}</span>
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
          }} style={{ width: "100%", padding: 14, background: `linear-gradient(90deg,${C.green},#00A67E)`, border: "none", borderRadius: 13, color: "#000", fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: FONT }}>
            {t("savings.add_goal_btn")}
          </button>
        </GlassCard>
        </div>
      )}

      {savings.length === 0 ? (
        <GlassCard>
          <div style={{ textAlign: "center", padding: "16px 0 4px" }}>
            <div style={{ width: 56, height: 56, borderRadius: 18, background: C.green + "10", border: `1px solid ${C.green}22`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px", animation: "goalFloat 3s ease-in-out infinite" }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={C.green} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>
              </svg>
            </div>
            <style>{`@keyframes goalFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}`}</style>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>{t("savings.start_first_goal")}</div>
            <div style={{ fontSize: 13, color: C.muted, marginBottom: 20, lineHeight: 1.5 }}>{t("savings.build_first")}<br /><span style={{ color: C.faint, fontSize: 12 }}>{t("savings.small_savings")}</span></div>
            {(() => {
              const PRESETS = [
                { name: t("savings.emergency_fund"), target: 1000, icon: "lock",   color: C.green, accentSvg: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.green} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg> },
                { name: t("savings.vacation"),       target: 2000, icon: "target", color: C.cyan,  accentSvg: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.cyan}  strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/></svg> },
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
                            <div style={{ fontSize: 12, color: C.muted, marginTop: 1 }}>{t("savings.target_label", { amount: p.target.toLocaleString() })}</div>
                          </div>
                        </div>
                        {isSelected
                          ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={p.color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                          : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.faint} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                        }
                      </div>
                    );
                  })}

                  {selectedPreset && (
                    <button
                      onClick={() => {
                        onAdd({ name: selectedPreset.name, target: selectedPreset.target, current: 0, icon: selectedPreset.icon, color: selectedPreset.color, plaid_account_id: null, plaid_account_name: null });
                        setSelectedPreset(null);
                      }}
                      style={{ width: "100%", padding: 13, background: `linear-gradient(90deg,${selectedPreset.color},${selectedPreset.color}CC)`, border: "none", borderRadius: 12, color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: FONT }}
                    >
                      {t("savings.create_goal", { name: selectedPreset.name })}
                    </button>
                  )}

                  <div onClick={() => { setShowAdd(true); setSelectedPreset(null); }}
                    style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 8, background: C.bgSecondary, border: `1px dashed ${C.border}`, borderRadius: 12, padding: "13px 14px", cursor: "pointer", color: C.muted, fontSize: 14, fontWeight: 500, transition: "color 0.15s, border-color 0.15s" }}
                    onPointerEnter={e => { e.currentTarget.style.color = C.text; e.currentTarget.style.borderColor = C.muted; }}
                    onPointerLeave={e => { e.currentTarget.style.color = C.muted; e.currentTarget.style.borderColor = C.border; }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    {t("savings.custom_goal")}
                  </div>
                </div>
              );
            })()}
          </div>
        </GlassCard>
      ) : (
        savings.map(sv => {
          const pct       = sv.target > 0 ? Math.min((Number(sv.current) / Number(sv.target)) * 100, 100) : 0;
          const goalColor = sv.color || C.green;
          const remaining = Math.max(Number(sv.target) - Number(sv.current), 0);
          const months    = monthsToGoal(sv);
          return <SavingsGoalCard key={sv.id} sv={sv} pct={pct} goalColor={goalColor} remaining={remaining} months={months} onUpdate={onUpdate} onEdit={onEdit} onDelete={onDelete} plaidAccounts={plaidAccounts} getGoalIcon={getGoalIcon} insight={insight} safeSavingsAmount={safeSavingsAmount} maxSavingsAmount={maxSavingsAmount} monthlySurplus={monthlySurplus} numGoals={savings.length} userId={userId} />;
        })
      )}
    </div>
  );
}
