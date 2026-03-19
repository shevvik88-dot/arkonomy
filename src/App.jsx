import { useState, useEffect, useRef } from "react";
import { createClient } from "@supabase/supabase-js";
import CheckInCard from "./components/CheckInCard";

const fontLink = document.createElement("link");
fontLink.rel = "stylesheet";
fontLink.href = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap";
document.head.appendChild(fontLink);

const FONT = "'Inter', -apple-system, BlinkMacSystemFont, sans-serif";

const SUPABASE_URL = "https://hvnkxxazjfesbxdkzuba.supabase.co";
const SUPABASE_KEY = "sb_publishable_z4Mh9KZLXS_6ZZJyJ-pE7A_ClkhUDt9";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── Updated color palette ─────────────────────────────────────
const C = {
  bg: "#0B1426", bgSecondary: "#0F1A2E", bgTertiary: "#162035",
  card: "#111E33", border: "#1E2D4A", sep: "#192840",
  blue: "#2F80FF", cyan: "#00C2FF", green: "#12D18E",
  red: "#FF5C7A", yellow: "#FFB800", purple: "#A78BFA",
  text: "#FFFFFF", muted: "#9AA4B2", faint: "#4A5E7A",
};

const CAT_COLORS = {
  "Food & Dining": "#FF6B6B", "Transport": "#4ECDC4",
  "Shopping": "#F59E0B", "Entertainment": "#A78BFA",
  "Health": "#34D399", "Bills": "#60A5FA",
  "Subscriptions": "#F97316", "Other": "#94A3B8",
};

function fmt(n, decimals = 2) {
  return Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ─── Icon Library ─────────────────────────────────────────────
function Icon({ name, size = 20, color = C.muted, strokeWidth = 1.8 }) {
  const p = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: color, strokeWidth, strokeLinecap: "round", strokeLinejoin: "round" };
  const icons = {
    home:            <svg {...p}><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,
    credit:          <svg {...p}><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>,
    target:          <svg {...p}><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>,
    activity:        <svg {...p}><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>,
    message:         <svg {...p}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>,
    settings:        <svg {...p}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
    "trending-up":   <svg {...p}><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>,
    "trending-down": <svg {...p}><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/></svg>,
    eye:             <svg {...p}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>,
    "eye-off":       <svg {...p}><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>,
    bell:            <svg {...p}><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>,
    "check-circle":  <svg {...p}><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>,
    "alert-circle":  <svg {...p}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>,
    zap:             <svg {...p}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>,
    dollar:          <svg {...p}><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>,
    food:            <svg {...p}><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg>,
    car:             <svg {...p}><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>,
    shopping:        <svg {...p}><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>,
    film:            <svg {...p}><rect x="2" y="2" width="20" height="20" rx="2"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/></svg>,
    heart:           <svg {...p}><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>,
    file:            <svg {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>,
    repeat:          <svg {...p}><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>,
    bank:            <svg {...p}><line x1="3" y1="22" x2="21" y2="22"/><line x1="6" y1="18" x2="6" y2="11"/><line x1="10" y1="18" x2="10" y2="11"/><line x1="14" y1="18" x2="14" y2="11"/><line x1="18" y1="18" x2="18" y2="11"/><polygon points="12 2 20 7 4 7"/></svg>,
    phone:           <svg {...p}><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>,
    send:            <svg {...p}><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>,
    plus:            <svg {...p}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
    x:               <svg {...p}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
    chevron:         <svg {...p}><polyline points="9 18 15 12 9 6"/></svg>,
    lock:            <svg {...p}><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>,
    star:            <svg {...p}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>,
    info:            <svg {...p}><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>,
    award:           <svg {...p}><circle cx="12" cy="8" r="6"/><path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11"/></svg>,
    calendar:        <svg {...p}><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
    "bar-chart":     <svg {...p}><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><line x1="2" y1="20" x2="22" y2="20"/></svg>,
    edit:            <svg {...p}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>,
  };
  return icons[name] || icons["dollar"];
}

// ─── GlassCard ────────────────────────────────────────────────
function GlassCard({ children, style = {} }) {
  return (
    <div style={{ background: C.card, borderRadius: 20, border: `1px solid ${C.border}`, padding: 20, fontFamily: FONT, ...style }}>
      {children}
    </div>
  );
}

// ─── StatBadge ────────────────────────────────────────────────
function StatBadge({ value, suffix = "vs last month" }) {
  const pos = value >= 0;
  const color = pos ? C.green : C.red;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 3, background: color + "22", color, borderRadius: 100, padding: "2px 8px", fontSize: 10, fontWeight: 600, fontFamily: FONT, whiteSpace: "nowrap" }}>
      <Icon name={pos ? "trending-up" : "trending-down"} size={9} color={color} strokeWidth={2.5} />
      {pos ? "+" : ""}{Math.abs(value).toFixed(1)}% {suffix}
    </span>
  );
}

// ─── Donut Chart with glow ─────────────────────────────────────
function DonutChart({ data, size = 196, onCatClick }) {
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
      No spending data yet
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
        <svg width={size} height={size} sstyle={{ display: "block" }}>
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
        <div style={{ position: "absolute", left: cx - innerR, top: cy - innerR, width: innerR * 2, height: innerR * 2, borderRadius: "50%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: C.bg, pointerEvents: "none" }}>
          {hovered ? (
            <>
              <div style={{ fontSize: 10, color: C.muted, fontWeight: 600, letterSpacing: 0.5, marginBottom: 2, textAlign: "center", padding: "0 4px" }}>{hovered}</div>
              <div style={{ fontSize: 17, fontWeight: 800, color: CAT_COLORS[hovered] || C.cyan }}>${fmt((data[hovered] || 0), 0)}</div>
              <div style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>{Math.round(((data[hovered] || 0) / total) * 100)}%</div>
            </>
          ) : (
            <>
             <div style={{ fontSize: 20, fontWeight: 800, color: C.text, letterSpacing: -0.5, marginBottom: 2 }}>${fmt(total, 0)}</div>
           <div style={{ fontSize: 10, color: C.muted, letterSpacing: 0.5, fontWeight: 600 }}>Total spent</div>
            </>
          )}
        </div>
      </div>

      <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 6 }}>
        {slices.map(s => (
          <div key={s.cat}
            onClick={() => onCatClick && onCatClick(s.cat)}
            style={{ display: "flex", alignItems: "center", gap: 10, cursor: onCatClick ? "pointer" : "default", padding: "6px 10px", borderRadius: 10, background: hovered === s.cat ? s.color + "18" : C.bgTertiary, border: `1px solid ${hovered === s.cat ? s.color + "44" : "transparent"}`, transition: "all 0.15s" }}
            onMouseEnter={() => setHovered(s.cat)} onMouseLeave={() => setHovered(null)}>
            <div style={{ width: 10, height: 10, borderRadius: 99, background: s.color, flexShrink: 0, boxShadow: `0 0 6px ${s.color}88` }} />
            <span style={{ fontSize: 13, color: C.muted, flex: 1 }}>{s.cat}</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>${fmt(s.val, 0)}</span>
            <span style={{ fontSize: 11, color: s.color, fontWeight: 600, minWidth: 36, textAlign: "right" }}>{Math.round((s.val / total) * 100)}%</span>
            {onCatClick && <Icon name="chevron" size={12} color={C.faint} />}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Financial Health Score ────────────────────────────────────
function HealthScore({ totalSpent, totalIncome, budget, savingsGoals }) {
  const savingsRate = totalIncome > 0 ? (totalIncome - totalSpent) / totalIncome : 0;
  const budgetAdherence = budget > 0 ? Math.max(0, 1 - (totalSpent / budget)) : 0;
  const hasGoals = savingsGoals.length > 0;
  const goalProgress = hasGoals ? savingsGoals.reduce((s, g) => s + Math.min(g.current / (g.target || 1), 1), 0) / savingsGoals.length : 0;

  const score = Math.round(
    Math.min(savingsRate, 0.3) / 0.3 * 40 +
    budgetAdherence * 35 +
    goalProgress * 25
  );

  const color = score >= 75 ? C.green : score >= 50 ? C.yellow : C.red;
  const label = score >= 75 ? "Excellent" : score >= 60 ? "Good" : score >= 40 ? "Fair" : "Needs Work";
  const circumference = 2 * Math.PI * 28;
  const dash = (score / 100) * circumference;

  return (
    <GlassCard>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <div style={{ position: "relative", width: 72, height: 72, flexShrink: 0 }}>
          <svg width={72} height={72} style={{ filter: `drop-shadow(0 0 8px ${color}55)` }}>
            <circle cx={36} cy={36} r={28} fill="none" stroke={C.bgTertiary} strokeWidth={6} />
            <circle cx={36} cy={36} r={28} fill="none" stroke={color} strokeWidth={6}
              strokeDasharray={`${dash} ${circumference}`} strokeLinecap="round"
              transform="rotate(-90 36 36)" style={{ transition: "stroke-dasharray 1s ease" }} />
          </svg>
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
            <div style={{ fontSize: 18, fontWeight: 800, color, lineHeight: 1 }}>{score}</div>
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 10, color: C.faint, fontWeight: 600, letterSpacing: 1, marginBottom: 4 }}>FINANCIAL HEALTH</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: C.text, marginBottom: 4 }}>{label} <span style={{ color, fontSize: 13 }}>{score}/100</span></div>
          <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.5 }}>
            {score >= 75 ? "Great habits! Keep it up." : score >= 50 ? "Decent — small improvements can help." : "Focus on saving more and staying in budget."}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        {[
          { label: "Savings Rate", value: Math.round(Math.min(savingsRate / 0.3, 1) * 100), color: C.cyan },
          { label: "Budget", value: Math.round(budgetAdherence * 100), color: C.blue },
          { label: "Goals", value: Math.round(goalProgress * 100), color: C.purple },
        ].map(item => (
          <div key={item.label} style={{ flex: 1, background: C.bgTertiary, borderRadius: 12, padding: "10px 8px", textAlign: "center" }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: item.color }}>{item.value}%</div>
            <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>{item.label}</div>
          </div>
        ))}
      </div>
    </GlassCard>
  );
}

