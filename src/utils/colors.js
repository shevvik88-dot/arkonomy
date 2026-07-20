export const FONT = "'Inter', -apple-system, BlinkMacSystemFont, sans-serif";

export const C = {
  bg: "#0B1426", bgSecondary: "#0F1A2E", bgTertiary: "#162035", bgDeep: "#0E1829",
  card: "#111E33", border: "#1E2D4A", sep: "#192840", cardBgStart: "#0E1E35",
  blue: "#2F80FF", cyan: "#00C2FF", green: "#12D18E",
  red: "#FF5C7A", yellow: "#FFB800", orange: "#F97316", purple: "#A78BFA",
  amber: "#F59E0B", emerald: "#34D399",
  text: "#FFFFFF", muted: "#9AA4B2", faint: "#8BA1B7",
  // Round-up investing CTA (Insights.jsx) — its own accent, doesn't match any
  // color above; kept as its own named group rather than forced onto C.blue.
  roundupAccent: "#8BA7E8",
  roundupAccentBg: "rgba(75,108,183,0.15)",
  roundupAccentBgHover: "rgba(75,108,183,0.25)",
  roundupAccentBorder: "rgba(75,108,183,0.35)",
  // "Urgent/upcoming charges" accent — reused independently by
  // UpcomingChargesCard.jsx and CheckInCard.jsx's UPCOMING_CHARGES state.
  // Close to but not the same shade as C.orange — kept separate so merging
  // them isn't a silent visual regression.
  urgentOrange: "#FF9320",
  // Glass-card text tones (UpcomingChargesCard.jsx) — visually distinct from
  // C.text/C.faint, tuned for a translucent glassmorphism card background.
  // Named (not inlined) since more glass-style cards may reuse them.
  chargeCardText: "#EEF4FF",
  chargeCardDate: "#4A6480",
};

export const CAT_COLORS = {
  "Housing":          "#60A5FA",
  "Bills":            "#A78BFA",
  "Subscriptions":    "#A78BFA",
  "Shopping":         "#FB923C",
  "Food & Dining":    "#F87171",
  "Transport":        "#2DD4BF",
  "Transportation":   "#2DD4BF",
  "Entertainment":    "#F472B6",
  "Health":           "#4ADE80",
  "Health & Fitness": "#34D399",
  "Personal Care":    "#FBBF24",
  "Travel":           "#818CF8",
  "Education":        "#38BDF8",
  "Taxes":            "#F59E0B",
  "Government":       "#94A3B8",
  "Charity":          "#EC4899",
  "Fees":             "#EF4444",
  "Cost of Debt":     "#F97316",
  "Utilities":        "#67E8F9",
  "Transfers":        "#6366F1",
  "Other":            "#94A3B8",
  "Transfer":         "#475569",
  "Income":           "#34D399",
};
