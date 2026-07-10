// Shared financial constants for the frontend.
// Keep in sync with supabase/functions/_shared/financialConstants.ts — no
// automated linkage across Vite (frontend) and Deno (edge functions)
// runtimes, so both files must be updated together by hand when any value
// changes.

export const BUFFER = 1000;

export const SAVE_CAP_SMALL  = 200;
export const SAVE_CAP_MEDIUM = 500;
export const SAVE_CAP_LARGE  = 1000;

export const REC_MIN = 200;
export const REC_MAX = 400;

export const SAVINGS_TARGET_RATE = 0.20;
