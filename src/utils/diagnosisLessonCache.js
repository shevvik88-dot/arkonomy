// src/utils/diagnosisLessonCache.js
//
// Client-side, once-per-day cache for the AI-generated diagnosis lesson
// (Financial Diagnosis Phase 2, daily-lesson-v2 edge function). Contains
// real financial detail (dollar figures, a referenced transaction) — same
// "AI content in browser storage" class as sessionStorage's
// arkonomy_chat_history, but this one needs to survive a same-day reload
// by design (that's the whole point of the day-cache — avoid re-calling
// Claude every time Dashboard mounts), so it lives in localStorage instead.
// To keep that safe: explicitly cleared on signOut()/deleteAccount() (same
// pattern as clearAccountsCache()), and self-prunes any stale (non-today)
// key for the user on every read so it can't accumulate one key per user
// per day forever (security-auditor finding, 2026-08-23).

const PREFIX = 'arkonomy_diagnosis_lesson_';

function keyFor(userId, dateStr) {
  return `${PREFIX}${userId}_${dateStr}`;
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// Returns { lesson } if something was already resolved today (lesson may
// itself be null, meaning "checked today, no active diagnosis or an error
// — use the static fallback"), or null if nothing cached yet for today
// (caller should fetch).
export function getCachedDiagnosisLesson(userId) {
  if (!userId) return null;
  try {
    const today = todayStr();
    const currentKey = keyFor(userId, today);
    // Prune this user's stale keys (any date other than today) on every
    // read, not just on sign-out — keeps normal daily usage from ever
    // accumulating more than one key per user.
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(`${PREFIX}${userId}_`) && k !== currentKey) {
        localStorage.removeItem(k);
      }
    }
    const raw = localStorage.getItem(currentKey);
    if (raw === null) return null;
    return { lesson: JSON.parse(raw) };
  } catch {
    return null;
  }
}

export function setCachedDiagnosisLesson(userId, lesson) {
  if (!userId) return;
  try {
    localStorage.setItem(keyFor(userId, todayStr()), JSON.stringify(lesson));
  } catch {}
}

// Called from signOut()/deleteAccount(). Sweeps every arkonomy_diagnosis_lesson_*
// key, not just the current user's — a shared/family device could carry a
// leftover key from a previous account's session.
export function clearDiagnosisLessonCache() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX)) localStorage.removeItem(k);
    }
  } catch {}
}
