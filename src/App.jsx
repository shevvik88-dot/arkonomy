import { useState, useEffect, useRef } from "react";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://hvnkxxazjfesbxdkzuba.supabase.co";
const SUPABASE_KEY = "sb_publishable_z4Mh9KZLXS_6ZZJyJ-pE7A_ClkhUDt9";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const C = {
  bg: "#080C16",
  bgSecondary: "#0F1629",
  bgTertiary: "#161D35",
  card: "#111827",
  border: "#1E2D4A",
  cyan: "#00D4FF",
  green: "#00E5A0",
  red: "#FF4C6B",
  yellow: "#FFB800",
  text: "#FFFFFF",
  muted: "#8A9BB8",
  faint: "#4A5E7A",
  sep: "#1A2540",
};

const CAT_COLORS = {
  "Food & Dining": "#FF6B6B",
  "Transport": "#4ECDC4",
  "Shopping": "#F59E0B",
  "Entertainment": "#A78BFA",
  "Health": "#34D399",
  "Bills": "#60A5FA",
  "Subscriptions": "#F97316",
  "Other": "#94A3B8",
};

// ─── Helpers ──────────────────────────────────────────────────
function fmt(n, decimals = 2) {
  return Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function GlassCard({ children, style = {} }) {
  return (
    <div style={{
      background: C.card,
      borderRadius: 20,
      border: `1px solid ${C.border}`,
      padding: 20,
      ...style,
    }}>
      {children}
    </div>
  );
}

function StatBadge({ value }) {
  const pos = value >= 0;
  const color = pos ? C.green : C.red;
  const arrow = pos ? "↑" : "↓";
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 2,
      background: color + "22", color, borderRadius: 100,
      padding: "2px 8px", fontSize: 11, fontWeight: 600,
    }}>
      {arrow}{Math.abs(value).toFixed(1)}%
    </span>
  );
}

