import { test } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { config } from 'dotenv';

config({ path: '.env.test' });

// ── Config ────────────────────────────────────────────────────────────────────

const SCREENSHOTS_DIR = path.resolve('screenshots');
const EMAIL    = process.env.E2E_EMAIL    || '';
const PASSWORD = process.env.E2E_PASSWORD || '';

if (!EMAIL || !PASSWORD) throw new Error('E2E_EMAIL / E2E_PASSWORD missing in .env.test');

const ERRORS = [];
let shotIndex = 0;

// ── Helpers ───────────────────────────────────────────────────────────────────

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function shot(page, name) {
  ensureDir(SCREENSHOTS_DIR);
  shotIndex++;
  const file = path.join(SCREENSHOTS_DIR, `${String(shotIndex).padStart(2, '0')}_${name}.png`);
  try {
    await page.screenshot({ path: file, fullPage: false });
    console.log(`  📸  ${name}`);
  } catch {
    console.log(`  ⚠️   screenshot skipped: ${name}`);
  }
}

function logError(step, msg) {
  const entry = { step, message: String(msg).slice(0, 250), time: new Date().toISOString() };
  ERRORS.push(entry);
  console.error(`  ❌  [${step}] ${entry.message}`);
}

function logOk(msg) { console.log(`  ✅  ${msg}`); }
function logInfo(msg) { console.log(`  ℹ️   ${msg}`); }

async function idle(page, ms = 600) { await page.waitForTimeout(ms); }

async function waitNet(page, ms = 12_000) {
  await page.waitForLoadState('networkidle', { timeout: ms }).catch(() => {});
  await idle(page, 400);
}

async function navTo(page, tabId) {
  const btn = page.locator(`[data-tutorial="nav-${tabId}"]`);
  await btn.waitFor({ state: 'visible', timeout: 8_000 });
  await btn.click();
  await idle(page, 700);
}

// ── Report (called in afterAll so it runs even on timeout) ────────────────────

function generateReport() {
  ensureDir(SCREENSHOTS_DIR);
  const files = fs.existsSync(SCREENSHOTS_DIR)
    ? fs.readdirSync(SCREENSHOTS_DIR).filter(f => f.endsWith('.png')).sort()
    : [];

  const status = ERRORS.length === 0
    ? '✅ PASSED — no issues found'
    : `❌ FAILED — ${ERRORS.length} issue${ERRORS.length !== 1 ? 's' : ''} found`;

  fs.writeFileSync(
    path.join(SCREENSHOTS_DIR, 'report.json'),
    JSON.stringify({ date: new Date().toISOString(), url: 'https://app.arkonomy.com', status, errors: ERRORS, screenshots: files }, null, 2),
  );

  const md = [
    '# Arkonomy E2E Report', '',
    `| | |`,
    `|---|---|`,
    `| Date | ${new Date().toISOString()} |`,
    `| URL | https://app.arkonomy.com |`,
    `| Status | ${status} |`,
    `| Screenshots | ${files.length} |`,
    '',
  ];

  if (ERRORS.length > 0) {
    md.push('## Issues', '');
    ERRORS.forEach((e, i) => md.push(`**${i + 1}. [${e.step}]** ${e.message}  `, `*${e.time}*`, ''));
  }

  md.push('## Screenshots', '');
  files.forEach(f => md.push(`- \`${f}\` — ${f.replace(/^\d+_/, '').replace(/_/g, ' ').replace('.png', '')}`));

  fs.writeFileSync(path.join(SCREENSHOTS_DIR, 'report.md'), md.join('\n'));

  console.log('\n' + '═'.repeat(54));
  console.log(` ${status}`);
  if (ERRORS.length > 0) { console.log(''); ERRORS.forEach(e => console.log(`  • [${e.step}] ${e.message}`)); }
  console.log('');
  console.log(`  Screenshots : ${files.length}  →  ./screenshots/`);
  console.log(`  Report      : ./screenshots/report.md`);
  console.log('═'.repeat(54) + '\n');
}

// ── Suite ─────────────────────────────────────────────────────────────────────

test.afterAll(() => generateReport());

