import { supabase, SUPABASE_URL, SUPABASE_KEY } from '../utils/supabase.js';
import { getAppCheckToken } from './appCheck.js';

export async function callEdgeFunction(functionName, body) {
  const appCheckToken = await getAppCheckToken();
  const { data: { session } } = await supabase.auth.getSession();

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${session?.access_token}`,
    'apikey': SUPABASE_KEY,
  };

  if (appCheckToken) {
    headers['X-Firebase-AppCheck'] = appCheckToken;
  }

  const response = await fetch(
    `${SUPABASE_URL}/functions/v1/${functionName}`,
    { method: 'POST', headers, body: JSON.stringify(body) },
  );

  return response.json();
}
