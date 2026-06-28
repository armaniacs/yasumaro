import { test, expect } from './fixtures/popup.fixture.js';
import AxeBuilder from '@axe-core/playwright';

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
    await page.locator('#menuBtn').click();
    await expect(page.locator('#settingsScreen')).toBeVisible();

    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();

    expect(accessibilityScanResults.violations).toEqual([]);
  });

  test('popup general settings tab should have no WCAG violations', async ({ popupPage: page }) => {
    // Open settings and switch to general tab
    await page.locator('#menuBtn').click();
    await page.locator('#generalTab').click();
    await expect(page.locator('#generalPanel')).toBeVisible();

    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();

    expect(accessibilityScanResults.violations).toEqual([]);
  });

  test('popup domain filter tab should have no WCAG violations', async ({ popupPage: page }) => {
    await page.locator('#menuBtn').click();
    await page.locator('#domainTab').click();
    await expect(page.locator('#domainPanel')).toBeVisible();

    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();

    expect(accessibilityScanResults.violations).toEqual([]);
  });

  test('popup privacy tab should have no WCAG violations', async ({ popupPage: page }) => {
    await page.locator('#menuBtn').click();
    await page.locator('#privacyTab').click();
    await expect(page.locator('#privacyPanel')).toBeVisible();

    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();

    expect(accessibilityScanResults.violations).toEqual([]);
  });
});
