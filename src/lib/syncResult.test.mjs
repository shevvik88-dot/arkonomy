// Unit tests for classifySyncResult — the plaid-sync-transactions result
// classifier. Run: node --test src/lib/syncResult.test.mjs
// The real call-site wiring (fetch -> decode -> classify -> App reaction)
// is covered separately in syncPaths.test.mjs.
//
// #96 P2: a 502 with an HTML body, an empty body, a 401/500, an unexpected
// 2xx, or a 200 whose numbers are missing / negative / fractional /
// internally inconsistent must NOT be treated as a clean sync (which would
// stamp last_synced_at and make bgSync skip the failed banks for an hour).

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
    classifySyncResult({ status: 200, ok: true, data: { added: 0, modified: 0, removed: 0, synced: 0, failed_items: ['item_x'] } }),
    'partial',
  );
});

test('an unexpected 2xx (201/204) with an otherwise-valid body -> error', () => {
  assert.equal(classifySyncResult({ status: 201, ok: true, data: { added: 3, modified: 1, removed: 0, synced: 4 } }), 'error');
  assert.equal(classifySyncResult({ status: 204, ok: true, data: { added: 0, modified: 0, removed: 0, synced: 0 } }), 'error');
});

test('a 200 missing count fields -> error', () => {
  assert.equal(classifySyncResult({ status: 200, ok: true, data: { synced: 4 } }), 'error');
});

test('a 200 with a negative or fractional count -> error', () => {
  assert.equal(classifySyncResult({ status: 200, ok: true, data: { added: 3, modified: 1, removed: -1, synced: 4 } }), 'error');
  assert.equal(classifySyncResult({ status: 200, ok: true, data: { added: 3, modified: 1, removed: 0.5, synced: 4 } }), 'error');
});

test('a 200 where synced != added + modified -> error', () => {
  assert.equal(classifySyncResult({ status: 200, ok: true, data: { added: 3, modified: 1, removed: 0, synced: 5 } }), 'error');
});

test('a malformed failed_items (non-array, or empty/non-string ids) -> error', () => {
  assert.equal(classifySyncResult({ status: 200, ok: true, data: { added: 3, modified: 1, removed: 0, synced: 4, failed_items: {} } }), 'error');
  assert.equal(classifySyncResult({ status: 207, ok: true, data: { added: 3, modified: 1, removed: 0, synced: 4, failed_items: [null] } }), 'error');
  assert.equal(classifySyncResult({ status: 207, ok: true, data: { added: 3, modified: 1, removed: 0, synced: 4, failed_items: ['  '] } }), 'error');
});

test('a bare 207 with no counts -> error', () => {
  assert.equal(classifySyncResult({ status: 207, ok: true, data: {} }), 'error');
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
