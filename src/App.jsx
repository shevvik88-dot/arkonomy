import { useState, useEffect, useRef } from "react";
import { createClient } from "@supabase/supabase-js";

// ─── Google Fonts: Inter ──────────────────────────────────────
const fontLink = document.createElement("link");
fontLink.rel = "stylesheet";
fontLink.href = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap";
document.head.appendChild(fontLink);

const FONT = "'Inter', -apple-system, BlinkMacSystemFont, sans-serif";

const SUPABASE_URL = "https://hvnkxxazjfesbxdkzuba.supabase.co";
const SUPABASE_KEY = "sb_publishable_z4Mh9KZLXS_6ZZJyJ-pE7A_ClkhUDt9";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const C = {
  bg: "#080C16", bgSecondary: "#0F1629", bgTertiary: "#161D35",
  card: "#111827", border: "#1E2D4A", sep: "#1A2540",
  cyan: "#00D4FF", green: "#00E5A0", red: "#FF4C6B", yellow: "#FFB800",
  text: "#FFFFFF", muted: "#8A9BB8", faint: "#4A5E7A",
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

// ─── SVG Icon Library (Feather-style, consistent stroke) ──────
function Icon({ name, size = 20, color = C.muted, strokeWidth = 1.8 }) {
  const s = size;
  const sw = strokeWidth;
  const props = { width: s, height: s, viewBox: "0 0 24 24", fill: "none", stroke: color, strokeWidth: sw, strokeLinecap: "round", strokeLinejoin: "round" };
  const icons = {
    home:        <svg {...props}><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,
    credit:      <svg {...props}><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>,
    target:      <svg {...props}><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>,
    activity:    <svg {...props}><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>,
    message:     <svg {...props}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>,
    settings:    <svg {...props}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
    "trending-up":   <svg {...props}><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>,
    "trending-down": <svg {...props}><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/></svg>,
    eye:         <svg {...props}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>,
    "eye-off":   <svg {...props}><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>,
    bell:        <svg {...props}><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>,
    "check-circle": <svg {...props}><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>,
    "alert-circle": <svg {...props}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>,
    zap:         <svg {...props}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>,
    dollar:      <svg {...props}><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>,
    food:        <svg {...props}><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg>,
    car:         <svg {...props}><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>,
    shopping:    <svg {...props}><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>,
    film:        <svg {...props}><rect x="2" y="2" width="20" height="20" rx="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/></svg>,
    heart:       <svg {...props}><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>,
    file:        <svg {...props}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>,
    repeat:      <svg {...props}><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>,
    bank:        <svg {...props}><line x1="3" y1="22" x2="21" y2="22"/><line x1="6" y1="18" x2="6" y2="11"/><line x1="10" y1="18" x2="10" y2="11"/><line x1="14" y1="18" x2="14" y2="11"/><line x1="18" y1="18" x2="18" y2="11"/><polygon points="12 2 20 7 4 7"/></svg>,
    phone:       <svg {...props}><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>,
    send:        <svg {...props}><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>,
    plus:        <svg {...props}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
    x:           <svg {...props}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
    chevron:     <svg {...props}><polyline points="9 18 15 12 9 6"/></svg>,
    lock:        <svg {...props}><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>,
    "pie-chart": <svg {...props}><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/></svg>,
    star:        <svg {...props}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>,
    info:        <svg {...props}><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>,
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
function StatBadge({ value }) {
  const pos = value >= 0;
  const color = pos ? C.green : C.red;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 3, background: color + "22", color, borderRadius: 100, padding: "2px 8px", fontSize: 11, fontWeight: 600, fontFamily: FONT }}>
      <Icon name={pos ? "trending-up" : "trending-down"} size={10} color={color} strokeWidth={2.5} />
      {Math.abs(value).toFixed(1)}%
    </span>
  );
}

