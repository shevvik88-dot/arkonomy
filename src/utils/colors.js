export const FONT = "'Inter', -apple-system, BlinkMacSystemFont, sans-serif";

// Derived from actual usage across all 7 screens (2026-08-02 audit) — the
// closest round anchors to the real clusters (8/12/16/20 were already the
// most-used discrete values), not invented from scratch. `full` is for
// pills/circles (a value larger than any real element's half-dimension —
// the browser clamps it automatically, same effect as 50% for a single
// border-radius declaration, but self-documenting via the name).
export const RADIUS = { xs: 8, sm: 12, md: 16, lg: 20, full: 999 };

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
  // Muted body text inside Markets.jsx's Alpaca-authorization disclaimer box —
  // local to that one box, not an alpha variant of any existing color.
  alpacaWarningMuted: "#C8B86A",
  // "Pro"/upgrade accent — reused across BottomNav/Markets/Profile/Savings
  // (and App.jsx/UpgradeModal.jsx's own separate local C objects). Distinct
  // from C.purple (#A78BFA) — the two coexist in the same UI element in
  // Savings.jsx's Pro-upsell box, so they must not be merged.
  proAccent: "#7C6BFF",
  // Alpaca-brand gold accent — reused across Markets.jsx's "Authorize
  // Alpaca" heading and App.jsx's alpacaToast "add funds" state (confirmed
  // both are genuinely Alpaca-specific contexts, not a coincidental match).
  alpacaAccent: "#F5C842",
  // Non-US-ticker search-result warning (Markets.jsx). Same hex also
  // appears in App.jsx's trial-ended icon, but that's a coincidental
  // match, not the same feature — kept as two separate constants, not
  // one shared cross-file accent. See C.trialEndedAccent in App.jsx's
  // own local C object.
  nonUsTickerWarning: "#F5A623",
  // "Plaid/bank-connect" blue — reused across Profile.jsx, OnboardingFlow.jsx,
  // and shared/PlaidLinkButton.jsx for the bank-connection CTA/icon/badge.
  bankConnectBlue: "#1A56DB",
  // App.jsx's "Welcome to Pro!" toast text — a deliberate soft off-white
  // (not C.text) tuned for readability against the proAccent gradient
  // background. Kept separate, not merged into C.text (2026-08-02 hex audit).
  proToastText: "#E8EDF5",
  // Secondary/description text across App.jsx's Pro/trial UI cluster (the
  // "Welcome to Pro!" toast subtext and the trial-expired modal). Distinct
  // from C.muted/C.faint — closer to C.faint but not a match, kept as its
  // own token rather than forced onto an unrelated shade (2026-08-02 hex audit).
  proMuted: "#7A8BA8",
};

// Premium-dark redesign palette — approved mockup, 2026-08-04. Dashboard.jsx
// only for now; other screens migrate to this in later, separate passes
// (staged rollout — see BACKLOG.md). Kept in its own namespace rather than
// merged into C: C.emerald already exists at a different hex (#34D399), and
// merging would repaint every screen that imports C, not just Dashboard.
export const DASHBOARD_C = {
  bg:         "#12161F",
  text:       "#F5F6F8",
  gold:       "#E8C97D", // neutral/informational accent
  ruby:       "#D64F5E", // danger/negative — solid fills, borders, badges
  rubyBright: "#E4677A", // lighter ruby — inline emphasized numbers in coach text
  emerald:    "#2FB37D", // positive — income, market gains, sparkline-up
  // Not in the approved hex list — derived, not exact-mockup values.
  // Elevation-principle card fill: noticeably lighter than bg (not a subtle
  // +6/+7/+10 per channel step, which read too close to bg without a
  // border) so cards stay legible with no border at all. Muted/faint kept
  // close to the existing C.muted/C.faint tone so text hierarchy reads the
  // same way as the rest of the app.
  card:  "#1D2433",
  muted: "#9AA4B2",
  faint: "#6B7688",
};

// Muted/desaturated versions of the original bright Tailwind-400 set —
// found 2026-08-09 to read as too "rainbow"/screaming against the
// DASHBOARD_C redesign. HSL remap (S -> 35+S*0.22, L -> L*0.92, hue
// unchanged) computed against the actual DASHBOARD_C accent trio's own
// saturation/lightness range (gold/ruby/emerald sit around S 58-70%,
// L 44-70%) rather than picked by eye. Government/Other/Transfer were
// already desaturated slate greys — left untouched on purpose.
export const CAT_COLORS = {
  "Housing":          "#6898D4",
  "Bills":            "#9781DA",
  "Subscriptions":    "#9781DA",
  "Shopping":         "#CE8950",
  "Food & Dining":    "#D77575",
  "Transport":        "#3BB0A1",
  "Transportation":   "#3BB0A1",
  "Entertainment":    "#D676A8",
  "Health":           "#4BC377",
  "Health & Fitness": "#3DB388",
  "Personal Care":    "#C9A340",
  "Travel":           "#8189DA",
  "Education":        "#4CA5CD",
  "Taxes":            "#B68635",
  "Government":       "#94A3B8",
  "Charity":          "#CA538E",
  "Fees":             "#CA4E4E",
  "Cost of Debt":     "#C37037",
  "Utilities":        "#6DC8D5",
  "Transfers":        "#6769D0",
  "Other":            "#94A3B8",
  "Transfer":         "#475569",
  "Income":           "#3DB388",
};
