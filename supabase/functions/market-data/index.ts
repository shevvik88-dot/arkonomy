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

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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
  const json = await res.json();
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

  const json = await res.json();
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  // Key is only needed for Finnhub endpoints (not chart)
  const key = Deno.env.get('FINNHUB_API_KEY');
  const fh = (path: string) =>
    fetch(`https://finnhub.io/api/v1${path}${path.includes('?') ? '&' : '?'}token=${key}`)
      .then(r => r.json());

  const noKey = () => new Response(
    JSON.stringify({ error: 'FINNHUB_API_KEY not configured' }),
    { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } },
  );

  try {
    const body = await req.json().catch(() => ({}));
    const { type, symbol, period, query } = body as {
      type?: string; symbol?: string; period?: string; query?: string;
    };

    // ── OVERVIEW ──────────────────────────────────────────────────────────────
    if (type === 'overview') {
      if (!key) return noKey();
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
        return { symbol: s, price: q.c ?? null, change: q.d ?? null, changePct: q.dp ?? null };
      });
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
          symbol, name: symbol, price: q.c, high: q.h, low: q.l, isCrypto: true,
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
    console.error('market-data error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
