import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { enforceRateLimit } from "../_shared/rateLimit.ts";
import { verifyAppCheck } from "../_shared/appCheck.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get('APP_URL') ?? 'https://app.arkonomy.com',
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-firebase-appcheck",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const token = authHeader.replace("Bearer ", "").trim();
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const rateLimitResponse = await enforceRateLimit(user.id, "ai-chat");
    if (rateLimitResponse) return rateLimitResponse;

    if (Deno.env.get('ENVIRONMENT') !== 'development') {
      const validAppCheck = await verifyAppCheck(req);
      if (!validAppCheck) {
        return new Response(JSON.stringify({ error: "Invalid App Check token" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const { messages, financialContext } = await req.json();

    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: "messages must be a non-empty array" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (messages.length > 50) {
      return new Response(JSON.stringify({ error: "Too many messages" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not set");

    // Verify plan from DB — never trust the client-supplied plan field
    const { data: profile } = await supabase
      .from('profiles')
      .select('plan, trial_ends_at')
      .eq('id', user.id)
      .single();
    const isPaidPro = profile?.plan === 'pro';
    const hasActiveTrial = profile?.trial_ends_at
      ? new Date(profile.trial_ends_at) > new Date()
      : false;

    // Paid Pro → unlimited web search.
    // Trial    → web search up to 5 total uses (atomic check+increment in DB).
    // Free     → no web search; chat responds normally without the tool.
    let canUseSearch = isPaidPro && !hasActiveTrial;
    if (!canUseSearch && hasActiveTrial) {
      const { data: allowed } = await supabase.rpc('increment_trial_web_search', {
        p_user_id: user.id,
      });
      canUseSearch = !!allowed;
    }

    const systemPrompt = buildSystemPrompt(financialContext);

    const mappedMessages = messages.map((m: { role: string; text: string }) => ({
      role: m.role === "user" ? "user" : "assistant",
      content: String(m.text ?? "").slice(0, 2000),
    }));

    const reply = await callWithToolLoop(ANTHROPIC_API_KEY, systemPrompt, mappedMessages, canUseSearch);

    return new Response(JSON.stringify({ reply }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("ai-chat error:", e);
    return new Response(JSON.stringify({ error: "Internal Server Error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function callWithToolLoop(
  apiKey: string,
  systemPrompt: string,
  messages: any[],
  isPro: boolean,
): Promise<string> {
  const currentMessages = [...messages];
  const tools = isPro ? [{ type: "web_search_20250305", name: "web_search" }] : [];

  for (let i = 0; i < 5; i++) {
    const body: any = {
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: systemPrompt,
      messages: currentMessages,
    };
    if (tools.length > 0) body.tools = tools;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    };
    if (isPro) headers["anthropic-beta"] = "web-search-2025-03-05";

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error("Anthropic API error: " + err);
    }

    const data = await res.json();
    const content: any[] = data.content ?? [];

    const textBlocks = content.filter((b: any) => b.type === "text");
    const lastText = textBlocks[textBlocks.length - 1]?.text;

    if (data.stop_reason === "end_turn") {
      return lastText ?? "Sorry, I couldn't generate a response.";
    }

    if (data.stop_reason === "tool_use") {
      currentMessages.push({ role: "assistant", content });

      const toolResults = content
        .filter((b: any) => b.type === "tool_use")
        .map((b: any) => ({
          type: "tool_result",
          tool_use_id: b.id,
          content: typeof b.output === "string" ? b.output : "",
        }));

      if (toolResults.length === 0) break;
      currentMessages.push({ role: "user", content: toolResults });
      continue;
    }

    if (lastText) return lastText;
    break;
  }

  return "Sorry, I couldn't generate a response.";
}

// ── System prompt builder ─────────────────────────────────────────

function buildSystemPrompt(ctx: any): string {
  const BASE_PROMPT = `You are a proactive financial coach inside a mobile fintech app.
You have full access to the user's real financial data through aiContext below.
Your job is NOT to wait to be asked — scan the data, find the most important issue or win, and lead with it.

IDENTITY:
- You are a trusted friend who happens to know their finances inside-out
- You speak plainly, directly, and personally — not like a bank or a bot
- You care about their financial health and say so through action, not flattery

CORE RULES:
- Never invent numbers — every figure must come from aiContext
- Never give generic advice — if it could apply to anyone, rewrite it to be specific to this user
- No bullet points, markdown, asterisks, headers, or lists — plain flowing text only
- 2–4 sentences for most responses; go longer only when the user explicitly asks for detail
- Currency is always USD
- Do not recommend specific securities or give personalized investment advice
- Responses are for informational and coaching purposes only

LANGUAGE:
- Always respond in the same language the user writes in
- Russian message → Russian reply. English → English. Never mix languages.

RESPONSE FORMULA (follow in order, never label the sections):
1. LEAD WITH THE INSIGHT — open with the most important observation right now, using real numbers. If you spot a problem the user didn't ask about, name it immediately.
2. EXPLAIN THE CAUSE — one sentence on why: which category, which merchant, which pattern. Use primaryDriver if available.
3. ONE NEXT ACTION — close with exactly one specific thing they can do TODAY. Make it concrete: dollar amount, account name, day. No lists of options.

PROACTIVE BEHAVIOR — always scan for and surface:
- Overspending vs 3-month average in any category (call out the category and delta)
- Upcoming bills vs available balance (flag if it looks tight)
- A category that dropped vs last month → acknowledge the win
- Savings opportunity if balance is healthy vs spending pace
- Any month where spending looks stable → say so briefly, then suggest one optimization

PRIORITY ORDER (tackle the biggest fire first):
1. Negative or near-zero balance → cash risk
2. Spending spike in a specific category
3. Overall overspending vs historical average
4. Off-track savings goal
5. Savings opportunity (healthy month)
6. Positive progress worth acknowledging

DEBT PAYOFF RULE — NEVER VIOLATE:
When recommending a credit card payment, the amount must never exceed SAFE TO MOVE.
Always say: "You have $X available after keeping a $1,000 buffer — put that toward [highest APR card]."
Never say "pay off your balance" or recommend an amount larger than SAFE TO MOVE.
If SAFE TO MOVE is $0 or negative, say so honestly: "There's no spare cash this month after your expenses — focus on not adding to the balance."
If multiple cards exist, focus on the card with the highest balance first (APR is not available from Plaid).

WINS MATTER:
- If a category is lower than last month, say it specifically: "You kept Food under $X this month — that's $Y less than last month."
- Acknowledge streaks or improvements before pivoting to what's next

TONE:
- Direct and warm — not cold, not cheerleader-y
- Confident but not absolute: "based on your pace…", "looks like…", "this month you're tracking toward…"
- Never say "guaranteed", "absolutely", "always", "great job", "fantastic"
- Never start with "I" — vary openings: use the user's situation as the subject

TIME AWARENESS:
- Day 1–10: note that spending will likely climb; lean toward conservative framing
- Day 11–20: mid-month — more expenses likely ahead
- Day 21+: speak with confidence about the month's trajectory`;

  if (!ctx) return BASE_PROMPT + "\n\nNo financial data available yet.";

  const { metrics, engine, topCategories, savingsGoals, totalSaved, recentTransactions, creditCards, interestThisMonth } = ctx;

  const now = new Date();
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysLeft = daysInMonth - dayOfMonth;
  const monthPhase = dayOfMonth <= 10 ? "early" : dayOfMonth <= 20 ? "mid" : "late";

  const primaryDriver = (topCategories || [])[0]
    ? `${topCategories[0].name} ($${topCategories[0].amount})`
    : "none identified";

  const signalLines = engine?.activeSignals?.length > 0
    ? engine.activeSignals.map((s: any) => `${s.type}: ${JSON.stringify(s.data)}`).join("\n")
    : "none — finances look stable this month";

  const topInsightLine = engine?.topInsight
    ? [
        `type: ${engine.topInsight.type}`,
        `headline: ${engine.topInsight.rendered?.headline}`,
        `detail: ${engine.topInsight.rendered?.body}`,
        `recommended action: ${engine.topInsight.rendered?.cta}`,
      ].join(" | ")
    : "no priority insight this month";

  const categoryLines = (topCategories || [])
    .map((c: any) => `${c.name}: $${c.amount}`)
    .join(", ") || "no spending data";

  const recentLines = (recentTransactions || [])
    .slice(0, 6)
    .map((t: any) =>
      `${t.type === "income" ? "+" : "-"}$${t.amount} ${t.description || t.category} on ${t.date}`
    )
    .join(", ") || "none";

  const goalLines = (savingsGoals || []).length > 0
    ? savingsGoals.map((g: any) =>
        `${g.name}: $${g.current} of $${g.target} (${g.progressPct}%, $${g.remaining} remaining)`
      ).join(", ")
    : "no goals set";

  const DATA_BLOCK = `

---
AI CONTEXT — treat as ground truth. Use these numbers in every answer:

TIMING: Day ${dayOfMonth} of ${daysInMonth} (${daysLeft} days left, ${monthPhase}-month)
BALANCE: $${metrics?.currentBalance ?? 0}
SAFE TO MOVE: $${metrics?.availableSafeToMove ?? 0} (income minus spending minus $1,000 buffer — hard cap for any payment recommendation)
SPENT THIS MONTH: $${metrics?.currentMonthSpend ?? 0} of $${metrics?.monthlyBudget ?? 0} budget (${metrics?.budgetUsedPct ?? 0}% used)
INCOME THIS MONTH: $${metrics?.currentMonthIncome ?? 0}

PRIMARY DRIVER: ${primaryDriver}
CATEGORY BREAKDOWN: ${categoryLines}
RECENT TRANSACTIONS: ${recentLines}

ACTIVE SIGNALS: ${signalLines}
TOP INSIGHT: ${topInsightLine}

SAVINGS GOALS: ${goalLines}
TOTAL SAVED: $${totalSaved ?? 0}

CREDIT CARDS (from Plaid): ${
  Array.isArray(creditCards) && creditCards.length > 0
    ? creditCards
        .sort((a: any, b: any) => (b.balance ?? 0) - (a.balance ?? 0))
        .map((c: any) => {
          const parts = [c.name];
          if (c.balance != null) parts.push(`balance $${Number(c.balance).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`);
          return parts.join(', ');
        })
        .join(' | ')
    : 'none connected via Plaid'
}
INTEREST CHARGES THIS MONTH: ${interestThisMonth > 0 ? `$${Number(interestThisMonth).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'none detected'}
---`;

  return BASE_PROMPT + DATA_BLOCK;
}