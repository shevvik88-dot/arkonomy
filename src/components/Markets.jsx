import { logger } from "../utils/logger";
import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import i18n from "../i18n";
import { supabase } from "../utils/supabase";
import { SUPABASE_URL, SUPABASE_KEY } from "../utils/supabase";
import { C, FONT, RADIUS, DASHBOARD_C as DC } from "../utils/colors";
import { fmtPct } from "../utils/helpers";
import GlassCard from "./shared/GlassCard";
import Icon from "./shared/Icon";
import { IS_IOS_NATIVE } from "../lib/platform";
import { useUSStorefront } from "../lib/storefront";

// ─── Constants ────────────────────────────────────────────────

const DEFAULT_WATCHLIST = ["SPY", "QQQ", "BTC", "ETH"];
const MAX_WATCHLIST = 20;

// Colors desaturated via the same HSL formula as CAT_COLORS/INCOME_CATS/
// ASSET_TILES (S -> 35+S*0.22, L -> L*0.92, hue unchanged). These are
// identity colors (which symbol/sector this is), not status colors, so
// they're preserved as a distinguishable set rather than collapsed into
// DC.gold — same reasoning as Savings.jsx's ASSET_TILES.
const MARKET_META = {
  SPY:  { label: "S&P 500",  color: "#477ACD", icon: "bar-chart", isCrypto: false },
  QQQ:  { label: "NASDAQ",   color: "#9781DA", icon: "activity",  isCrypto: false },
  BTC:  { label: "Bitcoin",  color: "#B68735", icon: "zap",       isCrypto: true  },
  ETH:  { label: "Ethereum", color: "#3EB68A", icon: "zap",       isCrypto: true  },
  SOL:  { label: "Solana",   color: "#905BD2", icon: "zap",       isCrypto: true  },
  DOGE: { label: "Dogecoin", color: "#A6913A", icon: "zap",       isCrypto: true  },
};

const TRENDING = [
  { symbol: "AAPL", name: "Apple Inc.",   color: "#9AA4B2" }, // already neutral, untouched
  { symbol: "TSLA", name: "Tesla, Inc.",  color: "#C85B5B" },
  { symbol: "NVDA", name: "NVIDIA Corp.", color: "#76A02C" },
];

const SECTORS = [
  { name: "Tech",       etf: "XLK", color: "#477ACD", stocks: ["AAPL", "MSFT", "NVDA"]  },
  { name: "Finance",    etf: "XLF", color: "#9781DA", stocks: ["JPM",  "BAC",  "GS"]    },
  { name: "Energy",     etf: "XLE", color: "#B68735", stocks: ["XOM",  "CVX",  "COP"]   },
  { name: "Healthcare", etf: "XLV", color: "#3EB68A", stocks: ["UNH",  "JNJ",  "ABBV"]  },
  { name: "Consumer",   etf: "XLY", color: "#D97395", stocks: ["AMZN", "HD",   "MCD"]   },
];

// Alpaca uses BTCUSD / ETHUSD for crypto orders
const ALPACA_SYMBOL_MAP = { BTC: "BTCUSD", ETH: "ETHUSD", SOL: "SOLUSD", DOGE: "DOGEUSD" };
function alpacaSym(s) { return ALPACA_SYMBOL_MAP[s] ?? s; }


function cleanCompanyName(name) {
  if (!name) return name;
  return name.replace(/,?\s+(Inc|Corp|Ltd|LLC|Co|PLC|LP|NV|SA|SE|AG|GmbH)\.?\s*$/i, "").trim();
}

function fmtPrice(n, isCrypto = false) {
  if (n == null) return "—";
  if (isCrypto && n >= 1000) return "$" + Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (isCrypto) return "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  return "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function callMarketData(body) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${SUPABASE_URL}/functions/v1/market-data`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${session?.access_token ?? ""}`,
        "apikey": SUPABASE_KEY,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  } catch (err) {
    logger.error("[callMarketData] failed:", err);
    return { error: "Failed to load market data" };
  }
}
// ─── Stock Logo ───────────────────────────────────────────────

