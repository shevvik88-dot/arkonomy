// Unit tests for classifySyncResult — the plaid-sync-transactions result
// classifier. Run: node --test src/lib/callEdgeFunction.test.mjs
//
// #96 P2: a 502 with an HTML body, an empty body, or a 401/500 must NOT be
// treated as a clean sync (which would stamp last_synced_at and make
// bgSync skip the failed banks for an hour).

import test from 'node:test';
import assert from 'node:assert/strict';
import { classifySyncResult } from './syncResult.js';

test('a clean 200 with the sync contract -> clean', () => {
  assert.equal(
    classifySyncResult({ status: 200, ok: true, data: { added: 3, modified: 1, removed: 0, synced: 4 } }),
    'clean',
  );
});

test('a 207 Multi-Status with failed_items -> partial', () => {
  assert.equal(
    classifySyncResult({ status: 207, ok: true, data: { added: 1, modified: 0, removed: 0, synced: 1, failed_items: ['item_x'] } }),
    'partial',
  );
});

test('a 200 that still carries a non-empty failed_items -> partial', () => {
  assert.equal(
    classifySyncResult({ status: 200, ok: true, data: { synced: 0, failed_items: ['item_x'] } }),
    'partial',
  );
});

test('a 502 whose HTML body failed to parse (data null) -> error', () => {
  assert.equal(classifySyncResult({ status: 502, ok: false, data: null }), 'error');
});

test('a 200 with an empty / unparseable body (data null) -> error', () => {
  assert.equal(classifySyncResult({ status: 200, ok: true, data: null }), 'error');
});

test('a 401 -> error', () => {
  assert.equal(classifySyncResult({ status: 401, ok: false, data: { error: 'Unauthorized' } }), 'error');
});

test('a 500 with an error body -> error', () => {
  assert.equal(classifySyncResult({ status: 500, ok: false, data: { error: 'Internal Server Error' } }), 'error');
});

test('a 200 whose shape is wrong (no numeric synced) -> error, not clean', () => {
  assert.equal(classifySyncResult({ status: 200, ok: true, data: { message: 'ok' } }), 'error');
  assert.equal(classifySyncResult({ status: 200, ok: true, data: { synced: 'lots' } }), 'error');
});

test('a 200 with data.error set -> error even though ok', () => {
  assert.equal(classifySyncResult({ status: 200, ok: true, data: { error: 'ITEM_LOGIN_REQUIRED', synced: 0 } }), 'error');
});

test('missing / undefined argument -> error (never clean)', () => {
  assert.equal(classifySyncResult(), 'error');
  assert.equal(classifySyncResult({}), 'error');
});
