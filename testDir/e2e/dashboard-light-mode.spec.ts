import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIST_ASSETS = path.join(__dirname, '../../dist/chromium-mv3/assets');

/**
 * PBI 2026-08-31-01: B分離型 AIプロバイダー設定のライトモード視認性。
 *
 * B分離型の行 (.b-priority-row 等) は JS で動的生成される。また options.html は
 * `/assets/...css` を絶対パス参照するため file:// 単体ではスタイルが読めない。
 * ここではビルド後の options CSS を直接読み込んだ最小 DOM にプローブ要素を置き、
 * prefers-color-scheme に応じて背景トークンが反転することを検証する。
 */

function builtOptionsCss(): string {
  const file = fs.readdirSync(DIST_ASSETS).find((f) => /^options-.*\.css$/.test(f));
  if (!file) throw new Error('built options CSS not found — run `npm run build`');
  return fs.readFileSync(path.join(DIST_ASSETS, file), 'utf8');
}

const PAGE_HTML = `<!doctype html><html><head></head><body>
  <div id="e2e-probe">
    <div class="b-priority-row"><span class="b-priority-handle">::</span></div>
    <div class="b-provider-details"><div class="b-provider-summary">summary</div></div>
    <div class="ai-layout-toggle">
      <button class="ai-layout-toggle-btn">A</button>
      <button class="ai-layout-toggle-btn active">B</button>
    </div>
  </div>
</body></html>`;

async function bg(page: import('@playwright/test').Page, selector: string): Promise<string> {
  return page.locator(`#e2e-probe ${selector}`).evaluate(
    (el) => getComputedStyle(el as HTMLElement).backgroundColor,
  );
}

test.describe('Dashboard - B-separated AI provider light mode @ui', () => {
  const css = builtOptionsCss();

  test.beforeEach(async ({ page }) => {
    await page.setContent(PAGE_HTML);
    await page.addStyleTag({ content: css });
  });

  test('light mode: rows use paper-tone tokens, not hardcoded ink', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });

    // --color-bg-subtle (#f8fafc) / --color-bg-white (#ffffff)
    expect(await bg(page, '.b-priority-row')).toBe('rgb(248, 250, 252)');
    expect(await bg(page, '.b-provider-details')).toBe('rgb(255, 255, 255)');

    for (const sel of ['.b-priority-row', '.b-provider-details']) {
      expect(await bg(page, sel)).not.toBe('rgb(39, 39, 42)'); // #27272a
      expect(await bg(page, sel)).not.toBe('rgb(24, 24, 27)'); // #18181b
    }
  });

  test('dark mode: rows keep ink-toned background', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });

    // dark token overrides: --color-bg-subtle #161b22 / --color-bg-white #0d1117
    expect(await bg(page, '.b-priority-row')).toBe('rgb(22, 27, 34)');
    expect(await bg(page, '.b-provider-details')).toBe('rgb(13, 17, 23)');
  });

  test('active layout toggle button resolves to a real color in both schemes', async ({ page }) => {
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      const c = await bg(page, '.ai-layout-toggle-btn.active');
      expect(c).not.toBe('rgba(0, 0, 0, 0)'); // resolved, not transparent
      expect(c).not.toBe('rgb(39, 39, 42)'); // not the stale #27272a --color-surface bug
    }
  });
});
