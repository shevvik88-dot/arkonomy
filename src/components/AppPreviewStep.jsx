import { useState, useEffect, useRef } from "react";
import { FONT } from "../utils/colors";

const SCREEN = "#0F172A";
const SHELL = "#1E293B";
const PURPLE = "#7C3AED";
const MUTED = "#64748B";

const SLIDES = [
  {
    src: "/onboarding/screen-dashboard.png",
    title: "Smart Dashboard",
    desc: "Real-time balance, cash flow & spending in one view",
  },
  {
    src: "/onboarding/screen-transactions.png",
    title: "Every Transaction",
    desc: "Auto-categorized and synced from your bank daily",
  },
  {
    src: "/onboarding/screen-insights.png",
    title: "AI Insights",
    desc: "Personalized advice that saves you money every month",
  },
];

export default function AppPreviewStep({ onNext }) {
  const [current, setCurrent] = useState(0);
  const [maxSeen, setMaxSeen] = useState(0);
  const [unlocked, setUnlocked] = useState(false);
  const [hoverLeft, setHoverLeft] = useState(false);
  const [hoverRight, setHoverRight] = useState(false);
  const touchStartX = useRef(null);
  const autoTimer = useRef(null);

  useEffect(() => {
    setMaxSeen(m => Math.max(m, current));
  }, [current]);

  useEffect(() => {
    const t = setTimeout(() => setUnlocked(true), 6000);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (maxSeen >= 1) setUnlocked(true);
  }, [maxSeen]);

  const startAuto = () => {
    clearInterval(autoTimer.current);
    autoTimer.current = setInterval(() => {
      setCurrent(c => (c + 1) % SLIDES.length);
    }, 4000);
  };

  useEffect(() => {
    startAuto();
    return () => clearInterval(autoTimer.current);
  }, []);

  const pauseAuto = () => clearInterval(autoTimer.current);

  const goTo = (idx) => {
    setCurrent(idx);
    startAuto();
  };

  const onTouchStart = (e) => {
    touchStartX.current = e.touches[0].clientX;
    pauseAuto();
  };

  const onTouchEnd = (e) => {
    if (touchStartX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    if (Math.abs(dx) > 40) {
      if (dx < 0 && current < SLIDES.length - 1) goTo(current + 1);
      else if (dx > 0 && current > 0) goTo(current - 1);
      else startAuto();
    } else {
      startAuto();
    }
    touchStartX.current = null;
  };

  const slide = SLIDES[current];

  return (
    <div style={{
      minHeight: "100vh",
      background: SCREEN,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      fontFamily: FONT,
      padding: "40px 20px 32px",
    }}>
      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: 32, width: "100%" }}>
        <div style={{ fontSize: 28, fontWeight: 800, color: "#fff", marginBottom: 8, lineHeight: 1.2 }}>
          Here's what you get
        </div>
        <div style={{ fontSize: 13, color: MUTED }}>Swipe to explore</div>
      </div>

      {/* Phone + arrows */}
      <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center", width: "100%", maxWidth: 400 }}>
        {/* Left arrow */}
        <button
          onClick={() => goTo(current - 1)}
          onMouseEnter={() => setHoverLeft(true)}
          onMouseLeave={() => setHoverLeft(false)}
          style={{
            position: "absolute",
            left: 0,
            width: 40,
            height: 40,
            borderRadius: "50%",
            border: "none",
            background: hoverLeft ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.05)",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            fontSize: 22,
            zIndex: 10,
            transition: "background 0.2s",
            fontFamily: FONT,
            opacity: current === 0 ? 0 : 1,
            pointerEvents: current === 0 ? "none" : "auto",
          }}
        >
          ‹
        </button>

        {/* Phone frame */}
        <div
          style={{
            width: 260,
            height: 520,
            borderRadius: 40,
            border: "2px solid rgba(255,255,255,0.1)",
            background: SHELL,
            boxShadow: "0 20px 60px rgba(0,0,0,0.5), 0 0 40px rgba(124,58,237,0.2)",
            overflow: "hidden",
            flexShrink: 0,
          }}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          {/* Sliding strip */}
          <div style={{
            display: "flex",
            width: `${SLIDES.length * 100}%`,
            height: "100%",
            transform: `translateX(${-current * (100 / SLIDES.length)}%)`,
            transition: "transform 0.4s ease",
          }}>
            {SLIDES.map((s, i) => (
              <div key={i} style={{ width: `${100 / SLIDES.length}%`, height: "100%", flexShrink: 0 }}>
                <img
                  src={s.src}
                  alt={s.title}
                  style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top", display: "block" }}
                />
              </div>
            ))}
          </div>
        </div>

        {/* Right arrow */}
        <button
          onClick={() => goTo(current + 1)}
          onMouseEnter={() => setHoverRight(true)}
          onMouseLeave={() => setHoverRight(false)}
          style={{
            position: "absolute",
            right: 0,
            width: 40,
            height: 40,
            borderRadius: "50%",
            border: "none",
            background: hoverRight ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.05)",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            fontSize: 22,
            zIndex: 10,
            transition: "background 0.2s",
            fontFamily: FONT,
            opacity: current === SLIDES.length - 1 ? 0 : 1,
            pointerEvents: current === SLIDES.length - 1 ? "none" : "auto",
          }}
        >
          ›
        </button>
      </div>

      {/* Caption */}
      <div style={{ textAlign: "center", marginTop: 28, marginBottom: 20 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: "#fff", marginBottom: 6, lineHeight: 1.3, transition: "opacity 0.3s" }}>
          {slide.title}
        </div>
        <div style={{ fontSize: 14, color: MUTED, lineHeight: 1.55, maxWidth: 260 }}>
          {slide.desc}
        </div>
      </div>

      {/* Progress dots */}
      <div style={{ display: "flex", gap: 6 }}>
        {SLIDES.map((_, i) => (
          <div
            key={i}
            onClick={() => goTo(i)}
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: i === current ? "#fff" : "rgba(255,255,255,0.3)",
              cursor: "pointer",
              transition: "background 0.3s",
            }}
          />
        ))}
      </div>

      {/* CTA */}
      <div style={{ width: "100%", maxWidth: 390, marginTop: "auto", paddingTop: 32 }}>
        {unlocked ? (
          <button
            onClick={onNext}
            style={{
              width: "100%",
              padding: 16,
              background: `linear-gradient(135deg, ${PURPLE}, #9333EA)`,
              border: "none",
              borderRadius: 16,
              color: "#fff",
              fontWeight: 800,
              fontSize: 16,
              cursor: "pointer",
              fontFamily: FONT,
              boxShadow: "0 4px 24px rgba(124,58,237,0.4)",
            }}
          >
            Continue →
          </button>
        ) : (
          <button
            onClick={onNext}
            style={{
              width: "100%",
              padding: 16,
              background: "transparent",
              border: "1px solid rgba(255,255,255,0.15)",
              borderRadius: 16,
              color: "rgba(255,255,255,0.5)",
              fontWeight: 600,
              fontSize: 16,
              cursor: "pointer",
              fontFamily: FONT,
            }}
          >
            Swipe to explore →
          </button>
        )}
      </div>
    </div>
  );
}
