/**
 * offscreen-listener-registration.test.ts
 *
 * The message listener must be registered while the module is still being
 * evaluated — not after an awaited promise (PBI 2026-09-16-02).
 *
 * chrome.offscreen.createDocument() resolves as soon as the document exists,
 * which tells the sender nothing about whether the script inside it has run.
 * When registration was deferred behind the OPFS worker factory's dynamic
 * import, the document was live but had no receiver, and messages sent into
 * that window came back as "Could not establish connection. Receiving end does
 * not exist." — measured ~2ms after createDocument() resolved, with the same
 * document accepting messages normally ~50ms later.
 *
 * A synchronous registration closes the window: the message is queued by the
 * handler (which awaits the factory itself) instead of being refused.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../sqliteEngineHost.js', () => ({
  engine: {
    init: vi.fn().mockResolvedValue(true),
    ensureBackend: vi.fn().mockResolvedValue(undefined),
    getBackend: vi.fn().mockResolvedValue({
      healthCheck: vi.fn().mockResolvedValue({ success: true }),
    }),
    resetForTesting: vi.fn(),
  },
}));

vi.mock('../recordsRepo.js', () => ({
  insert: vi.fn(), insertBatch: vi.fn(), query: vi.fn(), update: vi.fn(),
  hardDelete: vi.fn(), toggleStar: vi.fn(), getCount: vi.fn(),
  getStatus: vi.fn(), clearAll: vi.fn(), serialize: vi.fn(),
}));

describe('offscreen listener registration timing', () => {
  let addListener: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    addListener = vi.fn();
    (globalThis as unknown as Record<string, unknown>).chrome = {
      runtime: {
        id: 'test-extension-id',
        onMessage: { addListener },
      },
    };
  });

  afterEach(() => {
    delete (globalThis as unknown as Record<string, unknown>).chrome;
    vi.resetModules();
  });

  it('registers the listener during module evaluation, before any await resolves', async () => {
    // Importing the module runs its top level. If registration were deferred
    // behind a promise, addListener would still be uncalled at this point —
    // which is exactly the window where messages were refused.
    await import('../offscreen.js');

    expect(addListener).toHaveBeenCalledTimes(1);
    expect(addListener).toHaveBeenCalledWith(expect.any(Function));
  });

  it('registers the handler exported as handleOffscreenMessage', async () => {
    const mod = await import('../offscreen.js');

    expect(addListener).toHaveBeenCalledWith(mod.handleOffscreenMessage);
  });

  it('skips registration when the runtime has no onMessage.addListener', async () => {
    (globalThis as unknown as Record<string, unknown>).chrome = {
      runtime: { id: 'test-extension-id', onMessage: {} },
    };

    // Must not throw: some test/host environments stub chrome minimally.
    await expect(import('../offscreen.js')).resolves.toBeDefined();
    expect(addListener).not.toHaveBeenCalled();
  });
});
