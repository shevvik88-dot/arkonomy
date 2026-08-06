import { useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import Icon from "./shared/Icon";
import { FONT, DASHBOARD_C as DC } from "../utils/colors";

const CAT_ICON = {
  housing: "home", rent: "home", mortgage: "home",
  utilities: "zap", electric: "zap",
  insurance: "shield",
  phone: "phone", telecom: "phone",
  internet: "globe",
  streaming: "film", entertainment: "film",
  fitness: "heart", gym: "heart",
  software: "smartphone",
  loan: "bank", finance: "bank", credit: "credit",
  subscriptions: "repeat",
  bills: "file-text",
};

function catIcon(cat) {
  return CAT_ICON[(cat || "").toLowerCase()] ?? "repeat";
}

// Collapsed to the fixed 3-color palette (ruby/gold/emerald) — "due very
// soon" is the only tier that reads as genuinely urgent, so it's the only
// one that gets ruby; everything else is a calmer, informational gold.
function accentColor(daysUntil) {
  if (daysUntil <= 1) return DC.ruby;
  return DC.gold;
}

function urgencyLabel(daysUntil, t) {
  if (daysUntil === 0) return t("dashboard.due_today");
  if (daysUntil === 1) return t("dashboard.due_tomorrow");
  return t("dashboard.due_in_days", { days: daysUntil });
}

function fmtAmt(n) {
  return Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function UpcomingChargesCarousel({ charges }) {
  const { t } = useTranslation();
  const sorted = [...charges].sort((a, b) => a.daysUntil - b.daysUntil);
  const [active, setActive] = useState(0);
  const scrollRef = useRef(null);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const cardW = el.offsetWidth - 36;
    if (cardW <= 0) return;
    setActive(Math.round(el.scrollLeft / (cardW + 10)));
  }

  if (!sorted.length) return null;

  return (
    <div style={{ fontFamily: FONT }}>
      {/* Hide webkit scrollbar */}
      <style>{`.ark-upcoming::-webkit-scrollbar{display:none}`}</style>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10, padding: "0 2px" }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: DC.gold, letterSpacing: 0.5, textTransform: "uppercase" }}>
          {t("dashboard.upcoming_charges")}
        </span>
        <span style={{
          fontSize: 10, color: DC.muted, background: DC.gold + "18",
          border: `1px solid ${DC.gold}33`, borderRadius: 4,
          padding: "1px 6px", fontWeight: 600,
        }}>
          {sorted.length}
        </span>
      </div>

      {/* Scroll container — padding-right lets next card peek */}
      <div
        ref={scrollRef}
        className="ark-upcoming"
        onScroll={handleScroll}
        style={{
          display: "flex",
          gap: 10,
          overflowX: "auto",
          scrollSnapType: "x mandatory",
          WebkitOverflowScrolling: "touch",
          scrollbarWidth: "none",
          paddingBottom: 2,
        }}
      >
        {sorted.map((charge, i) => {
          const col = accentColor(charge.daysUntil);
          const isActive = i === active;

          return (
            <div
              key={`${charge.merchant}-${i}`}
              style={{
                // Card width leaves ~36px of next card visible as peek
                minWidth: "calc(100% - 36px)",
                maxWidth: "calc(100% - 36px)",
                scrollSnapAlign: "start",
                flexShrink: 0,
                // Opacity: active = 1, others = 0.55
                opacity: isActive ? 1 : 0.55,
                transition: "opacity 0.2s ease, box-shadow 0.2s ease",
                // Glassmorphism card
                background: "linear-gradient(135deg, rgba(255,255,255,0.055) 0%, rgba(255,255,255,0.02) 100%)",
                backdropFilter: "blur(10px)",
                border: `1px solid ${isActive ? `rgba(255,255,255,0.1)` : "rgba(255,255,255,0.05)"}`,
                borderRadius: 16,
                boxShadow: isActive ? `0 4px 24px ${col}1A` : "none",
                // Layout
                height: 80,
                boxSizing: "border-box",
                padding: "0 14px",
                display: "flex",
                alignItems: "center",
                gap: 12,
              }}
            >
              {/* Category icon */}
              <div style={{
                width: 42, height: 42, borderRadius: 12, flexShrink: 0,
                background: `${col}18`,
                border: `1px solid ${col}28`,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <Icon name={catIcon(charge.category)} size={18} color={col} />
              </div>

              {/* Merchant + date */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontWeight: 700, fontSize: 14, color: DC.text,
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                }}>
                  {charge.merchant}
                </div>
                <div style={{ fontSize: 11, color: DC.muted, marginTop: 3 }}>
                  {charge.expectedDate}
                </div>
              </div>

              {/* Amount + urgency badge */}
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 5, flexShrink: 0 }}>
                <span style={{ fontWeight: 800, fontSize: 16, color: col, letterSpacing: -0.3 }}>
                  ${fmtAmt(charge.amount)}
                </span>
                <span style={{
                  fontSize: 10, fontWeight: 700, letterSpacing: 0.3,
                  color: col,
                  background: `${col}18`,
                  border: `1px solid ${col}30`,
                  borderRadius: 6, padding: "2px 8px",
                  whiteSpace: "nowrap",
                }}>
                  {urgencyLabel(charge.daysUntil, t)}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Dot indicators */}
      {sorted.length > 1 && (
        <div style={{ display: "flex", justifyContent: "center", gap: 5, marginTop: 9 }}>
          {sorted.map((_, i) => (
            <div key={i} style={{
              width: i === active ? 16 : 5,
              height: 5,
              borderRadius: 99,
              background: i === active ? DC.gold : DC.faint + "44",
              transition: "width 0.2s ease, background 0.2s ease",
            }} />
          ))}
        </div>
      )}
    </div>
  );
}
