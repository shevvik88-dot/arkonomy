import { supabase, SUPABASE_URL, SUPABASE_KEY } from '../utils/supabase.js';

async function invoke(functionName, body) {
  const { data: { session } } = await supabase.auth.getSession();

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${session?.access_token}`,
    'apikey': SUPABASE_KEY,
  };

  return fetch(
    `${SUPABASE_URL}/functions/v1/${functionName}`,
    { method: 'POST', headers, body: JSON.stringify(body) },
  );
}

export async function callEdgeFunction(functionName, body) {
  const response = await invoke(functionName, body);
  return response.json();
}

// Same request, but keeps the HTTP status. Needed by callers that must tell
// a 207 Multi-Status (partial success — e.g. plaid-sync-transactions
// syncing some of a user's banks and failing others, body carries
// `failed_items`) apart from a clean 200. `data` is null on an empty or
// non-JSON body rather than throwing.
export async function callEdgeFunctionWithStatus(functionName, body) {
  const response = await invoke(functionName, body);
  let data = null;
  try { data = await response.json(); } catch { /* empty / non-JSON body */ }
  return { status: response.status, ok: response.ok, data };
}