// ─── Donut Chart ──────────────────────────────────────────────
function DonutChart({ data, size = 200 }) {
  const cx = size / 2, cy = size / 2;
  const outerR = size / 2 - 10;
  const innerR = outerR - 34;
  const mid = (outerR + innerR) / 2;
  const sw = 34;

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
  const slices = entries.map(([cat, val]) => {
    const sweep = (val / total) * 360;
    const sl = { cat, val, start: angle, end: angle + sweep, color: CAT_COLORS[cat] || "#94A3B8" };
    angle += sweep;
    return sl;
  });

  const gap = slices.length > 1 ? 3 : 0;
  const topCats = slices.slice(0, 4);

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18, fontFamily: FONT }}>
      <div style={{ position: "relative", width: size, height: size }}>
        <svg width={size} height={size} style={{ display: "block" }}>
          <circle cx={cx} cy={cy} r={mid} fill="none" stroke={C.bgTertiary} strokeWidth={sw} />
          {slices.map((s, i) => {
            const startAdj = s.start + (i === 0 ? 0 : gap / 2);
            const endAdj = s.end - (i === slices.length - 1 ? 0 : gap / 2);
            if (endAdj - startAdj < 0.5) return null;
            if (endAdj - startAdj >= 359.5) {
              return <circle key={i} cx={cx} cy={cy} r={mid} fill="none" stroke={s.color} strokeWidth={sw} />;
            }
            return (
              <path key={i} d={arcPath(startAdj, endAdj)} stroke={s.color} strokeWidth={sw} fill="none" strokeLinecap="round"
                style={{ filter: `drop-shadow(0 0 8px ${s.color}55)` }} />
            );
          })}
        </svg>
        <div style={{ position: "absolute", left: cx - innerR, top: cy - innerR, width: innerR * 2, height: innerR * 2, borderRadius: "50%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: C.bg }}>
          <div style={{ fontSize: 10, color: C.faint, letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 3, fontWeight: 500 }}>Total</div>
          <div style={{ fontSize: 19, fontWeight: 700, color: C.text, letterSpacing: -0.5 }}>${fmt(total, 0)}</div>
        </div>
      </div>
      <div style={{ width: "100%", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 16px" }}>
        {topCats.map(s => (
          <div key={s.cat} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 10, height: 10, borderRadius: 99, background: s.color, flexShrink: 0 }} />
            <span style={{ fontSize: 12, color: C.muted, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.cat}</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{Math.round((s.val / total) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
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
          <div style={{ fontSize: 22, fontWeight: 300, color: C.cyan, letterSpacing: 8, marginBottom: 6 }}>ARKONOMY</div>
          <div style={{ color: C.faint, fontSize: 11, letterSpacing: 3 }}>YOUR MONEY ON AUTOPILOT</div>
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
          <button onClick={handleSubmit} disabled={loading} style={{ width: "100%", marginTop: 20, padding: 15, background: `linear-gradient(90deg,${C.cyan},#0099BB)`, border: "none", borderRadius: 12, color: C.bg, fontWeight: 700, fontSize: 15, cursor: "pointer", opacity: loading ? 0.7 : 1, fontFamily: FONT }}>
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

  if (loading && !user) return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT }}>
      <div style={{ color: C.cyan, fontSize: 16, fontWeight: 500 }}>Loading Arkonomy...</div>
    </div>
  );

  if (!user) return <AuthScreen onAuth={setUser} />;

  const shared = { transactions, categories, savings, profile, totalSpent, totalIncome, lastSpent, lastIncome, spendingByCategory, prevSpendingByCategory };

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: FONT, maxWidth: 430, margin: "0 auto", position: "relative" }}>
      {/* Header */}
      <div style={{ padding: "14px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", position: "sticky", top: 0, background: "rgba(8,12,22,0.95)", backdropFilter: "blur(20px)", zIndex: 40, borderBottom: `1px solid ${C.sep}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <img src="https://i.postimg.cc/k4tv1XgB/Remove-the-dark-background-completely-make-it-tran-delpmaspu-removebg-preview.png" alt="Arkonomy" style={{ width: 72, height: 36, objectFit: "contain" }} />
          <div style={{ color: C.muted, fontSize: 13, fontWeight: 500 }}>{profile?.full_name || user.email?.split("@")[0]}</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button onClick={() => setScreen("profile")} style={{ background: screen === "profile" ? C.cyan + "18" : C.bgSecondary, border: `1px solid ${screen === "profile" ? C.cyan + "44" : C.border}`, borderRadius: 10, width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <Icon name="settings" size={16} color={screen === "profile" ? C.cyan : C.muted} />
          </button>
          <button onClick={signOut} style={{ background: C.bgSecondary, border: `1px solid ${C.border}`, borderRadius: 10, padding: "7px 13px", color: C.muted, cursor: "pointer", fontSize: 13, fontFamily: FONT, fontWeight: 500 }}>Sign out</button>
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: "16px 16px 110px" }}>
        {loading ? (
          <div style={{ color: C.muted, textAlign: "center", padding: 40 }}>Loading your data...</div>
        ) : (
          <>
            {screen === "dashboard" && <Dashboard {...shared} />}
            {screen === "transactions" && <Transactions transactions={transactions} categories={categories} onAdd={() => setShowAddTx(true)} onDelete={deleteTransaction} />}
            {screen === "savings" && <Savings savings={savings} onAdd={addSaving} onUpdate={updateSaving} totalIncome={totalIncome} totalSpent={totalSpent} />}
            {screen === "insights" && <Insights {...shared} onNavigateChat={(msg) => { setChatMessages(prev => [...prev, { role: "user", text: msg }]); setScreen("chat"); }} />}
            {screen === "chat" && <Chat messages={chatMessages} input={chatInput} setInput={setChatInput} onSend={async () => {
              if (!chatInput.trim()) return;
              const userMsg = { role: "user", text: chatInput };
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
            }} />}
            {screen === "profile" && <Profile profile={profile} user={user} onSave={saveProfile} autopilot={autopilot} setAutopilot={setAutopilot} />}
          </>
        )}
      </div>

      {showAddTx && <AddTransactionModal categories={categories} onAdd={addTransaction} onClose={() => setShowAddTx(false)} />}
      <BottomNav screen={screen} setScreen={setScreen} />
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────
function Dashboard({ totalSpent, totalIncome, lastSpent, lastIncome, transactions, spendingByCategory, profile }) {
  const [balanceVisible, setBalanceVisible] = useState(true);
  const budget = Number(profile?.monthly_budget) || 3000;
  const balance = totalIncome - totalSpent;
  const pct = Math.min((totalSpent / budget) * 100, 100);
  const incomeChange = lastIncome > 0 ? ((totalIncome - lastIncome) / lastIncome) * 100 : 0;
  const expenseChange = lastSpent > 0 ? ((totalSpent - lastSpent) / lastSpent) * 100 : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Balance Card */}
      <div style={{ background: "linear-gradient(145deg,#0D1F3C,#080C16)", borderRadius: 24, padding: "22px 22px 20px", border: `1px solid #1E2D4A`, position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: -40, right: -40, width: 140, height: 140, borderRadius: "50%", background: C.cyan + "10", pointerEvents: "none" }} />
        <div style={{ position: "absolute", bottom: -20, left: 40, width: 80, height: 80, borderRadius: "50%", background: C.green + "08", pointerEvents: "none" }} />

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <span style={{ fontSize: 12, color: C.muted, letterSpacing: 0.5, fontWeight: 500 }}>Total Balance</span>
          <button onClick={() => setBalanceVisible(v => !v)} style={{ background: "none", border: "none", cursor: "pointer", padding: "2px 4px", display: "flex", alignItems: "center" }}>
            <Icon name={balanceVisible ? "eye" : "eye-off"} size={16} color={C.faint} />
          </button>
        </div>

        <div style={{ fontSize: 38, fontWeight: 800, letterSpacing: -1.5, color: C.text, marginBottom: 18, lineHeight: 1.1 }}>
          {balanceVisible ? `$${fmt(balance)}` : "••••••"}
        </div>

        <div style={{ height: 1, background: "rgba(255,255,255,0.05)", marginBottom: 16 }} />

        <div style={{ display: "flex" }}>
          {[
            { label: "Income", value: `$${fmt(totalIncome)}`, dot: C.green, change: incomeChange },
            { label: "Expenses", value: `$${fmt(totalSpent)}`, dot: C.red, change: -expenseChange },
            { label: "Savings", value: `$${fmt(totalIncome - totalSpent, 0)}`, dot: C.cyan },
          ].map((item, i) => (
            <div key={item.label} style={{ flex: 1, paddingLeft: i > 0 ? 14 : 0, borderLeft: i > 0 ? `1px solid ${C.sep}` : "none", marginLeft: i > 0 ? 14 : 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 4 }}>
                <div style={{ width: 6, height: 6, borderRadius: 99, background: item.dot }} />
                <span style={{ fontSize: 10, color: C.muted, fontWeight: 500, letterSpacing: 0.3 }}>{item.label}</span>
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 5 }}>{item.value}</div>
              {item.change !== undefined && <StatBadge value={item.change} />}
            </div>
          ))}
        </div>
      </div>

      {/* Budget bar */}
      <GlassCard>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10, alignItems: "center" }}>
          <span style={{ fontWeight: 600, fontSize: 15 }}>Monthly Budget</span>
          <span style={{ color: pct > 90 ? C.red : pct > 70 ? C.yellow : C.muted, fontSize: 13, fontWeight: 700 }}>{pct.toFixed(0)}%</span>
        </div>
        <div style={{ height: 8, background: C.bgTertiary, borderRadius: 99 }}>
          <div style={{ height: 8, borderRadius: 99, width: `${pct}%`, background: pct > 90 ? C.red : pct > 70 ? C.yellow : `linear-gradient(90deg,${C.cyan},#0099BB)`, transition: "width 0.5s", boxShadow: pct <= 70 ? `0 0 10px ${C.cyan}44` : "none" }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
          <span style={{ color: C.muted, fontSize: 12 }}>${fmt(Math.max(budget - totalSpent, 0))} remaining</span>
          <span style={{ color: C.muted, fontSize: 12 }}>${fmt(budget, 0)}</span>
        </div>
      </GlassCard>

      {/* Donut Chart */}
      <GlassCard>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <span style={{ fontWeight: 600, fontSize: 15 }}>Spending by Category</span>
          <span style={{ fontSize: 12, color: C.faint }}>This month</span>
        </div>
        <DonutChart data={spendingByCategory} size={200} />
      </GlassCard>

      {/* Recent Transactions */}
      <GlassCard>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <span style={{ fontWeight: 600, fontSize: 15 }}>Recent Transactions</span>
        </div>
        {transactions.length === 0
          ? <div style={{ color: C.muted, textAlign: "center", padding: "20px 0", fontSize: 14 }}>No transactions yet</div>
          : transactions.slice(0, 6).map((t, i, arr) => (
              <div key={t.id}>
                <TxRow t={t} />
                {i < Math.min(arr.length, 6) - 1 && <div style={{ height: 1, background: C.sep }} />}
              </div>
            ))
        }
      </GlassCard>
    </div>
  );
}

