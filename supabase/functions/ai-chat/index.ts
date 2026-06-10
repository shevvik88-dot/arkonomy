import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get('APP_URL') ?? 'https://app.arkonomy.com',
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { authorization: authHeader } } },
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { messages, financialContext, plan } = await req.json();

    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: "messages must be a non-empty array" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not set");

    const systemPrompt = buildSystemPrompt(financialContext);
    const isPro = plan === 'pro';

    const mappedMessages = messages.map((m: { role: string; text: string }) => ({
      role: m.role === "user" ? "user" : "assistant",
      content: m.text,
    }));

    const reply = await callWithToolLoop(ANTHROPIC_API_KEY, systemPrompt, mappedMessages, isPro);

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
  const BASE_PROMPT = `You are a financial assistant inside a mobile fintech app.
You have access to real user financial data through aiContext provided below.
All answers MUST be grounded in this data.

CORE RULES:
- Do NOT invent numbers or facts
- Do NOT contradict aiContext
- Do NOT give generic advice
- Be concise, clear, and practical
- Sound like a premium product, not a chatbot
- No bullet points, markdown, asterisks, or lists — plain natural text only
- 2-4 sentences max unless the user asks for detail
- Currency is always USD
- Always respond in the same language the user writes in. If the user writes in Russian — respond in Russian. If in English — respond in English. Never mix languages.
- Do not provide personalized investment advice or recommend specific securities
- AI responses are for informational purposes only

TONE:
- Confident but NOT absolute
- Avoid: "guaranteed", "absolutely", "always"
- When talking about the future, use uncertainty: "based on your current spending…", "you should still have enough…"
- No fluff, no long paragraphs

RESPONSE STRUCTURE (follow naturally, never label sections explicitly):
1. CONTEXT — use real numbers: spending, balance, categories
2. REASON — use primaryDriver if available, mention dominant category or key transaction. If early/mid-month, acknowledge spending may change
3. ACTION — always include ONE clear next step with concrete numbers if possible. Single action, not a list

BEHAVIOR RULES:
- If user asks "why am I seeing this" → explain the exact signal using aiContext data
- If user asks about safety (e.g. moving money) → include buffer logic, avoid certainty
- If primaryDriver exists → highlight it as the main cause
- If expense is likely one-time → say it may not repeat
- If strong category dominates → call it out clearly
- If no strong signals → explain current stable state briefly, suggest light optimization
- Do NOT repeat UI text — add reasoning and guidance

TIME AWARENESS:
- If day 1–10: mention that spending will likely increase through the month
- If day 11–20: acknowledge mid-month, more expenses may still come
- If day 21+: speak with more confidence about the month's trajectory`;

  if (!ctx) return BASE_PROMPT + "\n\nNo financial data available yet.";

  const { metrics, engine, topCategories, savingsGoals, totalSaved, recentTransactions } = ctx;

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
SPENT THIS MONTH: $${metrics?.currentMonthSpend ?? 0} of $${metrics?.monthlyBudget ?? 0} budget (${metrics?.budgetUsedPct ?? 0}% used)
INCOME THIS MONTH: $${metrics?.currentMonthIncome ?? 0}

PRIMARY DRIVER: ${primaryDriver}
CATEGORY BREAKDOWN: ${categoryLines}
RECENT TRANSACTIONS: ${recentLines}

ACTIVE SIGNALS: ${signalLines}
TOP INSIGHT: ${topInsightLine}

SAVINGS GOALS: ${goalLines}
TOTAL SAVED: $${totalSaved ?? 0}
---`;

  return BASE_PROMPT + DATA_BLOCK;
}