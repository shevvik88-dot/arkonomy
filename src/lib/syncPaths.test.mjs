// #96 item 4 — exercise the REAL plaid-sync call-site wiring, not just the
// pure classifier.
//
// classifySyncResult() is unit-tested in isolation in syncResult.test.mjs.
// That leaves the actual decode+classify+react path untested: the HTTP
// decoder in callEdgeFunction.js (callEdgeFunctionWithStatus -> response.json()
// in a try/catch -> { status, ok, data }) and the two App.jsx callbacks that
// consume it (syncBankTransactions — foreground, and bgSync — background).
//
// Both are Vite modules (import.meta.env), so we can't import them under
// `node --test`. Instead we lift the two function bodies out of App.jsx by
// text and the decoder out of callEdgeFunction.js (imports stripped), then
// run them in a vm context with a fake `fetch` returning real Response
// objects. This is deliberately literal: a real HTML 502 string, a real
// empty body, real 401/500/207/200 payloads go through the real
// response.json() decode.
//
// FRAGILE: the lift relies on App.jsx keeping `  async function <name>() {`
// … `\n  }` (2-space-indented close). The guards below fail loudly if a
// refactor breaks that; if these two functions are ever extracted into a
// module, replace the lift with a direct import.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { classifySyncResult } from './syncResult.js';

const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8');
const decoder = readFileSync(new URL('./callEdgeFunction.js', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/m, '')
  .replace(/^export \{[^}]*\} from [^;]*;\r?\n?/m, '')
  .replaceAll('export async function', 'async function');

assert.ok(decoder.includes('async function callEdgeFunctionWithStatus'), 'decoder lift failed');
assert.ok(!/^\s*(import|export)\b/m.test(decoder), 'decoder still has a top-level import/export statement');

function lift(name) {
  const start = app.indexOf(`  async function ${name}() {`);
  assert.notEqual(start, -1, `could not find ${name} in App.jsx`);
  const end = app.indexOf('\n  }', start) + 4;
  const body = app.slice(start, end);
  assert.ok(body.endsWith('\n  }'), `${name} lift did not end on its closing brace`);
  assert.ok(body.includes('classifySyncResult('), `${name} lift missing classifySyncResult call`);
  return body;
}
const bodies = { syncBankTransactions: lift('syncBankTransactions'), bgSync: lift('bgSync') };

const valid = { added: 3, modified: 1, removed: 0, synced: 4 };
// [label, http status, response body (string = sent verbatim), expected kind]
const cases = [
  ['clean 200 contract',          200, valid,                                  'clean'],
  ['207 partial',                 207, { ...valid, failed_items: ['bank_1'] }, 'partial'],
  ['200 carrying failed_items',   200, { ...valid, failed_items: ['bank_1'] }, 'partial'],
  ['HTML 502',                    502, '<html><body>502 Bad Gateway</body></html>', 'error'],
  ['empty 200 body',              200, '',                                     'error'],
  ['empty 401 body',              401, '',                                     'error'],
  ['empty 500 body',              500, '',                                     'error'],
  ['401 json',                    401, { error: 'Unauthorized' },              'error'],
  ['500 json',                    500, { error: 'Internal Server Error' },     'error'],
  ['truncated / malformed json',  200, '{"synced":',                           'error'],
  ['200 missing count fields',    200, { synced: 4 },                          'error'],
  ['200 negative count',          200, { ...valid, removed: -1 },              'error'],
  ['200 fractional count',        200, { ...valid, removed: 0.5 },             'error'],
  ['200 synced != added+modified',200, { ...valid, synced: 5 },               'error'],
  ['200 failed_items not array',  200, { ...valid, failed_items: {} },         'error'],
  ['207 failed_items has null id',207, { ...valid, failed_items: [null] },     'error'],
  ['207 empty body object',       207, {},                                    'error'],
  ['unexpected 201',              201, valid,                                  'error'],
  ['200 array body',              200, [],                                     'error'],
];

