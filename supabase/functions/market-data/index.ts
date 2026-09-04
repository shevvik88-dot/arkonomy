// supabase/functions/market-data/index.ts
// Market data: overview, quotes, charts, stats, search, news.
//
// Stock charts  → Yahoo Finance public API (no key required)
// Crypto charts → Kraken public OHLCV API  (no key required)
// Quotes/stats/search/news → Finnhub (requires FINNHUB_API_KEY)
//
//   supabase secrets set FINNHUB_API_KEY=your_key_here
//
// POST body shapes:
//   { type: "overview" }
//   { type: "news" }
//   { type: "quote",  symbol: "AAPL" }
//   { type: "chart",  symbol: "AAPL", period: "1D"|"1W"|"1M"|"1Y" }
//   { type: "stats",  symbol: "AAPL" }
//   { type: "search", query:  "apple" }
//   { type: "logos",  symbols: ["AAPL", "TSLA"] }  — logo URL only, batched, long-cached (see _shared/logoCache.ts)

import { getMarketSnapshot } from '../_shared/marketSnapshot.ts';
import { getLogos } from '../_shared/logoCache.ts';
import { enforceRateLimit } from '../_shared/rateLimit.ts';

// Same allow-list pattern as auth-login/check-bank-connection — preview
// deployments get a fresh random subdomain hash on every push, so a single
// static origin can't cover them.
const PROD_ORIGIN = Deno.env.get('APP_URL') ?? 'https://app.arkonomy.com';
const ALLOWED_ORIGINS: (string | RegExp)[] = [
  PROD_ORIGIN,
  /^https:\/\/arkonomy-[a-z0-9-]+-shevvik88-dots-projects\.vercel\.app$/,
];

function resolveCorsHeaders(req: Request) {
  const origin = req.headers.get('origin') ?? '';
  const allowedOrigin = ALLOWED_ORIGINS.some(o => typeof o === 'string' ? o === origin : o.test(origin))
    ? origin
    : PROD_ORIGIN;
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };
}

// Crypto tickers → Finnhub exchange:pair notation (for quotes/stats)
const CRYPTO_MAP: Record<string, string> = {
  BTC:  'BINANCE:BTCUSDT',
  ETH:  'BINANCE:ETHUSDT',
  SOL:  'BINANCE:SOLUSDT',
  DOGE: 'BINANCE:DOGEUSDT',
};

// Crypto tickers → Kraken pair (for OHLCV charts)
const KRAKEN_PAIR: Record<string, string> = {
  BTC:  'XBTUSD',
  ETH:  'ETHUSD',
  SOL:  'SOLUSD',
  DOGE: 'DOGEUSD',
};

function isCrypto(sym: string): boolean {
  return sym in CRYPTO_MAP || sym.endsWith('USD') || sym.endsWith('USDT');
}

function finnhubSym(sym: string): string {
  return CRYPTO_MAP[sym] ?? sym;
}

// Thrown by parseJsonSafe when an upstream API returns a non-JSON body (HTML
// error/gateway-timeout page, outage, consent wall). This is an expected
// failure mode of a third-party dependency, not a bug in our code — kept as
// a distinct type so the request handler can return a clear, specific error
// to the client and tag the Sentry event as an upstream issue instead of it
// looking identical to an actual unhandled crash.
class UpstreamUnavailableError extends Error {
  constructor(message: string, public readonly source: string, public readonly status: number) {
    super(message);
    this.name = 'UpstreamUnavailableError';
  }
}

// Upstream market-data APIs (Finnhub/Yahoo/Kraken) occasionally return an HTML
// error/interstitial page (rate-limit, outage, consent wall) instead of JSON,
// sometimes even with a 200 status — res.json() then throws an opaque native
// SyntaxError ("Unexpected token '<'...") that's useless for diagnosis. Read
// as text first and throw a clear, source-labeled error instead.
async function parseJsonSafe(res: Response, source: string): Promise<any> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new UpstreamUnavailableError(
      `${source} returned non-JSON response (status ${res.status}): ${text.slice(0, 100)}`,
      source,
      res.status,
    );
  }
}

