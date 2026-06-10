import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { C, FONT } from "../utils/colors";
import Icon from "./shared/Icon";

export const CHAT_SUGGESTIONS_BY_SCREEN = {
  dashboard: [
    "What did I spend most on this month?",
    "Am I on track with my budget?",
    "How can I reduce my top spending category?",
    "What's my monthly cash flow trend?",
  ],
  transactions: [
    "Help me analyze my recent transactions",
    "What are my biggest expenses this month?",
    "Find any unusual or duplicate charges",
    "Compare my spending to last month",
  ],
  markets: [
    "What's the outlook for my watchlist?",
    "Should I invest in SPY or QQQ right now?",
    "Explain the current market conditions",
    "What's a good ETF for long-term growth?",
  ],
  savings: [
    "How can I reach my savings goal faster?",
    "What's a realistic savings plan for me?",
    "How much should I be saving each month?",
    "Help me prioritize my savings goals",
  ],
  insights: [
    "Explain my financial health score",
    "What's my biggest financial risk right now?",
    "How do I improve my score?",
    "What should I focus on this month?",
  ],
};

const FAQ_ANSWERS = {
  "How do I connect my bank?":
    "Go to Settings (gear icon, top right) → tap Connect Bank. Arkonomy uses Plaid — a secure, read-only connection. Your bank credentials are never stored. Once connected, transactions sync automatically every day.",
  "Why are my transactions wrong?":
    "Transactions come from your bank via Plaid and are auto-categorized. If something looks off:\n• Pull to refresh to trigger a re-sync\n• Zelle/Venmo show as Transfers (excluded from spending totals by design)\n• Some merchants land in Other if Plaid can't identify them — the app re-categorizes many at display time\n• Future syncs apply improved category logic automatically",
  "What is Health Score?":
    "Your Health Score (0–100) measures 4 things:\n1. Savings Rate (30 pts) — % of income saved\n2. Budget Adherence (25 pts) — how close you are to your monthly limit\n3. Income Stability (25 pts) — consistency vs. last month\n4. Spending Control (20 pts) — whether spending is growing or shrinking\n\nAbove 70 is healthy. Below 50 means action is needed.",
  "How do I set a savings goal?":
    "Go to the Savings tab → tap + Goal. Enter a name and target amount. You can link a real savings account (via Plaid) so the balance syncs automatically, or track it manually. Each goal shows an AI forecast for when you'll reach it based on your current savings rate.",
  "What is Cash Flow Forecast?":
    "The Cash Flow Forecast card on the Dashboard projects your balance by end of month using:\n• Your current account balance\n• Your average daily spending this month\n• Known upcoming recurring bills\n\nOn Track = comfortable buffer remaining\nAt Risk = less than 12% of balance will remain\nDeficit = projected to go negative",
  "How do I cancel a subscription?":
    "Arkonomy shows your recurring charges but can't cancel them — that has to be done through the service directly.\n\nTo find subscriptions: check Dashboard → Upcoming Charges, or go to Transactions and filter by Subscriptions. Then cancel via that service's website or app settings.",
};

export default function Chat({ messages, input, setInput, onSend, onClose, suggestions = CHAT_SUGGESTIONS_BY_SCREEN.dashboard, onHelpAnswer }) {
  const { t } = useTranslation();
  const bottomRef = useRef(null);
  const [showFaqMenu, setShowFaqMenu] = useState(false);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const isWelcomeOnly = messages.length === 1 && messages[0].role === "assistant";
  const isLoading = messages.some(m => m.loading);

  function sendSuggestion(text) { setInput(text); onSend(text); }

  function handleFaqSelect(q) {
    setShowFaqMenu(false);
    onHelpAnswer?.(q, FAQ_ANSWERS[q]);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: onClose ? "100%" : "auto", paddingBottom: onClose ? 0 : 80 }}>
      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10, marginTop: 10, marginBottom: 10 }}>
        {messages.map((m, i) => (
          <div key={i} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", background: m.role === "user" ? `linear-gradient(90deg,${C.cyan},${C.blue})` : C.card, color: m.role === "user" ? "#fff" : C.text, padding: "12px 16px", borderRadius: m.role === "user" ? "18px 18px 4px 18px" : "18px 18px 18px 4px", maxWidth: "82%", fontSize: 14, border: m.role === "assistant" ? `1px solid ${C.border}` : "none", lineHeight: 1.65, fontWeight: m.role === "user" ? 500 : 400, whiteSpace: "pre-line" }}>
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
            {suggestions.map(q => (
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
            {/* Help & FAQ button — always visible alongside suggestions */}
            <button
              onClick={() => setShowFaqMenu(v => !v)}
              style={{ alignSelf: "flex-start", background: showFaqMenu ? C.purple + "22" : C.bgTertiary, border: `1px solid ${showFaqMenu ? C.purple + "66" : C.border}`, borderRadius: 20, padding: "8px 14px", color: showFaqMenu ? C.purple : C.muted, fontSize: 13, cursor: "pointer", fontFamily: FONT, fontWeight: 600 }}
            >
              {t("chat.help_faq")}
            </button>
            {showFaqMenu && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 2, padding: "10px 12px", background: C.card, border: `1px solid ${C.border}`, borderRadius: 14 }}>
                <div style={{ fontSize: 11, color: C.faint, fontWeight: 600, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 2 }}>{t("chat.choose_topic")}</div>
                {Object.keys(FAQ_ANSWERS).map(q => (
                  <button
                    key={q}
                    onClick={() => handleFaqSelect(q)}
                    style={{ textAlign: "left", background: "none", border: `1px solid ${C.border}`, borderRadius: 10, padding: "8px 12px", color: C.text, fontSize: 13, cursor: "pointer", fontFamily: FONT, lineHeight: 1.4 }}
                    onPointerEnter={e => { e.currentTarget.style.borderColor = C.purple + "66"; e.currentTarget.style.background = C.purple + "0E"; }}
                    onPointerLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.background = "none"; }}
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      <div style={{ fontSize: 10, color: C.faint, textAlign: "center", marginBottom: 8, lineHeight: 1.5, flexShrink: 0 }}>
        {t("chat.disclaimer")}
      </div>
      <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
        <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && !isLoading && onSend()} placeholder={t("chat.ask_placeholder")} style={{ flex: 1, padding: "13px 16px", background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, color: C.text, fontSize: 14, fontFamily: FONT }} disabled={isLoading} />
        <button onClick={onSend} disabled={isLoading} style={{ padding: "13px 18px", background: isLoading ? C.border : `linear-gradient(90deg,${C.cyan},${C.blue})`, border: "none", borderRadius: 14, cursor: isLoading ? "not-allowed" : "pointer", display: "flex", alignItems: "center", opacity: isLoading ? 0.5 : 1 }}>
          <Icon name="send" size={16} color="#fff" strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}
