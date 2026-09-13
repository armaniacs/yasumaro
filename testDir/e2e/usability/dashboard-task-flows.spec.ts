/**
 * dashboard-task-flows.spec.ts (PBI 2026-09-13-47)
 *
 * A user completing a real settings-change task end to end: enable the
 * domain filter, add a domain, save, and confirm the change survives a
 * dashboard reload — not just that the UI accepted the click.
 */
import { testInteraction as test, expect } from '../fixtures/dashboard.fixture.js';

const TEST_DOMAIN = 'example-blocked-site.test';

test.describe('Dashboard settings task completion @extension', () => {
  test('user adds a domain filter, saves, and it survives a reload', async ({ dashboardPage: page }) => {
    await page.locator('[data-panel="panel-domain"]').click();
    await expect(page.locator('#panel-domain')).toBeVisible();

    const toggle = page.locator('#domainFilterToggle');
    if (!(await toggle.isChecked())) {
      await toggle.click();
    }

    const tagArea = page.locator('#domainTagArea');
    await expect(tagArea).toBeVisible();

    await page.locator('#domainTagInput').fill(TEST_DOMAIN);
    await page.locator('#domainTagAddBtn').click();

    await expect(page.locator('#domainTagList')).toContainText(TEST_DOMAIN);

    await page.locator('#domainSaveBtn').click();
    // saveDomainLists() persists asynchronously — wait for its status message
    // before reloading, or the reload can race the write.
    await expect(page.locator('#domainSaveStatus')).not.toHaveText('', { timeout: 10000 });

    // Reload the whole dashboard — a real page reopen, not just a panel switch.
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.locator('#geminiSettings')).toBeVisible();

    await page.locator('[data-panel="panel-domain"]').click();
    await expect(page.locator('#domainFilterToggle')).toBeChecked();
    await expect(page.locator('#domainTagList')).toContainText(TEST_DOMAIN);
  });
});
