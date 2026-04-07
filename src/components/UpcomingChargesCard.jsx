// src/components/UpcomingChargesCard.jsx
// Warning card for an upcoming detected recurring charge.
// Orange/yellow accent normally; red + "Tomorrow!" if daysUntil <= 1.

const FONT = "'Inter', -apple-system, BlinkMacSystemFont, sans-serif";

function fmt(n) {
  return Number(n).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function alpha(hex, a) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}

export default function UpcomingChargesCard({ charge }) {
  const { merchant, amount, daysUntil, expectedDate } = charge;

  const isToday  = daysUntil === 0;
  const isUrgent = daysUntil <= 1;        // today or tomorrow → red
  const isSoon   = daysUntil <= 3;        // within 3 days → yellow

  const accent = isUrgent ? '#FF5C7A' : isSoon ? '#FFB800' : '#FF9320';
  const bg     = isUrgent ? '#120609'  : isSoon ? '#120D00'  : '#120900';
  const border = isUrgent ? '#3D0A12'  : isSoon ? '#3D2C00'  : '#3D1E00';

  const urgencyLabel = isToday
    ? 'Due Today!'
    : isUrgent
    ? 'Tomorrow!'
    : `In ${daysUntil} day${daysUntil !== 1 ? 's' : ''}`;

  return (
    <div style={{
      background: bg,
      border: `1px solid ${border}`,
      borderRadius: 14,
      padding: '11px 14px',
      fontFamily: FONT,
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      boxShadow: `0 2px 12px ${alpha(accent, 0.07)}`,
    }}>
      {/* Icon */}
      <div style={{
        width: 38, height: 38, borderRadius: 11, flexShrink: 0,
        background: alpha(accent, 0.12),
        border: `1px solid ${alpha(accent, 0.25)}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 18,
      }}>
        ⚠️
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between',
          alignItems: 'baseline', gap: 8,
        }}>
          <span style={{
            fontWeight: 700, fontSize: 14, color: '#eef4ff',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {merchant}
          </span>
          <span style={{ fontWeight: 800, fontSize: 15, color: accent, flexShrink: 0 }}>
            ${fmt(amount)}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
          <span style={{
            fontSize: 10, fontWeight: 700, letterSpacing: '.5px',
            color: accent,
            background: alpha(accent, 0.14),
            border: `1px solid ${alpha(accent, 0.35)}`,
            borderRadius: 4, padding: '2px 7px',
          }}>
            {urgencyLabel}
          </span>
          <span style={{ fontSize: 11, color: '#3a5570' }}>{expectedDate}</span>
        </div>
      </div>
    </div>
  );
}
