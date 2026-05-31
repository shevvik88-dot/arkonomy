import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../utils/supabase";
import { C, FONT } from "../utils/colors";
import GlassCard from "./shared/GlassCard";

function EyeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/>
      <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/>
      <line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
  );
}

function GoogleLogo() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
  );
}

function AppleLogo({ color = "#000" }) {
  return (
    <svg width="20" height="20" viewBox="0 0 814 1000" fill={color} style={{ flexShrink: 0 }}>
      <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76 0-103.7 40.8-165.9 40.8s-105-37.5-155.5-122.7C46.3 683.6 0 582.6 0 487.8c0-176.2 115.3-269.1 228.4-269.1 60.4 0 110.8 39.8 148.2 39.8 35.7 0 92.8-42.1 162.8-42.1 26.3 0 116.3 2.6 178.2 86.1zm-116.3-87.1c-28.5-35.1-78-60-125.7-60-6.4 0-12.8.6-19.2 1.3 1.3-10.3 1.9-20.5 1.9-30.8C528.8 67.5 469.1 6.5 391.9.9c2.5 16.7 3.5 32.8 3.5 48.3 0 89.8-60.5 155.4-94 176.8l.1.2c49.5 0 95.9-30.5 121.4-30.5 49.8 0 101.8 32.7 149.9 57.1z"/>
    </svg>
  );
}

function Spinner() {
  return (
    <span style={{
      display: "inline-block",
      width: 15,
      height: 15,
      border: "2px solid rgba(255,255,255,0.3)",
      borderTopColor: "#fff",
      borderRadius: "50%",
      animation: "authSpin 0.7s linear infinite",
      verticalAlign: "middle",
      marginRight: 8,
      flexShrink: 0,
    }} />
  );
}

function pwStrength(pw) {
  if (!pw) return null;
  const score = [pw.length >= 8, /[A-Z]/.test(pw), /[0-9]/.test(pw)].filter(Boolean).length;
  if (score === 3) return { label: "Strong", color: C.green, pct: "100%" };
  if (score === 2) return { label: "Medium", color: "#F59E0B", pct: "66%" };
  return { label: "Weak", color: C.red, pct: "33%" };
}

function pwError(pw) {
  if (!pw) return null;
  const missing = [];
  if (pw.length < 8) missing.push("8+ characters");
  if (!/[A-Z]/.test(pw)) missing.push("uppercase letter");
  if (!/[0-9]/.test(pw)) missing.push("number");
  return missing.length ? "Needs: " + missing.join(", ") : null;
}

const RESEND_COOLDOWN = 30;
const LOCKOUT_DURATION = 30000;
const MAX_ATTEMPTS = 5;

