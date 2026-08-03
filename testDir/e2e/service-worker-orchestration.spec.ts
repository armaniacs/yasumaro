import { testInteraction, expect } from './fixtures/popup.fixture.js';

/**
 * service-worker-orchestration.spec.ts
 *
 * E2E tests for the extension's service-worker message-routing layer
 * (`src/background/service-worker.ts`). These exercise the orchestration
 * paths that are glue-heavy and therefore not ideal for unit tests: the
 * registered message handlers and how the SW routes requests to them.
 *
 * Messages are sent from the popup (an extension page) context, where
 * `chrome.runtime.sendMessage` reliably routes to the service worker
 * (self-send from within the SW does not invoke its own onMessage in MV3).
 *
 * Run with: npx playwright test --config testDir/playwright.config.ts --project=interaction
 */

const test = testInteraction;

/** Send a message to the service worker from the popup page and resolve its response. */
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

test.describe('Service Worker orchestration @interaction', () => {
  test('PING responds {success:true} through the message registry', async ({ popupPage: page }) => {
    const response = await sendMessage(page, 'PING');
    expect(response).toEqual({ success: true });
  });

  test('GET_PRIVACY_CACHE resolves to a {success:true, cache:[]} envelope', async ({ popupPage: page }) => {
    const response = await sendMessage(page, 'GET_PRIVACY_CACHE');

    // The envelope is always shaped { success:true, cache: array } whether or
    // not privacy-cache entries were populated at SW startup.
    expect(response).toBeTruthy();
    const res = response as { success?: boolean; cache?: unknown[] };
    expect(res.success).toBe(true);
    expect(Array.isArray(res.cache)).toBe(true);
  });

  test('CHECK_DOMAIN is rejected for a non-content-script sender (security guard)', async ({ popupPage: page }) => {
    // CHECK_DOMAIN is a CONTENT_SCRIPT_ONLY type. A popup (extension page)
    // sender is not a valid content-script sender, so the SW must reject with
    // INVALID_SENDER_ERROR rather than invoke the handler.
    const response = await sendMessage(page, 'CHECK_DOMAIN');

    expect(response).toEqual({ success: false, error: 'Invalid sender' });
  });

  test('unknown message type does not crash the SW', async ({ popupPage: page, context }) => {
    const response = await sendMessage(page, 'NOT_A_REAL_MESSAGE_TYPE');

    // The registry rejects unknown types (no response or a lastError), but the
    // service worker must remain alive and responsive afterwards.
    const sw = context.serviceWorkers()[0];
    expect(await sw.evaluate(() => typeof chrome.runtime?.id)).toBe('string');
    expect(response).toBeTruthy();
  });
});
