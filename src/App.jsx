import { useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://hvnkxxazjfesbxdkzuba.supabase.co";
const SUPABASE_KEY = "sb_publishable_z4Mh9KZLXS_6ZZJyJ-pE7A_ClkhUDt9";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const C = {
  bg: "#0B0D14", card: "#13151F", border: "#1E2130",
  teal: "#00D4AA", blue: "#0066FF", text: "#E8EAF0",
  muted: "#9CA3AF", danger: "#FF4D6D", warn: "#FFB700",
};

// ─── Auth Screen ─────────────────────────────────────────────
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

  const inp = { width: "100%", padding: "13px 16px", background: "#0D0F1A", border: `1px solid ${C.border}`, borderRadius: 12, color: C.text, fontSize: 15, outline: "none", boxSizing: "border-box" };

  return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ width: "100%", maxWidth: 380 }}>
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <img src="https://i.postimg.cc/k4tv1XgB/Remove-the-dark-background-completely-make-it-tran-delpmaspu-removebg-preview.png" alt="Arkonomy" style={{ width: 320, height: 160, borderRadius: 28, display: "block", margin: "0 auto 16px" }} />
          <div style={{ fontSize: 26, fontWeight: 300, color: "#8BB8D4", letterSpacing: 8, marginBottom: 6 }}>ARKONOMY</div>
          <div style={{ color: "#4A6A80", fontSize: 11, letterSpacing: 3 }}>YOUR MONEY ON AUTOPILOT</div>
        </div>

        <div style={{ background: C.card, borderRadius: 24, padding: 28, border: `1px solid ${C.border}` }}>
          <h2 style={{ color: C.text, margin: "0 0 22px", fontSize: 20 }}>{mode === "login" ? "Welcome back 👋" : "Create account"}</h2>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {mode === "signup" && <input style={inp} placeholder="Full name" value={name} onChange={e => setName(e.target.value)} />}
            <input style={inp} type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} />
            <input style={inp} type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSubmit()} />
          </div>

          {error && <div style={{ color: C.danger, fontSize: 13, marginTop: 12, background: "rgba(255,77,109,0.1)", padding: "10px 14px", borderRadius: 10 }}>{error}</div>}
          {msg && <div style={{ color: C.teal, fontSize: 13, marginTop: 12, background: "rgba(0,212,170,0.1)", padding: "10px 14px", borderRadius: 10 }}>{msg}</div>}

          <button onClick={handleSubmit} disabled={loading} style={{ width: "100%", marginTop: 20, padding: 14, background: `linear-gradient(90deg,${C.teal},${C.blue})`, border: "none", borderRadius: 12, color: "#0B0D14", fontWeight: 700, fontSize: 16, cursor: "pointer", opacity: loading ? 0.7 : 1 }}>
            {loading ? "..." : mode === "login" ? "Sign In" : "Create Account"}
          </button>

          <div style={{ textAlign: "center", marginTop: 18, color: C.muted, fontSize: 14 }}>
            {mode === "login" ? "No account? " : "Have account? "}
            <span onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(""); setMsg(""); }} style={{ color: C.teal, cursor: "pointer" }}>
              {mode === "login" ? "Sign up free" : "Sign in"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main App ────────────────────────────────────────────────
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
      { name: "Shopping", icon: "🛍️", color: "#FFE66D", budget: 400 },
      { name: "Entertainment", icon: "🎬", color: "#A29BFE", budget: 200 },
      { name: "Health", icon: "💊", color: "#55EFC4", budget: 150 },
      { name: "Bills", icon: "📋", color: "#FD79A8", budget: 800 },
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

  // Stats
  const now = new Date();
  const thisMonth = transactions.filter(t => { const d = new Date(t.date); return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear(); });
  const totalSpent = thisMonth.filter(t => t.type === "expense").reduce((s, t) => s + Number(t.amount), 0);
  const totalIncome = thisMonth.filter(t => t.type === "income").reduce((s, t) => s + Number(t.amount), 0);

  if (loading && !user) return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ color: C.teal, fontSize: 18, fontFamily: "sans-serif" }}>Loading Arkonomy...</div>
    </div>
  );

  if (!user) return <AuthScreen onAuth={setUser} />;

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "'Inter','Helvetica Neue',sans-serif", maxWidth: 430, margin: "0 auto", position: "relative" }}>
      {/* Header */}
      <div style={{ padding: "20px 20px 0", display: "flex", justifyContent: "space-between", alignItems: "center", position: "sticky", top: 0, background: C.bg, zIndex: 40, paddingBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <img src="https://i.postimg.cc/k4tv1XgB/Remove-the-dark-background-completely-make-it-tran-delpmaspu-removebg-preview.png" alt="Arkonomy" style={{ width: 200, height: 100, objectFit: "contain" }} />
          <div>
            <div style={{ fontSize: 18, fontWeight: 300, color: "#8BB8D4", letterSpacing: 4 }}>ARKONOMY</div>
            <div style={{ color: C.muted, fontSize: 11, marginTop: 1 }}>{profile?.full_name || user.email?.split("@")[0]}</div>
          </div>
        </div>
        <button onClick={signOut} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "7px 13px", color: C.muted, cursor: "pointer", fontSize: 13 }}>Sign out</button>
      </div>

      {/* Screen content */}
      <div style={{ padding: "16px 16px 110px" }}>
        {loading ? (
          <div style={{ color: C.muted, textAlign: "center", padding: 40 }}>Loading your data...</div>
        ) : (
          <>
            {screen === "dashboard" && <Dashboard totalSpent={totalSpent} totalIncome={totalIncome} transactions={transactions} categories={categories} profile={profile} />}
            {screen === "transactions" && <Transactions transactions={transactions} categories={categories} onAdd={() => setShowAddTx(true)} onDelete={deleteTransaction} />}
            {screen === "savings" && <Savings savings={savings} onAdd={addSaving} onUpdate={updateSaving} />}
            {screen === "chat" && <Chat messages={chatMessages} input={chatInput} setInput={setChatInput} onSend={() => {
              if (!chatInput.trim()) return;
              const userMsg = { role: "user", text: chatInput };
              setChatMessages(prev => [...prev, userMsg]);
              setChatInput("");
              setTimeout(() => {
                setChatMessages(prev => [...prev, { role: "assistant", text: `You've spent $${totalSpent.toFixed(2)} this month across ${thisMonth.filter(t=>t.type==="expense").length} transactions. OpenAI integration coming soon for full AI analysis!` }]);
              }, 600);
            }} />}
            {screen === "profile" && <Profile profile={profile} user={user} onSave={saveProfile} />}
          </>
        )}
      </div>

      {showAddTx && <AddTransactionModal categories={categories} onAdd={addTransaction} onClose={() => setShowAddTx(false)} />}
      <BottomNav screen={screen} setScreen={setScreen} onAdd={() => setShowAddTx(true)} />
    </div>
  );
}