// ─── Insights ─────────────────────────────────────────────────
function Insights({ totalSpent, totalIncome, spendingByCategory, prevSpendingByCategory, onNavigateChat }) {
  const monthlySavings = totalIncome - totalSpent;
  const savingsRate = totalIncome > 0 ? (monthlySavings / totalIncome) * 100 : 0;
  const insights = [];

  Object.entries(spendingByCategory).forEach(([cat, amount]) => {
    const prev = prevSpendingByCategory[cat] || 0;
    if (prev > 0) {
      const change = ((amount - prev) / prev) * 100;
      if (change > 25) insights.push({ id: `u-${cat}`, icon: "trending-up", title: `${cat} up ${change.toFixed(0)}%`, desc: `$${fmt(amount, 0)} this month vs $${fmt(prev, 0)} last month.`, severity: change > 50 ? "danger" : "warning", value: `+${change.toFixed(0)}%`, context: `My ${cat} spending is ${change.toFixed(0)}% higher than last month. What's driving this?` });
    }
  });

  if (savingsRate < 10 && totalIncome > 0) insights.push({ id: "savings-low", icon: "target", title: "Low Savings Rate", desc: `Saving ${savingsRate.toFixed(1)}% of income. Aim for 20%.`, severity: "warning", value: `${savingsRate.toFixed(1)}%`, context: `My savings rate is ${savingsRate.toFixed(1)}%. How can I reach 20%?` });
  else if (savingsRate >= 20) insights.push({ id: "savings-good", icon: "star", title: "Great Savings Rate!", desc: `Saving ${savingsRate.toFixed(1)}% — above the 20% target.`, severity: "good", value: `${savingsRate.toFixed(1)}%`, context: `My savings rate is ${savingsRate.toFixed(1)}%. How should I invest this?` });

  const shopping = spendingByCategory["Shopping"] || 0;
  if (shopping > 300) insights.push({ id: "shopping", icon: "shopping", title: "High Shopping Spend", desc: `$${fmt(shopping, 0)} on shopping. Consider a 30-day rule.`, severity: "info", value: `$${fmt(shopping, 0)}`, context: `I spent $${fmt(shopping, 0)} on shopping. Help me reduce impulse purchases.` });

  if (insights.length === 0) insights.push({ id: "all-good", icon: "check-circle", title: "You're on track!", desc: "Your spending looks healthy this month.", severity: "good", context: "My finances look healthy. What should I focus on to build wealth?" });

  const colors = { info: C.cyan, warning: C.yellow, danger: C.red, good: C.green };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ marginBottom: 4 }}>
        <h2 style={{ margin: "0 0 4px", fontSize: 26, fontWeight: 700 }}>Insights</h2>
        <div style={{ fontSize: 13, color: C.muted }}>AI-powered analysis</div>
      </div>

      {insights.map(ins => {
        const color = colors[ins.severity];
        return (
          <GlassCard key={ins.id}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ width: 44, height: 44, borderRadius: 14, background: color + "22", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Icon name={ins.icon} size={20} color={color} />
              </div>
              {ins.value && <span style={{ background: color + "22", color, borderRadius: 100, padding: "4px 12px", fontSize: 13, fontWeight: 700 }}>{ins.value}</span>}
            </div>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 5 }}>{ins.title}</div>
            <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.65, marginBottom: 12 }}>{ins.desc}</div>
            <button onClick={() => onNavigateChat(ins.context)} style={{ background: "none", border: "none", cursor: "pointer", color, fontSize: 13, fontWeight: 600, padding: 0, display: "flex", alignItems: "center", gap: 6, fontFamily: FONT }}>
              <Icon name="message" size={13} color={color} />
              Ask AI about this
              <Icon name="chevron" size={13} color={color} />
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
          Auto-invest your monthly surplus and let compound interest work for you. Even $50/month grows to $30,000+ in 20 years.
        </div>
      </GlassCard>
    </div>
  );
}

