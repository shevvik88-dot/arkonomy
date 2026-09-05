// test-ai-chat-websearch-trigger.mjs
//
// Follow-up to test-ai-chat-language-ab.mjs: that run got 18/18 valid
// responses, 100% Russian — but usedWebSearch was false for all 18 calls,
// including the "stocks to buy" / "market today" variants expected to
// trigger it, so it never exercised the actual bug scenario (tool_result
// breaking the language anchor). Confirmed via SQL the test account IS
// canUseSearch-eligible (plan='pro', trial_ends_at=null) — this isn't an
// eligibility gap, the model just isn't choosing to search for those
// prompts. Likely cause: "what stocks should I buy" collides with the
// system prompt's own INVESTMENT QUESTION SCOPE instruction (decline the
// specific pick, pivot to the user's own financial position) — answerable
// entirely from local aiContext, no search needed.
//
// This script tries harder-to-answer-without-search variants (a named
// ticker's CURRENT price, "what happened this morning") in a small probe,
// then — only if at least one candidate actually triggered search — runs a
// focused 6-9 call batch of the best-performing variant.
//
// Usage:
//   node scripts/test-ai-chat-websearch-trigger.mjs
//
// Expects: .env.test (E2E_EMAIL, E2E_PASSWORD) and .env.local (VITE_SUPABASE_ANON_KEY)

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

// Deliberately factual current-data lookups, not recommendation requests —
// unlike "what stocks should I buy" (which the system prompt's own
// INVESTMENT QUESTION SCOPE instruction resolves by declining + pivoting to
// the user's own data, no search needed), these have a specific right
// answer that changes constantly and cannot come from training knowledge.
const PROBE_CANDIDATES = [
  { label: 'apple-price-now',  text: 'Какая сейчас цена акций Apple?' },
  { label: 'market-this-morning', text: 'Что произошло на фондовом рынке сегодня утром?' },
  { label: 'bitcoin-price-now', text: 'Какой курс биткоина прямо сейчас?' },
];
const PROBE_REPS = 2;      // 3 candidates x 2 = 6 probe calls
const MAIN_BATCH_REPS = 7; // + 7 more of the winner = 9 total for that variant

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function classifyLanguage(text) {
  const cyrillic = (text.match(/[а-яА-ЯёЁ]/g) || []).length;
  const latin = (text.match(/[a-zA-Z]/g) || []).length;
  const total = cyrillic + latin;
  if (total === 0) return 'unknown';
  return (cyrillic / total) > 0.5 ? 'ru' : 'other';
}