// ─── Weekly Summary ────────────────────────────────────────────
function WeeklySummary({ transactions }) {
  const now = new Date();
  const startOfWeek = new Date(now); startOfWeek.setDate(now.getDate() - now.getDay());
  const startOfLastWeek = new Date(startOfWeek); startOfLastWeek.setDate(startOfWeek.getDate() - 7);

  const thisWeek = transactions.filter(t => t.type === "expense" && new Date(t.date) >= startOfWeek).reduce((s, t) => s + Number(t.amount), 0);
  const lastWeek = transactions.filter(t => t.type === "expense" && new Date(t.date) >= startOfLastWeek && new Date(t.date) < startOfWeek).reduce((s, t) => s + Number(t.amount), 0);
  const change = lastWeek > 0 ? ((thisWeek - lastWeek) / lastWeek) * 100 : 0;
  const pos = change <= 0;

  return (
    <GlassCard style={{ background: `linear-gradient(135deg,${C.blue}10,${C.card})`, border: `1px solid ${C.blue}30` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <div style={{ width: 32, height: 32, borderRadius: 10, background: C.blue + "22", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icon name="calendar" size={15} color={C.blue} />
        </div>
        <span style={{ fontWeight: 600, fontSize: 14, color: C.blue }}>Weekly Summary</span>
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, color: C.text, marginBottom: 4 }}>${fmt(thisWeek, 0)}</div>
      <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.6 }}>
        Spent this week — {lastWeek > 0 ? (
          <span style={{ color: pos ? C.green : C.red, fontWeight: 600 }}>
            {pos ? "↓" : "↑"}{Math.abs(change).toFixed(0)}% {pos ? "less" : "more"} than last week
          </span>
        ) : "no data from last week yet"}.
      </div>
    </GlassCard>
  );
}

