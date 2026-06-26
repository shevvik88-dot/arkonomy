// App Check tokens are RS256 JWTs signed by Google's keys.
// Verification uses JWKS — no service account or API credentials needed.
// The verifyToken REST API requires OAuth; JWKS is the correct server-side approach.

const JWKS_URL = 'https://firebaseappcheck.googleapis.com/v1/jwks';
let jwksCache: { keys: JsonWebKey[]; fetchedAt: number } | null = null;

async function getJwks(): Promise<JsonWebKey[]> {
  const now = Date.now();
  if (jwksCache && now - jwksCache.fetchedAt < 3_600_000) return jwksCache.keys;
  const res = await fetch(JWKS_URL);
  const { keys } = await res.json();
  jwksCache = { keys, fetchedAt: now };
  return keys;
}

function b64(s: string): string {
  return atob(s.replace(/-/g, '+').replace(/_/g, '/'));
}

export async function verifyAppCheck(req: Request): Promise<boolean> {
  const token = req.headers.get('X-Firebase-AppCheck');
  if (!token) return false;

  try {
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const [headerB64, payloadB64, sigB64] = parts;

    const header  = JSON.parse(b64(headerB64));
    const payload = JSON.parse(b64(payloadB64));

    if (Date.now() / 1000 > payload.exp) return false;

    const keys = await getJwks();
    // deno-lint-ignore no-explicit-any
    const jwk = keys.find((k: any) => k.kid === header.kid);
    if (!jwk) return false;

    const cryptoKey = await crypto.subtle.importKey(
      'jwk', jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false, ['verify'],
    );

    const signedData = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
    const sigBytes   = Uint8Array.from(b64(sigB64), c => c.charCodeAt(0));
    const valid = await crypto.subtle.verify(
      { name: 'RSASSA-PKCS1-v1_5' }, cryptoKey, sigBytes, signedData,
    );
    if (!valid) return false;

    // Validate audience: aud must include "projects/{PROJECT_NUMBER}".
    // Project number is the middle segment of the app ID: "1:{NUMBER}:web:..."
    const appId         = Deno.env.get('FIREBASE_APP_ID') ?? '1:426653319853:web:55124f9464c214ef157c24';
    const projectNumber = appId.split(':')[1];
    const expectedAud   = `projects/${projectNumber}`;
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!aud.includes(expectedAud)) return false;

    return true;
  } catch (err) {
    console.error('appCheck verify error:', err);
    return false;
  }
}
