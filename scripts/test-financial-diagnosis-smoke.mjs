// test-financial-diagnosis-smoke.mjs
//
// Smoke test for the new financial-diagnosis edge function.
// Signs in with E2E_EMAIL / E2E_PASSWORD from .env.test, obtains access token,
// calls the financial-diagnosis endpoint, reports status + response shape.
//
// Usage:
//   node scripts/test-financial-diagnosis-smoke.mjs
//
// Expects: .env.test (E2E_EMAIL, E2E_PASSWORD) and .env.local (VITE_SUPABASE_ANON_KEY)

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
  
  // Step 2: Call financial-diagnosis endpoint
  console.log('Calling /functions/v1/financial-diagnosis...');
  const res = await fetch(`${SUPABASE_URL}/functions/v1/financial-diagnosis`, {
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
  
  if (body?.status === 'diagnosed') {
    const { narrative, metrics, primary_issues } = body;
    console.log('\nStructural checks:');
    console.log(`  narrative: ${typeof narrative === 'string' && narrative.length > 0 ? '✓ present' : '✗ missing/empty'}`);
    console.log(`  metrics: ${Array.isArray(metrics) ? '✓ is array' : typeof metrics === 'object' ? '✓ is object' : '✗ invalid'}`);
    console.log(`  primary_issues: ${Array.isArray(primary_issues) ? '✓ is array' : typeof primary_issues === 'object' ? '✓ is object' : '✗ invalid'}`);
    
    if (typeof narrative === 'string' && narrative.includes('Error') && narrative.includes('Traceback')) {
      console.log('\n✗ ERROR: narrative contains stack trace');
      process.exit(1);
    }
    console.log('\n✓ PASS: response structure looks sane');
  } else if (body?.status === 'insufficient_data') {
    console.log('\n✓ PASS: insufficient_data (expected if test account has no data)');
  } else {
    console.log('\nFull response (unexpected status):');
    console.log(JSON.stringify(body, null, 2));
    process.exit(1);
  }
})();
