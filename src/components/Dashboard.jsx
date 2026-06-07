import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { supabase, SUPABASE_URL, SUPABASE_KEY } from "../utils/supabase";
import { C, FONT } from "../utils/colors";
import { fmt, fmtDate, parseDate, fmtPct, resolveCategory, tCat } from "../utils/helpers";
import Icon from "./shared/Icon";
import GlassCard from "./shared/GlassCard";
import { calculateHealthScore, generateHealthComment, getScoreLabel } from "../healthScore";
import { InsightCard } from "./Insights";
import UpcomingChargesCard from "./UpcomingChargesCard";
import { TxRow } from "./Transactions";

const ACCOUNTS_CACHE_KEY = "arkonomy_accounts_v1";
const ACCOUNTS_CACHE_TTL = 60 * 60 * 1000;
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
  try { localStorage.setItem(ACCOUNTS_CACHE_KEY, JSON.stringify({ ts: Date.now(), accounts })); } catch {}
}

const CAT_COLORS = {
  "Housing":       "#60A5FA",
  "Bills":         "#A78BFA",
  "Subscriptions": "#A78BFA",
  "Shopping":      "#FB923C",
  "Food & Dining": "#F87171",
  "Transport":     "#2DD4BF",
  "Transportation":"#2DD4BF",
  "Entertainment": "#F472B6",
  "Health":        "#4ADE80",
  "Health & Fitness": "#34D399",
  "Personal Care": "#FBBF24",
  "Travel":        "#818CF8",
  "Education":     "#38BDF8",
  "Taxes":         "#F59E0B",
  "Government":    "#94A3B8",
  "Charity":       "#EC4899",
  "Fees":          "#EF4444",
  "Cost of Debt":  "#F97316",
  "Utilities":     "#67E8F9",
  "Transfers":     "#6366F1",
  "Other":         "#94A3B8",
  "Transfer":      "#475569",
  "Income":        "#34D399",
};

