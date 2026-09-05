// test-lesson-streak.mjs
//
// Live verification of Today's Lesson streak logic — goes through the real
// RLS-protected REST path (same as App.jsx's completeLesson()), not a
// service-role bypass. Reuses the actual computeNextStreak from
// src/utils/lessons.js — not a reimplementation, so this tests the real
// logic, not a copy of it.
//
// Usage (PowerShell):
//   $env:ARKONOMY_ACCESS_TOKEN = "<paste from browser, see below>"
//   $env:VITE_SUPABASE_ANON_KEY = "<same value as in your .env>"
//   node scripts/test-lesson-streak.mjs
//
// To get ARKONOMY_ACCESS_TOKEN: while logged into app.arkonomy.com, open
// DevTools Console and run:
//   copy(JSON.parse(localStorage.getItem('sb-hvnkxxazjfesbxdkzuba-auth-token')).access_token)

import { computeNextStreak } from '../src/utils/lessons.js';

const SUPABASE_URL = 'https://hvnkxxazjfesbxdkzuba.supabase.co';
const ACCESS_TOKEN = process.env.ARKONOMY_ACCESS_TOKEN;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;

if (!ACCESS_TOKEN) { console.error('Missing ARKONOMY_ACCESS_TOKEN'); process.exit(1); }
if (!ANON_KEY) { console.error('Missing VITE_SUPABASE_ANON_KEY'); process.exit(1); }

function decodeUserId(jwt) {
  const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64').toString('utf8'));
  return payload.sub;
}

const headers = {
  'apikey': ANON_KEY,
  'Authorization': `Bearer ${ACCESS_TOKEN}`,
  'Content-Type': 'application/json',
};

(async () => {
  const userId = decodeUserId(ACCESS_TOKEN);
  console.log(`user_id: ${userId}`);

  // RLS scopes this to the caller's own row automatically — no need to
  // filter by user_id explicitly.
  const getRes = await fetch(`${SUPABASE_URL}/rest/v1/lesson_streaks?select=current_streak,last_completed_date`, { headers });
  const rows = await getRes.json();
  const existing = rows[0] ?? { current_streak: 0, last_completed_date: null };
  console.log('Before:', existing);

  // Same guard as App.jsx's completeLesson() — no-op if already completed today.
  const { streak, lastCompletedDate, alreadyCompletedToday } = computeNextStreak(existing.last_completed_date, existing.current_streak);
  if (alreadyCompletedToday) {
    console.log('Already completed today — no-op, matching real completeLesson() behavior.');
    return;
  }

  const upsertRes = await fetch(`${SUPABASE_URL}/rest/v1/lesson_streaks`, {
    method: 'POST',
    headers: { ...headers, 'Prefer': 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({ user_id: userId, current_streak: streak, last_completed_date: lastCompletedDate }),
  });
  const body = await upsertRes.json();
  console.log(`HTTP ${upsertRes.status}`);
  console.log('After:', body);
})();
