import { testInteraction, expect } from './fixtures/popup.fixture.js';
import { CURRENT_PROTOCOL_VERSION } from '../../src/messaging/protocol.js';

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
 *
 * Tagged @interaction (extension-context tests) AND @extension so the CI e2e
 * run (`--grep @extension`, which ANDs with the project grep) executes them —
 * same pattern as pii-wasm-initialization.spec.ts. Without @extension these
 * tests never ran on CI.
 */

const test = testInteraction;

/** Send a message to the service worker from the popup page and resolve its response. */
function sendMessage(
  page: import('@playwright/test').Page,
  type: string,
  payload?: unknown,
  { protocolVersion }: { protocolVersion?: number } = {},
): Promise<unknown> {
  const message: Record<string, unknown> = { type, payload };
  if (protocolVersion !== undefined) {
    message.protocolVersion = protocolVersion;
  }
  return page.evaluate(
    async (msg) => {
      return new Promise((resolve) => {
        try {
          chrome.runtime.sendMessage(msg as any, (response) => {
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
    message,
  );
}

test.describe('Service Worker orchestration @interaction @extension', () => {
  test('PING responds {success:true} through the message registry', async ({ popupPage: page }) => {
    const response = await sendMessage(page, 'PING', undefined, {
      protocolVersion: CURRENT_PROTOCOL_VERSION,
    });
    expect(response).toEqual({ success: true });
  });

  test('legacy sender without protocolVersion is accepted with a deprecation flag', async ({
    popupPage: page,
  }) => {
    // Envelope policy (messageHandler.ts): a message without protocolVersion
    // is treated as a stale-update-cycle legacy sender — accepted, but the
    // response carries `deprecated: true` so callers can see the mismatch.
    const response = await sendMessage(page, 'PING');
    expect(response).toEqual({ success: true, deprecated: true });
  });

  test('GET_PRIVACY_CACHE resolves to a {success:true, cache:[]} envelope', async ({ popupPage: page }) => {
    const response = await sendMessage(page, 'GET_PRIVACY_CACHE', undefined, {
      protocolVersion: CURRENT_PROTOCOL_VERSION,
    });

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
    const response = await sendMessage(page, 'CHECK_DOMAIN', undefined, {
      protocolVersion: CURRENT_PROTOCOL_VERSION,
    });

    expect(response).toEqual({ success: false, error: 'Invalid sender' });
  });

  test('unknown message type does not crash the SW', async ({ popupPage: page, context }) => {
    const response = await sendMessage(page, 'NOT_A_REAL_MESSAGE_TYPE', undefined, {
      protocolVersion: CURRENT_PROTOCOL_VERSION,
    });

    // The registry rejects unknown types (no response or a lastError), but the
    // service worker must remain alive and responsive afterwards.
    const sw = context.serviceWorkers()[0];
    expect(await sw.evaluate(() => typeof chrome.runtime?.id)).toBe('string');
    expect(response).toBeTruthy();
  });
});
