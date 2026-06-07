import { useState, useEffect, useRef, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../utils/supabase";
import { C, FONT } from "../utils/colors";
import Icon from "./shared/Icon";
import GlassCard from "./shared/GlassCard";
import { fmtMoney } from "./Transactions";
import { logger } from "../utils/logger";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

function getCachedAccounts() {
  try {
    const raw = localStorage.getItem("arkonomy_accounts_v1");
    if (!raw) return null;
    const { ts, accounts } = JSON.parse(raw);
    if (Date.now() - ts > 60 * 60 * 1000) return null;
    return accounts;
  } catch { return null; }
}
function setCachedAccounts(accounts) {
  try {
    localStorage.setItem("arkonomy_accounts_v1", JSON.stringify({ ts: Date.now(), accounts }));
  } catch {}
}

// ─── Goal Progress Card ───────────────────────────────────────
function GoalCard({ sv, onDelete, onEdit, onUpdate, totalIncome, totalSpent, transactions, plaidAccounts, onInvestAlpaca, isPro, onUpgrade, alpacaConnected, onConnectAlpaca, userId }) {
  const { t } = useTranslation();
  const [showEdit, setShowEdit] = useState(false);
  const [showMoveMoney, setShowMoveMoney] = useState(false);
  const [showReminderModal, setShowReminderModal] = useState(false);
  const [editName, setEditName] = useState(sv.name);
  const [editTarget, setEditTarget] = useState(String(sv.target));
  const [editAccountId, setEditAccountId] = useState(sv.plaid_account_id || "");
  const [editAccountName, setEditAccountName] = useState(sv.plaid_account_name || "");
  const [updating, setUpdating] = useState(false);

  // Reminder state
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
    try {
      const { data } = await supabase.from("savings_reminders")
        .select("*").eq("goal_id", sv.id).eq("user_id", userId).maybeSingle();
      setReminder(data || false);
      if (data) {
        const days = Array.isArray(data.day_of_week) ? data.day_of_week : [data.day_of_week];
        setReminderDays(days);
        setReminderAmt(String(data.amount));
      }
    } catch (err) {
      logger.error("[openMoveMoney] failed:", err);
    } finally {
      setLoadingReminder(false);
    }
  }

  async function saveReminder() {
    const amt = parseFloat(reminderAmt);
    if (!amt || amt <= 0 || !userId || reminderDays.length === 0) return;
    setSavingReminder(true);
    try {
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
        }).catch(err => logger.error("[saveReminder] session fetch failed:", err));
      }
    } catch (err) {
      logger.error("[saveReminder] failed:", err);
    } finally {
      setSavingReminder(false);
    }
  }

  async function cancelReminder() {
    if (!userId) return;
    try {
      await supabase.from("savings_reminders").delete().eq("goal_id", sv.id).eq("user_id", userId);
      setReminder(false);
      setReminderDays([1]);
      setReminderAmt("");
      setEditingReminder(false);
    } catch (err) {
      logger.error("[cancelReminder] failed:", err);
    }
  }

  const linkedAccount = sv.plaid_account_id
    ? plaidAccounts.find(a => a.account_id === sv.plaid_account_id) ?? null
    : null;

  const current = Number(
    linkedAccount != null
      ? (linkedAccount.balance_available ?? linkedAccount.balance_current ?? sv.current ?? 0)
      : (sv.current ?? 0)
  ) || 0;

  const progress = Math.min(1, Number(current) / Number(sv.target || 1));
  const pct = Math.round(progress * 100);

  const monthlySurplus = totalIncome - totalSpent;
  const isDeficit = monthlySurplus < 0;

  const remaining = Math.max(0, Number(sv.target) - Number(current));

  const monthlyRate = useMemo(() => {
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0,0,0,0);
    const goalTransfers = transactions.filter(t => {
      const d = new Date(t.date);
      return t.type === "income" && t.category_name === "Transfer" && d >= monthStart;
    });
    return goalTransfers.reduce((s, t) => s + Number(t.amount), 0);
  }, [transactions]);

  const projectedDate = useMemo(() => {
    if (remaining <= 0) return null;
    if (monthlyRate <= 0) return null;
    const monthsLeft = remaining / monthlyRate;
    const d = new Date();
    d.setMonth(d.getMonth() + Math.ceil(monthsLeft));
    return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
  }, [remaining, monthlyRate]);

  return (
    <GlassCard style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{sv.name}</h3>
            {linkedAccount && <div style={{ fontSize: 10, fontWeight: 700, color: C.green, background: C.green + "18", border: `1px solid ${C.green}33`, borderRadius: 20, padding: "2px 7px", letterSpacing: 0.5 }}>{t("savings.live").toUpperCase()}</div>}
          </div>
          <div style={{ fontSize: 13, color: C.muted }}>
            {linkedAccount ? `Linked: ${linkedAccount.name} ••••${linkedAccount.mask}` : t("savings.tracking_manually")}
          </div>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          <button onClick={openMoveMoney} style={{ background: C.bgSecondary, border: `1px solid ${C.border}`, borderRadius: 10, width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <Icon name="arrow-up-right" size={16} color={C.cyan} />
          </button>
          <button onClick={() => setShowEdit(true)} style={{ background: C.bgSecondary, border: `1px solid ${C.border}`, borderRadius: 10, width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <Icon name="edit-3" size={15} color={C.muted} />
          </button>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 8 }}>
        <div>
          <span style={{ fontSize: 24, fontWeight: 800, color: C.text }}>${fmtMoney(current)}</span>
          <span style={{ fontSize: 13, color: C.muted, marginLeft: 6 }}>/ ${fmtMoney(sv.target)}</span>
        </div>
        <div style={{ fontSize: 14, fontWeight: 700, color: progress >= 1 ? C.green : C.cyan }}>{pct}%</div>
      </div>

      <div style={{ height: 8, background: C.bgSecondary, borderRadius: 4, overflow: "hidden", marginBottom: 12 }}>
        <div style={{ height: "100%", background: `linear-gradient(90deg, ${C.cyan}, ${C.blue})`, width: `${pct}%`, borderRadius: 4, transition: "width 0.6s cubic-bezier(0.22, 1, 0.36, 1)" }} />
      </div>

      {projectedDate ? (
        <div style={{ fontSize: 12, color: C.muted, display: "flex", alignItems: "center", gap: 6 }}>
          <Icon name="calendar" size={12} color={C.faint} />
          {t("savings.on_track_goal", { date: projectedDate })}
        </div>
      ) : remaining > 0 ? (
        <div style={{ fontSize: 12, color: C.faint }}>
          {t("savings.start_saving_mo", { amount: Math.round(remaining / 12), date: new Date(new Date().getFullYear() + 1, new Date().getMonth(), 1).toLocaleDateString("en-US", { month: "short", year: "numeric" }) })}
        </div>
      ) : (
        <div style={{ fontSize: 12, color: C.green, fontWeight: 600 }}>✨ {t("upgrade.benefit_investing_title")} goal reached!</div>
      )}

      {/* Edit Modal */}
      {showEdit && (
        <div onClick={() => setShowEdit(false)} style={{ position: "fixed", inset: 0, zIndex: 10000, background: "rgba(7,12,24,0.85)", display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(6px)", padding: 20 }}>
          <GlassCard onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 400, padding: 24 }}>
            <h3 style={{ margin: "0 0 20px", fontSize: 20 }}>{t("savings.edit_goal_title")}</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, color: C.muted, marginBottom: 6, fontWeight: 600 }}>{t("savings.goal_name").toUpperCase()}</label>
                <input style={{ width: "100%", padding: 14, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 12, color: C.text, fontSize: 15, outline: "none" }} value={editName} onChange={e => setEditName(e.target.value)} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, color: C.muted, marginBottom: 6, fontWeight: 600 }}>{t("savings.target_amount").toUpperCase()}</label>
                <input style={{ width: "100%", padding: 14, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 12, color: C.text, fontSize: 15, outline: "none" }} type="number" value={editTarget} onChange={e => setEditTarget(e.target.value)} />
              </div>

              {plaidAccounts.length > 0 && (
                <div>
                  <label style={{ display: "block", fontSize: 12, color: C.muted, marginBottom: 6, fontWeight: 600 }}>{t("savings.savings_account_optional").toUpperCase()}</label>
                  <select
                    style={{ width: "100%", padding: 14, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 12, color: C.text, fontSize: 15, outline: "none" }}
                    value={editAccountId}
                    onChange={e => {
                      const id = e.target.value;
                      setEditAccountId(id);
                      if (!id) { setEditAccountName(""); } else {
                        const acc = plaidAccounts.find(a => a.account_id === id);
                        setEditAccountName(acc ? `${acc.name} ••••${acc.mask}` : "");
                      }
                    }}
                  >
                    <option value="">{t("savings.track_manually")}</option>
                    {plaidAccounts.map(a => (
                      <option key={a.account_id} value={a.account_id}>{a.name} (••••{a.mask})</option>
                    ))}
                  </select>
                </div>
              )}

              <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
                <button
                  onClick={() => {
                    onEdit(sv.id, { name: editName, target: parseFloat(editTarget), plaid_account_id: editAccountId || null, plaid_account_name: editAccountName || null });
                    setShowEdit(false);
                  }}
                  style={{ flex: 1, padding: 14, background: `linear-gradient(90deg,${C.cyan},${C.blue})`, border: "none", borderRadius: 12, color: "#fff", fontWeight: 700, cursor: "pointer" }}
                >
                  {t("savings.save")}
                </button>
                <button
                  onClick={() => { onDelete(sv.id); setShowEdit(false); }}
                  style={{ padding: "0 14px", background: "none", border: `1px solid ${C.red}44`, borderRadius: 12, color: C.red, fontWeight: 600, cursor: "pointer" }}
                >
                  {t("savings.delete")}
                </button>
              </div>
              <button onClick={() => setShowEdit(false)} style={{ background: "none", border: "none", color: C.muted, fontSize: 14, cursor: "pointer" }}>{t("savings.cancel")}</button>
            </div>
          </GlassCard>
        </div>
      )}

      {/* Move Money / Reminder Sheet */}
      {showMoveMoney && (
        <div onClick={() => setShowMoveMoney(false)} style={{ position: "fixed", inset: 0, zIndex: 10000, background: "rgba(7,12,24,0.88)", display: "flex", alignItems: "flex-end", justifyContent: "center", backdropFilter: "blur(6px)" }}>
          <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 430, background: C.bgSecondary, borderRadius: "24px 24px 0 0", border: `1px solid ${C.border}`, borderBottom: "none", padding: "28px 20px 36px", fontFamily: FONT, color: C.text, boxShadow: "0 -8px 48px rgba(0,0,0,0.6)" }}>
            <div style={{ width: 36, height: 4, borderRadius: 99, background: C.border, margin: "0 auto 24px" }} />

            <div style={{ textAlign: "center", marginBottom: 28 }}>
              <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 56, height: 56, borderRadius: 18, background: C.cyan + "18", border: `1px solid ${C.cyan}44`, marginBottom: 14 }}>
                <Icon name="arrow-up-right" size={24} color={C.cyan} strokeWidth={2.5} />
              </div>
              <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 6 }}>{t("savings.move_money_title")}</div>
              <div style={{ fontSize: 14, color: C.muted }}>{t("savings.transfer_in_app", { bank: linkedAccount?.institution_name || "your bank" })}</div>
            </div>

            <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 16, padding: "18px 20px", marginBottom: 24 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: C.muted, letterSpacing: 0.8 }}>{t("savings.linked_account")}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: C.green }}>{t("savings.live").toUpperCase()}</span>
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>{linkedAccount?.name || sv.name}</div>
              <div style={{ fontSize: 13, color: C.muted }}>{linkedAccount ? `••••${linkedAccount.mask} · ${linkedAccount.official_name || "Savings"}` : t("savings.tracking_manually")}</div>
              {linkedAccount && (
                <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.border}`, fontSize: 15, fontWeight: 600, color: C.cyan }}>
                  {t("savings.available_balance", { balance: fmtMoney(linkedAccount.balance_available ?? linkedAccount.balance_current ?? 0) })}
                </div>
              )}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <button onClick={() => { setShowMoveMoney(false); setShowReminderModal(true); }} style={{ width: "100%", padding: 16, background: `linear-gradient(90deg,${C.cyan},${C.blue})`, border: "none", borderRadius: 16, color: "#fff", fontWeight: 800, fontSize: 16, cursor: "pointer", fontFamily: FONT, display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
                <Icon name="bell" size={18} color="#fff" />
                {t("savings.set_weekly_reminder")}
              </button>
              <p style={{ fontSize: 12, color: C.faint, textAlign: "center", margin: "4px 0 0", lineHeight: 1.5 }}>
                {t("savings.no_real_money")}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Reminder Modal */}
      {showReminderModal && (
        <div onClick={() => setShowReminderModal(false)} style={{ position: "fixed", inset: 0, zIndex: 10001, background: "rgba(7,12,24,0.92)", display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(8px)", padding: 20 }}>
          <GlassCard onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 400, padding: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h3 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>{t("savings.set_reminder_title")}</h3>
              <button onClick={() => setShowReminderModal(false)} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer" }}>
                <Icon name="x" size={20} />
              </button>
            </div>

            {loadingReminder ? (
              <div style={{ padding: "40px 0", textAlign: "center", color: C.muted }}>{t("savings.loading")}</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                {reminder && !editingReminder ? (
                  <div style={{ background: C.bgSecondary, border: `1px solid ${C.cyan}33`, borderRadius: 14, padding: 18 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: C.cyan, letterSpacing: 0.8, marginBottom: 12 }}>{t("savings.active_reminder")}</div>
                    <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
                      ${fmtMoney(reminder.amount)} {reminder.day_of_week.length === 7 ? "every day" : reminder.day_of_week.map(d => DAY_NAMES[d]).join(", ")}
                    </div>
                    <div style={{ fontSize: 13, color: C.muted, marginBottom: 16 }}>Reminding you to transfer to {sv.name}</div>
                    <div style={{ display: "flex", gap: 10 }}>
                      <button onClick={() => setEditingReminder(true)} style={{ flex: 1, padding: "10px 0", background: C.bgTertiary, border: `1px solid ${C.border}`, borderRadius: 10, color: C.text, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>{t("savings.edit")}</button>
                      <button onClick={cancelReminder} style={{ flex: 1, padding: "10px 0", background: "none", border: `1px solid ${C.red}33`, borderRadius: 10, color: C.red, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>{t("savings.cancel_reminder")}</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div>
                      <label style={{ display: "block", fontSize: 11, color: C.muted, marginBottom: 10, fontWeight: 700, letterSpacing: 0.8 }}>{t("savings.remind_every").toUpperCase()}</label>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                        {DAYS.map(day => {
                          const active = reminderDays.includes(day.dow);
                          return (
                            <button
                              key={day.label}
                              onClick={() => setReminderDays(prev => active ? prev.filter(d => d !== day.dow) : [...prev, day.dow])}
                              style={{ padding: "8px 12px", borderRadius: 10, background: active ? C.cyan : C.bgSecondary, border: `1px solid ${active ? C.cyan : C.border}`, color: active ? "#000" : C.text, fontSize: 13, fontWeight: 600, cursor: "pointer", transition: "all 0.2s" }}
                            >
                              {day.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div>
                      <label style={{ display: "block", fontSize: 11, color: C.muted, marginBottom: 10, fontWeight: 700, letterSpacing: 0.8 }}>{t("savings.remind_transfer").toUpperCase()}</label>
                      <div style={{ position: "relative" }}>
                        <span style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", fontSize: 16, color: C.muted }}>$</span>
                        <input
                          style={{ width: "100%", padding: "14px 16px 14px 30px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 12, color: C.text, fontSize: 18, fontWeight: 700, outline: "none", boxSizing: "border-box" }}
                          type="number"
                          placeholder="0.00"
                          value={reminderAmt}
                          onChange={e => setReminderAmt(e.target.value)}
                        />
                      </div>
                    </div>

                    <button
                      onClick={saveReminder}
                      disabled={savingReminder || !reminderAmt || reminderDays.length === 0}
                      style={{ width: "100%", padding: 16, background: `linear-gradient(90deg,${C.cyan},${C.blue})`, border: "none", borderRadius: 14, color: "#fff", fontWeight: 800, fontSize: 16, cursor: "pointer", opacity: (savingReminder || !reminderAmt || reminderDays.length === 0) ? 0.6 : 1 }}
                    >
                      {savingReminder ? t("savings.saving") : t("savings.save")}
                    </button>
                  </>
                )}
                <button onClick={() => setShowReminderModal(false)} style={{ background: "none", border: "none", color: C.muted, fontSize: 14, fontWeight: 500, cursor: "pointer" }}>{t("savings.got_it")}</button>
              </div>
            )}
          </GlassCard>
        </div>
      )}
    </GlassCard>
  );
}

// ─── Main Savings Screen ──────────────────────────────────────
export default function Savings({ savings = [], onAdd, onUpdate, onEdit, onDelete, totalIncome = 0, totalSpent = 0, transactions, insight, onInsightAction, onInvestAlpaca, isPro, isTrial, onUpgrade, alpacaConnected, onConnectAlpaca, bankConnected, userId, InsightCard }) {
  const { t } = useTranslation();
  const [loadError, setLoadError]           = useState(null);
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
        if (d.accounts.length) setCachedAccounts(d.accounts);
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
  const isDeficit      = monthlySurplus < 0;

  const availableBalance = Math.max(monthlySurplus, 0);
  const safetyBuffer = Math.min(500, availableBalance * 0.5);
  const safeToMove = Math.max(0, availableBalance - safetyBuffer);

  const PRESETS = [
    { name: t("savings.emergency_fund"), target: 10000, icon: "shield" },
    { name: t("savings.vacation"), target: 3000, icon: "plane" },
    { name: t("savings.custom_goal"), target: 1000, icon: "plus-circle" },
  ];

  function handleAdd() {
    if (!newName || !newTarget) return;
    onAdd({
      name: newName,
      target: parseFloat(newTarget),
      current: 0,
      plaid_account_id: newAccountId || null,
      plaid_account_name: newAccountName || null
    });
    setShowAdd(false);
    setNewName(""); setNewTarget(""); setNewAccountId(""); setNewAccountName(""); setSelectedPreset(null);
  }


  if (loadError) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 200, gap: 16 }}>
        <div style={{ fontSize: 14, color: C.red, textAlign: "center" }}>{loadError}</div>
        <button onClick={() => { setLoadError(null); if (bankConnected) fetchPlaidAccounts(); }} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "10px 20px", color: C.text, cursor: "pointer", fontFamily: FONT, fontSize: 14 }}>
          {t("common.retry") || "Retry"}
        </button>
      </div>
    );
  }


  return (
    <div style={{ paddingBottom: 40, fontFamily: FONT }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 24, fontWeight: 800 }}>{t("nav.savings")}</h2>
          <div style={{ fontSize: 13, color: C.muted, marginTop: 2 }}>{t("savings.track_progress")}</div>
        </div>
        <button onClick={() => setShowAdd(true)} style={{ background: C.bgSecondary, border: `1px solid ${C.border}`, borderRadius: 10, padding: "8px 14px", color: C.cyan, fontSize: 14, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
          <Icon name="plus" size={16} />
          {t("savings.add_goal")}
        </button>
      </div>

      <div style={{ display: "flex", gap: 12, marginBottom: 24, overflowX: "auto", paddingBottom: 4, margin: "0 -4px 20px" }}>
        <GlassCard style={{ flex: "0 0 160px", padding: "16px 14px", border: `1px solid ${C.sep}` }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, letterSpacing: 0.8, marginBottom: 8 }}>{t("savings.total_saved")}</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: C.text }}>${fmtMoney(totalSaved)}</div>
        </GlassCard>
        <GlassCard style={{ flex: "0 0 160px", padding: "16px 14px", border: `1px solid ${C.sep}` }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: isDeficit ? C.red : C.green, letterSpacing: 0.8, marginBottom: 8 }}>{isDeficit ? t("savings.monthly_deficit") : t("savings.monthly_surplus")}</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: isDeficit ? C.red : C.green }}>${fmtMoney(Math.abs(monthlySurplus))}</div>
        </GlassCard>
      </div>

      {insight?.type === 'savings_opportunity' && (
        <InsightCard
          insight={insight}
          onAction={onInsightAction}
          style={{ marginBottom: 20 }}
          compact={false}
          onInvestAlpaca={onInvestAlpaca}
          isPro={isPro}
          onUpgrade={onUpgrade}
          alpacaConnected={alpacaConnected}
          onConnectAlpaca={onConnectAlpaca}
        />
      )}

      <div style={{ marginBottom: 24 }}>
        <h4 style={{ margin: "0 0 14px", fontSize: 13, fontWeight: 700, color: C.muted, letterSpacing: 1 }}>{t("savings.savings_goals").toUpperCase()}</h4>
        {savings.length === 0 ? (
          <GlassCard style={{ padding: "40px 20px", textAlign: "center" }}>
            <div style={{ width: 60, height: 60, borderRadius: 20, background: C.bgSecondary, display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
              <Icon name="target" size={28} color={C.faint} />
            </div>
            <h3 style={{ margin: "0 0 8px", fontSize: 18 }}>{t("savings.start_first_goal")}</h3>
            <p style={{ margin: "0 0 24px", fontSize: 14, color: C.muted, lineHeight: 1.5 }}>{t("savings.build_first")}</p>
            <button onClick={() => setShowAdd(true)} style={{ padding: "12px 24px", background: `linear-gradient(90deg,${C.cyan},${C.blue})`, border: "none", borderRadius: 12, color: "#fff", fontWeight: 700, cursor: "pointer" }}>{t("savings.add_goal")}</button>
          </GlassCard>
        ) : (
          savings.map(sv => (
            <GoalCard
              key={sv.id}
              sv={sv}
              onDelete={onDelete}
              onEdit={onEdit}
              onUpdate={onUpdate}
              totalIncome={totalIncome}
              totalSpent={totalSpent}
              transactions={transactions}
              plaidAccounts={plaidAccounts}
              onInvestAlpaca={onInvestAlpaca}
              isPro={isPro}
              onUpgrade={onUpgrade}
              alpacaConnected={alpacaConnected}
              onConnectAlpaca={onConnectAlpaca}
              userId={userId}
            />
          ))
        )}
      </div>

      {/* Spare Change Card */}
      <GlassCard style={{ padding: 20, background: `linear-gradient(135deg, ${C.bgSecondary}, ${C.bg})` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
          <div>
            <h3 style={{ margin: "0 0 4px", fontSize: 18, fontWeight: 800 }}>{t("savings.spare_change_title")}</h3>
            <div style={{ fontSize: 13, color: C.muted }}>{t("savings.spare_change_from")}</div>
          </div>
          <div style={{ width: 44, height: 44, borderRadius: 14, background: C.green + "18", border: `1px solid ${C.green}33`, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name="trending-up" size={20} color={C.green} />
          </div>
        </div>

        <div style={{ display: "flex", gap: 12, marginBottom: 24 }}>
          <div style={{ flex: 1, background: C.bg, border: `1px solid ${C.sep}`, borderRadius: 14, padding: "14px 16px" }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, letterSpacing: 0.8, marginBottom: 6 }}>{t("savings.this_month")}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: C.text }}>${fmtMoney(roundupMonth)}</div>
            <div style={{ fontSize: 10, color: C.faint, marginTop: 4 }}>{t("savings.based_on_purchases")}</div>
          </div>
          <div style={{ flex: 1, background: C.bg, border: `1px solid ${C.sep}`, borderRadius: 14, padding: "14px 16px" }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, letterSpacing: 0.8, marginBottom: 6 }}>{t("savings.all_time")}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: C.green }}>${fmtMoney(roundupTotal)}</div>
            <div style={{ fontSize: 10, color: C.faint, marginTop: 4 }}>+12.4% avg yield</div>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18, padding: "0 4px" }}>
           <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div onClick={() => setRoundupEnabled(!roundupEnabled)} style={{ width: 42, height: 24, borderRadius: 20, background: roundupEnabled ? C.cyan : C.bgTertiary, position: "relative", cursor: "pointer", transition: "background 0.2s" }}>
                <div style={{ position: "absolute", top: 3, left: roundupEnabled ? 21 : 3, width: 18, height: 18, borderRadius: 99, background: roundupEnabled ? "#fff" : C.faint, transition: "left 0.2s" }} />
              </div>
              <span style={{ fontSize: 14, fontWeight: 600, color: roundupEnabled ? C.text : C.muted }}>{roundupEnabled ? t("savings.roundups_on") : t("savings.roundups_off")}</span>
           </div>
           <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 12, color: C.muted }}>{t("savings.multiplier")}</span>
              <select value={roundupMultiplier} onChange={e => setRoundupMultiplier(Number(e.target.value))} style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, color: C.cyan, fontSize: 13, fontWeight: 700, padding: "4px 8px", outline: "none" }}>
                <option value="1">1x</option>
                <option value="2">2x</option>
                <option value="5">5x</option>
              </select>
           </div>
        </div>

        {!isPro ? (
          <div style={{ background: "#7C6BFF12", border: "1px solid #7C6BFF33", borderRadius: 14, padding: 16, textAlign: "center" }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#A78BFA", marginBottom: 4 }}>{t("savings.pro_only")}</div>
            <div style={{ fontSize: 12, color: "#94A3B8", marginBottom: 12 }}>{t("savings.spare_change_connect")}</div>
            <button onClick={onUpgrade} style={{ background: "#7C6BFF", border: "none", borderRadius: 10, padding: "10px 20px", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>{t("savings.upgrade_pro")}</button>
          </div>
        ) : !alpacaConnected ? (
          <button onClick={onConnectAlpaca} style={{ width: "100%", padding: 16, background: C.bgSecondary, border: `1px solid ${C.border}`, borderRadius: 14, color: C.cyan, fontSize: 15, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
             <img src="https://files.alpaca.markets/web/logos/alpaca-logo-only.png" style={{ width: 18, height: 18, filter: "brightness(0) invert(1)" }} />
             {t("savings.connect_alpaca")}
          </button>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <button onClick={() => setShowAlpacaSheet(true)} style={{ width: "100%", padding: 16, background: `linear-gradient(90deg, ${C.green}, ${C.cyan})`, border: "none", borderRadius: 14, color: "#000", fontSize: 15, fontWeight: 800, cursor: "pointer", boxShadow: `0 4px 20px ${C.green}33` }}>
              {t("savings.invest_amount", { amount: fmtMoney(roundupMonth) })}
            </button>
            <p style={{ fontSize: 11, color: C.faint, textAlign: "center", margin: 0 }}>{t("savings.small_amounts")}</p>
          </div>
        )}
      </GlassCard>

      {/* Add Goal Modal */}
      {showAdd && (
        <div onClick={() => setShowAdd(false)} style={{ position: "fixed", inset: 0, zIndex: 10000, background: "rgba(7,12,24,0.85)", display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(6px)", padding: 20 }}>
          <GlassCard onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 400, padding: 24 }}>
            <h3 style={{ margin: "0 0 20px", fontSize: 22, fontWeight: 800 }}>{t("savings.new_goal")}</h3>

            {!selectedPreset ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {PRESETS.map(p => (
                  <button key={p.name} onClick={() => { setSelectedPreset(p); setNewName(p.name); setNewTarget(String(p.target)); }} style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", padding: 16, background: C.bgSecondary, border: `1px solid ${C.border}`, borderRadius: 14, color: C.text, textAlign: "left", cursor: "pointer" }}>
                    <div style={{ width: 40, height: 40, borderRadius: 12, background: C.bgTertiary, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <Icon name={p.icon} size={20} color={C.cyan} />
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 15 }}>{p.name}</div>
                      <div style={{ fontSize: 12, color: C.muted }}>Target: ${fmtMoney(p.target)}</div>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div>
                  <label style={{ display: "block", fontSize: 12, color: C.muted, marginBottom: 8, fontWeight: 600 }}>{t("savings.goal_name").toUpperCase()}</label>
                  <input style={inp} placeholder={t("savings.goal_placeholder")} value={newName} onChange={e => setNewName(e.target.value)} />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 12, color: C.muted, marginBottom: 8, fontWeight: 600 }}>{t("savings.target_amount_label").toUpperCase()}</label>
                  <input style={inp} type="number" placeholder="5000" value={newTarget} onChange={e => setNewTarget(e.target.value)} />
                </div>

                <div style={{ marginTop: 4 }}>
                   <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                     <label style={{ fontSize: 12, color: C.muted, fontWeight: 600 }}>{t("savings.savings_account_label").toUpperCase()}</label>
                     <div style={{ display: "flex", background: C.bgSecondary, borderRadius: 8, padding: 2 }}>
                        <button onClick={() => setAccountLinkMode("auto")} style={{ border: "none", background: accountLinkMode === "auto" ? C.bgTertiary : "none", color: accountLinkMode === "auto" ? C.cyan : C.muted, padding: "4px 10px", fontSize: 10, fontWeight: 700, borderRadius: 6, cursor: "pointer" }}>AUTO</button>
                        <button onClick={() => setAccountLinkMode("manual")} style={{ border: "none", background: accountLinkMode === "manual" ? C.bgTertiary : "none", color: accountLinkMode === "manual" ? C.cyan : C.muted, padding: "4px 10px", fontSize: 10, fontWeight: 700, borderRadius: 6, cursor: "pointer" }}>MANUAL</button>
                     </div>
                   </div>

                   {accountLinkMode === "auto" ? (
                     bankConnected ? (
                        loadingAccounts ? <div style={{ padding: 14, textAlign: "center", fontSize: 13, color: C.muted }}>{t("savings.loading_accounts")}</div> :
                        accountsError ? (
                          <div style={{ padding: 14, textAlign: "center" }}>
                            <div style={{ fontSize: 12, color: C.red, marginBottom: 8 }}>{t("savings.could_not_load_accounts", { error: accountsError })}</div>
                            <button onClick={fetchPlaidAccounts} style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: 8, color: C.cyan, fontSize: 11, padding: "5px 12px", cursor: "pointer" }}>{t("savings.retry")}</button>
                          </div>
                        ) : (
                          <select
                            style={inp}
                            value={newAccountId}
                            onChange={e => {
                              const id = e.target.value;
                              setNewAccountId(id);
                              if (!id) { setNewAccountName(""); } else {
                                const acc = plaidAccounts.find(a => a.account_id === id);
                                setNewAccountName(acc ? `${acc.name} ••••${acc.mask}` : "");
                              }
                            }}
                          >
                            <option value="">{t("savings.track_manually_no_link")}</option>
                            {savingsAccounts.length > 0 ? (
                               <optgroup label="Savings Accounts">
                                 {savingsAccounts.map(a => <option key={a.account_id} value={a.account_id}>{a.name} (••••{a.mask})</option>)}
                               </optgroup>
                            ) : (
                               <option disabled>No savings accounts found</option>
                            )}
                            <optgroup label="Other Accounts">
                               {plaidAccounts.filter(a => a.subtype !== "savings" && a.type !== "savings").map(a => <option key={a.account_id} value={a.account_id}>{a.name} (••••{a.mask})</option>)}
                            </optgroup>
                          </select>
                        )
                     ) : (
                       <div style={{ padding: 16, background: C.bgSecondary, borderRadius: 12, textAlign: "center" }}>
                         <div style={{ fontSize: 13, color: C.muted, marginBottom: 12 }}>{t("transactions.connect_bank_hint")}</div>
                         <button onClick={() => { setShowAdd(false); onInsightAction('review_spending'); }} style={{ background: "none", border: `1px solid ${C.cyan}44`, color: C.cyan, borderRadius: 10, padding: "8px 16px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>{t("dashboard.connect_bank")}</button>
                       </div>
                     )
                   ) : (
                     <div style={{ fontSize: 13, color: C.muted, padding: "10px 0" }}>
                        <Icon name="info" size={14} style={{ marginRight: 6, verticalAlign: "middle" }} />
                        {t("savings.money_stays")}
                     </div>
                   )}
                </div>

                <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
                  <button onClick={handleAdd} style={{ flex: 1, padding: 14, background: `linear-gradient(90deg,${C.cyan},${C.blue})`, border: "none", borderRadius: 12, color: "#fff", fontWeight: 700, fontSize: 15, cursor: "pointer" }}>{t("savings.create_goal", { name: newName || "Goal" })}</button>
                  <button onClick={() => setSelectedPreset(null)} style={{ padding: "0 14px", background: "none", border: `1px solid ${C.border}`, borderRadius: 12, color: C.muted, fontWeight: 600, cursor: "pointer" }}><Icon name="arrow-left" size={18} /></button>
                </div>
              </div>
            )}
          </GlassCard>
        </div>
      )}

      {/* Alpaca Confirmation Sheet */}
      {showAlpacaSheet && (
        <div onClick={() => setShowAlpacaSheet(false)} style={{ position: "fixed", inset: 0, zIndex: 10000, background: "rgba(7,12,24,0.88)", display: "flex", alignItems: "flex-end", justifyContent: "center", backdropFilter: "blur(6px)" }}>
          <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 430, background: C.bgSecondary, borderRadius: "24px 24px 0 0", border: `1px solid ${C.border}`, borderBottom: "none", padding: "28px 20px 36px", fontFamily: FONT, color: C.text, boxShadow: "0 -8px 48px rgba(0,0,0,0.6)" }}>
             <div style={{ width: 36, height: 4, borderRadius: 99, background: C.border, margin: "0 auto 24px" }} />
             <div style={{ textAlign: "center", marginBottom: 28 }}>
                <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 56, height: 56, borderRadius: 18, background: C.green + "18", border: `1px solid ${C.green}44`, marginBottom: 14 }}>
                  <Icon name="trending-up" size={24} color={C.green} strokeWidth={2.5} />
                </div>
                <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 6 }}>{t("savings.confirm_investment")}</div>
                <div style={{ fontSize: 14, color: C.muted }}>{t("savings.to_invest")}</div>
             </div>
             <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 16, padding: 20, marginBottom: 24, textAlign: "center" }}>
                <div style={{ fontSize: 42, fontWeight: 800, color: C.text, marginBottom: 4 }}>${fmtMoney(roundupMonth)}</div>
                <div style={{ fontSize: 13, color: C.muted, fontWeight: 600 }}>SPDR S&P 500 ETF (SPY)</div>
             </div>
             <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <button onClick={() => { onInvestAlpaca({ roundUpMonthly: roundupMonth }); setShowAlpacaSheet(false); }} style={{ width: "100%", padding: 18, background: `linear-gradient(90deg, ${C.green}, ${C.cyan})`, border: "none", borderRadius: 16, color: "#000", fontSize: 16, fontWeight: 800, cursor: "pointer" }}>
                   Confirm & Place Order
                </button>
                <button onClick={() => setShowAlpacaSheet(false)} style={{ width: "100%", padding: 14, background: "none", border: `1px solid ${C.border}`, borderRadius: 16, color: C.muted, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
                   {t("common.cancel")}
                </button>
             </div>
             <p style={{ fontSize: 11, color: C.faint, textAlign: "center", marginTop: 24, lineHeight: 1.5 }}>{t("savings.roundup_body")}</p>
          </div>
        </div>
      )}
    </div>
  );
}
