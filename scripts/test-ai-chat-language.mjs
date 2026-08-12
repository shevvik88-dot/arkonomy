// test-ai-chat-language.mjs
//
// Live verification for: ai-chat responding in the user's selected app
// language (ctx.language) instead of guessing from message text alone,
// with an explicit exception when the latest message is clearly written
// in a different language.
//
// Sends minimal financialContext (just `language`, everything else
// omitted — buildSystemPrompt() handles missing fields via optional
// chaining, no crash). No money moved, no financial data required.
//
// Usage (PowerShell):
//   $env:ARKONOMY_ACCESS_TOKEN = "<paste from browser, see below>"
//   $env:VITE_SUPABASE_ANON_KEY = "<same value as in your .env>"
//   node scripts/test-ai-chat-language.mjs
//
// To get ARKONOMY_ACCESS_TOKEN: while logged into app.arkonomy.com, open
// DevTools Console and run:
//   copy(JSON.parse(localStorage.getItem('sb-hvnkxxazjfesbxdkzuba-auth-token')).access_token)

const SUPABASE_URL = 'https://hvnkxxazjfesbxdkzuba.supabase.co';
const ACCESS_TOKEN = process.env.ARKONOMY_ACCESS_TOKEN;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;

if (!ACCESS_TOKEN) { console.error('Missing ARKONOMY_ACCESS_TOKEN'); process.exit(1); }
if (!ANON_KEY) { console.error('Missing VITE_SUPABASE_ANON_KEY'); process.exit(1); }

async function chat(message, language) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/ai-chat`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${ACCESS_TOKEN}`,
      'apikey': ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messages: [{ role: 'user', text: message }],
      // A real currentBalance is required here — leaving metrics undefined
      // makes buildSystemPrompt() fall into its BALANCE-unavailable branch,
      // which injects a full English sentence into the prompt regardless of
      // `language` and confounds this test (found 2026-08-11: it's why the
      // RU-default case kept losing to English while ES/RU-override didn't).
      financialContext: { language, metrics: { currentBalance: 1500 } },
    }),
  });
  let json;
  try { json = await res.json(); } catch { json = null; }
  return { status: res.status, reply: json?.reply ?? null, raw: json };
}

let pass = 0, fail = 0;
function check(label, condition, detail) {
  if (condition) { console.log(`PASS  ${label}`); pass++; }
  else { console.log(`FAIL  ${label}  —  ${detail}`); fail++; }
}

const hasCyrillic = (s) => /[Ѐ-ӿ]/.test(s || '');
const looksSpanish = (s) => /[¿¡ñáéíóú]|(?:\b(?:qué|cómo|tu|tus|gasto|ahorro|dinero)\b)/i.test(s || '');
const looksEnglish = (s) => /\b(you|your|this|month|spending|balance)\b/i.test(s || '') && !hasCyrillic(s);

(async () => {
  console.log('=== Default: app language RU, message in English → expect Russian reply ===');
  {
    const r = await chat("What's my balance looking like this month?", 'ru');
    console.log(JSON.stringify(r.reply)?.slice(0, 300));
    check('replies in Russian per app language', r.status === 200 && hasCyrillic(r.reply), `got ${r.status}: ${r.reply}`);
  }

  console.log('\n=== Exception: app language EN, most recent message in Russian → expect Russian reply ===');
  {
    const r = await chat('Привет! Как у меня с бюджетом в этом месяце?', 'en');
    console.log(JSON.stringify(r.reply)?.slice(0, 300));
    check('follows latest message language over app language', r.status === 200 && hasCyrillic(r.reply), `got ${r.status}: ${r.reply}`);
  }

  console.log('\n=== Default: app language ES, message in English → expect Spanish reply ===');
  {
    const r = await chat("How's my spending trending this month?", 'es');
    console.log(JSON.stringify(r.reply)?.slice(0, 300));
    check('replies in Spanish per app language', r.status === 200 && looksSpanish(r.reply), `got ${r.status}: ${r.reply}`);
  }

  console.log('\n=== Baseline: app language EN, message in English → expect English reply ===');
  {
    const r = await chat("How's my spending trending this month?", 'en');
    console.log(JSON.stringify(r.reply)?.slice(0, 300));
    check('replies in English per app language', r.status === 200 && looksEnglish(r.reply), `got ${r.status}: ${r.reply}`);
  }

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
})();
