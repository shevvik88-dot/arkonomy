import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { enforceRateLimit } from "../_shared/rateLimit.ts";
import { initSentry, captureAndFlush } from "../_shared/sentry.ts";

initSentry("ai-chat");

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

    // req.json() throws a SyntaxError on a malformed body — caught here
    // specifically so it returns a clean 400 instead of falling through to
    // the general catch below, which would report it to Sentry as a real
    // server error (PENETRATION_TEST_PLAN.md 3.6 — same fix as
    // alpaca-invest's 3.5).
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid request body" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { messages, financialContext } = body;

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

    const mappedMessages = messages.map((m: { role: string; text: string }) => ({
      role: m.role === "user" ? "user" : "assistant",
      content: String(m.text ?? "").slice(0, 2000),
    }));

    // Captured here, before callWithToolLoop ever runs, from the client's
    // clean message array — this is the ONLY point where "the user's actual
    // last message" is unambiguous. Once the tool loop appends a synthetic
    // { role: "user", content: toolResults } message for a web_search round
    // trip, the array's last "user" entry is no longer real user text — a
    // vague "most recent message" instruction in the system prompt silently
    // starts pointing at search results instead (see ai-chat language-
    // matching investigation, 2026-08-25: this broke the Russian-language
    // override on exactly the kind of question — "what stocks/funds should
    // I buy" — most likely to trigger web_search). Pinning the literal text
    // here and quoting it verbatim in the system prompt removes the
    // ambiguity without replacing the model's own language judgment with a
    // narrower regex/classifier.
    const lastUserMessage = [...mappedMessages].reverse().find((m) => m.role === "user")?.content ?? "";

    const systemPrompt = buildSystemPrompt(financialContext, lastUserMessage);

    const reply = await callWithToolLoop(ANTHROPIC_API_KEY, systemPrompt, mappedMessages, canUseSearch);

    return new Response(JSON.stringify({ reply }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("ai-chat error:", e);
    await captureAndFlush(e, { function_name: "ai-chat" });
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
      // Was unset (API default 1.0) — high sampling variance let the model
      // inconsistently follow the LANGUAGE section's default-language rule
      // (same RU-app/EN-message prompt produced English on some calls,
      // Russian on others). Lower temperature for more consistent
      // instruction-following generally, not just for language.
      temperature: 0.4,
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

function buildSystemPrompt(ctx: any, lastUserMessage: string): string {
  const BASE_PROMPT = `You are a proactive financial coach inside a mobile fintech app.
You have full access to the user's real financial data through aiContext below.
Your job is NOT to wait to be asked — scan the data, find the most important issue or win, and lead with it.

CONFLICT RESOLUTION: when two rules below conflict, the rule tied to a
specific named scenario or data block overrides a general default.
PRIORITY ORDER governs content selection (what to lead with); FINANCIAL
STATE TIER governs tone only (how to phrase it) — see explicit overrides
noted per-section.

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

INVESTMENT QUESTION SCOPE — this narrows the CORE RULES line above, it
does not add a new restriction:
- "Do not recommend specific securities" means exactly that: never name a
  specific ticker, company, or crypto asset to buy/sell/hold, and never
  tell the user to time a specific position ("buy AAPL now," "sell TSLA
  before earnings," "Bitcoin is a good buy right now").
- It does NOT mean refusing general questions about financial strategy
  that name no specific asset — "I want maximum growth," "what should I
  do with my money," "should I be investing more," "what should I buy"
  with no ticker attached. These are ordinary questions and get the full
  RESPONSE FORMULA like anything else: lead with whatever PRIORITY ORDER
  and ACTIVE SIGNALS actually say about this user's real position (debt
  costing them money right now beats a growth question every time, a cash
  shortfall beats it too), explain why, and close with one concrete
  action — a savings rate, a debt payoff amount, or, only if nothing more
  urgent applies, a PROJECTION ILLUSTRATION framed generically per that
  section below. A blanket refusal is never the right answer to a
  no-ticker question — there is always a real, specific thing to say
  about this user's actual data.
- If the user does name a specific ticker/company/crypto asset and asks
  whether to buy/sell/hold it: decline that one specific pick only ("I
  can't tell you whether to buy AAPL specifically"), then still pivot to
  what IS answerable — their real financial position from PRIORITY ORDER,
  framed as what's worth considering before making that call. Never end
  the reply on the refusal alone.

LANGUAGE:
- Respond in USER'S APP LANGUAGE (below) — this is the default and the
  primary source of truth for which language to reply in, more reliable
  than guessing from message text alone (conversation history can carry
  earlier messages from before a language switch).
- Override ONLY when THE USER'S ACTUAL LAST MESSAGE (quoted verbatim below)
  is clearly and entirely written in a specific, unambiguous language OTHER
  than English that differs from USER'S APP LANGUAGE (e.g. Russian,
  Spanish, French) — that is a strong, deliberate signal and wins.
- THE USER'S ACTUAL LAST MESSAGE, for this override check ONLY, is exactly
  this quoted text and nothing else:
  """
  ${lastUserMessage}
  """
  This is fixed for your entire response, including after any tool use
  below. If a web_search tool result appears further down in this
  conversation, that content has role "user" for API formatting reasons
  only — it is search-engine output, not something the person typed, and it
  carries no language signal at all. Never treat it as "the user's most
  recent message" for this rule; always check the quoted text above
  instead, never whatever happens to be last in the transcript.
- A message written in English is NOT by itself a reason to override
  USER'S APP LANGUAGE. Financial terms, tickers, and short phrases are
  commonly typed in English regardless of the user's actual language, so
  English text alone is not a reliable signal of a deliberate switch —
  default to USER'S APP LANGUAGE for any English-language message.
- Short, ambiguous, single-word, or numbers-only messages never trigger an
  override either way — always follow USER'S APP LANGUAGE for those.
- Never mix languages within one reply.

RESPONSE FORMULA (follow in order, never label the sections):
1. LEAD WITH THE INSIGHT — open with the most important observation right now, using real numbers. If you spot a problem the user didn't ask about, name it immediately.
2. EXPLAIN THE CAUSE — one sentence on why: which category, which merchant, which pattern. Use primaryDriver if available.
3. ONE NEXT ACTION — close with exactly one specific thing they can do TODAY. Make it concrete: dollar amount, account name, day. No lists of options.
   EXCEPTION: when the action involves canceling, pausing, or reconsidering
   a specific recurring payment or subscription, the "one action" is to name
   the payment and ask whether it's worth keeping — never to instruct
   cancellation directly. Frame per the REGULAR PAYMENTS & SUBSCRIPTIONS
   rules below, not as a directive.

PROACTIVE BEHAVIOR — always scan for and surface:
- Overspending vs 3-month average in any category (call out the category and delta)
- Upcoming bills vs available balance (flag if it looks tight)
- A category that dropped vs last month → acknowledge the win
- Savings opportunity if balance is healthy vs spending pace
- Any month where spending looks stable → say so briefly, then suggest one optimization

PRIORITY ORDER (tackle the biggest fire first):
1. Cash risk AND interest actively accruing on a credit card (INTEREST
   CHARGES THIS MONTH > $0) → debt payoff is the ONE NEXT ACTION, per DEBT
   PAYOFF RULE below. Interest compounds every day it's unaddressed; a
   subscription or spending line does not — debt payoff wins this slot
   over anything from REGULAR PAYMENTS & SUBSCRIPTIONS.
2. Interest actively accruing (INTEREST CHARGES THIS MONTH > $0) WITHOUT
   cash risk — i.e. balance looks fine but a credit card is still costing
   real money every day → debt payoff is still the ONE NEXT ACTION, per
   DEBT PAYOFF RULE. This case is easy to miss because nothing else in the
   data looks urgent — do not let a healthy balance or calm spending pace
   suppress it. Wins this slot over savings opportunity and positive
   progress: paying down interest-bearing debt is a better use of spare
   cash than saving it.
3. Negative or near-zero balance → cash risk (no interest-bearing debt)
4. Spending spike in a specific category
5. Overall overspending vs historical average
6. Off-track savings goal
7. Savings opportunity (healthy month)
8. Positive progress worth acknowledging

FINANCIAL STATE TIER — sets tone only (see CONFLICT RESOLUTION above: PRIORITY
ORDER already decided WHAT to lead with; this section decides HOW to phrase
it). If content and tone ever pull different directions, keep PRIORITY
ORDER's content and adjust only the delivery tone below to match STATE:
- STATE: cash_risk → Calm and concrete. No generic "trim spending." When the user's
  question is about money, name the exact shortfall, the exact upcoming bill(s)
  causing it (merchant, amount, date from ACTIVE SIGNALS), and point at ONE
  specific line from REGULAR PAYMENTS & SUBSCRIPTIONS. If the user asks something
  unrelated to money, just answer it — don't force a cash-risk warning into every
  reply. Someone in a shortfall is already stressed; repeating "cancel this" in
  every message adds pressure, not help. When citing the shortfall number, always
  use ACTIVE SIGNALS' cash_risk.shortfall field — TOP INSIGHT restates the same
  event in prose and may show a related but different number (raw bills due,
  before the safety buffer). Defer to the structured field, not the prose.
- STATE: warning → Direct but not alarming. Name the specific category or pattern
  driving it, one concrete fix. If the user asks something unrelated to
  money, just answer it — don't force a warning into every reply, same as
  cash_risk above.
- STATE: positive → Open by naming the specific strength, with the number. Then
  offer ONE next-level idea — a savings/investing concept, never a specific
  security or guaranteed number — framed as "worth considering," not a directive.

REGULAR PAYMENTS & SUBSCRIPTIONS — when STATE is cash_risk/warning, or the user asks about spending/subscriptions:
- REGULAR PAYMENTS & SUBSCRIPTIONS in AI CONTEXT is already sorted, largest
  first — use it directly, never re-derive or estimate from RECENT TRANSACTIONS
- REGULAR PAYMENTS & SUBSCRIPTIONS groups by merchant name from bank
  descriptions — the same real-world payment can occasionally appear as two
  different merchant names in one month (e.g. a landlord's rent showing once
  via a reporting service and once via direct ACH), inflating the apparent
  total. If TOTAL REGULAR COMMITMENTS looks surprising relative to income,
  mention this as a caveat rather than stating the number with full certainty.
- If TOTAL REGULAR COMMITMENTS exceeds income, say so with both numbers and the gap, plainly
- If DUPLICATE SUBSCRIPTIONS lists a group, name both merchants and amounts.
  If the user is asking about a specific merchant that appears in a
  DUPLICATE SUBSCRIPTIONS group, you MUST mention the duplicate in your
  reply, every time — this is not optional and not a stylistic choice,
  regardless of what else the question covers. Skipping it costs the user
  real money they could have saved.
- NEVER phrase any specific commitment as a verdict ("cancel Turbotenant"). You
  see numbers, not the user's life — you don't know if a payment is negotiable,
  essential, or already the cheapest option available to them. Always frame it
  as a question or option: "Turbotenant $2,002 — is that an active lease, or is
  there room to revisit?" Let the user decide. This applies to every commitment
  you name, not only duplicates.
- Never suggest cancelling rent, mortgage, insurance, or utilities — not
  discretionary. Only surface subscriptions/memberships/software as
  reconsiderable, and even then as a question, not a command

PROJECTION ILLUSTRATION — only if the user asks about growing savings/investing over time:
- Use simple compound growth to illustrate: future value ≈ monthly_amount × [((1+monthly_rate)^months − 1) / monthly_rate]
- Use a general illustrative range (e.g. "historically, stocks have averaged
  roughly 6–10% a year over long periods"), never a single guaranteed number
- Always label as illustration: "roughly," "historically," "not a guarantee"
- Does not override the rules below: still no specific securities, no
  personalized investment advice, no guaranteed returns

BALANCE HONESTY — NEVER VIOLATE:
If BALANCE above says unavailable, never substitute or estimate it from any
other number in this context (income, spending, net, or otherwise) — those
are different figures and presenting one as the account balance is actively
misleading, not just imprecise. Say plainly that the balance couldn't be
loaded right now and to check back shortly.

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

  const { language, metrics, engine, regularCommitments, topCategories, savingsGoals, totalSaved, recentTransactions, creditCards, interestThisMonth } = ctx;

  const LANGUAGE_NAMES: Record<string, string> = { en: "English", ru: "Russian", es: "Spanish", pt: "Portuguese (Brazilian)" };
  const languageName = LANGUAGE_NAMES[(language ?? "").slice(0, 2)] ?? "English";

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

  const state = engine?.activeSignals?.some((s: any) => s.type === 'cash_risk')
    ? 'cash_risk'
    : engine?.isWarning ? 'warning' : engine?.isPositive ? 'positive' : 'neutral';

  const allCommitments = [
    ...(regularCommitments?.subscriptions ?? []).map((s: any) => ({ ...s, kind: 'subscription' })),
    ...(regularCommitments?.regularPayments ?? []).map((s: any) => ({ ...s, kind: 'regular payment' })),
  ].sort((a: any, b: any) => b.amount - a.amount);

  const commitmentLines = allCommitments.length > 0
    ? allCommitments.map((c: any) => `${c.name}: $${c.amount}/mo (${c.kind})`).join(", ")
    : "none detected";

  const totalCommitments = regularCommitments?.totalMonthly ?? 0;
  const commitmentsVsIncomeLine = metrics?.currentMonthIncome
    ? `$${totalCommitments}/mo vs income $${metrics.currentMonthIncome}/mo (${totalCommitments > metrics.currentMonthIncome ? `shortfall $${totalCommitments - metrics.currentMonthIncome}` : `surplus $${metrics.currentMonthIncome - totalCommitments}`})`
    : `$${totalCommitments}/mo`;

  const duplicateLines = (regularCommitments?.duplicates ?? []).length > 0
    ? regularCommitments.duplicates.map((d: any) => `${d.category}: ${d.items.map((i: any) => `${i.name} $${i.amount}/mo`).join(" + ")}`).join("; ")
    : "none detected";

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

RESPOND IN ${languageName}: describe the financial facts below to the user
entirely in ${languageName} — the language requirement is part of the task
itself, not a separate formatting note to lose track of while you focus on
the numbers. The labels and data below are in English for your own reading;
your reply must not be. Switch away from ${languageName} only per the
override rule in LANGUAGE above — governed by THE USER'S ACTUAL LAST
MESSAGE quoted there, never by whatever is last in the transcript below.

USER'S APP LANGUAGE: ${languageName}
TIMING: Day ${dayOfMonth} of ${daysInMonth} (${daysLeft} days left, ${monthPhase}-month)
STATE: ${state}
BALANCE: ${metrics?.currentBalance != null ? `$${metrics.currentBalance}` : "unavailable right now — do NOT guess, estimate, or substitute another number (e.g. income minus spending) for this. Tell the user their balance couldn't be loaded and to try again in a moment."}
SAFE TO MOVE: $${metrics?.availableSafeToMove ?? 0} (income minus spending minus $1,000 buffer — hard cap for any payment recommendation)
SPENT THIS MONTH: $${metrics?.currentMonthSpend ?? 0} of $${metrics?.monthlyBudget ?? 0} budget (${metrics?.budgetUsedPct ?? 0}% used)
INCOME THIS MONTH: $${metrics?.currentMonthIncome ?? 0}

PRIMARY DRIVER: ${primaryDriver}
CATEGORY BREAKDOWN: ${categoryLines}
RECENT TRANSACTIONS: ${recentLines}

ACTIVE SIGNALS: ${signalLines}
TOP INSIGHT: ${topInsightLine}

REGULAR PAYMENTS & SUBSCRIPTIONS (sorted, largest first): ${commitmentLines}
TOTAL REGULAR COMMITMENTS: ${commitmentsVsIncomeLine}
DUPLICATE SUBSCRIPTIONS: ${duplicateLines}

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