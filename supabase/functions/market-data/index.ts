// supabase/functions/market-data/index.ts
// Finnhub-powered market data: overview, quotes, charts, stats, search, news.
//
// Required secret: FINNHUB_API_KEY  (finnhub.io — free tier works)
//   supabase secrets set FINNHUB_API_KEY=your_key_here
//
// POST body shapes:
//   { type: "overview" }
//   { type: "news" }
//   { type: "quote",  symbol: "AAPL" }
//   { type: "chart",  symbol: "AAPL", period: "1D"|"1W"|"1M"|"1Y" }
//   { type: "stats",  symbol: "AAPL" }
//   { type: "search", query:  "apple" }

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Crypto tickers → Finnhub exchange:pair notation (for quotes/stats)
const CRYPTO_MAP: Record<string, string> = {
  BTC:  'BINANCE:BTCUSDT',
  ETH:  'BINANCE:ETHUSDT',   // was ETHUSD — Binance pair is ETHUSDT
  SOL:  'BINANCE:SOLUSDT',
  DOGE: 'BINANCE:DOGEUSDT',
};

// Crypto tickers → Binance klines symbol (for charts — Finnhub free tier
// doesn't provide OHLCV candles; Binance public API does, no key needed)
const BINANCE_SYMBOL: Record<string, string> = {
  BTC:  'BTCUSDT',
  ETH:  'ETHUSDT',
  SOL:  'SOLUSDT',
  DOGE: 'DOGEUSDT',
};

// True if a watchlist symbol is crypto
function isCrypto(sym: string): boolean {
  return sym in CRYPTO_MAP || sym.endsWith('USD') || sym.endsWith('USDT');
}

function finnhubSym(sym: string): string {
  return CRYPTO_MAP[sym] ?? sym;
}

