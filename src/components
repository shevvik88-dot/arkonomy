// CheckInCard.jsx
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { getCheckIn } from './checkInEngine';

const THEME = {
  CRITICAL:        { label: 'Critical',        accent: '#e03535', cardBorder: '#3d0808', cardBg: '#0e0606' },
  DANGER:          { label: 'Danger',           accent: '#e06020', cardBorder: '#3d1804', cardBg: '#0e0904' },
  NEEDS_ATTENTION: { label: 'Needs Attention',  accent: '#d4a020', cardBorder: '#3a2804', cardBg: '#0e0c04' },
  WATCH_CATEGORY:  { label: 'Watch Category',   accent: '#9060d0', cardBorder: '#28104a', cardBg: '#0a080e' },
  STRONG_PROGRESS: { label: 'Strong Progress',  accent: '#4e9eff', cardBorder: '#0c2844', cardBg: '#070d1c' },
  ON_TRACK:        { label: 'On Track',         accent: '#00c98a', cardBorder: '#082c1c', cardBg: '#060e0a' },
  EARLY_STABLE:    { label: 'Early Month',      accent: '#4a6080', cardBorder: '#1a2840', cardBg: '#080c14' },
  NO_DATA:         { label: 'No Data',          accent: '#304060', cardBorder: '#162030', cardBg: '#060a10' },
};

const SUBTLE_STATES = new Set(['NO_DATA', 'EARLY_STABLE']);

function hex2rgba(hex, a) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}

