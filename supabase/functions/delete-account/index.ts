// supabase/functions/delete-account/index.ts
// Permanently removes the caller's auth.users record using the admin API.
// Must be called AFTER client-side data deletion (transactions, savings, etc.)
// so the auth identity is the last thing removed.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_URL') ?? 'https://app.arkonomy.com',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const token = req.headers.get('Authorization')?.replace('Bearer ', '') ?? '';
  if (!token) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Validate the caller's JWT before doing anything destructive
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  const { error: deleteErr } = await supabase.auth.admin.deleteUser(user.id);
  if (deleteErr) {
    console.error('[delete-account] admin.deleteUser failed:', deleteErr);
    return new Response(JSON.stringify({ error: deleteErr.message }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ success: true }), {
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
});
