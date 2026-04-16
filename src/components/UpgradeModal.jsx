import { useState } from "react";

const C = {
  bg: "#0B1426",
  bgSecondary: "#131C2E",
  border: "#1E2D45",
  cyan: "#38B6FF",
  green: "#00E5A0",
  purple: "#7C6BFF",
  text: "#E8EDF5",
  muted: "#7A8BA8",
  faint: "#4A5568",
};
const FONT = "'DM Sans', sans-serif";

const BENEFITS = [
  { icon: "🏦", title: "Multiple Bank Accounts", desc: "Connect unlimited banks and track everything in one place" },
  { icon: "🤖", title: "Full AI Insights", desc: "Unlock all AI-powered spending analyses and recommendations" },
  { icon: "🪙", title: "Savings Round-Ups", desc: "Automatically round up spare change and grow your savings" },
  { icon: "📈", title: "Alpaca Investing", desc: "Invest your spare change directly into the stock market" },
  { icon: "📊", title: "Spending Charts", desc: "Full interactive breakdown of spending by category" },
];

export default function UpgradeModal({ onClose, supabase }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function handleUpgrade() {
    setLoading(true);
    setError(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke("stripe-checkout", {});
      if (fnError) {
        let msg = fnError.message ?? "Failed to start checkout";
        try {
          const body = typeof fnError.context?.json === "function" ? await fnError.context.json() : null;
          if (body?.error) msg = body.error;
        } catch {}
        throw new Error(msg);
      }
      if (data?.url) {
        window.location.href = data.url;
      } else {
        throw new Error("No checkout URL returned");
      }
    } catch (err) {
      setError(err.message ?? "Something went wrong");
      setLoading(false);
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(7,12,24,0.88)",
        display: "flex", alignItems: "flex-end", justifyContent: "center",
        backdropFilter: "blur(4px)",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 430,
          background: C.bgSecondary,
          borderRadius: "24px 24px 0 0",
          border: `1px solid ${C.border}`,
          borderBottom: "none",
          padding: "28px 20px 36px",
          fontFamily: FONT,
          color: C.text,
          boxShadow: "0 -8px 48px rgba(0,0,0,0.6)",
        }}
      >
        {/* Handle bar */}
        <div style={{ width: 36, height: 4, borderRadius: 99, background: C.border, margin: "0 auto 24px" }} />

        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: 56, height: 56, borderRadius: 18,
            background: `linear-gradient(135deg, ${C.purple}33, ${C.cyan}22)`,
            border: `1px solid ${C.purple}44`,
            marginBottom: 14,
            fontSize: 26,
          }}>⚡</div>
          <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 6 }}>Upgrade to Pro</div>
          <div style={{ fontSize: 14, color: C.muted }}>Unlock the full Arkonomy experience</div>
        </div>

        {/* Price */}
        <div style={{
          background: `linear-gradient(135deg, ${C.purple}18, ${C.cyan}0A)`,
          border: `1px solid ${C.purple}33`,
          borderRadius: 16, padding: "14px 20px",
          textAlign: "center", marginBottom: 20,
        }}>
          <span style={{ fontSize: 36, fontWeight: 800, color: C.text }}>$9.99</span>
          <span style={{ fontSize: 14, color: C.muted }}> / month</span>
          <div style={{ fontSize: 12, color: C.faint, marginTop: 4 }}>Cancel anytime</div>
        </div>

        {/* Benefits */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 24 }}>
          {BENEFITS.map(b => (
            <div key={b.title} style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
              <span style={{ fontSize: 18, lineHeight: 1 }}>{b.icon}</span>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 1 }}>{b.title}</div>
                <div style={{ fontSize: 12, color: C.muted }}>{b.desc}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Error */}
        {error && (
          <div style={{
            background: "#2D151511", border: "1px solid #E05C5C44",
            borderRadius: 10, padding: "10px 14px",
            color: "#E05C5C", fontSize: 13, marginBottom: 12, textAlign: "center",
          }}>{error}</div>
        )}

        {/* CTA */}
        <button
          onClick={handleUpgrade}
          disabled={loading}
          style={{
            width: "100%", padding: "16px",
            background: loading ? C.border : `linear-gradient(135deg, ${C.purple}, ${C.cyan})`,
            border: "none", borderRadius: 16,
            color: loading ? C.muted : "#000",
            fontWeight: 800, fontSize: 16,
            cursor: loading ? "not-allowed" : "pointer",
            fontFamily: FONT,
            boxShadow: loading ? "none" : `0 4px 24px ${C.purple}44`,
            transition: "all 0.2s",
            marginBottom: 12,
          }}
        >
          {loading ? "Processing..." : "Upgrade Now — $9.99/mo"}
        </button>

        <button
          onClick={onClose}
          style={{
            width: "100%", padding: "12px",
            background: "none", border: `1px solid ${C.border}`,
            borderRadius: 14, color: C.muted,
            fontWeight: 500, fontSize: 14,
            cursor: "pointer", fontFamily: FONT,
          }}
        >
          Maybe later
        </button>
      </div>
    </div>
  );
}
