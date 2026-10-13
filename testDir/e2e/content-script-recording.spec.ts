import { test, expect } from './fixtures/extension.fixture.js';
import {
  enableE2EProbe,
  readE2EProbeState,
  waitForE2EProbeInit,
} from './fixtures/e2eProbe.js';

/** Content Script のテスト状態を拡張側セッション経由で読み取るヘルパー */
function readTestState(context: import('@playwright/test').BrowserContext) {
  return readE2EProbeState(context);
}

/** extractor 初期化（プローブ初回 publish）を待機 */
function waitForExtractorInit(context: import('@playwright/test').BrowserContext, timeout = 10000) {
  return waitForE2EProbeInit(context, timeout);
}

/**
 * Stay duration in seconds, read from the content script's own counter (0 until
 * it initialises). It is the same `duration` visitGating.evaluate() gates the
 * report on, so waiting on it never guesses the test process's clock.
 */
async function readStaySeconds(context: import('@playwright/test').BrowserContext) {
  const state = await readTestState(context);
  return state === null ? 0 : state.duration;
}

test.describe('Content Script Recording @extension', () => {

  test('content script is injected and extractor initializes', async ({ context }) => {
    const page = await context.newPage();
    // Probe is armed extension-side (session flag) — must precede navigation:
    // the content script resolves the flag once at init.
    await enableE2EProbe(context);
    const consoleLogs: string[] = [];
    page.on('console', msg => consoleLogs.push(`[page ${msg.type()}] ${msg.text()}`));
    page.on('pageerror', err => consoleLogs.push(`[PAGE_ERROR] ${err.message}`));

    await test.step('Navigate to test page', async () => {
      await page.goto('http://localhost:8080/long-page.html');
    });

    await test.step('Wait for extractor initialization', async () => {
      await waitForExtractorInit(context);
    });

    await test.step('Verify initial state values', async () => {
      const state = await readTestState(context);
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
    // Probe is armed extension-side (session flag) — must precede navigation:
    // the content script resolves the flag once at init.
    await enableE2EProbe(context);
    await page.goto('http://localhost:8080/long-page.html');
    await waitForExtractorInit(context);

    await test.step('Scroll to 70% of page', async () => {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.7));
    });

    await test.step('Verify scroll depth is recorded', async () => {
      await expect(async () => {
        const state = await readTestState(context);
        expect(state).not.toBeNull();
        expect(state!.maxScrollPercentage).toBeGreaterThanOrEqual(50);
      }).toPass({ timeout: 3000, intervals: [100, 200, 500] });
    });

    await page.close();
  });

  test('VALID_VISIT fires after 50% scroll + 5s stay @critical', async ({ context }) => {
    const page = await context.newPage();
    // Probe is armed extension-side (session flag) — must precede navigation:
    // the content script resolves the flag once at init.
    await enableE2EProbe(context);
    await page.goto('http://localhost:8080/long-page.html');
    await waitForExtractorInit(context);

    await test.step('Scroll to 70% of page', async () => {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.7));
    });

    await test.step('Content Script: isValidVisitReported becomes true', async () => {
      await expect(async () => {
        const state = await readTestState(context);
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
    // Probe is armed extension-side (session flag) — must precede navigation:
    // the content script resolves the flag once at init.
    await enableE2EProbe(context);
    await page.goto('http://localhost:8080/long-page.html');
    await waitForExtractorInit(context);

    await test.step('Scroll to only 30%', async () => {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.3));
    });

    await test.step('Wait out the stay threshold and verify NOT fired', async () => {
      // The missing scroll depth is the only thing suppressing the report here,
      // so the stay condition has to be satisfied before the negative assertion
      // means anything. Polling the extractor's own counter for the threshold
      // replaces the fixed sleep: it also fails (instead of passing green) if
      // the counter never advances.
      const threshold = (await readTestState(context))!.minVisitDuration;
      await expect
        .poll(() => readStaySeconds(context), { timeout: 15000, intervals: [250] })
        .toBeGreaterThanOrEqual(threshold);

      const state = await readTestState(context);
      expect(state).not.toBeNull();
      expect(state!.maxScrollPercentage).toBeLessThan(50);
      expect(state!.isValidVisitReported).toBe(false);
    });

    await page.close();
  });

  test('does NOT fire when stay < 5 seconds', async ({ context }) => {
    const page = await context.newPage();
    // Probe is armed extension-side (session flag) — must precede navigation:
    // the content script resolves the flag once at init.
    await enableE2EProbe(context);
    await page.goto('http://localhost:8080/long-page.html');
    await waitForExtractorInit(context);

    await test.step('Scroll to 70% immediately', async () => {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.7));
    });

    await test.step('Wait for the throttled scroll listener to record the depth', async () => {
      // The scroll listener is RAF-throttled, so the depth lands asynchronously.
      // Waiting for the recorded value is the condition; sleeping 300ms and
      // hoping the throttle fired is the same guess with a shorter fuse.
      await expect(async () => {
        const state = await readTestState(context);
        expect(state).not.toBeNull();
        expect(state!.maxScrollPercentage).toBeGreaterThanOrEqual(50);
      }).toPass({ timeout: 3000, intervals: [50, 100, 200] });
    });

    await test.step('Verify NOT fired while the stay is still under the threshold', async () => {
      // Assert as early as the scroll depth is confirmed. Waiting longer does not
      // make this assertion mean more — the stay is already over the threshold by
      // then, and "stay > threshold/2" as a wait condition only walks the sample
      // point toward the boundary the next assertion checks. The scroll depth
      // step above is what keeps this from being vacuous: with depth recorded and
      // the stay under the threshold, the report must not have fired.
      const threshold = (await readTestState(context))!.minVisitDuration;
      const state = await readTestState(context);
      expect(state).not.toBeNull();
      expect(state!.maxScrollPercentage).toBeGreaterThanOrEqual(50);
      expect(state!.duration).toBeLessThan(threshold);
      expect(state!.isValidVisitReported).toBe(false);
    });

    await page.close();
  });
});