// ─── Auth Screen ──────────────────────────────────────────────
function AuthScreen({ onAuth }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  async function handleSubmit() {
    setError(""); setMsg(""); setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: name } } });
        if (error) throw error;
        setMsg("Check your email to confirm your account!");
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        onAuth(data.user);
      }
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  const inp = { width: "100%", padding: "14px 16px", background: C.bgSecondary, border: `1px solid ${C.border}`, borderRadius: 14, color: C.text, fontSize: 15, outline: "none", boxSizing: "border-box", fontFamily: FONT };

  return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, fontFamily: FONT }}>
      <div style={{ width: "100%", maxWidth: 380 }}>
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <img src="https://i.postimg.cc/k4tv1XgB/Remove-the-dark-background-completely-make-it-tran-delpmaspu-removebg-preview.png" alt="Arkonomy" style={{ width: 280, height: 140, objectFit: "contain", display: "block", margin: "0 auto 16px" }} />
          <div style={{ fontSize: 22, fontWeight: 300, color: C.cyan, letterSpacing: 8, marginBottom: 4 }}>ARKONOMY</div>
          <div style={{ color: C.faint, fontSize: 11, letterSpacing: 3 }}>YOUR AI FINANCIAL AUTOPILOT</div>
        </div>
        <GlassCard>
          <h2 style={{ color: C.text, margin: "0 0 22px", fontSize: 20, fontWeight: 700 }}>{mode === "login" ? "Welcome back" : "Create account"}</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {mode === "signup" && <input style={inp} placeholder="Full name" value={name} onChange={e => setName(e.target.value)} />}
            <input style={inp} type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} />
            <input style={inp} type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSubmit()} />
          </div>
          {error && <div style={{ color: C.red, fontSize: 13, marginTop: 12, background: C.red + "18", padding: "10px 14px", borderRadius: 10 }}>{error}</div>}
          {msg && <div style={{ color: C.green, fontSize: 13, marginTop: 12, background: C.green + "18", padding: "10px 14px", borderRadius: 10 }}>{msg}</div>}
          <button onClick={handleSubmit} disabled={loading} style={{ width: "100%", marginTop: 20, padding: 15, background: `linear-gradient(90deg,${C.cyan},${C.blue})`, border: "none", borderRadius: 12, color: "#fff", fontWeight: 700, fontSize: 15, cursor: "pointer", opacity: loading ? 0.7 : 1, fontFamily: FONT }}>
            {loading ? "..." : mode === "login" ? "Sign In" : "Create Account"}
          </button>
          <div style={{ textAlign: "center", marginTop: 18, color: C.muted, fontSize: 14 }}>
            {mode === "login" ? "No account? " : "Have account? "}
            <span onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(""); setMsg(""); }} style={{ color: C.cyan, cursor: "pointer", fontWeight: 600 }}>
              {mode === "login" ? "Sign up free" : "Sign in"}
            </span>
          </div>
        </GlassCard>
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────
export default function App() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [screen, setScreen] = useState("dashboard");
  const [transactions, setTransactions] = useState([]);
  const [categories, setCategories] = useState([]);
  const [savings, setSavings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddTx, setShowAddTx] = useState(false);
  const [editTx, setEditTx] = useState(null);
  const [catFilter, setCatFilter] = useState(null);
  const [chatMessages, setChatMessages] = useState([{ role: "assistant", text: "Hi! I'm your Arkonomy AI assistant. Ask me anything about your finances." }]);
  const [chatInput, setChatInput] = useState("");
  const [autopilot, setAutopilot] = useState({ overspendAlerts: true, largeTxAlerts: true, unusualSpending: true, largeTxThreshold: 200 });

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => { setUser(session?.user ?? null); setLoading(false); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => setUser(session?.user ?? null));
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => { if (user) loadAll(); }, [user]);

  async function loadAll() {
    setLoading(true);
    const [p, t, c, sv] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", user.id).single(),
      supabase.from("transactions").select("*").eq("user_id", user.id).order("date", { ascending: false }).limit(200),
      supabase.from("categories").select("*").eq("user_id", user.id),
      supabase.from("savings").select("*").eq("user_id", user.id),
    ]);
    if (p.data) setProfile(p.data);
    if (t.data) setTransactions(t.data);
    if (sv.data) setSavings(sv.data);
    if (c.data) { setCategories(c.data); if (c.data.length === 0) await seedCategories(); }
    setLoading(false);
  }

  async function seedCategories() {
    const defaults = [
      { name: "Food & Dining", icon: "food", color: "#FF6B6B", budget: 600 },
      { name: "Transport", icon: "car", color: "#4ECDC4", budget: 300 },
      { name: "Shopping", icon: "shopping", color: "#F59E0B", budget: 400 },
      { name: "Entertainment", icon: "film", color: "#A78BFA", budget: 200 },
      { name: "Health", icon: "heart", color: "#34D399", budget: 150 },
      { name: "Bills", icon: "file", color: "#60A5FA", budget: 800 },
    ];
    const { data } = await supabase.from("categories").insert(defaults.map(d => ({ ...d, user_id: user.id }))).select();
    if (data) setCategories(data);
  }

  async function signOut() {
    await supabase.auth.signOut();
    setUser(null); setProfile(null); setTransactions([]); setCategories([]); setSavings([]);
  }

  async function addTransaction(tx) {
    const { data } = await supabase.from("transactions").insert({ user_id: user.id, ...tx }).select().single();
    if (data) setTransactions(prev => [data, ...prev]);
    setShowAddTx(false);
  }

  async function deleteTransaction(id) {
    await supabase.from("transactions").delete().eq("id", id);
    setTransactions(prev => prev.filter(t => t.id !== id));
  }

  async function updateTransaction(id, updates) {
    const { data } = await supabase.from("transactions").update(updates).eq("id", id).select().single();
    if (data) setTransactions(prev => prev.map(t => t.id === id ? data : t));
    setEditTx(null);
  }

  async function addSaving(sv) {
    const { data } = await supabase.from("savings").insert({ ...sv, user_id: user.id }).select().single();
    if (data) setSavings(prev => [...prev, data]);
  }

  async function updateSaving(id, current) {
    await supabase.from("savings").update({ current }).eq("id", id);
    setSavings(prev => prev.map(s => s.id === id ? { ...s, current } : s));
  }

  async function saveProfile(updates) {
    await supabase.from("profiles").update(updates).eq("id", user.id);
    setProfile(prev => ({ ...prev, ...updates }));
  }

  const now = new Date();
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const thisMonth = transactions.filter(t => { const d = new Date(t.date); return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear(); });
  const lastMonth = transactions.filter(t => { const d = new Date(t.date); return d.getMonth() === prevMonth.getMonth() && d.getFullYear() === prevMonth.getFullYear(); });

  const totalSpent = thisMonth.filter(t => t.type === "expense").reduce((s, t) => s + Number(t.amount), 0);
  const totalIncome = thisMonth.filter(t => t.type === "income").reduce((s, t) => s + Number(t.amount), 0);
  const lastSpent = lastMonth.filter(t => t.type === "expense").reduce((s, t) => s + Number(t.amount), 0);
  const lastIncome = lastMonth.filter(t => t.type === "income").reduce((s, t) => s + Number(t.amount), 0);

  const spendingByCategory = {};
  thisMonth.filter(t => t.type === "expense").forEach(t => { const k = t.category_name || "Other"; spendingByCategory[k] = (spendingByCategory[k] || 0) + Number(t.amount); });
  const prevSpendingByCategory = {};
  lastMonth.filter(t => t.type === "expense").forEach(t => { const k = t.category_name || "Other"; prevSpendingByCategory[k] = (prevSpendingByCategory[k] || 0) + Number(t.amount); });

  useEffect(() => {
    if (!loading) window.hideSplash?.();
  }, [loading]);

  if (loading && !user) return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT }}>
      <div style={{ color: C.cyan, fontSize: 16, fontWeight: 500 }}>Loading Arkonomy...</div>
    </div>
  );

  if (!user) return <AuthScreen onAuth={setUser} />;

  const shared = { transactions, categories, savings, profile, totalSpent, totalIncome, lastSpent, lastIncome, spendingByCategory, prevSpendingByCategory };

  async function sendChat(input) {
    if (!input.trim()) return;
    const userMsg = { role: "user", text: input };
    const updated = [...chatMessages, userMsg];
    setChatMessages(updated); setChatInput("");
    const ctx = {
      currentMonth: { totalSpent, totalIncome, balance: totalIncome - totalSpent, budget: Number(profile?.monthly_budget) || 3000, topExpenses: Object.entries(spendingByCategory).sort((a, b) => b[1] - a[1]).slice(0, 5) },
      savingsGoals: savings.map(s => ({ name: s.name, current: s.current, target: s.target, progress: s.target > 0 ? Math.round((s.current / s.target) * 100) : 0 })),
      recentTransactions: transactions.slice(0, 10).map(t => ({ description: t.description, amount: t.amount, type: t.type, category: t.category_name, date: t.date })),
    };
    const lid = Date.now();
    setChatMessages(prev => [...prev, { role: "assistant", text: "...", id: lid, loading: true }]);
    try {
      const res = await supabase.functions.invoke("ai-chat", { body: { messages: updated.filter(m => !m.loading), financialContext: ctx } });
      const reply = res.data?.reply || "Sorry, something went wrong.";
      setChatMessages(prev => prev.map(m => m.id === lid ? { role: "assistant", text: reply } : m));
    } catch {
      setChatMessages(prev => prev.map(m => m.id === lid ? { role: "assistant", text: "Could not reach AI. Check your connection." } : m));
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: FONT, maxWidth: 430, margin: "0 auto", position: "relative", overflow: "visible" }}>
      {/* Header */}
      <div <div style={{ padding: "12px 18px", display: "flex", justifyContent: "space-between", alignItems: "center", position: "sticky", top: 0, background: "rgba(11,20,38,0.99)", backdropFilter: "blur(20px)", zIndex: 50, borderBottom: `1px solid ${C.sep}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <img src="https://i.postimg.cc/k4tv1XgB/Remove-the-dark-background-completely-make-it-tran-delpmaspu-removebg-preview.png" alt="Arkonomy" style={{ width: 72, height: 36, objectFit: "contain" }} />
          <div>
            <div style={{ color: C.muted, fontSize: 12, fontWeight: 500 }}>{profile?.full_name || user.email?.split("@")[0]}</div>
            <div style={{ color: C.faint, fontSize: 10 }}>AI Financial Autopilot</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setScreen("profile")} style={{ background: screen === "profile" ? C.cyan + "18" : C.bgSecondary, border: `1px solid ${screen === "profile" ? C.cyan + "44" : C.border}`, borderRadius: 10, width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <Icon name="settings" size={16} color={screen === "profile" ? C.cyan : C.muted} />
          </button>
          <button onClick={signOut} style={{ background: C.bgSecondary, border: `1px solid ${C.border}`, borderRadius: 10, padding: "7px 13px", color: C.muted, cursor: "pointer", fontSize: 13, fontFamily: FONT, fontWeight: 500 }}>Out</button>
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: "14px 14px 85px" }}>
        {loading ? (
          <div style={{ color: C.muted, textAlign: "center", padding: 40 }}>Loading...</div>
        ) : (
          <>
            {screen === "dashboard" && <Dashboard {...shared} onNavigate={setScreen} onCatClick={cat => { setCatFilter(cat); setScreen("transactions"); }} />}
            {screen === "transactions" && <Transactions transactions={transactions} categories={categories} onAdd={() => setShowAddTx(true)} onDelete={deleteTransaction} onEdit={setEditTx} activeCatFilter={catFilter} onClearCatFilter={() => setCatFilter(null)} />}
            {screen === "savings" && <Savings savings={savings} onAdd={addSaving} onUpdate={updateSaving} totalIncome={totalIncome} totalSpent={totalSpent} />}
            {screen === "insights" && <Insights {...shared} onNavigateChat={msg => { setChatMessages(prev => [...prev, { role: "user", text: msg }]); setScreen("chat"); }} />}
            {screen === "chat" && <Chat messages={chatMessages} input={chatInput} setInput={setChatInput} onSend={() => sendChat(chatInput)} />}
            {screen === "profile" && <Profile profile={profile} user={user} onSave={saveProfile} autopilot={autopilot} setAutopilot={setAutopilot} />}
          </>
        )}
      </div>

      {showAddTx && <AddTransactionModal categories={categories} onAdd={addTransaction} onClose={() => setShowAddTx(false)} />}
      {editTx && <AddTransactionModal categories={categories} existing={editTx} onAdd={data => updateTransaction(editTx.id, data)} onClose={() => setEditTx(null)} />}

    {screen !== "chat" && (
  <button onClick={() => setScreen("chat")} style={{ position: "fixed", bottom: 20, right: "calc(50% - 215px + 14px)", width: 44, height: 44, borderRadius: "50%", background: `linear-gradient(135deg,${C.cyan},${C.blue})`, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: `0 4px 20px ${C.cyan}55`, zIndex: 55 }}>
    <Icon name="zap" size={18} color="#fff" strokeWidth={2} />
  </button>
)}

      <BottomNav screen={screen} setScreen={setScreen} />
    </div>
  );
}

// ─── Market Overview Card ─────────────────────────────────────
function MarketOverview() {
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
        "apikey": "sb_publishable_z4Mh9KZLXS_6ZZJyJ-pE7A_ClkhUDt9",
      };

      const [mRes, nRes] = await Promise.all([
        fetch("https://hvnkxxazjfesbxdkzuba.supabase.co/functions/v1/market-data", {
          method: "POST", headers, body: JSON.stringify({ type: "overview" }),
        }),
        fetch("https://hvnkxxazjfesbxdkzuba.supabase.co/functions/v1/market-data", {
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
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, []);

  const MARKET_META = {
    SPY:  { label: "S&P 500",  icon: "bar-chart", color: "#2F80FF" },
    QQQ:  { label: "NASDAQ",   icon: "activity",  color: "#A78BFA" },
    BTC:  { label: "Bitcoin",  icon: "zap",        color: "#F59E0B" },
    ETH:  { label: "Ethereum", icon: "zap",        color: "#34D399" },
  };

  return (
    <GlassCard style={{ padding: "14px 16px", opacity: 0.75 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: C.blue + "22", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name="bar-chart" size={14} color={C.blue} />
          </div>
          <span style={{ fontWeight: 600, fontSize: 14 }}>Markets</span>
          {lastUpdated && !loading && (
            <span style={{ fontSize: 10, color: C.faint }}>
              {lastUpdated.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          {["markets", "news"].map(t => (
            <button key={t} onClick={() => setTab(t)}
              style={{ padding: "4px 10px", borderRadius: 20, border: `1px solid ${tab === t ? C.blue : C.border}`, background: tab === t ? C.blue + "18" : "transparent", color: tab === t ? C.blue : C.faint, cursor: "pointer", fontSize: 11, fontWeight: tab === t ? 600 : 400, fontFamily: FONT, textTransform: "capitalize" }}>
              {t}
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
          <div style={{ marginTop: 8, fontSize: 11 }}>Loading market data...</div>
        </div>
      ) : error ? (
        <div style={{ padding: "12px 14px", background: C.red + "10", borderRadius: 12, border: `1px solid ${C.red}22` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
            <Icon name="alert-circle" size={14} color={C.red} />
            <span style={{ fontSize: 12, color: C.red, fontWeight: 600 }}>Could not load market data</span>
          </div>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 10, lineHeight: 1.5 }}>{error}</div>
          <div style={{ fontSize: 11, color: C.faint, lineHeight: 1.6 }}>
            Check: <span style={{ color: C.text }}>1)</span> Edge Function <code style={{ color: C.cyan }}>market-data</code> is deployed in Supabase <span style={{ color: C.text }}>2)</span> <code style={{ color: C.cyan }}>FINNHUB_API_KEY</code> secret is set
          </div>
          <button onClick={load} style={{ marginTop: 10, padding: "7px 14px", background: C.blue + "22", border: `1px solid ${C.blue}44`, borderRadius: 8, color: C.blue, cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: FONT }}>
            Retry
          </button>
        </div>
      ) : tab === "markets" ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {markets.map(m => {
            const meta = MARKET_META[m.symbol] || { label: m.symbol, icon: "activity", color: C.cyan };
            const pos = (m.changePct ?? 0) >= 0;
            const chColor = pos ? C.green : C.red;
            return (
              <div key={m.symbol} style={{ background: C.bgTertiary, borderRadius: 12, padding: "10px 12px", border: `1px solid ${C.border}` }}>
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
            ? <div style={{ color: C.faint, fontSize: 12, textAlign: "center", padding: "16px 0" }}>No news available</div>
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
          Powered by Finnhub · auto-refreshes every 60s
        </div>
      )}
    </GlassCard>
  );
}

// ─── Dashboard ────────────────────────────────────────────────
function Dashboard({ totalSpent, totalIncome, lastSpent, lastIncome, transactions, spendingByCategory, prevSpendingByCategory, profile, savings, onNavigate, onCatClick }) {
  const [balanceVisible, setBalanceVisible] = useState(true);
  const budget = Number(profile?.monthly_budget) || 3000;
  const balance = totalIncome - totalSpent;
  const pct = budget > 0 ? Math.min((totalSpent / budget) * 100, 100) : 0;
  const incomeChange = lastIncome > 0 ? ((totalIncome - lastIncome) / lastIncome) * 100 : 0;
  const expenseChange = lastSpent > 0 ? ((totalSpent - lastSpent) / lastSpent) * 100 : 0;
  const balColor = balance >= 0 ? C.green : C.red;

  // ── Compute CheckInCard data ──────────────────────────────────
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

      {/* 1 ── Net Balance Card */}
      <div style={{ background: "linear-gradient(145deg,#0D1F3C,#0B1426)", borderRadius: 20, padding: "16px 18px", border: `1px solid #1E2D4A`, position: "relative", overflow: "hidden", boxShadow: "0 4px 24px rgba(0,194,255,0.06)" }}>
        <div style={{ position: "absolute", top: -30, right: -30, width: 110, height: 110, borderRadius: "50%", background: C.cyan + "0B", pointerEvents: "none" }} />

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
          <span style={{ fontSize: 10, color: C.muted, letterSpacing: 1, fontWeight: 600, textTransform: "uppercase" }}>Net Balance</span>
          <button onClick={() => setBalanceVisible(v => !v)} style={{ background: "none", border: "none", cursor: "pointer", padding: "2px", display: "flex" }}>
            <Icon name={balanceVisible ? "eye" : "eye-off"} size={15} color={C.faint} />
          </button>
        </div>

        <div style={{ fontSize: 40, fontWeight: 800, letterSpacing: -1.5, color: balanceVisible ? balColor : C.text, lineHeight: 1.1, textShadow: balanceVisible ? `0 0 24px ${balColor}44` : "none" }}>
          {balanceVisible ? `$${fmt(balance)}` : "••••••"}
        </div>
        <div style={{ fontSize: 10, color: C.faint, marginBottom: 12 }}>Available balance</div> 

        <div style={{ height: 1, background: "rgba(255,255,255,0.05)", marginBottom: 12 }} />

        <div style={{ display: "flex" }}>
          {[
            { label: "Income", value: `$${fmt(totalIncome, 0)}`, dot: C.green, change: incomeChange },
            { label: "Expenses", value: `$${fmt(totalSpent, 0)}`, dot: C.red, change: expenseChange, flip: true },
            { label: "Saved", value: `$${fmt(Math.max(totalIncome - totalSpent, 0), 0)}`, dot: C.cyan },
          ].map((item, i) => (
            <div key={item.label} style={{ flex: 1, paddingLeft: i > 0 ? 10 : 0, borderLeft: i > 0 ? `1px solid ${C.sep}` : "none", marginLeft: i > 0 ? 10 : 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 2 }}>
                <div style={{ width: 5, height: 5, borderRadius: 99, background: item.dot }} />
                <span style={{ fontSize: 9, color: C.muted, fontWeight: 500 }}>{item.label}</span>
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 3 }}>{item.value}</div>
              {item.change !== undefined && <StatBadge value={item.flip ? -item.change : item.change} suffix="" />}
            </div>
          ))}
        </div>
      </div>

     {/* 2 ── AI Check-In */}
      <CheckInCard data={checkInData} onAskAI={() => onNavigate("chat")} />

      {/* 3 ── Spending by Category */}
      <GlassCard style={{ padding: "14px 16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>Spending by Category</span>
          <span style={{ fontSize: 10, color: C.faint, background: C.bgTertiary, padding: "3px 8px", borderRadius: 99 }}>Tap to filter</span>
        </div>
        <DonutChart data={spendingByCategory} size={140} onCatClick={onCatClick} />
      </GlassCard>

      {/* 4 ── Monthly Budget */}
      <GlassCard style={{ padding: "14px 16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Monthly Budget</div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 1 }}>Spent ${fmt(totalSpent, 0)} of ${fmt(budget, 0)}</div>
          </div>
          <span style={{ color: pct > 90 ? C.red : pct > 70 ? C.yellow : C.cyan, fontSize: 15, fontWeight: 800 }}>{pct.toFixed(0)}%</span>
        </div>
        <div style={{ height: 7, background: C.bgTertiary, borderRadius: 99, marginBottom: 6 }}>
          <div style={{ height: 7, borderRadius: 99, width: `${pct}%`, background: pct > 90 ? C.red : pct > 70 ? C.yellow : `linear-gradient(90deg,${C.cyan},${C.blue})`, transition: "width 0.6s", boxShadow: pct <= 70 ? `0 0 8px ${C.cyan}44` : "none" }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span style={{ color: C.green, fontSize: 11, fontWeight: 600 }}>${fmt(Math.max(budget - totalSpent, 0))} remaining</span>
          <span style={{ color: C.faint, fontSize: 11 }}>of ${fmt(budget, 0)}</span>
        </div>
      </GlassCard>

      {/* 5 ── Market Overview (last) */}
      <MarketOverview />

      {/* 6 ── Recent Transactions */}
      <GlassCard style={{ padding: "14px 16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>Recent Transactions</span>
          <button onClick={() => onNavigate("transactions")} style={{ background: "none", border: "none", cursor: "pointer", color: C.cyan, fontSize: 12, fontWeight: 600, fontFamily: FONT, display: "flex", alignItems: "center", gap: 4, padding: 0 }}>
            View all <Icon name="chevron" size={12} color={C.cyan} />
          </button>
        </div>
        {transactions.length === 0
          ? <div style={{ color: C.muted, textAlign: "center", padding: "16px 0", fontSize: 13 }}>No transactions yet</div>
          : transactions.slice(0, 3).map((t, i, arr) => (
              <div key={t.id}>
                <TxRow t={t} />
                {i < arr.length - 1 && <div style={{ height: 1, background: C.sep }} />}
              </div>
            ))
        }
      </GlassCard>

    </div>
  );
}

// ─── Insights ─────────────────────────────────────────────────
function Insights({ totalSpent, totalIncome, spendingByCategory, prevSpendingByCategory, onNavigateChat, transactions, savings, profile }) {
  const monthlySavings = totalIncome - totalSpent;
  const savingsRate = totalIncome > 0 ? (monthlySavings / totalIncome) * 100 : 0;
  const insights = [];

  Object.entries(spendingByCategory).forEach(([cat, amount]) => {
    const prev = prevSpendingByCategory[cat] || 0;
    if (prev > 0) {
      const change = ((amount - prev) / prev) * 100;
      if (change > 25) insights.push({ id: `u-${cat}`, icon: "trending-up", title: `${cat} up ${change.toFixed(0)}%`, desc: `$${fmt(amount, 0)} this month vs $${fmt(prev, 0)} last month. Reducing could save ~$${fmt(amount - prev, 0)}/month.`, severity: change > 50 ? "danger" : "warning", value: `+${change.toFixed(0)}%`, context: `My ${cat} spending is ${change.toFixed(0)}% higher than last month. What's driving this and how do I cut back?` });
    }
  });

  if (savingsRate < 10 && totalIncome > 0) insights.push({ id: "savings-low", icon: "target", title: "Low Savings Rate", desc: `Saving ${savingsRate.toFixed(1)}% of income. The target is 20% for long-term stability.`, severity: "warning", value: `${savingsRate.toFixed(1)}%`, context: `My savings rate is only ${savingsRate.toFixed(1)}%. How do I reach 20%?` });
  else if (savingsRate >= 20) insights.push({ id: "savings-good", icon: "star", title: "Excellent Savings Rate!", desc: `Saving ${savingsRate.toFixed(1)}% — above the 20% recommended target.`, severity: "good", value: `${savingsRate.toFixed(1)}%`, context: `My savings rate is ${savingsRate.toFixed(1)}%. How should I best invest this surplus?` });

  const shopping = spendingByCategory["Shopping"] || 0;
  if (shopping > 300) insights.push({ id: "shopping", icon: "shopping", title: "High Shopping Spend", desc: `$${fmt(shopping, 0)} on shopping. A 30-day waiting rule for non-essentials can reduce impulse buys.`, severity: "info", value: `$${fmt(shopping, 0)}`, context: `I spent $${fmt(shopping, 0)} on shopping. Help me build habits to reduce impulse purchases.` });

  if (insights.length === 0) insights.push({ id: "all-good", icon: "check-circle", title: "You're on track!", desc: "Your spending looks healthy this month. Keep it up!", severity: "good", context: "My finances look healthy. What should I focus on to build long-term wealth?" });

  const colors = { info: C.cyan, warning: C.yellow, danger: C.red, good: C.green };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ marginBottom: 4 }}>
        <h2 style={{ margin: "0 0 4px", fontSize: 26, fontWeight: 700 }}>Insights</h2>
        <div style={{ fontSize: 13, color: C.muted }}>AI-powered spending analysis</div>
      </div>

      <HealthScore totalSpent={totalSpent} totalIncome={totalIncome} budget={Number(profile?.monthly_budget) || 3000} savingsGoals={savings || []} />
      <WeeklySummary transactions={transactions || []} />

      {insights.map(ins => {
        const color = colors[ins.severity];
        return (
          <GlassCard key={ins.id}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ width: 44, height: 44, borderRadius: 14, background: color + "22", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: `0 0 14px ${color}33` }}>
                <Icon name={ins.icon} size={20} color={color} />
              </div>
              {ins.value && <span style={{ background: color + "22", color, borderRadius: 100, padding: "4px 12px", fontSize: 13, fontWeight: 700 }}>{ins.value}</span>}
            </div>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>{ins.title}</div>
            <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.7, marginBottom: 14 }}>{ins.desc}</div>
            <button onClick={() => onNavigateChat(ins.context)} style={{ background: "none", border: "none", cursor: "pointer", color, fontSize: 13, fontWeight: 600, padding: 0, display: "flex", alignItems: "center", gap: 6, fontFamily: FONT }}>
              <Icon name="message" size={13} color={color} /> Ask AI about this <Icon name="chevron" size={13} color={color} />
            </button>
          </GlassCard>
        );
      })}

      <GlassCard style={{ background: `linear-gradient(135deg,${C.cyan}0D,${C.card})`, border: `1px solid ${C.cyan}30` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <Icon name="zap" size={16} color={C.cyan} />
          <span style={{ fontWeight: 600, fontSize: 15, color: C.cyan }}>Autopilot Tip</span>
        </div>
        <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.65 }}>
          Auto-invest your monthly surplus and let compound interest work. Even $50/month can grow to $30,000+ in 20 years at average market returns.
        </div>
      </GlassCard>

      <div style={{ fontSize: 11, color: C.faint, textAlign: "center", lineHeight: 1.6, padding: "0 8px" }}>
        AI insights are for informational purposes only and should not be considered financial advice.
      </div>
    </div>
  );
}