// ─── Donut Chart ──────────────────────────────────────────────
function DonutChart({ data, size = 200 }) {
  const cx = size / 2, cy = size / 2;
  const outerR = size / 2 - 10;
  const innerR = outerR - 32;
  const mid = (outerR + innerR) / 2;

  const entries = Object.entries(data).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, v]) => s + v, 0);

  if (total === 0) return (
    <div style={{ height: size, display: "flex", alignItems: "center", justifyContent: "center", color: C.faint, fontSize: 13 }}>
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
    const s = { cat, val, start: angle, end: angle + sweep, color: CAT_COLORS[cat] || "#94A3B8" };
    angle += sweep;
    return s;
  });

  const gap = 2; // gap in degrees between slices
  const topCats = slices.slice(0, 4);

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
      <div style={{ position: "relative", width: size, height: size }}>
        <svg width={size} height={size} style={{ display: "block" }}>
          {/* Background ring */}
          <circle cx={cx} cy={cy} r={mid} fill="none" stroke={C.bgTertiary} strokeWidth={32} />
          {/* Slices */}
          {slices.map((s, i) => {
            const startAdj = s.start + (i === 0 ? 0 : gap / 2);
            const endAdj = s.end - (i === slices.length - 1 ? 0 : gap / 2);
            if (endAdj - startAdj < 1) return null;
            if (endAdj - startAdj >= 359) {
              return <circle key={i} cx={cx} cy={cy} r={mid} fill="none" stroke={s.color} strokeWidth={32} />;
            }
            return (
              <path
                key={i}
                d={arcPath(startAdj, endAdj)}
                stroke={s.color}
                strokeWidth={32}
                fill="none"
                strokeLinecap="round"
                style={{ filter: `drop-shadow(0 0 6px ${s.color}44)` }}
              />
            );
          })}
        </svg>
        {/* Center label */}
        <div style={{
          position: "absolute",
          left: cx - innerR, top: cy - innerR,
          width: innerR * 2, height: innerR * 2,
          borderRadius: "50%",
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          background: C.bg,
        }}>
          <div style={{ fontSize: 10, color: C.faint, letterSpacing: 1, textTransform: "uppercase", marginBottom: 2 }}>Total</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: C.text, letterSpacing: -0.5 }}>${fmt(total, 0)}</div>
        </div>
      </div>
      {/* Legend */}
      <div style={{ width: "100%", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 16px" }}>
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
        setMsg("✓ Check your email to confirm your account!");
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        onAuth(data.user);
      }
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  const inp = {
    width: "100%", padding: "14px 16px",
    background: C.bgSecondary, border: `1px solid ${C.border}`,
    borderRadius: 14, color: C.text, fontSize: 15, outline: "none", boxSizing: "border-box",
  };

  return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ width: "100%", maxWidth: 380 }}>
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <img src="https://i.postimg.cc/k4tv1XgB/Remove-the-dark-background-completely-make-it-tran-delpmaspu-removebg-preview.png" alt="Arkonomy" style={{ width: 280, height: 140, objectFit: "contain", display: "block", margin: "0 auto 16px" }} />
          <div style={{ fontSize: 22, fontWeight: 300, color: C.cyan, letterSpacing: 8, marginBottom: 6 }}>ARKONOMY</div>
          <div style={{ color: C.faint, fontSize: 11, letterSpacing: 3 }}>YOUR MONEY ON AUTOPILOT</div>
        </div>

        <GlassCard>
          <h2 style={{ color: C.text, margin: "0 0 22px", fontSize: 20 }}>{mode === "login" ? "Welcome back 👋" : "Create account"}</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {mode === "signup" && <input style={inp} placeholder="Full name" value={name} onChange={e => setName(e.target.value)} />}
            <input style={inp} type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} />
            <input style={inp} type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSubmit()} />
          </div>
          {error && <div style={{ color: C.red, fontSize: 13, marginTop: 12, background: C.red + "18", padding: "10px 14px", borderRadius: 10 }}>{error}</div>}
          {msg && <div style={{ color: C.green, fontSize: 13, marginTop: 12, background: C.green + "18", padding: "10px 14px", borderRadius: 10 }}>{msg}</div>}
          <button onClick={handleSubmit} disabled={loading} style={{ width: "100%", marginTop: 20, padding: 15, background: `linear-gradient(90deg,${C.cyan},#0099BB)`, border: "none", borderRadius: 12, color: C.bg, fontWeight: 700, fontSize: 16, cursor: "pointer", opacity: loading ? 0.7 : 1 }}>
            {loading ? "..." : mode === "login" ? "Sign In" : "Create Account"}
          </button>
          <div style={{ textAlign: "center", marginTop: 18, color: C.muted, fontSize: 14 }}>
            {mode === "login" ? "No account? " : "Have account? "}
            <span onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(""); setMsg(""); }} style={{ color: C.cyan, cursor: "pointer" }}>
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
  const [chatMessages, setChatMessages] = useState([{ role: "assistant", text: "Hi! I'm your Arkonomy AI. Ask me anything about your finances 💸" }]);
  const [chatInput, setChatInput] = useState("");

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
    if (c.data) {
      setCategories(c.data);
      if (c.data.length === 0) await seedCategories();
    }
    setLoading(false);
  }

  async function seedCategories() {
    const defaults = [
      { name: "Food & Dining", icon: "🍔", color: "#FF6B6B", budget: 600 },
      { name: "Transport", icon: "🚗", color: "#4ECDC4", budget: 300 },
      { name: "Shopping", icon: "🛍️", color: "#F59E0B", budget: 400 },
      { name: "Entertainment", icon: "🎬", color: "#A78BFA", budget: 200 },
      { name: "Health", icon: "💊", color: "#34D399", budget: 150 },
      { name: "Bills", icon: "📋", color: "#60A5FA", budget: 800 },
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

  const thisMonth = transactions.filter(t => {
    const d = new Date(t.date);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });
  const lastMonth = transactions.filter(t => {
    const d = new Date(t.date);
    return d.getMonth() === prevMonth.getMonth() && d.getFullYear() === prevMonth.getFullYear();
  });

  const totalSpent = thisMonth.filter(t => t.type === "expense").reduce((s, t) => s + Number(t.amount), 0);
  const totalIncome = thisMonth.filter(t => t.type === "income").reduce((s, t) => s + Number(t.amount), 0);
  const lastSpent = lastMonth.filter(t => t.type === "expense").reduce((s, t) => s + Number(t.amount), 0);
  const lastIncome = lastMonth.filter(t => t.type === "income").reduce((s, t) => s + Number(t.amount), 0);

  const spendingByCategory = {};
  thisMonth.filter(t => t.type === "expense").forEach(t => {
    const k = t.category_name || "Other";
    spendingByCategory[k] = (spendingByCategory[k] || 0) + Number(t.amount);
  });
  const prevSpendingByCategory = {};
  lastMonth.filter(t => t.type === "expense").forEach(t => {
    const k = t.category_name || "Other";
    prevSpendingByCategory[k] = (prevSpendingByCategory[k] || 0) + Number(t.amount);
  });

  if (loading && !user) return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ color: C.cyan, fontSize: 18 }}>Loading Arkonomy...</div>
    </div>
  );

  if (!user) return <AuthScreen onAuth={setUser} />;

  const sharedProps = { transactions, categories, savings, profile, totalSpent, totalIncome, lastSpent, lastIncome, spendingByCategory, prevSpendingByCategory };

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "'Inter','Helvetica Neue',sans-serif", maxWidth: 430, margin: "0 auto", position: "relative" }}>
      {/* Header */}
      <div style={{ padding: "16px 20px 12px", display: "flex", justifyContent: "space-between", alignItems: "center", position: "sticky", top: 0, background: "rgba(8,12,22,0.95)", backdropFilter: "blur(20px)", zIndex: 40, borderBottom: `1px solid ${C.sep}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <img src="https://i.postimg.cc/k4tv1XgB/Remove-the-dark-background-completely-make-it-tran-delpmaspu-removebg-preview.png" alt="Arkonomy" style={{ width: 72, height: 36, objectFit: "contain" }} />
          <div style={{ color: C.muted, fontSize: 13 }}>{profile?.full_name || user.email?.split("@")[0]}</div>
        </div>
        <button onClick={signOut} style={{ background: C.bgSecondary, border: `1px solid ${C.border}`, borderRadius: 10, padding: "7px 13px", color: C.muted, cursor: "pointer", fontSize: 13 }}>Sign out</button>
      </div>

      {/* Screen content */}
      <div style={{ padding: "16px 16px 110px" }}>
        {loading ? (
          <div style={{ color: C.muted, textAlign: "center", padding: 40 }}>Loading your data...</div>
        ) : (
          <>
            {screen === "dashboard" && <Dashboard {...sharedProps} />}
            {screen === "transactions" && <Transactions transactions={transactions} categories={categories} onAdd={() => setShowAddTx(true)} onDelete={deleteTransaction} />}
            {screen === "savings" && <Savings savings={savings} onAdd={addSaving} onUpdate={updateSaving} />}
            {screen === "insights" && <Insights {...sharedProps} onNavigateChat={(msg) => { setChatMessages(prev => [...prev, { role: "user", text: msg }]); setScreen("chat"); }} />}
            {screen === "chat" && <Chat messages={chatMessages} input={chatInput} setInput={setChatInput} onSend={async () => {
              if (!chatInput.trim()) return;
              const userMsg = { role: "user", text: chatInput };
              const updatedMessages = [...chatMessages, userMsg];
              setChatMessages(updatedMessages);
              setChatInput("");
              const financialContext = {
                currentMonth: {
                  totalSpent, totalIncome, balance: totalIncome - totalSpent,
                  budget: Number(profile?.monthly_budget) || 3000,
                  topExpenses: Object.entries(spendingByCategory).sort((a, b) => b[1] - a[1]).slice(0, 5),
                },
                savingsGoals: savings.map(s => ({ name: s.name, current: s.current, target: s.target, progress: s.target > 0 ? Math.round((s.current / s.target) * 100) : 0 })),
                recentTransactions: transactions.slice(0, 10).map(t => ({ description: t.description, amount: t.amount, type: t.type, category: t.category_name, date: t.date })),
              };
              const loadingId = Date.now();
              setChatMessages(prev => [...prev, { role: "assistant", text: "...", id: loadingId, loading: true }]);
              try {
                const res = await supabase.functions.invoke("ai-chat", {
                  body: { messages: updatedMessages.filter(m => !m.loading), financialContext },
                });
                const reply = res.data?.reply || "Sorry, something went wrong.";
                setChatMessages(prev => prev.map(m => m.id === loadingId ? { role: "assistant", text: reply } : m));
              } catch {
                setChatMessages(prev => prev.map(m => m.id === loadingId ? { role: "assistant", text: "⚠️ Couldn't reach AI. Check your connection." } : m));
              }
            }} />}
            {screen === "profile" && <Profile profile={profile} user={user} onSave={saveProfile} />}
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
  const monthlySavings = totalIncome - totalSpent;
  const incomeChange = lastIncome > 0 ? ((totalIncome - lastIncome) / lastIncome) * 100 : 0;
  const expenseChange = lastSpent > 0 ? ((totalSpent - lastSpent) / lastSpent) * 100 : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Balance Card */}
      <div style={{
        background: "linear-gradient(145deg,#0D1F3C,#080C16)",
        borderRadius: 24, padding: "22px 22px 20px",
        border: `1px solid #1E2D4A`,
        position: "relative", overflow: "hidden",
      }}>
        {/* Glow accent */}
        <div style={{ position: "absolute", top: -40, right: -40, width: 140, height: 140, borderRadius: "50%", background: C.cyan + "12", pointerEvents: "none" }} />
        <div style={{ position: "absolute", bottom: -20, left: -20, width: 80, height: 80, borderRadius: "50%", background: C.cyan + "08", pointerEvents: "none" }} />

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <span style={{ fontSize: 12, color: C.muted, letterSpacing: 1 }}>Total Balance</span>
          <button onClick={() => setBalanceVisible(v => !v)} style={{ background: "none", border: "none", cursor: "pointer", color: C.muted, fontSize: 16, padding: "2px 4px" }}>
            {balanceVisible ? "👁" : "🙈"}
          </button>
        </div>

        <div style={{ fontSize: 38, fontWeight: 700, letterSpacing: -1.5, color: C.text, marginBottom: 18, lineHeight: 1.1 }}>
          {balanceVisible ? `$${fmt(balance)}` : "••••••"}
        </div>

        <div style={{ height: 1, background: "rgba(255,255,255,0.05)", marginBottom: 16 }} />

        <div style={{ display: "flex" }}>
          {[
            { label: "Income", value: `$${fmt(totalIncome)}`, color: C.green, dot: C.green, change: incomeChange },
            { label: "Expenses", value: `$${fmt(totalSpent)}`, color: C.red, dot: C.red, change: -expenseChange },
            { label: "Savings", value: `$${fmt(monthlySavings, 0)}`, color: C.cyan, dot: C.cyan },
          ].map((item, i) => (
            <div key={item.label} style={{ flex: 1, paddingLeft: i > 0 ? 14 : 0, borderLeft: i > 0 ? `1px solid ${C.sep}` : "none", marginLeft: i > 0 ? 14 : 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 3 }}>
                <div style={{ width: 6, height: 6, borderRadius: 99, background: item.dot }} />
                <span style={{ fontSize: 10, color: C.muted }}>{item.label}</span>
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 4 }}>{item.value}</div>
              {item.change !== undefined && <StatBadge value={item.change} />}
            </div>
          ))}
        </div>
      </div>

      {/* Budget bar */}
      <GlassCard>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10, alignItems: "center" }}>
          <span style={{ fontWeight: 600, fontSize: 15 }}>Monthly Budget</span>
          <span style={{ color: pct > 90 ? C.red : pct > 70 ? C.yellow : C.muted, fontSize: 13, fontWeight: 600 }}>{pct.toFixed(0)}%</span>
        </div>
        <div style={{ height: 8, background: C.bgTertiary, borderRadius: 99 }}>
          <div style={{ height: 8, borderRadius: 99, width: `${pct}%`, background: pct > 90 ? C.red : pct > 70 ? C.yellow : `linear-gradient(90deg,${C.cyan},#0099BB)`, transition: "width 0.5s" }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
          <span style={{ color: C.muted, fontSize: 12 }}>${fmt(Math.max(budget - totalSpent, 0))} remaining</span>
          <span style={{ color: C.muted, fontSize: 12 }}>${fmt(budget, 0)}</span>
        </div>
      </GlassCard>

      {/* Donut Chart */}
      <GlassCard>
        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 16, display: "flex", justifyContent: "space-between" }}>
          <span>Spending by Category</span>
          <span style={{ fontSize: 12, color: C.faint, fontWeight: 400 }}>This month</span>
        </div>
        <DonutChart data={spendingByCategory} size={200} />
      </GlassCard>

      {/* Recent Transactions */}
      <GlassCard>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <span style={{ fontWeight: 600, fontSize: 15 }}>Recent Transactions</span>
        </div>
        {transactions.length === 0
          ? <div style={{ color: C.muted, textAlign: "center", padding: "20px 0" }}>No transactions yet — add your first one!</div>
          : transactions.slice(0, 6).map((t, i, arr) => (
              <div key={t.id}>
                <TxRow t={t} />
                {i < arr.slice(0, 6).length - 1 && <div style={{ height: 1, background: C.sep, margin: "2px 0" }} />}
              </div>
            ))
        }
      </GlassCard>
    </div>
  );
}

