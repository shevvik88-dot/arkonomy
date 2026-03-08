import { useState, useEffect, useRef } from "react";

// ─── MOCK DATA ────────────────────────────────────────────────────────────────
const CATEGORIES = ["Food & Drink", "Transport", "Shopping", "Subscriptions", "Healthcare", "Entertainment", "Utilities", "Income", "Savings"];

const CAT_ICONS = {
  "Food & Drink": "🍔", "Transport": "🚗", "Shopping": "🛍️",
  "Subscriptions": "📱", "Healthcare": "💊", "Entertainment": "🎬",
  "Utilities": "💡", "Income": "💵", "Savings": "🏦"
};

const CAT_COLORS = {
  "Food & Drink": "#FF6B6B", "Transport": "#4ECDC4", "Shopping": "#FFE66D",
  "Subscriptions": "#A29BFE", "Healthcare": "#FD79A8", "Entertainment": "#FDCB6E",
  "Utilities": "#74B9FF", "Income": "#00D4AA", "Savings": "#55EFC4"
};

const ALL_TXN = [
  // January
  { id:1,  date:"2026-01-03", merchant:"Whole Foods",        category:"Food & Drink",    amount:-134.50, pending:false },
  { id:2,  date:"2026-01-05", merchant:"Chevron Gas",        category:"Transport",        amount:-68.20,  pending:false },
  { id:3,  date:"2026-01-07", merchant:"Netflix",            category:"Subscriptions",    amount:-22.99,  pending:false },
  { id:4,  date:"2026-01-08", merchant:"Employer Direct Dep",category:"Income",           amount:3800.00, pending:false },
  { id:5,  date:"2026-01-10", merchant:"Amazon",             category:"Shopping",         amount:-89.99,  pending:false },
  { id:6,  date:"2026-01-12", merchant:"Chipotle",           category:"Food & Drink",    amount:-18.75,  pending:false },
  { id:7,  date:"2026-01-14", merchant:"Spotify",            category:"Subscriptions",    amount:-11.99,  pending:false },
  { id:8,  date:"2026-01-15", merchant:"PG&E Utility",       category:"Utilities",        amount:-145.00, pending:false },
  { id:9,  date:"2026-01-17", merchant:"CVS Pharmacy",       category:"Healthcare",       amount:-34.20,  pending:false },
  { id:10, date:"2026-01-19", merchant:"Uber",               category:"Transport",        amount:-24.50,  pending:false },
  { id:11, date:"2026-01-21", merchant:"Target",             category:"Shopping",         amount:-212.40, pending:false },
  { id:12, date:"2026-01-23", merchant:"Starbucks",          category:"Food & Drink",    amount:-7.85,   pending:false },
  { id:13, date:"2026-01-25", merchant:"AMC Theaters",       category:"Entertainment",    amount:-38.00,  pending:false },
  { id:14, date:"2026-01-28", merchant:"Trader Joe's",       category:"Food & Drink",    amount:-98.30,  pending:false },
  // February
  { id:15, date:"2026-02-01", merchant:"Whole Foods",        category:"Food & Drink",    amount:-142.10, pending:false },
  { id:16, date:"2026-02-03", merchant:"Shell Gas",          category:"Transport",        amount:-72.40,  pending:false },
  { id:17, date:"2026-02-05", merchant:"Netflix",            category:"Subscriptions",    amount:-22.99,  pending:false },
  { id:18, date:"2026-02-07", merchant:"Employer Direct Dep",category:"Income",           amount:3800.00, pending:false },
  { id:19, date:"2026-02-09", merchant:"Apple Store",        category:"Shopping",         amount:-399.00, pending:false },
  { id:20, date:"2026-02-11", merchant:"McDonald's",         category:"Food & Drink",    amount:-14.30,  pending:false },
  { id:21, date:"2026-02-13", merchant:"Spotify",            category:"Subscriptions",    amount:-11.99,  pending:false },
  { id:22, date:"2026-02-15", merchant:"PG&E Utility",       category:"Utilities",        amount:-138.00, pending:false },
  { id:23, date:"2026-02-18", merchant:"Walgreens",          category:"Healthcare",       amount:-28.50,  pending:false },
  { id:24, date:"2026-02-20", merchant:"Lyft",               category:"Transport",        amount:-31.00,  pending:false },
  { id:25, date:"2026-02-22", merchant:"Nike",               category:"Shopping",         amount:-145.00, pending:false },
  { id:26, date:"2026-02-24", merchant:"Blue Bottle Coffee", category:"Food & Drink",    amount:-9.50,   pending:false },
  { id:27, date:"2026-02-26", merchant:"Hulu",               category:"Subscriptions",    amount:-17.99,  pending:false },
  { id:28, date:"2026-02-27", merchant:"Costco",             category:"Shopping",         amount:-187.60, pending:false },
  // March (current month)
  { id:29, date:"2026-03-01", merchant:"Whole Foods",        category:"Food & Drink",    amount:-156.80, pending:false },
  { id:30, date:"2026-03-02", merchant:"Chevron Gas",        category:"Transport",        amount:-71.30,  pending:false },
  { id:31, date:"2026-03-03", merchant:"Netflix",            category:"Subscriptions",    amount:-22.99,  pending:false },
  { id:32, date:"2026-03-04", merchant:"Employer Direct Dep",category:"Income",           amount:3800.00, pending:false },
  { id:33, date:"2026-03-04", merchant:"Amazon",             category:"Shopping",         amount:-67.49,  pending:true  },
  { id:34, date:"2026-03-05", merchant:"Starbucks",          category:"Food & Drink",    amount:-8.45,   pending:false },
  { id:35, date:"2026-03-05", merchant:"Spotify",            category:"Subscriptions",    amount:-11.99,  pending:true  },
];

