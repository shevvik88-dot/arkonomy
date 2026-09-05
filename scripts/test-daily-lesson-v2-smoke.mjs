// test-daily-lesson-v2-smoke.mjs
//
// Smoke test for the new daily-lesson-v2 edge function.
// Signs in with E2E_EMAIL / E2E_PASSWORD from .env.test, obtains access token,
// calls the daily-lesson-v2 endpoint with lang: 'en', reports HTTP status + response status field.
//
// Usage:
//   node scripts/test-daily-lesson-v2-smoke.mjs
//
// Expects: .env.test (E2E_EMAIL, E2E_PASSWORD) and .env.local (VITE_SUPABASE_ANON_KEY)
// Expected result: 200 with status `no_active_diagnosis` (test account has no active diagnosis_profiles row)

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

// Load environment variables
dotenv.config({ path: '.env.test' });
dotenv.config({ path: '.env.local' });

const SUPABASE_URL = 'https://hvnkxxazjfesbxdkzuba.supabase.co';
const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;

if (!EMAIL) { console.error('Missing E2E_EMAIL in .env.test'); process.exit(1); }
if (!PASSWORD) { console.error('Missing E2E_PASSWORD in .env.test'); process.exit(1); }
if (!ANON_KEY) { console.error('Missing VITE_SUPABASE_ANON_KEY in .env.local'); process.exit(1); }

(async () => {
  // Step 1: Create Supabase client and sign in
  const supabase = createClient(SUPABASE_URL, ANON_KEY);
  
  console.log('Signing in...');
  const { data, error } = await supabase.auth.signInWithPassword({
    email: EMAIL,
    password: PASSWORD,
  });
  
  if (error) {
    console.error('Sign-in failed:', error.message);
    process.exit(1);
  }
  
  const accessToken = data.session.access_token;
  console.log('✓ Signed in successfully\n');
  
  // Step 2: Call daily-lesson-v2 endpoint
  console.log('Calling /functions/v1/daily-lesson-v2...');
  const res = await fetch(`${SUPABASE_URL}/functions/v1/daily-lesson-v2`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'apikey': ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ lang: 'en' }),
  });
  
  const body = await res.json();
  
  // Step 3: Report results
  console.log(`\nHTTP Status: ${res.status}`);
  console.log(`Response status field: ${body?.status}`);
  
  if (res.status >= 400) {
    console.log('\nError response (verbatim):');
    console.log(JSON.stringify(body, null, 2));
    process.exit(1);
  }
  
  if (body?.status === 'no_active_diagnosis') {
    console.log('\n✓ PASS: no_active_diagnosis (expected for test account with no diagnosis_profiles row)');
  } else if (body?.status === 'lesson_scheduled') {
    console.log('\n✓ PASS: lesson_scheduled');
    console.log(`  lesson_key: ${body?.lesson_key || '(missing)'}`);
    console.log(`  has narrative: ${typeof body?.narrative === 'string' ? '✓' : '✗'}`);
  } else {
    console.log('\nFull response (unexpected status):');
    console.log(JSON.stringify(body, null, 2));
    process.exit(1);
  }
})();