// ─── Category Icon ────────────────────────────────────────────
function CatIcon({ name, type, size = 18 }) {
  const map = {
    "Food & Dining": { color: "#E8612C", icon: "food" },
    "Transport":     { color: "#2563EB", icon: "car" },
    "Shopping":      { color: "#B45309", icon: "shopping" },
    "Entertainment": { color: "#7C3AED", icon: "film" },
    "Health":        { color: "#059669", icon: "heart" },
    "Bills":         { color: "#0891B2", icon: "file" },
    "Subscriptions": { color: "#EA580C", icon: "repeat" },
    "income":        { color: "#00A67E", icon: "dollar" },
    "default":       { color: "#374151", icon: "credit" },
  };
  const key = type === "income" ? "income" : (map[name] ? name : "default");
  const { color, icon } = map[key];
  return (
    <div style={{ width: 42, height: 42, borderRadius: 13, background: color, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, boxShadow: `0 2px 8px ${color}44` }}>
      <Icon name={icon} size={size} color="#fff" strokeWidth={2} />
    </div>
  );
}

// ─── TxRow ────────────────────────────────────────────────────
function TxRow({ t, onDelete, onEdit }) {
  const isExp = t.type === "expense";
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 0" }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", minWidth: 0, flex: 1 }}>
        <CatIcon name={t.category_name} type={t.type} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.description || t.category_name || "Transaction"}</div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
            <span style={{ color: CAT_COLORS[t.category_name] || C.faint, fontWeight: 500 }}>{t.category_name || (t.type === "income" ? "Income" : "Other")}</span>
            <span style={{ color: C.faint }}> · {fmtDate(t.date)}</span>
          </div>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0, marginLeft: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: isExp ? C.red : C.green, letterSpacing: -0.3 }}>
          {isExp ? "−" : "+"}${fmt(t.amount)}
        </span>
        {onEdit && (
          <button onClick={() => onEdit(t)} style={{ background: "none", border: "none", cursor: "pointer", padding: "3px", display: "flex", opacity: 0.5 }}>
            <Icon name="edit" size={13} color={C.muted} strokeWidth={2} />
          </button>
        )}
        {onDelete && (
          <button onClick={() => onDelete(t.id)} style={{ background: "none", border: "none", cursor: "pointer", padding: "3px", display: "flex", opacity: 0.45 }}>
            <Icon name="x" size={13} color={C.muted} strokeWidth={2.5} />
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Transactions ─────────────────────────────────────────────
function Transactions({ transactions, categories, onAdd, onDelete, onEdit, activeCatFilter, onClearCatFilter }) {
  const [filter, setFilter] = useState("all");
  const catFilter = activeCatFilter || null;
  let filtered = filter === "all" ? transactions : transactions.filter(t => t.type === filter);
  if (catFilter) filtered = filtered.filter(t => t.category_name === catFilter);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: "0 0 2px", fontSize: 26, fontWeight: 700 }}>Transactions</h2>
          <div style={{ fontSize: 13, color: C.muted }}>Income & expenses</div>
        </div>
        <button onClick={onAdd} style={{ background: `linear-gradient(90deg,${C.cyan},${C.blue})`, border: "none", borderRadius: 12, padding: "9px 16px", color: "#fff", fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontSize: 14, fontFamily: FONT }}>
          <Icon name="plus" size={14} color="#fff" strokeWidth={2.5} /> Add
        </button>
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        {[
          { key: "all", label: "All" },
          { key: "expense", label: "Expenses" },
          { key: "income", label: "Income" },
        ].map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            style={{ padding: "6px 14px", borderRadius: 20, border: `1px solid ${filter === f.key ? C.cyan : C.border}`, background: filter === f.key ? C.cyan + "18" : C.card, color: filter === f.key ? C.cyan : C.muted, cursor: "pointer", fontSize: 12, fontFamily: FONT, fontWeight: filter === f.key ? 600 : 400 }}>
            {f.label}
          </button>
        ))}
      </div>

      {catFilter && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, padding: "8px 12px", background: (CAT_COLORS[catFilter] || C.cyan) + "18", borderRadius: 12, border: `1px solid ${(CAT_COLORS[catFilter] || C.cyan)}33` }}>
          <div style={{ width: 8, height: 8, borderRadius: 99, background: CAT_COLORS[catFilter] || C.cyan }} />
          <span style={{ fontSize: 13, color: CAT_COLORS[catFilter] || C.cyan, fontWeight: 600, flex: 1 }}>{catFilter}</span>
          <button onClick={onClearCatFilter} style={{ background: "none", border: "none", cursor: "pointer", display: "flex" }}>
            <Icon name="x" size={13} color={C.muted} strokeWidth={2.5} />
          </button>
        </div>
      )}

      <GlassCard style={{ padding: "0 14px" }}>
        {filtered.length === 0
          ? <div style={{ color: C.muted, textAlign: "center", padding: "30px 0", fontSize: 14 }}>No transactions</div>
          : filtered.map((t, i, arr) => (
              <div key={t.id}>
                <TxRow t={t} onDelete={onDelete} onEdit={onEdit} />
                {i < arr.length - 1 && <div style={{ height: 1, background: C.sep }} />}
              </div>
            ))
        }
      </GlassCard>
    </div>
  );
}

