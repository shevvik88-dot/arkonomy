// src/utils/diagnosisFreshness.js
//
// Shared staleness logic for an active diagnosis_profiles row — used by
// both Dashboard.jsx (entry-card state) and FinancialDiagnosis.jsx (decides
// whether to trust the cached row or run a fresh analysis). One definition
// of "stale" for both consumers, not two independently-drifting copies.
//
// Two independent staleness signals, kept as two separate, honestly-worded
// reasons rather than collapsed into one generic "recheck" flag — see
// dashboard.diagnosis_stale_time vs dashboard.diagnosis_stale_event:
// - Time-based: older than RECENT_MS.
// - Event-based: a "significant financial event" happened since the
//   diagnosis was computed.

import { supabase } from "./supabase";

// Matches the weekly re-check cadence used for the cost estimate
// (2026-08-23) — an existing active diagnosis younger than this is shown
// straight away, no re-analysis animation, no fresh Claude call.
export const DIAGNOSIS_RECENT_MS = 7 * 24 * 60 * 60 * 1000;

// Event-based trigger (2026-08-24): deliberately reuses the existing
// large-transaction-alert feature's own decision instead of building a new
// detector. transactions.large_tx_notified is set by EITHER channel that
// already exists — the client-side Autopilot toast (App.jsx, fixed
// user-configurable threshold) or the server-side email cron
// (large-transaction-alert edge function, dynamic 95th-percentile
// threshold) — whichever fires first for a transaction. Reusing this flag
// means picking up whichever channel actually caught the transaction,
// without re-implementing either threshold or the recurring-transaction
// exclusion logic that already went into setting the flag.
//
// Fails closed (returns false) on a query error — a transient failure here
// should never fabricate a "something changed" alarm for the user.
export async function hasSignificantEventSince(sinceIso) {
  try {
    const { data, error } = await supabase
      .from("transactions")
      .select("id")
      .eq("large_tx_notified", true)
      .gt("created_at", sinceIso)
      .limit(1);
    if (error) return false;
    return (data?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

// Combines both signals into the one decision FinancialDiagnosis.jsx's
// mount effect needs: is the given active diagnosis row still good to show
// as-is, or does it need a fresh run?
export async function isDiagnosisFresh(createdAt) {
  const ageMs = Date.now() - new Date(createdAt).getTime();
  if (ageMs >= DIAGNOSIS_RECENT_MS) return false;
  if (await hasSignificantEventSince(createdAt)) return false;
  return true;
}