// ── Crypto OHLCV via Kraken (no key, no geo-restriction) ──────────────────────
async function cryptoCandles(
  sym: string,
  period: string,
): Promise<{ t: number; o: number; h: number; l: number; c: number; v: number }[]> {
  const pair = KRAKEN_PAIR[sym] ?? `${sym}USD`;
  const now = Math.floor(Date.now() / 1000);
  const PERIODS: Record<string, { interval: number; since: number }> = {
    '1D': { interval: 5,     since: now - 86_400 },
    '1W': { interval: 60,    since: now - 7  * 86_400 },
    '1M': { interval: 1440,  since: now - 30 * 86_400 },
    '1Y': { interval: 10080, since: now - 365 * 86_400 },
  };
  const { interval, since } = PERIODS[period] ?? PERIODS['1M'];
  const url = `https://api.kraken.com/0/public/OHLC?pair=${encodeURIComponent(pair)}&interval=${interval}&since=${since}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const json = await parseJsonSafe(res, 'Kraken');
  if (json.error && json.error.length > 0) return [];
  const resultKey = Object.keys(json.result ?? {}).find((k: string) => k !== 'last');
  if (!resultKey) return [];
  const rows: any[][] = json.result[resultKey];
  return rows.map(k => ({
    t: Number(k[0]), o: Number(k[1]), h: Number(k[2]),
    l: Number(k[3]), c: Number(k[4]), v: Number(k[6]),
  }));
}

// ── Stock OHLCV via Yahoo Finance public API (no key required) ────────────────
async function stockCandlesYahoo(
  symbol: string,
  period: string,
): Promise<{ t: number; o: number; h: number; l: number; c: number; v: number }[]> {
  const PERIODS: Record<string, { interval: string; range: string }> = {
    '1D': { interval: '5m',  range: '1d'  },
    '1W': { interval: '1h',  range: '5d'  },
    '1M': { interval: '1d',  range: '1mo' },
    '1Y': { interval: '1wk', range: '1y'  },
  };
  const { interval, range } = PERIODS[period] ?? PERIODS['1M'];
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`;

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/json',
    },
  });
  if (!res.ok) {
    console.error(`Yahoo Finance HTTP ${res.status} for ${symbol}`);
    return [];
  }

  const json = await parseJsonSafe(res, 'Yahoo Finance');
  const result = json?.chart?.result?.[0];
  if (!result) {
    console.error('Yahoo Finance: no result for', symbol, json?.chart?.error);
    return [];
  }

  const timestamps: number[] = result.timestamp ?? [];
  const q = result.indicators?.quote?.[0] ?? {};

  return timestamps
    .map((t, i) => ({
      t,
      o: q.open?.[i]   ?? null,
      h: q.high?.[i]   ?? null,
      l: q.low?.[i]    ?? null,
      c: q.close?.[i]  ?? null,
      v: q.volume?.[i] ?? 0,
    }))
    .filter(c => c.c !== null && c.c !== undefined && isFinite(c.c as number)) as
      { t: number; o: number; h: number; l: number; c: number; v: number }[];
}

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { initSentry, captureAndFlush } from '../_shared/sentry.ts';

initSentry('market-data');

