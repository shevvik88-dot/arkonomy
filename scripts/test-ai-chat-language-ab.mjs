// test-ai-chat-language-ab.mjs
//
// A/B test for the ai-chat LANGUAGE-section flakiness (docs/known-issues.md,
// found 2026-08-26, PR #49). Sends Russian messages to the live ai-chat edge
// function repeatedly and measures how often it actually replies in Russian,
// split by whether the model's response round used web_search or not
// (exposed via a TEMPORARY _debug.usedWebSearch field added to ai-chat for
// this test only — see supabase/functions/ai-chat/index.ts's "TEMPORARY"
// comments. That field must be reverted after this test run; it is not a
// permanent part of the response shape).
//
// Scaled-down run per 2026-08-28 decision: 18 total calls (3 variants x 6
// reps), well under ai-chat's 20/request-per-hour rate limit, no temporary
// rate-limit bump needed. Run it again later (a second 18-call batch) if
// this pass is ambiguous, rather than widen scope now.
//
// Usage:
//   node scripts/test-ai-chat-language-ab.mjs
//
// Expects: .env.test (E2E_EMAIL, E2E_PASSWORD) and .env.local (VITE_SUPABASE_ANON_KEY)
// — same pattern as scripts/test-financial-diagnosis-smoke.mjs and friends.

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env.test' });
dotenv.config({ path: '.env.local' });

const SUPABASE_URL = 'https://hvnkxxazjfesbxdkzuba.supabase.co';
const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;

if (!EMAIL) { console.error('Missing E2E_EMAIL in .env.test'); process.exit(1); }
if (!PASSWORD) { console.error('Missing E2E_PASSWORD in .env.test'); process.exit(1); }
if (!ANON_KEY) { console.error('Missing VITE_SUPABASE_ANON_KEY in .env.local'); process.exit(1); }

// Minimal but structurally valid financialContext — just enough to set
// USER'S APP LANGUAGE: Russian (the actual default-language mechanism being
// tested) and a neutral/stable financial state, without needing to
// reproduce the full client-side aiContext-building pipeline. No real user
// data involved.
const FINANCIAL_CONTEXT = {
  language: 'ru',
  metrics: {
    currentBalance: 500,
    availableSafeToMove: 100,
    currentMonthSpend: 2000,
    monthlyBudget: 3000,
    budgetUsedPct: 67,
    currentMonthIncome: 3000,
  },
  engine: { activeSignals: [], isWarning: false, isPositive: true, topInsight: null },
  regularCommitments: { subscriptions: [], regularPayments: [], totalMonthly: 0, duplicates: [] },
  topCategories: [],
  savingsGoals: [],
  totalSaved: 0,
  recentTransactions: [],
  creditCards: [],
  interestThisMonth: 0,
};

// 2 variants likely to invoke web_search (matches the originally-reported
// bug's own scenario — current-market/investing questions), 1 variant
// unlikely to (the model's own data, no reason to search). Whether search
// actually fires per call is OBSERVED via _debug.usedWebSearch, not assumed
// from the variant — that's the whole point of the instrumentation.
const VARIANTS = [
  { label: 'stocks-to-buy',   text: 'Какие акции сейчас стоит купить?' },
  { label: 'market-today',    text: 'Что происходит на рынке акций сегодня?' },
  { label: 'own-spending',    text: 'Сколько я потратил в этом месяце?' },
];
const REPS_PER_VARIANT = 6; // 3 variants x 6 = 18 total calls

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Heuristic language classifier: ratio of Cyrillic letters among all
// alphabetic (Cyrillic + Latin) characters in the reply. >50% Cyrillic =>
// "ru", otherwise "other" (almost always English in practice for this bug).
function classifyLanguage(text) {
  const cyrillic = (text.match(/[а-яА-ЯёЁ]/g) || []).length;
  const latin = (text.match(/[a-zA-Z]/g) || []).length;
  const total = cyrillic + latin;
  if (total === 0) return 'unknown';
  return (cyrillic / total) > 0.5 ? 'ru' : 'other';
}

(async () => {
  const supabase = createClient(SUPABASE_URL, ANON_KEY);

  console.log('Signing in...');
  const { data, error } = await supabase.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  if (error) { console.error('Sign-in failed:', error.message); process.exit(1); }
  const accessToken = data.session.access_token;
  console.log('✓ Signed in\n');

  const results = [];
  let callNum = 0;
  const totalCalls = VARIANTS.length * REPS_PER_VARIANT;

  for (const variant of VARIANTS) {
    for (let rep = 1; rep <= REPS_PER_VARIANT; rep++) {
      callNum++;
      process.stdout.write(`[${callNum}/${totalCalls}] ${variant.label} rep ${rep}... `);

      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/ai-chat`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'apikey': ANON_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messages: [{ role: 'user', text: variant.text }],
            financialContext: FINANCIAL_CONTEXT,
          }),
        });

        if (res.status === 429) {
          console.log('\n\n✗ Rate limit hit (429) — stopping early. Partial results below.');
          break;
        }
        if (!res.ok) {
          const body = await res.text();
          console.log(`HTTP ${res.status}: ${body.slice(0, 200)}`);
          results.push({ variant: variant.label, rep, error: `HTTP ${res.status}` });
          continue;
        }

        const body = await res.json();
        const reply = body.reply ?? '';
        const usedWebSearch = body._debug?.usedWebSearch ?? null;
        const lang = classifyLanguage(reply);

        results.push({ variant: variant.label, rep, usedWebSearch, lang, replyPreview: reply.slice(0, 100) });
        console.log(`search=${usedWebSearch} lang=${lang}${lang !== 'ru' ? '  <-- NOT RUSSIAN' : ''}`);
      } catch (err) {
        console.log(`ERROR: ${err}`);
        results.push({ variant: variant.label, rep, error: String(err) });
      }

      await sleep(800); // gentle pacing, not required at this volume but harmless
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log('\n\n========== SUMMARY ==========\n');

  const valid = results.filter(r => !r.error);
  const errored = results.filter(r => r.error);

  console.log(`Total calls attempted: ${results.length} / ${totalCalls} planned`);
  console.log(`Errored: ${errored.length}`);
  console.log(`Valid responses: ${valid.length}\n`);

  function bucketStats(bucket, label) {
    if (bucket.length === 0) { console.log(`${label}: no samples`); return; }
    const ru = bucket.filter(r => r.lang === 'ru').length;
    console.log(`${label}: ${ru}/${bucket.length} responded in Russian (${Math.round(ru / bucket.length * 100)}%)`);
  }

  bucketStats(valid.filter(r => r.usedWebSearch === true), 'WITH web_search');
  bucketStats(valid.filter(r => r.usedWebSearch === false), 'WITHOUT web_search');

  console.log('\nPer-variant breakdown:');
  for (const v of VARIANTS) {
    bucketStats(valid.filter(r => r.variant === v.label), `  ${v.label}`);
  }

  const nonRussian = valid.filter(r => r.lang !== 'ru');
  if (nonRussian.length > 0) {
    console.log('\nNon-Russian responses (for manual inspection):');
    for (const r of nonRussian) {
      console.log(`  [${r.variant} rep ${r.rep}, search=${r.usedWebSearch}] "${r.replyPreview}..."`);
    }
  }

  if (errored.length > 0) {
    console.log('\nErrors:');
    for (const r of errored) console.log(`  [${r.variant} rep ${r.rep}] ${r.error}`);
  }

  console.log('\n(Full raw results as JSON below — paste the whole output back for analysis)');
  console.log(JSON.stringify(results, null, 2));
})();
