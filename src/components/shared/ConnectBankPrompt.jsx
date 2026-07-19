import { useTranslation } from "react-i18next";
import { C, FONT } from "../../utils/colors";

// Shared "connect your bank" empty state — same card/CTA used by every
// section gated on bankConnected across screens (Dashboard's Cash Flow
// Forecast, Account Balance, Monthly Cash Flow, Month Calendar; also
// Transactions, Insights), so a user without a bank sees one consistent
// prompt instead of a different empty/skeleton state per section.
export function ConnectBankPrompt({ title, message, onNavigate }) {
  const { t } = useTranslation();
  return (
    <div style={{ background: `linear-gradient(145deg,${C.cardBgStart},${C.bg})`, borderRadius: 20, padding: '16px 18px', border: `1px solid ${C.border}` }}>
      <div style={{ fontSize: 10, color: C.muted, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 12 }}>{title}</div>
      <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.6, marginBottom: 14 }}>
        {message}
      </div>
      <button
        onClick={() => onNavigate('profile')}
        style={{ width: '100%', padding: '11px 0', background: `linear-gradient(90deg,${C.cyan},${C.blue})`, border: 'none', borderRadius: 12, color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: FONT, boxShadow: `0 4px 14px ${C.cyan}44` }}
      >
        {t('dashboard.connect_bank')}
      </button>
    </div>
  );
}
