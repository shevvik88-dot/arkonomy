// test-amount-check-constraints.mjs
//
// Standalone, disposable script — verifies the CHECK constraints added in
// migration 20260818000001 (transactions.amount > 0 AND != 'NaN',
// savings.target > 0 AND != 'NaN', savings.current >= 0 AND != 'NaN')
// actually reject bad values through the real RLS-scoped client path (anon
// key + a real user session), the same path the original 2026-08-17
// finding used to insert them successfully. Mirrors that finding's exact
// method, now expecting rejection instead of silent success.
//
// Every insert attempt here is expected to FAIL — but the failure MUST be
// a 23514 check_violation (the CHECK constraint), not RLS rejecting the
// row for an unrelated reason (e.g. a missing/wrong user_id) shadowing the
// thing actually under test. Found and fixed 2026-08-19: the first version
// of this script omitted user_id from the insert body, so RLS's
// WITH CHECK (user_id = auth.uid()) rejected every row on a NULL user_id
// before Postgres ever reached the CHECK constraint — all 8 cases "passed"
// for the wrong reason (403 RLS, not 400/23514 check_violation). Fixed by
// setting user_id explicitly to the caller's own id (fetched via
// GET /auth/v1/user) so RLS's ownership check passes and the CHECK
// constraint is what actually gets exercised.
//
// Nothing is meant to actually persist — but each case still checks
// afterward and deletes the row if a bug let it through, so no junk data
// is left in the test account either way.
//
// Usage (PowerShell):
//   $env:ARKONOMY_ACCESS_TOKEN = "<paste from browser, see below>"
//   $env:VITE_SUPABASE_ANON_KEY = "<same value as in your .env.local>"
//   node scripts/test-amount-check-constraints.mjs
//
// To get ARKONOMY_ACCESS_TOKEN: while logged into app.arkonomy.com, open
// DevTools Console and run:
//   copy(JSON.parse(localStorage.getItem('sb-hvnkxxazjfesbxdkzuba-auth-token')).access_token)
// Paste into the $env: line above, never into chat.

const SUPABASE_URL = 'https://hvnkxxazjfesbxdkzuba.supabase.co';
const ACCESS_TOKEN = process.env.ARKONOMY_ACCESS_TOKEN;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;

if (!ACCESS_TOKEN) { console.error('Missing ARKONOMY_ACCESS_TOKEN'); process.exit(1); }
if (!ANON_KEY) { console.error('Missing VITE_SUPABASE_ANON_KEY'); process.exit(1); }

function headers() {
  return {
    'Authorization': `Bearer ${ACCESS_TOKEN}`,
    'apikey': ANON_KEY,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
  };
}

async function attemptInsert(table, label, row) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(row),
  });
  const body = await res.json().catch(() => null);
  const blocked = res.status >= 400;
  const isCheckViolation = body?.code === '23514';
  console.log(`[${table}] ${label}: HTTP ${res.status} — ${blocked ? 'BLOCKED' : 'INSERTED (unexpected!)'}`);
  if (!blocked) {
    console.log('    body:', JSON.stringify(body));
  } else {
    console.log(`    error: ${body?.message || body?.code || JSON.stringify(body)}`);
    if (!isCheckViolation) {
      console.log('    ⚠ NOT a 23514 check_violation — blocked for a DIFFERENT reason (likely RLS). This does not confirm the CHECK constraint.');
    }
  }

  // Clean up if it somehow succeeded (array or single object response shape)
  const inserted = Array.isArray(body) ? body[0] : body;
  if (!blocked && inserted?.id) {
    await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${inserted.id}`, {
      method: 'DELETE',
      headers: headers(),
    });
    console.log('    (cleaned up the unexpectedly-inserted row)');
  }
  return isCheckViolation;
}

(async () => {
  // Need the caller's own id so RLS's WITH CHECK (user_id = auth.uid())
  // passes and the CHECK constraint is what's actually under test.
  const meRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}`, 'apikey': ANON_KEY },
  });
  const me = await meRes.json();
  if (!me?.id) { console.error('Could not resolve caller id from token'); process.exit(1); }
  const userId = me.id;

  console.log('=== transactions.amount CHECK constraint ===');
  const t1 = await attemptInsert('transactions', 'amount=-100', {
    user_id: userId, amount: -100, description: 'PENTEST negative', type: 'expense', source: 'manual',
  });
  const t2 = await attemptInsert('transactions', 'amount=0', {
    user_id: userId, amount: 0, description: 'PENTEST zero', type: 'expense', source: 'manual',
  });
  const t3 = await attemptInsert('transactions', 'amount=NaN', {
    user_id: userId, amount: 'NaN', description: 'PENTEST nan', type: 'expense', source: 'manual',
  });

  console.log('\n=== savings.target / savings.current CHECK constraints ===');
  const s1 = await attemptInsert('savings', 'target=-100', {
    user_id: userId, name: 'PENTEST target neg', target: -100, current: 0,
  });
  const s2 = await attemptInsert('savings', 'target=0', {
    user_id: userId, name: 'PENTEST target zero', target: 0, current: 0,
  });
  const s3 = await attemptInsert('savings', 'target=NaN', {
    user_id: userId, name: 'PENTEST target nan', target: 'NaN', current: 0,
  });
  const s4 = await attemptInsert('savings', 'current=-1', {
    user_id: userId, name: 'PENTEST current neg', target: 100, current: -1,
  });
  const s5 = await attemptInsert('savings', 'current=NaN', {
    user_id: userId, name: 'PENTEST current nan', target: 100, current: 'NaN',
  });

  const all = [t1, t2, t3, s1, s2, s3, s4, s5];
  console.log('\n=== Verdict ===');
  console.log(all.every(Boolean)
    ? 'PASS: all 8 bad-value insert attempts were rejected specifically by the CHECK constraints (23514).'
    : 'FAIL or INCONCLUSIVE: at least one attempt was not a confirmed 23514 check_violation — see ⚠ lines above.');
})();