// ─── Insights ─────────────────────────────────────────────────
function Insights({ totalSpent, totalIncome, spendingByCategory, prevSpendingByCategory, savings, onNavigateChat }) {
  const monthlySavings = totalIncome - totalSpent;
  const savingsRate = totalIncome > 0 ? (monthlySavings / totalIncome) * 100 : 0;

  const insights = [];

  Object.entries(spendingByCategory).forEach(([cat, amount]) => {
    const prev = prevSpendingByCategory[cat] || 0;
    if (prev > 0) {
      const change = ((amount - prev) / prev) * 100;
      if (change > 25) {
        insights.push({
          id: `unusual-${cat}`, icon: "📈",
          title: `${cat} up ${change.toFixed(0)}%`,
          desc: `Spent $${fmt(amount, 0)} this month vs $${fmt(prev, 0)} last month.`,
          severity: change > 50 ? "danger" : "warning",
          value: `+${change.toFixed(0)}%`,
          context: `My ${cat} spending is ${change.toFixed(0)}% higher than last month. $${fmt(amount, 0)} vs $${fmt(prev, 0)}. What's driving this?`,
        });
      }
    }
  });

  if (savingsRate < 10 && totalIncome > 0) {
    insights.push({
      id: "savings-low", icon: "🎯",
      title: "Low Savings Rate",
      desc: `You're saving ${savingsRate.toFixed(1)}% of income. Aim for 20%.`,
      severity: "warning", value: `${savingsRate.toFixed(1)}%`,
      context: `My savings rate is ${savingsRate.toFixed(1)}%. How can I get to 20%?`,
    });
  } else if (savingsRate >= 20) {
    insights.push({
      id: "savings-good", icon: "⭐",
      title: "Great Savings Rate!",
      desc: `You're saving ${savingsRate.toFixed(1)}% — above the 20% target.`,
      severity: "good", value: `${savingsRate.toFixed(1)}%`,
      context: `My savings rate is ${savingsRate.toFixed(1)}%. How can I invest this wisely?`,
    });
  }

  const shopping = spendingByCategory["Shopping"] || 0;
  if (shopping > 300) {
    insights.push({
      id: "shopping", icon: "🛍️",
      title: "High Shopping Spend",
      desc: `$${fmt(shopping, 0)} on shopping. Consider a 30-day rule.`,
      severity: "info", value: `$${fmt(shopping, 0)}`,
      context: `I spent $${fmt(shopping, 0)} on shopping this month. Help me cut back.`,
    });
  }

  if (insights.length === 0) {
    insights.push({
      id: "all-good", icon: "✅",
      title: "You're on track!",
      desc: "Your spending looks healthy this month. Keep it up.",
      severity: "good",
      context: "My finances look healthy. What should I do to build wealth?",
    });
  }

  const severityColors = { info: C.cyan, warning: C.yellow, danger: C.red, good: C.green };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ marginBottom: 4 }}>
        <h2 style={{ margin: "0 0 4px", fontSize: 26, fontWeight: 700 }}>Insights</h2>
        <div style={{ fontSize: 13, color: C.muted }}>AI-powered analysis</div>
      </div>

      {insights.map(ins => {
        const color = severityColors[ins.severity];
        return (
          <GlassCard key={ins.id}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ width: 44, height: 44, borderRadius: 14, background: color + "22", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>
                {ins.icon}
              </div>
              {ins.value && (
                <span style={{ background: color + "22", color, borderRadius: 100, padding: "4px 12px", fontSize: 13, fontWeight: 700 }}>{ins.value}</span>
              )}
            </div>
            <div style={{ fontWeight: 700, fontSize: 16, color: C.text, marginBottom: 4 }}>{ins.title}</div>
            <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.6, marginBottom: 12 }}>{ins.desc}</div>
            <button onClick={() => onNavigateChat(ins.context)} style={{ background: "none", border: "none", cursor: "pointer", color, fontSize: 13, fontWeight: 600, padding: 0, display: "flex", alignItems: "center", gap: 6 }}>
              💬 Ask AI about this →
            </button>
          </GlassCard>
        );
      })}

      {/* Autopilot tip */}
      <GlassCard style={{ background: `linear-gradient(135deg,${C.cyan}10,${C.card})`, border: `1px solid ${C.cyan}33` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 16 }}>⚡</span>
          <span style={{ fontWeight: 600, fontSize: 15, color: C.cyan }}>Autopilot Tip</span>
        </div>
        <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.6 }}>
          Auto-invest your monthly surplus and let compound interest do the work. Even $50/month can grow to $30,000+ in 20 years.
        </div>
      </GlassCard>
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
          <div style={{ fontSize: 14, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: C.text }}>{t.description || t.category_name || "Transaction"}</div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{t.category_name || "Other"} · {t.date}</div>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, marginLeft: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: isExp ? C.red : C.green, letterSpacing: -0.3 }}>
          {isExp ? "−" : "+"}${fmt(t.amount)}
        </span>
        {onDelete && (
          <button onClick={() => onDelete(t.id)} style={{ background: "none", border: "none", color: C.faint, cursor: "pointer", fontSize: 18, lineHeight: 1, padding: "0 2px" }}>×</button>
        )}
      </div>
    </div>
  );
}

