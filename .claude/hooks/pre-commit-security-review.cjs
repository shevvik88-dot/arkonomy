#!/usr/bin/env node
// PreToolUse hook (Bash matcher) — only sees commits Claude Code itself runs
// via its Bash tool; a plain `git commit` from a terminal/IDE never triggers
// this (that's covered separately by .githooks/pre-commit's gitleaks scan).
//
// Runs a headless `claude -p` call acting as a security-auditor over the
// staged diff and blocks the commit (exit 2) on a BLOCK verdict. Fails OPEN
// (allows the commit, exit 0) on any infra problem — missing `claude` binary,
// timeout, unparseable output — so a broken check never becomes a permanent
// workflow blocker. That failure is written to stderr so it's visible, not
// silent.
const { execFileSync } = require("node:child_process");

const MAX_DIFF_CHARS = 60000;
const CLAUDE_TIMEOUT_MS = 55000;

function readStdin() {
  const chunks = [];
  process.stdin.on("data", (d) => chunks.push(d));
  return new Promise((resolve) => {
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

async function main() {
  const raw = await readStdin();
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    process.exit(0);
  }

  if (payload.tool_name !== "Bash") process.exit(0);
  const command = payload.tool_input && payload.tool_input.command ? String(payload.tool_input.command) : "";
  if (!/\bgit\s+commit\b/.test(command)) process.exit(0);

  const cwd = payload.cwd || process.cwd();

  let diff;
  try {
    diff = execFileSync("git", ["diff", "--cached"], { cwd, maxBuffer: 10 * 1024 * 1024 }).toString();
  } catch (e) {
    process.stderr.write("security-review hook: could not read staged diff, skipping check: " + e.message + "\n");
    process.exit(0);
  }
  if (!diff.trim()) process.exit(0);

  const prompt = [
    "You are a security auditor for Arkonomy, a fintech app (Plaid bank data, Supabase RLS, Stripe).",
    "Review this staged git diff for CRITICAL issues ONLY: hardcoded secrets/API keys, missing auth/RLS checks,",
    "injection risks, sensitive data (bank tokens, PII) exposed client-side or logged. Ignore style/simplicity issues.",
    "",
    "Respond with EXACTLY one line, nothing else:",
    "VERDICT: BLOCK - <one-sentence reason>",
    "or",
    "VERDICT: OK",
    "",
    "Diff:",
    diff.slice(0, MAX_DIFF_CHARS),
  ].join("\n");

  let result;
  try {
    result = execFileSync("claude", ["-p"], {
      cwd,
      input: prompt,
      timeout: CLAUDE_TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024,
    }).toString();
  } catch (e) {
    process.stderr.write("security-review hook: headless claude check failed/timed out, skipping (commit allowed): " + e.message + "\n");
    process.exit(0);
  }

  const blockMatch = /VERDICT:\s*BLOCK\b\s*[-—]?\s*(.*)/i.exec(result);
  if (blockMatch) {
    process.stderr.write("Commit blocked by security review: " + (blockMatch[1].trim() || result.trim()) + "\n");
    process.exit(2);
  }

  process.exit(0);
}

main();