// ─── Add Transaction Modal ────────────────────────────────────
const INCOME_CATS = [
  { name: "Salary", icon: "dollar", color: "#00A67E" },
  { name: "Freelance", icon: "star", color: "#00C2FF" },
  { name: "Transfer", icon: "repeat", color: "#60A5FA" },
  { name: "Dividends", icon: "activity", color: "#A78BFA" },
  { name: "Debt Repaid", icon: "check-circle", color: "#34D399" },
  { name: "Gift", icon: "heart", color: "#F97316" },
  { name: "Other Income", icon: "plus", color: "#94A3B8" },
];

function AddTransactionModal({ categories, onAdd, onClose, existing }) {
  const [amount, setAmount] = useState(existing ? String(existing.amount) : "");
  const [desc, setDesc] = useState(existing?.description || "");
  const [catId, setCatId] = useState(existing?.category_id || "");
  const [catName, setCatName] = useState(existing?.category_name || "");
  const [type, setType] = useState(existing?.type || "expense");
  const [date, setDate] = useState(existing?.date || new Date().toISOString().split("T")[0]);
  const [showCats, setShowCats] = useState(false);
  const isEdit = !!existing;

  const noSpinStyle = `input[type=number]::-webkit-inner-spin-button,input[type=number]::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}input[type=number]{-moz-appearance:textfield}`;
  const inp = { width: "100%", padding: "13px 14px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 12, color: C.text, fontSize: 15, outline: "none", boxSizing: "border-box", fontFamily: FONT };

  function switchType(t) { setType(t); setCatId(""); setCatName(""); setShowCats(false); }

  const displayCats = type === "income"
    ? INCOME_CATS.map((c, i) => ({ id: `income-${i}`, ...c }))
    : categories;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.82)", display: "flex", alignItems: "flex-end", zIndex: 100, maxWidth: 430, margin: "0 auto" }}>
      <style>{noSpinStyle}</style>
      <div style={{ background: C.card, width: "100%", borderRadius: "24px 24px 0 0", padding: 24, border: `1px solid ${C.border}`, maxHeight: "90vh", overflowY: "auto", fontFamily: FONT }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{isEdit ? "Edit Transaction" : "Add Transaction"}</h3>
          <button onClick={onClose} style={{ background: C.bgSecondary, border: `1px solid ${C.border}`, borderRadius: 99, cursor: "pointer", width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name="x" size={14} color={C.muted} strokeWidth={2.5} />
          </button>
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          {["expense", "income"].map(t => (
            <button key={t} onClick={() => switchType(t)} style={{ flex: 1, padding: 11, borderRadius: 12, border: `1px solid ${type === t ? (t === "expense" ? C.red : C.green) : C.border}`, background: type === t ? (t === "expense" ? C.red + "18" : C.green + "18") : "transparent", color: type === t ? (t === "expense" ? C.red : C.green) : C.muted, cursor: "pointer", fontWeight: 600, textTransform: "capitalize", fontFamily: FONT }}>{t}</button>
          ))}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ position: "relative" }}>
            <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: C.muted, fontSize: 16, fontWeight: 600, pointerEvents: "none" }}>$</span>
            <input type="number" placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)} style={{ ...inp, paddingLeft: 30 }} />
          </div>
          <input style={inp} placeholder="Description / Merchant (optional)" value={desc} onChange={e => setDesc(e.target.value)} />
          <div>
            <button onClick={() => setShowCats(!showCats)} style={{ ...inp, display: "flex", alignItems: "center", gap: 12, cursor: "pointer", textAlign: "left" }}>
              {catName
                ? type === "income"
                  ? <><div style={{ width: 32, height: 32, borderRadius: 10, background: INCOME_CATS.find(c => c.name === catName)?.color || C.green, display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name={INCOME_CATS.find(c => c.name === catName)?.icon || "dollar"} size={15} color="#fff" strokeWidth={2} /></div><span style={{ color: C.text }}>{catName}</span></>
                  : <><CatIcon name={catName} type={type} size={15} /><span style={{ color: C.text }}>{catName}</span></>
                : <span style={{ color: C.muted }}>Select {type === "income" ? "income source" : "category"}</span>
              }
              <span style={{ marginLeft: "auto" }}><Icon name="chevron" size={14} color={C.faint} /></span>
            </button>
            {showCats && (
              <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 12, marginTop: 4, overflow: "hidden", maxHeight: 240, overflowY: "auto" }}>
                {displayCats.map(c => (
                  <div key={c.id || c.name} onClick={() => { setCatId(c.id || c.name); setCatName(c.name); setShowCats(false); }}
                    style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 14px", cursor: "pointer", background: catName === c.name ? C.cyan + "10" : "transparent", borderBottom: `1px solid ${C.sep}` }}>
                    {type === "income"
                      ? <div style={{ width: 34, height: 34, borderRadius: 10, background: c.color, display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <Icon name={c.icon} size={15} color="#fff" strokeWidth={2} />
                        </div>
                      : <CatIcon name={c.name} type={type} size={15} />
                    }
                    <span style={{ color: C.text, fontSize: 14, fontWeight: 500 }}>{c.name}</span>
                    {catName === c.name && <Icon name="check-circle" size={14} color={C.cyan} style={{ marginLeft: "auto" }} />}
                  </div>
                ))}
              </div>
            )}
          </div>
          <input style={inp} type="date" value={date} onChange={e => setDate(e.target.value)} />
        </div>
        <button
          onClick={() => { if (!amount) return; onAdd({ amount: parseFloat(amount), description: desc || catName, category_id: type === "expense" ? (catId || null) : null, category_name: catName, date, type }); }}
          style={{ width: "100%", marginTop: 18, padding: 15, background: `linear-gradient(90deg,${type === "expense" ? C.red : C.green},${type === "expense" ? "#CC1A3A" : "#00A67E"})`, border: "none", borderRadius: 14, color: "#fff", fontWeight: 700, fontSize: 15, cursor: "pointer", fontFamily: FONT }}>
          {isEdit ? "Save Changes" : `Add ${type === "expense" ? "Expense" : "Income"}`}
        </button>
      </div>
    </div>
  );
}

