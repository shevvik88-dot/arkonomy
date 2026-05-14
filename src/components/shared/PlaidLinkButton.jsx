import { useEffect } from "react";
import { usePlaidLink } from "react-plaid-link";
import { usePlaidOAuth } from "../../hooks/usePlaidOAuth";
import { FONT } from "../../utils/colors";

export default function PlaidLinkButton({ linkToken, onSuccess, onExit, autoOpen = false }) {
  const { receivedRedirectUri, clearRedirectUri } = usePlaidOAuth();

  // When resuming after OAuth redirect: token must be null and receivedRedirectUri
  // is passed instead. Plaid Link uses it to complete the OAuth handshake.
  const isOAuthResume = Boolean(receivedRedirectUri);
  const { open, ready } = usePlaidLink({
    token: isOAuthResume ? null : linkToken,
    receivedRedirectUri: receivedRedirectUri ?? undefined,
    onSuccess: (public_token, metadata) => {
      clearRedirectUri();
      onSuccess(public_token, metadata);
    },
    onExit: (err, metadata) => {
      clearRedirectUri();
      onExit?.(err, metadata);
    },
  });

  // Auto-open Plaid Link as soon as the SDK is ready — eliminates the
  // two-click problem where the user clicks a button, the token loads,
  // and then they have to click a second button to actually open Plaid.
  useEffect(() => {
    if (autoOpen && ready) open();
  }, [autoOpen, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <button
      onClick={() => open()}
      disabled={!ready}
      style={{
        width: "100%", padding: 14,
        background: ready ? "linear-gradient(135deg,#1A56DB,#2F80FF)" : "rgba(26,86,219,0.4)",
        border: "none", borderRadius: 14,
        color: "#fff", fontWeight: 700, fontSize: 15,
        cursor: ready ? "pointer" : "not-allowed",
        fontFamily: FONT,
        display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
        boxShadow: ready ? "0 4px 20px rgba(26,86,219,0.4)" : "none",
        transition: "all 0.2s",
      }}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="3" y1="22" x2="21" y2="22"/>
        <line x1="6" y1="18" x2="6" y2="11"/>
        <line x1="10" y1="18" x2="10" y2="11"/>
        <line x1="14" y1="18" x2="14" y2="11"/>
        <line x1="18" y1="18" x2="18" y2="11"/>
        <polygon points="12 2 20 7 4 7"/>
      </svg>
      {ready ? "Connect Your Bank" : "Loading..."}
    </button>
  );
}