// ─── Dashboard ───────────────────────────────────────────────
function Dashboard({ totalSpent, totalIncome, transactions, categories, profile }) {
  const budget = Number(profile?.monthly_budget) || 3000;
  const balance = totalIncome - totalSpent;
  const pct = Math.min((totalSpent / budget) * 100, 100);

  const byCat = {};
  transactions.forEach(t => { if (t.type === "expense") byCat[t.category_name || "Other"] = (byCat[t.category_name || "Other"] || 0) + Number(t.amount); });
  const catList = Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 5);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Balance */}
      <div style={{ background: "linear-gradient(135deg,#0D1F3C,#0A1628)", borderRadius: 20, padding: 24, border: `1px solid #1A2B4A` }}>
        <div style={{ color: C.muted, fontSize: 13, marginBottom: 6 }}>Balance this month</div>
        <div style={{ fontSize: 40, fontWeight: 800, color: balance >= 0 ? C.teal : C.danger }}>{balance >= 0 ? "+" : ""}${Math.abs(balance).toFixed(2)}</div>
        <div style={{ display: "flex", gap: 28, marginTop: 16 }}>
          <div><div style={{ color: C.muted, fontSize: 11, letterSpacing: 1 }}>INCOME</div><div style={{ color: C.teal, fontWeight: 700, fontSize: 16 }}>${totalIncome.toFixed(2)}</div></div>
          <div><div style={{ color: C.muted, fontSize: 11, letterSpacing: 1 }}>SPENT</div><div style={{ color: C.danger, fontWeight: 700, fontSize: 16 }}>${totalSpent.toFixed(2)}</div></div>
          <div><div style={{ color: C.muted, fontSize: 11, letterSpacing: 1 }}>BUDGET</div><div style={{ color: C.warn, fontWeight: 700, fontSize: 16 }}>${budget.toFixed(0)}</div></div>
        </div>
      </div>

      {/* Budget bar */}
      <div style={{ background: C.card, borderRadius: 16, padding: 18, border: `1px solid ${C.border}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
          <span style={{ fontWeight: 600, fontSize: 15 }}>Monthly Budget</span>
          <span style={{ color: pct > 90 ? C.danger : C.muted, fontSize: 13, fontWeight: 600 }}>{pct.toFixed(0)}%</span>
        </div>
        <div style={{ height: 8, background: C.border, borderRadius: 99 }}>
          <div style={{ height: 8, borderRadius: 99, width: `${pct}%`, background: pct > 90 ? C.danger : pct > 70 ? C.warn : `linear-gradient(90deg,${C.teal},${C.blue})`, transition: "width 0.5s" }} />
        </div>
        <div style={{ color: C.muted, fontSize: 12, marginTop: 8 }}>${Math.max(budget - totalSpent, 0).toFixed(2)} remaining</div>
      </div>

      {/* Top spending */}
      {catList.length > 0 && (
        <div style={{ background: C.card, borderRadius: 16, padding: 18, border: `1px solid ${C.border}` }}>
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 14 }}>Top Spending</div>
          {catList.map(([name, amount]) => {
            const cat = categories.find(c => c.name === name);
            return (
              <div key={name} style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                  <span style={{ fontSize: 14 }}>{cat?.icon || "💳"} {name}</span>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>${amount.toFixed(2)}</span>
                </div>
                <div style={{ height: 4, background: C.border, borderRadius: 99 }}>
                  <div style={{ height: 4, borderRadius: 99, width: `${Math.min((amount / budget) * 100, 100)}%`, background: cat?.color || C.teal }} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Recent */}
      <div style={{ background: C.card, borderRadius: 16, padding: 18, border: `1px solid ${C.border}` }}>
        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 14 }}>Recent Transactions</div>
        {transactions.length === 0
          ? <div style={{ color: C.muted, textAlign: "center", padding: "20px 0" }}>No transactions yet — add your first one!</div>
          : transactions.slice(0, 6).map(t => <TxRow key={t.id} t={t} />)
        }
      </div>
    </div>
  );
}

// ─── Category Icons SVG ──────────────────────────────────────
function CatIcon({ name, type, size = 22 }) {
  const cats = {
    "Food & Dining": { color: "#E8612C", svg: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg> },
    "Transport":    { color: "#2563EB", svg: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg> },
    "Shopping":     { color: "#1E3A5F", svg: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg> },
    "Entertainment":{ color: "#7C3AED", svg: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg> },
    "Health":       { color: "#059669", svg: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg> },
    "Bills":        { color: "#0891B2", svg: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg> },
    "income":       { color: "#00A67E", svg: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg> },
    "default":      { color: "#374151", svg: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg> },
  };
  const key = type === "income" ? "income" : (cats[name] ? name : "default");
  const { color, svg } = cats[key];
  return (
    <div style={{ width: 44, height: 44, borderRadius: 14, background: color, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
      {svg}
    </div>
  );
}

// ─── Nav Icons SVG ────────────────────────────────────────────
function NavIcon({ id, active }) {
  const color = active ? "#00D4AA" : "#6B7280";
  const s = 24;
  const icons = {
    dashboard:    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>,
    transactions: <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/><line x1="7" y1="15" x2="10" y2="15"/><line x1="13" y1="15" x2="17" y2="15"/></svg>,
    savings:      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 5H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/><path d="M12 5v2M12 17v2M5 12H3M21 12h-2"/></svg>,
    chat:         <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a9 9 0 0 1 9 9c0 4.97-4.03 9-9 9a9 9 0 0 1-4.5-1.2L3 21l2.2-4.5A9 9 0 0 1 12 2z"/><path d="M8 10h.01M12 10h.01M16 10h.01"/></svg>,
    profile:      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 12m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0"/><path d="M3 20c0-3.87 4.03-7 9-7s9 3.13 9 7"/></svg>,
  };
  return icons[id] || null;
}

// ─── TxRow ───────────────────────────────────────────────────
function TxRow({ t, onDelete }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 0", borderBottom: `1px solid ${C.border}` }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <CatIcon name={t.category_name} type={t.type} />
        <div>
          <div style={{ fontSize: 14, fontWeight: 500 }}>{t.description || t.category_name || "Transaction"}</div>
          <div style={{ fontSize: 12, color: C.muted }}>{t.category_name || "Other"} · {t.date}</div>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontWeight: 700, color: t.type === "expense" ? C.danger : C.teal }}>{t.type === "expense" ? "-" : "+"}${Number(t.amount).toFixed(2)}</span>
        {onDelete && <button onClick={() => onDelete(t.id)} style={{ background: "none", border: "none", color: "#444", cursor: "pointer", fontSize: 18, lineHeight: 1, padding: "0 4px" }}>×</button>}
      </div>
    </div>
  );
}

// ─── Transactions ────────────────────────────────────────────
function Transactions({ transactions, categories, onAdd, onDelete }) {
  const [filter, setFilter] = useState("all");
  const filtered = filter === "all" ? transactions : transactions.filter(t => t.type === filter);
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>Transactions</h2>
        <button onClick={onAdd} style={{ background: `linear-gradient(90deg,${C.teal},${C.blue})`, border: "none", borderRadius: 10, padding: "9px 18px", color: "#0B0D14", fontWeight: 700, cursor: "pointer" }}>+ Add</button>
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {["all", "expense", "income"].map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{ padding: "7px 16px", borderRadius: 20, border: `1px solid ${filter === f ? C.teal : C.border}`, background: filter === f ? "rgba(0,212,170,0.12)" : C.card, color: filter === f ? C.teal : C.muted, cursor: "pointer", fontSize: 13, textTransform: "capitalize" }}>{f}</button>
        ))}
      </div>
      <div style={{ background: C.card, borderRadius: 16, padding: "0 16px", border: `1px solid ${C.border}` }}>
        {filtered.length === 0
          ? <div style={{ color: C.muted, textAlign: "center", padding: "30px 0" }}>No transactions</div>
          : filtered.map(t => <TxRow key={t.id} t={t} onDelete={onDelete} />)
        }
      </div>
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

  const inp = { width: "100%", padding: "12px 14px", background: "#0B0D14", border: `1px solid ${C.border}`, borderRadius: 10, color: C.text, fontSize: 15, outline: "none", boxSizing: "border-box" };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "flex-end", zIndex: 100, maxWidth: 430, margin: "0 auto" }}>
      <div style={{ background: C.card, width: "100%", borderRadius: "20px 20px 0 0", padding: 24, border: `1px solid ${C.border}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20 }}>
          <h3 style={{ margin: 0 }}>Add Transaction</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", color: C.muted, fontSize: 24, cursor: "pointer", lineHeight: 1 }}>×</button>
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          {["expense", "income"].map(t => (
            <button key={t} onClick={() => setType(t)} style={{ flex: 1, padding: 10, borderRadius: 10, border: `1px solid ${type === t ? C.teal : C.border}`, background: type === t ? "rgba(0,212,170,0.12)" : "transparent", color: type === t ? C.teal : C.muted, cursor: "pointer", fontWeight: 600, textTransform: "capitalize" }}>{t}</button>
          ))}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <input style={inp} type="number" placeholder="Amount ($)" value={amount} onChange={e => setAmount(e.target.value)} />
          <input style={inp} placeholder="Description" value={desc} onChange={e => setDesc(e.target.value)} />
          <select style={{ ...inp, appearance: "none" }} value={catId} onChange={e => { const cat = categories.find(c => c.id === e.target.value); setCatId(e.target.value); setCatName(cat?.name || ""); }}>
            <option value="">Select category</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
          </select>
          <input style={inp} type="date" value={date} onChange={e => setDate(e.target.value)} />
        </div>
        <button onClick={() => { if (!amount || !desc) return; onAdd({ amount: parseFloat(amount), description: desc, category_id: catId || null, category_name: catName, date, type }); }}
          style={{ width: "100%", marginTop: 18, padding: 14, background: `linear-gradient(90deg,${C.teal},${C.blue})`, border: "none", borderRadius: 12, color: "#0B0D14", fontWeight: 700, fontSize: 16, cursor: "pointer" }}>
          Add Transaction
        </button>
      </div>
    </div>
  );
}