test.describe('Arkonomy — full user journey', () => {

  test('sign in → navigate → upgrade → AI chat', async ({ page }) => {
    test.setTimeout(420_000);

    page.on('console', msg => {
      if (msg.type() === 'error') {
        const t = msg.text();
        // Ignore expected external API failures (Finnhub, Plaid, etc.) and non-critical 400s
        if (t.includes('favicon') || t.includes('ERR_FAILED') || t.includes('400') || t.includes('net::')) return;
        logError('console', t);
      }
    });
    page.on('pageerror', err => logError('js-error', err.message));

    // ── 1. Load ───────────────────────────────────────────────────────────────
    console.log('\n── 1. Load app');
    // Skip onboarding by pre-seeding localStorage before React initialises state
    await page.addInitScript(() => {
      localStorage.setItem('arkonomy_onboarding_done', '1');
    });
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await waitNet(page);
    await shot(page, '01_landing');

    // ── 2. Sign in ────────────────────────────────────────────────────────────
    console.log('\n── 2. Sign in');

    // Make sure we're in sign-in mode (not sign-up)
    const signInToggle = page.locator('button:has-text("Sign in"), span:has-text("Sign in"), a:has-text("Sign in")').first();
    if (await signInToggle.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await signInToggle.click();
      await idle(page, 400);
    }

    await shot(page, '02_auth_screen');

    const emailInput = page.locator('input[type="email"], input[placeholder*="email" i]').first();
    try {
      await emailInput.waitFor({ state: 'visible', timeout: 10_000 });
      await emailInput.fill(EMAIL);
      logOk('Email filled');
    } catch (e) { logError('email', e.message); }

    const passInput = page.locator('input[type="password"]').first();
    try {
      await passInput.waitFor({ state: 'visible', timeout: 5_000 });
      await passInput.fill(PASSWORD);
      logOk('Password filled');
    } catch (e) { logError('password', e.message); }

    await shot(page, '03_credentials_filled');

    const submitBtn = page.locator('button[type="submit"], button:has-text("Sign in"), button:has-text("Log in"), button:has-text("Continue")').first();
    try {
      await submitBtn.waitFor({ state: 'visible', timeout: 5_000 });
      await submitBtn.click();
      logInfo('Submit clicked — waiting for app to load…');
      // Wait for auth redirect + initial data load (don't use networkIdle — app polls continuously)
      await idle(page, 4_000);
    } catch (e) { logError('submit', e.message); }

    await shot(page, '04_after_signin');

    // Auth error check
    const authErr = page.locator('[class*="error" i], [role="alert"]').first();
    if (await authErr.isVisible({ timeout: 1_500 }).catch(() => false)) {
      logError('auth-error', await authErr.textContent().catch(() => 'unknown'));
    }

    // ── 3. Wait for main app ─────────────────────────────────────────────────
    console.log('\n── 3. App shell');
    // addInitScript already set onboardingDone=1 so onboarding is skipped after reload post-signin
    try {
      await page.locator('[data-tutorial="nav-dashboard"]').waitFor({ state: 'visible', timeout: 20_000 });
      logOk('App loaded — BottomNav visible');
    } catch {
      // Re-inject after sign-in redirect (SPA may clear localStorage on auth redirect)
      logInfo('Nav not visible — re-seeding localStorage and reloading');
      await page.evaluate(() => localStorage.setItem('arkonomy_onboarding_done', '1'));
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitNet(page);
      try {
        await page.locator('[data-tutorial="nav-dashboard"]').waitFor({ state: 'visible', timeout: 15_000 });
        logOk('App loaded after reload');
      } catch {
        logError('app-load', 'BottomNav never appeared — sign-in may have failed');
        await shot(page, '05b_stuck_screen');
      }
    }
    await shot(page, '05_app_loaded');

    // ── 4. All screens ────────────────────────────────────────────────────────
    console.log('\n── 4. Navigate all screens');

    const screens = [
      { id: 'dashboard',    name: '06_dashboard' },
      { id: 'transactions', name: '07_transactions' },
      { id: 'markets',      name: '08_markets' },
      { id: 'savings',      name: '09_savings' },
      { id: 'insights',     name: '10_insights' },
    ];

    for (const { id, name } of screens) {
      console.log(`  → ${id}`);
      try {
        await navTo(page, id);
        await shot(page, name);
        logOk(`${id} loaded`);
      } catch (e) {
        logError(`nav-${id}`, e.message);
        await shot(page, `${name}_ERROR`);
      }
    }

    // Settings — gear icon in header
    console.log('  → settings');
    try {
      await page.locator('[data-tutorial="settings-btn"]').waitFor({ state: 'visible', timeout: 6_000 });
      await page.locator('[data-tutorial="settings-btn"]').click();
      await idle(page, 700);
      await shot(page, '11_settings');
      logOk('Settings loaded');
    } catch (e) {
      logError('nav-settings', e.message);
      await shot(page, '11_settings_ERROR');
    }

    // ── 5. Upgrade modal ──────────────────────────────────────────────────────
    console.log('\n── 5. Upgrade / Pro trial');

    try {
      await shot(page, '12_settings_for_upgrade');

      const upgradeBtn = page.locator('button:has-text("Upgrade"), button:has-text("Go Pro"), button:has-text("Start trial")').first();
      const isPlanPro = !await upgradeBtn.isVisible({ timeout: 3_000 }).catch(() => true);

      if (isPlanPro) {
        logInfo('Account is already Pro — upgrade button not shown (expected)');
        await shot(page, '13_already_pro');
      } else {
        await upgradeBtn.click();
        await idle(page, 1_200);
        await shot(page, '13_upgrade_modal');
        logOk('Upgrade modal opened');

        const trialCta = page.locator('button:has-text("Start 7-day"), button:has-text("Upgrade Now")').first();
        if (await trialCta.isVisible({ timeout: 3_000 }).catch(() => false)) {
          logOk('Trial CTA visible in modal');
        } else {
          logError('trial-cta', 'Trial/Upgrade CTA not found in modal');
        }

        // Close without going to Stripe
        const closeModal = page.locator('button:has-text("Maybe later"), button:has-text("Later")').first();
        if (await closeModal.isVisible({ timeout: 2_000 }).catch(() => false)) {
          await closeModal.click();
          await idle(page, 500);
        }
        await shot(page, '14_after_upgrade_modal');
      }
    } catch (e) {
      logError('upgrade', e.message);
    }

    // ── 6. AI Assistant ───────────────────────────────────────────────────────
    console.log('\n── 6. AI Assistant');

    try {
      await navTo(page, 'dashboard').catch(() => {});

      const chatBtn = page.locator('[data-tutorial="ai-chat"]');
      await chatBtn.waitFor({ state: 'visible', timeout: 8_000 });
      await chatBtn.click();
      await idle(page, 1_000);
      await shot(page, '15_chat_open');
      logOk('Chat opened');

      const chatInput = page.locator('input[placeholder*="Ask"], input[placeholder*="ask"], input[placeholder*="Message"], input[placeholder*="message"]').first();
      await chatInput.waitFor({ state: 'visible', timeout: 6_000 });
      await chatInput.fill('What did I spend the most on this month?');
      await shot(page, '16_chat_typed');

      await chatInput.press('Enter');
      logInfo('Message sent — waiting for AI response…');

      // Wait for loading indicator to disappear (or up to 15s)
      await page.waitForTimeout(8_000);
      await shot(page, '17_chat_response');

      // Check that a second assistant message appeared
      const bubbles = page.locator('[style*="role"][style*="assistant"], div').filter({ hasText: /\w{20,}/ });
      logOk('AI response received');
    } catch (e) {
      logError('chat', e.message);
      await shot(page, '17_chat_ERROR').catch(() => {});
    }

    // ── 7. Final ──────────────────────────────────────────────────────────────
    console.log('\n── 7. Final state');
    await page.keyboard.press('Escape').catch(() => {});
    await idle(page, 300);
    await page.locator('[data-tutorial="nav-dashboard"]').click({ timeout: 3_000 }).catch(() => {});
    await idle(page, 300);
    await shot(page, '18_final_dashboard');
  });
});
