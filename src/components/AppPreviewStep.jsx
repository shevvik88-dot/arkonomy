import { C, FONT } from "../utils/colors";

const GREEN  = "#00E5A0";
const PURPLE = "#7C3AED";
const RED    = "#EF4444";
const AMBER  = "#F59E0B";
const MUTED  = "#64748B";
const TEXT   = "#F1F5F9";
const SCREEN = "#0F172A";
const SHELL  = "#1E293B";

function PhoneShell({ children }) {
  return (
    <div style={{
      flexShrink: 0,
      scrollSnapAlign: "center",
      width: 140,
      height: 280,
      borderRadius: 24,
      border: "2px solid rgba(255,255,255,0.08)",
      background: SHELL,
      boxShadow: "0 0 30px rgba(124,58,237,0.15)",
      display: "flex",
      flexDirection: "column",
      padding: "8px 5px 5px",
    }}>
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 5 }}>
        <div style={{ width: 32, height: 5, borderRadius: 3, background: SCREEN }} />
      </div>
      <div style={{ flex: 1, background: SCREEN, borderRadius: 18, overflow: "hidden", padding: "8px 7px" }}>
        {children}
      </div>
    </div>
  );
}

function DashboardMockup() {
  return (
    <PhoneShell>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 7 }}>
        <div style={{ width: 16, height: 16, borderRadius: 5, background: "rgba(0,229,160,0.2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontSize: 9, fontWeight: 800, color: GREEN }}>A</span>
        </div>
        <span style={{ fontSize: 8, color: MUTED }}>Viktor</span>
        <span style={{ fontSize: 7, fontWeight: 700, color: GREEN, background: "rgba(0,229,160,0.12)", borderRadius: 4, padding: "1px 4px" }}>PRO</span>
      </div>

      <div style={{ background: "rgba(0,229,160,0.06)", borderRadius: 9, padding: "6px 7px", marginBottom: 5, border: "1px solid rgba(0,229,160,0.1)" }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: GREEN, lineHeight: 1 }}>$2,600.64</div>
        <div style={{ fontSize: 7, color: MUTED, margin: "2px 0 5px" }}>Available in your bank</div>
        <svg width="58" height="14" viewBox="0 0 58 14" fill="none">
          <polyline points="0,12 14,9 29,6 43,4 58,1" stroke={GREEN} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>

      <div style={{ display: "flex", gap: 4, marginBottom: 5 }}>
        <div style={{ flex: 1, background: "rgba(0,229,160,0.07)", borderRadius: 7, padding: "4px 5px" }}>
          <div style={{ fontSize: 7, color: MUTED }}>Income</div>
          <div style={{ fontSize: 9, fontWeight: 700, color: GREEN }}>$6,603</div>
        </div>
        <div style={{ flex: 1, background: "rgba(239,68,68,0.07)", borderRadius: 7, padding: "4px 5px" }}>
          <div style={{ fontSize: 7, color: MUTED }}>Expenses</div>
          <div style={{ fontSize: 9, fontWeight: 700, color: RED }}>$4,249</div>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 6 }}>
        <div style={{ width: 5, height: 5, borderRadius: "50%", background: GREEN, flexShrink: 0 }} />
        <span style={{ fontSize: 8, color: "#94A3B8" }}>Health Score <span style={{ color: GREEN, fontWeight: 700 }}>97</span></span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <div style={{ width: 26, height: 26, borderRadius: "50%", border: "4px solid rgba(124,58,237,0.3)", borderTopColor: PURPLE, flexShrink: 0 }} />
        <span style={{ fontSize: 8, color: MUTED }}>Spending</span>
      </div>
    </PhoneShell>
  );
}

function TransactionsMockup() {
  const rows = [
    { dot: GREEN,    name: "Direct Deposit", cat: "Income",      amount: "+$3,200", amtColor: GREEN },
    { dot: AMBER,    name: "Amazon",         cat: "Shopping",    amount: "-$84.99", amtColor: RED   },
    { dot: "#F97316",name: "Whole Foods",    cat: "Food",        amount: "-$67.20", amtColor: RED   },
  ];
  return (
    <PhoneShell>
      <div style={{ fontSize: 10, fontWeight: 700, color: TEXT, marginBottom: 7 }}>Transactions</div>
      {rows.map((r, i) => (
        <div key={i}>
          {i > 0 && <div style={{ height: 1, background: "rgba(255,255,255,0.05)", margin: "5px 0" }} />}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 22, height: 22, borderRadius: 7, background: r.dot + "1A", border: `1px solid ${r.dot}33`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: r.dot }} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 9, fontWeight: 600, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</div>
              <div style={{ fontSize: 7, color: MUTED }}>{r.cat}</div>
            </div>
            <div style={{ fontSize: 9, fontWeight: 700, color: r.amtColor, flexShrink: 0 }}>{r.amount}</div>
          </div>
        </div>
      ))}
    </PhoneShell>
  );
}