// ─── Health Score Gauge ──────────────────────────────────────────────────────
// ─── Health Score Bar (compact, inline, expandable) ─────────────────────────
function HealthScoreBar({ score, color, comment, breakdown, hasData = true }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const label = getScoreLabel(score);

  if (!hasData) {
    return (
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: "10px 14px", fontFamily: FONT }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: C.faint, flexShrink: 0 }} />
          <span style={{ fontSize: 12, fontWeight: 500, color: C.muted, flexShrink: 0 }}>{t("dashboard.health_score")}</span>
          <span style={{ fontSize: 12, color: C.faint }}>{t("dashboard.connect_bank_score")}</span>
        </div>
      </div>
    );
  }

  const rows = [
    {
      key: "savings",
      label: t("insights.savings_rate_label"),
      pts: breakdown?.savings?.points ?? 0,
      max: 30,
      detail: breakdown?.savings?.rate != null
        ? t("dashboard.pct_income_saved", { pct: Math.round(breakdown.savings.rate * 100) })
        : null,
      na: !hasData,
    },
    {
      key: "budget",
      label: t("insights.budget_adherence"),
      pts: breakdown?.budget?.points ?? 0,
      max: 25,
      detail: null,
      na: !hasData,
    },
    {
      key: "recurring",
      label: t("insights.recurring_charges"),
      pts: breakdown?.recurring?.points ?? 0,
      max: 20,
      detail: breakdown?.recurring?.ratio != null
        ? t("dashboard.pct_income", { pct: Math.round(breakdown.recurring.ratio * 100) })
        : null,
      na: !hasData,
    },
    {
      key: "trend",
      label: t("insights.balance_trend"),
      pts: breakdown?.trend?.points ?? 0,
      max: 25,
      detail: (() => {
        const d = breakdown?.trend;
        if (!d) return null;
        const delta = d.thisBalance - d.lastBalance;
        return delta >= 0
          ? t("dashboard.vs_last_month_pos", { delta: Math.round(delta) })
          : t("dashboard.vs_last_month_neg", { delta: Math.round(Math.abs(delta)) });
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
          {t("dashboard.health_score")}
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
          {t(label)} — {comment.rawCat ? t(comment.key, { cat: tCat(comment.rawCat, t), ...comment.params }) : t(comment.key)}
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
            <span style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>{t("dashboard.total_score")}</span>
            <span style={{ fontSize: 13, fontWeight: 800, color }}>
              {score}<span style={{ fontSize: 11, fontWeight: 400, color: C.faint }}>/100</span>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function StatBadge({ value, suffix }) {
  const { t } = useTranslation();
  const pos = value >= 0;
  const color = pos ? C.green : C.red;
  const sfx = suffix !== undefined ? suffix : t("dashboard.vs_last_month");
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 3, background: color + "22", color, borderRadius: 100, padding: "2px 8px", fontSize: 10, fontWeight: 600, fontFamily: FONT, whiteSpace: "nowrap" }}>
      <Icon name={pos ? "trending-up" : "trending-down"} size={9} color={color} strokeWidth={2.5} />
      {pos ? "+" : ""}{Math.abs(value).toFixed(1)}% {sfx}
    </span>
  );
}

function DonutChart({ data, size = 196, onCatClick, hideAmounts = false, lockList = false, onUpgrade }) {
  const { t } = useTranslation();
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
      {t("dashboard.no_spending_data_short")}
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
              <div style={{ fontSize: 10, color: "#ffffff", fontWeight: 600, letterSpacing: 0.5, marginBottom: 2, textAlign: "center", padding: "0 4px" }}>{tCat(hovered, t)}</div>
              <div style={{ fontSize: 17, fontWeight: 800, color: CAT_COLORS[hovered] || C.cyan }}>{hideAmounts ? "••••" : `$${fmt((data[hovered] || 0), 0)}`}</div>
              <div style={{ fontSize: 11, color: "#ffffff", fontWeight: 600 }}>{Math.round(((data[hovered] || 0) / total) * 100)}%</div>
            </>
          ) : (
            <>
             <div style={{ fontSize: 20, fontWeight: 800, color: "#ffffff", letterSpacing: -0.5, marginBottom: 2 }}>{hideAmounts ? "••••" : `$${fmt(total, 0)}`}</div>
           <div style={{ fontSize: 10, color: "#9AA4B2", letterSpacing: 0.5, fontWeight: 600 }}>{t("dashboard.total_spent")}</div>
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
              <span style={{ fontSize: 13, color: i === 0 ? C.text : C.muted, fontWeight: i === 0 ? 600 : 400, flex: 1 }}>{tCat(s.cat, t)}</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: i === 0 ? '#ffffff' : C.text }}>{hideAmounts ? "••••" : `$${fmt(s.val, 0)}`}</span>
              <span style={{ fontSize: 11, color: s.color, fontWeight: i === 0 ? 700 : 500, minWidth: 36, textAlign: "right" }}>{Math.round((s.val / total) * 100)}%</span>
              {onCatClick && <Icon name="chevron" size={12} color={C.faint} />}
            </div>
          ))}
        </div>
        {lockList && (
          <div onClick={onUpgrade} style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: C.muted, background: C.card, padding: "5px 14px", borderRadius: 20, border: `1px solid ${C.border}` }}>
              {t("dashboard.unlock_full_breakdown")}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Market Overview Card ─────────────────────────────��───────
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
      setError(e.message || "Could not load market data");
    }
    setLoading(false);
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
    <GlassCard style={{ padding: "14px 16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: C.blue + "22", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name="bar-chart" size={14} color={C.blue} />
          </div>
          <span style={{ fontWeight: 600, fontSize: 14 }}>{t("dashboard.markets")}</span>
          {lastUpdated && !loading && (
            <span style={{ fontSize: 10, color: C.faint }}>
              {lastUpdated.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          {["markets", "news"].map(tabId => (
            <button key={tabId} onClick={() => setTab(tabId)}
              style={{ padding: "4px 10px", borderRadius: 20, border: `1px solid ${tab === tabId ? C.blue : C.border}`, background: tab === tabId ? C.blue + "18" : "transparent", color: tab === tabId ? C.blue : C.faint, cursor: "pointer", fontSize: 11, fontWeight: tab === tabId ? 600 : 400, fontFamily: FONT, textTransform: "capitalize" }}>
              {tabId}
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
          <div style={{ marginTop: 8, fontSize: 11 }}>{t("dashboard.loading_market_data")}</div>
        </div>
      ) : error ? (
        <div style={{ padding: "12px 14px", background: C.red + "10", borderRadius: 12, border: `1px solid ${C.red}22` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
            <Icon name="alert-circle" size={14} color={C.red} />
            <span style={{ fontSize: 12, color: C.red, fontWeight: 600 }}>{t("dashboard.could_not_load_market_data")}</span>
          </div>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 10, lineHeight: 1.5 }}>{error}</div>
          <button onClick={load} style={{ marginTop: 10, padding: "7px 14px", background: C.blue + "22", border: `1px solid ${C.blue}44`, borderRadius: 8, color: C.blue, cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: FONT }}>
            {t("dashboard.retry")}
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
            ? <div style={{ color: C.faint, fontSize: 12, textAlign: "center", padding: "16px 0" }}>{t("dashboard.no_news")}</div>
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
          {t("dashboard.powered_by_finnhub")}
        </div>
      )}
    </GlassCard>
  );
}

// ─── Cash Flow Forecast ──────────────────────────────────────
function Sparkline({ transactions, width = 62, height = 30 }) {
  const points = useMemo(() => {
    const now = new Date();
    const days = {};
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now); d.setDate(d.getDate() - i);
      days[d.toISOString().slice(0, 10)] = 0;
    }
    transactions.forEach(t => {
      const key = (t.date || '').slice(0, 10);
      if (!(key in days)) return;
      const amt = Number(t.amount);
      if (t.type === 'income') days[key] += amt;
      else if (t.type === 'expense' && t.category_name !== 'Transfer') days[key] -= amt;
    });
    let run = 0;
    return Object.keys(days).sort().map(k => { run += days[k]; return run; });
  }, [transactions]);
  if (points.length < 2) return null;
  const min = Math.min(...points), max = Math.max(...points);
  const range = max - min || 1;
  const pad = 3;
  const pts = points.map((v, i) => {
    const x = ((i / (points.length - 1)) * width).toFixed(1);
    const y = (height - pad - ((v - min) / range) * (height - pad * 2)).toFixed(1);
    return `${x},${y}`;
  }).join(' ');
  const up = points[points.length - 1] >= points[0];
  return (
    <svg width={width} height={height} style={{ display: 'block', flexShrink: 0, opacity: 0.9 }}>
      <polyline points={pts} fill="none" stroke={up ? '#12D18E' : '#FF5C7A'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CashFlowForecast({ accountBalance, balance, totalSpent, transactions, upcomingCharges, balanceVisible }) {
  const { t } = useTranslation();
  const today       = new Date();
  const dayOfMonth  = today.getDate();
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const remainingDays = daysInMonth - dayOfMonth;

  // Need at least 2 days of data for a meaningful rate
  if (dayOfMonth < 2 || transactions.length === 0) return null;

  const startBalance = accountBalance ?? balance;

  // Fixed categories: already paid, do not extrapolate forward
  const FIXED_CATS = new Set(['Housing', 'Bills', 'Subscriptions', 'Utilities']);

  const isThisMonth = tx => {
    const d = new Date(tx.date + 'T00:00:00');
    return d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear();
  };

  const thisMonthExpenses = transactions.filter(tx => tx.type === 'expense' && isThisMonth(tx));

  // Variable spending only (Food, Shopping, Transport, Entertainment, Other)
  const variableSpent = thisMonthExpenses
    .filter(t => {
      const cat = resolveCategory(t);
      return !FIXED_CATS.has(cat) && cat !== 'Transfers' && cat !== 'Transfer';
    })
    .reduce((s, t) => s + Math.abs(Number(t.amount)), 0);

  const daysElapsed = Math.max(dayOfMonth, 1);
  const dailyVariableRate = variableSpent / daysElapsed;
  const projectedVariable = dailyVariableRate * remainingDays;

  // Income: current month vs 3-month average
  const currentMonthIncome = transactions
    .filter(t => t.type === 'income' && isThisMonth(t))
    .reduce((s, t) => s + Math.abs(Number(t.amount)), 0);

  const avgMonthlyIncome = (() => {
    const curKey = `${today.getFullYear()}-${today.getMonth()}`;
    const byMonth = {};
    for (const t of transactions) {
      if (t.type !== 'income') continue;
      const d = new Date(t.date + 'T00:00:00');
      const k = `${d.getFullYear()}-${d.getMonth()}`;
      if (k === curKey) continue;
      byMonth[k] = (byMonth[k] || 0) + Math.abs(Number(t.amount));
    }
    const vals = Object.values(byMonth).sort((a, b) => a - b).slice(-3);
    return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : currentMonthIncome;
  })();

  const projectedIncome = Math.max(currentMonthIncome, avgMonthlyIncome);
  const remainingIncome = Math.max(0, projectedIncome - currentMonthIncome);
  const upcomingTotal   = upcomingCharges.reduce((s, c) => s + Number(c.amount), 0);
  const projectedBalance = Math.min(
    startBalance + remainingIncome - projectedVariable,
    startBalance + avgMonthlyIncome
  );

  if (dailyVariableRate < 0.01 && upcomingTotal === 0) return null;

  const status = projectedBalance <= 0
    ? 'deficit'
    : startBalance > 0 && projectedBalance / startBalance < 0.12
    ? 'at_risk'
    : 'on_track';

  const S = {
    on_track: { label: t('dashboard.on_track'), color: C.green,  bg: C.green  + '15', border: C.green  + '38' },
    at_risk:  { label: t('dashboard.at_risk'),  color: C.yellow, bg: C.yellow + '12', border: C.yellow + '30' },
    deficit:  { label: t('dashboard.deficit'),  color: C.red,    bg: C.red    + '12', border: C.red    + '30' },
  }[status];

  const barPct = startBalance > 0
    ? Math.max(Math.min(projectedBalance / startBalance * 100, 100), 0)
    : 0;

  const endOfMonth = new Date(today.getFullYear(), today.getMonth(), daysInMonth)
    .toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  const mask  = n => balanceVisible ? (n < 0 ? `-$${fmt(Math.abs(n), 0)}` : `$${fmt(n, 0)}`) : '••••';

  return (
    <div style={{ background: 'linear-gradient(145deg,#0E1E35,#0B1426)', borderRadius: 20, padding: '16px 18px', border: `1px solid ${S.border}`, position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: -24, right: -24, width: 90, height: 90, borderRadius: '50%', background: S.color + '09', pointerEvents: 'none' }} />

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontSize: 10, color: C.muted, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase' }}>{t('dashboard.cash_flow_forecast')}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, background: S.bg, border: `1px solid ${S.border}`, borderRadius: 99, padding: '3px 9px' }}>
          <div style={{ width: 6, height: 6, borderRadius: 99, background: S.color }} />
          <span style={{ fontSize: 11, fontWeight: 700, color: S.color, letterSpacing: 0.2 }}>{S.label}</span>
        </div>
      </div>

      {/* Projected balance */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 34, fontWeight: 800, letterSpacing: -1, color: balanceVisible ? S.color : C.text, lineHeight: 1.1, textShadow: balanceVisible ? `0 0 20px ${S.color}30` : 'none' }}>
          {mask(projectedBalance)}
        </div>
        <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>
          {t('dashboard.projected_by_prefix')} <strong style={{ color: C.text }}>{endOfMonth}</strong>
          <span style={{ color: C.faint }}> · {t('dashboard.days_left', { count: remainingDays })}</span>
        </div>
      </div>

      {/* Burn-down bar */}
      <div style={{ height: 8, borderRadius: 99, background: C.bgTertiary, overflow: 'hidden', marginBottom: 14 }}>
        <div style={{ height: '100%', width: `${barPct}%`, background: `linear-gradient(90deg,${S.color},${S.color}BB)`, borderRadius: 99, transition: 'width 0.6s', boxShadow: barPct > 0 ? `0 0 8px ${S.color}40` : 'none' }} />
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 0 }}>
        {[
          { label: t('dashboard.balance_now'),    value: mask(startBalance),          color: C.text  },
          { label: t('dashboard.daily_avg'),      value: balanceVisible ? `$${fmt(dailyVariableRate, 0)}${t('dashboard.per_day')}` : '••••', color: C.muted },
          { label: t('dashboard.upcoming_bills'), value: upcomingTotal > 0 ? mask(upcomingTotal) : '—', color: upcomingTotal > 0 ? C.yellow : C.faint },
        ].map((item, i) => (
          <div key={item.label} style={{ paddingLeft: i > 0 ? 12 : 0, borderLeft: i > 0 ? `1px solid ${C.sep}` : 'none', marginLeft: i > 0 ? 0 : 0 }}>
            <div style={{ fontSize: 9, color: C.faint, fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 3 }}>{item.label}</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: item.color }}>{item.value}</div>
          </div>
        ))}
      </div>
    </div>
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
          console.log("[dashboard] cache miss — calling plaid-get-accounts");
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
      } catch {}
    })();
  }, [bankConnected, userId]);
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

      {/* 0a ── Onboarding welcome card (shown only when no transactions exist and no active trial toast) */}
      {transactions.length === 0 && !hideWelcomeBanner && (
        <div style={{ background: "linear-gradient(135deg,#0D2A4A,#0B1A30)", borderRadius: 20, padding: "20px 18px", border: `1px solid ${C.cyan}33`, boxShadow: `0 4px 24px ${C.cyan}12` }}>
          <div style={{ fontSize: 22, marginBottom: 6 }}>👋</div>
          <div style={{ fontWeight: 700, fontSize: 17, color: C.text, marginBottom: 4 }}>{t("dashboard.welcome_title")}</div>
          <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.6, marginBottom: 16 }}>
            {t("dashboard.welcome_body")}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => onNavigate("profile")}
              style={{ flex: 1, padding: "11px 0", background: `linear-gradient(90deg,${C.cyan},${C.blue})`, border: "none", borderRadius: 12, color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: FONT, boxShadow: `0 4px 14px ${C.cyan}44` }}
            >
              {t("dashboard.connect_bank")}
            </button>
            <button
              onClick={() => onNavigate("transactions")}
              style={{ flex: 1, padding: "11px 0", background: C.bgTertiary, border: `1px solid ${C.border}`, borderRadius: 12, color: C.text, fontWeight: 600, fontSize: 13, cursor: "pointer", fontFamily: FONT }}
            >
              {t("dashboard.add_transaction")}
            </button>
          </div>
        </div>
      )}

      {/* 0b ── Upcoming Recurring Charges — horizontal carousel */}
      {upcomingCharges.length > 0 && (
        <UpcomingChargesCard charges={upcomingCharges} />
      )}

      {/* 1 ── Account Balance */}
      <div data-tutorial="net-balance" style={{ background: "linear-gradient(145deg,#0D1F3C,#0B1426)", borderRadius: 20, padding: "16px 18px", border: `1px solid #1E2D4A`, position: "relative", overflow: "hidden", boxShadow: "0 4px 32px rgba(0,194,255,0.08)" }}>
        <div style={{ position: "absolute", top: -30, right: -30, width: 110, height: 110, borderRadius: "50%", background: C.cyan + "0B", pointerEvents: "none" }} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <span style={{ fontSize: 10, color: C.muted, letterSpacing: 1, fontWeight: 600, textTransform: "uppercase" }}>
            {accountBalance != null ? t("dashboard.account_balance") : t("dashboard.net_balance")}
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {isShowingLastMonth && <span style={{ fontSize: 9, color: C.yellow, fontWeight: 600, background: C.yellow + "18", padding: "2px 7px", borderRadius: 99, letterSpacing: 0.3 }}>
              {new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1).toLocaleString('en-US', { month: 'short' })} data
            </span>}
            <button onClick={() => setBalanceVisible(v => !v)} style={{ background: "none", border: "none", cursor: "pointer", padding: "2px", display: "flex" }}>
              <Icon name={balanceVisible ? "eye" : "eye-off"} size={15} color={C.faint} />
            </button>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 8 }}>
          <div>
            <div style={{ fontSize: 40, fontWeight: 800, letterSpacing: -1.5, color: balanceVisible ? (accountBalance != null ? C.cyan : balColor) : C.text, lineHeight: 1.1, textShadow: balanceVisible ? `0 0 24px ${accountBalance != null ? C.cyan : balColor}44` : "none" }}>
              {accountBalance != null
                ? (balanceVisible ? `$${fmt(accountBalance)}` : "••••")
                : (balanceVisible ? (balance < 0 ? `-$${fmt(Math.abs(balance))}` : `$${fmt(balance)}`) : "••••")}
            </div>
            <div style={{ fontSize: 9, color: accountBalance == null && balance < 0 ? C.red : C.faint, marginTop: 2, letterSpacing: 0.5 }}>
              {accountBalance != null ? t("dashboard.available_in_bank") : balance < 0 ? t("dashboard.spent_more_than_earned") : t("dashboard.net_this_month")}
            </div>
          </div>
          <Sparkline transactions={transactions} />
        </div>
      </div>

      {/* 2 ── Cash Flow Forecast */}
      <CashFlowForecast
        accountBalance={accountBalance}
        balance={balance}
        totalSpent={totalSpent}
        transactions={transactions}
        upcomingCharges={upcomingCharges}
        balanceVisible={balanceVisible}
      />


      {/* 3 ── Monthly Cash Flow */}
      <div style={{ background: "linear-gradient(145deg,#0D1F3C,#0B1426)", borderRadius: 16, padding: "14px 18px", border: `1px solid #1E2D4A` }}>
        <div style={{ fontSize: 10, color: C.muted, letterSpacing: 1, fontWeight: 600, textTransform: "uppercase", marginBottom: 12 }}>{t("dashboard.monthly_cash_flow")}</div>
        <div style={{ display: "flex" }}>
          {[
            { label: t("dashboard.income"),   value: m(totalIncome), color: C.green, dot: C.green, change: incomeChange },
            { label: t("dashboard.expenses"), value: m(totalSpent),  color: C.red,   dot: C.red,   change: expenseChange, flip: true },
            { label: t("dashboard.net"),      value: balanceVisible ? (balance < 0 ? `-$${fmt(Math.abs(balance))}` : `$${fmt(balance)}`) : "••••", color: balance >= 0 ? C.green : C.red, dot: balance >= 0 ? C.green : C.red },
          ].map((item, i) => (
            <div key={item.label} style={{ flex: 1, paddingLeft: i > 0 ? 10 : 0, borderLeft: i > 0 ? `1px solid ${C.sep}` : "none", marginLeft: i > 0 ? 10 : 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 2 }}>
                <div style={{ width: 5, height: 5, borderRadius: 99, background: item.dot }} />
                <span style={{ fontSize: 9, color: C.muted, fontWeight: 500 }}>{item.label}</span>
              </div>
              <div style={{ fontSize: item.label === "Net" ? 17 : 13, fontWeight: item.label === "Net" ? 800 : 700, color: item.color, marginBottom: 3 }}>{item.value}</div>
              {item.change !== undefined && <StatBadge value={item.flip ? -item.change : item.change} suffix="" />}
            </div>
          ))}
        </div>
      </div>

      {/* 2 ── Financial Health Score */}
      <div data-tutorial="health-score">
        <HealthScoreBar score={healthScore} color={scoreColor} comment={healthComment} breakdown={scoreBreakdown} hasData={totalIncome > 0 || totalSpent > 0} />
        <button
          onClick={() => onNavigate("insights")}
          style={{ display: "flex", alignItems: "center", gap: 4, margin: "6px 0 0 2px", background: "none", border: "none", cursor: "pointer", padding: 0, fontFamily: FONT }}
        >
          <span style={{ fontSize: 13, fontWeight: 600, color: C.cyan }}>{t("dashboard.view_insights")}</span>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={C.cyan} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block" }}>
            <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
          </svg>
        </button>
      </div>

      {/* 2b ── AI Brain Insight */}
      <div data-tutorial="ai-insight">
        <InsightCard insight={insight?.type === 'savings_opportunity' && balance <= 0 ? null : insight} onAction={onInsightAction} />
      </div>

      {/* 3 ── Spending by Category */}
      <GlassCard style={{ padding: "14px 16px", boxShadow: "0 4px 24px rgba(0,0,0,0.12)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>{t("dashboard.spending_by_category")}</span>
          {isPro
            ? <span style={{ fontSize: 10, color: C.faint, background: C.bgTertiary, padding: "3px 8px", borderRadius: 99 }}>{t("dashboard.tap_to_filter")}</span>
            : <span style={{ fontSize: 10, color: C.cyan + "AA", background: C.cyan + "10", padding: "3px 8px", borderRadius: 99, cursor: "pointer" }} onClick={onUpgrade}>{t("common.pro_badge")}</span>
          }
        </div>
        {Object.keys(spendingByCategory).length === 0 ? (
          <div style={{ textAlign: "center", padding: "24px 0", color: C.faint, fontSize: 13 }}>
            {t("dashboard.no_spending_data")}
          </div>
        ) : (
          <DonutChart data={spendingByCategory} size={152} onCatClick={isPro ? handleCatClick : null} hideAmounts={!balanceVisible} lockList={!isPro} onUpgrade={onUpgrade} />
        )}
      </GlassCard>

      {/* 7 ── Monthly Budget (compact) */}
      {(() => {
        const isOver = totalSpent > budget;
        const budgetPct = budget > 0 ? (totalSpent / budget) * 100 : 0;
        const barColor = isOver ? C.red : budgetPct > 70 ? C.yellow : C.cyan;
        return (
          <GlassCard style={{ padding: "10px 16px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ fontSize: 13, color: C.muted }}>
                <span style={{ fontWeight: 600, color: C.text }}>{t("dashboard.budget")}</span>
                {'  '}{m(totalSpent)} / {m(budget)}
              </span>
              <span style={{ fontSize: 12, fontWeight: 700, color: barColor }}>
                {Math.round(budgetPct)}%{isOver ? ` ${t("dashboard.over_budget")}` : ''}
              </span>
            </div>
            <div style={{ height: 3, background: C.bgTertiary, borderRadius: 99 }}>
              <div style={{ height: 3, borderRadius: 99, width: `${Math.min(budgetPct, 100)}%`, background: barColor, transition: "width 0.6s" }} />
            </div>
          </GlassCard>
        );
      })()}

      {/* 5 ── Market Overview */}
      <MarketOverview onOpenMarket={onOpenMarket} />

      {/* 6 ── Recent Transactions */}
      <GlassCard style={{ padding: "14px 16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>{t("dashboard.recent_transactions")}</span>
          <button onClick={() => onNavigate("transactions")} style={{ background: "none", border: "none", cursor: "pointer", color: C.cyan, fontSize: 12, fontWeight: 600, fontFamily: FONT, display: "flex", alignItems: "center", gap: 4, padding: 0 }}>
            {t("dashboard.view_all")} <Icon name="chevron" size={12} color={C.cyan} />
          </button>
        </div>
        {transactions.length === 0
          ? <div style={{ color: C.muted, textAlign: "center", padding: "16px 0", fontSize: 13 }}>{t("dashboard.no_transactions")}</div>
          : transactions.slice(0, 3).map((t, i, arr) => (
              <div key={t.id}>
                <TxRow t={t} hideAmount={!balanceVisible} />
                {i < arr.length - 1 && <div style={{ height: 1, background: C.sep }} />}
              </div>
            ))
        }
      </GlassCard>

      {/* ── "Other" breakdown sheet ── */}
      {otherBreakdown && (() => {
        const now = new Date();
        const otherTxs = transactions.filter(t => {
          const d = new Date(t.date);
          return t.type === 'expense'
            && t.category_name !== 'Transfer'
            && resolveCategory(t) === 'Other'
            && d.getMonth() === now.getMonth()
            && d.getFullYear() === now.getFullYear();
        });
        // Group by description, sum amounts
        const grouped = {};
        otherTxs.forEach(t => {
          const key = (t.description || 'Unknown').trim();
          if (!grouped[key]) grouped[key] = { name: key, total: 0, count: 0 };
          grouped[key].total += Number(t.amount);
          grouped[key].count++;
        });
        const rows = Object.values(grouped).sort((a, b) => b.total - a.total).slice(0, 10);
        const otherTotal = otherTxs.reduce((s, t) => s + Number(t.amount), 0);

        return (
          <div onClick={() => setOtherBreakdown(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 180, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
            <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 430, background: C.card, borderRadius: '20px 20px 0 0', border: `1px solid ${C.border}`, padding: '0 0 32px', maxHeight: '75vh', display: 'flex', flexDirection: 'column' }}>
              {/* Handle */}
              <div style={{ padding: '14px 0 0', display: 'flex', justifyContent: 'center' }}>
                <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.12)' }} />
              </div>
              {/* Header */}
              <div style={{ padding: '12px 20px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${C.sep}`, flexShrink: 0 }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>{t("dashboard.whats_in_other")}</div>
                  <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>${fmt(otherTotal, 0)} {t("dashboard.this_month")} · {t("dashboard.transaction", { count: otherTxs.length })}</div>
                </div>
                <button onClick={() => setOtherBreakdown(false)} style={{ background: C.bgTertiary, border: `1px solid ${C.border}`, borderRadius: 8, width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                  <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke={C.muted} strokeWidth={2.5} strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
              {/* List */}
              <div style={{ overflowY: 'auto', flex: 1, padding: '8px 0' }}>
                {rows.length === 0
                  ? <div style={{ padding: '24px 20px', textAlign: 'center', color: C.faint, fontSize: 13 }}>{t("dashboard.no_uncategorized")}</div>
                  : rows.map((row, i) => {
                    const pct = otherTotal > 0 ? (row.total / otherTotal) * 100 : 0;
                    return (
                      <div key={row.name} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 20px', borderBottom: i < rows.length - 1 ? `1px solid ${C.sep}` : 'none' }}>
                        <div style={{ width: 34, height: 34, borderRadius: 10, background: CAT_COLORS.Other + '22', border: `1px solid ${CAT_COLORS.Other}33`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={CAT_COLORS.Other} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.name}</div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
                            <div style={{ height: 3, borderRadius: 99, background: CAT_COLORS.Other + '40', flex: 1, overflow: 'hidden' }}>
                              <div style={{ height: '100%', width: `${pct}%`, background: CAT_COLORS.Other, borderRadius: 99 }} />
                            </div>
                            <span style={{ fontSize: 10, color: C.faint, flexShrink: 0 }}>{Math.round(pct)}%</span>
                          </div>
                        </div>
                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{balanceVisible ? `$${fmt(row.total, 0)}` : '••••'}</div>
                          {row.count > 1 && <div style={{ fontSize: 10, color: C.faint }}>{row.count} txns</div>}
                        </div>
                      </div>
                    );
                  })
                }
              </div>
              {/* Footer CTA */}
              <div style={{ padding: '12px 20px 0', flexShrink: 0 }}>
                <button onClick={() => { setOtherBreakdown(false); onCatClick?.('Other'); }} style={{ width: '100%', padding: '12px 0', background: C.bgTertiary, border: `1px solid ${C.border}`, borderRadius: 12, color: C.muted, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: FONT }}>
                  {t("dashboard.view_all_transactions")}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

    </div>
  );
}
