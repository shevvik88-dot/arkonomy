// supabase/functions/stock-ai-analysis/index.ts
// Claude-powered informational stock analysis card.
// Never gives buy/sell advice — informational only.
//
// Required secrets:
//   ANTHROPIC_API_KEY  — anthropic.com
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-provided)
//
// POST { symbol, name, price, pe, high52w, low52w, changePct, isCrypto }
// Returns { trend, risks, analystView, disclaimer }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const DISCLAIMER =
  'This is not financial advice. Do your own research before investing. ' +
  'Past performance does not guarantee future results.';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!anthropicKey) {
    return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  // Require user auth
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '').trim();
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await req.json();
    const { symbol, name, price, pe, high52w, low52w, changePct, isCrypto } = body as {
      symbol: string; name: string; price?: number; pe?: number;
      high52w?: number; low52w?: number; changePct?: number; isCrypto?: boolean;
    };

    if (!symbol) {
      return new Response(JSON.stringify({ error: 'symbol required' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const assetType  = isCrypto ? 'cryptocurrency' : 'stock';
    const statsLines = [
      price     != null ? `Current price: $${price.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : null,
      changePct != null ? `Today's change: ${changePct > 0 ? '+' : ''}${changePct.toFixed(2)}%` : null,
      !isCrypto && pe != null ? `P/E ratio: ${pe.toFixed(1)}` : null,
      high52w   != null ? `52-week high: $${high52w.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : null,
      low52w    != null ? `52-week low: $${low52w.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : null,
    ].filter(Boolean).join('\n');

    const prompt = `You are a financial information assistant providing informational context about a ${assetType} for a retail investor using a personal finance app.

Asset: ${name} (${symbol})
${statsLines}

Provide a BRIEF, FACTUAL, INFORMATIONAL analysis in JSON format with these exact fields:
- "trend": 2-3 sentences describing recent price behavior and technical context. Use phrases like "data suggests", "historically", "the ${assetType} has shown".
- "risks": array of exactly 3 short risk factors (each under 15 words). Start each with "Historically", "Market data suggests", "Analysts note", or similar.
- "analystView": 2 sentences on what analysts and market observers generally note. Use "analysts note", "some investors consider", "market observers suggest".

STRICT RULES — violations are unacceptable:
- NEVER use the words: buy, sell, invest, purchase, should, recommend, must, will, guarantee
- NEVER tell the user what to do
- Be objective and factual only
- If you lack current data, state that clearly without making up information
- Keep response concise — mobile screen

Respond with ONLY valid JSON, no markdown, no extra text.`;

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-6',
        max_tokens: 600,
        messages:   [{ role: 'user', content: prompt }],
      }),
    });

    if (!aiRes.ok) {
      const errBody = await aiRes.json().catch(() => ({}));
      throw new Error(errBody?.error?.message ?? `Anthropic error ${aiRes.status}`);
    }

    const aiData = await aiRes.json();
    const rawText = aiData?.content?.[0]?.text ?? '';

    let parsed: { trend?: string; risks?: string[]; analystView?: string } = {};
    try {
      // Strip markdown code fences if present
      const clean = rawText.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();
      parsed = JSON.parse(clean);
    } catch {
      // Return raw text as trend if JSON parse fails
      parsed = { trend: rawText.slice(0, 400), risks: [], analystView: '' };
    }

    return new Response(JSON.stringify({
      symbol,
      trend:       parsed.trend       ?? '',
      risks:       Array.isArray(parsed.risks) ? parsed.risks.slice(0, 3) : [],
      analystView: parsed.analystView ?? '',
      disclaimer:  DISCLAIMER,
    }), { headers: { ...CORS, 'Content-Type': 'application/json' } });

  } catch (err) {
    console.error('stock-ai-analysis error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
