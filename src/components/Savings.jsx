import { useState, useEffect, useRef, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../utils/supabase";
import { C, FONT, RADIUS, DASHBOARD_C as DC } from "../utils/colors";
import Icon from "./shared/Icon";
import GlassCard from "./shared/GlassCard";
import { fmtMoney } from "./Transactions";
import { parseDate, sumAmounts } from "../utils/helpers";
import { logger } from "../utils/logger";
import { getCachedAccounts, setCachedAccounts, sumDepositoryBalance, sumInvestmentBalance, sumAlpacaPositionsValue, sumCreditDebt } from "../utils/accountsCache";
import { calculateNetWorth } from "../shared/financialConstants";
import { IS_IOS_NATIVE } from "../lib/platform";
import { useUSStorefront } from "../lib/storefront";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;


// ─── Goal Progress Card ───────────────────────────────────────
function GoalCard({ sv, onDelete, onEdit, onUpdate, totalIncome, totalSpent, transactions, plaidAccounts, onInvestAlpaca, isPro, onUpgrade, alpacaConnected, onConnectAlpaca, userId }) {
  const { t } = useTranslation();
  const [showEdit, setShowEdit] = useState(false);
  const [showMoveMoney, setShowMoveMoney] = useState(false);
  const [showReminderModal, setShowReminderModal] = useState(false);
  const [editName, setEditName] = useState(sv.name);
  const [editTarget, setEditTarget] = useState(String(sv.target));
  const [editTargetError, setEditTargetError] = useState("");
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
    { dayKey: "mon", dow: 1 }, { dayKey: "tue", dow: 2 }, { dayKey: "wed", dow: 3 },
    { dayKey: "thu", dow: 4 }, { dayKey: "fri", dow: 5 }, { dayKey: "sat", dow: 6 },
    { dayKey: "sun", dow: 0 },
  ];
  const DAY_NAMES = [
    t("day.sunday"), t("day.monday"), t("day.tuesday"), t("day.wednesday"),
    t("day.thursday"), t("day.friday"), t("day.saturday"),
  ];

  async function loadReminder() {
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
      logger.error("[loadReminder] failed:", err);
    } finally {
      setLoadingReminder(false);
    }
  }

  function openMoveMoney() {
    setShowMoveMoney(true);
    loadReminder();
  }

  function openReminderDirectly() {
    setShowReminderModal(true);
    loadReminder();
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
        const dayLabel = reminderDays.length === 7 ? t("savings.every_day") : reminderDays.map(d => DAY_NAMES[d]).join(", ");
        supabase.auth.getSession().then(({ data: { session } }) => {
          if (!session) return;
          fetch(`${SUPABASE_URL}/functions/v1/push-notify`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${session.access_token}`, "apikey": SUPABASE_KEY },
            body: JSON.stringify({ user_id: userId, title: t("savings.reminder_push_title"), body: t("savings.reminder_push_body", { day: dayLabel, amount: amt.toFixed(2), name: sv.name }), icon: "/icon-192.png", tag: "savings-reminder-set" }),
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

  const remaining = Math.max(0, Number(sv.target) - Number(current));

  const monthlyRate = useMemo(() => {
    if (!sv.plaid_account_id) return 0;
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0,0,0,0);
    const goalTransfers = transactions.filter(t => {
      const d = new Date(t.date);
      return t.account_id === sv.plaid_account_id && t.type === "income" && d >= monthStart;
    });
    return sumAmounts(goalTransfers);
  }, [transactions, sv.plaid_account_id]);

  const projectedDate = useMemo(() => {
    if (remaining <= 0) return null;
    // Fall back to monthly surplus when the goal has no linked account (or it has no income this month)
    const rate = monthlyRate > 0 ? monthlyRate : Math.max(monthlySurplus, 0);
    if (rate <= 0) return null;
    const monthsLeft = Math.ceil(remaining / rate);
    if (monthsLeft > 120) return null;
    const d = new Date();
    d.setMonth(d.getMonth() + monthsLeft);
    return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
  }, [remaining, monthlyRate, monthlySurplus]);

  return (
    <GlassCard style={{ marginBottom: 16, background: DC.card, border: `1px solid ${DC.faint}33` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{sv.name}</h3>
            {linkedAccount && <div style={{ fontSize: 10, fontWeight: 700, color: DC.emerald, background: DC.emerald + "18", border: `1px solid ${DC.emerald}33`, borderRadius: RADIUS.lg, padding: "2px 7px", letterSpacing: 0.5 }}>{t("savings.live").toUpperCase()}</div>}
          </div>
          <div className="ph-mask" style={{ fontSize: 13, color: DC.muted }}>
            {linkedAccount ? `Linked: ${linkedAccount.name} ••••${linkedAccount.mask}` : t("savings.tracking_manually")}
          </div>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {/* Bug fix (2026-09-02): both buttons rendered as an identical "$"
              — Icon.jsx has no "arrow-up-right" or "edit-3" entry, so
              icons[name] || icons["dollar"] silently fell back to the same
              glyph for both, masking two genuinely different actions.
              "plus" and "edit" already exist in Icon.jsx's own map; this is
              a name fix only, openMoveMoney/setShowEdit behavior unchanged. */}
          <button onClick={openMoveMoney} style={{ background: DC.card, border: `1px solid ${DC.faint}33`, borderRadius: RADIUS.sm, width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <Icon name="plus" size={16} color={DC.gold} strokeWidth={2.5} />
          </button>
          <button onClick={openReminderDirectly} style={{ background: reminder ? DC.gold + "18" : DC.card, border: `1px solid ${reminder ? DC.gold + "44" : `${DC.faint}33`}`, borderRadius: RADIUS.sm, width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <Icon name="bell" size={15} color={reminder ? DC.gold : DC.muted} />
          </button>
          <button onClick={() => setShowEdit(true)} style={{ background: DC.card, border: `1px solid ${DC.faint}33`, borderRadius: RADIUS.sm, width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <Icon name="edit" size={15} color={DC.muted} />
          </button>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 8 }}>
        <div>
          <span className="ph-mask" style={{ fontSize: 24, fontWeight: 800, color: DC.text }}>{fmtMoney(current)}</span>
          <span className="ph-mask" style={{ fontSize: 13, color: DC.muted, marginLeft: 6 }}>/ {fmtMoney(sv.target)}</span>
        </div>
        <div style={{ fontSize: 14, fontWeight: 700, color: progress >= 1 ? DC.emerald : DC.gold }}>{pct}%</div>
      </div>

      <div style={{ height: 8, background: DC.card, borderRadius: RADIUS.xs, overflow: "hidden", marginBottom: 12 }}>
        <div style={{ height: "100%", background: DC.gold, width: `${pct}%`, borderRadius: RADIUS.xs, transition: "width 0.6s cubic-bezier(0.22, 1, 0.36, 1)" }} />
      </div>

      {projectedDate ? (
        <div style={{ fontSize: 12, color: DC.muted, display: "flex", alignItems: "center", gap: 6 }}>
          <Icon name="calendar" size={12} color={DC.faint} />
          {t("savings.on_track_goal", { date: projectedDate })}
        </div>
      ) : remaining > 0 ? (
        <div style={{ fontSize: 12, color: DC.faint }}>
          {t("savings.start_saving_mo", { amount: Math.round(remaining / 12), date: new Date(new Date().getFullYear() + 1, new Date().getMonth(), 1).toLocaleDateString("en-US", { month: "short", year: "numeric" }) })}
        </div>
      ) : (
        <div style={{ fontSize: 12, color: DC.emerald, fontWeight: 600 }}>✨ {t("savings.goal_reached", { name: sv.name })}</div>
      )}

      {/* Edit Modal */}
      {showEdit && (
        <div onClick={() => setShowEdit(false)} style={{ position: "fixed", inset: 0, zIndex: 10000, background: "rgba(7,12,24,0.85)", display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(6px)", padding: 20 }}>
          <GlassCard onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 400, padding: 24, background: DC.card, border: `1px solid ${DC.faint}33` }}>
            <h3 style={{ margin: "0 0 20px", fontSize: 20 }}>{t("savings.edit_goal_title")}</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, color: DC.muted, marginBottom: 6, fontWeight: 600 }}>{t("savings.goal_name").toUpperCase()}</label>
                <input style={{ width: "100%", padding: 14, background: DC.bg, border: `1px solid ${DC.faint}33`, borderRadius: RADIUS.sm, color: DC.text, fontSize: 15 }} value={editName} onChange={e => setEditName(e.target.value)} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, color: DC.muted, marginBottom: 6, fontWeight: 600 }}>{t("savings.target_amount").toUpperCase()}</label>
                <input style={{ width: "100%", padding: 14, background: DC.bg, border: editTargetError ? `1px solid ${DC.ruby}` : `1px solid ${DC.faint}33`, borderRadius: RADIUS.sm, color: DC.text, fontSize: 15 }} type="number" value={editTarget} onChange={e => { setEditTarget(e.target.value); setEditTargetError(""); }} />
                {editTargetError && <div style={{ color: DC.ruby, fontSize: 12, fontWeight: 500, marginTop: 6 }}>{editTargetError}</div>}
              </div>

              {plaidAccounts.length > 0 && (
                <div>
                  <label style={{ display: "block", fontSize: 12, color: DC.muted, marginBottom: 6, fontWeight: 600 }}>{t("savings.savings_account_optional").toUpperCase()}</label>
                  <select
                    style={{ width: "100%", padding: 14, background: DC.bg, border: `1px solid ${DC.faint}33`, borderRadius: RADIUS.sm, color: DC.text, fontSize: 15 }}
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
                  onClick={async () => {
                    const target = parseFloat(editTarget);
                    // Mirrors Profile.jsx's Financial Settings guard — target
                    // was previously an unvalidated parseFloat, so a negative
                    // or zero goal could save silently and break the
                    // progress bar / projected-date math elsewhere on this
                    // card (division by a non-positive target).
                    if (!Number.isFinite(target) || target <= 0) {
                      setEditTargetError(t("savings.target_must_be_positive"));
                      return;
                    }
                    const ok = await onEdit(sv.id, { name: editName, target, plaid_account_id: editAccountId || null, plaid_account_name: editAccountName || null });
                    if (ok) setShowEdit(false);
                    else setEditTargetError(t("savings.save_failed"));
                  }}
                  style={{ flex: 1, padding: 14, background: DC.gold, border: "none", borderRadius: RADIUS.sm, color: DC.bg, fontWeight: 700, cursor: "pointer" }}
                >
                  {t("savings.save")}
                </button>
                <button
                  onClick={() => { onDelete(sv.id); setShowEdit(false); }}
                  style={{ padding: "0 14px", background: "none", border: `1px solid ${DC.ruby}44`, borderRadius: RADIUS.sm, color: DC.ruby, fontWeight: 600, cursor: "pointer" }}
                >
                  {t("savings.delete")}
                </button>
              </div>
              <button onClick={() => setShowEdit(false)} style={{ background: "none", border: "none", color: DC.muted, fontSize: 14, cursor: "pointer" }}>{t("savings.cancel")}</button>
            </div>
          </GlassCard>
        </div>
      )}

      {/* Move Money / Reminder Sheet */}
      {showMoveMoney && (
        <div onClick={() => setShowMoveMoney(false)} style={{ position: "fixed", inset: 0, zIndex: 10000, background: "rgba(7,12,24,0.88)", display: "flex", alignItems: "flex-end", justifyContent: "center", backdropFilter: "blur(6px)" }}>
          <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 430, background: DC.card, borderRadius: "24px 24px 0 0", border: `1px solid ${DC.faint}33`, borderBottom: "none", padding: "28px 20px 36px", fontFamily: FONT, color: DC.text, boxShadow: "0 -8px 48px rgba(0,0,0,0.6)" }}>
            <div style={{ width: 36, height: 4, borderRadius: RADIUS.full, background: `${DC.faint}33`, margin: "0 auto 24px" }} />

            <div style={{ textAlign: "center", marginBottom: 28 }}>
              <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 56, height: 56, borderRadius: RADIUS.lg, background: DC.gold + "18", border: `1px solid ${DC.gold}44`, marginBottom: 14 }}>
                <Icon name="arrow-up-right" size={24} color={DC.gold} strokeWidth={2.5} />
              </div>
              <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 6 }}>{t("savings.move_money_title")}</div>
              <div className="ph-mask" style={{ fontSize: 14, color: DC.muted }}>{t("savings.transfer_in_app", { bank: linkedAccount?.institution_name || t("savings.your_bank_fallback") })}</div>
            </div>

            <div style={{ background: DC.bg, border: `1px solid ${DC.faint}33`, borderRadius: RADIUS.md, padding: "18px 20px", marginBottom: 24 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: DC.muted, letterSpacing: 0.8 }}>{t("savings.linked_account")}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: DC.emerald }}>{t("savings.live").toUpperCase()}</span>
              </div>
              <div className="ph-mask" style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>{linkedAccount?.name || sv.name}</div>
              <div className="ph-mask" style={{ fontSize: 13, color: DC.muted }}>{linkedAccount ? `••••${linkedAccount.mask} · ${linkedAccount.official_name || "Savings"}` : t("savings.tracking_manually")}</div>
              {linkedAccount && (
                <div className="ph-mask" style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${DC.faint}33`, fontSize: 15, fontWeight: 600, color: DC.gold }}>
                  {t("savings.available_balance", { balance: fmtMoney(linkedAccount.balance_available ?? linkedAccount.balance_current ?? 0) })}
                </div>
              )}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <button onClick={() => { setShowMoveMoney(false); setShowReminderModal(true); }} style={{ width: "100%", padding: 16, background: DC.gold, border: "none", borderRadius: RADIUS.md, color: DC.bg, fontWeight: 800, fontSize: 16, cursor: "pointer", fontFamily: FONT, display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
                <Icon name="bell" size={18} color={DC.bg} />
                {t("savings.set_weekly_reminder")}
              </button>
              <p style={{ fontSize: 12, color: DC.faint, textAlign: "center", margin: "4px 0 0", lineHeight: 1.5 }}>
                {t("savings.no_real_money")}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Reminder Modal */}
      {showReminderModal && (
        <div onClick={() => setShowReminderModal(false)} style={{ position: "fixed", inset: 0, zIndex: 10001, background: "rgba(7,12,24,0.92)", display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(8px)", padding: 20 }}>
          <GlassCard onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 400, padding: 24, background: DC.card, border: `1px solid ${DC.faint}33` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h3 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>{t("savings.set_reminder_title")}</h3>
              <button onClick={() => setShowReminderModal(false)} style={{ background: "none", border: "none", color: DC.muted, cursor: "pointer" }}>
                <Icon name="x" size={20} />
              </button>
            </div>

            {loadingReminder ? (
              <div style={{ padding: "40px 0", textAlign: "center", color: DC.muted }}>{t("savings.loading")}</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                {reminder && !editingReminder ? (
                  <div style={{ background: DC.bg, border: `1px solid ${DC.gold}33`, borderRadius: RADIUS.md, padding: 18 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: DC.gold, letterSpacing: 0.8, marginBottom: 12 }}>{t("savings.active_reminder")}</div>
                    <div className="ph-mask" style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
                      {fmtMoney(reminder.amount)} {reminder.day_of_week.length === 7 ? t("savings.every_day") : reminder.day_of_week.map(d => DAY_NAMES[d]).join(", ")}
                    </div>
                    <div style={{ fontSize: 13, color: DC.muted, marginBottom: 16 }}>{t("savings.reminding_transfer", { name: sv.name })}</div>
                    <div style={{ display: "flex", gap: 10 }}>
                      <button onClick={() => setEditingReminder(true)} style={{ flex: 1, padding: "10px 0", background: DC.card, border: `1px solid ${DC.faint}33`, borderRadius: RADIUS.sm, color: DC.text, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>{t("savings.edit")}</button>
                      <button onClick={cancelReminder} style={{ flex: 1, padding: "10px 0", background: "none", border: `1px solid ${DC.ruby}33`, borderRadius: RADIUS.sm, color: DC.ruby, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>{t("savings.cancel_reminder")}</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div>
                      <label style={{ display: "block", fontSize: 11, color: DC.muted, marginBottom: 10, fontWeight: 700, letterSpacing: 0.8 }}>{t("savings.remind_every").toUpperCase()}</label>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                        {DAYS.map(day => {
                          const active = reminderDays.includes(day.dow);
                          return (
                            <button
                              key={day.dow}
                              onClick={() => setReminderDays(prev => active ? prev.filter(d => d !== day.dow) : [...prev, day.dow])}
                              style={{ padding: "8px 12px", borderRadius: RADIUS.sm, background: active ? DC.gold : DC.card, border: `1px solid ${active ? DC.gold : `${DC.faint}33`}`, color: active ? DC.bg : DC.text, fontSize: 13, fontWeight: 600, cursor: "pointer", transition: "all 0.2s" }}
                            >
                              {t("day." + day.dayKey)}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div>
                      <label style={{ display: "block", fontSize: 11, color: DC.muted, marginBottom: 10, fontWeight: 700, letterSpacing: 0.8 }}>{t("savings.remind_transfer").toUpperCase()}</label>
                      <div style={{ position: "relative" }}>
                        <span style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", fontSize: 16, color: DC.muted }}>$</span>
                        <input
                          style={{ width: "100%", padding: "14px 16px 14px 30px", background: DC.bg, border: `1px solid ${DC.faint}33`, borderRadius: RADIUS.sm, color: DC.text, fontSize: 18, fontWeight: 700, boxSizing: "border-box" }}
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
                      style={{ width: "100%", padding: 16, background: DC.gold, border: "none", borderRadius: RADIUS.md, color: DC.bg, fontWeight: 800, fontSize: 16, cursor: "pointer", opacity: (savingReminder || !reminderAmt || reminderDays.length === 0) ? 0.6 : 1 }}
                    >
                      {savingReminder ? t("savings.saving") : t("savings.save")}
                    </button>
                  </>
                )}
                <button onClick={() => setShowReminderModal(false)} style={{ background: "none", border: "none", color: DC.muted, fontSize: 14, fontWeight: 500, cursor: "pointer" }}>{t("savings.got_it")}</button>
              </div>
            )}
          </GlassCard>
        </div>
      )}
    </GlassCard>
  );
}

// ─── Main Savings Screen ──────────────────────────────────────
export default function Savings({ savings = [], onAdd, onUpdate, onEdit, onDelete, totalIncome = 0, totalSpent = 0, transactions, insight, onInsightAction, onInvestAlpaca, isPro, isTrial, onUpgrade, alpacaConnected, onConnectAlpaca, bankConnected, userId, InsightCard, roundupEnabled = false, onToggleRoundup, autoOpenAdd = false, onAutoOpenAddConsumed, profile, onOpenMarket }) {
  const { t } = useTranslation();
  const isUSStorefront = useUSStorefront();
  const showRealUpgrade = !IS_IOS_NATIVE || isUSStorefront;
  const [loadError, setLoadError]           = useState(null);
  const [showAdd, setShowAdd]               = useState(false);
  // Financial Diagnosis Phase 2: a diagnosis action button ("create a
  // savings goal") can deep-link straight into this modal, not just onto
  // this screen — App.jsx sets autoOpenAdd true and flips it back off via
  // onAutoOpenAddConsumed once we've acted on it, so re-visiting Savings
  // normally afterward doesn't reopen the modal unexpectedly.
  useEffect(() => {
    if (autoOpenAdd) {
      setShowAdd(true);
      onAutoOpenAddConsumed?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpenAdd]);
  const goalFormRef = useRef(null);
  const [selectedPreset, setSelectedPreset] = useState(null);
  const [newName, setNewName]               = useState("");
  const [newTarget, setNewTarget]           = useState("");
  const [newTargetError, setNewTargetError] = useState("");
  const [newAccountId, setNewAccountId]     = useState("");
  const [newAccountName, setNewAccountName] = useState("");
  const [plaidAccounts, setPlaidAccounts]   = useState([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [accountsError, setAccountsError]   = useState(null);
  // Asset Allocation fix (2026-08-24): "Stocks" used to be Plaid
  // investment-accounts only — Alpaca holdings (round-up buys, manual buys
  // from Markets.jsx) never fed into it, so the tile stayed at $0/0% no
  // matter how much was actually invested. Same fetch as Markets.jsx's
  // portfolio card (alpaca-portfolio), fetched independently here rather
  // than lifted to a shared parent state — mirrors the existing per-screen
  // fetch pattern already used for Plaid accounts on this same screen.
  const [alpacaPortfolio, setAlpacaPortfolio] = useState(null);
  const [roundupMultiplier, setRoundupMultiplier] = useState(1);
  const [showAlpacaSheet, setShowAlpacaSheet]     = useState(false);
  const [showRoundupTooltip, setShowRoundupTooltip] = useState(false);
  const [showRoundupModal, setShowRoundupModal]     = useState(false);
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

  useEffect(() => {
    if (!alpacaConnected) return;
    supabase.functions.invoke("alpaca-portfolio")
      .then(({ data, error }) => {
        if (!error && data && !data.error) setAlpacaPortfolio(data);
      });
  }, [alpacaConnected]);

  const savingsAccounts = plaidAccounts.filter(a => a.subtype === "savings" || a.type === "savings");

  // Sum actual spare change (cents to next dollar) across this month's expense transactions
  const roundupBase = useMemo(() => {
    if (!transactions?.length) return 0;
    const now = new Date();
    return transactions
      .filter(t => {
        if (t.type !== "expense") return false;
        const cat = t.category_name ?? "";
        if (cat === "Transfer" || cat === "Transfers") return false;
        const d = parseDate(t.date);
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      })
      .reduce((sum, t) => {
        const amt = Math.abs(Number(t.amount));
        const spare = parseFloat((Math.ceil(amt) - amt).toFixed(2));
        return sum + spare;
      }, 0);
  }, [transactions]);

  const roundupMonth  = parseFloat((roundupBase * roundupMultiplier).toFixed(2));

  const inp = { width: "100%", padding: "12px 14px", background: DC.bg, border: `1px solid ${DC.faint}33`, borderRadius: RADIUS.sm, color: DC.text, fontSize: 14, boxSizing: "border-box", marginBottom: 10, fontFamily: FONT };

  const totalSaved     = savings.reduce((s, sv) => s + Number(sv.current), 0);
  const monthlySurplus = totalIncome - totalSpent;

  const availableBalance = Math.max(monthlySurplus, 0);
  const safetyBuffer = Math.min(500, availableBalance * 0.5);
  const safeToMove = Math.max(0, availableBalance - safetyBuffer);

  const cashTotal = sumDepositoryBalance(plaidAccounts) ?? 0;
  const investTotal = sumInvestmentBalance(plaidAccounts) + sumAlpacaPositionsValue(alpacaPortfolio);
  // grossAssets (cash+investments+savings, no debt) drives the segmented
  // allocation bar below — that bar only has 4 asset tiles, no debt tile, so
  // its percentages must stay denominated in gross assets, not net worth.
  const grossAssets = cashTotal + investTotal + totalSaved;
  // Race-condition fix (found 2026-08-27, fixed here): before
  // fetchPlaidAccounts() resolves, plaidAccounts is still its initial []
  // and sumDepositoryBalance([]) legitimately returns null -> `?? 0` above,
  // which is indistinguishable from a real confirmed $0 balance. loadingAccounts
  // already tracks exactly this window (set in fetchPlaidAccounts) but wasn't
  // wired to this card at all — only to an unrelated dropdown spinner further
  // down. Used below to show a loading placeholder instead of a false "$0".
  const cashLoading = bankConnected && loadingAccounts;
  // netWorth (Step 2.5, 2026-08-27) is the actual headline figure shown
  // under the "Net Worth" caption — this widget used to show grossAssets
  // there with no debt subtracted at all (not really net worth), while
  // Dashboard's own "Net Worth" label made the opposite mistake (cash minus
  // debt only, ignoring investments/savings). Both now share one real
  // formula via calculateNetWorth().
  const creditDebt = sumCreditDebt(plaidAccounts) ?? 0;
  const netWorth = calculateNetWorth({ cash: cashTotal, investments: investTotal, savingsGoals: totalSaved, creditDebt });
  // Desaturated via the same HSL formula already applied to CAT_COLORS/
  // INCOME_CATS (S -> 35+S*0.22, L -> L*0.92, hue unchanged) rather than
  // collapsed into DC.gold/emerald — this is a 4-way categorical legend
  // feeding a segmented bar, so the 4 hues must stay distinguishable, not
  // a semantic status color like the rest of this file's blue/green->gold/
  // emerald mapping.
  const ASSET_TILES = [
    { key: "cash",    label: t("savings.cash"),          amount: cashTotal,   color: "#477ACD", loading: cashLoading },
    { key: "stocks",  label: t("savings.stocks"),        amount: investTotal, color: "#31A079" },
    { key: "crypto",  label: t("savings.crypto"),        amount: 0,           color: "#C37137" },
    { key: "savings", label: t("savings.savings_goals"), amount: totalSaved,  color: "#9781DA" },
  ];

  const PRESETS = [
    { name: t("savings.emergency_fund"), target: 10000, icon: "shield" },
    { name: t("savings.vacation"), target: 3000, icon: "plane" },
    { name: t("savings.custom_goal"), target: 1000, icon: "plus-circle" },
  ];

  async function handleAdd() {
    if (!newName || !newTarget) return;
    const target = parseFloat(newTarget);
    // Mirrors Profile.jsx's Financial Settings guard — target was an
    // unvalidated parseFloat, so a negative/zero goal could save silently
    // and break the progress bar / projected-date math on GoalCard
    // (division by a non-positive target).
    if (!Number.isFinite(target) || target <= 0) {
      setNewTargetError(t("savings.target_must_be_positive"));
      return;
    }
    const ok = await onAdd({
      name: newName,
      target,
      current: 0,
      plaid_account_id: newAccountId || null,
      plaid_account_name: newAccountName || null
    });
    if (!ok) { setNewTargetError(t("savings.save_failed")); return; }
    setShowAdd(false);
    setNewName(""); setNewTarget(""); setNewTargetError(""); setNewAccountId(""); setNewAccountName(""); setSelectedPreset(null);
  }


  if (loadError) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 200, gap: 16 }}>
        <div style={{ fontSize: 14, color: DC.ruby, textAlign: "center" }}>{loadError}</div>
        <button onClick={() => { setLoadError(null); if (bankConnected) fetchPlaidAccounts(); }} style={{ background: DC.card, border: `1px solid ${DC.faint}33`, borderRadius: RADIUS.sm, padding: "10px 20px", color: DC.text, cursor: "pointer", fontFamily: FONT, fontSize: 14 }}>
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
          <div style={{ fontSize: 13, color: DC.muted, marginTop: 2 }}>{t("savings.track_progress")}</div>
        </div>
      </div>

      {/* Asset Allocation Widget */}
      {/* Also shown while cashLoading even if grossAssets is momentarily 0
          (e.g. a freshly-connected bank with no savings/stocks yet either) —
          otherwise the card would flicker in only once the fetch resolves,
          which is a smaller version of the same "hide the uncertainty"
          problem this fix is for. */}
      {(grossAssets > 0 || cashLoading) && (
        <GlassCard style={{ padding: 20, marginBottom: 24, background: DC.card, border: `1px solid ${DC.faint}33` }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: DC.muted, letterSpacing: 1, marginBottom: 8 }}>
            {t("savings.asset_allocation").toUpperCase()}
          </div>
          <div className="ph-mask" style={{ fontSize: 34, fontWeight: 800, color: (!cashLoading && netWorth < 0) ? DC.ruby : DC.text, letterSpacing: -0.5, marginBottom: 2 }}>
            {/* netWorth is built from cashTotal, which is a false 0 during
                cashLoading (see cashLoading's own comment above) — showing
                it as-is would just move the same flash from the tile below
                up into the headline number instead of fixing it. */}
            {/* Sign fix (2026-09-02): fmtMoney defaults to Math.abs() with no
                sign shown — a genuinely negative net worth (debt exceeding
                cash+investments+savings) was rendering as a plain positive
                number, actively telling the user the opposite of their real
                financial position. sign:true + ruby-when-negative matches
                how the rest of the app already flags shortfalls (e.g. the
                coach card's "$47 short"). */}
            {cashLoading ? "···" : fmtMoney(netWorth, true)}
          </div>
          <div style={{ fontSize: 12, color: DC.muted, marginBottom: 18 }}>{t("savings.net_worth")}</div>

          {/* Segmented bar — denominated in gross assets (cash+investments+
              savings), not net worth: there's no debt tile in this bar, so
              dividing by net worth would make percentages go negative or
              over 100% whenever there's any credit card debt.

              Color fix (2026-09-02): each segment already pulled its color
              from the same ASSET_TILES.color the chips below use — never
              actually a separate gradient — but the 2px gap had no explicit
              background, so it inherited the surrounding transparency and
              was barely visible, making two adjacent hues (blue/green) read
              as one smooth blend instead of distinct, chip-matching blocks.
              Explicit DC.bg fill + a slightly wider gap makes the boundary
              actually visible. */}
          <div style={{ height: 8, borderRadius: RADIUS.full, overflow: "hidden", display: "flex", gap: 3, marginBottom: 20, background: DC.bg }}>
            {ASSET_TILES.filter(r => r.amount > 0 && !r.loading).map(r => {
              const pct = Math.round((r.amount / grossAssets) * 100);
              return <div key={r.key} style={{ flex: pct, background: r.color, height: "100%" }} />;
            })}
          </div>

          {/* 2×2 compact grid */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {ASSET_TILES.map(r => {
              const pct = grossAssets > 0 ? Math.round((r.amount / grossAssets) * 100) : 0;
              return (
                <div key={r.key} style={{ background: DC.bg, border: `1px solid ${DC.faint}22`, borderRadius: RADIUS.sm, padding: "9px 11px", display: "flex", alignItems: "center", gap: 7 }}>
                  <div style={{ width: 7, height: 7, borderRadius: RADIUS.full, background: r.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: DC.muted, fontWeight: 600, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.label}</span>
                  <span className="ph-mask" style={{ fontSize: r.amount > 0 ? 13 : 11, fontWeight: 700, color: r.amount > 0 ? DC.text : DC.faint, whiteSpace: "nowrap" }}>{r.loading ? "···" : fmtMoney(r.amount)}</span>
                  <div style={{ background: pct > 0 ? DC.emerald + "25" : DC.faint + "30", borderRadius: RADIUS.lg, padding: "2px 6px", flexShrink: 0 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: pct > 0 ? DC.emerald : DC.faint }}>{r.loading ? "" : `${pct}%`}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Debt line (2026-09-02): the only subtraction in
              calculateNetWorth() with no visible line item anywhere on this
              screen — cash/stocks/crypto/savings all summed to grossAssets
              right above, then debt silently vanished into the headline
              number, making a correct subtraction look like a math error.
              Kept out of the percentage-of-grossAssets grid above on
              purpose: debt isn't a slice of gross assets, it's a deduction
              from them, so a "% of assets" badge next to it would itself be
              misleading. */}
          {creditDebt > 0 && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10, paddingTop: 10, borderTop: `1px solid ${DC.faint}22` }}>
              <span style={{ fontSize: 12, color: DC.muted, fontWeight: 600 }}>{t("savings.credit_card_debt")}</span>
              {/* creditDebt itself is a positive magnitude (amount owed, not
                  a signed contribution to net worth) — negate before
                  fmtMoney's sign:true so this reads as the deduction it
                  actually is ("−$444.41"), not "+$444.41". */}
              <span className="ph-mask" style={{ fontSize: 13, fontWeight: 700, color: DC.ruby }}>{fmtMoney(-creditDebt, true)}</span>
            </div>
          )}
        </GlassCard>
      )}

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
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h4 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: DC.muted, letterSpacing: 1 }}>{t("savings.savings_goals").toUpperCase()}</h4>
          {/* Always-visible entry point — the empty-state CTA below only renders
              when savings.length === 0, so without this, adding a second (or
              later) goal had no way to reach setShowAdd(true) at all. */}
          {savings.length > 0 && (
            <button onClick={() => setShowAdd(true)} style={{ display: "flex", alignItems: "center", gap: 4, padding: "6px 12px", background: DC.card, border: `1px solid ${DC.faint}33`, borderRadius: RADIUS.sm, color: DC.gold, fontWeight: 600, fontSize: 12, cursor: "pointer", fontFamily: FONT }}>
              <Icon name="plus" size={13} color={DC.gold} strokeWidth={2.5} />
              {t("savings.add_goal")}
            </button>
          )}
        </div>
        {savings.length === 0 ? (
          <GlassCard style={{ padding: "40px 20px", textAlign: "center", background: DC.card, border: `1px solid ${DC.faint}33` }}>
            <div style={{ width: 60, height: 60, borderRadius: RADIUS.lg, background: DC.bg, display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
              <Icon name="target" size={28} color={DC.faint} />
            </div>
            <h3 style={{ margin: "0 0 8px", fontSize: 18 }}>{t("savings.start_first_goal")}</h3>
            <p style={{ margin: "0 0 24px", fontSize: 14, color: DC.muted, lineHeight: 1.5 }}>{t("savings.build_first")}</p>
            <button onClick={() => setShowAdd(true)} style={{ padding: "12px 24px", background: DC.gold, border: "none", borderRadius: RADIUS.sm, color: DC.bg, fontWeight: 700, cursor: "pointer" }}>{t("savings.add_goal")}</button>
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
      <GlassCard style={{ padding: 20, background: `linear-gradient(135deg, ${DC.card}, ${DC.bg})`, border: `1px solid ${DC.faint}33` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
          <div style={{ position: "relative" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>{t("savings.spare_change_title")}</h3>
              <button
                onClick={() => setShowRoundupTooltip(v => !v)}
                style={{ background: "none", border: "none", cursor: "pointer", padding: 0, color: DC.gold, fontSize: 16, lineHeight: 1, display: "flex", alignItems: "center", fontFamily: FONT }}
              >ⓘ</button>
            </div>
            <div style={{ fontSize: 13, color: DC.muted }}>{t("savings.spare_change_from")}</div>
            {showRoundupTooltip && (
              <>
                <div onClick={() => setShowRoundupTooltip(false)} style={{ position: "fixed", inset: 0, zIndex: 999 }} />
                <div style={{ position: "absolute", top: "calc(100% + 8px)", left: 0, zIndex: 1000, background: DC.card, border: `1px solid ${DC.faint}33`, borderRadius: RADIUS.sm, padding: "12px 14px", width: 240, boxShadow: "0 4px 20px rgba(0,0,0,0.4)" }}>
                  <div style={{ fontSize: 12, color: DC.text, lineHeight: 1.65, marginBottom: 10 }}>{t("savings.roundup_tooltip")}</div>
                  <button
                    onClick={() => { setShowRoundupTooltip(false); setShowRoundupModal(true); }}
                    style={{ background: "none", border: "none", cursor: "pointer", color: DC.gold, fontSize: 12, fontWeight: 700, padding: 0, fontFamily: FONT }}
                  >{t("savings.roundup_learn_more")} →</button>
                </div>
              </>
            )}
          </div>
          <div style={{ width: 44, height: 44, borderRadius: RADIUS.md, background: DC.emerald + "18", border: `1px solid ${DC.emerald}33`, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name="trending-up" size={20} color={DC.emerald} />
          </div>
        </div>

        <div style={{ marginBottom: 24 }}>
          <div style={{ background: DC.bg, border: `1px solid ${DC.faint}22`, borderRadius: RADIUS.md, padding: "14px 16px" }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: DC.muted, letterSpacing: 0.8, marginBottom: 6 }}>{t("savings.this_month")}</div>
            <div className="ph-mask" style={{ fontSize: 20, fontWeight: 800, color: roundupEnabled ? DC.text : DC.faint }}>{roundupEnabled ? fmtMoney(roundupMonth) : "—"}</div>
            <div style={{ fontSize: 10, color: DC.faint, marginTop: 4 }}>{t("savings.based_on_purchases")}</div>
          </div>
        </div>

        <div style={{ marginBottom: 18, padding: "0 4px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div onClick={() => onToggleRoundup?.(!roundupEnabled)} style={{ width: 42, height: 24, borderRadius: RADIUS.lg, background: roundupEnabled ? DC.gold : DC.card, position: "relative", cursor: "pointer", transition: "background 0.2s" }}>
                <div style={{ position: "absolute", top: 3, left: roundupEnabled ? 21 : 3, width: 18, height: 18, borderRadius: RADIUS.full, background: roundupEnabled ? DC.bg : DC.faint, transition: "left 0.2s" }} />
              </div>
              <span style={{ fontSize: 14, fontWeight: 600, color: roundupEnabled ? DC.text : DC.muted }}>{roundupEnabled ? t("savings.roundups_on") : t("savings.roundups_off")}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 12, color: DC.muted }}>{t("savings.multiplier")}</span>
              <select value={roundupMultiplier} onChange={e => setRoundupMultiplier(Number(e.target.value))} style={{ background: DC.bg, border: `1px solid ${DC.faint}33`, borderRadius: RADIUS.xs, color: DC.gold, fontSize: 13, fontWeight: 700, padding: "4px 8px" }}>
                <option value="1">1x</option>
                <option value="2">2x</option>
                <option value="5">5x</option>
              </select>
            </div>
          </div>
          <button
            onClick={() => setShowRoundupModal(true)}
            style={{ background: "none", border: "none", cursor: "pointer", color: DC.gold, fontSize: 12, fontWeight: 600, padding: 0, fontFamily: FONT }}
          >{t("savings.roundup_learn_more")} →</button>
        </div>

        {!roundupEnabled ? (
          <div style={{ padding: "12px 0", textAlign: "center", fontSize: 13, color: DC.faint }}>
            {t("savings.tracking_off_invest")}
          </div>
        ) : !alpacaConnected ? (
          <button onClick={onConnectAlpaca} style={{ width: "100%", padding: 16, background: `linear-gradient(135deg, ${DC.bg}, ${DC.card})`, border: `1px solid ${DC.gold}66`, borderRadius: RADIUS.md, color: DC.text, fontSize: 15, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
            <Icon name="trending-up" size={18} color={DC.gold} />
            {t("savings.connect_alpaca")}
          </button>
        ) : (!isPro || isTrial) ? (
          // Deliberate: excludes isTrial, not just Free — same reasoning as
          // App.jsx's investAlpaca() and Markets.jsx's Buy tab gate. Round-up
          // investing moves real money via Alpaca; a trial user who doesn't
          // convert would be left holding a position with no clean way to
          // unwind it. Paid Pro only.
          // C.proAccent/C.purple deliberately untouched here — feature-branded
          // Pro-upsell accent, out of the DASHBOARD_C migration scope (see
          // colors.js comment: the two must not be merged).
          <div style={{ background: C.proAccent + "12", border: `1px solid ${C.proAccent}33`, borderRadius: RADIUS.md, padding: 16, textAlign: "center" }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.purple, marginBottom: 12 }}>{t("savings.invest_alpaca_pro")}</div>
            <button onClick={onUpgrade} style={{ background: C.proAccent, border: "none", borderRadius: RADIUS.sm, padding: "10px 20px", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>{showRealUpgrade ? t("savings.upgrade_pro") : "Pro"}</button>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <button onClick={() => setShowAlpacaSheet(true)} className="ph-mask"
              style={{ width: "100%", padding: 16, background: DC.emerald, border: "none", borderRadius: RADIUS.md, color: DC.bg, fontSize: 15, fontWeight: 800, cursor: "pointer", boxShadow: `0 4px 20px ${DC.emerald}33` }}>
              {t("savings.invest_amount", { amount: fmtMoney(roundupMonth) })}
            </button>
            <p style={{ fontSize: 11, color: DC.faint, textAlign: "center", margin: 0 }}>{t("savings.small_amounts")}</p>
          </div>
        )}
      </GlassCard>

      {/* Add Goal Modal */}
      {showAdd && (
        <div onClick={() => setShowAdd(false)} style={{ position: "fixed", inset: 0, zIndex: 10000, background: "rgba(7,12,24,0.85)", display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(6px)", padding: 20 }}>
          <GlassCard onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 400, padding: 24, background: DC.card, border: `1px solid ${DC.faint}33` }}>
            <h3 style={{ margin: "0 0 20px", fontSize: 22, fontWeight: 800 }}>{t("savings.new_goal")}</h3>

            {!selectedPreset ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {PRESETS.map(p => (
                  <button key={p.name} onClick={() => { setSelectedPreset(p); setNewName(p.name); setNewTarget(String(p.target)); setNewTargetError(""); }} style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", padding: 16, background: DC.bg, border: `1px solid ${DC.faint}33`, borderRadius: RADIUS.md, color: DC.text, textAlign: "left", cursor: "pointer" }}>
                    <div style={{ width: 40, height: 40, borderRadius: RADIUS.sm, background: DC.card, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <Icon name={p.icon} size={20} color={DC.gold} />
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 15 }}>{p.name}</div>
                      <div style={{ fontSize: 12, color: DC.muted }}>Target: {fmtMoney(p.target)}</div>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div>
                  <label style={{ display: "block", fontSize: 12, color: DC.muted, marginBottom: 8, fontWeight: 600 }}>{t("savings.goal_name").toUpperCase()}</label>
                  <input style={inp} placeholder={t("savings.goal_placeholder")} value={newName} onChange={e => setNewName(e.target.value)} />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 12, color: DC.muted, marginBottom: 8, fontWeight: 600 }}>{t("savings.target_amount_label").toUpperCase()}</label>
                  <input style={{ ...inp, border: newTargetError ? `1px solid ${DC.ruby}` : inp.border }} type="number" placeholder="5000" value={newTarget} onChange={e => { setNewTarget(e.target.value); setNewTargetError(""); }} />
                  {newTargetError && <div style={{ color: DC.ruby, fontSize: 12, fontWeight: 500, marginTop: -6, marginBottom: 4 }}>{newTargetError}</div>}
                </div>

                <div style={{ marginTop: 4 }}>
                   <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                     <label style={{ fontSize: 12, color: DC.muted, fontWeight: 600 }}>{t("savings.savings_account_label").toUpperCase()}</label>
                     <div style={{ display: "flex", background: DC.bg, borderRadius: RADIUS.xs, padding: 2 }}>
                        <button onClick={() => setAccountLinkMode("auto")} style={{ border: "none", background: accountLinkMode === "auto" ? DC.card : "none", color: accountLinkMode === "auto" ? DC.gold : DC.muted, padding: "4px 10px", fontSize: 10, fontWeight: 700, borderRadius: RADIUS.xs, cursor: "pointer" }}>AUTO</button>
                        <button onClick={() => setAccountLinkMode("manual")} style={{ border: "none", background: accountLinkMode === "manual" ? DC.card : "none", color: accountLinkMode === "manual" ? DC.gold : DC.muted, padding: "4px 10px", fontSize: 10, fontWeight: 700, borderRadius: RADIUS.xs, cursor: "pointer" }}>MANUAL</button>
                     </div>
                   </div>

                   {accountLinkMode === "auto" ? (
                     bankConnected ? (
                        loadingAccounts ? <div style={{ padding: 14, textAlign: "center", fontSize: 13, color: DC.muted }}>{t("savings.loading_accounts")}</div> :
                        accountsError ? (
                          <div style={{ padding: 14, textAlign: "center" }}>
                            <div style={{ fontSize: 12, color: DC.ruby, marginBottom: 8 }}>{t("savings.could_not_load_accounts", { error: accountsError })}</div>
                            <button onClick={fetchPlaidAccounts} style={{ background: "none", border: `1px solid ${DC.faint}33`, borderRadius: RADIUS.xs, color: DC.gold, fontSize: 11, padding: "5px 12px", cursor: "pointer" }}>{t("savings.retry")}</button>
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
                               <optgroup label={t("savings.savings_accounts_group")}>
                                 {savingsAccounts.map(a => <option key={a.account_id} value={a.account_id}>{a.name} (••••{a.mask})</option>)}
                               </optgroup>
                            ) : (
                               <option disabled>{t("savings.no_savings_accounts_found")}</option>
                            )}
                            <optgroup label={t("savings.other_accounts_group")}>
                               {plaidAccounts.filter(a => a.subtype !== "savings" && a.type !== "savings").map(a => <option key={a.account_id} value={a.account_id}>{a.name} (••••{a.mask})</option>)}
                            </optgroup>
                          </select>
                        )
                     ) : (
                       <div style={{ padding: 16, background: DC.bg, borderRadius: RADIUS.sm, textAlign: "center" }}>
                         <div style={{ fontSize: 13, color: DC.muted, marginBottom: 12 }}>{t("transactions.connect_bank_hint")}</div>
                         <button onClick={() => { setShowAdd(false); onInsightAction('review_spending'); }} style={{ background: "none", border: `1px solid ${DC.gold}44`, color: DC.gold, borderRadius: RADIUS.sm, padding: "8px 16px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>{t("dashboard.connect_bank")}</button>
                       </div>
                     )
                   ) : (
                     <div style={{ fontSize: 13, color: DC.muted, padding: "10px 0" }}>
                        <Icon name="info" size={14} style={{ marginRight: 6, verticalAlign: "middle" }} />
                        {t("savings.money_stays")}
                     </div>
                   )}
                </div>

                <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
                  <button onClick={handleAdd} style={{ flex: 1, padding: 14, background: DC.gold, border: "none", borderRadius: RADIUS.sm, color: DC.bg, fontWeight: 700, fontSize: 15, cursor: "pointer" }}>{t("savings.create_goal", { name: newName || "Goal" })}</button>
                  <button onClick={() => setSelectedPreset(null)} style={{ padding: "0 14px", background: "none", border: `1px solid ${DC.faint}33`, borderRadius: RADIUS.sm, color: DC.muted, fontWeight: 600, cursor: "pointer" }}><Icon name="arrow-left" size={18} /></button>
                </div>
              </div>
            )}
          </GlassCard>
        </div>
      )}

      {/* Alpaca Confirmation Sheet */}
      {/* Round-up Explainer Modal */}
      {showRoundupModal && (
        <div onClick={() => setShowRoundupModal(false)} style={{ position: "fixed", inset: 0, zIndex: 10000, background: "rgba(7,12,24,0.88)", display: "flex", alignItems: "flex-end", justifyContent: "center", backdropFilter: "blur(6px)" }}>
          <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 430, background: DC.card, borderRadius: "24px 24px 0 0", border: `1px solid ${DC.faint}33`, borderBottom: "none", padding: "28px 20px 36px", fontFamily: FONT, color: DC.text, boxShadow: "0 -8px 48px rgba(0,0,0,0.6)", maxHeight: "80vh", overflowY: "auto" }}>
            <div style={{ width: 36, height: 4, borderRadius: RADIUS.full, background: `${DC.faint}33`, margin: "0 auto 24px" }} />
            <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 16 }}>{t("savings.roundup_explainer_intro")}</div>
            <p style={{ fontSize: 14, color: DC.muted, lineHeight: 1.7, margin: "0 0 14px" }}>{t("savings.roundup_explainer_how")}</p>
            <div style={{ background: DC.bg, border: `1px solid ${DC.gold}33`, borderRadius: RADIUS.sm, padding: "12px 16px", marginBottom: 14 }}>
              <div style={{ fontSize: 13, color: DC.gold, fontWeight: 600 }}>{t("savings.roundup_explainer_example")}</div>
            </div>
            <p style={{ fontSize: 14, color: DC.muted, lineHeight: 1.7, margin: "0 0 14px" }}>{t("savings.roundup_explainer_invest")}</p>
            <p style={{ fontSize: 13, color: DC.faint, lineHeight: 1.7, margin: "0 0 24px" }}>{t("savings.roundup_explainer_toggle")}</p>
            <button onClick={() => setShowRoundupModal(false)} style={{ width: "100%", padding: 14, background: DC.card, border: `1px solid ${DC.faint}33`, borderRadius: RADIUS.sm, color: DC.text, fontSize: 15, fontWeight: 600, cursor: "pointer", fontFamily: FONT }}>
              {t("savings.got_it")}
            </button>
          </div>
        </div>
      )}

      {showAlpacaSheet && (
        <div onClick={() => setShowAlpacaSheet(false)} style={{ position: "fixed", inset: 0, zIndex: 10000, background: "rgba(7,12,24,0.88)", display: "flex", alignItems: "flex-end", justifyContent: "center", backdropFilter: "blur(6px)" }}>
          <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 430, background: DC.card, borderRadius: "24px 24px 0 0", border: `1px solid ${DC.faint}33`, borderBottom: "none", padding: "28px 20px 36px", fontFamily: FONT, color: DC.text, boxShadow: "0 -8px 48px rgba(0,0,0,0.6)" }}>
             <div style={{ width: 36, height: 4, borderRadius: RADIUS.full, background: `${DC.faint}33`, margin: "0 auto 24px" }} />
             <div style={{ textAlign: "center", marginBottom: 28 }}>
                <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 56, height: 56, borderRadius: RADIUS.lg, background: DC.emerald + "18", border: `1px solid ${DC.emerald}44`, marginBottom: 14 }}>
                  <Icon name="trending-up" size={24} color={DC.emerald} strokeWidth={2.5} />
                </div>
                <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 6 }}>{t("savings.confirm_investment")}</div>
                <div style={{ fontSize: 14, color: DC.muted }}>{t("savings.to_invest")}</div>
             </div>
             {/* Real selected symbol (2026-08-24), not the hardcoded "SPDR
                 S&P 500 ETF (SPY)" text this used to be — StockDetail's
                 "Set as round-up investment" is the one source of truth for
                 the choice, this just displays it + a way back there.
                 Ticker only, no fetched company name (see Markets.jsx's
                 own comment on this same tradeoff) — not worth a second
                 market-data call just for this cosmetic detail. */}
             <div style={{ background: DC.bg, border: `1px solid ${DC.faint}33`, borderRadius: RADIUS.md, padding: 20, marginBottom: 24, textAlign: "center" }}>
                <div className="ph-mask" style={{ fontSize: 42, fontWeight: 800, color: DC.text, marginBottom: 4 }}>{fmtMoney(roundupMonth)}</div>
                <div style={{ fontSize: 13, color: DC.muted, fontWeight: 600 }}>{profile?.roundup_symbol ?? "SPY"}</div>
                <button
                  onClick={() => { setShowAlpacaSheet(false); onOpenMarket?.(profile?.roundup_symbol ?? "SPY"); }}
                  style={{ marginTop: 6, background: "none", border: "none", padding: 0, color: DC.gold, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: FONT }}
                >
                  {t("savings.change_roundup_symbol")}
                </button>
             </div>
             <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <button onClick={() => { onInvestAlpaca({ roundUpMonthly: roundupMonth }); setShowAlpacaSheet(false); }} style={{ width: "100%", padding: 18, background: DC.emerald, border: "none", borderRadius: RADIUS.md, color: DC.bg, fontSize: 16, fontWeight: 800, cursor: "pointer" }}>
                   {t("savings.confirm_place_order")}
                </button>
                <button onClick={() => setShowAlpacaSheet(false)} style={{ width: "100%", padding: 14, background: "none", border: `1px solid ${DC.faint}33`, borderRadius: RADIUS.md, color: DC.muted, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
                   {t("common.cancel")}
                </button>
             </div>
             <p style={{ fontSize: 11, color: DC.faint, textAlign: "center", marginTop: 24, lineHeight: 1.5 }}>{t("savings.roundup_body")}</p>
          </div>
        </div>
      )}
    </div>
  );
}
