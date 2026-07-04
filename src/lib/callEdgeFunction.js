import { supabase, SUPABASE_URL, SUPABASE_KEY } from '../utils/supabase.js';

export async function callEdgeFunction(functionName, body) {
  const { data: { session } } = await supabase.auth.getSession();

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${session?.access_token}`,
    'apikey': SUPABASE_KEY,
  };

  const response = await fetch(
    `${SUPABASE_URL}/functions/v1/${functionName}`,
    { method: 'POST', headers, body: JSON.stringify(body) },
  );

  return response.json();
}
