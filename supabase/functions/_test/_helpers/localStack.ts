// Reads connection info for the local Supabase stack (`npx supabase start`)
// by shelling out to `supabase status -o env` and parsing its output.
//
// The integration tests in this folder run each edge function's handler
// in-process (see setup.ts) and let its real Supabase calls hit the local
// stack on 127.0.0.1 — only the external money/bank APIs (Alpaca, Plaid)
// are faked. So every integration test needs the stack up first.

export interface LocalConfig {
  apiUrl: string;          // http://127.0.0.1:54321
  dbUrl: string;           // postgresql://postgres:postgres@127.0.0.1:54322/postgres
  anonKey: string;
  serviceRoleKey: string;
  jwtSecret: string;
}

let cached: LocalConfig | null = null;

function parseEnvDump(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)="(.*)"\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

/**
 * Resolve and cache the local stack config. Throws a clear, actionable
 * error if the stack isn't running. Safe to call many times.
 */
export async function getLocalConfig(): Promise<LocalConfig> {
  if (cached) return cached;

  const bin = Deno.build.os === 'windows' ? 'npx.cmd' : 'npx';
  let stdout: Uint8Array, stderr: Uint8Array, code: number;
  try {
    const res = await new Deno.Command(bin, {
      args: ['supabase', 'status', '-o', 'env'],
      stdout: 'piped',
      stderr: 'piped',
    }).output();
    ({ stdout, stderr, code } = res);
  } catch (err) {
    throw new Error(
      `Could not run \`npx supabase status\` (${err instanceof Error ? err.message : err}). ` +
      `Is the Supabase CLI installed?`,
    );
  }

  if (code !== 0) {
    throw new Error(
      'The local Supabase stack is not running. Start it first:\n\n' +
      '  npx supabase start\n\n' +
      new TextDecoder().decode(stderr).trim(),
    );
  }

  const env = parseEnvDump(new TextDecoder().decode(stdout));
  const cfg: LocalConfig = {
    apiUrl: env.API_URL,
    dbUrl: env.DB_URL,
    anonKey: env.ANON_KEY,
    serviceRoleKey: env.SERVICE_ROLE_KEY,
    jwtSecret: env.JWT_SECRET,
  };

  if (!cfg.apiUrl || !cfg.serviceRoleKey || !cfg.anonKey) {
    throw new Error('Could not parse `supabase status -o env` output:\n' + new TextDecoder().decode(stdout));
  }

  cached = cfg;
  return cfg;
}

/** Synchronous accessor — only valid after getLocalConfig() has been awaited (setup.ts does this). */
export function getCachedConfig(): LocalConfig {
  if (!cached) throw new Error('getLocalConfig() must be awaited first — import ./_helpers/setup.ts before anything else.');
  return cached;
}
