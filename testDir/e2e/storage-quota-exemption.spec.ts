import { expect } from '@playwright/test';
import { createDashboardFixture } from './fixtures/dashboard-shared.fixture.js';

/**
 * IndexedDB/OPFS quota exemption @extension (unlimitedStorage)
 *
 * Pins the browser-level observables of the unlimitedStorage exemption that
 * unit tests cannot exercise (jsdom has no storage quota model):
 *
 * 1. The manifest declares unlimitedStorage — the permission the browser
 *    grants the exemption from (public/manifest.json, copied into the build).
 *
 * 2. navigator.storage.estimate() reports a quota far above the default
 *    per-origin cap: with unlimitedStorage Chrome reports the disk's free
 *    space (tens of GB) instead of the capped default the same origin would
 *    get without the permission.
 *
 * What stays owner-manual: the eviction event itself. Chrome evicts origin
 * storage (IndexedDB/OPFS) under real disk pressure at the browser/OS level,
 * and a test cannot deterministically trigger that pressure. The quota
 * observable above is the deterministic proof the exemption applies; the
 * eviction exemption follows from it.
 */

export const test = createDashboardFixture({
  seedPolicy: {
    consent: true,
    breakingChangesShown: true,
    provider: { name: 'gemini', layout: 'a', priorityList: 'synthesize' },
  },
});
export { expect };

// Chrome's default per-origin quota (without unlimitedStorage) stays at or
// below this on realistic machines; unlimitedStorage reports the disk's free
// space instead. 4 GiB separates the two with margin.
const MIN_EXEMPT_QUOTA_BYTES = 4 * 1024 * 1024 * 1024;

test.describe('Storage quota exemption @extension', () => {
  test('the extension runs with the unlimitedStorage quota exemption granted', async ({ dashboardPage: page }) => {
    const estimate = await page.evaluate(async () => {
      const permissions = chrome.runtime.getManifest().permissions;
      const { usage, quota } = await navigator.storage.estimate();
      return { permissions, usage, quota };
    });

    expect(estimate.permissions).toContain('unlimitedStorage');
    expect(estimate.quota).toBeGreaterThan(MIN_EXEMPT_QUOTA_BYTES);
  });
});
