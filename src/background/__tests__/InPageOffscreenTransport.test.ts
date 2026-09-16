/**
 * InPageOffscreenTransport.test.ts
 * Firefox container: the background event page invokes handleOffscreenMessage
 * in-process. This suite pins the end-to-end contract that the offscreen gate
 * must ACCEPT what this transport actually dispatches — the rejection paths are
 * covered in offscreen-security-comprehensive.test.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { InPageOffscreenTransport } from '../InPageOffscreenTransport.js';
import { authorizeSqliteSender } from '../../utils/extensionOrigin.js';

const EXTENSION_ID = 'test-extension-id';

function setupChrome() {
  (globalThis as unknown as Record<string, unknown>).chrome = {
    runtime: {
      id: EXTENSION_ID,
      getURL: (path: string) => `moz-extension://abc-123/${path}`,
    },
  };
}

describe('InPageOffscreenTransport', () => {
  beforeEach(() => {
    setupChrome();
  });

  afterEach(() => {
    delete (globalThis as unknown as Record<string, unknown>).chrome;
    vi.restoreAllMocks();
  });

  /**
   * The regression this pins: the transport used to dispatch the opaque
   * authorization proof as the sender. The proof carries no `id`, so the
   * offscreen gate re-authorized it, found `sender.id !== chrome.runtime.id`
   * and rejected every SQLite call on Firefox as an external extension.
   */
  it('dispatches a sender the offscreen gate authorizes', async () => {
    const seen: Array<{ id?: string; url?: string }> = [];
    const handler = vi.fn((_message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (r: unknown) => void) => {
      seen.push({ id: sender.id, url: sender.url });
      const auth = authorizeSqliteSender(sender, chrome.runtime.id);
      if (!auth.ok) {
        sendResponse({ success: false, error: `Forbidden: ${auth.reason}` });
        return true;
      }
      sendResponse({ success: true, data: { rows: [], total: 0 } });
      return true;
    });

    const transport = new InPageOffscreenTransport(handler);
    const result = await transport.msgOffscreen('SQLITE_QUERY', { limit: 10, offset: 0 });

    expect(result).toEqual({ success: true, data: { rows: [], total: 0 } });
    expect(seen[0]?.id).toBe(EXTENSION_ID);
    expect(seen[0]?.url).toBe('moz-extension://abc-123/background.js');
  });

  it('surfaces a rejection from the offscreen gate as an error', async () => {
    const handler = vi.fn((_message: unknown, _sender: chrome.runtime.MessageSender, sendResponse: (r: unknown) => void) => {
      sendResponse({ success: false, error: 'Forbidden: external-extension' });
      return true;
    });

    const transport = new InPageOffscreenTransport(handler);

    await expect(transport.msgOffscreen('SQLITE_QUERY', {})).rejects.toThrow('external-extension');
  });

  it('fails when the handler does not accept the message', async () => {
    const handler = vi.fn(() => false);
    const transport = new InPageOffscreenTransport(handler);

    await expect(transport.msgOffscreen('SQLITE_QUERY', {})).rejects.toThrow(/did not accept/);
  });
});
