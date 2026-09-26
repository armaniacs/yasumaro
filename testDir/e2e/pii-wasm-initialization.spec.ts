/**
 * pii-wasm-initialization.spec.ts
 *
 * Verifies that the PII sanitizer's WASM core actually initializes inside
 * the real built extension's service worker, not just that PII masking
 * still works (sanitizePiiHybrid falls back to TS regex transparently on
 * WASM failure, so a black-box check of masking results alone cannot tell
 * the two paths apart — see piiSanitizeHybrid.ts's module doc).
 *
 * Context: an earlier build had the WASM binary silently inlined as a
 * `data:` URI by Vite (background.js builds as a single-file IIFE), which
 * the extension CSP (`connect-src 'self'`) blocks with NetworkError — WASM
 * PII masking was effectively dead code in every real build until this was
 * caught by inspecting the built background.js directly. This spec is the
 * regression guard: it drives an actual PII-masking round trip through the
 * running service worker and asserts the WASM-unavailable warning log
 * (added in piiSanitizeHybrid.ts's isWasmAvailable()) never fires.
 *
 * Run with: npx playwright test --config testDir/playwright.config.ts pii-wasm-initialization
 */

import { testInteraction, expect } from './fixtures/popup.fixture.js';

const test = testInteraction;

if (!process.env.CI && !process.env.DISPLAY) {
  test.skip(true, 'requires headed Chrome with display (MV3 service worker)');
}

function sendMessage(
  page: import('@playwright/test').Page,
  type: string,
  payload?: unknown,
): Promise<unknown> {
  return page.evaluate(
    async ({ type, payload }) => {
      return new Promise((resolve) => {
        try {
          chrome.runtime.sendMessage({ type, payload } as any, (response) => {
            if (chrome.runtime.lastError) {
              resolve({ __lastError: chrome.runtime.lastError.message });
              return;
            }
            resolve(response);
          });
        } catch (err) {
          resolve({ __thrown: String(err) });
        }
      });
    },
    { type, payload },
  );
}

test.describe('PII sanitizer WASM initialization @interaction @extension', () => {
  test('PREVIEW_RECORD with PII content never logs the WASM-unavailable fallback warning', async ({
    context,
    popupPage: page,
  }) => {
    const serviceWorker = context.serviceWorkers()[0];
    expect(serviceWorker).toBeTruthy();

    const consoleMessages: string[] = [];
    serviceWorker!.on('console', (msg) => {
      consoleMessages.push(msg.text());
    });

    // Trigger a real privacy-pipeline pass containing WASM-coverable PII
    // (email is one of the 21 patterns WASM now covers end-to-end).
    await sendMessage(page, 'PREVIEW_RECORD', {
      url: 'https://example.com/wasm-init-check',
      title: 'WASM init check',
      content: 'contact me at wasmcheck@example.com for details',
    });

    // The warning is written by the service worker before PREVIEW_RECORD
    // resolves, so the pipeline has already run by now. What is still in
    // flight is the console EVENT's delivery back to this process, and the
    // successful path emits nothing to the service worker's console (the
    // logger writes to chrome.storage; its console branch is the no-chrome
    // offscreen path). There is therefore no condition to await: the only
    // observable is an absence, and polling for the warning would make this
    // assertion pass by construction. The bounded settle below covers the
    // event-delivery window and nothing else.
    // eslint-disable-next-line local/no-fixed-wait -- negative assertion with no awaitable condition; see comment
    await page.waitForTimeout(500);

    const wasmFallbackWarning = consoleMessages.find((m) =>
      m.includes('PII WASM module unavailable') || m.includes('PII WASM sanitize call failed')
    );
    expect(
      wasmFallbackWarning,
      `Expected no WASM-fallback warning, but found: ${wasmFallbackWarning}. This means the WASM PII ` +
        'sanitizer failed to initialize in the real built extension and every call is silently falling back ' +
        'to TS-only — check the CSP and the wasm asset path (public/wasm/pii_sanitizer_bg.wasm via ' +
        'chrome.runtime.getURL).'
    ).toBeUndefined();
  });
});