// ─── Savings Goal Card ────────────────────────────────────────
function SavingsGoalCard({ sv, pct, goalColor, remaining, months, onUpdate, getGoalIcon }) {
  const [mode, setMode] = useState(null);
  const [customAmt, setCustomAmt] = useState("");

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
          <div style={{ width: 44, height: 44, borderRadius: 14, background: goalColor + "22", border: `1px solid ${goalColor}44`, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: `0 0 12px ${goalColor}33` }}>
            <Icon name={getGoalIcon(sv.name)} size={20} color={goalColor} />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{sv.name}</div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
              ${fmt(sv.current, 0)} / ${fmt(sv.target, 0)}
              {months && <span style={{ color: C.cyan, fontWeight: 500 }}> · ~{months}mo</span>}
            </div>
          </div>
        </div>
        <div style={{ background: goalColor + "22", borderRadius: 100, padding: "4px 10px" }}>
          <span style={{ color: goalColor, fontWeight: 700, fontSize: 13 }}>{pct.toFixed(0)}%</span>
        </div>
      </div>
      <div style={{ height: 10, background: C.bgTertiary, borderRadius: 99, marginBottom: 8, overflow: "hidden" }}>
        <div style={{ height: 10, borderRadius: 99, width: `${pct}%`, background: `linear-gradient(90deg,${goalColor},${goalColor}BB)`, transition: "width 0.6s", boxShadow: `0 0 12px ${goalColor}55` }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 14 }}>
        <span style={{ color: C.text, fontWeight: 600 }}>${fmt(sv.current, 0)} saved</span>
        <span style={{ color: C.muted }}>${fmt(remaining, 0)} remaining</span>
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        {[10, 25, 50, 100].map(amt => (
          <button key={amt} onClick={() => onUpdate(sv.id, Number(sv.current) + amt)}
            style={{ flex: 1, padding: "8px 0", background: goalColor + "15", border: `1px solid ${goalColor}40`, borderRadius: 10, color: goalColor, cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: FONT }}>
            +${amt}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: mode ? 10 : 0 }}>
        <button onClick={() => { setMode(mode === "deposit" ? null : "deposit"); setCustomAmt(""); }}
          style={{ flex: 1, padding: "10px 0", borderRadius: 10, border: `1px solid ${mode === "deposit" ? C.green : C.border}`, background: mode === "deposit" ? C.green + "20" : C.bgTertiary, color: mode === "deposit" ? C.green : C.muted, cursor: "pointer", fontWeight: 600, fontSize: 13, fontFamily: FONT, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
          <Icon name="plus" size={14} color={mode === "deposit" ? C.green : C.muted} strokeWidth={2.5} /> Deposit
        </button>
        <button onClick={() => { setMode(mode === "withdraw" ? null : "withdraw"); setCustomAmt(""); }}
          style={{ flex: 1, padding: "10px 0", borderRadius: 10, border: `1px solid ${mode === "withdraw" ? C.red : C.border}`, background: mode === "withdraw" ? C.red + "20" : C.bgTertiary, color: mode === "withdraw" ? C.red : C.muted, cursor: "pointer", fontWeight: 600, fontSize: 13, fontFamily: FONT, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
          <Icon name="trending-down" size={14} color={mode === "withdraw" ? C.red : C.muted} strokeWidth={2.5} /> Withdraw
        </button>
      </div>
      {mode && (
        <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
          <div style={{ flex: 1, position: "relative" }}>
            <span style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", color: C.muted, fontSize: 15, fontWeight: 700, pointerEvents: "none" }}>$</span>
            <input autoFocus type="number" placeholder="0.00" value={customAmt} onChange={e => setCustomAmt(e.target.value)} onKeyDown={e => e.key === "Enter" && confirm()}
              style={{ width: "100%", padding: "12px 12px 12px 28px", background: C.bg, border: `2px solid ${accentColor}66`, borderRadius: 10, color: C.text, fontSize: 15, outline: "none", boxSizing: "border-box", fontFamily: FONT }} />
          </div>
          <button onClick={confirm} style={{ padding: "12px 20px", background: accentColor, border: "none", borderRadius: 10, color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: FONT }}>
            {mode === "deposit" ? "Add" : "Withdraw"}
          </button>
          <button onClick={() => { setMode(null); setCustomAmt(""); }} style={{ padding: "12px", background: C.bgTertiary, border: `1px solid ${C.border}`, borderRadius: 10, cursor: "pointer", display: "flex", alignItems: "center" }}>
            <Icon name="x" size={14} color={C.muted} strokeWidth={2.5} />
          </button>
        </div>
      )}
    </GlassCard>
  );
}

// ─── Savings ──────────────────────────────────────────────────
function Savings({ savings, onAdd, onUpdate, totalIncome, totalSpent }) {
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newTarget, setNewTarget] = useState("");
  const [roundupEnabled, setRoundupEnabled] = useState(false);
  const [roundupMultiplier, setRoundupMultiplier] = useState(1);

  const roundupMonth = totalSpent > 0 ? Math.floor(totalSpent * 0.03 * roundupMultiplier * 100) / 100 : 0;
  const roundupTotal = parseFloat((roundupMonth * 3.2).toFixed(2));
  const inp = { width: "100%", padding: "12px 14px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 12, color: C.text, fontSize: 14, outline: "none", boxSizing: "border-box", marginBottom: 10, fontFamily: FONT };
  const totalSaved = savings.reduce((s, sv) => s + Number(sv.current), 0);
  const monthlySurplus = totalIncome - totalSpent;

  function getGoalIcon(name) {
    const n = (name || "").toLowerCase();
    if (n.includes("vacat") || n.includes("trip")) return "target";
    if (n.includes("car") || n.includes("vehicle")) return "car";
    if (n.includes("house") || n.includes("home")) return "bank";
    if (n.includes("phone") || n.includes("tech")) return "phone";
    if (n.includes("emergency") || n.includes("fund")) return "lock";
    return "star";
  }

  function monthsToGoal(sv) {
    const remaining = Number(sv.target) - Number(sv.current);
    if (monthlySurplus <= 0 || remaining <= 0) return null;
    return Math.ceil(remaining / (monthlySurplus * 0.5));
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h2 style={{ margin: "0 0 2px", fontSize: 26, fontWeight: 700 }}>Savings Goals</h2>
          <div style={{ fontSize: 13, color: C.muted }}>Track your progress</div>
        </div>
        <button onClick={() => setShowAdd(!showAdd)} style={{ background: `linear-gradient(90deg,${C.cyan},${C.blue})`, border: "none", borderRadius: 12, padding: "9px 16px", color: "#fff", fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontSize: 14, fontFamily: FONT }}>
          <Icon name="plus" size={14} color="#fff" strokeWidth={2.5} /> Goal
        </button>
      </div>

      {(totalSaved > 0 || monthlySurplus > 0) && (
        <div style={{ background: "linear-gradient(135deg,#0D2A1F,#0B1426)", borderRadius: 20, padding: 20, border: `1px solid ${C.green}30` }}>
          <div style={{ display: "flex" }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 10, color: C.faint, fontWeight: 500, letterSpacing: 0.5, marginBottom: 4 }}>TOTAL SAVED</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: C.green }}>${fmt(totalSaved, 0)}</div>
            </div>
            <div style={{ flex: 1, paddingLeft: 20, borderLeft: `1px solid ${C.sep}` }}>
              <div style={{ fontSize: 10, color: C.faint, fontWeight: 500, letterSpacing: 0.5, marginBottom: 4 }}>MONTHLY SURPLUS</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: monthlySurplus >= 0 ? C.cyan : C.red }}>${fmt(Math.abs(monthlySurplus), 0)}</div>
            </div>
          </div>
        </div>
      )}

      <div style={{ background: "linear-gradient(135deg,#0D2233,#0B1426)", borderRadius: 20, padding: 20, border: `1px solid ${C.cyan}30`, position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: -20, right: -20, width: 100, height: 100, borderRadius: "50%", background: C.cyan + "0A", pointerEvents: "none" }} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: C.cyan + "22", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: `0 0 12px ${C.cyan}33` }}>
              <Icon name="zap" size={18} color={C.cyan} />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>Auto Round-up</div>
              <div style={{ fontSize: 12, color: C.muted, marginTop: 1 }}>Round purchases to nearest $1</div>
            </div>
          </div>
          <div onClick={() => setRoundupEnabled(v => !v)} style={{ width: 44, height: 26, borderRadius: 99, background: roundupEnabled ? C.cyan + "33" : C.bgTertiary, border: `1px solid ${roundupEnabled ? C.cyan + "66" : C.border}`, position: "relative", cursor: "pointer", transition: "all 0.2s", flexShrink: 0 }}>
            <div style={{ position: "absolute", top: 3, left: roundupEnabled ? 20 : 3, width: 18, height: 18, borderRadius: 99, background: roundupEnabled ? C.cyan : C.faint, transition: "left 0.2s" }} />
          </div>
        </div>
        <div style={{ display: "flex", gap: 0, marginBottom: 14 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, color: C.faint, fontWeight: 500, letterSpacing: 0.5, marginBottom: 3 }}>THIS MONTH</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: C.cyan }}>${fmt(roundupMonth, 2)}</div>
          </div>
          <div style={{ flex: 1, paddingLeft: 16, borderLeft: `1px solid ${C.sep}` }}>
            <div style={{ fontSize: 10, color: C.faint, fontWeight: 500, letterSpacing: 0.5, marginBottom: 3 }}>ALL TIME</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: C.green }}>${fmt(roundupTotal, 2)}</div>
          </div>
        </div>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 8 }}>Multiplier</div>
        <div style={{ display: "flex", gap: 6 }}>
          {[1, 2, 5, 10].map(m => (
            <button key={m} onClick={() => setRoundupMultiplier(m)} style={{ flex: 1, padding: "8px 0", borderRadius: 10, border: `1px solid ${roundupMultiplier === m ? C.cyan : C.border}`, background: roundupMultiplier === m ? C.cyan + "22" : "transparent", color: roundupMultiplier === m ? C.cyan : C.muted, cursor: "pointer", fontSize: 13, fontWeight: 700, fontFamily: FONT }}>{m}x</button>
          ))}
        </div>
        {roundupEnabled && (
          <div style={{ marginTop: 12, padding: "10px 14px", background: C.cyan + "10", borderRadius: 12, border: `1px solid ${C.cyan}20` }}>
            <div style={{ fontSize: 12, color: C.cyan, fontWeight: 500 }}>Active — rounding up every purchase {roundupMultiplier}x. Savings go to your top goal automatically.</div>
          </div>
        )}
      </div>

      {showAdd && (
        <GlassCard>
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 14 }}>New Savings Goal</div>
          <input style={inp} placeholder="Goal name (e.g. Vacation, Emergency Fund)" value={newName} onChange={e => setNewName(e.target.value)} />
          <input style={inp} type="number" placeholder="Target amount ($)" value={newTarget} onChange={e => setNewTarget(e.target.value)} />
          <button onClick={() => { if (!newName || !newTarget) return; onAdd({ name: newName, target: parseFloat(newTarget), current: 0, icon: "star", color: C.green }); setShowAdd(false); setNewName(""); setNewTarget(""); }}
            style={{ width: "100%", padding: 13, background: `linear-gradient(90deg,${C.green},#00A67E)`, border: "none", borderRadius: 12, color: C.bg, fontWeight: 700, cursor: "pointer", fontFamily: FONT }}>
            Create Goal
          </button>
        </GlassCard>
      )}

      {savings.length === 0 ? (
        <GlassCard style={{ textAlign: "center", padding: "40px 20px" }}>
          <div style={{ width: 56, height: 56, borderRadius: 18, background: C.bgTertiary, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}>
            <Icon name="target" size={24} color={C.faint} />
          </div>
          <div style={{ color: C.text, fontWeight: 600, fontSize: 16, marginBottom: 6 }}>No savings goals yet</div>
          <div style={{ color: C.muted, fontSize: 13 }}>Tap "+ Goal" to start tracking</div>
        </GlassCard>
      ) : savings.map(sv => {
        const pct = sv.target > 0 ? Math.min((Number(sv.current) / Number(sv.target)) * 100, 100) : 0;
        const goalColor = sv.color || C.green;
        const remaining = Math.max(Number(sv.target) - Number(sv.current), 0);
        const months = monthsToGoal(sv);
        return <SavingsGoalCard key={sv.id} sv={sv} pct={pct} goalColor={goalColor} remaining={remaining} months={months} onUpdate={onUpdate} getGoalIcon={getGoalIcon} />;
      })}
    </div>
  );
}

