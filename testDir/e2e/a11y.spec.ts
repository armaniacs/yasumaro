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
});
