// supabase/functions/_shared/logoCache.ts
// Per-symbol company logo, Finnhub /stock/profile2 — the `logo` field only,
// not the full profile+metrics+quote payload market-data's "stats" type
// already fetches for the StockDetail screen. That existing "stats" call
// already receives a real, licensed logo URL (profile.logo) but never
// renders it — this module exists so a compact multi-symbol list (Markets'
// Holdings row) can get just the logo without tripling its Finnhub call
// count per symbol, which would compound the same shared-budget constraint
// already documented in SECURITY_THREAT_MODEL.md (D2 — market-data sits on
// a single shared Finnhub key with a real, hit-in-practice rate ceiling).
//
// Returns a data: URI, not the raw Finnhub CDN URL. Confirmed live
// (2026-09-02): handing the client the raw static2.finnhub.io URL to
// hotlink directly in an <img> worked from curl and from a neutral
// third-party origin, but returned a real HTTP 503 when the browser loaded
// it as a sub-resource of the arkonomy app itself (Cloudflare/Finnhub-side
// hotlink or bot protection, reproduced 3/3) — every logo silently fell
// back to the plain icon in the actual product. Fetching the image bytes
// here (server-to-server, not subject to that same-origin/referer check)
// and re-serving them ourselves sidesteps it entirely.
//
// Logos essentially never change, so this uses a much longer TTL than
// marketSnapshot.ts's 45s quote cache (which has to stay fresh) — once a
// symbol's logo is fetched by any caller on a warm isolate, it's served
// from memory for a week before ever hitting Finnhub again. Paired with a
// matching long-TTL cache on the client (Markets.jsx), most repeat visits
// never even reach this function.

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days — logos don't change

// Now caching full data: URIs (tens of KB each) instead of short link
// strings, so an isolate that happens to see many distinct tickers over its
// lifetime could otherwise grow this map unbounded. Cap total entries and
// evict the oldest on overflow (Map preserves insertion order) — cheap
// insurance, not a real-world limit any normal Holdings/watchlist mix
// should ever approach.
const MAX_CACHE_ENTRIES = 500;
const cache: Map<string, { logo: string | null; expiresAt: number }> = new Map();
// Per-symbol in-flight dedup — concurrent requests for the same
// not-yet-cached symbol (e.g. several holdings rows resolving at once
// across different users hitting the same warm isolate) collapse into one
// real Finnhub call instead of one per caller, same principle as
// marketSnapshot.ts's single inFlight promise, just keyed per symbol here
// since this cache spans arbitrary tickers instead of one fixed set.
const inFlight: Map<string, Promise<string | null>> = new Map();

// Real logos are small (Finnhub serves ~1000x1000 PNGs, tens of KB) — this
// is a safety ceiling against a misbehaving/compromised upstream URL, not a
// realistic size any legitimate logo should approach.
const MAX_LOGO_BYTES = 2 * 1024 * 1024;

// btoa(String.fromCharCode(...bytes)) blows the call stack on anything but
// tiny inputs — chunk it.
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function fetchImageAsDataUri(imageUrl: string): Promise<string | null> {
  try {
    const res = await fetch(imageUrl);
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.startsWith('image/')) return null; // don't proxy something that isn't actually an image
    const buf = await res.arrayBuffer();
    if (buf.byteLength === 0 || buf.byteLength > MAX_LOGO_BYTES) return null;
    return `data:${contentType};base64,${bytesToBase64(new Uint8Array(buf))}`;
  } catch {
    return null;
  }
}

async function fetchLogo(symbol: string, finnhubApiKey: string): Promise<string | null> {
  try {
    const res = await fetch(`https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(symbol)}&token=${finnhubApiKey}`);
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    const logoUrl = (data && typeof data.logo === 'string' && data.logo) ? data.logo : null;
    if (!logoUrl) return null;
    return await fetchImageAsDataUri(logoUrl);
  } catch {
    return null;
  }
}

// Batched: Finnhub's profile2 endpoint has no real multi-symbol form, so
// "batching" here means one edge-function round-trip from the client
// covering every symbol in its Holdings list, with the underlying
// per-symbol Finnhub calls (cache misses only) issued in parallel
// server-side — not one client request per symbol.
export async function getLogos(symbols: string[], finnhubApiKey: string): Promise<Record<string, string | null>> {
  const now = Date.now();
  const result: Record<string, string | null> = {};
  const toFetch: string[] = [];

  for (const raw of symbols) {
    const symbol = raw.toUpperCase();
    const cached = cache.get(symbol);
    if (cached && cached.expiresAt > now) {
      result[symbol] = cached.logo;
    } else {
      toFetch.push(symbol);
    }
  }

  await Promise.all(toFetch.map(async (symbol) => {
    let p = inFlight.get(symbol);
    if (!p) {
      p = fetchLogo(symbol, finnhubApiKey);
      inFlight.set(symbol, p);
      p.finally(() => inFlight.delete(symbol));
    }
    const logo = await p;
    if (cache.size >= MAX_CACHE_ENTRIES && !cache.has(symbol)) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey !== undefined) cache.delete(oldestKey);
    }
    cache.set(symbol, { logo, expiresAt: now + CACHE_TTL_MS });
    result[symbol] = logo;
  }));

  return result;
}