// ─── Chat ─────────────────────────────────────────────────────
function Chat({ messages, input, setInput, onSend }) {
  const bottomRef = useRef(null);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "72vh" }}>
      <div style={{ marginBottom: 14 }}>
        <h2 style={{ margin: "0 0 2px", fontSize: 26, fontWeight: 700 }}>AI Assistant</h2>
        <div style={{ fontSize: 12, color: C.faint, display: "flex", alignItems: "center", gap: 5 }}>
          <div style={{ width: 6, height: 6, borderRadius: 99, background: C.green }} />
          Powered by Claude · knows your finances
        </div>
      </div>
      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
        {messages.map((m, i) => (
          <div key={i} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", background: m.role === "user" ? `linear-gradient(90deg,${C.cyan},${C.blue})` : C.card, color: m.role === "user" ? "#fff" : C.text, padding: "12px 16px", borderRadius: m.role === "user" ? "18px 18px 4px 18px" : "18px 18px 18px 4px", maxWidth: "82%", fontSize: 14, border: m.role === "assistant" ? `1px solid ${C.border}` : "none", lineHeight: 1.65, fontWeight: m.role === "user" ? 500 : 400 }}>
            {m.loading
              ? <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                  {[0,1,2].map(j => <span key={j} style={{ width: 6, height: 6, borderRadius: "50%", background: C.muted, display: "inline-block", animation: `bop 1.2s ease-in-out ${j*0.2}s infinite` }} />)}
                  <style>{`@keyframes bop{0%,80%,100%{transform:translateY(0)}40%{transform:translateY(-6px)}}`}</style>
                </span>
              : m.text}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <div style={{ fontSize: 10, color: C.faint, textAlign: "center", marginBottom: 10, lineHeight: 1.5 }}>
        AI insights are for informational purposes only and should not be considered financial advice.
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && onSend()} placeholder="Ask about your finances..." style={{ flex: 1, padding: "13px 16px", background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, color: C.text, fontSize: 14, outline: "none", fontFamily: FONT }} />
        <button onClick={onSend} style={{ padding: "13px 18px", background: `linear-gradient(90deg,${C.cyan},${C.blue})`, border: "none", borderRadius: 14, cursor: "pointer", display: "flex", alignItems: "center" }}>
          <Icon name="send" size={16} color="#fff" strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}

// ─── Profile / Settings ───────────────────────────────────────
function Profile({ profile, user, onSave, autopilot, setAutopilot }) {
  const [budget, setBudget] = useState(profile?.monthly_budget || 3000);
  const [goal, setGoal] = useState(profile?.savings_goal || 10000);
  const [saved, setSaved] = useState(false);
  const inp = { width: "100%", padding: "13px 14px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 12, color: C.text, fontSize: 15, outline: "none", boxSizing: "border-box", fontFamily: FONT };

  function Toggle({ value, onChange }) {
    return (
      <div onClick={() => onChange(!value)} style={{ width: 44, height: 26, borderRadius: 99, background: value ? C.cyan + "33" : C.bgTertiary, border: `1px solid ${value ? C.cyan + "66" : C.border}`, position: "relative", cursor: "pointer", transition: "all 0.2s", flexShrink: 0 }}>
        <div style={{ position: "absolute", top: 3, left: value ? 20 : 3, width: 18, height: 18, borderRadius: 99, background: value ? C.cyan : C.faint, transition: "left 0.2s" }} />
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <h2 style={{ margin: 0, fontSize: 26, fontWeight: 700 }}>Settings</h2>

      <GlassCard>
        <div style={{ color: C.faint, fontSize: 10, letterSpacing: 1.2, fontWeight: 600, marginBottom: 8 }}>ACCOUNT</div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 42, height: 42, borderRadius: 14, background: C.cyan + "22", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name="dollar" size={18} color={C.cyan} />
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{profile?.full_name || "User"}</div>
            <div style={{ color: C.muted, fontSize: 13 }}>{user.email}</div>
          </div>
        </div>
      </GlassCard>

      <GlassCard>
        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 16 }}>Financial Settings</div>
        <div style={{ color: C.muted, fontSize: 12, fontWeight: 500, marginBottom: 6 }}>Monthly Budget ($)</div>
        <input style={{ ...inp, marginBottom: 14 }} type="number" value={budget} onChange={e => setBudget(e.target.value)} />
        <div style={{ color: C.muted, fontSize: 12, fontWeight: 500, marginBottom: 6 }}>Annual Savings Goal ($)</div>
        <input style={{ ...inp, marginBottom: 18 }} type="number" value={goal} onChange={e => setGoal(e.target.value)} />
        <button onClick={async () => { await onSave({ monthly_budget: parseFloat(budget), savings_goal: parseFloat(goal) }); setSaved(true); setTimeout(() => setSaved(false), 2000); }}
          style={{ width: "100%", padding: 14, background: saved ? C.green : `linear-gradient(90deg,${C.cyan},${C.blue})`, border: "none", borderRadius: 12, color: saved ? C.bg : "#fff", fontWeight: 700, cursor: "pointer", transition: "background 0.3s", fontFamily: FONT }}>
          {saved ? "Saved!" : "Save Settings"}
        </button>
      </GlassCard>

      <GlassCard>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 15 }}>Autopilot</div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>Smart alerts & rules</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, background: C.green + "18", border: `1px solid ${C.green}33`, borderRadius: 100, padding: "4px 12px" }}>
            <div style={{ width: 6, height: 6, borderRadius: 99, background: C.green }} />
            <span style={{ fontSize: 11, color: C.green, fontWeight: 600 }}>Active</span>
          </div>
        </div>
        {[
          { key: "overspendAlerts", icon: "bell", color: C.yellow, title: "Overspending Alerts", sub: "Alert when category exceeds budget" },
          { key: "largeTxAlerts", icon: "alert-circle", color: C.red, title: "Large Transactions", sub: `Alert for purchases over $${autopilot.largeTxThreshold}` },
          { key: "unusualSpending", icon: "activity", color: C.cyan, title: "Unusual Spending", sub: "Alert when category up 25%+ vs last month" },
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

      <GlassCard style={{ border: `1px solid ${C.yellow}22` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <Icon name="info" size={15} color={C.yellow} />
          <span style={{ fontWeight: 600, fontSize: 14, color: C.yellow }}>Legal & Disclosures</span>
        </div>
        <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.7 }}>
          Investment accounts and brokerage services are provided by <span style={{ color: C.text, fontWeight: 500 }}>Alpaca Securities LLC</span>, a registered broker-dealer and member of FINRA and SIPC. Arkonomy is not a broker-dealer and does not provide investment advice.
        </div>
        <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.7, marginTop: 10 }}>
          AI insights are for informational purposes only and should not be considered financial advice.
        </div>
      </GlassCard>

      <GlassCard>
        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 14 }}>Coming Next</div>
        {[
          { label: "Connect Bank (Plaid)", color: "#1A56DB", icon: "bank" },
          { label: "Auto-Invest (Alpaca)", color: "#059669", icon: "activity" },
          { label: "Subscription Tracker", color: "#7C3AED", icon: "repeat" },
          { label: "Mobile App", color: "#0891B2", icon: "phone" },
        ].map((item, i, arr) => (
          <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 14, padding: "11px 0", borderBottom: i < arr.length - 1 ? `1px solid ${C.sep}` : "none" }}>
            <div style={{ width: 38, height: 38, borderRadius: 12, background: item.color + "22", border: `1px solid ${item.color}33`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Icon name={item.icon} size={17} color={item.color} />
            </div>
            <span style={{ color: C.muted, fontSize: 14, flex: 1 }}>{item.label}</span>
            <Icon name="chevron" size={16} color={C.faint} />
          </div>
        ))}
      </GlassCard>
    </div>
  );
}

