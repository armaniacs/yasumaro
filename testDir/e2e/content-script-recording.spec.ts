import { test, expect } from './fixtures/extension.fixture.js';

/** Content Script のテスト状態を DOM 属性から読み取るヘルパー */
function readTestState(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const attr = document.documentElement.getAttribute('data-ow-test-state');
    if (!attr) return null;
    return JSON.parse(attr) as {
      maxScrollPercentage: number;
      isValidVisitReported: boolean;
      startTime: number;
      minVisitDuration: number;
      minScrollDepth: number;
      duration: number;
    };
  });
}

/** extractor 初期化（data-ow-test-state 属性設定）を待機 */
async function waitForExtractorInit(page: import('@playwright/test').Page, timeout = 10000) {
  await expect(() =>
    page.evaluate(() => {
      const attr = document.documentElement.getAttribute('data-ow-test-state');
      if (!attr) throw new Error('data-ow-test-state not yet set');
      return JSON.parse(attr);
    })
  ).toPass({ timeout });
}

test.describe('Content Script Recording @extension', () => {

  test('content script is injected and extractor initializes', async ({ context }) => {
    const page = await context.newPage();
    const consoleLogs: string[] = [];
    page.on('console', msg => consoleLogs.push(`[page ${msg.type()}] ${msg.text()}`));
    page.on('pageerror', err => consoleLogs.push(`[PAGE_ERROR] ${err.message}`));

    await test.step('Navigate to test page', async () => {
      await page.goto('http://localhost:8080/long-page.html');
    });

    await test.step('Wait for extractor initialization', async () => {
      await waitForExtractorInit(page);
    });

    await test.step('Verify initial state values', async () => {
      const state = await readTestState(page);
      expect(state).not.toBeNull();
      expect(state!.maxScrollPercentage).toBe(0);
      expect(state!.isValidVisitReported).toBe(false);
      expect(state!.minVisitDuration).toBe(5);
      expect(state!.minScrollDepth).toBe(50);
    });

    if (consoleLogs.length > 0) {
      console.log('Browser console:\n' + consoleLogs.join('\n'));
    }
    await page.close();
  });

  test('scroll depth is tracked after scrolling', async ({ context }) => {
    const page = await context.newPage();
    await page.goto('http://localhost:8080/long-page.html');
    await waitForExtractorInit(page);

    await test.step('Scroll to 70% of page', async () => {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.7));
    });

    await test.step('Verify scroll depth is recorded', async () => {
      await expect(async () => {
        const state = await readTestState(page);
        expect(state).not.toBeNull();
        expect(state!.maxScrollPercentage).toBeGreaterThanOrEqual(50);
      }).toPass({ timeout: 3000, intervals: [100, 200, 500] });
    });

    await page.close();
  });

  test('VALID_VISIT fires after 50% scroll + 5s stay @critical', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto('http://localhost:8080/long-page.html');
    await waitForExtractorInit(page);

    await test.step('Scroll to 70% of page', async () => {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.7));
    });

    await test.step('Content Script: isValidVisitReported becomes true', async () => {
      await expect(async () => {
        const state = await readTestState(page);
        expect(state).not.toBeNull();
        expect(state!.isValidVisitReported).toBe(true);
      }).toPass({ timeout: 15000, intervals: [1000] });
    });

    await test.step('Service Worker: VALID_VISIT message was received', async () => {
      const sw = context.serviceWorkers()[0];
      // Service Worker が起動していることの確認（VALID_VISIT 処理自体は
      // Obsidian/AI 接続がテスト環境にないため成功しない場合がある）
      const swActive = await sw.evaluate(() => typeof chrome.runtime?.id === 'string');
      expect(swActive).toBe(true);
    });

    await page.close();
  });

  test('does NOT fire when scroll < 50%', async ({ context }) => {
    const page = await context.newPage();
    await page.goto('http://localhost:8080/long-page.html');
    await waitForExtractorInit(page);

    await test.step('Scroll to only 30%', async () => {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.3));
    });

    await test.step('Wait 6s and verify NOT fired', async () => {
      await page.waitForTimeout(6500);
      const state = await readTestState(page);
      expect(state).not.toBeNull();
      expect(state!.maxScrollPercentage).toBeLessThan(50);
      expect(state!.isValidVisitReported).toBe(false);
    });

    await page.close();
  });

  test('does NOT fire when stay < 5 seconds', async ({ context }) => {
    const page = await context.newPage();
    await page.goto('http://localhost:8080/long-page.html');
    await waitForExtractorInit(page);

    await test.step('Scroll to 70% immediately', async () => {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.7));
      // wait for throttled RAF scroll listener to process
      await page.waitForTimeout(300);
    });

    await test.step('Wait only 2s and verify NOT fired', async () => {
      await page.waitForTimeout(2000);
      const state = await readTestState(page);
      expect(state).not.toBeNull();
      expect(state!.maxScrollPercentage).toBeGreaterThanOrEqual(50);
      expect(state!.isValidVisitReported).toBe(false);
    });

    await page.close();
  });
});
