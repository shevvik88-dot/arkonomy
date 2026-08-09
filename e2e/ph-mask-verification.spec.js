import { test, expect } from '@playwright/test';
import { config } from 'dotenv';

config({ path: '.env.test' });

// Verifies the `ph-mask` class (PostHog session-replay masking convention) actually
// reaches rendered DOM output on screens showing financial data — not just present in
// JSX source. A missing class here means PostHog would record unmasked balances/amounts.

const EMAIL = process.env.E2E_EMAIL || '';
const PASSWORD = process.env.E2E_PASSWORD || '';

if (!EMAIL || !PASSWORD) throw new Error('E2E_EMAIL / E2E_PASSWORD missing in .env.test');

async function idle(page, ms = 600) { await page.waitForTimeout(ms); }

async function signIn(page) {
  await page.addInitScript(() => localStorage.setItem('arkonomy_onboarding_done', '1'));
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForLoadState('networkidle', { timeout: 12_000 }).catch(() => {});
  await idle(page, 400);

  const signInToggle = page.locator('button:has-text("Sign in"), span:has-text("Sign in"), a:has-text("Sign in")').first();
  if (await signInToggle.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await signInToggle.click();
    await idle(page, 400);
  }

  await page.locator('input[type="email"], input[placeholder*="email" i]').first().fill(EMAIL);
  await page.locator('input[type="password"]').first().fill(PASSWORD);
  await page.locator('button[type="submit"], button:has-text("Sign in"), button:has-text("Log in"), button:has-text("Continue")').first().click();
  await idle(page, 4_000);

  await page.locator('[data-tutorial="nav-dashboard"]').waitFor({ state: 'visible', timeout: 20_000 }).catch(async () => {
    await page.evaluate(() => localStorage.setItem('arkonomy_onboarding_done', '1'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 12_000 }).catch(() => {});
    await page.locator('[data-tutorial="nav-dashboard"]').waitFor({ state: 'visible', timeout: 15_000 });
  });
}

async function navTo(page, tabId) {
  await page.locator(`[data-tutorial="nav-${tabId}"]`).click();
  await idle(page, 700);
}

// Counts real DOM elements with the ph-mask class, and how many have non-empty text —
// distinguishes "class exists somewhere" from "class is on elements actually showing data".
async function phMaskStats(page) {
  return page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('.ph-mask'));
    return {
      count: els.length,
      withText: els.filter(el => el.textContent.trim().length > 0).length,
      sample: els.slice(0, 3).map(el => el.textContent.trim().slice(0, 30)),
    };
  });
}

test.describe('PostHog ph-mask reaches real DOM', () => {
  test.setTimeout(180_000);

  test('Dashboard renders ph-mask elements with content', async ({ page }) => {
    await signIn(page);
    await navTo(page, 'dashboard');
    await idle(page, 1_000);

    const stats = await phMaskStats(page);
    console.log('Dashboard ph-mask stats:', stats);
    expect(stats.count, 'no .ph-mask elements found in rendered Dashboard DOM').toBeGreaterThan(0);
    expect(stats.withText, 'ph-mask elements exist but none contain rendered text/amounts').toBeGreaterThan(0);
  });

  test('Transactions renders ph-mask elements with content', async ({ page }) => {
    await signIn(page);
    await navTo(page, 'transactions');
    await idle(page, 1_000);

    const stats = await phMaskStats(page);
    console.log('Transactions ph-mask stats:', stats);
    expect(stats.count, 'no .ph-mask elements found in rendered Transactions DOM').toBeGreaterThan(0);
    expect(stats.withText, 'ph-mask elements exist but none contain rendered text/amounts').toBeGreaterThan(0);
  });

  test('Chat renders ph-mask elements with content', async ({ page }) => {
    await signIn(page);
    await navTo(page, 'dashboard');

    // The floating ai-chat button is intentionally hidden on Dashboard
    // (2026-08-09, duplicated the "Ask your coach anything" row there) —
    // use that row instead, same retargeting OnboardingFlow.jsx's own
    // tour steps got for the same reason.
    const chatBtn = page.locator('[data-tutorial="ask-coach"]');
    await chatBtn.waitFor({ state: 'visible', timeout: 8_000 });
    await chatBtn.click();
    await idle(page, 1_000);

    const chatInput = page.locator('input[placeholder*="Ask"], input[placeholder*="ask"], input[placeholder*="Message"], input[placeholder*="message"]').first();
    await chatInput.waitFor({ state: 'visible', timeout: 6_000 });
    await chatInput.fill('What did I spend the most on this month?');
    await chatInput.press('Enter');
    await page.waitForTimeout(8_000);

    const stats = await phMaskStats(page);
    console.log('Chat ph-mask stats:', stats);
    expect(stats.count, 'no .ph-mask elements found in rendered Chat DOM').toBeGreaterThan(0);
  });
});
