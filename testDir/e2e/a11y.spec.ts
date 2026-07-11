import { test, expect } from './fixtures/popup.fixture.js';
import AxeBuilder from '@axe-core/playwright';

// Helper: show settings screen directly via JS instead of clicking #menuBtn
// because showSettingsScreen() now opens dashboard in a new tab (chrome.tabs.create)
async function showSettingsScreen(page: any): Promise<void> {
  await page.evaluate(() => {
    const mainScreen = document.getElementById('mainScreen');
    const settingsScreen = document.getElementById('settingsScreen');
    if (mainScreen) mainScreen.style.display = 'none';
    if (settingsScreen) settingsScreen.style.display = 'block';
  });
  await expect(page.locator('#settingsScreen')).toBeVisible();
}

test.describe('Accessibility checks @a11y', () => {
  test('popup main screen should have no WCAG violations', async ({ popupPage: page }) => {
    await expect(page.locator('#mainScreen')).toBeVisible();
    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();

    expect(accessibilityScanResults.violations).toEqual([]);
  });

  test('popup settings screen should have no WCAG violations', async ({ popupPage: page }) => {
    // Navigate to settings screen
    await showSettingsScreen(page);

    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();

    expect(accessibilityScanResults.violations).toEqual([]);
  });

  test('popup general settings tab should have no WCAG violations', async ({ popupPage: page }) => {
    await showSettingsScreen(page);
    await page.locator('#generalTab').click();
    await expect(page.locator('#generalPanel')).toBeVisible();

    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();

    expect(accessibilityScanResults.violations).toEqual([]);
  });

  test('popup domain filter tab should have no WCAG violations', async ({ popupPage: page }) => {
    await showSettingsScreen(page);
    await page.locator('#domainTab').click();
    await expect(page.locator('#domainPanel')).toBeVisible();

    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();

    expect(accessibilityScanResults.violations).toEqual([]);
  });

  test('popup privacy tab should have no WCAG violations', async ({ popupPage: page }) => {
    await showSettingsScreen(page);
    await page.locator('#privacyTab').click();
    await expect(page.locator('#privacyPanel')).toBeVisible();

    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();

    expect(accessibilityScanResults.violations).toEqual([]);
  });
});