export default function AuthScreen({ onAuth }) {
  const { t } = useTranslation();
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [pwTouched, setPwTouched] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [hoverSocial, setHoverSocial] = useState(null);
  const [lockoutUntil, setLockoutUntil] = useState(0);
  const failedAttemptsRef = useRef(0);
  const timerRef = useRef(null);

  useEffect(() => () => clearInterval(timerRef.current), []);

  function startCooldown() {
    setCooldown(RESEND_COOLDOWN);
    timerRef.current = setInterval(() => {
      setCooldown(c => {
        if (c <= 1) { clearInterval(timerRef.current); return 0; }
        return c - 1;
      });
    }, 1000);
  }

  function switchMode(next) {
    setMode(next);
    setEmail(""); setPassword(""); setName("");
    setError(""); setMsg("");
    setShowPw(false); setPwTouched(false);
    setCooldown(0);
    clearInterval(timerRef.current);
  }

  function friendlyError(m) {
    if (!m) return m;
    if (m.toLowerCase().includes("missing email or phone")) return t("auth.error_email_required");
    if (m.toLowerCase().includes("invalid login credentials")) return t("auth.error_invalid_credentials");
    if (m.toLowerCase().includes("email not confirmed")) return t("auth.error_email_not_confirmed");
    return m;
  }

  async function handleOAuth(provider) {
    console.log('[OAuth] attempting', provider);
    setError("");
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.origin },
    });
    if (error) setError(friendlyError(error.message));
  }

  async function handleSubmit(e) {
    if (e) e.preventDefault();
    setError(""); setMsg("");

    if (mode === "login" && Date.now() < lockoutUntil) {
      const sec = Math.ceil((lockoutUntil - Date.now()) / 1000);
      setError(t("auth.error_lockout", { seconds: sec }) || `Too many attempts. Try again in ${sec}s`);
      return;
    }

    if (mode === "signup" && pwError(password)) {
      setPwTouched(true);
      return;
    }
    setLoading(true);
    try {
      if (mode === "signup") {
        await supabase.auth.signUp({ email, password, options: { data: { full_name: name }, emailRedirectTo: 'https://app.arkonomy.com' } });
        setMsg(t("auth.success_check_email"));
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          failedAttemptsRef.current += 1;
          if (failedAttemptsRef.current >= MAX_ATTEMPTS) {
            setLockoutUntil(Date.now() + LOCKOUT_DURATION);
            failedAttemptsRef.current = 0;
          }
          throw error;
        }
        failedAttemptsRef.current = 0;
        onAuth(data.user);
      }
    } catch (e) { setError(friendlyError(e.message)); }
    finally { setLoading(false); }
  }

  async function handleResend() {
    setLoading(true);
    try {
      const { error } = await supabase.auth.resend({ type: "signup", email, options: { emailRedirectTo: 'https://app.arkonomy.com' } });
      if (error) throw error;
      startCooldown();
    } catch (e) { setError(friendlyError(e.message)); }
    finally { setLoading(false); }
  }

  async function handleForgotPassword() {
    setError(""); setMsg("");
    if (!email) { setError(t("auth.error_forgot_no_email")); return; }
    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: 'https://app.arkonomy.com' });
      if (error) throw error;
      setMsg(t("auth.success_reset_sent"));
    } catch (e) { setError(friendlyError(e.message)); }
    finally { setLoading(false); }
  }

  const inp = { width: "100%", padding: "14px 16px", background: C.bgSecondary, border: `1px solid ${C.border}`, borderRadius: 14, color: C.text, fontSize: 15, outline: "none", boxSizing: "border-box", fontFamily: FONT };
  const str = mode === "signup" && password ? pwStrength(password) : null;
  const pwErr = mode === "signup" && pwTouched ? pwError(password) : null;

  return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, fontFamily: FONT }}>
      <style>{`@keyframes authSpin { to { transform: rotate(360deg); } }`}</style>
      <div style={{ width: "100%", maxWidth: 380 }}>
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <img src="https://i.postimg.cc/k4tv1XgB/Remove-the-dark-background-completely-make-it-tran-delpmaspu-removebg-preview.png" alt="Arkonomy" style={{ width: 280, height: 140, objectFit: "contain", display: "block", margin: "0 auto 16px" }} />
          <div style={{ fontSize: 22, fontWeight: 300, color: C.cyan, letterSpacing: 8, marginBottom: 4 }}>ARKONOMY</div>
          <div style={{ color: C.faint, fontSize: 11, letterSpacing: 3 }}>{t("auth.autopilot_tagline")}</div>
        </div>
        <GlassCard>
          <h2 style={{ color: C.text, margin: "0 0 20px", fontSize: 20, fontWeight: 700 }}>{mode === "login" ? t("auth.welcome_back") : t("auth.create_account")}</h2>

          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {mode === "signup" && <input style={inp} placeholder={t("auth.full_name")} value={name} onChange={e => setName(e.target.value)} autoComplete="name" />}
            <input style={inp} type="email" placeholder={t("auth.email")} value={email} onChange={e => { setEmail(e.target.value); if (error) setError(""); }} autoComplete="email" />

            {/* Password field */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ position: "relative" }}>
                <input
                  style={{ ...inp, paddingRight: 46 }}
                  type={showPw ? "text" : "password"}
                  placeholder={t("auth.password")}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  onBlur={() => mode === "signup" && setPwTouched(true)}
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                />
                <button
                  type="button"
                  onClick={() => setShowPw(v => !v)}
                  style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: C.muted, padding: 2, display: "flex", alignItems: "center" }}
                  tabIndex={-1}
                >
                  {showPw ? <EyeOffIcon /> : <EyeIcon />}
                </button>
              </div>

              {str && (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ flex: 1, height: 3, borderRadius: 3, background: C.bgSecondary, overflow: "hidden" }}>
                    <div style={{ height: "100%", borderRadius: 3, background: str.color, width: str.pct, transition: "width 0.25s, background 0.25s" }} />
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 600, color: str.color, minWidth: 46, textAlign: "right" }}>{str.label}</span>
                </div>
              )}

              {pwErr && (
                <div style={{ fontSize: 12, color: C.red, paddingLeft: 2 }}>{pwErr}</div>
              )}
            </div>

            {mode === "login" && (
              <div style={{ textAlign: "right", marginTop: -4 }}>
                <button type="button" onClick={handleForgotPassword} disabled={loading} style={{ background: "none", border: "none", color: C.cyan, fontSize: 13, cursor: "pointer", padding: 0, fontFamily: FONT, opacity: loading ? 0.5 : 1 }}>
                  {t("auth.forgot_password")}
                </button>
              </div>
            )}
            {error && <div style={{ color: C.red, fontSize: 13, background: C.red + "18", padding: "10px 14px", borderRadius: 10 }}>{error}</div>}
            {msg && (
              <div style={{ color: C.green, fontSize: 13, background: C.green + "18", padding: "10px 14px", borderRadius: 10 }}>
                {msg}
                {mode === "signup" && (
                  <div style={{ marginTop: 8 }}>
                    {cooldown > 0
                      ? <span style={{ color: C.faint, fontSize: 12 }}>Resend in {cooldown}s</span>
                      : <button type="button" onClick={handleResend} disabled={loading} style={{ background: "none", border: "none", color: C.cyan, fontSize: 13, cursor: "pointer", padding: 0, fontFamily: FONT, fontWeight: 600, opacity: loading ? 0.5 : 1 }}>{t("auth.resend_confirmation")}</button>
                    }
                  </div>
                )}
              </div>
            )}
            <button
              type="submit"
              disabled={loading}
              style={{ width: "100%", marginTop: 8, padding: 15, background: `linear-gradient(90deg,${C.cyan},${C.blue})`, border: "none", borderRadius: 12, color: "#fff", fontWeight: 700, fontSize: 15, cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.7 : 1, fontFamily: FONT, display: "flex", alignItems: "center", justifyContent: "center" }}
            >
              {loading && <Spinner />}
              {loading
                ? (mode === "login" ? "Signing in..." : "Creating account...")
                : (mode === "login" ? t("auth.sign_in") : t("auth.sign_up"))
              }
            </button>
            {mode === "signup" && (
              <div style={{ textAlign: "center", marginTop: 10, color: C.faint, fontSize: 12 }}>
                {t("auth.trial_tagline")}
              </div>
            )}
          </form>
          <div style={{ textAlign: "center", marginTop: 18, color: C.muted, fontSize: 14 }}>
            {mode === "login" ? t("auth.no_account") + " " : t("auth.have_account") + " "}
            <span onClick={() => switchMode(mode === "login" ? "signup" : "login")} style={{ color: C.cyan, cursor: "pointer", fontWeight: 600 }}>
              {mode === "login" ? t("auth.sign_up_free") : t("auth.sign_in_link")}
            </span>
          </div>

          {/* Social circle buttons */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "20px 0 8px" }}>
            <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.08)" }} />
            <span style={{ color: "#64748B", fontSize: 12, whiteSpace: "nowrap" }}>or continue with</span>
            <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.08)" }} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <button
              type="button"
              onClick={() => handleOAuth("google")}
              onMouseEnter={() => setHoverSocial("google")}
              onMouseLeave={() => setHoverSocial(null)}
              style={{
                width: "100%", height: 48,
                borderRadius: 12,
                border: "1.5px solid rgba(255,255,255,0.15)",
                background: hoverSocial === "google" ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.05)",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
                cursor: "pointer",
                transition: "background 0.15s",
                fontFamily: FONT, fontSize: 15, fontWeight: 600, color: C.text,
              }}
            >
              <GoogleLogo />
              Continue with Google
            </button>
            <button
              type="button"
              onClick={() => handleOAuth("apple")}
              onMouseEnter={() => setHoverSocial("apple")}
              onMouseLeave={() => setHoverSocial(null)}
              style={{
                width: "100%", height: 48,
                borderRadius: 12,
                border: "none",
                background: hoverSocial === "apple" ? "#e0e0e0" : "#fff",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
                cursor: "pointer",
                transition: "background 0.15s",
                fontFamily: "-apple-system, 'SF Pro Display', sans-serif", fontSize: 15, fontWeight: 600, color: "#000",
              }}
            >
              <AppleLogo />
              Sign in with Apple
            </button>
          </div>
        </GlassCard>
      </div>
    </div>
  );
}
