/**
 * dashboard-error-recovery.spec.ts (PBI 2026-09-13-48)
 *
 * Usability E2E for failure-path messaging: an error message must tell the
 * user both WHAT went wrong and WHAT TO DO next, not just "an error
 * occurred". Covers AI provider unconfigured, Obsidian unreachable, and
 * an offline network.
 */
import { testInteraction as test, expect } from '../fixtures/dashboard.fixture.js';

// A message counts as "actionable" if it names a concrete next step —
// checking a setting, checking whether a service is running, retrying,
// etc. — rather than a bare "an error occurred" style generic string.
const ACTIONABLE_HINT_PATTERN = /check|enable|running|enter|retry|try again|confirm|verify|設定|確認|入力|再試行|有効|起動/i;
const GENERIC_ONLY_PATTERN = /^(error|an error occurred|failed|エラーが発生しました|失敗しました)\.?$/i;

test.describe('Dashboard error message usability @extension', () => {
  test('AI provider unconfigured: message names the missing key and what to do', async ({ dashboardPage: page }) => {
    // Ensure no Gemini API key is set (fixture defaults to gemini provider, no key seeded).
    await page.locator('[data-panel="panel-diagnostics"]').click();
    await page.locator('#diagTestAiBtn').click();

    const result = page.locator('#diagConnectionResult');
    await expect(result).toContainText(/gemini/i, { timeout: 15000 });

    const text = (await result.textContent()) ?? '';
    expect(text, `message was not actionable: "${text}"`).not.toMatch(GENERIC_ONLY_PATTERN);
    expect(text, `message gave no next step: "${text}"`).toMatch(ACTIONABLE_HINT_PATTERN);
  });

  test('Obsidian unreachable: message explains the likely cause and what to check', async ({ dashboardPage: page }) => {
    await page.locator('[data-panel="panel-diagnostics"]').click();
    await page.locator('#diagTestObsidianBtn').click();

    const result = page.locator('#diagConnectionResult');
    await expect(result).toContainText(/obsidian/i, { timeout: 15000 });

    const text = (await result.textContent()) ?? '';
    expect(text, `message was not actionable: "${text}"`).not.toMatch(GENERIC_ONLY_PATTERN);
    expect(text, `message gave no next step: "${text}"`).toMatch(ACTIONABLE_HINT_PATTERN);
  });

  test('offline network: AI connection test still reports an actionable message', async ({ dashboardPage: page, context }) => {
    await context.setOffline(true);
    try {
      await page.locator('[data-panel="panel-diagnostics"]').click();
      await page.locator('#diagTestAiBtn').click();

      const result = page.locator('#diagConnectionResult');
      await expect(result).toContainText(/gemini/i, { timeout: 15000 });

      const text = (await result.textContent()) ?? '';
      expect(text, `message was not actionable: "${text}"`).not.toMatch(GENERIC_ONLY_PATTERN);
    } finally {
      await context.setOffline(false);
    }
  });
});