const INITIAL_SAVINGS = {
  total: 842.36,
  roundups: 127.64,
  deposits: 714.72,
  withdrawals: 0,
  history: [
    { date:"2026-01-31", type:"roundup", amount:42.18, note:"January round-ups" },
    { date:"2026-02-15", type:"deposit", amount:200.00, note:"Manual deposit" },
    { date:"2026-02-28", type:"roundup", amount:51.46, note:"February round-ups" },
    { date:"2026-03-04", type:"deposit", amount:514.72, note:"Auto transfer" },
    { date:"2026-03-05", type:"roundup", amount:34.00, note:"March round-ups so far" },
  ]
};

const CHAT_RESPONSES = {
  default: "Based on your spending patterns, I can see your finances are generally on track. Your income is stable at $3,800/month. Would you like me to analyze a specific category?",
  save: "This month you could save an extra $180 by reducing Food & Drink spending to match your January average, and cutting one streaming subscription you rarely use.",
  money: "Your money this month: $3,800 income → $339 expenses so far. Top categories: Food & Drink ($165), Transport ($71), Subscriptions ($35). You're on track to save ~$680 this month.",
  subscription: "You have 3 active subscriptions: Netflix ($22.99), Spotify ($11.99), Hulu ($17.99). Total: $52.97/month. Consider if you actively use all three — canceling one saves ~$216/year.",
  budget: "Based on California averages for your income level: Food should be ~$400/month, Transport ~$250, Shopping ~$300. You're currently within budget this month.",
  transport: "Your Transport costs are $71.30 this month. Consider carpooling or using public transit for your Elk Grove/Tracy commute — BART passes can save 40-60% vs gas+parking.",
};

function getChatResponse(msg) {
  const m = msg.toLowerCase();
  if (m.includes("save") || m.includes("saving")) return CHAT_RESPONSES.save;
  if (m.includes("money") || m.includes("going") || m.includes("where")) return CHAT_RESPONSES.money;
  if (m.includes("subscri") || m.includes("cancel") || m.includes("netflix") || m.includes("spotify")) return CHAT_RESPONSES.subscription;
  if (m.includes("budget")) return CHAT_RESPONSES.budget;
  if (m.includes("transport") || m.includes("car") || m.includes("gas")) return CHAT_RESPONSES.transport;
  return CHAT_RESPONSES.default;
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function calcRoundup(amount, multiplier) {
  if (amount >= 0) return 0;
  const abs = Math.abs(amount);
  const ceil = Math.ceil(abs);
  return parseFloat(((ceil - abs) * multiplier).toFixed(2));
}

function fmt(n, sign = false) {
  const abs = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (sign && n > 0) return `+$${abs}`;
  if (n < 0) return `-$${abs}`;
  return `$${abs}`;
}

function monthTxns(txns, year, month) {
  return txns.filter(t => {
    const d = new Date(t.date);
    return d.getFullYear() === year && d.getMonth() === month;
  });
}

// ─── DONUT CHART ─────────────────────────────────────────────────────────────
function DonutChart({ data }) {
  const size = 180, stroke = 28, r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const total = data.reduce((s, d) => s + d.value, 0);
  let offset = 0;
  const slices = data.map(d => {
    const pct = d.value / total;
    const dash = pct * circ;
    const gap = circ - dash;
    const slice = { ...d, dash, gap, offset };
    offset += dash;
    return slice;
  });

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(-90deg)" }}>
      {slices.map((s, i) => (
        <circle key={i} cx={size/2} cy={size/2} r={r}
          fill="none" stroke={s.color} strokeWidth={stroke}
          strokeDasharray={`${s.dash} ${s.gap}`}
          strokeDashoffset={-s.offset}
          style={{ transition: "stroke-dasharray 0.6s ease" }} />
      ))}
      <circle cx={size/2} cy={size/2} r={r - stroke/2 - 4} fill="#0F1117" />
    </svg>
  );
}