// ─── Bottom Nav ───────────────────────────────────────────────
function BottomNav({ screen, setScreen }) {
  const tabs = [
    { id: "dashboard", label: "Home", icon: "home" },
    { id: "transactions", label: "Transactions", icon: "credit" },
    { id: "savings", label: "Savings", icon: "target" },
    { id: "insights", label: "Insights", icon: "activity" },
    { id: "chat", label: "AI", icon: "message" },
  ];
  return (
    <div style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 430, background: "rgba(11,20,38,0.97)", backdropFilter: "blur(24px)", borderTop: `1px solid ${C.sep}`, display: "flex", padding: "10px 0 20px", zIndex: 50 }}>
      {tabs.map(tab => {
        const active = screen === tab.id;
        const isAI = tab.id === "chat";
        return (
          <button key={tab.id} onClick={() => setScreen(tab.id)} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, background: "none", border: "none", cursor: "pointer", padding: "4px 0" }}>
            <Icon name={tab.icon} size={22} color={active ? (isAI ? C.cyan : C.blue) : C.faint} strokeWidth={active ? 2.2 : 1.8} />
            <span style={{ fontSize: 10, color: active ? (isAI ? C.cyan : C.blue) : C.faint, fontWeight: active ? 700 : 400, fontFamily: FONT }}>{tab.label}</span>
            {active && <div style={{ width: 4, height: 4, borderRadius: 99, background: isAI ? C.cyan : C.blue, boxShadow: `0 0 6px ${isAI ? C.cyan : C.blue}` }} />}
          </button>
        );
      })}
    </div>
  );
}
