import { test, expect } from './fixtures/popup-pbi27.fixture.js';

/**
 * Popup ロゴ直下の動作中版表示の E2E 仕様。
 *
 * - popup を開いたらロゴ直下 (#appVersion) に版が読めること
 * - 表示値が manifest の version と一致すること
 *   (src/popup/appVersion.ts の formatAppVersion と同じく v 付与整形)
 */
test.describe('Popup - version display @extension', () => {
  test('shows running version directly under the logo', async ({ popupPage: page }) => {
    const version = page.locator('#appVersion');
    await expect(version).toBeVisible();

    const text = (await version.textContent())?.trim() ?? '';
    expect(text).toMatch(/^v\S+/);

    const order = await page.evaluate(() => {
      const label = document.getElementById('appVersion');
      const header = label?.closest('.header');
      const logo = header?.querySelector('h2');
      if (!label || !header || !logo) return null;
      const followsLogo =
        (logo.compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
      const logoRect = logo.getBoundingClientRect();
      const labelRect = label.getBoundingClientRect();
      return {
        sameHeader: label.parentElement === header,
        followsLogo,
        separated:
          labelRect.left >= logoRect.right || labelRect.top >= logoRect.bottom,
      };
    });
    expect(order).not.toBeNull();
    expect(order!.sameHeader).toBe(true);
    expect(order!.followsLogo).toBe(true);
    expect(order!.separated).toBe(true);
  });

  test('version text matches manifest version with v prefix', async ({ popupPage: page }) => {
    const manifestVersion = await page.evaluate(
      () => chrome.runtime.getManifest().version,
    );
    expect(manifestVersion.trim().length).toBeGreaterThan(0);
    const expected = manifestVersion.startsWith('v')
      ? manifestVersion
      : `v${manifestVersion}`;

    await expect(page.locator('#appVersion')).toHaveText(expected);
  });
});
