import { useState, useEffect } from 'react';

const COLORS = {
  cash_risk:           { bg: '#2D1515', border: '#FF5C7A', icon: '⚠️' },
  category_spike:      { bg: '#2A1F0E', border: '#FFB800', icon: '📈' },
  overspending:        { bg: '#2A1F0E', border: '#FFB800', icon: '📊' },
  savings_opportunity: { bg: '#0E2A1A', border: '#12D18E', icon: '💡' },
  goal_off_track:      { bg: '#1A1A2E', border: '#A78BFA', icon: '🎯' },
  positive_progress:   { bg: '#0E2A1A', border: '#00C2FF', icon: '✅' },
};

export default function InsightCard({ insight, onAction }) {
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (insight?.autoExpand) setExpanded(true);
  }, [insight?.type]);

  if (!insight) return null;

  const c = COLORS[insight.type] ?? COLORS.overspending;
  const { headline, body, cta, action } = insight.rendered;

  return (
    <div onClick={() => setExpanded(e => !e)} style={{
      background: c.bg, border: `1px solid ${c.border}`,
      borderRadius: 12, padding: '14px 16px', marginBottom: 12, cursor: 'pointer',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 16 }}>{c.icon}</span>
          <span style={{ color: '#fff', fontWeight: 600, fontSize: 14 }}>{headline}</span>
        </div>
        <span style={{ color: '#5AA4B2', fontSize: 11 }}>{expanded ? '▲' : '▼'}</span>
      </div>

      {expanded && (
        <div style={{ marginTop: 10 }}>
          <p style={{ color: '#AAB4C0', fontSize: 13, lineHeight: 1.5, margin: '0 0 12px' }}>{body}</p>
          <button onClick={e => { e.stopPropagation(); onAction?.(action, insight.data); }}
            style={{
              background: c.border, color: '#000', border: 'none',
              borderRadius: 8, padding: '8px 14px', fontWeight: 700,
              fontSize: 13, cursor: 'pointer', width: '100%',
            }}>
            {cta}
          </button>
        </div>
      )}
    </div>
  );
}