// ─── Savings ─────────────────────────────────────────────────
function Savings({ savings, onAdd, onUpdate }) {
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newTarget, setNewTarget] = useState("");
  const [newIcon, setNewIcon] = useState("🎯");
  const inp = { width: "100%", padding: "11px 14px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, color: C.text, fontSize: 14, outline: "none", boxSizing: "border-box", marginBottom: 10 };
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>Savings Goals</h2>
        <button onClick={() => setShowAdd(!showAdd)} style={{ background: `linear-gradient(90deg,${C.teal},${C.blue})`, border: "none", borderRadius: 10, padding: "9px 18px", color: "#0B0D14", fontWeight: 700, cursor: "pointer" }}>+ Goal</button>
      </div>
      {showAdd && (
        <div style={{ background: C.card, borderRadius: 16, padding: 16, marginBottom: 16, border: `1px solid ${C.border}` }}>
          <input style={inp} placeholder="Goal name (e.g. Vacation)" value={newName} onChange={e => setNewName(e.target.value)} />
          <input style={inp} type="number" placeholder="Target amount ($)" value={newTarget} onChange={e => setNewTarget(e.target.value)} />
          <input style={inp} placeholder="Icon" value={newIcon} onChange={e => setNewIcon(e.target.value)} />
          <button onClick={() => { if (!newName || !newTarget) return; onAdd({ name: newName, target: parseFloat(newTarget), current: 0, icon: newIcon, color: C.teal }); setShowAdd(false); setNewName(""); setNewTarget(""); setNewIcon("🎯"); }}
            style={{ width: "100%", padding: 12, background: C.teal, border: "none", borderRadius: 10, color: "#0B0D14", fontWeight: 700, cursor: "pointer" }}>Create Goal</button>
        </div>
      )}
      {savings.length === 0
        ? <div style={{ color: C.muted, textAlign: "center", padding: "40px 0" }}>No savings goals yet</div>
        : savings.map(sv => {
          const pct = sv.target > 0 ? Math.min((sv.current / sv.target) * 100, 100) : 0;
          return (
            <div key={sv.id} style={{ background: C.card, borderRadius: 16, padding: 20, marginBottom: 12, border: `1px solid ${C.border}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <span style={{ fontSize: 26 }}>{sv.icon}</span>
                  <span style={{ fontWeight: 600 }}>{sv.name}</span>
                </div>
                <span style={{ color: C.teal, fontWeight: 700 }}>{pct.toFixed(0)}%</span>
              </div>
              <div style={{ height: 8, background: C.border, borderRadius: 99, marginBottom: 8 }}>
                <div style={{ height: 8, borderRadius: 99, width: `${pct}%`, background: sv.color || C.teal, transition: "width 0.4s" }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", color: C.muted, fontSize: 13, marginBottom: 12 }}>
                <span>${Number(sv.current).toFixed(2)} saved</span>
                <span>Goal: ${Number(sv.target).toFixed(2)}</span>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                {[10, 50, 100].map(amt => (
                  <button key={amt} onClick={() => onUpdate(sv.id, Number(sv.current) + amt)} style={{ flex: 1, padding: "8px", background: "rgba(0,212,170,0.1)", border: `1px solid ${C.teal}`, borderRadius: 8, color: C.teal, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>+${amt}</button>
                ))}
              </div>
            </div>
          );
        })
      }
    </div>
  );
}

// ─── Chat ────────────────────────────────────────────────────
function Chat({ messages, input, setInput, onSend }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "72vh" }}>
      <h2 style={{ margin: "0 0 16px" }}>AI Assistant</h2>
      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
        {messages.map((m, i) => (
          <div key={i} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", background: m.role === "user" ? `linear-gradient(90deg,${C.teal},${C.blue})` : C.card, color: m.role === "user" ? "#0B0D14" : C.text, padding: "12px 16px", borderRadius: m.role === "user" ? "16px 16px 4px 16px" : "16px 16px 16px 4px", maxWidth: "82%", fontSize: 14, border: m.role === "assistant" ? `1px solid ${C.border}` : "none", lineHeight: 1.5 }}>
            {m.text}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && onSend()} placeholder="Ask about your finances..." style={{ flex: 1, padding: "13px 16px", background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, color: C.text, fontSize: 14, outline: "none" }} />
        <button onClick={onSend} style={{ padding: "13px 20px", background: `linear-gradient(90deg,${C.teal},${C.blue})`, border: "none", borderRadius: 12, color: "#0B0D14", fontWeight: 700, cursor: "pointer", fontSize: 18 }}>→</button>
      </div>
    </div>
  );
}

// ─── Profile ─────────────────────────────────────────────────
function Profile({ profile, user, onSave }) {
  const [budget, setBudget] = useState(profile?.monthly_budget || 3000);
  const [goal, setGoal] = useState(profile?.savings_goal || 10000);
  const [saved, setSaved] = useState(false);
  const inp = { width: "100%", padding: "12px 14px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, color: C.text, fontSize: 15, outline: "none", boxSizing: "border-box" };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <h2 style={{ margin: 0 }}>Settings</h2>
      <div style={{ background: C.card, borderRadius: 16, padding: 18, border: `1px solid ${C.border}` }}>
        <div style={{ color: C.muted, fontSize: 12, marginBottom: 4 }}>ACCOUNT</div>
        <div style={{ fontWeight: 500 }}>{user.email}</div>
      </div>
      <div style={{ background: C.card, borderRadius: 16, padding: 18, border: `1px solid ${C.border}` }}>
        <div style={{ fontWeight: 600, marginBottom: 16 }}>Financial Settings</div>
        <div style={{ color: C.muted, fontSize: 12, marginBottom: 6 }}>Monthly Budget ($)</div>
        <input style={{ ...inp, marginBottom: 14 }} type="number" value={budget} onChange={e => setBudget(e.target.value)} />
        <div style={{ color: C.muted, fontSize: 12, marginBottom: 6 }}>Savings Goal ($)</div>
        <input style={{ ...inp, marginBottom: 18 }} type="number" value={goal} onChange={e => setGoal(e.target.value)} />
        <button onClick={async () => { await onSave({ monthly_budget: parseFloat(budget), savings_goal: parseFloat(goal) }); setSaved(true); setTimeout(() => setSaved(false), 2000); }}
          style={{ width: "100%", padding: 13, background: saved ? C.teal : `linear-gradient(90deg,${C.teal},${C.blue})`, border: "none", borderRadius: 12, color: "#0B0D14", fontWeight: 700, cursor: "pointer" }}>
          {saved ? "✓ Saved!" : "Save Settings"}
        </button>
      </div>
      <div style={{ background: C.card, borderRadius: 16, padding: 18, border: `1px solid ${C.border}` }}>
        <div style={{ fontWeight: 600, marginBottom: 12 }}>Coming Next</div>
        {["🏦 Connect Bank (Plaid)", "🤖 Real AI Analysis (OpenAI)", "📱 Mobile App (iOS & Android)"].map(item => (
          <div key={item} style={{ padding: "11px 0", borderBottom: `1px solid ${C.border}`, color: C.muted, fontSize: 14 }}>{item}</div>
        ))}
      </div>
    </div>
  );
}

// ─── Bottom Nav ──────────────────────────────────────────────
function BottomNav({ screen, setScreen }) {
  const tabs = [
    { id: "dashboard", label: "Home" },
    { id: "transactions", label: "Spending" },
    { id: "savings", label: "Savings" },
    { id: "chat", label: "AI" },
    { id: "profile", label: "Settings" },
  ];
  return (
    <div style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 430, background: "rgba(11,13,20,0.96)", backdropFilter: "blur(20px)", borderTop: `1px solid ${C.border}`, display: "flex", padding: "10px 0 18px", zIndex: 50 }}>
      {tabs.map(tab => (
        <button key={tab.id} onClick={() => setScreen(tab.id)} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3, background: "none", border: "none", cursor: "pointer", padding: "4px 0" }}>
          <NavIcon id={tab.id} active={screen === tab.id} />
          <span style={{ fontSize: 10, color: screen === tab.id ? C.teal : C.muted, fontWeight: screen === tab.id ? 700 : 400 }}>{tab.label}</span>
          {screen === tab.id && <div style={{ width: 4, height: 4, borderRadius: 99, background: C.teal, marginTop: 1 }} />}
        </button>
      ))}
    </div>
  );
}