// Fetch crypto OHLCV from Binance public API (no key required)
// Returns candles in the same shape the app uses: { t, o, h, l, c, v }
async function cryptoCandles(
  sym: string,
  period: string,
): Promise<{ t: number; o: number; h: number; l: number; c: number; v: number }[]> {
  const binanceSym = BINANCE_SYMBOL[sym] ?? sym;

  type PeriodConfig = { interval: string; limit: number };
  const PERIODS: Record<string, PeriodConfig> = {
    '1D': { interval: '5m',  limit: 288  }, // 24h  × 5-min candles
    '1W': { interval: '1h',  limit: 168  }, // 7d   × hourly
    '1M': { interval: '1d',  limit: 30   }, // 30 daily candles
    '1Y': { interval: '1w',  limit: 52   }, // 52 weekly candles
  };
  const { interval, limit } = PERIODS[period] ?? PERIODS['1M'];

  const url = `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(binanceSym)}&interval=${interval}&limit=${limit}`;
  const res  = await fetch(url);
  if (!res.ok) return [];
  const raw: any[][] = await res.json();
  // Binance kline: [openTime_ms, open, high, low, close, volume, ...]
  return raw.map(k => ({
    t: Math.floor(Number(k[0]) / 1000),
    o: Number(k[1]),
    h: Number(k[2]),
    l: Number(k[3]),
    c: Number(k[4]),
    v: Number(k[5]),
  }));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const key = Deno.env.get('FINNHUB_API_KEY');
  if (!key) {
    return new Response(JSON.stringify({ error: 'FINNHUB_API_KEY not configured' }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  // Finnhub helpers
  const fh = (path: string) =>
    fetch(`https://finnhub.io/api/v1${path}${path.includes('?') ? '&' : '?'}token=${key}`)
      .then(r => r.json());

  try {
    const body = await req.json().catch(() => ({}));
    const { type, symbol, period, query } = body as {
      type?: string; symbol?: string; period?: string; query?: string;
    };

    // ── OVERVIEW ──────────────────────────────────────────────────────────────
    if (type === 'overview') {
      const symbols  = ['SPY', 'QQQ', 'BTC', 'ETH'];
      const results  = await Promise.allSettled(
        symbols.map(s => fh(`/quote?symbol=${encodeURIComponent(finnhubSym(s))}`))
      );
      const markets = symbols.map((s, i) => {
        const r = results[i];
        if (r.status === 'rejected' || !r.value || r.value.error) {
          return { symbol: s, price: null, change: null, changePct: null };
        }
        const q = r.value;
        return {
          symbol:    s,
          price:     q.c ?? null,
          change:    q.d ?? null,
          changePct: q.dp ?? null,
        };
      });
      return new Response(JSON.stringify({ markets }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // ── NEWS ──────────────────────────────────────────────────────────────────
    if (type === 'news') {
      const raw = await fh('/news?category=general&minId=0');
      const news = (Array.isArray(raw) ? raw : []).slice(0, 8).map((n: any) => ({
        headline: n.headline,
        source:   n.source,
        url:      n.url,
        image:    n.image,
        datetime: n.datetime,
        summary:  n.summary,
      }));
      return new Response(JSON.stringify({ news }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // ── QUOTE ─────────────────────────────────────────────────────────────────
    if (type === 'quote' && symbol) {
      const q = await fh(`/quote?symbol=${encodeURIComponent(finnhubSym(symbol))}`);
      return new Response(JSON.stringify({
        symbol,
        price:     q.c ?? null,
        open:      q.o ?? null,
        high:      q.h ?? null,
        low:       q.l ?? null,
        prevClose: q.pc ?? null,
        change:    q.d ?? null,
        changePct: q.dp ?? null,
      }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    // ── CHART ─────────────────────────────────────────────────────────────────
    if (type === 'chart' && symbol && period) {
      const crypto = isCrypto(symbol);

      // Crypto charts → Binance public API (free, no key, reliable OHLCV)
      if (crypto) {
        const candles = await cryptoCandles(symbol, period);
        return new Response(JSON.stringify({ candles }), {
          headers: { ...CORS, 'Content-Type': 'application/json' },
        });
      }

      // Stock charts → Finnhub (daily/weekly candles available on free tier)
      const now  = Math.floor(Date.now() / 1000);
      const PERIODS: Record<string, { res: string; from: number }> = {
        '1D': { res: '60', from: now - 86_400 },       // hourly (5m requires premium)
        '1W': { res: '60', from: now - 7  * 86_400 },
        '1M': { res: 'D',  from: now - 30 * 86_400 },
        '1Y': { res: 'W',  from: now - 365 * 86_400 },
      };
      const { res, from } = PERIODS[period] ?? PERIODS['1M'];
      const endpoint = `/stock/candle?symbol=${encodeURIComponent(symbol)}&resolution=${res}&from=${from}&to=${now}`;

      const raw = await fh(endpoint);
      if (!raw || raw.s !== 'ok' || !Array.isArray(raw.t)) {
        return new Response(JSON.stringify({ candles: [] }), {
          headers: { ...CORS, 'Content-Type': 'application/json' },
        });
      }
      const candles = (raw.t as number[]).map((t: number, i: number) => ({
        t, o: raw.o[i], h: raw.h[i], l: raw.l[i], c: raw.c[i], v: raw.v[i],
      }));
      return new Response(JSON.stringify({ candles }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // ── STATS ─────────────────────────────────────────────────────────────────
    if (type === 'stats' && symbol) {
      const crypto = isCrypto(symbol);

      if (crypto) {
        // For crypto just return a quote-based stats object
        const q = await fh(`/quote?symbol=${encodeURIComponent(finnhubSym(symbol))}`);
        return new Response(JSON.stringify({
          symbol,
          name:    symbol,
          price:   q.c,
          high:    q.h,
          low:     q.l,
          isCrypto: true,
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
        name:       profile?.name         ?? symbol,
        exchange:   profile?.exchange      ?? '',
        logo:       profile?.logo          ?? null,
        marketCap:  profile?.marketCapitalization ?? null,
        pe:         m.peNormalizedAnnual   ?? m.peTTM ?? null,
        eps:        m.epsNormalizedAnnual  ?? null,
        high52w:    m['52WeekHigh']        ?? null,
        low52w:     m['52WeekLow']         ?? null,
        beta:       m.beta                 ?? null,
        dividendYield: m.dividendYieldIndicatedAnnual ?? null,
        price:      quote?.c               ?? null,
        changePct:  quote?.dp              ?? null,
        isCrypto:   false,
      }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    // ── SEARCH ────────────────────────────────────────────────────────────────
    if (type === 'search' && query) {
      const raw = await fh(`/search?q=${encodeURIComponent(query)}`);
      const results = (raw?.result ?? [])
        .filter((r: any) => r.type === 'Common Stock' || r.type === 'ETP' || r.type === 'Crypto')
        .slice(0, 12)
        .map((r: any) => ({
          symbol:      r.symbol,
          description: r.description,
          type:        r.type,
          displaySymbol: r.displaySymbol ?? r.symbol,
        }));
      return new Response(JSON.stringify({ results }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Unknown request type' }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('market-data error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