// ─── Category Icon ────────────────────────────────────────────
function CatIcon({ name, type, size = 20 }) {
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
    <div style={{ width: 40, height: 40, borderRadius: 12, background: color, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
      <Icon name={icon} size={size} color="#fff" strokeWidth={2} />
    </div>
  );
}

// ─── TxRow ────────────────────────────────────────────────────
function TxRow({ t, onDelete }) {
  const isExp = t.type === "expense";
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0" }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", minWidth: 0 }}>
        <CatIcon name={t.category_name} type={t.type} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.description || t.category_name || "Transaction"}</div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{t.category_name || "Other"} · {t.date}</div>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, marginLeft: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: isExp ? C.red : C.green, letterSpacing: -0.3 }}>
          {isExp ? "−" : "+"}${fmt(t.amount)}
        </span>
        {onDelete && (
          <button onClick={() => onDelete(t.id)} style={{ background: "none", border: "none", cursor: "pointer", padding: "2px", display: "flex", alignItems: "center", opacity: 0.5 }}>
            <Icon name="x" size={14} color={C.muted} strokeWidth={2.5} />
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Transactions ─────────────────────────────────────────────
function Transactions({ transactions, categories, onAdd, onDelete }) {
  const [filter, setFilter] = useState("all");
  const filtered = filter === "all" ? transactions : transactions.filter(t => t.type === filter);
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 26, fontWeight: 700 }}>Transactions</h2>
        <button onClick={onAdd} style={{ background: `linear-gradient(90deg,${C.cyan},#0099BB)`, border: "none", borderRadius: 12, padding: "9px 16px", color: C.bg, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontSize: 14, fontFamily: FONT }}>
          <Icon name="plus" size={14} color={C.bg} strokeWidth={2.5} /> Add
        </button>
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {["all", "expense", "income"].map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{ padding: "7px 16px", borderRadius: 20, border: `1px solid ${filter === f ? C.cyan : C.border}`, background: filter === f ? C.cyan + "18" : C.card, color: filter === f ? C.cyan : C.muted, cursor: "pointer", fontSize: 13, textTransform: "capitalize", fontFamily: FONT, fontWeight: filter === f ? 600 : 400 }}>{f}</button>
        ))}
      </div>
      <GlassCard style={{ padding: "0 16px" }}>
        {filtered.length === 0
          ? <div style={{ color: C.muted, textAlign: "center", padding: "30px 0", fontSize: 14 }}>No transactions</div>
          : filtered.map((t, i, arr) => (
              <div key={t.id}>
                <TxRow t={t} onDelete={onDelete} />
                {i < arr.length - 1 && <div style={{ height: 1, background: C.sep }} />}
              </div>
            ))
        }
      </GlassCard>
    </div>
  );
}

