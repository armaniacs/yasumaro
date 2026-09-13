/**
 * popup-onboarding-flow.spec.ts (PBI 2026-09-13-49)
 *
 * Usability E2E for the first-run onboarding wizard: it only appears after
 * privacy consent is accepted and ONBOARDING_WIZARD_COMPLETED is unset
 * (popup.fixture.ts's testInteraction accepts consent via the real UI flow,
 * which naturally leaves onboarding_wizard_completed unset on a fresh profile).
 */
import { testInteraction as test, expect } from '../fixtures/popup.fixture.js';

test.describe('First-run onboarding wizard @extension', () => {
  test('user reaches the type-selection step and each option is a single click away', async ({ popupPage: page }) => {
    const wizard = page.locator('#onboardingWizard');
    await expect(wizard).toBeVisible({ timeout: 15000 });

    const typeStep = wizard.locator('[data-step="type"]');
    await expect(typeStep).toBeVisible();

    // All three options are visible without scrolling/extra navigation —
    // the required choice is explicit, not hidden behind another step.
    await expect(wizard.locator('.wizard-option[data-type="obsidian"]')).toBeVisible();
    await expect(wizard.locator('.wizard-option[data-type="sqlite"]')).toBeVisible();
    await expect(wizard.locator('.wizard-option[data-type="minimal"]')).toBeVisible();
  });

  test('choosing "just trying it out" completes the wizard in one click', async ({ popupPage: page }) => {
    const wizard = page.locator('#onboardingWizard');
    await expect(wizard).toBeVisible({ timeout: 15000 });

    await wizard.locator('.wizard-option[data-type="minimal"]').click();

    await expect(wizard).toBeHidden({ timeout: 15000 });

    const completed = await page.evaluate(async () => {
      const { settings } = await chrome.storage.local.get('settings');
      return (settings as Record<string, unknown> | undefined)?.['onboarding_wizard_completed'];
    });
    expect(completed).toBe(true);
  });

  test('choosing "Obsidian user" reaches a next step with a Skip escape hatch', async ({ popupPage: page }) => {
    const wizard = page.locator('#onboardingWizard');
    await expect(wizard).toBeVisible({ timeout: 15000 });

    await wizard.locator('.wizard-option[data-type="obsidian"]').click();

    const obsidianStep = wizard.locator('[data-step="obsidian"]');
    await expect(obsidianStep).toBeVisible();
    await expect(obsidianStep.locator('.wizard-skip')).toBeVisible();
    await expect(obsidianStep.locator('.wizard-next')).toBeVisible();
  });

  test('skipping mid-wizard leaves settings in a consistent, completed state', async ({ popupPage: page }) => {
    const wizard = page.locator('#onboardingWizard');
    await expect(wizard).toBeVisible({ timeout: 15000 });

    await wizard.locator('.wizard-option[data-type="sqlite"]').click();
    const sqliteStep = wizard.locator('[data-step="sqlite"]');
    await expect(sqliteStep).toBeVisible();

    await sqliteStep.locator('.wizard-skip').click();
    await expect(wizard).toBeHidden({ timeout: 15000 });

    // Skipping mid-wizard must not leave the extension in a half-configured
    // state — completion is recorded either way.
    const completed = await page.evaluate(async () => {
      const { settings } = await chrome.storage.local.get('settings');
      return (settings as Record<string, unknown> | undefined)?.['onboarding_wizard_completed'];
    });
    expect(completed).toBe(true);

    // The popup remains usable afterwards (main screen, not stuck behind the wizard).
    await expect(page.locator('#mainScreen')).toBeVisible();
  });
});