function StockLogo({ symbol, color, icon, size = 36, borderRadius = 10 }) {
  const bg = (color ?? DC.gold) + "22";
  const border = `1px solid ${(color ?? DC.gold)}33`;
  const circleRadius = icon ? borderRadius : "50%";
  return (
    <div style={{ width: size, height: size, borderRadius: circleRadius, background: bg, border, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
      {icon
        ? <Icon name={icon} size={Math.round(size * 0.42)} color={color ?? DC.gold} strokeWidth={2.5} />
        : <span style={{ fontSize: Math.round(size * 0.44), fontWeight: 800, color: color ?? DC.gold, letterSpacing: -0.5 }}>{(symbol || "?")[0]}</span>
      }
    </div>
  );
}

// ─── Price Chart (SVG, no dependencies) ──────────────────────

function PriceChart({ candles = [], color, height = 130 }) {
  const { t } = useTranslation();
  const [crosshair, setCrosshair] = useState(null);
  const svgRef = useRef(null);

  if (!candles.length) return (
    <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center", color: DC.faint, fontSize: 12 }}>
      {t("markets.no_chart_data")}
    </div>
  );

  const valid = candles.filter(c => typeof c.c === "number" && isFinite(c.c));
  const prices = valid.map(c => c.c);
  const timestamps = valid.map(c => c.t);

  if (prices.length < 2) {
    if (prices.length === 1) prices.push(prices[0]);
    else return (
      <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center", color: DC.faint, fontSize: 12 }}>
        {t("markets.no_chart_data")}
      </div>
    );
  }

  const min    = Math.min(...prices);
  const max    = Math.max(...prices);
  const range  = max - min || 1;
  const W = 320, PAD = 6;
  const isPositive = prices[prices.length - 1] >= prices[0];
  const lineColor  = color ?? (isPositive ? DC.emerald : DC.ruby);
  const gradId = `cg_${lineColor.replace("#", "")}`;

  const pts = prices.map((p, i) => ({
    x: PAD + (i / (prices.length - 1)) * (W - PAD * 2),
    y: PAD + (1 - (p - min) / range) * (height - PAD * 2),
  }));
  const ptsStr = pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`);
  const linePath = `M ${ptsStr.join(" L ")}`;
  const fillPath = `${linePath} L ${(W - PAD).toFixed(1)},${height} L ${PAD},${height} Z`;
  const lastPt    = pts[pts.length - 1];
  const lastPrice = prices[prices.length - 1];
  const lastTs    = timestamps[timestamps.length - 1];

  function handleMove(clientX) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const idx  = Math.round(frac * (prices.length - 1));
    setCrosshair({ idx, frac, price: prices[idx], ts: timestamps[idx], pt: pts[idx] });
  }

  const fmtCrosshairPrice = (p) =>
    p >= 1000 ? "$" + Number(p).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
              : "$" + Number(p).toFixed(p < 1 ? 4 : 2);

  const tooltipLeft = crosshair
    ? Math.min(Math.max(crosshair.frac * 100, 8), 92) + "%"
    : "50%";

  return (
    <div style={{ position: "relative", userSelect: "none" }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${height}`}
        style={{ width: "100%", height, display: "block", touchAction: "none" }}
        preserveAspectRatio="none"
        onPointerMove={e => handleMove(e.clientX)}
        onPointerLeave={() => setCrosshair(null)}
        onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); handleMove(e.clientX); }}
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor={lineColor} stopOpacity="0.25" />
            <stop offset="100%" stopColor={lineColor} stopOpacity="0"    />
          </linearGradient>
        </defs>
        <path d={fillPath} fill={`url(#${gradId})`} />
        <path d={linePath} fill="none" stroke={lineColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        {!crosshair && (
          <>
            <circle cx={lastPt.x} cy={lastPt.y} r="3.5" fill={lineColor} />
            <circle cx={lastPt.x} cy={lastPt.y} r="6.5" fill={lineColor} fillOpacity="0.2" />
          </>
        )}
        {crosshair && (
          <>
            <line
              x1={crosshair.pt.x} y1={PAD}
              x2={crosshair.pt.x} y2={height - PAD}
              stroke={lineColor} strokeWidth="1" strokeDasharray="3,3" opacity="0.55"
            />
            <circle cx={crosshair.pt.x} cy={crosshair.pt.y} r="4" fill={lineColor} />
            <circle cx={crosshair.pt.x} cy={crosshair.pt.y} r="7" fill={lineColor} fillOpacity="0.2" />
          </>
        )}
      </svg>
      {crosshair ? (
        <div style={{
          position: "absolute", top: 0,
          left: tooltipLeft,
          transform: "translateX(-50%)",
          background: DC.card,
          border: `1px solid ${lineColor}55`,
          borderRadius: RADIUS.xs,
          padding: "4px 8px",
          fontSize: 12,
          fontWeight: 700,
          color: DC.text,
          pointerEvents: "none",
          whiteSpace: "nowrap",
          boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
          zIndex: 10,
        }}>
          {fmtCrosshairPrice(crosshair.price)}
          <span style={{ color: DC.faint, fontWeight: 400, fontSize: 10, marginLeft: 5 }}>
            {new Date(crosshair.ts * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          </span>
        </div>
      ) : (
        <div style={{
          position: "absolute", top: 4, right: 6,
          background: DC.card,
          border: `1px solid ${lineColor}33`,
          borderRadius: RADIUS.xs,
          padding: "3px 8px",
          fontSize: 12,
          fontWeight: 700,
          color: DC.text,
          pointerEvents: "none",
          whiteSpace: "nowrap",
          boxShadow: "0 2px 6px rgba(0,0,0,0.35)",
        }}>
          {fmtCrosshairPrice(lastPrice)}
          <span style={{ color: DC.faint, fontWeight: 400, fontSize: 10, marginLeft: 5 }}>
            {new Date(lastTs * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          </span>
        </div>
      )}
      {!crosshair && (
        <div style={{ fontSize: 10, color: DC.faint, textAlign: "center", marginTop: 5, letterSpacing: 0.2 }}>
          {t("markets.touch_hint")}
        </div>
      )}
    </div>
  );
}

// ─── Stock Detail Screen ──────────────────────────────────────

function StockDetail({ symbol, onBack, user, alpacaConnected, onConnectAlpaca, isPro, isTrial, onUpgrade, watchlist = [], addToWatchlist, removeFromWatchlist, onToast, ownedPosition = null }) {
  const { t } = useTranslation();
  const meta    = MARKET_META[symbol] ?? { label: symbol, color: DC.gold, icon: "activity", isCrypto: false };
  const [tab, setTab]         = useState("overview");
  const [period, setPeriod]   = useState("1M");
  const [stats, setStats]     = useState(null);
  const [candles, setCandles] = useState([]);
  const [ai, setAi]           = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState(null);
  const [loadingStats, setLoadingStats]   = useState(true);
  const [loadingChart, setLoadingChart]   = useState(false);
  const [chartError, setChartError]       = useState(null);
  const [buyAmt, setBuyAmt]   = useState("100");
  const [buying, setBuying]   = useState(false);
  const [buyResult, setBuyResult] = useState(null);

  // Use a ref so loadAi always reads the latest stats without being in effect deps
  const statsRef = useRef(null);
  useEffect(() => {
    setLoadingStats(true);
    callMarketData({ type: "stats", symbol })
      .then(d => { statsRef.current = d; setStats(d); setLoadingStats(false); })
      .catch(() => setLoadingStats(false));
  }, [symbol]);

  useEffect(() => {
    setLoadingChart(true);
    setChartError(null);
    callMarketData({ type: "chart", symbol, period })
      .then(d => {
        if (d?.error) {
          logger.error("[Chart] API error:", d.error);
          setChartError(d.error);
          setCandles([]);
        } else {
          setCandles(d?.candles ?? []);
        }
        setLoadingChart(false);
      })
      .catch(err => {
        logger.error("[Chart] fetch error:", err);
        setChartError(String(err));
        setLoadingChart(false);
      });
  }, [symbol, period]);

  // Use a ref to guard against double-invocation (StrictMode / fast deps)
  const aiCalledRef = useRef(false);

  async function runAiAnalysis() {
    if (aiCalledRef.current) return;
    aiCalledRef.current = true;
    setAiLoading(true);
    setAiError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const s = statsRef.current;
      const res = await fetch(`${SUPABASE_URL}/functions/v1/stock-ai-analysis`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session?.access_token ?? ""}`,
          "apikey": SUPABASE_KEY,
        },
        body: JSON.stringify({
          symbol,
          name:      s?.name ?? symbol,
          price:     s?.price ?? null,
          pe:        s?.pe ?? null,
          high52w:   s?.high52w ?? null,
          low52w:    s?.low52w ?? null,
          changePct: s?.changePct ?? null,
          isCrypto:  meta.isCrypto,
          lang:      i18n.language ?? "en",
        }),
      });
      if (!res.ok && res.status !== 200) {
        let errMsg = `HTTP ${res.status}`;
        try { const j = await res.json(); errMsg = j.error ?? errMsg; } catch {}
        throw new Error(errMsg);
      }
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setAi(data);
    } catch (e) {
      logger.error("[AI Analysis] error:", e);
      setAiError(e.message ?? "Analysis failed");
    } finally {
      setAiLoading(false);
    }
  }

  useEffect(() => {
    if (tab === "ai") runAiAnalysis();
  }, [tab]);

  async function handleBuy() {
    if (buying || !buyAmt || Number(buyAmt) < 1) return;
    setBuying(true);
    setBuyResult(null);
    try {
      const { data: result, error } = await supabase.functions.invoke("alpaca-invest", {
        body: { amount: Number(buyAmt), symbol: alpacaSym(symbol) },
      });
      if (error) {
        // supabase.functions.invoke wraps non-2xx in FunctionsHttpError —
        // the real error body is in error.context, not error.message
        let msg = error.message ?? "Order failed";
        try {
          const body = typeof error.context?.json === "function"
            ? await error.context.json()
            : null;
          if (body?.error)   msg = body.error;
          if (body?.details) logger.error("[Buy] Alpaca details:", body.details);
        } catch {}
        logger.error("[Buy] invoke error:", msg);
        if (msg.includes("Insufficient buying power") || msg.includes("not configured") || msg.includes("ALPACA_API_KEY")) {
          setBuyResult({ notConnected: true });
        } else {
          setBuyResult({ error: msg });
        }
      } else if (result?.error) {
        if (result.error.includes("Insufficient buying power") || result.error.includes("not configured")) {
          setBuyResult({ notConnected: true });
        } else {
          setBuyResult({ error: result.error });
        }
      } else {
        setBuyResult({ success: true, message: result?.message ?? `$${buyAmt} order placed` });
      }
    } catch (e) { setBuyResult({ error: String(e) }); }
    setBuying(false);
  }

  const isPos = (stats?.changePct ?? 0) >= 0;
  const chColor = isPos ? DC.emerald : DC.ruby;
  const PERIODS = ["1D", "1W", "1M", "1Y"];
  const TABS = ["overview", "chart", "ai", "buy"];

  const inWatchlist = watchlist.includes(symbol);
  function toggleWatchlist() {
    if (inWatchlist) {
      removeFromWatchlist?.(symbol);
    } else if (watchlist.length >= MAX_WATCHLIST) {
      onToast?.(t("markets.watchlist_full"), "warning");
    } else {
      addToWatchlist?.(symbol);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", paddingBottom: 80, fontFamily: FONT }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
        <button onClick={onBack} style={{ background: DC.card, border: `1px solid ${DC.faint}33`, borderRadius: RADIUS.sm, width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}>
          <Icon name="arrow-left" size={16} color={DC.text} />
        </button>
        <StockLogo symbol={symbol} color={meta.color} icon={meta.icon} size={38} borderRadius={12} />
        <div style={{ flex: 1 }}>
          {/* Real bug fix (2026-08-24): MARKET_META only curates ~18
              symbols (SPY, QQQ, BTC...) — for anything else (any ticker
              actually bought via search, e.g. MP/WST/SPCX) meta.label
              fell back to the bare symbol, so this line and the one below
              it both just showed the ticker twice, no real company name
              anywhere. stats.name (market-data, already fetched for the
              AI-analysis call below) has the real name for any symbol. */}
          <div style={{ fontWeight: 700, fontSize: 16 }}>{cleanCompanyName(stats?.name || meta.label) || symbol}</div>
          <div style={{ fontSize: 12, color: DC.muted }}>{symbol}</div>
        </div>
        <button onClick={toggleWatchlist} aria-label={t("markets.watchlist")} style={{ background: DC.card, border: `1px solid ${DC.faint}33`, borderRadius: RADIUS.sm, width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}>
          <Icon name="star" size={16} color={inWatchlist ? DC.gold : DC.muted} fill={inWatchlist ? DC.gold : "none"} />
        </button>
        {stats && (
          <div style={{ textAlign: "right" }}>
            <div style={{ fontWeight: 800, fontSize: 20, letterSpacing: -0.5 }}>{fmtPrice(stats.price, meta.isCrypto)}</div>
            <div style={{ fontSize: 12, color: chColor, fontWeight: 600 }}>{fmtPct(stats.changePct)}</div>
          </div>
        )}
      </div>

      {/* Your Position — the actual gap this whole investigation started
          from: clicking a Holdings row (or any other list) opened this
          same generic market screen with zero owned-position context, even
          though avg_entry_price/qty/unrealized P&L were already fetched by
          alpaca-portfolio and displayed inline in the Holdings row itself
          — just never passed down. No purchase date here (deliberately,
          2026-08-24) — investments.created_at can't be trusted as "this
          was actually filled" without a live /v2/orders check first (see
          the WST/SPCX pending-order investigation), out of scope for this
          pass. */}
      {ownedPosition && (
        <div style={{ background: DC.card, border: `1px solid ${DC.faint}33`, borderRadius: RADIUS.sm, padding: "14px 16px", marginBottom: 18 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: DC.faint, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 10 }}>{t("markets.your_position")}</div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ fontSize: 12, color: DC.muted }}>{t("markets.qty_shares", { qty: ownedPosition.qty.toFixed(4) })}</span>
            <span className="ph-mask" style={{ fontSize: 12, color: DC.muted }}>{t("markets.avg_cost", { price: fmtPrice(ownedPosition.avg_entry_price) })}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span className="ph-mask" style={{ fontSize: 15, fontWeight: 700, color: DC.text }}>{fmtPrice(ownedPosition.market_value)}</span>
            <span className="ph-mask" style={{ fontSize: 13, fontWeight: 600, color: ownedPosition.unrealized_pl >= 0 ? DC.emerald : DC.ruby }}>
              {ownedPosition.unrealized_pl >= 0 ? "+" : "-"}{fmtPrice(Math.abs(ownedPosition.unrealized_pl))} ({ownedPosition.unrealized_pl >= 0 ? "+" : ""}{(ownedPosition.unrealized_plpc * 100).toFixed(2)}%)
            </span>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 16, background: DC.card, borderRadius: RADIUS.sm, padding: 4 }}>
        {TABS.map(tabId => (
          <button key={tabId} onClick={() => setTab(tabId)}
            style={{ flex: 1, padding: "7px 0", borderRadius: RADIUS.sm, border: "none", background: tab === tabId ? DC.bg : "transparent", color: tab === tabId ? DC.text : DC.faint, fontWeight: tab === tabId ? 700 : 400, fontSize: 12, cursor: "pointer", fontFamily: FONT, textTransform: "capitalize" }}>
            {t("markets.tab_" + tabId)}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW TAB ─────────────────────────────────────── */}
      {tab === "overview" && (
        <GlassCard style={{ background: DC.card, border: `1px solid ${DC.faint}33` }}>
          {loadingStats ? (
            <div style={{ color: DC.faint, fontSize: 13, textAlign: "center", padding: "20px 0" }}>{t("markets.loading_stats")}</div>
          ) : stats?.error ? (
            <div style={{ color: DC.ruby, fontSize: 12 }}>{t("markets.could_not_load_stats")}</div>
          ) : (
            <>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 14 }}>{t("markets.key_stats")}</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
                {[
                  { label: t("markets.price"),      value: fmtPrice(stats?.price, meta.isCrypto) },
                  { label: t("markets.change"),     value: fmtPct(stats?.changePct), color: (stats?.changePct ?? 0) >= 0 ? DC.emerald : DC.ruby },
                  !meta.isCrypto && { label: t("markets.beta"),       value: stats?.beta != null ? Number(stats.beta).toFixed(2) : "—" },
                  !meta.isCrypto && { label: t("markets.div_yield"), value: stats?.dividendYield != null ? Number(stats.dividendYield).toFixed(2) + "%" : "—" },
                ].filter(Boolean).map((s) => (
                  <div key={s.label} style={{ background: DC.bg, borderRadius: RADIUS.sm, padding: "10px 12px" }}>
                    <div style={{ fontSize: 10, color: DC.faint, fontWeight: 500, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>{s.label}</div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: s.color ?? DC.text }}>{s.value}</div>
                  </div>
                ))}
              </div>

              {/* Range bars */}
              {(() => {
                const p = stats?.price, dh = stats?.dayHigh, dl = stats?.dayLow;
                const wh = stats?.high52w, wl = stats?.low52w;
                const dayPct  = (dh != null && dl != null && dh > dl) ? Math.round((p - dl) / (dh - dl) * 100) : null;
                const w52Pct  = (wh != null && wl != null && wh > wl) ? Math.round((p - wl) / (wh - wl) * 100) : null;
                const RangeBar = ({ label, lo, hi, pct, isCrypto: ic }) => (
                  <div style={{ background: DC.bg, borderRadius: RADIUS.sm, padding: "10px 12px" }}>
                    <div style={{ fontSize: 10, color: DC.faint, fontWeight: 500, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>{label}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                      <span style={{ fontSize: 11, color: DC.muted }}>{fmtPrice(lo, ic)}</span>
                      <div style={{ flex: 1, height: 4, background: `${DC.faint}33`, borderRadius: RADIUS.full, position: "relative" }}>
                        {pct != null && (
                          <div style={{ position: "absolute", left: `${Math.max(1, Math.min(97, pct))}%`, top: "50%", transform: "translate(-50%, -50%)", width: 8, height: 8, borderRadius: "50%", background: meta.color }} />
                        )}
                        <div style={{ height: "100%", width: pct != null ? `${pct}%` : "0%", background: meta.color + "44", borderRadius: RADIUS.full }} />
                      </div>
                      <span style={{ fontSize: 11, color: DC.muted }}>{fmtPrice(hi, ic)}</span>
                    </div>
                  </div>
                );
                return (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
                    {dh != null && dl != null && <RangeBar label={t("markets.day_range")} lo={dl} hi={dh} pct={dayPct} isCrypto={meta.isCrypto} />}
                    {wh != null && wl != null && <RangeBar label={t("markets.week_52_range")} lo={wl} hi={wh} pct={w52Pct} isCrypto={meta.isCrypto} />}
                  </div>
                );
              })()}

              {/* OHLC day stats */}
              {(stats?.dayOpen != null || stats?.dayHigh != null || stats?.dayLow != null || stats?.prevClose != null) && (
                <>
                  <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 10 }}>{t("markets.open_high_low_close")}</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    {[
                      { label: t("markets.open"),       value: fmtPrice(stats?.dayOpen,    meta.isCrypto) },
                      { label: t("markets.day_high"),   value: fmtPrice(stats?.dayHigh,    meta.isCrypto), color: DC.emerald },
                      { label: t("markets.day_low"),    value: fmtPrice(stats?.dayLow,     meta.isCrypto), color: DC.ruby },
                      { label: t("markets.prev_close"), value: fmtPrice(stats?.prevClose,  meta.isCrypto) },
                    ].map(s => (
                      <div key={s.label} style={{ background: DC.bg, borderRadius: RADIUS.sm, padding: "10px 12px" }}>
                        <div style={{ fontSize: 10, color: DC.faint, fontWeight: 500, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>{s.label}</div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: s.color ?? DC.text }}>{s.value}</div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </GlassCard>
      )}

      {/* ── CHART TAB ────────────────────────────────────────── */}
      {tab === "chart" && (
        <GlassCard style={{ background: DC.card, border: `1px solid ${DC.faint}33` }}>
          <div style={{ display: "flex", gap: 4, marginBottom: 14 }}>
            {PERIODS.map(p => (
              <button key={p} onClick={() => setPeriod(p)}
                style={{ flex: 1, padding: "5px 0", borderRadius: RADIUS.xs, border: `1px solid ${period === p ? meta.color + "66" : `${DC.faint}33`}`, background: period === p ? meta.color + "18" : "transparent", color: period === p ? meta.color : DC.faint, fontWeight: period === p ? 700 : 400, fontSize: 12, cursor: "pointer", fontFamily: FONT }}>
                {p}
              </button>
            ))}
          </div>
          {loadingChart ? (
            <div style={{ height: 130, display: "flex", alignItems: "center", justifyContent: "center", color: DC.faint, fontSize: 12 }}>{t("markets.loading_chart")}</div>
          ) : chartError ? (
            <div style={{ background: DC.ruby + "12", border: `1px solid ${DC.ruby}33`, borderRadius: RADIUS.sm, padding: "12px 14px", margin: "4px 0" }}>
              <div style={{ fontSize: 13, color: DC.ruby, fontWeight: 600, marginBottom: 4 }}>{t("markets.chart_unavailable")}</div>
              <div style={{ fontSize: 12, color: DC.muted, lineHeight: 1.5 }}>
                {chartError}
              </div>
            </div>
          ) : (
            <>
              <PriceChart candles={candles} color={meta.color} height={140} />
              {candles.length > 0 ? (
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
                  <span style={{ fontSize: 11, color: DC.faint }}>
                    {new Date(candles[0].t * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </span>
                  <span style={{ fontSize: 11, color: DC.faint }}>
                    {new Date(candles[candles.length - 1].t * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </span>
                </div>
              ) : (
                <div style={{ fontSize: 12, color: DC.faint, textAlign: "center", marginTop: 8 }}>
                  {meta.isCrypto ? t("markets.no_chart_crypto") : t("markets.no_chart_stock")}
                </div>
              )}
              <div style={{ fontSize: 10, color: DC.faint, textAlign: "right", marginTop: 6 }}>{t("markets.powered_by_finnhub")}</div>
            </>
          )}
        </GlassCard>
      )}

      {/* ── AI TAB ───────────────────────────────────────────── */}
      {tab === "ai" && (
        <GlassCard style={{ background: DC.card, border: `1px solid ${DC.gold}22` }}>
          <style>{`@keyframes aiDot{0%,80%,100%{transform:translateY(0);opacity:0.4}40%{transform:translateY(-5px);opacity:1}}`}</style>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
            <div style={{ width: 30, height: 30, borderRadius: RADIUS.xs, background: DC.gold + "18", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Icon name="activity" size={14} color={DC.gold} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{t("markets.ai_analysis")}</div>
              <div style={{ fontSize: 11, color: DC.faint }}>{t("markets.powered_by_claude")}</div>
            </div>
            {aiError && !aiLoading && (
              <button onClick={() => { aiCalledRef.current = false; setAi(null); setAiError(null); runAiAnalysis(); }}
                style={{ background: DC.bg, border: `1px solid ${DC.faint}33`, borderRadius: RADIUS.xs, padding: "4px 10px", color: DC.muted, fontSize: 12, cursor: "pointer", fontFamily: FONT }}>
                {t("common.retry")}
              </button>
            )}
          </div>

          {aiLoading ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: "28px 0" }}>
              <div style={{ display: "flex", gap: 6 }}>
                {[0,1,2].map(i => (
                  <span key={i} style={{ width: 8, height: 8, borderRadius: "50%", background: DC.gold, display: "inline-block", animation: `aiDot 1.2s ease-in-out ${i*0.2}s infinite` }} />
                ))}
              </div>
              <div style={{ fontSize: 13, color: DC.muted }}>{t("markets.analyzing", { symbol })}</div>
            </div>
          ) : aiError ? (
            <div style={{ background: DC.ruby + "12", border: `1px solid ${DC.ruby}33`, borderRadius: RADIUS.sm, padding: "12px 14px" }}>
              <div style={{ fontSize: 13, color: DC.ruby, fontWeight: 600, marginBottom: 4 }}>{t("markets.analysis_unavailable")}</div>
              <div style={{ fontSize: 12, color: DC.muted, lineHeight: 1.5 }}>
                {t("markets.analysis_unavailable_body")}
              </div>
            </div>
          ) : ai ? (
            <>
              {ai.trend ? (
                <div style={{ marginBottom: 14 }}>
                  {/* Trend/Risks/Market Note - per-semantic collapse to DC.gold,
                      same as INSIGHT_CONFIG in Insights.jsx: each subsection
                      already has its own label + icon, color is decorative. */}
                  <div style={{ fontSize: 11, color: DC.gold, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>{t("markets.trend_analysis")}</div>
                  <div style={{ fontSize: 13, color: DC.text, lineHeight: 1.6 }}>{ai.trend}</div>
                </div>
              ) : null}
              {Array.isArray(ai.risks) && ai.risks.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 11, color: DC.gold, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>{t("markets.key_risks")}</div>
                  {ai.risks.map((r, i) => (
                    <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6 }}>
                      <div style={{ width: 5, height: 5, borderRadius: "50%", background: DC.gold, marginTop: 5, flexShrink: 0 }} />
                      <div style={{ fontSize: 13, color: DC.muted, lineHeight: 1.5 }}>{String(r)}</div>
                    </div>
                  ))}
                </div>
              )}
              {ai.analystView ? (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 11, color: DC.gold, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>{t("markets.market_note")}</div>
                  <div style={{ fontSize: 13, color: DC.text, lineHeight: 1.6 }}>{ai.analystView}</div>
                </div>
              ) : null}
              {ai.disclaimer ? (
                <div style={{ background: DC.bg, borderRadius: RADIUS.sm, padding: "10px 12px", border: `1px solid ${DC.faint}33` }}>
                  <div style={{ fontSize: 11, color: DC.faint, lineHeight: 1.6 }}>{ai.disclaimer}</div>
                </div>
              ) : null}
            </>
          ) : (
            <div style={{ textAlign: "center", padding: "24px 0", color: DC.faint, fontSize: 13 }}>
              {t("markets.retry_analysis")}
              <div style={{ marginTop: 12 }}>
                <button onClick={() => { aiCalledRef.current = false; runAiAnalysis(); }}
                  style={{ background: DC.gold + "18", border: `1px solid ${DC.gold}44`, borderRadius: RADIUS.sm, padding: "8px 20px", color: DC.gold, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: FONT }}>
                  {t("markets.analyze", { symbol })}
                </button>
              </div>
            </div>
          )}
        </GlassCard>
      )}

      {/* ── BUY TAB ──────────────────────────────────────────── */}
      {tab === "buy" && (
        <>
          {!alpacaConnected ? (
            <GlassCard style={{ marginBottom: 12, textAlign: "center", padding: "28px 20px", background: DC.card, border: `1px solid ${DC.faint}33` }}>
              <div style={{ width: 52, height: 52, borderRadius: RADIUS.md, background: DC.gold + "18", border: `1px solid ${DC.gold}33`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}>
                <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={DC.gold} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" /><polyline points="16 7 22 7 22 13" />
                </svg>
              </div>
              <div style={{ fontSize: 17, fontWeight: 700, color: DC.text, marginBottom: 6 }}>{t("markets.connect_alpaca_title")}</div>
              <div style={{ fontSize: 13, color: DC.muted, lineHeight: 1.6, marginBottom: 20 }}>
                {t("markets.connect_alpaca_body")}
              </div>
              <div style={{ background: C.alpacaAccent + "12", border: `1px solid ${C.alpacaAccent}59`, borderRadius: RADIUS.sm, padding: "14px 16px", marginBottom: 16, textAlign: "left" }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.alpacaAccent, marginBottom: 8, letterSpacing: 0.3 }}>{t("markets.authorize_alpaca")}</div>
                <div style={{ fontSize: 12, color: C.alpacaWarningMuted, lineHeight: 1.65 }}>
                  {t("markets.alpaca_disclaimer1")}
                </div>
                <div style={{ fontSize: 12, color: C.alpacaWarningMuted, lineHeight: 1.65, marginTop: 8 }}>
                  {t("markets.alpaca_disclaimer2")}
                </div>
              </div>
              <button
                onClick={onConnectAlpaca}
                style={{ width: "100%", padding: "14px 0", background: DC.gold, border: "none", borderRadius: RADIUS.sm, color: DC.bg, fontWeight: 700, fontSize: 15, cursor: "pointer", fontFamily: FONT, marginBottom: 10 }}
              >
                {t("markets.connect_alpaca_btn")}
              </button>
              <div style={{ fontSize: 11, color: DC.faint, lineHeight: 1.6 }}>
                {t("markets.alpaca_tagline")}
              </div>
            </GlassCard>
          ) : (
          <GlassCard style={{ marginBottom: 12, background: DC.card, border: `1px solid ${DC.faint}33` }}>
            <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 16 }}>{t("markets.buy_title", { label: meta.label || symbol })}</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 18 }}>
              <div style={{ background: DC.bg, borderRadius: RADIUS.sm, padding: "10px 12px" }}>
                <div style={{ fontSize: 10, color: DC.faint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>{t("markets.current_price")}</div>
                <div style={{ fontSize: 15, fontWeight: 700 }}>{fmtPrice(stats?.price, meta.isCrypto)}</div>
              </div>
              <div style={{ background: DC.bg, borderRadius: RADIUS.sm, padding: "10px 12px" }}>
                <div style={{ fontSize: 10, color: DC.faint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>{t("markets.est_shares")}</div>
                <div style={{ fontSize: 15, fontWeight: 700 }}>
                  {stats?.price && buyAmt ? (Number(buyAmt) / stats.price).toFixed(4) : "—"}
                </div>
              </div>
            </div>

            <div style={{ color: DC.muted, fontSize: 12, fontWeight: 500, marginBottom: 6 }}>{t("markets.amount_usd")}</div>
            <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
              <input
                type="number" value={buyAmt}
                onChange={e => setBuyAmt(e.target.value)}
                style={{ flex: 1, padding: "13px 14px", background: DC.bg, border: `1px solid ${DC.faint}33`, borderRadius: RADIUS.sm, color: DC.text, fontSize: 16, fontFamily: FONT }}
                placeholder="100"
              />
            </div>
            {["25","50","100","250"].map(amt => (
              <button key={amt} onClick={() => setBuyAmt(amt)}
                style={{ marginRight: 8, marginBottom: 14, padding: "5px 12px", background: buyAmt === amt ? meta.color + "22" : DC.bg, border: `1px solid ${buyAmt === amt ? meta.color + "55" : `${DC.faint}33`}`, borderRadius: RADIUS.full, color: buyAmt === amt ? meta.color : DC.muted, fontSize: 12, fontWeight: buyAmt === amt ? 700 : 400, cursor: "pointer", fontFamily: FONT }}>
                ${amt}
              </button>
            ))}

            {/* Deliberate: excludes isTrial, not just Free — same reasoning
                as App.jsx's investAlpaca() and Savings.jsx's invest gate.
                Buying real shares via Alpaca during a trial that might not
                convert would leave the user holding a position with no
                clean way to unwind it. */}
            <button
              onClick={(!isPro || isTrial) ? onUpgrade : handleBuy}
              disabled={buying}
              style={{ width: "100%", padding: 15, border: "none", borderRadius: RADIUS.sm, fontWeight: 700, fontSize: 15, fontFamily: FONT, cursor: buying ? "not-allowed" : "pointer",
                background: buying ? DC.card : (!isPro || isTrial) ? `linear-gradient(135deg,${C.proAccent},#38B6FF)` : `linear-gradient(90deg,${meta.color},${meta.color}BB)`,
                color: buying ? DC.faint : "#fff" }}>
              {buying ? t("markets.placing_order") : (!isPro || isTrial) ? (showRealUpgrade ? t("markets.upgrade_pro") : t("markets.pro_feature")) : t("markets.buy_btn", { amount: buyAmt || "—", symbol })}
            </button>

            {buyResult && (
              (buyResult.notConnected || buyResult.noFunds) ? (
                <div style={{ marginTop: 14, padding: "18px 16px", background: DC.bg, border: `1px solid ${DC.faint}33`, borderRadius: RADIUS.md, textAlign: "center" }}>
                  <div style={{ width: 40, height: 40, borderRadius: RADIUS.sm, background: DC.gold + "18", border: `1px solid ${DC.gold}33`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 10px" }}>
                    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={DC.gold} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" /><polyline points="16 7 22 7 22 13" />
                    </svg>
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: DC.text, marginBottom: 4 }}>{t("markets.connect_to_invest")}</div>
                  <div style={{ fontSize: 13, color: DC.muted, marginBottom: 14, lineHeight: 1.5 }}>{t("markets.create_alpaca")}</div>
                  <a
                    href="https://app.alpaca.markets"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ display: "inline-block", padding: "11px 28px", background: DC.gold, borderRadius: RADIUS.sm, color: DC.bg, fontWeight: 700, fontSize: 14, textDecoration: "none", fontFamily: FONT }}
                  >
                    {t("markets.open_alpaca")}
                  </a>
                  <div style={{ fontSize: 11, color: DC.faint, marginTop: 10 }}>{t("markets.after_alpaca")}</div>
                </div>
              ) : (
                <div style={{ marginTop: 12, padding: "10px 14px", background: buyResult.success ? DC.emerald + "12" : DC.ruby + "12", border: `1px solid ${buyResult.success ? DC.emerald : DC.ruby}33`, borderRadius: RADIUS.sm }}>
                  <div style={{ fontSize: 13, color: buyResult.success ? DC.emerald : DC.ruby, fontWeight: 600 }}>
                    {buyResult.success ? "✓ " + buyResult.message : "✗ " + t("markets.order_failed")}
                  </div>
                </div>
              )
            )}
          </GlassCard>
          )}

          {alpacaConnected && (
          <div style={{ padding: "0 2px" }}>
            <div style={{ fontSize: 10, color: DC.faint, lineHeight: 1.7 }}>
              {t("markets.investment_disclaimer")}
            </div>
          </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Markets Screen ───────────────────────────────────────────

export default function Markets({ profile, user, onSaveProfile, initialSymbol, onClearInit, alpacaConnected, onConnectAlpaca, isPro, isTrial, onUpgrade, onToast }) {
  const { t } = useTranslation();
  const isUSStorefront = useUSStorefront();
  const showRealUpgrade = !IS_IOS_NATIVE || isUSStorefront;
  const defaultWatchlist = profile?.watchlist ?? DEFAULT_WATCHLIST;

  const [watchlist, setWatchlist]       = useState(defaultWatchlist);
  const [editMode, setEditMode]         = useState(false);
  const [addQuery, setAddQuery]         = useState("");
  const [addResults, setAddResults]     = useState([]);
  const [searchingAdd, setSearchingAdd] = useState(false);
  const [quotes, setQuotes]             = useState({});
  const [loadingQuotes, setLoadingQuotes] = useState(true);
  const [selectedSymbol, setSelectedSymbol] = useState(initialSymbol ?? null);
  // Holdings scale fix (2026-08-24): show top 3 by market value, "+N more"
  // reveals the rest inline — same pattern as Dashboard's credit-cards
  // list, just inline instead of a sheet since this is already a full page.
  const [showAllHoldings, setShowAllHoldings] = useState(false);
  const [exploreQuery, setExploreQuery] = useState("");
  const [exploreResults, setExploreResults] = useState([]);
  const [searchingExplore, setSearchingExplore] = useState(false);
  const [exploreNonUS, setExploreNonUS] = useState(false);
  const [dragging, setDragging]         = useState(null);
  const [dragList, setDragList]         = useState(watchlist);
  const dragRef = useRef(watchlist);
  const [extraQuotes, setExtraQuotes]   = useState({});
  const [loadingExtra, setLoadingExtra] = useState(true);
  const [activeSector, setActiveSector] = useState(null);
  const [loadingSectorStocks, setLoadingSectorStocks] = useState(false);
  const [portfolio, setPortfolio]               = useState(null);
  const [loadingPortfolio, setLoadingPortfolio] = useState(false);

  useEffect(() => {
    if (initialSymbol) { setSelectedSymbol(initialSymbol); onClearInit?.(); }
  }, [initialSymbol]);

  useEffect(() => {
    if (!alpacaConnected) return;
    setLoadingPortfolio(true);
    supabase.functions.invoke("alpaca-portfolio")
      .then(({ data, error }) => {
        if (!error && data && !data.error) setPortfolio(data);
        setLoadingPortfolio(false);
      });
  }, [alpacaConnected]);

  useEffect(() => {
    const syms = [...new Set([...TRENDING.map(t => t.symbol), ...SECTORS.map(s => s.etf)])];
    Promise.allSettled(syms.map(s => callMarketData({ type: "quote", symbol: s }))).then(results => {
      const map = {};
      syms.forEach((s, i) => { if (results[i].status === "fulfilled") map[s] = results[i].value; });
      setExtraQuotes(map);
      setLoadingExtra(false);
    });
  }, []);

  async function toggleSector(sector) {
    if (activeSector?.name === sector.name) { setActiveSector(null); return; }
    setActiveSector(sector);
    const missing = sector.stocks.filter(s => !extraQuotes[s]);
    if (missing.length > 0) {
      setLoadingSectorStocks(true);
      const results = await Promise.allSettled(missing.map(s => callMarketData({ type: "quote", symbol: s })));
      setExtraQuotes(prev => {
        const next = { ...prev };
        missing.forEach((s, i) => { if (results[i].status === "fulfilled") next[s] = results[i].value; });
        return next;
      });
      setLoadingSectorStocks(false);
    }
  }

  async function loadQuotes(list) {
    setLoadingQuotes(true);
    const results = await Promise.allSettled(list.map(s => callMarketData({ type: "quote", symbol: s })));
    const map = {};
    list.forEach((s, i) => {
      if (results[i].status === "fulfilled") map[s] = results[i].value;
    });
    setQuotes(map);
    setLoadingQuotes(false);
  }

  useEffect(() => { loadQuotes(watchlist); }, []);

  function saveWatchlist(list) {
    setWatchlist(list);
    dragRef.current = list;
    onSaveProfile({ watchlist: list });
  }

  function removeFromWatchlist(sym) {
    const next = watchlist.filter(s => s !== sym);
    saveWatchlist(next);
    setDragList(next);
  }

  function onDragStart(e, idx) {
    const y = e.touches ? e.touches[0].clientY : e.clientY;
    setDragging({ idx, startY: y, curY: y });
    setDragList([...watchlist]);
  }
  function onDragMove(e) {
    if (!dragging) return;
    const y = e.touches ? e.touches[0].clientY : e.clientY;
    setDragging(d => d ? { ...d, curY: y } : null);
    const delta = y - dragging.startY;
    const ITEM_H = 56;
    const moved = Math.round(delta / ITEM_H);
    if (moved === 0) return;
    const newIdx = Math.max(0, Math.min(dragRef.current.length - 1, dragging.idx + moved));
    if (newIdx !== dragging.idx) {
      const next = [...dragRef.current];
      const [item] = next.splice(dragging.idx, 1);
      next.splice(newIdx, 0, item);
      dragRef.current = next;
      setDragList([...next]);
      setDragging(d => d ? { ...d, idx: newIdx, startY: y } : null);
    }
  }
  function onDragEnd() {
    if (dragging) saveWatchlist(dragRef.current);
    setDragging(null);
  }

  const US_EXCHANGES = ["NYSE", "NASDAQ", "ARCA", "BATS", "NYSE ARCA", "US"];
  function filterUSStocks(results) {
    return (results ?? []).filter(r => {
      if (!r.symbol || r.symbol.includes(".")) return false;
      const ex = (r.exchange || r.primary_exchange || "").toUpperCase();
      if (!ex) return true; // Finnhub search omits exchange — dot-check above is sufficient
      return US_EXCHANGES.some(e => ex.includes(e));
    });
  }

  const addSearchTimer = useRef(null);
  function onAddQueryChange(q) {
    setAddQuery(q);
    clearTimeout(addSearchTimer.current);
    if (!q.trim()) { setAddResults([]); return; }
    addSearchTimer.current = setTimeout(async () => {
      setSearchingAdd(true);
      // Finnhub's search matches company names case-insensitively but
      // ticker symbols exact-case (symbols are stored uppercase) — "aapl"
      // wasn't finding Apple while "AAPL" did. Uppercase what we send, not
      // the input field itself, so the user still sees what they typed.
      const d = await callMarketData({ type: "search", query: q.trim().toUpperCase() });
      setAddResults(filterUSStocks(d.results));
      setSearchingAdd(false);
    }, 400);
  }

  const exploreTimer = useRef(null);
  function onExploreChange(q) {
    setExploreQuery(q);
    clearTimeout(exploreTimer.current);
    if (!q.trim()) { setExploreResults([]); setExploreNonUS(false); return; }
    exploreTimer.current = setTimeout(async () => {
      setSearchingExplore(true);
      // Same case-normalization as onAddQueryChange above.
      const d = await callMarketData({ type: "search", query: q.trim().toUpperCase() });
      const filtered = filterUSStocks(d.results);
      setExploreResults(filtered);
      setExploreNonUS(!filtered.length && (d.results ?? []).length > 0);
      setSearchingExplore(false);
    }, 400);
  }

  function addToWatchlist(sym) {
    if (watchlist.includes(sym) || watchlist.length >= MAX_WATCHLIST) return;
    const next = [...watchlist, sym];
    saveWatchlist(next);
    setDragList(next);
    loadQuotes(next);
    setAddQuery("");
    setAddResults([]);
  }

  if (selectedSymbol) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <StockDetail symbol={selectedSymbol} onBack={() => setSelectedSymbol(null)} user={user} alpacaConnected={alpacaConnected} onConnectAlpaca={onConnectAlpaca} isPro={isPro} isTrial={isTrial} onUpgrade={onUpgrade} watchlist={watchlist} addToWatchlist={addToWatchlist} removeFromWatchlist={removeFromWatchlist} onToast={onToast} ownedPosition={portfolio?.positions?.find(p => p.symbol === selectedSymbol) ?? null} />
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, paddingBottom: 80 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0, fontSize: 26, fontWeight: 700 }}>{t("markets.title")}</h2>
      </div>

      {/* ── EXPLORE ────────────────────────────────────────── */}
      <GlassCard style={{ background: DC.card, border: `1px solid ${DC.faint}33` }}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12 }}>{t("markets.explore_stocks")}</div>
        <div style={{ position: "relative", marginBottom: 12 }}>
          <div style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}>
            <Icon name="search" size={14} color={DC.faint} />
          </div>
          <input
            value={exploreQuery}
            onChange={e => onExploreChange(e.target.value)}
            placeholder={t("markets.search_stock")}
            style={{ width: "100%", padding: "11px 12px 11px 34px", background: DC.bg, border: `1px solid ${DC.faint}33`, borderRadius: RADIUS.sm, color: DC.text, fontSize: 14, boxSizing: "border-box", fontFamily: FONT }}
          />
        </div>
        {searchingExplore && <div style={{ color: DC.faint, fontSize: 12, textAlign: "center", padding: "8px 0" }}>{t("markets.searching")}</div>}
        {!searchingExplore && exploreNonUS && (
          <div style={{ fontSize: 12, color: C.nonUsTickerWarning, padding: "8px 12px", background: C.nonUsTickerWarning + "14", border: `1px solid ${C.nonUsTickerWarning}40`, borderRadius: RADIUS.sm, marginBottom: 8 }}>
            {t("markets.us_only")}
          </div>
        )}
        {exploreResults.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {exploreResults.map((r, i) => (
              <div key={r.symbol} onClick={() => setSelectedSymbol(r.symbol)}
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: i < exploreResults.length - 1 ? `1px solid ${DC.faint}22` : "none", cursor: "pointer" }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{r.symbol}</div>
                  <div style={{ fontSize: 12, color: DC.faint, marginTop: 1 }}>{r.description}</div>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 11, color: DC.faint, background: DC.bg, borderRadius: RADIUS.xs, padding: "2px 7px" }}>{r.type}</span>
                  <Icon name="chevron" size={14} color={DC.faint} />
                </div>
              </div>
            ))}
          </div>
        ) : !exploreQuery && (
          <>
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: DC.faint, letterSpacing: 1, textTransform: "uppercase", marginBottom: 10 }}>{t("markets.trending_today")}</div>
              {TRENDING.map((t, i) => {
                const q = extraQuotes[t.symbol];
                const pos = (q?.changePct ?? 0) >= 0;
                return (
                  <div key={t.symbol} onClick={() => setSelectedSymbol(t.symbol)}
                    style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 6px", borderBottom: i < TRENDING.length - 1 ? `1px solid ${DC.faint}22` : "none", cursor: "pointer" }}>
                    <StockLogo symbol={t.symbol} color={t.color} size={36} borderRadius={10} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: DC.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{cleanCompanyName(t.name)}</div>
                      <div style={{ fontSize: 11, color: DC.faint }}>{t.symbol}</div>
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      {loadingExtra
                        ? <div style={{ width: 48, height: 12, background: `${DC.faint}33`, borderRadius: RADIUS.xs }} />
                        : <>
                            <div style={{ fontSize: 13, fontWeight: 700, color: DC.text }}>{fmtPrice(q?.price)}</div>
                            <div style={{ fontSize: 11, fontWeight: 600, color: pos ? DC.emerald : DC.ruby }}>{fmtPct(q?.changePct)}</div>
                          </>
                      }
                    </div>
                  </div>
                );
              })}
            </div>

            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: DC.faint, letterSpacing: 1, textTransform: "uppercase", marginBottom: 10 }}>{t("markets.sectors")}</div>
              <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 6, scrollbarWidth: "none", msOverflowStyle: "none" }}>
                {SECTORS.map(sector => {
                  const q = extraQuotes[sector.etf];
                  const pct = q?.changePct ?? null;
                  const pos = (pct ?? 0) >= 0;
                  const active = activeSector?.name === sector.name;
                  return (
                    <button key={sector.name} onClick={() => toggleSector(sector)} style={{
                      flexShrink: 0, minWidth: 80, padding: "8px 12px", borderRadius: RADIUS.sm, textAlign: "left",
                      background: active ? sector.color + "18" : DC.bg,
                      border: `1px solid ${active ? sector.color + "55" : `${DC.faint}33`}`,
                      cursor: "pointer", fontFamily: FONT,
                    }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: active ? sector.color : DC.text, marginBottom: 3 }}>{sector.name}</div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: loadingExtra ? DC.faint : pos ? DC.emerald : DC.ruby }}>
                        {loadingExtra ? "—" : fmtPct(pct)}
                      </div>
                    </button>
                  );
                })}
              </div>

              {activeSector && (
                <div style={{ marginTop: 10, borderRadius: RADIUS.sm, border: `1px solid ${DC.faint}33`, overflow: "hidden" }}>
                  {loadingSectorStocks
                    ? <div style={{ padding: "12px 14px", color: DC.faint, fontSize: 12 }}>{t("markets.loading")}</div>
                    : activeSector.stocks.map((sym, i) => {
                        const q = extraQuotes[sym];
                        const pos = (q?.changePct ?? 0) >= 0;
                        return (
                          <div key={sym} onClick={() => setSelectedSymbol(sym)}
                            style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", cursor: "pointer", borderTop: i > 0 ? `1px solid ${DC.faint}22` : "none", background: DC.bg }}>
                            <StockLogo symbol={sym} color={activeSector.color} size={28} borderRadius={8} />
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: 13, fontWeight: 600, color: DC.text }}>{sym}</div>
                            </div>
                            <div style={{ textAlign: "right" }}>
                              <div style={{ fontSize: 13, fontWeight: 700, color: DC.text }}>{fmtPrice(q?.price)}</div>
                              <div style={{ fontSize: 11, fontWeight: 600, color: pos ? DC.emerald : DC.ruby }}>{fmtPct(q?.changePct)}</div>
                            </div>
                            <Icon name="chevron" size={12} color={DC.faint} />
                          </div>
                        );
                      })
                  }
                </div>
              )}
            </div>
          </>
        )}
      </GlassCard>

      {/* ── PORTFOLIO / CONNECT ────────────────────────────── */}
      {alpacaConnected ? (
        <GlassCard style={{ background: DC.card, border: `1px solid ${DC.faint}33` }}>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12 }}>{t("markets.portfolio_title")}</div>
          {loadingPortfolio ? (
            <div style={{ color: DC.faint, fontSize: 13, textAlign: "center", padding: "12px 0" }}>{t("markets.loading_portfolio")}</div>
          ) : portfolio ? (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
                <div style={{ background: DC.bg, borderRadius: RADIUS.sm, padding: "12px 14px" }}>
                  <div style={{ fontSize: 10, color: DC.faint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>{t("markets.portfolio_value")}</div>
                  <div className="ph-mask" style={{ fontSize: 17, fontWeight: 800, color: DC.text }}>{fmtPrice(portfolio.portfolio_value)}</div>
                </div>
                <div style={{ background: DC.bg, borderRadius: RADIUS.sm, padding: "12px 14px" }}>
                  <div style={{ fontSize: 10, color: DC.faint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>{t("markets.buying_power")}</div>
                  <div className="ph-mask" style={{ fontSize: 17, fontWeight: 800, color: DC.gold }}>{fmtPrice(portfolio.buying_power)}</div>
                </div>
              </div>
              {/* Reuses the same Alpaca funding deep-link already used
                  elsewhere (App.jsx's insufficient-buying-power toast) —
                  Arkonomy's OAuth scope (account:write trading) has no
                  funding/ACH permission, so this always has to be an
                  external hand-off to Alpaca's own app. The context line +
                  link to Alpaca's own funding guide (instead of us writing
                  our own step-by-step) means we never have to keep those
                  steps in sync with Alpaca's UI. */}
              <div style={{ fontSize: 11, color: DC.faint, lineHeight: 1.5, marginBottom: 8 }}>
                {t("markets.add_funds_context")}{" "}
                <a
                  href="https://alpaca.markets/learn/fund-live-trading-account"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: C.alpacaAccent, textDecoration: "underline" }}
                >
                  {t("markets.add_funds_guide")}
                </a>
              </div>
              <a
                href="https://app.alpaca.markets/brokerage/funding/deposit"
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: "block", width: "100%", boxSizing: "border-box", textAlign: "center", padding: "12px 0", background: DC.gold, borderRadius: RADIUS.sm, color: DC.bg, fontWeight: 700, fontSize: 14, textDecoration: "none", fontFamily: FONT, marginBottom: 16 }}
              >
                {t("markets.add_funds_btn")}
              </a>
              {portfolio.positions.length > 0 ? (
                <>
                  <div style={{ fontSize: 11, fontWeight: 700, color: DC.faint, letterSpacing: 1, textTransform: "uppercase", marginBottom: 10 }}>{t("markets.holdings")}</div>
                  {(() => {
                    // Sorted by market value descending — not Alpaca's own
                    // (arbitrary) order — so "top 3" actually means the 3
                    // biggest positions, not just the first 3 the API
                    // happened to return.
                    const sorted = [...portfolio.positions].sort((a, b) => b.market_value - a.market_value);
                    const visible = showAllHoldings ? sorted : sorted.slice(0, 3);
                    const remaining = sorted.length - visible.length;
                    return (
                      <>
                        {visible.map((p, i) => {
                          const pl  = p.unrealized_pl;
                          const pos = pl >= 0;
                          const meta = MARKET_META[p.symbol] ?? {};
                          return (
                            <div key={p.symbol} onClick={() => setSelectedSymbol(p.symbol)}
                              style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderTop: i > 0 ? `1px solid ${DC.faint}22` : "none", cursor: "pointer" }}>
                              <StockLogo symbol={p.symbol} color={meta.color ?? DC.gold} icon={meta.icon ?? "activity"} size={32} borderRadius={9} />
                              <div style={{ flex: 1 }}>
                                <div style={{ fontSize: 13, fontWeight: 700, color: DC.text }}>{p.symbol}</div>
                                <div style={{ fontSize: 11, color: DC.faint }}>{t("markets.qty_shares", { qty: p.qty.toFixed(4) })}</div>
                              </div>
                              <div style={{ textAlign: "right" }}>
                                <div className="ph-mask" style={{ fontSize: 13, fontWeight: 700, color: DC.text }}>{fmtPrice(p.market_value)}</div>
                                <div className="ph-mask" style={{ fontSize: 11, fontWeight: 600, color: pos ? DC.emerald : DC.ruby }}>{pos ? "+" : "-"}{fmtPrice(Math.abs(pl))}</div>
                              </div>
                            </div>
                          );
                        })}
                        {remaining > 0 && (
                          <button onClick={() => setShowAllHoldings(true)} style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", padding: "10px 0 0", cursor: "pointer", fontFamily: FONT, fontSize: 12, fontWeight: 600, color: DC.gold }}>
                            {t("markets.holdings_more", { count: remaining })}
                          </button>
                        )}
                      </>
                    );
                  })()}
                </>
              ) : (
                <div style={{ fontSize: 13, color: DC.faint, textAlign: "center", padding: "8px 0" }}>{t("markets.no_holdings")}</div>
              )}
              {/* Pending Orders — visibility fix (2026-08-24): before this,
                  a submitted-but-unfilled order (e.g. waiting for market
                  open) was completely invisible anywhere in the app; the
                  only way to see it existed was a direct Alpaca API call.
                  alpaca-portfolio now also returns open_orders. Not
                  claiming a specific reason/ETA (e.g. "opens Monday") —
                  just honest visibility that something is pending. */}
              {portfolio.open_orders?.length > 0 && (
                <>
                  <div style={{ fontSize: 11, fontWeight: 700, color: DC.faint, letterSpacing: 1, textTransform: "uppercase", marginTop: 16, marginBottom: 10 }}>{t("markets.pending_orders")}</div>
                  {portfolio.open_orders.map((o, i) => {
                    const meta = MARKET_META[o.symbol] ?? {};
                    return (
                      <div key={o.order_id ?? i} onClick={() => setSelectedSymbol(o.symbol)}
                        style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderTop: i > 0 ? `1px solid ${DC.faint}22` : "none", cursor: "pointer" }}>
                        <StockLogo symbol={o.symbol} color={meta.color ?? DC.gold} icon={meta.icon ?? "activity"} size={32} borderRadius={9} />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: DC.text }}>{o.symbol}</div>
                          <div style={{ fontSize: 11, color: DC.faint }}>{t("markets.order_pending_note")}</div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          {/* Security-auditor findings, 2026-08-24:
                              (1) Number(o.notional) turned Alpaca's real
                              null (an order placed by qty instead of
                              notional — e.g. from Alpaca's own app/web, not
                              just this one) into a fabricated "$0.00" —
                              fmtPrice's own null-guard never got a chance
                              to fire. Now shows the real share qty instead
                              when notional is absent, never a made-up $0.
                              (2) side was hardcoded "Buy" — this app only
                              ever places buys itself, but the account is a
                              real Alpaca connection, so a pending sell
                              placed elsewhere would've been mislabeled on
                              a money screen. Now reads the real o.side. */}
                          <div className="ph-mask" style={{ fontSize: 13, fontWeight: 700, color: DC.text }}>
                            {o.notional != null ? fmtPrice(Number(o.notional)) : t("markets.qty_shares", { qty: Number(o.qty ?? 0).toFixed(4) })}
                          </div>
                          <div style={{ fontSize: 11, color: DC.faint }}>{o.side === "sell" ? t("markets.order_side_sell") : t("markets.order_side_buy")}</div>
                        </div>
                      </div>
                    );
                  })}
                </>
              )}
            </>
          ) : null}
        </GlassCard>
      ) : (
        <GlassCard style={{ textAlign: "center", padding: "24px 20px", background: DC.card, border: `1px solid ${DC.faint}33` }}>
          <div style={{ width: 44, height: 44, borderRadius: RADIUS.md, background: DC.gold + "18", border: `1px solid ${DC.gold}33`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px" }}>
            <Icon name="trending-up" size={18} color={DC.gold} />
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, color: DC.text, marginBottom: 6 }}>{t("markets.connect_alpaca_title")}</div>
          <div style={{ fontSize: 13, color: DC.muted, lineHeight: 1.6, marginBottom: 16 }}>{t("markets.connect_alpaca_body")}</div>
          <button onClick={onConnectAlpaca} style={{ width: "100%", padding: "12px 0", background: DC.gold, border: "none", borderRadius: RADIUS.sm, color: DC.bg, fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: FONT }}>
            {t("markets.connect_alpaca_btn")}
          </button>
        </GlassCard>
      )}

      {/* ── WATCHLIST ──────────────────────────────────────── */}
      <GlassCard style={{ padding: "14px 16px", background: DC.card, border: `1px solid ${DC.faint}33` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontWeight: 600, fontSize: 14 }}>{t("markets.watchlist")}</span>
            <span style={{ fontSize: 11, color: DC.faint }}>{watchlist.length}/{MAX_WATCHLIST}</span>
          </div>
          <button onClick={() => { setEditMode(e => !e); setDragList([...watchlist]); }}
            style={{ padding: "6px 14px", background: editMode ? DC.gold + "22" : DC.card, border: `1px solid ${editMode ? DC.gold + "55" : `${DC.faint}33`}`, borderRadius: RADIUS.sm, color: editMode ? DC.gold : DC.muted, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: FONT }}>
            {editMode ? t("markets.done") : t("markets.edit")}
          </button>
        </div>

        {editMode ? (
          <>
            <div
              onMouseMove={onDragMove} onMouseUp={onDragEnd}
              onTouchMove={onDragMove} onTouchEnd={onDragEnd}
              style={{ touchAction: "none" }}
            >
              {dragList.map((sym, idx) => {
                const meta = MARKET_META[sym] ?? { label: sym, color: DC.gold, icon: "activity" };
                return (
                  <div key={sym}
                    style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: idx < dragList.length - 1 ? `1px solid ${DC.faint}22` : "none", userSelect: "none", opacity: dragging?.idx === idx ? 0.5 : 1 }}>
                    <div
                      onMouseDown={e => onDragStart(e, idx)}
                      onTouchStart={e => onDragStart(e, idx)}
                      style={{ cursor: "grab", padding: "4px 6px", color: DC.faint, fontSize: 14 }}>⋮⋮</div>
                    <div style={{ width: 32, height: 32, borderRadius: RADIUS.sm, background: meta.color + "22", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <Icon name={meta.icon} size={13} color={meta.color} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{meta.label || sym}</div>
                      <div style={{ fontSize: 11, color: DC.faint }}>{sym}</div>
                    </div>
                    <button onClick={() => removeFromWatchlist(sym)}
                      style={{ background: DC.ruby + "18", border: `1px solid ${DC.ruby}33`, borderRadius: RADIUS.xs, width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                      <Icon name="x" size={12} color={DC.ruby} />
                    </button>
                  </div>
                );
              })}
            </div>

            {watchlist.length < MAX_WATCHLIST && (
              <div style={{ marginTop: 14 }}>
                <div style={{ position: "relative" }}>
                  <Icon name="search" size={14} color={DC.faint} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }} />
                  <input
                    value={addQuery}
                    onChange={e => onAddQueryChange(e.target.value)}
                    placeholder={t("markets.search_ticker")}
                    style={{ width: "100%", padding: "10px 12px 10px 34px", background: DC.bg, border: `1px solid ${DC.faint}33`, borderRadius: RADIUS.sm, color: DC.text, fontSize: 13, boxSizing: "border-box", fontFamily: FONT }}
                  />
                </div>
                {searchingAdd && <div style={{ color: DC.faint, fontSize: 12, marginTop: 8 }}>{t("markets.searching")}</div>}
                {addResults.map(r => (
                  <div key={r.symbol} onClick={() => addToWatchlist(r.symbol)}
                    style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: `1px solid ${DC.faint}22`, cursor: "pointer" }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{r.symbol}</div>
                      <div style={{ fontSize: 11, color: DC.faint }}>{r.description}</div>
                    </div>
                    <div style={{ background: DC.emerald + "18", border: `1px solid ${DC.emerald}33`, borderRadius: RADIUS.xs, padding: "3px 10px", fontSize: 12, color: DC.emerald, fontWeight: 600 }}>
                      {watchlist.includes(r.symbol) ? t("markets.added") : t("markets.add")}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <div>
            {watchlist.map((sym, i) => {
              const meta = MARKET_META[sym] ?? { label: sym, color: DC.gold, icon: "activity", isCrypto: false };
              const q    = quotes[sym];
              const pos  = (q?.changePct ?? 0) >= 0;
              return (
                <div key={sym} onClick={() => setSelectedSymbol(sym)}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderTop: i > 0 ? `1px solid ${DC.faint}22` : "none", cursor: "pointer" }}>
                  <StockLogo symbol={sym} color={meta.color} icon={meta.icon} size={32} borderRadius={9} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: DC.text }}>{sym}</div>
                    <div style={{ fontSize: 11, color: DC.faint }}>{meta.label || sym}</div>
                  </div>
                  {loadingQuotes ? (
                    <div style={{ height: 20, width: 70, background: `${DC.faint}33`, borderRadius: RADIUS.xs }} />
                  ) : (
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: DC.text }}>{fmtPrice(q?.price, meta.isCrypto)}</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 4, justifyContent: "flex-end", marginTop: 2 }}>
                        <Icon name={pos ? "trending-up" : "trending-down"} size={10} color={pos ? DC.emerald : DC.ruby} strokeWidth={2.5} />
                        <span style={{ fontSize: 11, fontWeight: 600, color: pos ? DC.emerald : DC.ruby }}>{fmtPct(q?.changePct)}</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </GlassCard>

      <div style={{ padding: "4px 2px" }}>
        <div style={{ fontSize: 10, color: DC.faint, lineHeight: 1.7 }}>
          {t("markets.investment_disclaimer")}
        </div>
      </div>
    </div>
  );
}
