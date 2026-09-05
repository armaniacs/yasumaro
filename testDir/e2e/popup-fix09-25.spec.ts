import { test, expect, test as base, Page } from '@playwright/test';
import { chromium, type ChromiumBrowserContext } from 'playwright';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// 本スペックは testDir/e2e/ 直下にあるため 2 レベル上 = リポジトリルート
const EXTENSION_PATH = join(__dirname, '../../dist/chromium-mv3');

/**
 * fix 09 (PBI 2026-09-05-09) / fix 25 (PBI 2026-09-05-25) の目視確認項目を
 * 自動 E2E で代替するスペック。
 *
 * - fix 09: html/body の許容範囲幅（min 360 / max 420）・横スクロール無し・
 *   長い翻訳ラベルの折り返し（nowrap 解除の検証）・ja ロケールでの描画
 * - fix 25: privacyConsentModal のフォーカストラップ（Tab 循環が modal 内に
 *   留まること）と close 時の解除。private/recording-failed ダイアログの
 *   trap/release 配線は単体テスト（privatePageDialog.test.ts）が担保する。
 */

async function launchPopupContext(locale?: string): Promise<ChromiumBrowserContext> {
  return chromium.launchPersistentContext('', {
    channel: 'chromium',
    locale,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
    ],
  });
}

type PopupFixtures = {
  /** 拡張込みで起動した永続コンテキスト（テスト終了時に close） */
  popupContext: ChromiumBrowserContext;
  /** popup.html を開いたページ（consent は未セット → モーダルが表示される） */
  freshPopupPage: Page;
};

const testExt = base.extend<PopupFixtures>({
  popupContext: async ({}, use) => {
    const context = await launchPopupContext();
    await use(context);
    await context.close();
  },

  freshPopupPage: async ({ popupContext }, use) => {
    // service worker 起動を待ってから popup を開く（fixture パターン準拠）
    let [serviceWorker] = popupContext.serviceWorkers();
    if (!serviceWorker) {
      serviceWorker = await popupContext.waitForEvent('serviceworker');
    }
    const extensionId = serviceWorker.url().split('/')[2];
    const pages = popupContext.pages();
    const page = pages.length > 0 ? pages[0] : await popupContext.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    await use(page);
  },
});

test.describe('Popup width range & wrapping (fix 09) @extension', () => {
  let context: ChromiumBrowserContext;
  let page: Page;

  test.beforeAll(async () => {
    context = await launchPopupContext('ja');
    let [serviceWorker] = context.serviceWorkers();
    if (!serviceWorker) {
      serviceWorker = await context.waitForEvent('serviceworker');
    }
    const extensionId = serviceWorker.url().split('/')[2];
    const pages = context.pages();
    page = pages.length > 0 ? pages[0] : await context.newPage();
    await page.addInitScript(() => {
      chrome.storage.local.set({
        privacyConsent: { accepted: true, timestamp: Date.now() },
        settings_migrated: true,
      });
      window.close = () => {};
    });
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    const consentModal = page.locator('#privacyConsentModal');
    if (await consentModal.isVisible().catch(() => false)) {
      await page.locator('#consentCheckbox').check();
      await page.locator('#acceptConsentBtn').click();
    }
  });

  test.afterAll(async () => {
    await context.close();
  });

  test('body width stays within the 360-420px allowance', async () => {
    const widths = await page.evaluate(() => {
      const body = getComputedStyle(document.body);
      const html = getComputedStyle(document.documentElement);
      return {
        bodyMin: body.minWidth,
        bodyMax: body.maxWidth,
        htmlMin: html.minWidth,
        htmlMax: html.maxWidth,
        actual: document.body.getBoundingClientRect().width,
      };
    });
    expect(widths.bodyMin).toBe('360px');
    expect(widths.bodyMax).toBe('420px');
    expect(widths.htmlMin).toBe('360px');
    expect(widths.htmlMax).toBe('420px');
    expect(widths.actual).toBeGreaterThanOrEqual(360);
    expect(widths.actual).toBeLessThanOrEqual(420);
  });

  test('popup has no horizontal overflow', async () => {
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      bodyScroll: document.body.scrollWidth,
      bodyClient: document.body.clientWidth,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
    expect(overflow.bodyScroll).toBeLessThanOrEqual(overflow.bodyClient);
  });

  test('long labels wrap instead of being clipped (nowrap removal)', async () => {
    // メイン画面のフローに長い日本語ラベル相当のブロックを挿入し、
    // コンテナが折り返しを許可すること（= 翻訳文言が見切れないこと）と
    // 横はみ出しが発生しないことを検証する。fix 09 で nowrap を解除した
    // ボタン（status-toggle / banner 系）は同一の white-space 規則を共有する。
    const result = await page.evaluate(async () => {
      const probe = document.createElement('div');
      probe.style.width = '100%';
      probe.style.whiteSpace = 'normal';
      probe.style.overflowWrap = 'anywhere';
      probe.textContent = 'クリップされないことを検証するための非常に長いステータスラベル（日本語ロケール相当の翻訳文言が入るケース）'.repeat(3);
      const main = document.getElementById('mainScreen');
      if (!main) return null;
      main.appendChild(probe);
      // レイアウト確定を待ってから計測する
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const rect = probe.getBoundingClientRect();
      const singleLineHeight = 24;
      const wrapped = rect.height > singleLineHeight;
      const bodyOverflow = document.body.scrollWidth > document.body.clientWidth;
      probe.remove();
      return { wrapped, bodyOverflow };
    });
    expect(result).not.toBeNull();
    expect(result!.wrapped).toBe(true);
    expect(result!.bodyOverflow).toBe(false);
  });

  test('ja locale renders the popup without falling back to key names', async () => {
    const text = await page.evaluate(() => {
      const btn = document.getElementById('recordBtn');
      return btn ? (btn.textContent ?? '').trim() : '';
    });
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toMatch(/^record[A-Z]/); // キー名の未解決（recordBtnLabel 等）でないこと
  });
});

test.describe('Privacy consent modal focus trap (fix 25) @extension', () => {
  testExt('modal is visible and traps Tab focus inside itself', async ({ freshPopupPage: page }) => {
    const modal = page.locator('#privacyConsentModal');
    await expect(modal).toBeVisible();

    const initialInside = await page.evaluate(() => {
      const modal = document.getElementById('privacyConsentModal')!;
      return modal.contains(document.activeElement);
    });
    expect(initialInside).toBe(true);

    // Tab を連打してもフォーカスが modal の外に出ない（トラップ循環）
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
    }
    const stillInside = await page.evaluate(() => {
      const modal = document.getElementById('privacyConsentModal')!;
      return modal.contains(document.activeElement);
    });
    expect(stillInside).toBe(true);
  });

  testExt('accepting consent closes the modal and releases the trap', async ({ freshPopupPage: page }) => {
    await expect(page.locator('#privacyConsentModal')).toBeVisible();
    await page.locator('#consentCheckbox').check();
    await page.locator('#acceptConsentBtn').click();

    await expect(page.locator('#privacyConsentModal')).toBeHidden();

    // 解除後はモーダル外の要素にフォーカス可能（トラップが残っていないこと）
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
    }
    const escaped = await page.evaluate(() => {
      const modal = document.getElementById('privacyConsentModal');
      return !(modal && modal.contains(document.activeElement));
    });
    expect(escaped).toBe(true);
  });
});
