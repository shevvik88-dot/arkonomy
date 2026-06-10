import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { C, FONT } from "../utils/colors";
import Icon from "./shared/Icon";

export default function BottomNav({ screen, setScreen, onOpenChat, insightCount = 0 }) {
  const { t } = useTranslation();
  const [scrollOpacity, setScrollOpacity] = useState(1);
  const [pressed, setPressed]             = useState(false);

  useEffect(() => {
    let timer;
    const onScroll = () => {
      setScrollOpacity(0.4);
      clearTimeout(timer);
      timer = setTimeout(() => setScrollOpacity(1), 700);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => { window.removeEventListener('scroll', onScroll); clearTimeout(timer); };
  }, []);

  function handleAITap() {
    navigator.vibrate?.(10);
    setPressed(true);
    setTimeout(() => { setPressed(false); onOpenChat(); }, 130);
  }

  const tabs = [
    { id: "dashboard",    label: t("nav.home"),         icon: "home"      },
    { id: "transactions", label: t("nav.transactions"), icon: "credit"    },
    { id: "markets",      label: t("nav.markets"),      icon: "bar-chart" },
    { id: "savings",      label: t("nav.savings"),      icon: "target"    },
    { id: "insights",     label: t("nav.insights"),     icon: "activity"  },
  ];

  return (
    <>
      <style>{`
        @keyframes ai-glow-pulse {
          0%, 100% { box-shadow: 0 8px 32px rgba(99,102,241,0.38), 0 0 0 0 rgba(0,194,255,0.12); }
          50%       { box-shadow: 0 8px 44px rgba(99,102,241,0.58), 0 0 18px 4px rgba(0,194,255,0.22); }
        }
      `}</style>

      {/*
        Positioning wrapper: fixed, full-width up to 430px, centered.
        height: 0 + pointerEvents: none so it never blocks taps.
        The button inside uses position: absolute + right/bottom to sit
        20px from the container's right edge, 16px above the nav bar.
      */}
      <div style={{
        position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)',
        width: '100%', maxWidth: 430, height: 0, zIndex: 55, pointerEvents: 'none',
      }}>
        {/* Gradient-border ring: 1px padding + gradient bg → gives gradient border */}
        <div
          data-tutorial="ai-chat"
          role="button"
          aria-label="Open AI chat"
          tabIndex={0}
          onKeyDown={e => (e.key === "Enter" || e.key === " ") && handleAITap()}
          onClick={handleAITap}
          style={{
            position: 'absolute',
            bottom: 88,
            right: 16,
            width: 56,
            height: 56,
            borderRadius: '50%',
            padding: 1,
            background: 'linear-gradient(150deg, rgba(160,170,255,0.75) 0%, rgba(0,194,255,0.45) 40%, rgba(40,50,140,0.35) 100%)',
            animation: 'ai-glow-pulse 3s ease-in-out infinite',
            opacity: scrollOpacity,
            transition: 'opacity 0.5s ease',
            cursor: 'pointer',
            userSelect: 'none',
            pointerEvents: 'auto',
          }}
        >
          {/* Inner glass circle */}
          <div style={{
            width: '100%',
            height: '100%',
            borderRadius: '50%',
            background: 'rgba(7, 16, 40, 0.75)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 1,
            transform: pressed ? 'scale(0.86)' : 'scale(1)',
            transition: 'transform 0.13s ease',
            pointerEvents: 'none',
          }}>
            {/* Sparkle icon */}
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <defs>
                <linearGradient id="spark-g" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stopColor="#00C2FF"/>
                  <stop offset="100%" stopColor="#7C6BFF"/>
                </linearGradient>
              </defs>
              {/* 4-pointed star */}
              <path d="M12 2 L13.4 9.3 L20 12 L13.4 14.7 L12 22 L10.6 14.7 L4 12 L10.6 9.3 Z" fill="url(#spark-g)"/>
              {/* Small accent dots */}
              <circle cx="19" cy="5" r="1.2" fill="url(#spark-g)" opacity="0.7"/>
              <circle cx="5"  cy="19" r="0.9" fill="url(#spark-g)" opacity="0.5"/>
            </svg>
            <span style={{
              fontSize: 8,
              fontWeight: 600,
              letterSpacing: 1.5,
              color: 'rgba(160,180,255,0.8)',
              fontFamily: FONT,
              lineHeight: 1,
            }}>AI</span>
          </div>

          {/* Insight badge */}
          {insightCount > 0 && (
            <div style={{
              position: 'absolute',
              top: -1,
              right: -1,
              minWidth: 18,
              height: 18,
              borderRadius: 9,
              background: '#F97316',
              border: '2px solid rgba(7,16,40,0.95)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 9,
              fontWeight: 800,
              color: '#fff',
              fontFamily: FONT,
              padding: '0 3px',
            }}>
              {insightCount > 9 ? '9+' : insightCount}
            </div>
          )}
        </div>
      </div>

      {/* ── Nav bar ── */}
      <div className="cap-bottom-nav" style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 430, background: "rgba(11,20,38,0.97)", backdropFilter: "blur(24px)", borderTop: `1px solid ${C.sep}`, display: "flex", padding: "10px 0 20px", zIndex: 50 }}>
        {tabs.map(tab => {
          const active = screen === tab.id;
          return (
            <button key={tab.id} data-tutorial={`nav-${tab.id}`} aria-label={tab.label} onClick={() => { navigator.vibrate?.(10); setScreen(tab.id); }}
              style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, background: "none", border: "none", cursor: "pointer", padding: "4px 0", minHeight: 44, position: "relative" }}>
              <Icon name={tab.icon} size={22} color={active ? C.blue : C.faint} strokeWidth={active ? 2.2 : 1.8} />
              <span style={{ fontSize: 10, color: active ? C.blue : C.faint, fontWeight: active ? 700 : 400, fontFamily: FONT }}>{tab.label}</span>
              {active && <div style={{ width: 4, height: 4, borderRadius: 99, background: C.blue, boxShadow: `0 0 6px ${C.blue}` }} />}
            </button>
          );
        })}
      </div>
    </>
  );
}