// ─── BRAND ───────────────────────────────────────────────────────────────────
const BRAND = { name: "Arkonomy", tagline: "Your money on autopilot", accent: "#00D4AA" };

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState("dashboard");
  const [txns, setTxns] = useState(ALL_TXN);
  const [savings, setSavings] = useState(INITIAL_SAVINGS);
  const [roundupOn, setRoundupOn] = useState(true);
  const [multiplier, setMultiplier] = useState(2);
  const [alerts, setAlerts] = useState([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState([
    { role: "assistant", text: "Hi Viktor! I'm your Arkonomy AI. Ask me anything about your finances — 'Where is my money going?', 'How can I save more?', or 'Subscriptions to cancel?'" }
  ]);
  const [chatInput, setChatInput] = useState("");
  const [filterCat, setFilterCat] = useState("All");
  const [filterSearch, setFilterSearch] = useState("");
  const [showAddTxn, setShowAddTxn] = useState(false);
  const [newTxn, setNewTxn] = useState({ merchant:"", category:"Food & Drink", amount:"", date: new Date().toISOString().split("T")[0] });
  const [showDepositModal, setShowDepositModal] = useState(null); // "deposit" | "withdraw"
  const [modalAmount, setModalAmount] = useState("");
  const chatRef = useRef(null);

  // Compute stats
  const now = new Date("2026-03-05");
  const curTxns = monthTxns(txns, 2026, 2); // March = index 2
  const prevTxns = monthTxns(txns, 2026, 1); // February

  const curIncome  = curTxns.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const curExpense = curTxns.filter(t => t.amount < 0 && t.category !== "Savings").reduce((s, t) => s + Math.abs(t.amount), 0);
  const curSaved   = savings.total;
  const prevIncome  = prevTxns.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const prevExpense = prevTxns.filter(t => t.amount < 0 && t.category !== "Savings").reduce((s, t) => s + Math.abs(t.amount), 0);

  const expPct = prevExpense > 0 ? ((curExpense - prevExpense) / prevExpense * 100) : 0;
  const incPct = prevIncome  > 0 ? ((curIncome  - prevIncome)  / prevIncome  * 100) : 0;

  const totalBalance = curIncome - curExpense + 12480.55; // mock starting balance

  // Spending by category (current month, expenses only)
  const catSpend = {};
  curTxns.filter(t => t.amount < 0 && t.category !== "Income" && t.category !== "Savings").forEach(t => {
    catSpend[t.category] = (catSpend[t.category] || 0) + Math.abs(t.amount);
  });
  const donutData = Object.entries(catSpend).map(([cat, val]) => ({ label: cat, value: val, color: CAT_COLORS[cat] || "#888" }));

  // Filtered transactions
  const filteredTxns = txns.filter(t => {
    if (filterCat !== "All" && t.category !== filterCat) return false;
    if (filterSearch && !t.merchant.toLowerCase().includes(filterSearch.toLowerCase())) return false;
    return true;
  }).sort((a, b) => new Date(b.date) - new Date(a.date));

  // Auto-generate alerts
  useEffect(() => {
    const newAlerts = [];
    Object.entries(catSpend).forEach(([cat, amount]) => {
      const prevCatSpend = prevTxns.filter(t => t.category === cat && t.amount < 0)
        .reduce((s, t) => s + Math.abs(t.amount), 0);
      if (prevCatSpend > 0 && amount > prevCatSpend * 1.25) {
        newAlerts.push({ id: cat, type: "overspend", cat, amount, prevAmount: prevCatSpend, pct: Math.round((amount - prevCatSpend) / prevCatSpend * 100) });
      }
    });
    curTxns.filter(t => Math.abs(t.amount) > 200 && t.amount < 0).forEach(t => {
      newAlerts.push({ id: `large-${t.id}`, type: "large", merchant: t.merchant, amount: Math.abs(t.amount), date: t.date });
    });
    setAlerts(newAlerts);
  }, [txns]);

  // Chat
  useEffect(() => { if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight; }, [chatMessages]);

  function sendChat() {
    if (!chatInput.trim()) return;
    const userMsg = { role: "user", text: chatInput };
    const aiMsg = { role: "assistant", text: getChatResponse(chatInput) };
    setChatMessages(prev => [...prev, userMsg, aiMsg]);
    setChatInput("");
  }

  function addTransaction() {
    if (!newTxn.merchant || !newTxn.amount) return;
    const amt = parseFloat(newTxn.amount);
    const t = { ...newTxn, id: Date.now(), amount: newTxn.category === "Income" ? amt : -Math.abs(amt), pending: false };
    setTxns(prev => [t, ...prev]);
    if (roundupOn && t.amount < 0) {
      const ru = calcRoundup(t.amount, multiplier);
      setSavings(prev => ({ ...prev, total: prev.total + ru, roundups: prev.roundups + ru }));
    }
    setNewTxn({ merchant:"", category:"Food & Drink", amount:"", date: new Date().toISOString().split("T")[0] });
    setShowAddTxn(false);
  }

  function handleSavingsAction() {
    const amt = parseFloat(modalAmount);
    if (!amt || amt <= 0) return;
    if (showDepositModal === "deposit") {
      setSavings(prev => ({ ...prev, total: prev.total + amt, deposits: prev.deposits + amt,
        history: [{ date: now.toISOString().split("T")[0], type:"deposit", amount: amt, note:"Manual deposit" }, ...prev.history] }));
    } else {
      if (amt > savings.total) return;
      setSavings(prev => ({ ...prev, total: prev.total - amt, withdrawals: prev.withdrawals + amt,
        history: [{ date: now.toISOString().split("T")[0], type:"withdraw", amount: amt, note:"Manual withdrawal" }, ...prev.history] }));
    }
    setModalAmount("");
    setShowDepositModal(null);
  }

  // ── STYLES ──
  const s = {
    app: { background:"#0B0D14", minHeight:"100vh", fontFamily:"'DM Sans', system-ui, sans-serif", color:"#E8EAF0", maxWidth:430, margin:"0 auto", position:"relative", paddingBottom:80 },
    header: { padding:"20px 20px 0", display:"flex", justifyContent:"space-between", alignItems:"center" },
    logo: { fontSize:18, fontWeight:800, letterSpacing:"-0.5px", lineHeight:1.2 },
    greeting: { fontSize:12, color:"#6B7280" },
    avatar: { width:36, height:36, borderRadius:"50%", background:"linear-gradient(135deg,#00D4AA,#0066FF)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:14, fontWeight:700, cursor:"pointer" },
    card: { background:"#13151F", borderRadius:16, padding:20, margin:"16px 20px 0" },
    cardSmall: { background:"#13151F", borderRadius:12, padding:14 },
    label: { fontSize:11, color:"#6B7280", textTransform:"uppercase", letterSpacing:1, marginBottom:4 },
    bigNum: { fontSize:32, fontWeight:700, letterSpacing:"-1px" },
    subNum: { fontSize:18, fontWeight:600 },
    pill: (active) => ({ padding:"6px 14px", borderRadius:20, fontSize:12, fontWeight:600, cursor:"pointer", border:"none",
      background: active ? "#00D4AA" : "#1E2130", color: active ? "#0B0D14" : "#9CA3AF", transition:"all 0.2s" }),
    txnRow: { display:"flex", alignItems:"center", gap:12, padding:"12px 0", borderBottom:"1px solid #1E2130" },
    txnIcon: (cat) => ({ width:40, height:40, borderRadius:12, background:`${CAT_COLORS[cat]}22`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, flexShrink:0 }),
    navBar: { position:"fixed", bottom:0, left:"50%", transform:"translateX(-50%)", width:"100%", maxWidth:430, background:"#0F1117", borderTop:"1px solid #1E2130", display:"flex", justifyContent:"space-around", padding:"10px 0 16px", zIndex:100 },
    navItem: (active) => ({ display:"flex", flexDirection:"column", alignItems:"center", gap:3, cursor:"pointer", padding:"4px 12px", borderRadius:12, background: active ? "#00D4AA15" : "transparent" }),
    navIcon: (active) => ({ fontSize:20 }),
    navLabel: (active) => ({ fontSize:10, color: active ? "#00D4AA" : "#6B7280", fontWeight: active ? 700 : 400 }),
    badge: (color) => ({ background:`${color}22`, color, borderRadius:6, padding:"2px 8px", fontSize:11, fontWeight:600 }),
    toggle: (on) => ({ width:48, height:26, borderRadius:13, background: on ? "#00D4AA" : "#2D3748", position:"relative", cursor:"pointer", transition:"background 0.3s", flexShrink:0 }),
    toggleKnob: (on) => ({ position:"absolute", top:3, left: on ? 24 : 3, width:20, height:20, borderRadius:"50%", background:"#fff", transition:"left 0.3s" }),
    input: { background:"#1E2130", border:"1px solid #2D3748", borderRadius:10, padding:"10px 14px", color:"#E8EAF0", fontSize:14, width:"100%", outline:"none", boxSizing:"border-box" },
    btn: (variant="primary") => ({ padding:"12px 20px", borderRadius:12, border:"none", fontWeight:700, fontSize:14, cursor:"pointer",
      background: variant==="primary" ? "#00D4AA" : variant==="danger" ? "#FF6B6B22" : "#1E2130",
      color: variant==="primary" ? "#0B0D14" : variant==="danger" ? "#FF6B6B" : "#9CA3AF" }),
    alertCard: (type) => ({ background: type==="overspend" ? "#FF6B6B11" : "#FFE66D11", border:`1px solid ${type==="overspend" ? "#FF6B6B33" : "#FFE66D33"}`, borderRadius:12, padding:14, marginBottom:10 }),
    insightCard: { background:"#13151F", border:"1px solid #1E2130", borderRadius:14, padding:16, marginBottom:12 },
    chatBubble: (role) => ({ maxWidth:"85%", padding:"10px 14px", borderRadius: role==="user" ? "16px 16px 4px 16px" : "16px 16px 16px 4px", background: role==="user" ? "#00D4AA" : "#1E2130", color: role==="user" ? "#0B0D14" : "#E8EAF0", fontSize:14, lineHeight:1.5, alignSelf: role==="user" ? "flex-end" : "flex-start" }),
    modal: { position:"fixed", inset:0, background:"#000000CC", display:"flex", alignItems:"flex-end", justifyContent:"center", zIndex:200 },
    modalBox: { background:"#13151F", borderRadius:"20px 20px 0 0", padding:24, width:"100%", maxWidth:430 },
  };

  // ── NAV ITEMS ──
  const navItems = [
    { id:"dashboard", icon:"⬡", label:"Home" },
    { id:"transactions", icon:"↕", label:"Activity" },
    { id:"savings", icon:"◎", label:"Savings" },
    { id:"insights", icon:"✦", label:"Insights" },
    { id:"alerts", icon:"◉", label:"Alerts" },
  ];

  // ── SCREENS ──
  function Dashboard() {
    return (
      <div>
        {/* Balance Card */}
        <div style={{ ...s.card, background:"linear-gradient(135deg,#0066FF18,#00D4AA18)", border:"1px solid #00D4AA22" }}>
          <div style={s.label}>Total Balance</div>
          <div style={{ ...s.bigNum, color:"#00D4AA" }}>{fmt(totalBalance)}</div>
          <div style={{ fontSize:12, color:"#6B7280", marginTop:4 }}>Updated just now · March 2026</div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:12, marginTop:18 }}>
            {[
              { label:"Income", val:curIncome, pct:incPct, color:"#00D4AA" },
              { label:"Expenses", val:curExpense, pct:expPct, color:"#FF6B6B" },
              { label:"Savings", val:curSaved, pct:null, color:"#A29BFE" },
            ].map(item => (
              <div key={item.label} style={{ background:"#ffffff08", borderRadius:10, padding:10 }}>
                <div style={{ fontSize:10, color:"#6B7280", marginBottom:4 }}>{item.label}</div>
                <div style={{ fontSize:15, fontWeight:700, color:item.color }}>{item.label==="Expenses" ? fmt(item.val) : fmt(item.val)}</div>
                {item.pct !== null && (
                  <div style={{ fontSize:10, color: item.pct > 0 ? "#FF6B6B" : "#00D4AA", marginTop:2 }}>
                    {item.pct > 0 ? "↑" : "↓"} {Math.abs(item.pct).toFixed(1)}% vs Feb
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Donut Chart */}
        <div style={{ ...s.card, display:"flex", gap:16, alignItems:"center" }}>
          <div style={{ position:"relative", flexShrink:0 }}>
            <DonutChart data={donutData} />
            <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center" }}>
              <div style={{ fontSize:11, color:"#6B7280" }}>Spent</div>
              <div style={{ fontSize:18, fontWeight:700 }}>{fmt(curExpense)}</div>
            </div>
          </div>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:13, fontWeight:600, marginBottom:10 }}>Spending by Category</div>
            {donutData.slice(0,5).map(d => (
              <div key={d.label} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:7 }}>
                <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                  <div style={{ width:8, height:8, borderRadius:"50%", background:d.color, flexShrink:0 }} />
                  <span style={{ fontSize:11, color:"#9CA3AF" }}>{d.label}</span>
                </div>
                <span style={{ fontSize:11, fontWeight:600 }}>{fmt(d.value)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Recent Transactions */}
        <div style={s.card}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
            <div style={{ fontWeight:700, fontSize:15 }}>Recent</div>
            <div style={{ fontSize:12, color:"#00D4AA", cursor:"pointer" }} onClick={() => setTab("transactions")}>See all →</div>
          </div>
          {txns.slice(0,6).map(t => (
            <div key={t.id} style={s.txnRow}>
              <div style={s.txnIcon(t.category)}>{CAT_ICONS[t.category] || "💳"}</div>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:14, fontWeight:600 }}>{t.merchant}</div>
                <div style={{ fontSize:11, color:"#6B7280" }}>{t.category} · {t.date}</div>
              </div>
              <div style={{ textAlign:"right" }}>
                <div style={{ fontSize:14, fontWeight:700, color: t.amount > 0 ? "#00D4AA" : "#E8EAF0" }}>{fmt(t.amount)}</div>
                {t.pending && <div style={{ fontSize:10, color:"#FFE66D" }}>Pending</div>}
              </div>
            </div>
          ))}
        </div>

        {/* Arkonomy Banner */}
        <div style={{ ...s.card, background:"linear-gradient(135deg,#00D4AA18,#0066FF18)", border:"1px solid #00D4AA33", display:"flex", alignItems:"center", gap:14 }}>
          <div style={{ fontSize:28 }}>✦</div>
          <div>
            <div style={{ fontWeight:700, fontSize:14 }}>Arkonomy Autopilot is ON</div>
            <div style={{ fontSize:12, color:"#9CA3AF", marginTop:2 }}>Round-up {multiplier}x active · Saving quietly in the background</div>
          </div>
          <div style={{ marginLeft:"auto", fontSize:12, color:"#00D4AA", cursor:"pointer" }} onClick={() => setTab("savings")}>Manage →</div>
        </div>
      </div>
    );
  }

  function Transactions() {
    return (
      <div>
        <div style={s.card}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
            <div style={{ fontWeight:700, fontSize:16 }}>All Transactions</div>
            <button style={s.btn()} onClick={() => setShowAddTxn(true)}>+ Add</button>
          </div>
          {/* Search */}
          <input style={{ ...s.input, marginBottom:12 }} placeholder="🔍  Search merchant..." value={filterSearch} onChange={e => setFilterSearch(e.target.value)} />
          {/* Category filter */}
          <div style={{ display:"flex", gap:8, overflowX:"auto", paddingBottom:8, marginBottom:4 }}>
            {["All", ...CATEGORIES].map(cat => (
              <button key={cat} style={{ ...s.pill(filterCat === cat), whiteSpace:"nowrap" }} onClick={() => setFilterCat(cat)}>{cat}</button>
            ))}
          </div>
        </div>
        <div style={s.card}>
          {filteredTxns.length === 0 && <div style={{ textAlign:"center", color:"#6B7280", padding:20 }}>No transactions found</div>}
          {filteredTxns.map(t => (
            <div key={t.id} style={s.txnRow}>
              <div style={s.txnIcon(t.category)}>{CAT_ICONS[t.category] || "💳"}</div>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:14, fontWeight:600 }}>{t.merchant}</div>
                <div style={{ fontSize:11, color:"#6B7280", marginTop:2 }}>
                  <span style={s.badge(CAT_COLORS[t.category] || "#888")}>{t.category}</span>
                  <span style={{ marginLeft:6 }}>{t.date}</span>
                </div>
              </div>
              <div style={{ textAlign:"right" }}>
                <div style={{ fontSize:14, fontWeight:700, color: t.amount > 0 ? "#00D4AA" : "#E8EAF0" }}>{fmt(t.amount)}</div>
                {t.pending && <div style={{ fontSize:10, color:"#FFE66D", marginTop:2 }}>⏳ Pending</div>}
                {roundupOn && t.amount < 0 && (
                  <div style={{ fontSize:10, color:"#A29BFE", marginTop:2 }}>+{fmt(calcRoundup(t.amount, multiplier))} saved</div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  function Savings() {
    return (
      <div>
        {/* Main savings card */}
        <div style={{ ...s.card, background:"linear-gradient(135deg,#A29BFE22,#00D4AA22)", border:"1px solid #A29BFE33", textAlign:"center" }}>
          <div style={s.label}>Total Saved</div>
          <div style={{ ...s.bigNum, color:"#A29BFE", fontSize:40 }}>{fmt(savings.total)}</div>
          <div style={{ fontSize:12, color:"#9CA3AF", marginTop:4 }}>Growing automatically with every purchase</div>
          <div style={{ display:"flex", gap:12, marginTop:20 }}>
            <button style={{ ...s.btn(), flex:1 }} onClick={() => setShowDepositModal("deposit")}>＋ Deposit</button>
            <button style={{ ...s.btn("secondary"), flex:1 }} onClick={() => setShowDepositModal("withdraw")}>－ Withdraw</button>
          </div>
        </div>

        {/* Stats */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10, margin:"12px 20px 0" }}>
          {[
            { label:"Round-ups", val:savings.roundups, color:"#00D4AA" },
            { label:"Deposits", val:savings.deposits, color:"#A29BFE" },
            { label:"Withdrawn", val:savings.withdrawals, color:"#FF6B6B" },
          ].map(item => (
            <div key={item.label} style={{ ...s.cardSmall, textAlign:"center" }}>
              <div style={{ fontSize:10, color:"#6B7280", marginBottom:4 }}>{item.label}</div>
              <div style={{ fontSize:16, fontWeight:700, color:item.color }}>{fmt(item.val)}</div>
            </div>
          ))}
        </div>

        {/* Autopilot toggle */}
        <div style={{ ...s.card, display:"flex", alignItems:"center", gap:14 }}>
          <div style={{ flex:1 }}>
            <div style={{ fontWeight:700, fontSize:15 }}>Auto Round-up</div>
            <div style={{ fontSize:12, color:"#9CA3AF", marginTop:2 }}>Round up every purchase to the nearest dollar</div>
          </div>
          <div style={s.toggle(roundupOn)} onClick={() => setRoundupOn(v => !v)}>
            <div style={s.toggleKnob(roundupOn)} />
          </div>
        </div>

        {/* Multiplier */}
        <div style={s.card}>
          <div style={{ fontWeight:700, fontSize:15, marginBottom:12 }}>Round-up Multiplier</div>
          <div style={{ display:"flex", gap:10 }}>
            {[1, 2, 3, 5].map(m => (
              <button key={m} style={{ ...s.pill(multiplier === m), flex:1, padding:"10px 0" }} onClick={() => setMultiplier(m)}>{m}x</button>
            ))}
          </div>
          <div style={{ fontSize:12, color:"#6B7280", marginTop:10 }}>
            Example: $4.75 purchase → saves {fmt(calcRoundup(-4.75, multiplier))} (at {multiplier}x)
          </div>
        </div>

        {/* History */}
        <div style={s.card}>
          <div style={{ fontWeight:700, fontSize:15, marginBottom:12 }}>History</div>
          {savings.history.map((h, i) => (
            <div key={i} style={s.txnRow}>
              <div style={{ width:36, height:36, borderRadius:10, background: h.type==="deposit"||h.type==="roundup" ? "#00D4AA22" : "#FF6B6B22", display:"flex", alignItems:"center", justifyContent:"center", fontSize:16 }}>
                {h.type==="roundup" ? "✦" : h.type==="deposit" ? "↓" : "↑"}
              </div>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:13, fontWeight:600 }}>{h.note}</div>
                <div style={{ fontSize:11, color:"#6B7280" }}>{h.date}</div>
              </div>
              <div style={{ fontSize:14, fontWeight:700, color: h.type==="withdraw" ? "#FF6B6B" : "#00D4AA" }}>
                {h.type==="withdraw" ? "-" : "+"}{fmt(h.amount)}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  function Insights() {
    const insights = [
      { icon:"🔴", title:"Food spending up this month", desc:`You've spent ${fmt(catSpend["Food & Drink"] || 0)} on Food & Drink — up vs last month's average. Consider meal prepping to cut costs.`, action:"Why? Ask AI", prompt:"Why is my food spending high?" },
      { icon:"🛍️", title:"Shopping under control", desc:`Shopping is ${fmt(catSpend["Shopping"] || 0)} this month — within your typical range. No action needed.`, action:"Details", prompt:"Tell me about my shopping habits" },
      { icon:"💡", title:"Unaccounted cashflow", desc:`Income ${fmt(curIncome)} - Expenses ${fmt(curExpense)} = ${fmt(curIncome - curExpense)} unallocated. Consider moving some to savings.`, action:"Why? Ask AI", prompt:"What should I do with my extra money?" },
      { icon:"📱", title:"3 active subscriptions", desc:"Netflix $22.99 + Spotify $11.99 + Hulu $17.99 = $52.97/month. Do you use all three?", action:"Review with AI", prompt:"Subscriptions to cancel?" },
      { icon:"🚗", title:"Transport steady", desc:`Transport spending at ${fmt(catSpend["Transport"] || 0)} this month. Consistent with previous months.`, action:"Optimize", prompt:"How can I reduce transport costs?" },
    ];
    return (
      <div>
        <div style={{ padding:"0 20px 16px" }}>
          <div style={{ fontSize:18, fontWeight:700, marginBottom:4 }}>Arkonomy Insights</div>
          <div style={{ fontSize:13, color:"#6B7280" }}>Personalized for your spending patterns</div>
        </div>
        {insights.map((ins, i) => (
          <div key={i} style={{ ...s.insightCard, margin:"0 20px 12px" }}>
            <div style={{ display:"flex", gap:12, alignItems:"flex-start" }}>
              <div style={{ fontSize:24 }}>{ins.icon}</div>
              <div style={{ flex:1 }}>
                <div style={{ fontWeight:700, fontSize:14, marginBottom:4 }}>{ins.title}</div>
                <div style={{ fontSize:12, color:"#9CA3AF", lineHeight:1.6 }}>{ins.desc}</div>
                <button style={{ ...s.btn(), marginTop:10, padding:"7px 14px", fontSize:12 }}
                  onClick={() => { setChatMessages(prev => [...prev, { role:"user", text:ins.prompt }, { role:"assistant", text:getChatResponse(ins.prompt) }]); setChatOpen(true); }}>
                  {ins.action} →
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  function AlertsScreen() {
    return (
      <div>
        <div style={{ padding:"0 20px 16px" }}>
          <div style={{ fontSize:18, fontWeight:700, marginBottom:4 }}>Arkonomy Alerts</div>
          <div style={{ fontSize:13, color:"#6B7280" }}>Smart rules watching your money 24/7</div>
        </div>
        {alerts.length === 0 && (
          <div style={{ ...s.card, textAlign:"center", color:"#6B7280", padding:32 }}>
            <div style={{ fontSize:32, marginBottom:8 }}>✦</div>
            <div>All clear — no alerts this month!</div>
          </div>
        )}
        {alerts.map(alert => (
          <div key={alert.id} style={{ ...s.alertCard(alert.type), margin:"0 20px 10px" }}>
            <div style={{ display:"flex", gap:12, alignItems:"flex-start" }}>
              <div style={{ fontSize:22 }}>{alert.type==="overspend" ? "⚠️" : "🔔"}</div>
              <div style={{ flex:1 }}>
                {alert.type==="overspend" && (
                  <>
                    <div style={{ fontWeight:700, fontSize:14, color:"#FF6B6B" }}>{alert.cat} up {alert.pct}%</div>
                    <div style={{ fontSize:12, color:"#9CA3AF", marginTop:2 }}>
                      {fmt(alert.amount)} this month vs {fmt(alert.prevAmount)} last month
                    </div>
                  </>
                )}
                {alert.type==="large" && (
                  <>
                    <div style={{ fontWeight:700, fontSize:14, color:"#FFE66D" }}>Large transaction detected</div>
                    <div style={{ fontSize:12, color:"#9CA3AF", marginTop:2 }}>
                      {alert.merchant} · {fmt(alert.amount)} on {alert.date}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
        {/* Rules */}
        <div style={s.card}>
          <div style={{ fontWeight:700, fontSize:15, marginBottom:12 }}>Active Rules</div>
          {[
            { icon:"📊", rule:"Alert if category +25% vs last month", on:true },
            { icon:"💰", rule:"Alert if single transaction > $200", on:true },
            { icon:"📧", rule:"Weekly email report (mock)", on:true },
          ].map((r, i) => (
            <div key={i} style={{ display:"flex", alignItems:"center", gap:12, padding:"10px 0", borderBottom:"1px solid #1E2130" }}>
              <div style={{ fontSize:18 }}>{r.icon}</div>
              <div style={{ flex:1, fontSize:13 }}>{r.rule}</div>
              <div style={{ fontSize:11, color:"#00D4AA", fontWeight:700 }}>ON</div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── RENDER ──
  return (
    <div style={s.app}>
      {/* Header */}
      <div style={s.header}>
        <div>
          <div style={s.logo}>
            <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-1px" }}>
              <span style={{ color: "#00D4AA" }}>ark</span>
              <span style={{ color: "#E8EAF0" }}>onomy</span>
            </span>
          </div>
          <div style={s.greeting}>Your money on autopilot ✦</div>
        </div>
        <div style={s.avatar} onClick={() => alert("Profile: Viktor\nLocation: Elk Grove / Tracy, CA\n\narkonomy.com\n\n⚠️ Educational purposes only.\nNot financial advice.")}>V</div>
      </div>

      {/* Page title */}
      <div style={{ padding:"18px 20px 4px" }}>
        <div style={{ fontSize:22, fontWeight:700 }}>
          {tab==="dashboard" && "Dashboard"}
          {tab==="transactions" && "Transactions"}
          {tab==="savings" && "Savings"}
          {tab==="insights" && "Insights"}
          {tab==="alerts" && `Alerts ${alerts.length > 0 ? `· ${alerts.length}` : ""}`}
        </div>
      </div>

      {/* Screens */}
      {tab==="dashboard"     && <Dashboard />}
      {tab==="transactions"  && <Transactions />}
      {tab==="savings"       && <Savings />}
      {tab==="insights"      && <Insights />}
      {tab==="alerts"        && <AlertsScreen />}

      {/* Nav Bar */}
      <div style={s.navBar}>
        {navItems.map(n => (
          <div key={n.id} style={s.navItem(tab===n.id)} onClick={() => setTab(n.id)}>
            <div style={s.navIcon(tab===n.id)}>{n.icon}</div>
            <div style={s.navLabel(tab===n.id)}>{n.label}</div>
          </div>
        ))}
      </div>

      {/* Chat FAB */}
      <div style={{ position:"fixed", bottom:90, right:"max(20px, calc(50% - 195px))", zIndex:150 }}>
        <button style={{ width:52, height:52, borderRadius:"50%", background:"linear-gradient(135deg,#0066FF,#00D4AA)", border:"none", fontSize:22, cursor:"pointer", boxShadow:"0 4px 20px #00D4AA44", display:"flex", alignItems:"center", justifyContent:"center" }}
          onClick={() => setChatOpen(true)}>✦</button>
      </div>

      {/* Chat Modal */}
      {chatOpen && (
        <div style={s.modal} onClick={e => e.target === e.currentTarget && setChatOpen(false)}>
          <div style={{ ...s.modalBox, height:"70vh", display:"flex", flexDirection:"column" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
              <div>
                <div style={{ fontWeight:700, fontSize:16 }}>✦ Arkonomy AI</div>
                <div style={{ fontSize:11, color:"#6B7280" }}>Your personal finance assistant</div>
              </div>
              <button style={{ background:"none", border:"none", color:"#9CA3AF", fontSize:20, cursor:"pointer" }} onClick={() => setChatOpen(false)}>✕</button>
            </div>
            <div ref={chatRef} style={{ flex:1, overflowY:"auto", display:"flex", flexDirection:"column", gap:10, marginBottom:14 }}>
              {chatMessages.map((m, i) => (
                <div key={i} style={s.chatBubble(m.role)}>{m.text}</div>
              ))}
            </div>
            <div style={{ display:"flex", gap:10 }}>
              <input style={{ ...s.input, flex:1 }} placeholder="Ask about your finances..." value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => e.key==="Enter" && sendChat()} />
              <button style={{ ...s.btn(), padding:"10px 16px" }} onClick={sendChat}>↑</button>
            </div>
            <div style={{ display:"flex", gap:8, marginTop:10, overflowX:"auto" }}>
              {["Save money", "Where is my money?", "Subscriptions?", "My budget"].map(q => (
                <button key={q} style={{ ...s.pill(false), whiteSpace:"nowrap", fontSize:11 }}
                  onClick={() => { setChatInput(q); }}>
                  {q}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Add Transaction Modal */}
      {showAddTxn && (
        <div style={s.modal} onClick={e => e.target === e.currentTarget && setShowAddTxn(false)}>
          <div style={s.modalBox}>
            <div style={{ fontWeight:700, fontSize:16, marginBottom:16 }}>Add Transaction</div>
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              <input style={s.input} placeholder="Merchant name" value={newTxn.merchant} onChange={e => setNewTxn(p => ({...p, merchant:e.target.value}))} />
              <input style={s.input} type="number" placeholder="Amount (e.g. 45.50)" value={newTxn.amount} onChange={e => setNewTxn(p => ({...p, amount:e.target.value}))} />
              <select style={s.input} value={newTxn.category} onChange={e => setNewTxn(p => ({...p, category:e.target.value}))}>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <input style={s.input} type="date" value={newTxn.date} onChange={e => setNewTxn(p => ({...p, date:e.target.value}))} />
              <div style={{ display:"flex", gap:10, marginTop:4 }}>
                <button style={{ ...s.btn("secondary"), flex:1 }} onClick={() => setShowAddTxn(false)}>Cancel</button>
                <button style={{ ...s.btn(), flex:1 }} onClick={addTransaction}>Add</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Deposit/Withdraw Modal */}
      {showDepositModal && (
        <div style={s.modal} onClick={e => e.target === e.currentTarget && setShowDepositModal(null)}>
          <div style={s.modalBox}>
            <div style={{ fontWeight:700, fontSize:16, marginBottom:16, textTransform:"capitalize" }}>{showDepositModal}</div>
            <input style={{ ...s.input, marginBottom:14 }} type="number" placeholder="Amount" value={modalAmount} onChange={e => setModalAmount(e.target.value)} />
            <div style={{ display:"flex", gap:10 }}>
              <button style={{ ...s.btn("secondary"), flex:1 }} onClick={() => setShowDepositModal(null)}>Cancel</button>
              <button style={{ ...s.btn(showDepositModal==="withdraw" ? "danger" : "primary"), flex:1 }} onClick={handleSavingsAction}>Confirm</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
