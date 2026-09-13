/**
 * i18n-layout.spec.ts (PBI 2026-09-13-50)
 *
 * Checks that switching the browser's UI locale between ja and en does not
 * (a) overflow any element in the sampled panels, or (b) leave a raw i18n
 * key name visible where a translated string should be. chrome.i18n key
 * *coverage* itself is already checked by scripts/release-checks/check-i18n.mjs;
 * this test is about the rendered layout, which that script cannot see.
 */
import { test, expect } from '../fixtures/dashboard-locale.fixture.js';

const SAMPLE_PANELS = ['panel-general', 'panel-domain', 'panel-diagnostics'];

for (const locale of ['en-US', 'ja-JP'] as const) {
  test.describe(`Dashboard i18n layout @extension (${locale})`, () => {
    test.use({ locale });

    for (const panelId of SAMPLE_PANELS) {
      test(`${panelId} has no horizontal overflow`, async ({ dashboardPage: page }) => {
        await page.locator(`[data-panel="${panelId}"]`).click();
        const panel = page.locator(`#${panelId}`);
        await expect(panel).toBeVisible();

        const overflowing = await panel.evaluate((el) => {
          const offenders: string[] = [];
          const walk = (node: Element) => {
            // Skip elements that intentionally clip via `overflow: hidden`
            // (e.g. .sr-only screen-reader-only text) — a wide scrollWidth
            // there is by design, not a layout bug. Skip <section class="panel">
            // itself too: the panel is the scan root and its scrollWidth
            // reflects the whole page's layout width, not this panel's content.
            const style = getComputedStyle(node);
            const clipsIntentionally = style.overflow === 'hidden' || style.overflowX === 'hidden';
            const isPanelRoot = node.classList.contains('panel');
            if (!clipsIntentionally && !isPanelRoot && node.scrollWidth > node.clientWidth + 1) {
              offenders.push(`${node.tagName}.${node.className || '(no class)'}`);
            }
            for (const child of Array.from(node.children)) walk(child);
          };
          walk(el);
          return offenders;
        });

        expect(overflowing, `overflowing elements: ${overflowing.join(', ')}`).toEqual([]);
      });

      test(`${panelId} has no raw i18n key left untranslated`, async ({ dashboardPage: page }) => {
        await page.locator(`[data-panel="${panelId}"]`).click();
        const panel = page.locator(`#${panelId}`);
        await expect(panel).toBeVisible();

        // Compare each data-i18n element's own key against its rendered text —
        // a mistranslation only ever regresses to the literal key string, so
        // this can't false-positive on ordinary English words the way a
        // shape-based regex over all text nodes did.
        const suspects = await panel.evaluate((el) => {
          const found: string[] = [];
          el.querySelectorAll<HTMLElement>('[data-i18n]').forEach((node) => {
            const key = node.getAttribute('data-i18n');
            const text = node.textContent?.trim() ?? '';
            if (key && text === key) found.push(key);
          });
          return found;
        });

        expect(suspects, `untranslated i18n keys (text equals key): ${suspects.join(', ')}`).toEqual([]);
      });
    }
  });
}
