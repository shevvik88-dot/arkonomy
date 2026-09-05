// Process-wide fetch interception for the edge-function integration tests.
//
// The handlers under test talk to two kinds of host:
//   - the local Supabase stack (127.0.0.1) — must go through for real, so
//     the test exercises real RLS, real unique constraints, real rows;
//   - external money/bank APIs (Alpaca, Plaid, Stripe) — must NEVER be hit
//     from a test; these are matched against registered mock routes.
//
// Any external call with no matching route throws — a test that reaches an
// unexpected external endpoint should fail loudly, not silently pass.

const EXTERNAL_HOST = /(^|\.)alpaca\.markets$|(^|\.)plaid\.com$|(^|\.)stripe\.com$/;

export interface RecordedCall {
  method: string;
  url: string;
  bodyText: string | null;
  headers: Headers;
}

type Responder = (req: Request, url: URL) => Response | Promise<Response>;

interface Route {
  method: string;
  match: (url: URL) => boolean;
  responder: Responder;
}

export interface FetchMock {
  /** All intercepted external calls, in order. */
  readonly calls: RecordedCall[];
  /** Register a mock route. `match` is a path string (exact) or a predicate on the URL. */
  on(method: string, match: string | ((url: URL) => boolean), responder: Responder): FetchMock;
  /** Count of intercepted calls whose URL contains `substr`. */
  countMatching(substr: string): number;
  /** Clear recorded calls and routes. */
  reset(): void;
  /** Restore the original global fetch. */
  restore(): void;
}

export function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
}

export function installFakeFetch(): FetchMock {
  const realFetch = globalThis.fetch;
  const routes: Route[] = [];
  const calls: RecordedCall[] = [];

  const mock: FetchMock = {
    calls,
    on(method, match, responder) {
      routes.push({
        method: method.toUpperCase(),
        match: typeof match === 'string' ? (u) => u.pathname === match : match,
        responder,
      });
      return mock;
    },
    countMatching(substr) {
      return calls.filter((c) => c.url.includes(substr)).length;
    },
    reset() {
      routes.length = 0;
      calls.length = 0;
    },
    restore() {
      globalThis.fetch = realFetch;
    },
  };

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const req = input instanceof Request ? input : new Request(input, init);
    const url = new URL(req.url);

    if (!EXTERNAL_HOST.test(url.hostname)) {
      return realFetch(input as Request, init);
    }

    const bodyText = req.body ? await req.clone().text() : null;
    calls.push({ method: req.method, url: req.url, bodyText, headers: req.headers });

    const route = routes.find((r) => r.method === req.method && r.match(url));
    if (!route) {
      throw new Error(
        `Unmocked external call: ${req.method} ${req.url}\n` +
        `Register it with mock.on('${req.method}', '${url.pathname}', ...) in the test.`,
      );
    }
    return route.responder(req, url);
  }) as typeof fetch;

  return mock;
}
