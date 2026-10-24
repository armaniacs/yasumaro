import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIST_ASSETS = path.join(__dirname, '../../dist/chromium-mv3/assets');

/**
 * Dashboard theme contrast (@ui).
 *
 * The onboarding banner once shipped white-on-white in dark mode:
 * `var(--color-surface, #ffffff)` referenced a token that did not exist, so
 * the background kept its light fallback while the text followed the dark
 * scheme. Static CSS parsing (src/styles/__tests__/cssThemeContract.test.ts)
 * catches undefined tokens, but only a real browser sees what the user sees:
 * UA button defaults that ignore inheritance, the winning rule when two
 * `.secondary-btn` definitions collide, and the final computed contrast.
 * This spec renders the real banner markup with the built options CSS and
 * asserts WCAG AA contrast in both color schemes.
 */

function builtOptionsCss(): string {
  const file = fs.readdirSync(DIST_ASSETS).find((f) => /^options-.*\.css$/.test(f));
  if (!file) throw new Error('built options CSS not found — run `npm run build`');
  return fs.readFileSync(path.join(DIST_ASSETS, file), 'utf8');
}

const PAGE_HTML = `<!doctype html><html lang="ja"><head></head><body>
  <div class="content-area">
    <div id="e2e-probe">
      <div id="onboardingBanner" class="onboarding-banner">
        <div class="onboarding-banner-head">
          <p id="onboardingIntro">設定がなくても記録と検索は使えます。始め方を選んでください。</p>
          <button type="button" class="secondary-btn">後で設定する</button>
        </div>
        <div class="onboarding-choices">
          <button type="button" class="onboarding-choice">
            <span class="onboarding-choice-title">まず試す</span>
            <span class="onboarding-choice-desc">設定なしで記録と検索を試せます</span>
          </button>
          <button type="button" class="onboarding-choice">
            <span class="onboarding-choice-title">Obsidian連携</span>
            <span class="onboarding-choice-desc">保存先をObsidianに追加します</span>
          </button>
          <button type="button" class="onboarding-choice">
            <span class="onboarding-choice-title">AI要約</span>
            <span class="onboarding-choice-desc">要約の生成を有効にします</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</body></html>`;

function channel(hex: string): number {
  const s = parseInt(hex, 16) / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance(rgb: string): number {
  const m = rgb.match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)/);
  if (m === null) throw new Error(`cannot parse color: ${rgb}`);
  // The regex guarantees three capture groups, so these defaults never fire.
  const [r = 0, g = 0, b = 0] = [m[1], m[2], m[3]].map((v) => channel(Number(v).toString(16)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(fg: string, bg: string): number {
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

async function colors(page: import('@playwright/test').Page, selector: string): Promise<{ fg: string; bg: string }> {
  return page.locator(`#e2e-probe ${selector}`).first().evaluate((el) => {
    const cs = getComputedStyle(el as HTMLElement);
    return { fg: cs.color, bg: cs.backgroundColor };
  });
}

/** emulateMedia resolves before the style engine re-evaluates the scheme;
 *  wait for the media itself and then for the computed banner background to
 *  settle in the matching bucket, so computed styles below are never sampled
 *  mid-flip (condition waits, not fixed sleeps). */
async function awaitScheme(page: import('@playwright/test').Page, scheme: 'light' | 'dark'): Promise<void> {
  await page.emulateMedia({ colorScheme: scheme });
  await page.waitForFunction(
    (wantDark) => window.matchMedia('(prefers-color-scheme: dark)').matches === wantDark,
    scheme === 'dark',
  );
  await page.waitForFunction(
    (wantDark) => {
      const bg = getComputedStyle(document.querySelector('#e2e-probe .onboarding-banner') as HTMLElement).backgroundColor;
      const m = bg.match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)/);
      if (m === null) return false;
      const sum = Number(m[1]) + Number(m[2]) + Number(m[3]);
      return wantDark ? sum < 400 : sum > 400;
    },
    scheme === 'dark',
  );
}

test.describe('Dashboard theme contrast @ui', () => {
  const css = builtOptionsCss();

  test.beforeEach(async ({ page }) => {
    await page.setContent(PAGE_HTML);
    await page.addStyleTag({ content: css });
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`${scheme} mode: onboarding banner keeps WCAG AA contrast`, async ({ page }) => {
      await awaitScheme(page, scheme);

      const pairs: Array<[string, string]> = [
        ['.onboarding-banner-head p', '.onboarding-banner'],
        ['.onboarding-choice-title', '.onboarding-choice'],
        ['.onboarding-choice-desc', '.onboarding-choice'],
        ['.onboarding-banner-head .secondary-btn', '.onboarding-banner'],
      ];
      for (const [fgSel, bgSel] of pairs) {
        const fg = await colors(page, fgSel);
        const bg = await colors(page, bgSel);
        const r = ratio(fg.fg, bg.bg);
        expect(r, `${fgSel} (${fg.fg}) on ${bgSel} (${bg.bg}) in ${scheme}`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }

  test('dark mode: banner flips to a dark surface and titles escape UA button black', async ({ page }) => {
    await awaitScheme(page, 'dark');

    const bannerBg = await page.locator('#e2e-probe .onboarding-banner').evaluate(
      (el) => getComputedStyle(el as HTMLElement).backgroundColor,
    );
    expect(luminance(bannerBg), `banner background ${bannerBg} should be dark`).toBeLessThan(0.3);

    const title = await page.locator('#e2e-probe .onboarding-choice-title').first().evaluate(
      (el) => getComputedStyle(el as HTMLElement).color,
    );
    expect(title, 'choice titles must use the theme text color, not UA ButtonText').not.toBe('rgb(0, 0, 0)');
    expect(luminance(title), `title ${title} should be light-on-dark`).toBeGreaterThan(0.3);
  });

  test('light mode: banner stays a light surface', async ({ page }) => {
    await awaitScheme(page, 'light');

    const bannerBg = await page.locator('#e2e-probe .onboarding-banner').evaluate(
      (el) => getComputedStyle(el as HTMLElement).backgroundColor,
    );
    expect(luminance(bannerBg), `banner background ${bannerBg} should be light`).toBeGreaterThan(0.5);
  });
});
