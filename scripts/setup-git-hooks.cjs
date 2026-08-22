#!/usr/bin/env node
// scripts/setup-git-hooks.cjs
//
// npm "prepare" hook — sets core.hooksPath so .githooks/* actually run.
//
// Must no-op silently (exit 0, no output) when there's no .git directory —
// some deploy pipelines (Vercel and others) can run `npm install` against a
// checkout that isn't a full git working copy, and a failing "prepare"
// script fails the whole install/build there. Written as a plain Node
// script (not inline shell in package.json) specifically to avoid
// cmd.exe/PowerShell/POSIX-sh differences — e.g. `/dev/null` doesn't exist
// on Windows (npm's default script-shell there is cmd.exe, which only has
// `NUL`), so a single shell-syntax "prepare" line can't be both portable
// and correct across platforms.
'use strict';

const { execFileSync } = require('child_process');

function run(args) {
  execFileSync('git', args, { stdio: 'ignore' });
}

try {
  run(['rev-parse', '--git-dir']);
} catch {
  process.exit(0); // not a git repo (or git missing) — nothing to configure
}

try {
  run(['config', 'core.hooksPath', '.githooks']);
} catch (err) {
  // Don't fail the install over this — hooks are a local dev nicety, not a
  // build requirement.
  console.warn('setup-git-hooks: could not set core.hooksPath —', err.message);
}