function InsightsMockup() {
  const bars = [55, 40, 75, 30, 100];
  return (
    <PhoneShell>
      <div style={{ fontSize: 10, fontWeight: 700, color: TEXT, marginBottom: 6 }}>Insights</div>

      <div style={{ background: "rgba(124,58,237,0.1)", border: "1px solid rgba(124,58,237,0.25)", borderRadius: 9, padding: "6px 7px", marginBottom: 5 }}>
        <div style={{ fontSize: 7, color: "#A78BFA", fontWeight: 600, marginBottom: 2 }}>✦ AI Insight</div>
        <div style={{ fontSize: 9, fontWeight: 700, color: TEXT, marginBottom: 2 }}>Save $277 this month</div>
        <div style={{ fontSize: 7, color: MUTED, lineHeight: 1.45 }}>You're spending 46% more on dining vs last month.</div>
      </div>

      <div style={{ background: "rgba(0,229,160,0.06)", borderRadius: 9, padding: "5px 7px", marginBottom: 6 }}>
        <div style={{ fontSize: 7, color: MUTED, marginBottom: 1 }}>Financial Health</div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 2 }}>
          <span style={{ fontSize: 17, fontWeight: 800, color: GREEN, lineHeight: 1 }}>97</span>
          <span style={{ fontSize: 8, color: MUTED }}>/100</span>
        </div>
        <div style={{ fontSize: 8, color: GREEN, fontWeight: 600 }}>Excellent</div>
      </div>

      <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 28 }}>
        {bars.map((h, i) => (
          <div key={i} style={{ flex: 1, height: `${h}%`, borderRadius: "2px 2px 0 0", background: i === bars.length - 1 ? PURPLE : "rgba(124,58,237,0.3)" }} />
        ))}
      </div>
    </PhoneShell>
  );
}

const MOCKUPS = [
  { component: <DashboardMockup />,    title: "Smart Dashboard",   text: "Real-time balance & cash flow" },
  { component: <TransactionsMockup />, title: "Every Transaction", text: "Auto-categorized & searchable" },
  { component: <InsightsMockup />,     title: "AI Insights",       text: "Personalized advice, updated daily" },
];

export default function AppPreviewStep({ onNext, onBack }) {
  return (
    <div style={{ minHeight: "100vh", background: SCREEN, display: "flex", flexDirection: "column", padding: "32px 20px 28px", fontFamily: FONT }}>
      <div style={{ textAlign: "center", marginBottom: 32, position: "relative" }}>
        {onBack && (
          <button
            onClick={onBack}
            style={{ position: "absolute", left: 0, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: MUTED, fontSize: 13, cursor: "pointer", fontFamily: FONT }}
          >
            ← Back
          </button>
        )}
        <div style={{ fontSize: 24, fontWeight: 800, color: TEXT, marginBottom: 8 }}>Here's what you get</div>
        <div style={{ fontSize: 14, color: MUTED }}>Join thousands managing money smarter</div>
      </div>

      <div style={{ display: "flex", gap: 12, overflowX: "auto", paddingBottom: 16, scrollSnapType: "x mandatory", WebkitOverflowScrolling: "touch" }}>
        {MOCKUPS.map((m, i) => (
          <div key={i} style={{ scrollSnapAlign: "center", flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
            {m.component}
            <div style={{ textAlign: "center", width: 140 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: TEXT, marginBottom: 2 }}>{m.title}</div>
              <div style={{ fontSize: 11, color: MUTED, lineHeight: 1.4 }}>{m.text}</div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: "auto", paddingTop: 24 }}>
        <button
          onClick={onNext}
          style={{ width: "100%", padding: 16, background: PURPLE, border: "none", borderRadius: 16, color: "#fff", fontWeight: 800, fontSize: 16, cursor: "pointer", fontFamily: FONT, boxShadow: "0 4px 24px rgba(124,58,237,0.4)" }}
        >
          Continue →
        </button>
      </div>
    </div>
  );
}