async function callAiChat(accessToken, text) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/ai-chat`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'apikey': ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messages: [{ role: 'user', text }],
      financialContext: FINANCIAL_CONTEXT,
    }),
  });
  if (res.status === 429) return { rateLimited: true };
  if (!res.ok) return { error: `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}` };
  const body = await res.json();
  const reply = body.reply ?? '';
  return {
    usedWebSearch: body._debug?.usedWebSearch ?? null,
    lang: classifyLanguage(reply),
    replyPreview: reply.slice(0, 100),
  };
}

(async () => {
  const supabase = createClient(SUPABASE_URL, ANON_KEY);

  console.log('Signing in...');
  const { data, error } = await supabase.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  if (error) { console.error('Sign-in failed:', error.message); process.exit(1); }
  const accessToken = data.session.access_token;
  console.log('✓ Signed in\n');

  // ── Phase 1: probe ────────────────────────────────────────────────────────
  console.log(`=== PHASE 1: probing ${PROBE_CANDIDATES.length} candidates x ${PROBE_REPS} reps ===\n`);
  const probeResults = [];
  let stop = false;

  for (const cand of PROBE_CANDIDATES) {
    for (let rep = 1; rep <= PROBE_REPS; rep++) {
      process.stdout.write(`[probe] ${cand.label} rep ${rep}... `);
      const r = await callAiChat(accessToken, cand.text);
      if (r.rateLimited) { console.log('429 rate limited — stopping.'); stop = true; break; }
      if (r.error) { console.log(r.error); probeResults.push({ variant: cand.label, rep, error: r.error }); continue; }
      probeResults.push({ variant: cand.label, rep, ...r });
      console.log(`search=${r.usedWebSearch} lang=${r.lang}`);
      await sleep(800);
    }
    if (stop) break;
  }

  console.log('\nProbe results by candidate:');
  const candidateStats = PROBE_CANDIDATES.map(cand => {
    const rows = probeResults.filter(r => r.variant === cand.label && !r.error);
    const triggered = rows.filter(r => r.usedWebSearch === true).length;
    console.log(`  ${cand.label}: ${triggered}/${rows.length} triggered web_search`);
    return { ...cand, triggered, total: rows.length };
  });

  const best = candidateStats.sort((a, b) => b.triggered - a.triggered)[0];

  if (!best || best.triggered === 0) {
    console.log('\n✗ NONE of the probe candidates triggered web_search even once.');
    console.log('Not spending the main batch on a variant with a 0% observed trigger rate.');
    console.log('Raw probe results:');
    console.log(JSON.stringify(probeResults, null, 2));
    console.log('\nSuggest trying even more explicit variants next (e.g. naming a very recent');
    console.log('specific event, or explicitly asking the model to "search the web for...").');
    process.exit(0);
  }

  console.log(`\n✓ Best candidate: "${best.label}" (${best.triggered}/${best.total} triggered in probe)`);

  if (stop) {
    console.log('Rate-limited during probe — stopping before the main batch. Re-run later for the main batch.');
    console.log(JSON.stringify(probeResults, null, 2));
    process.exit(0);
  }

  // ── Phase 2: focused batch on the winner ────────────────────────────────
  console.log(`\n=== PHASE 2: ${MAIN_BATCH_REPS} more reps of "${best.label}" ===\n`);
  const mainResults = [];
  for (let rep = 1; rep <= MAIN_BATCH_REPS; rep++) {
    process.stdout.write(`[main] ${best.label} rep ${rep}... `);
    const r = await callAiChat(accessToken, best.text);
    if (r.rateLimited) { console.log('429 rate limited — stopping early.'); break; }
    if (r.error) { console.log(r.error); mainResults.push({ variant: best.label, rep, error: r.error }); continue; }
    mainResults.push({ variant: best.label, rep, ...r });
    console.log(`search=${r.usedWebSearch} lang=${r.lang}${r.lang !== 'ru' ? '  <-- NOT RUSSIAN' : ''}`);
    await sleep(800);
  }

  // ── Combined summary for the winning variant (probe + main) ────────────
  const allForWinner = [...probeResults.filter(r => r.variant === best.label && !r.error), ...mainResults.filter(r => !r.error)];
  const withSearch = allForWinner.filter(r => r.usedWebSearch === true);
  const withoutSearch = allForWinner.filter(r => r.usedWebSearch === false);

  console.log('\n\n========== SUMMARY ==========\n');
  console.log(`Variant: "${best.label}" (${best.text})`);
  console.log(`Total valid calls (probe + main): ${allForWinner.length}\n`);

  function bucketStats(bucket, label) {
    if (bucket.length === 0) { console.log(`${label}: no samples`); return; }
    const ru = bucket.filter(r => r.lang === 'ru').length;
    console.log(`${label}: ${ru}/${bucket.length} responded in Russian (${Math.round(ru / bucket.length * 100)}%)`);
  }
  bucketStats(withSearch, 'WITH web_search');
  bucketStats(withoutSearch, 'WITHOUT web_search');

  const nonRussian = allForWinner.filter(r => r.lang !== 'ru');
  if (nonRussian.length > 0) {
    console.log('\nNon-Russian responses:');
    for (const r of nonRussian) console.log(`  [rep ${r.rep}, search=${r.usedWebSearch}] "${r.replyPreview}..."`);
  }

  console.log('\n(Full raw results as JSON below — paste the whole output back for analysis)');
  console.log(JSON.stringify({ probeResults, mainResults }, null, 2));
})();
