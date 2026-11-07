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
    const response = (await sendMessage(page, 'PREVIEW_RECORD', {
      url: 'https://example.com/wasm-init-check',
      title: 'WASM init check',
      content: 'contact me at wasmcheck@example.com for details',
    })) as {
      success?: boolean;
      skipped?: boolean;
      maskedCount?: number;
      error?: unknown;
    } | null | undefined;

    // Positive anchors (PBI 2026-11-08-09: the fixed 500ms settle is gone).
    // PREVIEW_RECORD resolves only after the pipeline ran the PII stage to
    // completion: the WASM availability probe and the sanitize call both run
    // inside pipeline.record, and the fallback warning (if any) is emitted
    // before sendResponse. So a resolved success with masked output proves
    // the absence assertion below is not vacuous - the sanitizer
    // demonstrably ran on WASM-coverable input.
    expect(
      response?.success,
      `PREVIEW_RECORD must succeed for the WASM guard to mean anything; got ${JSON.stringify(response)}`,
    ).toBe(true);
    expect(
      response?.skipped,
      'a skipped preview never runs the sanitizer; the guard would pass by construction',
    ).not.toBe(true);
    expect(
      typeof response?.maskedCount === 'number' ? response.maskedCount : -1,
      `PII stage must mask the email in the probe content; got ${JSON.stringify(response)}`,
    ).toBeGreaterThanOrEqual(1);

    // Delivery drain, not a wait: the warning (if any) precedes sendResponse
    // on the same CDP session, so a service-worker round-trip ordered after
    // the resolved response guarantees any earlier console event has already
    // been dispatched to consoleMessages. No duration is hoped for - under
    // load this costs one round-trip, not a guessed constant.
    await serviceWorker!.evaluate(async () => {
      await chrome.storage.local.get('sanitization_logs');
    });

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