for (const name of ['syncBankTransactions', 'bgSync']) {
  for (const [label, status, body, kind] of cases) {
    test(`${name}: ${label} -> ${kind}`, async () => {
      const ev = { stamps: 0, writes: 0, storage: 0, calls: 0, loads: 0, alerts: 0, kind: null };
      const ctx = vm.createContext({
        Response,
        classifySyncResult: (r) => { ev.kind = classifySyncResult(r); return ev.kind; },
        SUPABASE_URL: 'http://local.invalid', SUPABASE_KEY: 'fake-key',
        fetch: async () => {
          ev.calls++;
          return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
        },
        supabase: {
          auth: { getSession: async () => ({ data: { session: { access_token: 'fake' } } }) },
          from: () => ({
            update: () => { ev.writes++; return { eq: async () => ({ error: null }) }; },
            select: () => ({ eq: () => ({ single: async () => ({ data: { last_synced_at: null } }) }) }),
          }),
        },
        setLastSyncedAt: () => ev.stamps++,
        localStorage: { setItem: () => ev.storage++ },
        setSyncingBank: () => {}, setBackgroundSyncing: () => {}, clearAccountsCache: () => {},
        loadAll: async () => { ev.loads++; },
        logger: { warn: () => {}, error: () => {} },
        showAlertRef: { current: () => ev.alerts++ },
        user: { id: 'local-user' },
        syncingBank: false, bgSyncLockRef: { current: false }, isSyncStale: () => true,
      });
      vm.runInContext(decoder + '\n' + bodies[name], ctx);
      await vm.runInContext(`${name}()`, ctx);

      assert.equal(ev.calls, 1, 'edge function called exactly once');
      assert.equal(ev.kind, kind, 'classified sync kind');
      // Only a clean sync may advance last_synced_at / persist it.
      for (const k of ['stamps', 'writes', 'storage']) {
        assert.equal(ev[k], kind === 'clean' ? 1 : 0, `${k} only on a clean sync`);
      }
      assert.equal(ev.loads, (name === 'syncBankTransactions' || kind !== 'error') ? 1 : 0, 'loadAll');
      assert.equal(ev.alerts, (name === 'syncBankTransactions' && kind !== 'clean') ? 1 : 0, 'user alert');
      assert.equal(ctx.bgSyncLockRef.current, false, 'bgSync lock released');
    });
  }
}

test('a rejected fetch (network failure) never stamps last_synced_at', async () => {
  for (const name of ['syncBankTransactions', 'bgSync']) {
    const ev = { stamps: 0, writes: 0 };
    const ctx = vm.createContext({
      Response, classifySyncResult,
      SUPABASE_URL: 'http://local.invalid', SUPABASE_KEY: 'fake-key',
      fetch: async () => { throw new TypeError('Failed to fetch'); },
      supabase: {
        auth: { getSession: async () => ({ data: { session: { access_token: 'fake' } } }) },
        from: () => ({
          update: () => { ev.writes++; return { eq: async () => ({ error: null }) }; },
          select: () => ({ eq: () => ({ single: async () => ({ data: { last_synced_at: null } }) }) }),
        }),
      },
      setLastSyncedAt: () => ev.stamps++,
      localStorage: { setItem: () => {} },
      setSyncingBank: () => {}, setBackgroundSyncing: () => {}, clearAccountsCache: () => {},
      loadAll: async () => {}, logger: { warn: () => {}, error: () => {} },
      showAlertRef: { current: () => {} }, user: { id: 'local-user' },
      syncingBank: false, bgSyncLockRef: { current: false }, isSyncStale: () => true,
    });
    vm.runInContext(decoder + '\n' + bodies[name], ctx);
    await vm.runInContext(`${name}()`, ctx);
    assert.equal(ev.stamps, 0, `${name}: no stamp on network failure`);
    assert.equal(ev.writes, 0, `${name}: no profile write on network failure`);
    assert.equal(ctx.bgSyncLockRef.current, false, `${name}: lock released`);
  }
});
