import { useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../utils/supabase";
import { C, FONT } from "../utils/colors";
import GlassCard from "./shared/GlassCard";

export default function AuthScreen({ onAuth }) {
  const { t } = useTranslation();
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [resent, setResent] = useState(false);

  function friendlyError(msg) {
    if (!msg) return msg;
    if (msg.toLowerCase().includes("missing email or phone")) return t("auth.error_email_required");
    if (msg.toLowerCase().includes("invalid login credentials")) return t("auth.error_invalid_credentials");
    if (msg.toLowerCase().includes("email not confirmed")) return t("auth.error_email_not_confirmed");
    return msg;
  }

  async function handleSubmit(e) {
    if (e) e.preventDefault();
    setError(""); setMsg(""); setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: name }, emailRedirectTo: 'https://app.arkonomy.com' } });
        if (error) throw error;
        setMsg(t("auth.success_check_email"));
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
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
      setResent(true);
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

  return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, fontFamily: FONT }}>
      <div style={{ width: "100%", maxWidth: 380 }}>
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <img src="https://i.postimg.cc/k4tv1XgB/Remove-the-dark-background-completely-make-it-tran-delpmaspu-removebg-preview.png" alt="Arkonomy" style={{ width: 280, height: 140, objectFit: "contain", display: "block", margin: "0 auto 16px" }} />
          <div style={{ fontSize: 22, fontWeight: 300, color: C.cyan, letterSpacing: 8, marginBottom: 4 }}>ARKONOMY</div>
          <div style={{ color: C.faint, fontSize: 11, letterSpacing: 3 }}>{t("auth.autopilot_tagline")}</div>
        </div>
        <GlassCard>
          <h2 style={{ color: C.text, margin: "0 0 22px", fontSize: 20, fontWeight: 700 }}>{mode === "login" ? t("auth.welcome_back") : t("auth.create_account")}</h2>
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {mode === "signup" && <input style={inp} placeholder={t("auth.full_name")} value={name} onChange={e => setName(e.target.value)} autoComplete="name" />}
            <input style={inp} type="email" placeholder={t("auth.email")} value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" />
            <input style={inp} type="password" placeholder={t("auth.password")} value={password} onChange={e => setPassword(e.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} />
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
                    {resent
                      ? <span style={{ color: C.cyan, fontWeight: 600 }}>{t("auth.email_sent")}</span>
                      : <button type="button" onClick={handleResend} disabled={loading} style={{ background: "none", border: "none", color: C.cyan, fontSize: 13, cursor: "pointer", padding: 0, fontFamily: FONT, fontWeight: 600, opacity: loading ? 0.5 : 1 }}>{t("auth.resend_confirmation")}</button>
                    }
                  </div>
                )}
              </div>
            )}
            <button type="submit" disabled={loading} style={{ width: "100%", marginTop: 8, padding: 15, background: `linear-gradient(90deg,${C.cyan},${C.blue})`, border: "none", borderRadius: 12, color: "#fff", fontWeight: 700, fontSize: 15, cursor: "pointer", opacity: loading ? 0.7 : 1, fontFamily: FONT }}>
              {loading ? "..." : mode === "login" ? t("auth.sign_in") : t("auth.sign_up")}
            </button>
            {mode === "signup" && (
              <div style={{ textAlign: "center", marginTop: 10, color: C.faint, fontSize: 12 }}>
                {t("auth.trial_tagline")}
              </div>
            )}
          </form>
          <div style={{ textAlign: "center", marginTop: 18, color: C.muted, fontSize: 14 }}>
            {mode === "login" ? t("auth.no_account") + " " : t("auth.have_account") + " "}
            <span onClick={() => { setMode(mode === "login" ? "signup" : "login"); setEmail(""); setPassword(""); setName(""); setError(""); setMsg(""); }} style={{ color: C.cyan, cursor: "pointer", fontWeight: 600 }}>
              {mode === "login" ? t("auth.sign_up_free") : t("auth.sign_in_link")}
            </span>
          </div>
        </GlassCard>
      </div>
    </div>
  );
}