// ─── Add Transaction Modal ────────────────────────────────────
function AddTransactionModal({ categories, onAdd, onClose }) {
  const [amount, setAmount] = useState("");
  const [desc, setDesc] = useState("");
  const [catId, setCatId] = useState("");
  const [catName, setCatName] = useState("");
  const [type, setType] = useState("expense");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [showCats, setShowCats] = useState(false);
  const inp = { width: "100%", padding: "13px 14px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 12, color: C.text, fontSize: 15, outline: "none", boxSizing: "border-box", fontFamily: FONT };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "flex-end", zIndex: 100, maxWidth: 430, margin: "0 auto" }}>
      <div style={{ background: C.card, width: "100%", borderRadius: "24px 24px 0 0", padding: 24, border: `1px solid ${C.border}`, maxHeight: "90vh", overflowY: "auto", fontFamily: FONT }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Add Transaction</h3>
          <button onClick={onClose} style={{ background: C.bgSecondary, border: `1px solid ${C.border}`, borderRadius: 99, color: C.muted, cursor: "pointer", width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name="x" size={14} color={C.muted} strokeWidth={2.5} />
          </button>
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          {["expense", "income"].map(t => (
            <button key={t} onClick={() => setType(t)} style={{ flex: 1, padding: 11, borderRadius: 12, border: `1px solid ${type === t ? (t === "expense" ? C.red : C.green) : C.border}`, background: type === t ? (t === "expense" ? C.red + "18" : C.green + "18") : "transparent", color: type === t ? (t === "expense" ? C.red : C.green) : C.muted, cursor: "pointer", fontWeight: 600, textTransform: "capitalize", fontFamily: FONT }}>{t}</button>
          ))}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <input style={inp} type="number" placeholder="Amount ($)" value={amount} onChange={e => setAmount(e.target.value)} />
          <input style={inp} placeholder="Description (optional)" value={desc} onChange={e => setDesc(e.target.value)} />
          <div>
            <button onClick={() => setShowCats(!showCats)} style={{ ...inp, display: "flex", alignItems: "center", gap: 12, cursor: "pointer", textAlign: "left" }}>
              {catId ? <><CatIcon name={catName} type={type} size={16} /><span style={{ color: C.text }}>{catName}</span></> : <span style={{ color: C.muted }}>Select category</span>}
            </button>
            {showCats && (
              <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 12, marginTop: 4, overflow: "hidden" }}>
                {categories.map(c => (
                  <div key={c.id} onClick={() => { setCatId(c.id); setCatName(c.name); setShowCats(false); }} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", cursor: "pointer", background: catId === c.id ? C.cyan + "10" : "transparent", borderBottom: `1px solid ${C.sep}` }}>
                    <CatIcon name={c.name} type={type} size={16} />
                    <span style={{ color: C.text, fontSize: 14 }}>{c.name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <input style={inp} type="date" value={date} onChange={e => setDate(e.target.value)} />
        </div>
        <button onClick={() => { if (!amount) return; onAdd({ amount: parseFloat(amount), description: desc || catName, category_id: catId || null, category_name: catName, date, type }); }}
          style={{ width: "100%", marginTop: 18, padding: 15, background: `linear-gradient(90deg,${C.cyan},#0099BB)`, border: "none", borderRadius: 14, color: C.bg, fontWeight: 700, fontSize: 15, cursor: "pointer", fontFamily: FONT }}>
          Add Transaction
        </button>
      </div>
    </div>
  );
}

// ─── Savings ──────────────────────────────────────────────────
function Savings({ savings, onAdd, onUpdate, totalIncome, totalSpent }) {
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newTarget, setNewTarget] = useState("");
  const inp = { width: "100%", padding: "12px 14px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 12, color: C.text, fontSize: 14, outline: "none", boxSizing: "border-box", marginBottom: 10, fontFamily: FONT };

  const totalSaved = savings.reduce((s, sv) => s + Number(sv.current), 0);
  const monthlySurplus = totalIncome - totalSpent;

  const GOAL_ICONS = {
    vacation: "target", car: "car", house: "bank", phone: "phone",
    emergency: "lock", investment: "activity", default: "star",
  };

  function getGoalIcon(name) {
    const n = (name || "").toLowerCase();
    if (n.includes("vacat") || n.includes("trip")) return "target";
    if (n.includes("car") || n.includes("vehicle")) return "car";
    if (n.includes("house") || n.includes("home")) return "bank";
    if (n.includes("phone") || n.includes("tech")) return "phone";
    if (n.includes("emergency") || n.includes("fund")) return "lock";
    return "star";
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h2 style={{ margin: "0 0 2px", fontSize: 26, fontWeight: 700 }}>Savings Goals</h2>
          <div style={{ fontSize: 13, color: C.muted }}>Track your progress</div>
        </div>
        <button onClick={() => setShowAdd(!showAdd)} style={{ background: `linear-gradient(90deg,${C.cyan},#0099BB)`, border: "none", borderRadius: 12, padding: "9px 16px", color: C.bg, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontSize: 14, fontFamily: FONT }}>
          <Icon name="plus" size={14} color={C.bg} strokeWidth={2.5} /> Goal
        </button>
      </div>

      {/* Summary card */}
      {(totalSaved > 0 || monthlySurplus > 0) && (
        <div style={{ background: "linear-gradient(135deg,#0D2A1F,#080C16)", borderRadius: 20, padding: 20, border: `1px solid ${C.green}30` }}>
          <div style={{ display: "flex", gap: 0 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 10, color: C.faint, fontWeight: 500, letterSpacing: 0.5, marginBottom: 4 }}>TOTAL SAVED</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: C.green, letterSpacing: -0.5 }}>${fmt(totalSaved, 0)}</div>
            </div>
            <div style={{ width: 1, background: C.sep, marginHorizontal: 16 }} />
            <div style={{ flex: 1, paddingLeft: 20, borderLeft: `1px solid ${C.sep}` }}>
              <div style={{ fontSize: 10, color: C.faint, fontWeight: 500, letterSpacing: 0.5, marginBottom: 4 }}>MONTHLY SURPLUS</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: monthlySurplus >= 0 ? C.cyan : C.red, letterSpacing: -0.5 }}>${fmt(Math.abs(monthlySurplus), 0)}</div>
            </div>
          </div>
        </div>
      )}

      {/* Add Goal Form */}
      {showAdd && (
        <GlassCard>
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 14 }}>New Savings Goal</div>
          <input style={inp} placeholder="Goal name (e.g. Vacation)" value={newName} onChange={e => setNewName(e.target.value)} />
          <input style={inp} type="number" placeholder="Target amount ($)" value={newTarget} onChange={e => setNewTarget(e.target.value)} />
          <button onClick={() => { if (!newName || !newTarget) return; onAdd({ name: newName, target: parseFloat(newTarget), current: 0, icon: "star", color: C.green }); setShowAdd(false); setNewName(""); setNewTarget(""); }}
            style={{ width: "100%", padding: 13, background: `linear-gradient(90deg,${C.green},#00A67E)`, border: "none", borderRadius: 12, color: C.bg, fontWeight: 700, cursor: "pointer", fontFamily: FONT }}>
            Create Goal
          </button>
        </GlassCard>
      )}

      {savings.length === 0
        ? (
          <GlassCard style={{ textAlign: "center", padding: "40px 20px" }}>
            <div style={{ width: 56, height: 56, borderRadius: 18, background: C.bgTertiary, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}>
              <Icon name="target" size={24} color={C.faint} />
            </div>
            <div style={{ color: C.text, fontWeight: 600, fontSize: 16, marginBottom: 6 }}>No savings goals yet</div>
            <div style={{ color: C.muted, fontSize: 13 }}>Create a goal to start tracking your progress</div>
          </GlassCard>
        )
        : savings.map(sv => {
          const pct = sv.target > 0 ? Math.min((Number(sv.current) / Number(sv.target)) * 100, 100) : 0;
          const goalColor = sv.color || C.green;
          const remaining = Math.max(Number(sv.target) - Number(sv.current), 0);
          const iconName = getGoalIcon(sv.name);

          return (
            <GlassCard key={sv.id}>
              {/* Header */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <div style={{ width: 44, height: 44, borderRadius: 14, background: goalColor + "22", border: `1px solid ${goalColor}44`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Icon name={iconName} size={20} color={goalColor} />
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 15 }}>{sv.name}</div>
                    <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>${fmt(remaining, 0)} remaining</div>
                  </div>
                </div>
                <div style={{ background: goalColor + "22", borderRadius: 100, padding: "4px 10px" }}>
                  <span style={{ color: goalColor, fontWeight: 700, fontSize: 13 }}>{pct.toFixed(0)}%</span>
                </div>
              </div>

              {/* Progress bar */}
              <div style={{ height: 10, background: C.bgTertiary, borderRadius: 99, marginBottom: 10, overflow: "hidden" }}>
                <div style={{ height: 10, borderRadius: 99, width: `${pct}%`, background: `linear-gradient(90deg,${goalColor},${goalColor}BB)`, transition: "width 0.5s", boxShadow: `0 0 10px ${goalColor}55` }} />
              </div>

              {/* Stats */}
              <div style={{ display: "flex", justifyContent: "space-between", color: C.muted, fontSize: 12, marginBottom: 16 }}>
                <span style={{ color: C.text, fontWeight: 600 }}>${fmt(sv.current, 0)} saved</span>
                <span>of ${fmt(sv.target, 0)}</span>
              </div>

              {/* Quick add buttons */}
              <div style={{ display: "flex", gap: 8 }}>
                {[10, 25, 50, 100].map(amt => (
                  <button key={amt} onClick={() => onUpdate(sv.id, Number(sv.current) + amt)} style={{ flex: 1, padding: "9px 0", background: goalColor + "15", border: `1px solid ${goalColor}40`, borderRadius: 10, color: goalColor, cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: FONT }}>+${amt}</button>
                ))}
              </div>
            </GlassCard>
          );
        })
      }
    </div>
  );
}

// ─── Chat ─────────────────────────────────────────────────────
function Chat({ messages, input, setInput, onSend }) {
  const bottomRef = useRef(null);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "72vh" }}>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ margin: "0 0 2px", fontSize: 26, fontWeight: 700 }}>AI Assistant</h2>
        <div style={{ fontSize: 12, color: C.faint, display: "flex", alignItems: "center", gap: 5 }}>
          <div style={{ width: 6, height: 6, borderRadius: 99, background: C.green }} />
          Powered by Claude · knows your finances
        </div>
      </div>
      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
        {messages.map((m, i) => (
          <div key={i} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", background: m.role === "user" ? `linear-gradient(90deg,${C.cyan},#0099BB)` : C.card, color: m.role === "user" ? C.bg : C.text, padding: "12px 16px", borderRadius: m.role === "user" ? "18px 18px 4px 18px" : "18px 18px 18px 4px", maxWidth: "82%", fontSize: 14, border: m.role === "assistant" ? `1px solid ${C.border}` : "none", lineHeight: 1.65, fontWeight: m.role === "user" ? 500 : 400 }}>
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
      <div style={{ display: "flex", gap: 8 }}>
        <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && onSend()} placeholder="Ask about your finances..." style={{ flex: 1, padding: "13px 16px", background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, color: C.text, fontSize: 14, outline: "none", fontFamily: FONT }} />
        <button onClick={onSend} style={{ padding: "13px 18px", background: `linear-gradient(90deg,${C.cyan},#0099BB)`, border: "none", borderRadius: 14, color: C.bg, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center" }}>
          <Icon name="send" size={16} color={C.bg} strokeWidth={2} />
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

      {/* Account */}
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

      {/* Financial Settings */}
      <GlassCard>
        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 16 }}>Financial Settings</div>
        <div style={{ color: C.muted, fontSize: 12, fontWeight: 500, marginBottom: 6 }}>Monthly Budget ($)</div>
        <input style={{ ...inp, marginBottom: 14 }} type="number" value={budget} onChange={e => setBudget(e.target.value)} />
        <div style={{ color: C.muted, fontSize: 12, fontWeight: 500, marginBottom: 6 }}>Annual Savings Goal ($)</div>
        <input style={{ ...inp, marginBottom: 18 }} type="number" value={goal} onChange={e => setGoal(e.target.value)} />
        <button onClick={async () => { await onSave({ monthly_budget: parseFloat(budget), savings_goal: parseFloat(goal) }); setSaved(true); setTimeout(() => setSaved(false), 2000); }}
          style={{ width: "100%", padding: 14, background: saved ? C.green : `linear-gradient(90deg,${C.cyan},#0099BB)`, border: "none", borderRadius: 12, color: C.bg, fontWeight: 700, cursor: "pointer", transition: "background 0.3s", fontFamily: FONT }}>
          {saved ? "Saved!" : "Save Settings"}
        </button>
      </GlassCard>

      {/* Autopilot */}
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
          { key: "overspendAlerts", icon: "bell", color: C.yellow, title: "Overspending Alerts", sub: "Alert when a category exceeds budget" },
          { key: "largeTxAlerts", icon: "alert-circle", color: C.red, title: "Large Transactions", sub: `Alert for purchases over $${autopilot.largeTxThreshold}` },
          { key: "unusualSpending", icon: "activity", color: C.cyan, title: "Unusual Spending", sub: "Alert when category is up 25%+ vs last month" },
        ].map((rule, i, arr) => (
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

      {/* Coming Next */}
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
    { id: "transactions", label: "Spending", icon: "credit" },
    { id: "savings", label: "Savings", icon: "target" },
    { id: "insights", label: "Insights", icon: "activity" },
    { id: "chat", label: "AI", icon: "message" },
  ];
  return (
    <div style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 430, background: "rgba(8,12,22,0.97)", backdropFilter: "blur(24px)", borderTop: `1px solid ${C.sep}`, display: "flex", padding: "10px 0 20px", zIndex: 50 }}>
      {tabs.map(tab => {
        const active = screen === tab.id;
        return (
          <button key={tab.id} onClick={() => setScreen(tab.id)} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, background: "none", border: "none", cursor: "pointer", padding: "4px 0" }}>
            <Icon name={tab.icon} size={22} color={active ? C.cyan : C.faint} strokeWidth={active ? 2 : 1.8} />
            <span style={{ fontSize: 10, color: active ? C.cyan : C.faint, fontWeight: active ? 700 : 400, fontFamily: FONT }}>{tab.label}</span>
            {active && <div style={{ width: 4, height: 4, borderRadius: 99, background: C.cyan }} />}
          </button>
        );
      })}
    </div>
  );
}