// ─── Transactions ─────────────────────────────────────────────
function Transactions({ transactions, onAdd, onDelete }) {
  const [filter, setFilter] = useState("all");
  const filtered = filter === "all" ? transactions : transactions.filter(t => t.type === filter);
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 26, fontWeight: 700 }}>Transactions</h2>
        <button onClick={onAdd} style={{ background: `linear-gradient(90deg,${C.cyan},#0099BB)`, border: "none", borderRadius: 12, padding: "9px 18px", color: C.bg, fontWeight: 700, cursor: "pointer" }}>+ Add</button>
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {["all", "expense", "income"].map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{ padding: "7px 16px", borderRadius: 20, border: `1px solid ${filter === f ? C.cyan : C.border}`, background: filter === f ? C.cyan + "18" : C.card, color: filter === f ? C.cyan : C.muted, cursor: "pointer", fontSize: 13, textTransform: "capitalize" }}>{f}</button>
        ))}
      </div>
      <GlassCard style={{ padding: "0 16px" }}>
        {filtered.length === 0
          ? <div style={{ color: C.muted, textAlign: "center", padding: "30px 0" }}>No transactions</div>
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

function AddTransactionModal({ categories, onAdd, onClose }) {
  const [amount, setAmount] = useState("");
  const [desc, setDesc] = useState("");
  const [catId, setCatId] = useState("");
  const [catName, setCatName] = useState("");
  const [type, setType] = useState("expense");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [showCats, setShowCats] = useState(false);

  const inp = { width: "100%", padding: "13px 14px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 12, color: C.text, fontSize: 15, outline: "none", boxSizing: "border-box" };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "flex-end", zIndex: 100, maxWidth: 430, margin: "0 auto" }}>
      <div style={{ background: C.card, width: "100%", borderRadius: "24px 24px 0 0", padding: 24, border: `1px solid ${C.border}`, maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20 }}>
          <h3 style={{ margin: 0, fontSize: 18 }}>Add Transaction</h3>
          <button onClick={onClose} style={{ background: C.bgSecondary, border: `1px solid ${C.border}`, borderRadius: 99, color: C.muted, fontSize: 18, cursor: "pointer", width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          {["expense", "income"].map(t => (
            <button key={t} onClick={() => setType(t)} style={{ flex: 1, padding: 11, borderRadius: 12, border: `1px solid ${type === t ? C.cyan : C.border}`, background: type === t ? C.cyan + "18" : "transparent", color: type === t ? C.cyan : C.muted, cursor: "pointer", fontWeight: 600, textTransform: "capitalize" }}>{t}</button>
          ))}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <input style={inp} type="number" placeholder="Amount ($)" value={amount} onChange={e => setAmount(e.target.value)} />
          <input style={inp} placeholder="Description (optional)" value={desc} onChange={e => setDesc(e.target.value)} />
          <div>
            <button onClick={() => setShowCats(!showCats)} style={{ ...inp, display: "flex", alignItems: "center", gap: 12, cursor: "pointer", textAlign: "left" }}>
              {catId ? <><CatIcon name={catName} type={type} size={18} /><span style={{ color: C.text }}>{catName}</span></> : <span style={{ color: C.muted }}>Select category</span>}
            </button>
            {showCats && (
              <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 12, marginTop: 4, overflow: "hidden" }}>
                {categories.map(c => (
                  <div key={c.id} onClick={() => { setCatId(c.id); setCatName(c.name); setShowCats(false); }}
                    style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", cursor: "pointer", background: catId === c.id ? C.cyan + "10" : "transparent", borderBottom: `1px solid ${C.sep}` }}>
                    <CatIcon name={c.name} type={type} size={18} />
                    <span style={{ color: C.text, fontSize: 14 }}>{c.name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <input style={inp} type="date" value={date} onChange={e => setDate(e.target.value)} />
        </div>
        <button onClick={() => { if (!amount) return; onAdd({ amount: parseFloat(amount), description: desc || catName, category_id: catId || null, category_name: catName, date, type }); }}
          style={{ width: "100%", marginTop: 18, padding: 15, background: `linear-gradient(90deg,${C.cyan},#0099BB)`, border: "none", borderRadius: 14, color: C.bg, fontWeight: 700, fontSize: 16, cursor: "pointer" }}>
          Add Transaction
        </button>
      </div>
    </div>
  );
}

// ─── Savings ──────────────────────────────────────────────────
function Savings({ savings, onAdd, onUpdate }) {
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newTarget, setNewTarget] = useState("");
  const [newIcon, setNewIcon] = useState("🎯");
  const inp = { width: "100%", padding: "12px 14px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 12, color: C.text, fontSize: 14, outline: "none", boxSizing: "border-box", marginBottom: 10 };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 26, fontWeight: 700 }}>Savings Goals</h2>
        <button onClick={() => setShowAdd(!showAdd)} style={{ background: `linear-gradient(90deg,${C.cyan},#0099BB)`, border: "none", borderRadius: 12, padding: "9px 18px", color: C.bg, fontWeight: 700, cursor: "pointer" }}>+ Goal</button>
      </div>
      {showAdd && (
        <GlassCard style={{ marginBottom: 16 }}>
          <input style={inp} placeholder="Goal name (e.g. Vacation)" value={newName} onChange={e => setNewName(e.target.value)} />
          <input style={inp} type="number" placeholder="Target amount ($)" value={newTarget} onChange={e => setNewTarget(e.target.value)} />
          <input style={inp} placeholder="Icon" value={newIcon} onChange={e => setNewIcon(e.target.value)} />
          <button onClick={() => { if (!newName || !newTarget) return; onAdd({ name: newName, target: parseFloat(newTarget), current: 0, icon: newIcon, color: C.cyan }); setShowAdd(false); setNewName(""); setNewTarget(""); setNewIcon("🎯"); }}
            style={{ width: "100%", padding: 13, background: C.cyan, border: "none", borderRadius: 12, color: C.bg, fontWeight: 700, cursor: "pointer" }}>Create Goal</button>
        </GlassCard>
      )}
      {savings.length === 0
        ? <div style={{ color: C.muted, textAlign: "center", padding: "40px 0" }}>No savings goals yet</div>
        : savings.map(sv => {
          const pct = sv.target > 0 ? Math.min((sv.current / sv.target) * 100, 100) : 0;
          return (
            <GlassCard key={sv.id} style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <span style={{ fontSize: 26 }}>{sv.icon}</span>
                  <span style={{ fontWeight: 600, fontSize: 15 }}>{sv.name}</span>
                </div>
                <span style={{ color: C.cyan, fontWeight: 700, fontSize: 15 }}>{pct.toFixed(0)}%</span>
              </div>
              <div style={{ height: 8, background: C.bgTertiary, borderRadius: 99, marginBottom: 8 }}>
                <div style={{ height: 8, borderRadius: 99, width: `${pct}%`, background: sv.color || C.cyan, transition: "width 0.4s", boxShadow: `0 0 8px ${sv.color || C.cyan}66` }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", color: C.muted, fontSize: 13, marginBottom: 14 }}>
                <span>${fmt(sv.current)} saved</span>
                <span>Goal: ${fmt(sv.target)}</span>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                {[10, 50, 100].map(amt => (
                  <button key={amt} onClick={() => onUpdate(sv.id, Number(sv.current) + amt)} style={{ flex: 1, padding: "9px", background: C.cyan + "15", border: `1px solid ${C.cyan}44`, borderRadius: 10, color: C.cyan, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>+${amt}</button>
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
        <div style={{ fontSize: 12, color: C.faint }}>Powered by Claude · knows your finances</div>
      </div>
      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
        {messages.map((m, i) => (
          <div key={i} style={{
            alignSelf: m.role === "user" ? "flex-end" : "flex-start",
            background: m.role === "user" ? `linear-gradient(90deg,${C.cyan},#0099BB)` : C.card,
            color: m.role === "user" ? C.bg : C.text,
            padding: "12px 16px",
            borderRadius: m.role === "user" ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
            maxWidth: "82%", fontSize: 14,
            border: m.role === "assistant" ? `1px solid ${C.border}` : "none",
            lineHeight: 1.6,
          }}>
            {m.loading
              ? <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                  {[0, 1, 2].map(j => <span key={j} style={{ width: 6, height: 6, borderRadius: "50%", background: C.muted, display: "inline-block", animation: `bounce 1.2s ease-in-out ${j * 0.2}s infinite` }} />)}
                  <style>{`@keyframes bounce{0%,80%,100%{transform:translateY(0)}40%{transform:translateY(-6px)}}`}</style>
                </span>
              : m.text}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && onSend()} placeholder="Ask about your finances..." style={{ flex: 1, padding: "13px 16px", background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, color: C.text, fontSize: 14, outline: "none" }} />
        <button onClick={onSend} style={{ padding: "13px 20px", background: `linear-gradient(90deg,${C.cyan},#0099BB)`, border: "none", borderRadius: 14, color: C.bg, fontWeight: 700, cursor: "pointer", fontSize: 18 }}>→</button>
      </div>
    </div>
  );
}

// ─── Profile ──────────────────────────────────────────────────
function Profile({ profile, user, onSave }) {
  const [budget, setBudget] = useState(profile?.monthly_budget || 3000);
  const [goal, setGoal] = useState(profile?.savings_goal || 10000);
  const [saved, setSaved] = useState(false);
  const inp = { width: "100%", padding: "13px 14px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 12, color: C.text, fontSize: 15, outline: "none", boxSizing: "border-box" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <h2 style={{ margin: 0, fontSize: 26, fontWeight: 700 }}>Settings</h2>

      <GlassCard>
        <div style={{ color: C.faint, fontSize: 11, letterSpacing: 1, marginBottom: 6 }}>ACCOUNT</div>
        <div style={{ fontWeight: 500, color: C.text }}>{user.email}</div>
      </GlassCard>

      <GlassCard>
        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 16 }}>Financial Settings</div>
        <div style={{ color: C.muted, fontSize: 12, marginBottom: 6 }}>Monthly Budget ($)</div>
        <input style={{ ...inp, marginBottom: 14 }} type="number" value={budget} onChange={e => setBudget(e.target.value)} />
        <div style={{ color: C.muted, fontSize: 12, marginBottom: 6 }}>Savings Goal ($)</div>
        <input style={{ ...inp, marginBottom: 18 }} type="number" value={goal} onChange={e => setGoal(e.target.value)} />
        <button onClick={async () => { await onSave({ monthly_budget: parseFloat(budget), savings_goal: parseFloat(goal) }); setSaved(true); setTimeout(() => setSaved(false), 2000); }}
          style={{ width: "100%", padding: 14, background: saved ? C.green : `linear-gradient(90deg,${C.cyan},#0099BB)`, border: "none", borderRadius: 12, color: C.bg, fontWeight: 700, cursor: "pointer", transition: "background 0.3s" }}>
          {saved ? "✓ Saved!" : "Save Settings"}
        </button>
      </GlassCard>

      <GlassCard>
        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 14 }}>Coming Next</div>
        {[
          { label: "Connect Bank (Plaid)", color: "#1A56DB", icon: "🏦" },
          { label: "Auto-Invest (Alpaca)", color: "#059669", icon: "📈" },
          { label: "Subscription Management", color: "#7C3AED", icon: "🔄" },
          { label: "Mobile App (iOS & Android)", color: "#0891B2", icon: "📱" },
        ].map((item, i, arr) => (
          <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 14, padding: "11px 0", borderBottom: i < arr.length - 1 ? `1px solid ${C.sep}` : "none" }}>
            <div style={{ width: 38, height: 38, borderRadius: 12, background: item.color + "33", border: `1px solid ${item.color}44`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>{item.icon}</div>
            <span style={{ color: C.muted, fontSize: 14, flex: 1 }}>{item.label}</span>
            <span style={{ color: C.faint, fontSize: 18 }}>›</span>
          </div>
        ))}
      </GlassCard>
    </div>
  );
}

// ─── Category Icons ───────────────────────────────────────────
function CatIcon({ name, type, size = 22 }) {
  const cats = {
    "Food & Dining": { color: "#E8612C", svg: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg> },
    "Transport":    { color: "#2563EB", svg: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg> },
    "Shopping":     { color: "#B45309", svg: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg> },
    "Entertainment":{ color: "#7C3AED", svg: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg> },
    "Health":       { color: "#059669", svg: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg> },
    "Bills":        { color: "#0891B2", svg: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> },
    "income":       { color: "#00A67E", svg: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg> },
    "default":      { color: "#374151", svg: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg> },
  };
  const key = type === "income" ? "income" : (cats[name] ? name : "default");
  const { color, svg } = cats[key];
  return (
    <div style={{ width: 40, height: 40, borderRadius: 12, background: color, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
      {svg}
    </div>
  );
}

// ─── Bottom Nav ───────────────────────────────────────────────
function BottomNav({ screen, setScreen }) {
  const tabs = [
    { id: "dashboard", label: "Home" },
    { id: "transactions", label: "Spending" },
    { id: "savings", label: "Savings" },
    { id: "insights", label: "Insights" },
    { id: "chat", label: "AI" },
  ];
  return (
    <div style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 430, background: "rgba(8,12,22,0.97)", backdropFilter: "blur(24px)", borderTop: `1px solid ${C.sep}`, display: "flex", padding: "10px 0 20px", zIndex: 50 }}>
      {tabs.map(tab => (
        <button key={tab.id} onClick={() => setScreen(tab.id)} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3, background: "none", border: "none", cursor: "pointer", padding: "4px 0" }}>
          <NavIcon id={tab.id} active={screen === tab.id} />
          <span style={{ fontSize: 10, color: screen === tab.id ? C.cyan : C.faint, fontWeight: screen === tab.id ? 700 : 400 }}>{tab.label}</span>
          {screen === tab.id && <div style={{ width: 4, height: 4, borderRadius: 99, background: C.cyan, marginTop: 1 }} />}
        </button>
      ))}
    </div>
  );
}

// ─── Nav Icons ────────────────────────────────────────────────
function NavIcon({ id, active }) {
  const color = active ? C.cyan : C.faint;
  const s = 22;
  const icons = {
    dashboard:    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>,
    transactions: <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>,
    savings:      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 5H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>,
    insights:     <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>,
    chat:         <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a9 9 0 0 1 9 9c0 4.97-4.03 9-9 9a9 9 0 0 1-4.5-1.2L3 21l2.2-4.5A9 9 0 0 1 12 2z"/><path d="M8 10h.01M12 10h.01M16 10h.01"/></svg>,
  };
  return icons[id] || null;
}