Deno.serve(async (req) => {
  const CORS = resolveCorsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  // ── Auth ──────────────────────────────────────────────────────────────────
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );
  const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '').trim();
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  const rateLimitResponse = await enforceRateLimit(user.id, 'market-data');
  if (rateLimitResponse) return rateLimitResponse;

  // Key is only needed for Finnhub endpoints (not chart)
  const key = Deno.env.get('FINNHUB_API_KEY');
  const fh = async (path: string) => {
    const res = await fetch(`https://finnhub.io/api/v1${path}${path.includes('?') ? '&' : '?'}token=${key}`);
    return parseJsonSafe(res, 'Finnhub');
  };

  const noKey = () => new Response(
    JSON.stringify({ error: 'FINNHUB_API_KEY not configured' }),
    { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } },
  );

  // Hoisted so the catch block below can report which request type/symbol
  // was being served when an upstream API failed — without this, diagnosing
  // a failure meant guessing from HTTP-level timing/logs alone (see 2026-07-17
  // market-data SyntaxError incident).
  let reqType: string | undefined;
  let reqSymbol: string | undefined;

  try {
    const body = await req.json().catch(() => ({}));
    const { type, symbol, period, query, symbols } = body as {
      type?: string; symbol?: string; period?: string; query?: string; symbols?: unknown;
    };
    reqType = type;
    reqSymbol = symbol;

    // ── LOGOS (batched, long-cached — see _shared/logoCache.ts) ───────────────
    if (type === 'logos') {
      if (!key) return noKey();
      const list = (Array.isArray(symbols) ? symbols : [])
        .filter((s): s is string => typeof s === 'string' && s.length > 0)
        .slice(0, 25); // Holdings list is small; a hard cap keeps one malformed/abusive request from fanning out into dozens of Finnhub calls at once.
      const logos = list.length > 0 ? await getLogos(list, key) : {};
      return new Response(JSON.stringify({ logos }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // ── OVERVIEW ──────────────────────────────────────────────────────────────
    if (type === 'overview') {
      if (!key) return noKey();
      const markets = await getMarketSnapshot(key);
      return new Response(JSON.stringify({ markets }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // ── NEWS ──────────────────────────────────────────────────────────────────
    if (type === 'news') {
      if (!key) return noKey();
      const raw = await fh('/news?category=general&minId=0');
      const news = (Array.isArray(raw) ? raw : []).slice(0, 8).map((n: any) => ({
        headline: n.headline, source: n.source, url: n.url,
        image: n.image, datetime: n.datetime, summary: n.summary,
      }));
      return new Response(JSON.stringify({ news }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // ── QUOTE ─────────────────────────────────────────────────────────────────
    if (type === 'quote' && symbol) {
      if (!key) return noKey();
      const q = await fh(`/quote?symbol=${encodeURIComponent(finnhubSym(symbol))}`);
      return new Response(JSON.stringify({
        symbol,
        price: q.c ?? null, open: q.o ?? null, high: q.h ?? null,
        low: q.l ?? null, prevClose: q.pc ?? null,
        change: q.d ?? null, changePct: q.dp ?? null,
      }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    // ── CHART ─────────────────────────────────────────────────────────────────
    if (type === 'chart' && symbol && period) {
      if (isCrypto(symbol)) {
        // Crypto → Kraken (no key)
        const candles = await cryptoCandles(symbol, period);
        return new Response(JSON.stringify({ candles }), {
          headers: { ...CORS, 'Content-Type': 'application/json' },
        });
      }

      // Stocks → Yahoo Finance (no key)
      const candles = await stockCandlesYahoo(symbol, period);
      return new Response(JSON.stringify({ candles }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // ── STATS ─────────────────────────────────────────────────────────────────
    if (type === 'stats' && symbol) {
      if (!key) return noKey();
      const crypto = isCrypto(symbol);
      if (crypto) {
        const q = await fh(`/quote?symbol=${encodeURIComponent(finnhubSym(symbol))}`);
        return new Response(JSON.stringify({
          symbol, name: symbol, price: q.c ?? null,
          dayOpen: q.o ?? null, dayHigh: q.h ?? null, dayLow: q.l ?? null, prevClose: q.pc ?? null,
          changePct: q.dp ?? null, isCrypto: true,
        }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
      }
      const [profile, metrics, quote] = await Promise.all([
        fh(`/stock/profile2?symbol=${encodeURIComponent(symbol)}`),
        fh(`/stock/metric?symbol=${encodeURIComponent(symbol)}&metric=all`),
        fh(`/quote?symbol=${encodeURIComponent(symbol)}`),
      ]);
      const m = metrics?.metric ?? {};
      return new Response(JSON.stringify({
        symbol,
        name:       profile?.name ?? symbol,
        exchange:   profile?.exchange ?? '',
        logo:       profile?.logo ?? null,
        marketCap:  profile?.marketCapitalization ?? null,
        pe:         m.peNormalizedAnnual ?? m.peTTM ?? null,
        eps:        m.epsNormalizedAnnual ?? null,
        high52w:    m['52WeekHigh'] ?? null,
        low52w:     m['52WeekLow'] ?? null,
        beta:       m.beta ?? null,
        dividendYield: m.dividendYieldIndicatedAnnual ?? null,
        price:      quote?.c ?? null,
        dayOpen:    quote?.o ?? null,
        dayHigh:    quote?.h ?? null,
        dayLow:     quote?.l ?? null,
        prevClose:  quote?.pc ?? null,
        changePct:  quote?.dp ?? null,
        isCrypto:   false,
      }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    // ── SEARCH ────────────────────────────────────────────────────────────────
    if (type === 'search' && query) {
      if (!key) return noKey();
      const raw = await fh(`/search?q=${encodeURIComponent(query)}`);
      const results = (raw?.result ?? [])
        .filter((r: any) => r.type === 'Common Stock' || r.type === 'ETP' || r.type === 'Crypto')
        .slice(0, 12)
        .map((r: any) => ({
          symbol: r.symbol, description: r.description,
          type: r.type, displaySymbol: r.displaySymbol ?? r.symbol,
        }));
      return new Response(JSON.stringify({ results }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Unknown request type' }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    if (err instanceof UpstreamUnavailableError) {
      console.error(`market-data: upstream ${err.source} unavailable (status ${err.status}):`, err.message);
      await captureAndFlush(err, {
        function_name: 'market-data', type: reqType, symbol: reqSymbol,
        upstream_source: err.source, upstream_status: err.status, expected: true,
      });
      return new Response(JSON.stringify({ error: 'Market data temporarily unavailable. Please try again shortly.' }), {
        status: 503, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    console.error('market-data error:', err);
    await captureAndFlush(err, { function_name: 'market-data', type: reqType, symbol: reqSymbol });
    return new Response(JSON.stringify({ error: "Internal Server Error" }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
