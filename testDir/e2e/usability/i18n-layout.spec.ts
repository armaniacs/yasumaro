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

// A raw i18n key left in the DOM looks like snake_case/camelCase identifier
// text with no spaces and no punctuation — real UI copy (ja or en) always
// has spaces or is a single short word, never this shape at meaningful length.
const RAW_KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]{8,}$/;

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

        const suspects = await panel.evaluate((el, patternSource) => {
          const pattern = new RegExp(patternSource);
          const found: string[] = [];
          const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
          let node: Node | null;
          while ((node = walker.nextNode())) {
            const text = node.textContent?.trim() ?? '';
            if (text && pattern.test(text)) found.push(text);
          }
          return found;
        }, RAW_KEY_PATTERN.source);

        expect(suspects, `possible untranslated i18n keys: ${suspects.join(', ')}`).toEqual([]);
      });
    }
  });
}
