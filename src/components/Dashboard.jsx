import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../utils/supabase";
import { C, FONT } from "../utils/colors";
import Icon from "./shared/Icon";
import GlassCard from "./shared/GlassCard";
import { fmtMoney } from "./Transactions";
import { logger } from "../utils/logger";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

function fmt(n, dec = 0) {
  return Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

const ACCOUNTS_CACHE_KEY = "arkonomy_accounts_v1";
function getCachedAccounts() {
  try {
    const raw = localStorage.getItem(ACCOUNTS_CACHE_KEY);
    if (!raw) return null;
    const { ts, accounts } = JSON.parse(raw);
    if (Date.now() - ts > 60 * 60 * 1000) return null;
    return accounts;
  } catch { return null; }
}
function setCachedAccounts(accounts) {
  try {
    localStorage.setItem(ACCOUNTS_CACHE_KEY, JSON.stringify({ ts: Date.now(), accounts }));
  } catch {}
}

// ─── Stat Card ───────────────────────────────────────────────
function StatCard({ label, value, icon, color, trend, trendValue, onClick }) {
  return (
    <GlassCard onClick={onClick} style={{ flex: 1, padding: "16px 14px", border: `1px solid ${C.sep}`, cursor: onClick ? "pointer" : "default" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
        <div style={{ width: 32, height: 32, borderRadius: 10, background: color + "18", border: `1px solid ${color}33`, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icon name={icon} size={16} color={color} />
        </div>
        {trend && (
          <div style={{ display: "flex", alignItems: "center", gap: 2, fontSize: 11, fontWeight: 700, color: trend === "up" ? C.green : C.red }}>
            <Icon name={trend === "up" ? "trending-up" : "trending-down"} size={10} />
            {trendValue}
          </div>
        )}
      </div>
      <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, letterSpacing: 0.8, marginBottom: 4, textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: C.text }}>{value}</div>
    </GlassCard>
  );
}

// ─── Market Overview Card ─────────────────────────────────────
function MarketOverview({ onOpenMarket }) {
  const { t } = useTranslation();
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
      logger.error("[MarketOverview] load failed:", e);
      setError(e.message || "Could not load market data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const timer = setInterval(load, 60000);
    return () => clearInterval(timer);
  }, []);

  const MARKET_META = {
    SPY:  { label: "S&P 500",  icon: "bar-chart", color: "#2F80FF" },
    QQQ:  { label: "NASDAQ",   icon: "activity",  color: "#A78BFA" },
    BTC:  { label: "Bitcoin",  icon: "zap",        color: "#F59E0B" },
    ETH:  { label: "Ethereum", icon: "zap",        color: "#34D399" },
  };

  return (
    <GlassCard style={{ padding: 0, overflow: "hidden", marginBottom: 20 }}>
      <div style={{ display: "flex", borderBottom: `1px solid ${C.sep}` }}>
        <button onClick={() => setTab("markets")} style={{ flex: 1, padding: "14px 0", background: "none", border: "none", borderBottom: tab === "markets" ? `2px solid ${C.cyan}` : "none", color: tab === "markets" ? C.text : C.muted, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>{t("dashboard.markets")}</button>
        <button onClick={() => setTab("news")} style={{ flex: 1, padding: "14px 0", background: "none", border: "none", borderBottom: tab === "news" ? `2px solid ${C.cyan}` : "none", color: tab === "news" ? C.text : C.muted, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>NEWS</button>
      </div>

      <div style={{ padding: "18px 16px" }}>
        {loading && markets.length === 0 ? (
          <div style={{ padding: "20px 0", textAlign: "center", color: C.faint, fontSize: 13 }}>{t("dashboard.loading_market_data")}</div>
        ) : error && markets.length === 0 ? (
          <div style={{ padding: "20px 0", textAlign: "center" }}>
            <div style={{ color: C.red, fontSize: 13, marginBottom: 10 }}>{t("dashboard.could_not_load_market_data")}</div>
            <button onClick={load} style={{ background: C.bgSecondary, border: `1px solid ${C.border}`, color: C.cyan, padding: "6px 16px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>{t("dashboard.retry")}</button>
          </div>
        ) : tab === "markets" ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {markets.map(m => {
              const meta = MARKET_META[m.symbol] || { label: m.symbol, icon: "activity", color: C.cyan };
              const up = m.change >= 0;
              return (
                <div key={m.symbol} onClick={() => onOpenMarket(m.symbol)} style={{ background: C.bgSecondary, border: `1px solid ${C.border}`, borderRadius: 12, padding: "12px 14px", cursor: "pointer" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                       <div style={{ width: 22, height: 22, borderRadius: 6, background: meta.color + "14", display: "flex", alignItems: "center", justifyContent: "center" }}>
                         <Icon name={meta.icon} size={11} color={meta.color} />
                       </div>
                       <span style={{ fontSize: 12, fontWeight: 700 }}>{m.symbol}</span>
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 600, color: up ? C.green : C.red }}>{up ? "+" : ""}{m.changePct?.toFixed(2)}%</span>
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 800 }}>${fmt(m.price, 2)}</div>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {news.map((n, i) => (
              <a key={i} href={n.url} target="_blank" rel="noopener" style={{ display: "flex", gap: 12, textDecoration: "none" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: C.text, lineHeight: 1.4, marginBottom: 4 }}>{n.headline}</div>
                  <div style={{ fontSize: 11, color: C.faint }}>{n.source} &middot; {new Date(n.datetime * 1000).toLocaleDateString()}</div>
                </div>
                {n.image && <img src={n.image} style={{ width: 50, height: 50, borderRadius: 8, objectFit: "cover" }} />}
              </a>
            ))}
            {news.length === 0 && <div style={{ textAlign: "center", color: C.faint, fontSize: 13 }}>{t("dashboard.no_news")}</div>}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16 }}>
          <div style={{ fontSize: 10, color: C.faint }}>{t("dashboard.powered_by_finnhub")}</div>
          {lastUpdated && <div style={{ fontSize: 10, color: C.faint }}>Updated {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>}
        </div>
      </div>
    </GlassCard>
  );
}

// ─── Dashboard ────────────────────────────────────────────────
export default function Dashboard({ totalSpent, totalIncome, lastSpent, lastIncome, transactions, spendingByCategory, prevSpendingByCategory, profile, savings, onNavigate, onCatClick, insight, onInsightAction, isShowingLastMonth, isPro, onUpgrade, upcomingCharges = [], onOpenMarket, bankConnected, userId, hideWelcomeBanner = false }) {
  const { t } = useTranslation();
  const [balanceVisible, setBalanceVisible] = useState(true);
  const [accountBalance, setAccountBalance] = useState(null); // primary checking balance from Plaid
  const [otherBreakdown, setOtherBreakdown] = useState(false);
  const m = (n, dec = 0) => balanceVisible ? `$${fmt(n, dec)}` : "••••";

  // Intercept "Other" clicks — show breakdown instead of navigating
  function handleCatClick(cat) {
    if (cat === 'Other') { setOtherBreakdown(true); return; }
    onCatClick?.(cat);
  }

  useEffect(() => {
    if (!bankConnected || !userId) return;
    (async () => {
      try {
        // Use cached accounts if fresh (<1 hr)
        let accounts = getCachedAccounts();
        if (!accounts) {
          const { data: { session } } = await supabase.auth.getSession();
          if (!session) return;
          const res = await fetch(`${SUPABASE_URL}/functions/v1/plaid-get-accounts`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${session.access_token}`, "apikey": SUPABASE_KEY },
            body: "{}",
          });
          if (!res.ok) return;
          const d = await res.json();
          accounts = d.accounts ?? [];
          if (accounts.length) setCachedAccounts(accounts);
        }
        if (!accounts.length) return;
        const checking = accounts.find(a => a.subtype === "checking") ?? accounts.find(a => a.type === "depository") ?? accounts[0];
        const bal = checking?.balance_available ?? checking?.balance_current ?? null;
        if (bal != null) setAccountBalance(bal);
      } catch (err) {
        logger.error("[Dashboard] balance fetch failed:", err);
      }
    })();
  }, [bankConnected, userId]);

  const budget = Number(profile?.monthly_budget) || 3000;
  const balance = totalIncome - totalSpent;

  return (
    <div style={{ paddingBottom: 20, fontFamily: FONT }}>
      {/* Header Stat Cards */}
      <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
        <StatCard
          label={t("dashboard.account_balance")}
          value={accountBalance != null ? m(accountBalance) : "—"}
          icon="credit-card"
          color={C.cyan}
          onClick={() => setBalanceVisible(!balanceVisible)}
        />
        <StatCard
          label={t("dashboard.net_this_month")}
          value={m(balance)}
          icon="activity"
          color={balance >= 0 ? C.green : C.red}
          trend={balance >= 0 ? "up" : "down"}
          trendValue={balance >= 0 ? t("dashboard.surplus") : t("dashboard.deficit")}
        />
      </div>

      <MarketOverview onOpenMarket={onOpenMarket} />

      {/* Main Stats */}
      <GlassCard style={{ padding: "20px 18px", marginBottom: 20 }}>
         <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 20 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.muted, letterSpacing: 1, marginBottom: 6 }}>{t("dashboard.monthly_cash_flow").toUpperCase()}</div>
              <div style={{ fontSize: 32, fontWeight: 800, color: C.text }}>{m(totalSpent)}</div>
              <div style={{ fontSize: 13, color: C.muted, marginTop: 4 }}>{t("dashboard.total_spent")} {t("dashboard.this_month")}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.green }}>{m(totalIncome)}</div>
              <div style={{ fontSize: 11, color: C.faint }}>{t("dashboard.income")}</div>
            </div>
         </div>

         {/* Budget Progress */}
         <div style={{ marginBottom: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
              <span style={{ color: C.muted }}>{t("dashboard.budget")} (${fmt(budget)})</span>
              <span style={{ color: totalSpent > budget ? C.red : C.cyan }}>{Math.round((totalSpent / budget) * 100)}%</span>
            </div>
            <div style={{ height: 10, background: C.bgSecondary, borderRadius: 5, overflow: "hidden" }}>
              <div style={{ height: "100%", background: totalSpent > budget ? C.red : `linear-gradient(90deg, ${C.cyan}, ${C.blue})`, width: `${Math.min(100, (totalSpent / budget) * 100)}%`, borderRadius: 5, transition: "width 0.8s ease-out" }} />
            </div>
         </div>
      </GlassCard>

      {/* Quick Actions */}
      <div style={{ display: "flex", gap: 12, marginBottom: 24 }}>
        <button onClick={() => onNavigate("transactions")} style={{ flex: 1, padding: "14px 0", background: C.bgSecondary, border: `1px solid ${C.border}`, borderRadius: 14, color: C.text, fontSize: 14, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
          <Icon name="list" size={16} color={C.cyan} />
          {t("nav.transactions")}
        </button>
        <button onClick={() => onNavigate("insights")} style={{ flex: 1, padding: "14px 0", background: C.bgSecondary, border: `1px solid ${C.border}`, borderRadius: 14, color: C.text, fontSize: 14, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
          <Icon name="zap" size={16} color={C.yellow} />
          {t("nav.insights")}
        </button>
      </div>

      {/* Spending Breakdown */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: C.muted, letterSpacing: 1 }}>{t("dashboard.spending_by_category").toUpperCase()}</h4>
          <span style={{ fontSize: 11, color: C.faint }}>{t("dashboard.tap_to_filter")}</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {Object.entries(spendingByCategory)
            .sort((a, b) => b[1] - a[1])
            .map(([cat, amt]) => (
              <div key={cat} onClick={() => handleCatClick(cat)} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 16px", background: C.card, border: `1px solid ${C.sep}`, borderRadius: 16, cursor: "pointer" }}>
                <div style={{ width: 36, height: 36, borderRadius: 12, background: C.bgSecondary, display: "flex", alignItems: "center", justifyContent: "center" }}>
                   <Icon name={cat.toLowerCase().replace(/ & /g, "-")} size={16} color={C.cyan} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{cat}</div>
                  <div style={{ fontSize: 11, color: C.faint }}>{Math.round((amt / totalSpent) * 100)}% {t("dashboard.of_total")}</div>
                </div>
                <div style={{ fontSize: 15, fontWeight: 700 }}>${fmt(amt)}</div>
              </div>
            ))
          }
          {Object.keys(spendingByCategory).length === 0 && (
            <div style={{ padding: "30px 0", textAlign: "center", color: C.faint, fontSize: 14 }}>{t("dashboard.no_spending_data")}</div>
          )}
        </div>
      </div>
    </div>
  );
}
