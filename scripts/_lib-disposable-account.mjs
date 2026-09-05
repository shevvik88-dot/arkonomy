// _lib-disposable-account.mjs
//
// Shared helper for pentest scripts that need a throwaway Supabase Auth
// user — NEVER the real personal account (shevvik88@gmail.com / test UUID
// 90eb11c3-...). That account was confirmed 2026-08-27 to be the
// maintainer's actual personal account, not an isolated test account —
// PENETRATION_TEST_PLAN.md's "test account" framing was wrong on this
// point. Any test that creates sessions, changes a password, or otherwise
// mutates auth state must use a disposable account created here instead.
//
// Uses the Auth Admin API (service_role key) directly — createUser,
// generateLink, deleteUser. Not exposed via any mcp__supabase tool, so this
// talks to {SUPABASE_URL}/auth/v1/admin/* over plain fetch.
//
// Reads credentials from .env.local (already on disk, never printed).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnvLocal() {
  const path = join(__dirname, '..', '.env.local');
  const text = readFileSync(path, 'utf8');
  const env = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return env;
}

const env = loadEnvLocal();
export const SUPABASE_URL = env.VITE_SUPABASE_URL;
export const ANON_KEY = env.VITE_SUPABASE_ANON_KEY;
export const SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
  throw new Error('Missing SUPABASE_URL / ANON_KEY / SERVICE_ROLE_KEY in .env.local');
}

function randomSuffix() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// .invalid is an RFC 2606 reserved TLD — guaranteed non-deliverable, so a
// disposable account never risks emailing a real inbox even if some code
// path tried to send mail (it shouldn't, since we use email_confirm:true
// and the Admin API throughout, but this is a free extra guardrail).
export function disposableEmail(tag) {
  return `arkonomy-pentest-${tag}-${randomSuffix()}@arkonomy-pentest.invalid`;
}

export function randomPassword() {
  return 'Pw_' + Math.random().toString(36).slice(2, 12) + 'Aa1!';
}

export async function createDisposableUser(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`createDisposableUser failed: ${res.status} ${JSON.stringify(body)}`);
  return body; // { id, email, ... }
}

export async function deleteUser(userId) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    method: 'DELETE',
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    },
  });
  if (!res.ok && res.status !== 404) {
    const body = await res.text();
    throw new Error(`deleteUser failed: ${res.status} ${body}`);
  }
  return res.status;
}

export async function passwordSignIn(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON_KEY },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json();
  return { status: res.status, body };
}

export async function refreshToken(refresh_token) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON_KEY },
    body: JSON.stringify({ refresh_token }),
  });
  const body = await res.json();
  return { status: res.status, body };
}

export async function getUser(access_token) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    method: 'GET',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${access_token}` },
  });
  const body = await res.json();
  return { status: res.status, body };
}

export async function updateUserPassword(access_token, newPassword, currentPassword) {
  const payload = { password: newPassword };
  if (currentPassword) payload.nonce = undefined, payload.current_password = currentPassword;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      apikey: ANON_KEY,
      Authorization: `Bearer ${access_token}`,
    },
    body: JSON.stringify(payload),
  });
  const body = await res.json();
  return { status: res.status, body };
}

export async function generateLink(type, email) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({ type, email }),
  });
  const body = await res.json();
  return { status: res.status, body };
}

export async function verifyOtp(type, token_hash) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON_KEY },
    body: JSON.stringify({ type, token_hash }),
  });
  const body = await res.json();
  return { status: res.status, body };
}

// Redact a token for safe logging — length + first/last 4 chars only.
export function redact(tok) {
  if (!tok || typeof tok !== 'string') return String(tok);
  if (tok.length <= 12) return `<redacted len=${tok.length}>`;
  return `${tok.slice(0, 4)}...${tok.slice(-4)} (len=${tok.length})`;
}
