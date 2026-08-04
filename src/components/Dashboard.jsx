import { useState, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { supabase, SUPABASE_URL, SUPABASE_KEY } from "../utils/supabase";
import { getCachedAccounts, setCachedAccounts, sumDepositoryBalance, getCreditAccounts, sumCreditDebt, creditUtilization } from "../utils/accountsCache";
import { C, FONT, CAT_COLORS, RADIUS } from "../utils/colors";
import { fmt, fmtDate, parseDate, fmtPct, resolveCategory, tCat, sumAmounts } from "../utils/helpers";
import Icon from "./shared/Icon";
import GlassCard from "./shared/GlassCard";
import { ConnectBankPrompt } from "./shared/ConnectBankPrompt";
import { calculateHealthScore, generateHealthComment, getScoreLabel } from "../healthScore";
import { InsightCard } from "./Insights";
import UpcomingChargesCard from "./UpcomingChargesCard";
import { getUpcomingCharges, getUpcomingCardPayments } from '../utils/recurringSummary';
import { BUFFER } from "../shared/financialConstants";


// ─── Health Score Gauge ──────────────────────────────────────────────────────
// ─── Health Score Bar (compact, inline, expandable) ─────────────────────────
function HealthScoreBar({ score, color, comment, breakdown, hasData = true, prevScore, cashPositionLow = false }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const label = getScoreLabel(score);

  if (!hasData) {
    return (
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: RADIUS.md, padding: "10px 14px", fontFamily: FONT }}>
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
        borderRadius: RADIUS.md,
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

        {/* MoM delta */}
        {prevScore != null && prevScore !== score && (
          <span style={{ fontSize: 11, fontWeight: 700, color: score > prevScore ? C.green : C.red, flexShrink: 0 }}>
            {score > prevScore ? `↑${score - prevScore}` : `↓${prevScore - score}`}
          </span>
        )}

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

      {cashPositionLow && (
        <div style={{ fontSize: 11, color: C.yellow, fontWeight: 600, marginTop: 4, marginLeft: 16 }}>
          {t("health.cash_position_low")}
        </div>
      )}

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
                <div style={{ height: 3, background: C.border, borderRadius: RADIUS.full }}>
                  <div style={{
                    height: 3, borderRadius: RADIUS.full,
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
    <span style={{ display: "inline-flex", alignItems: "center", gap: 3, background: color + "22", color, borderRadius: RADIUS.full, padding: "2px 8px", fontSize: 10, fontWeight: 600, fontFamily: FONT, whiteSpace: "nowrap" }}>
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

  const entries = Object.entries(data || {}).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, v]) => s + v, 0);

  if (total <= 0) return (
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
        <div style={{ position: "absolute", left: cx - innerR, top: cy - innerR, width: innerR * 2, height: innerR * 2, borderRadius: "50%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: C.bgDeep, pointerEvents: "none" }}>
          {hovered ? (
            <>
              <div style={{ fontSize: 10, color: C.text, fontWeight: 600, letterSpacing: 0.5, marginBottom: 2, textAlign: "center", padding: "0 4px" }}>{tCat(hovered, t)}</div>
              <div className="ph-mask" style={{ fontSize: 17, fontWeight: 800, color: CAT_COLORS[hovered] || C.cyan }}>{hideAmounts ? "••••" : `$${fmt((data[hovered] || 0), 0)}`}</div>
              <div style={{ fontSize: 11, color: C.text, fontWeight: 600 }}>{Math.round(((data[hovered] || 0) / total) * 100)}%</div>
            </>
          ) : (
            <>
             <div className="ph-mask" style={{ fontSize: 20, fontWeight: 800, color: C.text, letterSpacing: -0.5, marginBottom: 2 }}>{hideAmounts ? "••••" : `$${fmt(total, 0)}`}</div>
           <div style={{ fontSize: 10, color: C.muted, letterSpacing: 0.5, fontWeight: 600 }}>{t("dashboard.total_spent")}</div>
            </>
          )}
        </div>
      </div>

      {(() => {
        // Free users see the top 3 categories in full (real value, no
        // teaser blur on the whole list) — only categories beyond that are
        // locked. Pro sees everything; lockList=false skips this split
        // entirely. If there are 3 or fewer categories total, there's
        // nothing to lock — show them all plainly, same as Pro.
        const lockedCount = lockList ? Math.max(0, slices.length - 3) : 0;
        const visibleSlices = lockedCount > 0 ? slices.slice(0, 3) : slices;
        const hiddenSlices  = lockedCount > 0 ? slices.slice(3) : [];

        const row = (s, i) => (
          <div key={s.cat}
            onClick={() => onCatClick && onCatClick(s.cat)}
            style={{ display: "flex", alignItems: "center", gap: 10, cursor: onCatClick ? "pointer" : "default", padding: "6px 10px", borderRadius: RADIUS.sm, background: hovered === s.cat ? s.color + "18" : C.bgTertiary, border: `1px solid ${hovered === s.cat ? s.color + "44" : "transparent"}`, transition: "all 0.15s" }}
            onMouseEnter={() => setHovered(s.cat)} onMouseLeave={() => setHovered(null)}>
            <div style={{ width: 10, height: 10, borderRadius: RADIUS.full, background: s.color, flexShrink: 0, boxShadow: `0 0 6px ${s.color}88` }} />
            <span style={{ fontSize: 13, color: i === 0 ? C.text : C.muted, fontWeight: i === 0 ? 600 : 400, flex: 1 }}>{tCat(s.cat, t)}</span>
            <span className="ph-mask" style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{hideAmounts ? "••••" : `$${fmt(s.val, 0)}`}</span>
            <span style={{ fontSize: 11, color: s.color, fontWeight: i === 0 ? 700 : 500, minWidth: 36, textAlign: "right" }}>{Math.round((s.val / total) * 100)}%</span>
            {onCatClick && <Icon name="chevron" size={12} color={C.faint} />}
          </div>
        );

        return (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {visibleSlices.map(row)}
            {hiddenSlices.length > 0 && (
              <div style={{ position: "relative" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, filter: "blur(3px)", userSelect: "none", pointerEvents: "none" }}>
                  {hiddenSlices.map(row)}
                </div>
                <div onClick={onUpgrade} style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: C.muted, background: C.card, padding: "5px 14px", borderRadius: RADIUS.lg, border: `1px solid ${C.border}` }}>
                    {t("dashboard.unlock_more_categories", { count: lockedCount })}
                  </span>
                </div>
              </div>
            )}
          </div>
        );
      })()}
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
      const nData = nRes.ok ? await nRes.json().catch(() => ({})) : {};

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
    SPY:  { label: "S&P 500",  icon: "bar-chart", color: C.blue },
    QQQ:  { label: "NASDAQ",   icon: "activity",  color: C.purple },
    BTC:  { label: "Bitcoin",  icon: "zap",        color: C.amber },
    ETH:  { label: "Ethereum", icon: "zap",        color: C.emerald },
  };

  return (
    <GlassCard style={{ padding: "14px 16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <div style={{ width: 28, height: 28, borderRadius: RADIUS.xs, background: C.blue + "22", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name="bar-chart" size={14} color={C.blue} />
          </div>
          <span style={{ fontWeight: 600, fontSize: 14 }}>{t("dashboard.markets")}</span>
          {lastUpdated && !loading && (
            <span style={{ fontSize: 10, color: C.faint }}>
              {lastUpdated.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          {["markets", "news"].map(tabId => (
            <button key={tabId} onClick={() => setTab(tabId)}
              style={{ padding: "4px 10px", minHeight: 44, borderRadius: RADIUS.lg, border: `1px solid ${tab === tabId ? C.blue : C.border}`, background: tab === tabId ? C.blue + "18" : "transparent", color: tab === tabId ? C.blue : C.faint, cursor: "pointer", fontSize: 11, fontWeight: tab === tabId ? 600 : 400, fontFamily: FONT, textTransform: "capitalize" }}>
              {tabId}
            </button>
          ))}
          <button onClick={load} aria-label={t("dashboard.refresh")} style={{ background: "none", border: "none", cursor: "pointer", padding: "2px", display: "flex", alignItems: "center", justifyContent: "center", minHeight: 44, minWidth: 44, opacity: loading ? 0.4 : 0.7 }}>
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
        <div style={{ padding: "12px 14px", background: C.red + "10", borderRadius: RADIUS.sm, border: `1px solid ${C.red}22` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
            <Icon name="alert-circle" size={14} color={C.red} />
            <span style={{ fontSize: 12, color: C.red, fontWeight: 600 }}>{t("dashboard.could_not_load_market_data")}</span>
          </div>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 10, lineHeight: 1.5 }}>{error}</div>
          <button onClick={load} style={{ marginTop: 10, padding: "7px 14px", minHeight: 44, background: C.blue + "22", border: `1px solid ${C.blue}44`, borderRadius: RADIUS.xs, color: C.blue, cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: FONT }}>
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
              <div key={m.symbol} onClick={() => onOpenMarket?.(m.symbol)} style={{ background: C.bgTertiary, borderRadius: RADIUS.sm, padding: "10px 12px", border: `1px solid ${C.border}`, cursor: "pointer" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                  <div style={{ width: 24, height: 24, borderRadius: RADIUS.xs, background: meta.color + "22", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Icon name={meta.icon} size={11} color={meta.color} strokeWidth={2.5} />
                  </div>
                  <span style={{ fontSize: 11, color: C.muted, fontWeight: 500 }}>{meta.label}</span>
                </div>
                <div style={{ fontSize: 15, fontWeight: 800, color: C.text, letterSpacing: -0.3 }}>
                  ${m.price != null ? Number(m.price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}
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
                  <img src={n.image} alt="" style={{ width: 52, height: 40, borderRadius: RADIUS.xs, objectFit: "cover", flexShrink: 0 }} onError={e => { e.target.style.display = "none"; }} />
                )}
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: C.text, lineHeight: 1.4, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{n.headline}</div>
                  <div style={{ fontSize: 10, color: C.faint, marginTop: 3 }}>{n.source} · {new Date(n.datetime * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</div>
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
      <polyline points={pts} fill="none" stroke={up ? C.green : C.red} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
function formatDateStr(d) {
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Projects account balance forward to targetDate: currentBalance + expected
// income - upcoming bills (recurring + scheduled one-off) - estimated
// remaining daily spend, all scoped to "referenceDate through targetDate".
// Single source for "what's left by date X" — used by both Cash Flow
// Forecast (targetDate = end of month) and the planned-payment form's live
// preview (targetDate = the payment's due date), so the two can't quietly
// diverge the way independently-reimplemented financial formulas have
// before in this project. Returns null if accountBalance isn't loaded yet.
function projectBalanceAt(transactions, accountBalance, targetDate, aliasMap, scheduledPayments = [], referenceDate = new Date()) {
  if (accountBalance == null) return null;

  const todayStart = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate());
  const daysUntil = Math.max(0, Math.round((targetDate - todayStart) / MS_PER_DAY));
  const curKey = `${referenceDate.getFullYear()}-${referenceDate.getMonth()}`;

  const isThisMonth = tx => {
    const d = new Date(tx.date + 'T00:00:00');
    return d.getMonth() === referenceDate.getMonth() && d.getFullYear() === referenceDate.getFullYear();
  };

  // ── 3-month avg daily spend (previous full months, not current) ──────────
  const avg3mDailySpend = (() => {
    const byMonth = {};
    for (const t of transactions) {
      if (t.type !== 'expense') continue;
      const d = new Date(t.date + 'T00:00:00');
      const k = `${d.getFullYear()}-${d.getMonth()}`;
      if (k === curKey) continue;
      byMonth[k] = (byMonth[k] || 0) + Math.abs(Number(t.amount));
    }
    const vals = Object.values(byMonth).slice(-3);
    if (!vals.length) {
      // No history — fall back to this month's daily rate
      const spent = transactions
        .filter(t => t.type === 'expense' && isThisMonth(t))
        .reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
      return spent / Math.max(referenceDate.getDate(), 1);
    }
    return vals.reduce((s, v) => s + v, 0) / vals.length / 30;
  })();

  // ── 3-month avg monthly income (previous full months, not current) ────────
  const avg3mIncome = (() => {
    const byMonth = {};
    for (const t of transactions) {
      if (t.type !== 'income') continue;
      const d = new Date(t.date + 'T00:00:00');
      const k = `${d.getFullYear()}-${d.getMonth()}`;
      if (k === curKey) continue;
      byMonth[k] = (byMonth[k] || 0) + Math.abs(Number(t.amount));
    }
    const vals = Object.values(byMonth).slice(-3);
    if (!vals.length) {
      return transactions
        .filter(t => t.type === 'income' && isThisMonth(t))
        .reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
    }
    return vals.reduce((s, v) => s + v, 0) / vals.length;
  })();

  // ── Formula ───────────────────────────────────────────────────────────────
  // projected = currentBalance + expectedIncome - upcomingBills - estimatedRemainingSpend
  const targetDateStr = formatDateStr(targetDate);
  const bills = [
    ...getUpcomingCharges(transactions, aliasMap, referenceDate, { maxDays: daysUntil, maxResults: Infinity }),
    ...getUpcomingCardPayments(transactions, aliasMap, referenceDate, { maxDays: daysUntil, maxResults: Infinity }),
  ];
  const billsTotal      = bills.reduce((s, c) => s + Number(c.amount), 0);
  const scheduledTotal  = scheduledPayments
    .filter(p => p.status === 'pending' && p.due_date <= targetDateStr)
    .reduce((s, p) => s + Number(p.amount), 0);
  const upcomingTotal           = billsTotal + scheduledTotal;
  const expectedIncome          = avg3mIncome * (daysUntil / 30);
  const estimatedRemainingSpend = avg3mDailySpend * daysUntil;
  const projectedRaw            = accountBalance + expectedIncome - upcomingTotal - estimatedRemainingSpend;

  return { projectedRaw, avg3mDailySpend, avg3mIncome, upcomingTotal, expectedIncome, estimatedRemainingSpend, daysUntil };
}

function CashFlowForecast({ accountBalance, transactions, balanceVisible, merchantAliasMap, scheduledPayments, bankConnected, onNavigate }) {
  const { t } = useTranslation();
  const today       = new Date();
  const dayOfMonth  = today.getDate();
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const remainingDays = daysInMonth - dayOfMonth;

  // Need at least 2 days of data for a meaningful rate
  if (dayOfMonth < 2 || transactions.length === 0) return null;

  // No bank connected — accountBalance will never populate, so the loading
  // skeleton below would render forever. Distinct from "still fetching"
  // (bankConnected true, accountBalance not yet loaded), which keeps the
  // skeleton since that resolves on its own.
  if (!bankConnected) {
    return <ConnectBankPrompt title={t('dashboard.cash_flow_forecast')} message={t('dashboard.connect_bank_forecast')} onNavigate={onNavigate} />;
  }

  // Wait for Plaid balance — fallback computed balance causes a visible flicker
  if (accountBalance === null) {
    return (
      <div style={{ background: `linear-gradient(145deg,${C.cardBgStart},${C.bg})`, borderRadius: RADIUS.lg, padding: '16px 18px', border: `1px solid ${C.border}` }}>
        <div style={{ fontSize: 10, color: C.muted, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 12 }}>{t('dashboard.cash_flow_forecast')}</div>
        <div style={{ height: 36, borderRadius: RADIUS.xs, background: C.bgTertiary, marginBottom: 10, width: '55%' }} />
        <div style={{ height: 8, borderRadius: RADIUS.full, background: C.bgTertiary, marginBottom: 14 }} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 0 }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{ paddingLeft: i > 0 ? 12 : 0, borderLeft: i > 0 ? `1px solid ${C.sep}` : 'none' }}>
              <div style={{ height: 8, borderRadius: RADIUS.xs, background: C.bgTertiary, marginBottom: 6, width: '60%' }} />
              <div style={{ height: 12, borderRadius: RADIUS.xs, background: C.bgTertiary, width: '80%' }} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const startBalance = accountBalance;
  const endOfMonthDate = new Date(today.getFullYear(), today.getMonth(), daysInMonth);
  const { projectedRaw, avg3mDailySpend, upcomingTotal } =
    projectBalanceAt(transactions, accountBalance, endOfMonthDate, merchantAliasMap, scheduledPayments, today);
  const projectedBalance        = Math.max(0, projectedRaw);

  if (avg3mDailySpend < 0.01 && upcomingTotal === 0) return null;

  const status = projectedRaw <= 0
    ? 'deficit'
    : startBalance > 0 && projectedRaw / startBalance < 0.12
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
    .toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  const mask  = n => balanceVisible ? (n < 0 ? `-$${fmt(Math.abs(n), 0)}` : `$${fmt(n, 0)}`) : '••••';

  return (
    <div style={{ background: `linear-gradient(145deg,${C.cardBgStart},${C.bg})`, borderRadius: RADIUS.lg, padding: '16px 18px', border: `1px solid ${S.border}`, position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: -24, right: -24, width: 90, height: 90, borderRadius: '50%', background: S.color + '09', pointerEvents: 'none' }} />

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontSize: 10, color: C.muted, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase' }}>{t('dashboard.cash_flow_forecast')}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, background: S.bg, border: `1px solid ${S.border}`, borderRadius: RADIUS.full, padding: '3px 9px' }}>
          <div style={{ width: 6, height: 6, borderRadius: RADIUS.full, background: S.color }} />
          <span style={{ fontSize: 11, fontWeight: 700, color: S.color, letterSpacing: 0.2 }}>{S.label}</span>
        </div>
      </div>

      {/* Projected balance */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 9, color: C.faint, fontWeight: 600, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 4 }}>
          {t('dashboard.projected_end_of_month', 'Projected end of month')}
        </div>
        <div className="ph-mask" style={{ fontSize: 34, fontWeight: 800, letterSpacing: -1, color: balanceVisible ? S.color : C.text, lineHeight: 1.1, textShadow: balanceVisible ? `0 0 20px ${S.color}30` : 'none' }}>
          {mask(projectedBalance)}
        </div>
        <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>
          {t('dashboard.projected_by_prefix')} <strong style={{ color: C.text }}>{endOfMonth}</strong>
          <span style={{ color: C.faint }}> · {t('dashboard.days_left', { count: remainingDays })}</span>
        </div>
      </div>

      {/* Burn-down bar */}
      <div style={{ height: 8, borderRadius: RADIUS.full, background: C.bgTertiary, overflow: 'hidden', marginBottom: 14 }}>
        <div style={{ height: '100%', width: `${barPct}%`, background: `linear-gradient(90deg,${S.color},${S.color}BB)`, borderRadius: RADIUS.full, transition: 'width 0.6s', boxShadow: barPct > 0 ? `0 0 8px ${S.color}40` : 'none' }} />
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 0 }}>
        {[
          { label: t('dashboard.balance_now'),    value: mask(startBalance),          color: C.text  },
          { label: t('dashboard.daily_avg'),      value: balanceVisible ? `$${fmt(avg3mDailySpend, 0)}${t('dashboard.per_day')}` : '••••', color: C.muted },
          { label: t('dashboard.upcoming_bills'), value: upcomingTotal > 0 ? mask(upcomingTotal) : '—', color: upcomingTotal > 0 ? C.yellow : C.faint },
        ].map((item, i) => (
          <div key={item.label} style={{ paddingLeft: i > 0 ? 12 : 0, borderLeft: i > 0 ? `1px solid ${C.sep}` : 'none', marginLeft: i > 0 ? 0 : 0 }}>
            <div style={{ fontSize: 9, color: C.faint, fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 3 }}>{item.label}</div>
            <div className="ph-mask" style={{ fontSize: 12, fontWeight: 700, color: item.color }}>{item.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Groups this month's expenses by day, keeping the full per-category
// breakdown — { [dayOfMonth]: { [category]: amount } }. Single source for
// both the grid's dominant-category coloring and the day-detail sheet's
// full breakdown, so they can't drift apart.
function groupExpensesByDay(transactions, year, month) {
  const byDay = {};
  transactions
    .filter(t => t.type === "expense" && t.category_name !== "Transfer")
    .forEach(t => {
      const d = parseDate(t.date);
      if (d.getFullYear() !== year || d.getMonth() !== month) return;
      const day = d.getDate();
      const cat = t.category_name || "Other";
      byDay[day] ??= {};
      byDay[day][cat] = (byDay[day][cat] || 0) + Number(t.amount);
    });
  return byDay;
}

// For each day with expenses, the dominant category and day total —
// derived from groupExpensesByDay. Returns { [dayOfMonth]: { category, total } }.
function getDailyDominantCategory(transactions, year, month) {
  const byDay = groupExpensesByDay(transactions, year, month);
  const result = {};
  for (const [day, catMap] of Object.entries(byDay)) {
    const [category] = Object.entries(catMap).sort((a, b) => b[1] - a[1])[0];
    const total = Object.values(catMap).reduce((s, v) => s + v, 0);
    result[day] = { category, total };
  }
  return result;
}

// Signed net (income - expense) per day — separate from groupExpensesByDay,
// which is expense-only (drives the cell's dominant category/color and
// stays that way). Deliberately excludes ONLY "Transfer" (singular), same
// as groupExpensesByDay — NOT also "Transfers" (plural), even though the
// plural is the one that actually shows up in real data and arguably
// should be excluded too. Matching groupExpensesByDay's filter exactly,
// bug-for-bug, is intentional here: this number and that cell's color
// must be computed from the same transaction set, or the color and the
// text underneath it would silently disagree within one cell. The
// singular/plural inconsistency itself is real and tracked in BACKLOG —
// fix it there (in groupExpensesByDay, once, for both consumers), not by
// letting this function quietly diverge from it.
function getDailyNet(transactions, year, month) {
  const net = {};
  transactions.forEach(t => {
    if (t.category_name === "Transfer") return;
    const d = parseDate(t.date);
    if (d.getFullYear() !== year || d.getMonth() !== month) return;
    const day = d.getDate();
    const amt = Number(t.amount);
    net[day] = (net[day] || 0) + (t.type === "income" ? amt : -amt);
  });
  return net;
}

// Whole-thousands abbreviation past $1000 — a decimal ("$2.2k") barely saves
// width over the plain number ("$2211"), but dropping to whole "k" does
// ("$2k") and that's what the grid cell actually needs room for.
function fmtDayAmount(n) {
  const sign = n < 0 ? "-" : "+";
  const abs = Math.abs(n);
  if (abs >= 1000) return sign + "$" + Math.round(abs / 1000) + "k";
  return sign + "$" + Math.round(abs);
}

// Log-scale intensity (0.25-1.0) relative to the month's biggest spend day —
// linear scaling gets crushed by one-time lump payments (rent, insurance),
// making every ordinary day look equally faint. Log compresses the outlier
// enough that everyday spending differences stay visible. Returns a 2-digit
// hex alpha suffix.
function dailyIntensityAlpha(total, maxTotal) {
  if (!total || !maxTotal) return "40";
  const frac = Math.log(1 + total) / Math.log(1 + maxTotal);
  const intensity = 0.25 + 0.75 * Math.min(1, Math.max(0, frac));
  return Math.round(intensity * 255).toString(16).padStart(2, "0");
}

// For each remaining day of the current month, finds the dominant (largest
// amount) predicted charge — reuses the same getUpcomingCharges/
// getUpcomingCardPayments the carousel and Cash Flow Forecast already use,
// so the calendar can never disagree with them about what's coming up.
// scheduledPayments (user-added one-off future payments) are merged in as
// the same shape — a day with both a recurring charge and a scheduled
// payment shows whichever is larger, same tie-break as recurring vs card.
function getUpcomingChargesByDay(transactions, aliasMap, referenceDate, scheduledPayments = []) {
  const daysInMonth = new Date(referenceDate.getFullYear(), referenceDate.getMonth() + 1, 0).getDate();
  const remainingDays = daysInMonth - referenceDate.getDate();
  const all = [
    ...getUpcomingCharges(transactions, aliasMap, referenceDate, { maxDays: remainingDays, maxResults: Infinity }),
    ...getUpcomingCardPayments(transactions, aliasMap, referenceDate, { maxDays: remainingDays, maxResults: Infinity }),
    ...scheduledPayments
      .filter(p => p.status === "pending")
      // scheduledPaymentId marks this item as user-cancelable (recurring/card
      // projections have no id — nothing to cancel, they're derived, not stored)
      .map(p => ({ merchant: p.description, amount: Number(p.amount), expectedDate: p.due_date, category: p.category_name, scheduledPaymentId: p.id })),
  ];

  // The interval-based projection can occasionally overshoot into next
  // month by a day or two (e.g. a ~30-day cycle landing on Aug 1 when only
  // 30 days remained in July) — guard against that day number colliding
  // with a still-future day in the CURRENT month being rendered.
  const monthPrefix = `${referenceDate.getFullYear()}-${String(referenceDate.getMonth() + 1).padStart(2, "0")}`;
  const byDay = {};
  all.forEach(c => {
    if (!c.expectedDate.startsWith(monthPrefix)) return;
    const day = Number(c.expectedDate.slice(8, 10));
    byDay[day] ??= [];
    byDay[day].push(c);
  });

  const result = {};
  for (const [day, items] of Object.entries(byDay)) {
    const dominant = items.slice().sort((a, b) => b.amount - a.amount)[0];
    result[day] = dominant;
  }
  return result;
}

const WEEKDAY_KEYS = ["weekday_mon", "weekday_tue", "weekday_wed", "weekday_thu", "weekday_fri", "weekday_sat", "weekday_sun"];

// Small day cell shared by the grid (level 1) and the day-detail strip
// (level 2) — same color/intensity rules, different size and click behavior.
function CalendarDayCell({ day, isToday, isPast, color, alpha, size, emphasized, onClick, tooltip }) {
  return (
    <div
      onClick={onClick}
      style={{
        width: size, height: size, borderRadius: RADIUS.sm, flexShrink: 0,
        background: color + alpha,
        border: isToday ? `2px solid ${C.text}` : emphasized ? `2px solid ${C.cyan}` : `1px solid ${color}55`,
        display: "flex", alignItems: "center", justifyContent: "center",
        cursor: "pointer", position: "relative",
      }}
    >
      <span style={{ fontSize: 12, fontWeight: isToday || emphasized ? 700 : 500, color: isPast || isToday ? C.text : C.muted }}>{day}</span>
      {tooltip}
    </div>
  );
}

// ─── Month Calendar — replaces Recent Transactions ─────────────────────────
// Level 1: classic grid (7 cols × N rows, Monday-first). Past/today days are
// colored by dominant spending category, with intensity (log-scaled, see
// dailyIntensityAlpha) proportional to that day's total spend. Future days
// are colored by the dominant predicted charge. Tapping any day selects it
// (no navigation) and opens level 2.
// Level 2: a bottom sheet (same interaction pattern as the "Other" spending
// breakdown sheet below) showing the selected day ± 2 neighbors as a small
// strip, plus the full category breakdown for the selected day. Tapping a
// past/today day in the strip navigates to Transactions filtered by that
// date; tapping a future day shows a tooltip — same rules as before, just
// scoped to the strip instead of the whole grid.
function MonthCalendar({ transactions, merchantAliasMap, onDayClick, onDayCategoryClick, scheduledPayments = [], onAddScheduledPayment, onCancelScheduledPayment, accountBalance, bankConnected, onNavigate }) {
  const { t } = useTranslation();
  const [selectedDay, setSelectedDay] = useState(null);
  const [tooltipDay, setTooltipDay] = useState(null);
  const [showAddPayment, setShowAddPayment] = useState(false);

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const todayDate = now.getDate();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  // JS getDay() is Sunday-first (0-6) — convert to Monday-first (0=Mon..6=Sun)
  const leadingBlanks = (new Date(year, month, 1).getDay() + 6) % 7;

  const dayBreakdown = useMemo(() => groupExpensesByDay(transactions, year, month), [transactions, year, month]);
  const dailyNet = useMemo(() => getDailyNet(transactions, year, month), [transactions, year, month]);
  const pastByDay = useMemo(() => getDailyDominantCategory(transactions, year, month), [transactions, year, month]);
  const futureByDay = useMemo(() => getUpcomingChargesByDay(transactions, merchantAliasMap, now, scheduledPayments), [transactions, merchantAliasMap, scheduledPayments]);
  const maxDayTotal = useMemo(() => Math.max(0, ...Object.values(pastByDay).map(d => d.total)), [pastByDay]);
  // Separate scale from maxDayTotal on purpose: past totals are a SUM of every
  // transaction that day, future amounts are a SINGLE dominant merchant's
  // predicted charge — different quantities. Sharing one max (usually set by
  // a lump payment like rent) would flatten every future day near the floor.
  const maxFutureDayTotal = useMemo(() => Math.max(0, ...Object.values(futureByDay).map(c => c.amount)), [futureByDay]);

  if (!bankConnected) {
    return <ConnectBankPrompt title={t("dashboard.month_calendar_title")} message={t("dashboard.connect_bank_calendar")} onNavigate={onNavigate} />;
  }

  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  function dayColorAlpha(day) {
    const isToday = day === todayDate;
    const isPast = day < todayDate;
    const info = isPast || isToday ? pastByDay[day] : futureByDay[day];
    const color = info ? (CAT_COLORS[info.category] || C.faint) : C.sep;
    const alpha = isPast || isToday
      ? dailyIntensityAlpha(pastByDay[day]?.total, maxDayTotal)
      : dailyIntensityAlpha(futureByDay[day]?.amount, maxFutureDayTotal);
    return { color, alpha, isToday, isPast };
  }

  // Second line under the day number. Past/today: honest signed net
  // (income - expense) — red/green because it's a real fact about that day.
  // Future: the single dominant predicted charge, always shown as an
  // outflow — deliberately NEUTRAL color (not red), because unlike the past
  // day's net this isn't "how the day nets out", just "a payment is
  // expected" — same red on both would make one color carry two different
  // meanings depending on where in the grid you're looking. White (not
  // blue) for the neutral case — blue read too close in tone to the
  // future-day backgrounds themselves even with the text-shadow; white
  // also doubles down on the future scale already being a distinct visual
  // language from past days, rather than blurring into it.
  function dayAmountInfo(day) {
    const isToday = day === todayDate;
    const isPast = day < todayDate;
    if (isPast || isToday) {
      const net = dailyNet[day];
      if (net == null) return null;
      return { text: fmtDayAmount(net), color: net < 0 ? C.red : C.green };
    }
    const info = futureByDay[day];
    if (!info) return null;
    return { text: fmtDayAmount(-info.amount), color: C.text };
  }

  function dateStr(day) {
    const pad = n => String(n).padStart(2, "0");
    return `${year}-${pad(month + 1)}-${pad(day)}`;
  }
  function goToDate(day) {
    onDayClick?.(dateStr(day));
  }
  function goToDateCategory(day, category) {
    onDayCategoryClick?.(dateStr(day), category);
  }

  const neighborStart = selectedDay ? Math.max(1, selectedDay - 2) : 1;
  const neighborEnd = selectedDay ? Math.min(daysInMonth, selectedDay + 2) : 1;
  const neighborDays = selectedDay ? Array.from({ length: neighborEnd - neighborStart + 1 }, (_, i) => neighborStart + i) : [];

  const selectedIsFuture = selectedDay && selectedDay > todayDate;
  const selectedCatEntries = selectedDay && !selectedIsFuture
    ? Object.entries(dayBreakdown[selectedDay] || {}).sort((a, b) => b[1] - a[1])
    : [];
  const selectedFutureInfo = selectedDay ? futureByDay[selectedDay] : null;

  return (
    <GlassCard style={{ padding: "14px 16px" }}>
      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 10 }}>{t("dashboard.month_calendar_title")}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, marginBottom: 6 }}>
        {WEEKDAY_KEYS.map(key => (
          <div key={key} style={{ textAlign: "center", fontSize: 10, color: C.muted, fontWeight: 600 }}>{t(`dashboard.${key}`)}</div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
        {Array.from({ length: leadingBlanks }, (_, i) => <div key={`blank-${i}`} />)}
        {days.map(day => {
          const { color, alpha, isToday, isPast } = dayColorAlpha(day);
          const amountInfo = dayAmountInfo(day);
          return (
            <div key={day} style={{ aspectRatio: "1" }}>
              <div
                onClick={() => setSelectedDay(day)}
                style={{
                  width: "100%", height: "100%", borderRadius: RADIUS.sm, position: "relative",
                  background: color + alpha,
                  border: isToday ? `2px solid ${C.text}` : `1px solid ${color}55`,
                  cursor: "pointer",
                }}
              >
                {/* Near-full-cell dark backdrop, not a small chip around the
                    text — keeps the cell's fill (the whole point of the
                    intensity work: month activity readable at a glance)
                    while guaranteeing text contrast on a fixed dark surface
                    regardless of category color/alpha underneath. A thin
                    border-only accent (colored ring, dark interior) was
                    tried and rejected — it read distinctly weaker for "see
                    the month's activity at a glance" than keeping the fill.
                    Only shown when the cell actually has a color (past/
                    future day with data) — an empty day has nothing to
                    contrast against, so it stays a plain muted number. */}
                {color !== C.sep ? (
                  <div style={{ position: "absolute", inset: 3, borderRadius: RADIUS.xs, background: "rgba(0,0,0,0.55)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                    <span style={{ fontSize: 12, fontWeight: isToday ? 700 : 500, color: C.text, lineHeight: 1.1 }}>{day}</span>
                    {amountInfo && (
                      <span style={{ fontSize: 8.5, fontWeight: 700, color: amountInfo.color, lineHeight: 1.1, marginTop: 3, whiteSpace: "nowrap" }}>{amountInfo.text}</span>
                    )}
                  </div>
                ) : (
                  <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <span style={{ fontSize: 12, fontWeight: isToday ? 700 : 500, color: isToday ? C.text : C.muted, lineHeight: 1.1 }}>{day}</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {selectedDay && (
        <div onClick={() => { setSelectedDay(null); setTooltipDay(null); }} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 180, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
          <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 430, background: C.card, borderRadius: "20px 20px 0 0", border: `1px solid ${C.border}`, padding: "0 0 32px", maxHeight: "75vh", display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "14px 0 0", display: "flex", justifyContent: "center" }}>
              <div style={{ width: 36, height: 4, borderRadius: RADIUS.full, background: "rgba(255,255,255,0.12)" }} />
            </div>
            <div style={{ padding: "12px 20px 10px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: `1px solid ${C.sep}`, flexShrink: 0 }}>
              <div>
                <div
                  onClick={() => { if (!selectedIsFuture) goToDate(selectedDay); }}
                  style={{ fontSize: 16, fontWeight: 700, color: C.text, cursor: selectedIsFuture ? "default" : "pointer" }}
                >
                  {new Date(year, month, selectedDay).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}
                </div>
                {!selectedIsFuture && (
                  <button onClick={() => goToDate(selectedDay)} style={{ background: "none", border: "none", padding: 0, marginTop: 2, cursor: "pointer", color: C.cyan, fontSize: 12, fontWeight: 600, fontFamily: FONT }}>
                    {t("dashboard.view_all_day_transactions")}
                  </button>
                )}
              </div>
              <button onClick={() => { setSelectedDay(null); setTooltipDay(null); }} aria-label={t("dashboard.close")} style={{ background: C.bgTertiary, border: `1px solid ${C.border}`, borderRadius: RADIUS.xs, width: 44, height: 44, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke={C.muted} strokeWidth={2.5} strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

            <div style={{ overflowY: "auto", padding: "16px 20px 0" }}>
              <div style={{ display: "flex", justifyContent: "center", gap: 8, marginBottom: 16 }}>
                {neighborDays.map(day => {
                  const { color, alpha, isToday, isPast } = dayColorAlpha(day);
                  const isFuture = !isPast && !isToday;
                  return (
                    <div key={day} style={{ position: "relative" }}>
                      <CalendarDayCell
                        day={day} isToday={isToday} isPast={isPast} color={color} alpha={alpha}
                        size={day === selectedDay ? 52 : 40}
                        emphasized={day === selectedDay}
                        onClick={() => {
                          if (isFuture) setTooltipDay(tooltipDay === day ? null : day);
                          else if (day === selectedDay) goToDate(day);
                          else setSelectedDay(day);
                        }}
                        tooltip={tooltipDay === day && isFuture && (
                          <div className="ph-mask" style={{ position: "absolute", top: "120%", left: "50%", transform: "translateX(-50%)", background: C.bgTertiary, border: `1px solid ${C.border}`, borderRadius: RADIUS.xs, padding: "6px 10px", whiteSpace: "nowrap", fontSize: 12, color: C.text, zIndex: 10, boxShadow: "0 4px 12px rgba(0,0,0,0.4)" }}>
                            {futureByDay[day] ? `${futureByDay[day].merchant} ~$${fmt(futureByDay[day].amount)}` : t("dashboard.no_bills_expected")}
                          </div>
                        )}
                      />
                    </div>
                  );
                })}
              </div>

              <div style={{ paddingBottom: 8 }}>
                {selectedIsFuture ? (
                  <div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 12 }}>
                      <div className="ph-mask" style={{ fontSize: 13, color: C.text }}>
                        {selectedFutureInfo ? `${selectedFutureInfo.merchant} ~$${fmt(selectedFutureInfo.amount)}` : t("dashboard.no_bills_expected")}
                      </div>
                      {selectedFutureInfo?.scheduledPaymentId && (
                        <button
                          onClick={() => onCancelScheduledPayment?.(selectedFutureInfo.scheduledPaymentId)}
                          aria-label={t("dashboard.cancel_planned_payment")}
                          style={{ background: C.red + "18", border: `1px solid ${C.red}33`, borderRadius: RADIUS.xs, width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}
                        >
                          <Icon name="x" size={12} color={C.red} />
                        </button>
                      )}
                    </div>
                    <button
                      onClick={() => setShowAddPayment(true)}
                      style={{ width: "100%", padding: "10px 14px", borderRadius: RADIUS.sm, border: `1px dashed ${C.border}`, background: "transparent", color: C.cyan, fontSize: 13, fontWeight: 600, fontFamily: FONT, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
                    >
                      <Icon name="plus" size={14} color={C.cyan} strokeWidth={2.5} />
                      {t("dashboard.add_planned_payment")}
                    </button>
                  </div>
                ) : selectedCatEntries.length === 0 ? (
                  <div style={{ fontSize: 13, color: C.muted }}>{t("dashboard.no_transactions")}</div>
                ) : (
                  selectedCatEntries.map(([cat, amount]) => (
                    <div key={cat} onClick={() => goToDateCategory(selectedDay, cat)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderTop: `1px solid ${C.sep}`, cursor: "pointer" }}>
                      <span style={{ fontSize: 13, color: C.text }}>{tCat(cat, t)}</span>
                      <span className="ph-mask" style={{ fontSize: 13, fontWeight: 600, color: CAT_COLORS[cat] || C.muted }}>${fmt(amount)}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {showAddPayment && selectedDay && (
        <AddPlannedPaymentModal
          dueDate={new Date(year, month, selectedDay)}
          transactions={transactions}
          merchantAliasMap={merchantAliasMap}
          scheduledPayments={scheduledPayments}
          accountBalance={accountBalance}
          onAdd={onAddScheduledPayment}
          onClose={() => setShowAddPayment(false)}
        />
      )}
    </GlassCard>
  );
}

// Form for a user-added one-off future payment ("send $500 to Ivan on the
// 15th") — shown from the calendar's Level 2 sheet for a future day. Reuses
// projectBalanceAt (same formula as Cash Flow Forecast) for the live "left
// after this" preview instead of a second balance calculation.
const PLANNED_PAYMENT_CATEGORIES = Object.keys(CAT_COLORS).filter(c => !["Transfer", "Transfers", "Income"].includes(c));

function AddPlannedPaymentModal({ dueDate, transactions, merchantAliasMap, scheduledPayments, accountBalance, onAdd, onClose }) {
  const { t } = useTranslation();
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState(PLANNED_PAYMENT_CATEGORIES[0]);
  const [saving, setSaving] = useState(false);

  const dueDateStr = formatDateStr(dueDate);
  const amountNum = Number(amount) || 0;

  const preview = useMemo(() => {
    if (amountNum <= 0) return null;
    const withThisPayment = [...scheduledPayments, { amount: amountNum, due_date: dueDateStr, status: "pending" }];
    return projectBalanceAt(transactions, accountBalance, dueDate, merchantAliasMap, withThisPayment);
  }, [amountNum, dueDateStr, transactions, accountBalance, merchantAliasMap, scheduledPayments, dueDate]);

  async function handleSave() {
    if (!(amountNum > 0) || !description.trim() || saving) return;
    setSaving(true);
    await onAdd?.({ amount: amountNum, description: description.trim(), category_name: category, due_date: dueDateStr });
    setSaving(false);
    onClose();
  }

  const inp = { width: "100%", padding: "13px 14px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: RADIUS.sm, color: C.text, fontSize: 15, boxSizing: "border-box", fontFamily: FONT };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.82)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 200 }}>
      <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 430, background: C.card, borderRadius: "24px 24px 0 0", padding: 24, border: `1px solid ${C.border}`, maxHeight: "90vh", overflowY: "auto", fontFamily: FONT }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{t("dashboard.add_planned_payment")}</h3>
          <button onClick={onClose} style={{ background: C.bgSecondary, border: `1px solid ${C.border}`, borderRadius: RADIUS.full, cursor: "pointer", width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name="x" size={14} color={C.muted} strokeWidth={2.5} />
          </button>
        </div>
        <div style={{ fontSize: 13, color: C.muted, marginBottom: 16 }}>
          {dueDate.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ position: "relative" }}>
            <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: C.muted, fontSize: 16, fontWeight: 600, pointerEvents: "none" }}>$</span>
            <input type="number" placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)} style={{ ...inp, paddingLeft: 30 }} />
          </div>
          <input style={inp} placeholder={t("dashboard.planned_payment_desc_placeholder")} value={description} onChange={e => setDescription(e.target.value)} />
          <select value={category} onChange={e => setCategory(e.target.value)} style={{ ...inp, cursor: "pointer" }}>
            {PLANNED_PAYMENT_CATEGORIES.map(c => <option key={c} value={c}>{tCat(c, t)}</option>)}
          </select>
        </div>

        {preview && (
          <div className="ph-mask" style={{ marginTop: 14, padding: "10px 14px", borderRadius: RADIUS.sm, background: C.bgTertiary, fontSize: 13, color: C.muted }}>
            {t("dashboard.balance_after_planned_payment", { amount: `$${fmt(Math.max(0, preview.projectedRaw), 0)}` })}
          </div>
        )}

        <button
          onClick={handleSave}
          disabled={!(amountNum > 0) || !description.trim() || saving}
          style={{ width: "100%", marginTop: 16, padding: 14, borderRadius: RADIUS.sm, border: "none", background: (amountNum > 0 && description.trim()) ? C.cyan : C.bgTertiary, color: (amountNum > 0 && description.trim()) ? "#04121F" : C.muted, fontSize: 15, fontWeight: 700, fontFamily: FONT, cursor: (amountNum > 0 && description.trim()) ? "pointer" : "default" }}
        >
          {saving ? t("dashboard.saving") : t("dashboard.save_planned_payment")}
        </button>
      </div>
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────
export default function Dashboard({ totalSpent, totalIncome, lastSpent, lastIncome, transactions, spendingByCategory, prevSpendingByCategory, profile, savings, onNavigate, onCatClick, onMerchantClick, onDayClick, onDayCategoryClick, insight, onInsightAction, isShowingLastMonth, isPro, onUpgrade, upcomingCharges = [], onOpenMarket, bankConnected, userId, lastSyncedAt, hideWelcomeBanner = false, merchantAliasMap, scheduledPayments = [], onAddScheduledPayment, onCancelScheduledPayment }) {
  const { t } = useTranslation();
  const [balanceVisible, setBalanceVisible] = useState(true);
  const [accountBalance, setAccountBalance] = useState(null); // primary checking balance from Plaid
  const [creditAccounts, setCreditAccounts] = useState([]); // credit-card accounts from the same fetch
  const [otherBreakdown, setOtherBreakdown] = useState(false);
  const balanceFetchIdRef = useRef(0);
  const m = (n, dec = 0) => balanceVisible ? `$${fmt(n, dec)}` : "••••";

  // Intercept "Other" clicks — show breakdown instead of navigating
  function handleCatClick(cat) {
    if (cat === 'Other') { setOtherBreakdown(true); return; }
    onCatClick?.(cat);
  }

  useEffect(() => {
    if (!bankConnected || !userId) return;
    const fetchId = ++balanceFetchIdRef.current;
    (async () => {
      try {
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
        const bal = sumDepositoryBalance(accounts);
        if (bal != null && fetchId === balanceFetchIdRef.current) setAccountBalance(bal);
        if (fetchId === balanceFetchIdRef.current) setCreditAccounts(getCreditAccounts(accounts));
      } catch {}
    })();
  }, [bankConnected, userId, lastSyncedAt]);
  const budget = Number(profile?.monthly_budget) || 3000;
  const balance = totalIncome - totalSpent;
  const pct = budget > 0 ? (totalSpent / budget) * 100 : 0;
  // Same formula as Insights.jsx.availableSafe — for cashPositionLow parity between screens.
  const availableSafe = Math.max(0, Math.min(totalIncome - totalSpent - BUFFER, accountBalance != null ? accountBalance - BUFFER : Infinity));
  const cashPositionLow = availableSafe <= 0 && accountBalance != null;
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
  const prevSubscriptionSpend = SUB_CATS.reduce((s, cat) => s + (prevSpendingByCategory[cat] || 0), 0);
  const { score: prevHealthScore } = (lastIncome > 0 || lastSpent > 0)
    ? calculateHealthScore({ totalIncome: lastIncome, totalSpent: lastSpent, lastIncome: 0, lastSpent: 0, budget, subscriptionSpend: prevSubscriptionSpend })
    : { score: null };

  const checkInData = {
    spent:       totalSpent,
    budget:      budget,
    income:      totalIncome,
    savingsRate: totalIncome > 0 ? Math.round((totalIncome - totalSpent) / totalIncome * 100) : 0,
    day:         new Date().getDate(),
    spikePct: (() => {
      const spikes = Object.entries(spendingByCategory).map(([cat, amt]) => {
        const p = prevSpendingByCategory[cat] || 0;
        // Same $15 threshold as get-insights' renderInsight baseTooSmallForPct
        // check: a tiny previous-month base turns a small real delta into a
        // meaningless %, so exclude it instead of letting it win the max.
        return p >= 15 ? ((amt - p) / p) * 100 : 0;
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
        <div style={{ background: "linear-gradient(135deg,#0D2A4A,#0B1A30)", borderRadius: RADIUS.lg, padding: "20px 18px", border: `1px solid ${C.cyan}33`, boxShadow: `0 4px 24px ${C.cyan}12` }}>
          <div style={{ fontSize: 22, marginBottom: 6 }}>👋</div>
          <div style={{ fontWeight: 700, fontSize: 17, color: C.text, marginBottom: 4 }}>{t("dashboard.welcome_title")}</div>
          <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.6, marginBottom: 16 }}>
            {t("dashboard.welcome_body")}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {/* bankConnected but transactions.length===0 is the transient
                "already connected, first sync hasn't landed yet" state —
                showing "Connect Bank" there would be misleading, so only
                offer it to users who haven't connected at all. */}
            {!bankConnected && (
              <button
                onClick={() => onNavigate("profile")}
                style={{ flex: 1, padding: "11px 0", background: `linear-gradient(90deg,${C.cyan},${C.blue})`, border: "none", borderRadius: RADIUS.sm, color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: FONT, boxShadow: `0 4px 14px ${C.cyan}44` }}
              >
                {t("dashboard.connect_bank")}
              </button>
            )}
            <button
              onClick={() => onNavigate("transactions")}
              style={{ flex: 1, padding: "11px 0", background: C.bgTertiary, border: `1px solid ${C.border}`, borderRadius: RADIUS.sm, color: C.text, fontWeight: 600, fontSize: 13, cursor: "pointer", fontFamily: FONT }}
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
      {!bankConnected ? (
        <div data-tutorial="net-balance">
          <ConnectBankPrompt title={t("dashboard.account_balance")} message={t("dashboard.connect_bank_balance")} onNavigate={onNavigate} />
        </div>
      ) : (
        <>
          <style>{`@keyframes bal-shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}`}</style>
          <div data-tutorial="net-balance" style={{ background: `linear-gradient(145deg,${C.cardBgStart},${C.bg})`, borderRadius: RADIUS.lg, padding: "16px 18px", border: `1px solid ${C.border}`, position: "relative", overflow: "hidden", boxShadow: "0 4px 32px rgba(0,194,255,0.08)" }}>
            <div style={{ position: "absolute", top: -30, right: -30, width: 110, height: 110, borderRadius: "50%", background: C.cyan + "0B", pointerEvents: "none" }} />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <span style={{ fontSize: 10, color: C.muted, letterSpacing: 1, fontWeight: 600, textTransform: "uppercase" }}>
                {t("dashboard.account_balance")}
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {isShowingLastMonth && <span style={{ fontSize: 9, color: C.yellow, fontWeight: 600, background: C.yellow + "18", padding: "2px 7px", borderRadius: RADIUS.full, letterSpacing: 0.3 }}>
                  {new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1).toLocaleString('en-US', { month: 'short' })} data
                </span>}
                <button onClick={() => setBalanceVisible(v => !v)} aria-label={balanceVisible ? t("dashboard.hide_balance") : t("dashboard.show_balance")} style={{ background: "none", border: "none", cursor: "pointer", padding: "2px", display: "flex", alignItems: "center", justifyContent: "center", minHeight: 44, minWidth: 44 }}>
                  <Icon name={balanceVisible ? "eye" : "eye-off"} size={15} color={C.faint} />
                </button>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 8 }}>
              <div>
                {accountBalance != null ? (
                  <>
                    <div className="ph-mask" style={{ fontSize: 40, fontWeight: 800, letterSpacing: -1.5, color: balanceVisible ? C.cyan : C.text, lineHeight: 1.1, textShadow: balanceVisible ? `0 0 24px ${C.cyan}44` : "none" }}>
                      {balanceVisible ? `$${fmt(accountBalance)}` : "••••"}
                    </div>
                    <div style={{ fontSize: 9, color: C.faint, marginTop: 2, letterSpacing: 0.5 }}>
                      {t("dashboard.available_in_bank")}
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ width: 160, height: 42, borderRadius: RADIUS.xs, background: `linear-gradient(90deg,${C.bgSecondary} 0%,${C.bgTertiary} 40%,${C.bgSecondary} 100%)`, backgroundSize: "200% 100%", animation: "bal-shimmer 1.4s ease-in-out infinite", marginBottom: 6 }} />
                    <div style={{ width: 90, height: 10, borderRadius: RADIUS.xs, background: `linear-gradient(90deg,${C.bgSecondary} 0%,${C.bgTertiary} 40%,${C.bgSecondary} 100%)`, backgroundSize: "200% 100%", animation: "bal-shimmer 1.4s ease-in-out infinite" }} />
                  </>
                )}
              </div>
              <Sparkline transactions={transactions} />
            </div>
          </div>
        </>
      )}

      {/* 2 ── Cash Flow Forecast */}
      <CashFlowForecast
        accountBalance={accountBalance}
        transactions={transactions}
        balanceVisible={balanceVisible}
        merchantAliasMap={merchantAliasMap}
        bankConnected={bankConnected}
        onNavigate={onNavigate}
        scheduledPayments={scheduledPayments}
      />

      {/* 2b ── Credit Cards */}
      {creditAccounts.length > 0 && (() => {
        const totalDebt = sumCreditDebt(creditAccounts);
        const netWorth = accountBalance != null ? accountBalance - totalDebt : null;
        const utilColor = (pct) => pct == null ? C.faint : pct >= 0.70 ? C.red : pct >= 0.30 ? C.yellow : C.green;
        return (
          <div style={{ background: `linear-gradient(145deg,${C.cardBgStart},${C.bg})`, borderRadius: RADIUS.md, padding: "14px 18px", border: `1px solid ${C.border}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
              <span style={{ fontSize: 10, color: C.muted, letterSpacing: 1, fontWeight: 600, textTransform: "uppercase" }}>
                {t("dashboard.credit_cards_title")}
              </span>
              <span className="ph-mask" style={{ fontSize: 17, fontWeight: 800, color: C.red }}>{m(totalDebt)}</span>
            </div>
            {netWorth != null && (
              <div className="ph-mask" style={{ fontSize: 11, color: C.faint, marginBottom: 12 }}>
                {t("dashboard.credit_cards_net_worth")}: {balanceVisible ? (netWorth < 0 ? `-$${fmt(Math.abs(netWorth))}` : `$${fmt(netWorth)}`) : "••••"}
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: netWorth != null ? 0 : 8 }}>
              {creditAccounts.map((a, i) => {
                const pct = creditUtilization(a);
                const color = utilColor(pct);
                return (
                  <div key={a.account_id || i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 13, color: C.text, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name || a.official_name || t("dashboard.credit_cards_title")}</span>
                    <span className="ph-mask" style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{m(Number(a.balance_current ?? 0))}</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color, minWidth: 34, textAlign: "right" }}>{pct != null ? `${Math.round(pct * 100)}%` : "—"}</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}


      {/* 3 ── Monthly Cash Flow */}
      {!bankConnected ? (
        <ConnectBankPrompt title={t("dashboard.monthly_cash_flow")} message={t("dashboard.connect_bank_cashflow")} onNavigate={onNavigate} />
      ) : (
        <div style={{ background: `linear-gradient(145deg,${C.cardBgStart},${C.bg})`, borderRadius: RADIUS.md, padding: "14px 18px", border: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 10, color: C.muted, letterSpacing: 1, fontWeight: 600, textTransform: "uppercase", marginBottom: 12 }}>{t("dashboard.monthly_cash_flow")}</div>
          <div style={{ display: "flex" }}>
            {[
              { key: "income",   label: t("dashboard.income"),   value: m(totalIncome), color: C.green, dot: C.green, change: incomeChange },
              { key: "expenses", label: t("dashboard.expenses"), value: m(totalSpent),  color: C.red,   dot: C.red,   change: expenseChange, flip: true },
              { key: "net",      label: t("dashboard.net"),      value: balanceVisible ? (balance < 0 ? `-$${fmt(Math.abs(balance))}` : `$${fmt(balance)}`) : "••••", color: balance >= 0 ? C.green : C.red, dot: balance >= 0 ? C.green : C.red },
            ].map((item, i) => (
              <div key={item.key} style={{ flex: 1, paddingLeft: i > 0 ? 10 : 0, borderLeft: i > 0 ? `1px solid ${C.sep}` : "none", marginLeft: i > 0 ? 10 : 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 2 }}>
                  <div style={{ width: 5, height: 5, borderRadius: RADIUS.full, background: item.dot }} />
                  <span style={{ fontSize: 9, color: C.muted, fontWeight: 500 }}>{item.label}</span>
                </div>
                <div className="ph-mask" style={{ fontSize: item.key === "net" ? 17 : 13, fontWeight: item.key === "net" ? 800 : 700, color: item.color, marginBottom: 3 }}>{item.value}</div>
                {item.change !== undefined && <StatBadge value={item.flip ? -item.change : item.change} suffix="" />}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 2 ── Financial Health Score */}
      <div data-tutorial="health-score">
        <HealthScoreBar score={healthScore} color={scoreColor} comment={healthComment} breakdown={scoreBreakdown} hasData={totalIncome > 0 || totalSpent > 0} prevScore={prevHealthScore} cashPositionLow={cashPositionLow} />
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
            <div style={{ height: 3, background: C.bgTertiary, borderRadius: RADIUS.full }}>
              <div style={{ height: 3, borderRadius: RADIUS.full, width: `${Math.min(budgetPct, 100)}%`, background: barColor, transition: "width 0.6s" }} />
            </div>
          </GlassCard>
        );
      })()}

      {/* 3 ── Spending by Category */}
      <GlassCard style={{ padding: "14px 16px", boxShadow: "0 4px 24px rgba(0,0,0,0.12)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>{t("dashboard.spending_by_category")}</span>
          {isPro
            ? <span style={{ fontSize: 10, color: C.faint, background: C.bgTertiary, padding: "3px 8px", borderRadius: RADIUS.full }}>{t("dashboard.tap_to_filter")}</span>
            : <span style={{ fontSize: 10, color: C.cyan + "AA", background: C.cyan + "10", padding: "3px 8px", borderRadius: RADIUS.full, cursor: "pointer" }} onClick={onUpgrade}>Pro</span>
          }
        </div>
        {Object.keys(spendingByCategory).length === 0 ? (
          <div style={{ textAlign: "center", padding: "24px 0", color: C.faint, fontSize: 13 }}>
            {t("dashboard.no_spending_data")}
          </div>
        ) : (
          <DonutChart data={spendingByCategory} size={196} onCatClick={isPro ? handleCatClick : null} hideAmounts={!balanceVisible} lockList={!isPro} onUpgrade={onUpgrade} />
        )}
      </GlassCard>

      {/* 6 ── Month Calendar (replaces Recent Transactions) */}
      <MonthCalendar transactions={transactions} merchantAliasMap={merchantAliasMap} onDayClick={onDayClick} onDayCategoryClick={onDayCategoryClick} scheduledPayments={scheduledPayments} onAddScheduledPayment={onAddScheduledPayment} onCancelScheduledPayment={onCancelScheduledPayment} accountBalance={accountBalance} bankConnected={bankConnected} onNavigate={onNavigate} />

      {/* 5 ── Market Overview */}
      <MarketOverview onOpenMarket={onOpenMarket} />

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
        const otherTotal = sumAmounts(otherTxs);

        return (
          <div onClick={() => setOtherBreakdown(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 180, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
            <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 430, background: C.card, borderRadius: '20px 20px 0 0', border: `1px solid ${C.border}`, padding: '0 0 32px', maxHeight: '75vh', display: 'flex', flexDirection: 'column' }}>
              {/* Handle */}
              <div style={{ padding: '14px 0 0', display: 'flex', justifyContent: 'center' }}>
                <div style={{ width: 36, height: 4, borderRadius: RADIUS.full, background: 'rgba(255,255,255,0.12)' }} />
              </div>
              {/* Header */}
              <div style={{ padding: '12px 20px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${C.sep}`, flexShrink: 0 }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>{t("dashboard.whats_in_other")}</div>
                  <div className="ph-mask" style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>${fmt(otherTotal, 0)} {t("dashboard.this_month")} · {t("dashboard.transaction", { count: otherTxs.length })}</div>
                </div>
                <button onClick={() => setOtherBreakdown(false)} aria-label={t("dashboard.close")} style={{ background: C.bgTertiary, border: `1px solid ${C.border}`, borderRadius: RADIUS.xs, width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
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
                        <div style={{ width: 34, height: 34, borderRadius: RADIUS.sm, background: CAT_COLORS.Other + '22', border: `1px solid ${CAT_COLORS.Other}33`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={CAT_COLORS.Other} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.name}</div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
                            <div style={{ height: 3, borderRadius: RADIUS.full, background: CAT_COLORS.Other + '40', flex: 1, overflow: 'hidden' }}>
                              <div style={{ height: '100%', width: `${pct}%`, background: CAT_COLORS.Other, borderRadius: RADIUS.full }} />
                            </div>
                            <span style={{ fontSize: 10, color: C.faint, flexShrink: 0 }}>{Math.round(pct)}%</span>
                          </div>
                        </div>
                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          <div className="ph-mask" style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{balanceVisible ? `$${fmt(row.total, 0)}` : '••••'}</div>
                          {row.count > 1 && <div style={{ fontSize: 10, color: C.faint }}>{row.count} txns</div>}
                        </div>
                      </div>
                    );
                  })
                }
              </div>
              {/* Footer CTA */}
              <div style={{ padding: '12px 20px 0', flexShrink: 0 }}>
                <button onClick={() => { setOtherBreakdown(false); onCatClick?.('Other'); }} style={{ width: '100%', padding: '12px 0', background: C.bgTertiary, border: `1px solid ${C.border}`, borderRadius: RADIUS.sm, color: C.muted, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: FONT }}>
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

