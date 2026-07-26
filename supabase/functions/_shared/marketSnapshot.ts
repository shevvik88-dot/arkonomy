// supabase/functions/_shared/marketSnapshot.ts
// Shared "market overview" snapshot — SPY/QQQ/BTC/ETH quotes via Finnhub.
// Not user-specific: same result for every caller at a given moment, so
// callers should fetch it once and reuse it, not once per user/request.
//
// Extracted from market-data's `overview` handler (2026-07-25) so
// weekly-report's market-update digest section can reuse the exact same
// logic instead of a second independent implementation.

const CRYPTO_MAP: Record<string, string> = {
  BTC: 'BINANCE:BTCUSDT',
  ETH: 'BINANCE:ETHUSDT',
};

function finnhubSym(sym: string): string {
  return CRYPTO_MAP[sym] ?? sym;
}

async function parseJsonSafe(res: Response, source: string): Promise<any> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${source} returned non-JSON response (status ${res.status}): ${text.slice(0, 100)}`);
  }
}

export interface MarketQuote {
  symbol:     string;
  price:      number | null;
  change:     number | null;
  changePct:  number | null;
}

export async function getMarketSnapshot(finnhubApiKey: string): Promise<MarketQuote[]> {
  const symbols = ['SPY', 'QQQ', 'BTC', 'ETH'];
  const fh = async (path: string) => {
    const res = await fetch(`https://finnhub.io/api/v1${path}${path.includes('?') ? '&' : '?'}token=${finnhubApiKey}`);
    return parseJsonSafe(res, 'Finnhub');
  };
  const results = await Promise.allSettled(
    symbols.map(s => fh(`/quote?symbol=${encodeURIComponent(finnhubSym(s))}`))
  );
  return symbols.map((s, i) => {
    const r = results[i];
    if (r.status === 'rejected' || !r.value || r.value.error) {
      return { symbol: s, price: null, change: null, changePct: null };
    }
    const q = r.value;
    return { symbol: s, price: q.c ?? null, change: q.d ?? null, changePct: q.dp ?? null };
  });
}
