// src/components/CheckInCard.jsx
import { useTranslation } from 'react-i18next';
import { getCheckIn } from '../engine/checkInEngine';

const THEME = {
  CRITICAL:          { labelKey:'checkin.critical',          accent:'#e03535', cardBorder:'#3d0808', cardBg:'#0e0606' },
  DANGER:            { labelKey:'checkin.danger',             accent:'#e06020', cardBorder:'#3d1804', cardBg:'#0e0904' },
  NEEDS_ATTENTION:   { labelKey:'checkin.needs_attention',    accent:'#d4a020', cardBorder:'#3a2804', cardBg:'#0e0c04' },
  WATCH_CATEGORY:    { labelKey:'checkin.watch_category',     accent:'#9060d0', cardBorder:'#28104a', cardBg:'#0a080e' },
  UPCOMING_CHARGES:  { labelKey:'checkin.upcoming_charges',   accent:'#FF9320', cardBorder:'#3d2000', cardBg:'#0e0900' },
  STRONG_PROGRESS:   { labelKey:'checkin.strong_progress',    accent:'#4e9eff', cardBorder:'#0c2844', cardBg:'#070d1c' },
  ON_TRACK:          { labelKey:'checkin.on_track',           accent:'#00c98a', cardBorder:'#082c1c', cardBg:'#060e0a' },
  EARLY_STABLE:      { labelKey:'checkin.early_month',        accent:'#4a6080', cardBorder:'#1a2840', cardBg:'#080c14' },
  NO_DATA:           { labelKey:'checkin.no_data',            accent:'#304060', cardBorder:'#162030', cardBg:'#060a10' },
};

const SUBTLE = new Set(['NO_DATA','EARLY_STABLE']);
const FONT   = "'Inter', -apple-system, BlinkMacSystemFont, sans-serif";

function alpha(hex, a) {
  const r=parseInt(hex.slice(1,3),16), g=parseInt(hex.slice(3,5),16), b=parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${a})`;
}

export default function CheckInCard({ data, onAskAI }) {
  const { t } = useTranslation();
  const result = getCheckIn(data);
  const {
    state, insight, projection, action, secondary,
    timeCtx, showSafe, safeMin, safeMax, safeHint, earlyLabel,
  } = result;

  const th       = THEME[state] ?? THEME.ON_TRACK;
  const ac       = th.accent;
  const isSubtle = SUBTLE.has(state);

  return (
    <div style={{ background: th.cardBg, border: `1px solid ${th.cardBorder}`, borderRadius: 16, padding: '11px 13px', fontFamily: FONT, boxShadow: `0 4px 20px ${alpha(th.accent, 0.08)}` }}>

      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom: 8 }}>
        <div style={{ display:'flex', alignItems:'center', gap: 7 }}>
          <div style={{ width:6, height:6, borderRadius:'50%', background: ac, flexShrink:0 }} />
          <span style={{ fontSize:11, fontWeight:700, color: ac, letterSpacing:'.3px' }}>
            AI Financial Autopilot
          </span>
        </div>
        {isSubtle
          ? <span style={{ fontSize:9, color:'#2e4060', fontFamily:'monospace', padding:'3px 8px' }}>{t(th.labelKey)}</span>
          : <span style={{ fontSize:9, fontWeight:700, letterSpacing:'1px', fontFamily:'monospace', borderRadius:4, padding:'3px 8px', border:`1px solid ${alpha(ac,.25)}`, background: alpha(ac,.12), color: ac }}>{t(th.labelKey)}</span>
        }
      </div>

      {/* Early label */}
      {earlyLabel && (
        <div style={{ fontSize:10, color:'#2e4a6a', marginBottom:12, textAlign:'center', padding:'5px 8px', borderRadius:6, background:'rgba(74,96,128,0.08)', border:'1px solid rgba(74,96,128,0.12)' }}>
          {earlyLabel}
        </div>
      )}

      {/* Insight */}
      <div style={{ fontSize:14, fontWeight:700, color:'#eef4ff', lineHeight:1.5, marginBottom:4 }}>
        {insight}
      </div>

      {/* Projection */}
      {projection && (
        <div style={{ fontSize:12, lineHeight:1.5, marginBottom:10, padding:'7px 10px', borderRadius:8, borderLeft:`2px solid ${alpha(ac,.3)}`, background: alpha(ac,.05), color:'#5a7898' }}>
          {projection}
        </div>
      )}

      {/* Secondary */}
      {secondary && (
        <div style={{ fontSize:12, lineHeight:1.5, marginBottom:10, padding:'7px 10px', borderRadius:8, borderLeft:`2px solid ${alpha(ac,.18)}`, background: alpha(ac,.04), color:'#4a6888' }}>
          {secondary}
        </div>
      )}

      {/* Action */}
      {action && (
        <div style={{ borderRadius:10, padding:'11px 13px', marginBottom:11, border:`1px solid ${alpha(ac,.55)}`, background: alpha(ac,.22) }}>
          <div style={{ fontSize:10, fontWeight:700, letterSpacing:'.8px', color: alpha(ac,.6), marginBottom:4, fontFamily:'monospace' }}>
            {t("checkin.action_label")}
          </div>
          <div style={{ fontSize:13, fontWeight:600, color:'#dce8ff', lineHeight:1.5 }}>
            {action}
          </div>
          {timeCtx && (
            <div style={{ fontSize:11, color: alpha(ac,.5), marginTop:5 }}>
              {timeCtx}
            </div>
          )}
        </div>
      )}

      {/* Safe to save */}
      {showSafe && safeMax > 0 && (
        <div style={{ borderRadius:8, padding:'9px 11px', marginBottom:13, border:`1px solid ${alpha(ac,.07)}`, background: alpha(ac,.02) }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:3 }}>
            <span style={{ fontSize:11, color:'#4a6080', fontWeight:600 }}>{t("checkin.safe_to_save")}</span>
            <span style={{ fontSize:14, fontWeight:700, color: ac }}>
              ${safeMin.toLocaleString()} – ${safeMax.toLocaleString()}
            </span>
          </div>
          <div style={{ fontSize:10, color:'#2e4560' }}>{safeHint}</div>
        </div>
      )}

      {/* Button */}
      <button
        onClick={onAskAI}
        style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:6, width:'100%', padding:'9px 0', borderRadius:8, border:`1px solid ${alpha(ac,.22)}`, background: alpha(ac,.08), fontSize:12, fontWeight:700, color: ac, cursor:'pointer', fontFamily: FONT }}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <circle cx="7" cy="7" r="6" stroke={ac} strokeWidth="1.2"/>
          <path d="M5 7h4M7.5 5.5L9 7l-1.5 1.5" stroke={ac} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        {t("checkin.ask_ai")}
      </button>

      {/* Disclaimer */}
      <div style={{ fontSize:9, color:'#1a2d45', textAlign:'center', marginTop:10, lineHeight:1.4 }}>
        {t("checkin.disclaimer")}
      </div>
    </div>
  );
}