export default function CheckInCard({ data, onAskAI }) {
  // data shape: { spent, budget, income, savingsRate, day, spikePct, catSpend, cat }
  const result = getCheckIn(data);
  const { state, insight, projection, action, secondary, timeCtx,
          showSafe, safeMin, safeMax, safeHint, earlyLabel } = result;

  const th      = THEME[state] ?? THEME.ON_TRACK;
  const ac      = th.accent;
  const isSubtle = SUBTLE_STATES.has(state);

  return (
    <View style={[s.card, { backgroundColor: th.cardBg, borderColor: th.cardBorder }]}>

      {/* Header */}
      <View style={s.header}>
        <View style={s.titleRow}>
          <View style={[s.dot, { backgroundColor: ac }]} />
          <Text style={[s.titleText, { color: ac }]}>AI Financial Autopilot</Text>
        </View>
        {isSubtle
          ? <Text style={s.subtleLabel}>{th.label}</Text>
          : <View style={[s.badge, { backgroundColor: hex2rgba(ac, 0.12), borderColor: hex2rgba(ac, 0.25) }]}>
              <Text style={[s.badgeText, { color: ac }]}>{th.label}</Text>
            </View>
        }
      </View>

      {/* Early label — tone-matched, never reassuring in warning states */}
      {earlyLabel && (
        <View style={s.earlyWrap}>
          <Text style={s.earlyText}>{earlyLabel}</Text>
        </View>
      )}

      {/* Primary insight */}
      <Text style={s.insight}>{insight}</Text>

      {/* Projection */}
      {projection && (
        <View style={[s.projRow, { borderLeftColor: hex2rgba(ac, 0.3), backgroundColor: hex2rgba(ac, 0.05) }]}>
          <Text style={s.projText}>{projection}</Text>
        </View>
      )}

      {/* Secondary (category note) */}
      {secondary && (
        <View style={[s.projRow, { borderLeftColor: hex2rgba(ac, 0.18), backgroundColor: hex2rgba(ac, 0.04) }]}>
          <Text style={[s.projText, { color: '#4a6888' }]}>{secondary}</Text>
        </View>
      )}

      {/* Action block */}
      {action && (
        <View style={[s.actionBlock, { borderColor: hex2rgba(ac, 0.28), backgroundColor: hex2rgba(ac, 0.1) }]}>
          <Text style={[s.actionLabel, { color: hex2rgba(ac, 0.65) }]}>ACTION</Text>
          <Text style={s.actionText}>{action}</Text>
          {timeCtx && <Text style={[s.timeCtx, { color: hex2rgba(ac, 0.5) }]}>{timeCtx}</Text>}
        </View>
      )}

      {/* Safe to save — only STRONG_PROGRESS */}
      {showSafe && safeMax > 0 && (
        <View style={[s.safeBlock, { borderColor: hex2rgba(ac, 0.15), backgroundColor: hex2rgba(ac, 0.06) }]}>
          <View style={s.safeRow}>
            <Text style={s.safeLabel}>Safe to save</Text>
            <Text style={[s.safeRange, { color: ac }]}>
              ${safeMin.toLocaleString()} – ${safeMax.toLocaleString()}
            </Text>
          </View>
          <Text style={s.safeHint}>{safeHint}</Text>
        </View>
      )}

      {/* CTA button */}
      <TouchableOpacity
        style={[s.btn, { borderColor: hex2rgba(ac, 0.22), backgroundColor: hex2rgba(ac, 0.08) }]}
        onPress={onAskAI}
        activeOpacity={0.75}
      >
        <Svg width={14} height={14} viewBox="0 0 14 14" fill="none">
          <Circle cx={7} cy={7} r={6} stroke={ac} strokeWidth={1.2} />
          <Path d="M5 7h4M7.5 5.5L9 7l-1.5 1.5" stroke={ac} strokeWidth={1.2}
            strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
        <Text style={[s.btnText, { color: ac }]}>Ask AI about this</Text>
      </TouchableOpacity>

      {/* Disclaimer */}
      <Text style={s.disclaimer}>
        AI insights are for informational purposes only and not financial advice.
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  card:        { borderWidth: 1, borderRadius: 16, padding: 15 },
  header:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  titleRow:    { flexDirection: 'row', alignItems: 'center', gap: 7 },
  dot:         { width: 6, height: 6, borderRadius: 3 },
  titleText:   { fontSize: 11, fontWeight: '700', letterSpacing: 0.3 },
  badge:       { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4, borderWidth: 1 },
  badgeText:   { fontSize: 9, fontWeight: '700', letterSpacing: 1, fontVariant: ['tabular-nums'] },
  subtleLabel: { fontSize: 9, color: '#2e4060', fontFamily: 'monospace', paddingHorizontal: 8 },
  earlyWrap:   { backgroundColor: 'rgba(74,96,128,0.08)', borderWidth: 1, borderColor: 'rgba(74,96,128,0.12)', borderRadius: 6, padding: 6, marginBottom: 12 },
  earlyText:   { fontSize: 10, color: '#2e4a6a', textAlign: 'center', lineHeight: 14 },
  insight:     { fontSize: 14, fontWeight: '600', color: '#dce8ff', lineHeight: 21, marginBottom: 6 },
  projRow:     { borderLeftWidth: 2, borderRadius: 8, padding: 8, marginBottom: 10 },
  projText:    { fontSize: 12, color: '#5a7898', lineHeight: 18 },
  actionBlock: { borderRadius: 10, padding: 12, marginBottom: 11, borderWidth: 1 },
  actionLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.8, marginBottom: 4 },
  actionText:  { fontSize: 13, fontWeight: '600', color: '#dce8ff', lineHeight: 20 },
  timeCtx:     { fontSize: 11, marginTop: 5 },
  safeBlock:   { borderRadius: 8, padding: 10, marginBottom: 13, borderWidth: 1 },
  safeRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 },
  safeLabel:   { fontSize: 11, color: '#4a6080', fontWeight: '600' },
  safeRange:   { fontSize: 14, fontWeight: '700' },
  safeHint:    { fontSize: 10, color: '#2e4560' },
  btn:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 9, borderRadius: 8, borderWidth: 1 },
  btnText:     { fontSize: 12, fontWeight: '700', letterSpacing: 0.2 },
  disclaimer:  { fontSize: 9, color: '#1a2d45', textAlign: 'center', marginTop: 10, lineHeight: 13 },
});
