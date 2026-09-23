/**
 * regenerateContentFetcher.test.ts — the re-extraction seam (PBI 2026-09-22-04).
 *
 * Pins: validateUrl(blockLocalhost) BEFORE createTab (SSRF position),
 * inactive fresh tab, cleanseMode payload propagation, teardown on every
 * path, injection-race retry (200ms × 10), tab_load_timeout, invalid-reply
 * rejection. All chrome access is injected — no global stubs.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RegenerateContentFetcher, type RegenerateContentFetcherDeps } from '../regenerateContentFetcher.js';

type UpdateCb = (tabId: number, info: { status?: string }) => void;

function makeDeps(overrides: Partial<RegenerateContentFetcherDeps> = {}) {
  const listeners = new Set<UpdateCb>();
  const deps: RegenerateContentFetcherDeps & { listeners: Set<UpdateCb> } = {
    createTab: vi.fn().mockResolvedValue({ id: 101 }),
    removeTab: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn().mockResolvedValue({ content: 'extracted' }),
    getTab: vi.fn().mockResolvedValue({ status: 'complete' }),
    onUpdated: {
      addListener: vi.fn((fn: UpdateCb) => { listeners.add(fn); }),
      removeListener: vi.fn((fn: UpdateCb) => { listeners.delete(fn); }),
    },
    listeners,
    ...overrides,
  };
  return deps;
}

describe('RegenerateContentFetcher', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.useRealTimers());

  it('throws before createTab for localhost urls (CRITICAL: SSRF/blockLocalhost)', async () => {
    const deps = makeDeps();
    await expect(
      new RegenerateContentFetcher(deps).fetchExtracted('http://localhost:8080/x', 'current'),
    ).rejects.toThrow();
    expect(deps.createTab).not.toHaveBeenCalled();
  });

  it('creates an inactive tab, sends cleanseMode, closes the tab on success (CRITICAL: propagation)', async () => {
    const deps = makeDeps();
    const reply = await new RegenerateContentFetcher(deps)
      .fetchExtracted('https://example.com/page', 'looser');
    expect(reply).toMatchObject({ content: 'extracted' });
    expect(deps.createTab).toHaveBeenCalledWith({ url: 'https://example.com/page', active: false });
    expect(deps.sendMessage).toHaveBeenCalledWith(101, { type: 'GET_CONTENT', payload: { cleanseMode: 'looser' } });
    expect(deps.removeTab).toHaveBeenCalledWith(101);
    expect(deps.onUpdated.removeListener).toHaveBeenCalled();
  });

  it('completes via the onUpdated listener when the tab starts loading', async () => {
    const deps = makeDeps({ getTab: vi.fn().mockResolvedValue({ status: 'loading' }) });
    const pending = new RegenerateContentFetcher(deps).fetchExtracted('https://example.com', 'current');
    // Emit complete asynchronously so the listener path (not the getTab
    // pre-check) is the one that settles the wait.
    await new Promise((r) => setTimeout(r, 0));
    expect(deps.listeners.size).toBe(1);
    for (const fn of deps.listeners) fn(101, { status: 'complete' });
    await expect(pending).resolves.toMatchObject({ content: 'extracted' });
    expect(deps.listeners.size).toBe(0); // listener removed on settle
  });

  it('throws tab_create_failed when the created tab has no id', async () => {
    const deps = makeDeps({ createTab: vi.fn().mockResolvedValue({}) });
    await expect(
      new RegenerateContentFetcher(deps).fetchExtracted('https://example.com', 'current'),
    ).rejects.toThrow('tab_create_failed');
  });

  it('removes the tab in finally even when send fails', async () => {
    const deps = makeDeps({ sendMessage: vi.fn().mockRejectedValue(new Error('boom')) });
    await expect(
      new RegenerateContentFetcher(deps).fetchExtracted('https://example.com', 'current'),
    ).rejects.toThrow('get_content_send_failed');
    expect(deps.removeTab).toHaveBeenCalledWith(101);
  });

  it('swallows removeTab teardown errors (user-closed race)', async () => {
    const deps = makeDeps({ removeTab: vi.fn().mockRejectedValue(new Error('No tab with id')) });
    const reply = await new RegenerateContentFetcher(deps)
      .fetchExtracted('https://example.com', 'current');
    expect(reply).toMatchObject({ content: 'extracted' });
  });

  it('rejects invalid replies (missing content string)', async () => {
    const deps = makeDeps({ sendMessage: vi.fn().mockResolvedValue({ content: 42 }) });
    await expect(
      new RegenerateContentFetcher(deps).fetchExtracted('https://example.com', 'current'),
    ).rejects.toThrow('get_content_invalid_reply');
    expect(deps.removeTab).toHaveBeenCalledWith(101);
  });

  it('retries injection races then succeeds', async () => {
    const deps = makeDeps();
    (deps.sendMessage as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('Could not establish connection. Receiving end does not exist.'))
      .mockRejectedValueOnce(new Error('The receiving end does not exist.'))
      .mockResolvedValue({ content: 'late' });
    const reply = await new RegenerateContentFetcher(deps)
      .fetchExtracted('https://example.com', 'current');
    expect(reply).toMatchObject({ content: 'late' });
    expect(deps.sendMessage).toHaveBeenCalledTimes(3);
  });

  it('gives up after 10 attempts with get_content_send_failed', async () => {
    vi.useFakeTimers();
    const deps = makeDeps({
      sendMessage: vi.fn().mockRejectedValue(new Error('Could not establish connection')),
    });
    const pending = new RegenerateContentFetcher(deps).fetchExtracted('https://example.com', 'current');
    // Synchronously mark the promise handled: the fake timers reject it
    // mid-advance, and a late handler attachment trips Node's
    // unhandled-rejection tracking (vitest "Unhandled Errors").
    void pending.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(10 * 200 + 1000);
    await expect(pending).rejects.toThrow(/get_content_send_failed/);
    expect(deps.sendMessage).toHaveBeenCalledTimes(10);
    expect(deps.removeTab).toHaveBeenCalledWith(101);
  });

  it('non-race send errors do not retry', async () => {
    const deps = makeDeps({
      sendMessage: vi.fn().mockRejectedValue(new Error('Extension context invalidated')),
    });
    await expect(
      new RegenerateContentFetcher(deps).fetchExtracted('https://example.com', 'current'),
    ).rejects.toThrow(/get_content_send_failed/);
    expect(deps.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('tab_load_timeout after 10s when the tab never completes', async () => {
    vi.useFakeTimers();
    const deps = makeDeps({ getTab: vi.fn().mockResolvedValue({ status: 'loading' }) });
    const pending = new RegenerateContentFetcher(deps).fetchExtracted('https://example.com', 'current');
    // Synchronously mark the promise handled (same race as above).
    void pending.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(pending).rejects.toThrow('tab_load_timeout');
    expect(deps.removeTab).toHaveBeenCalledWith(101);
    expect(deps.listeners.size).toBe(0); // listener cleaned up
  });

  it('tab_get_failed rejects the wait (getTab error path)', async () => {
    const deps = makeDeps({ getTab: vi.fn().mockRejectedValue(new Error('no such tab')) });
    await expect(
      new RegenerateContentFetcher(deps).fetchExtracted('https://example.com', 'current'),
    ).rejects.toThrow('tab_get_failed: Error: no such tab');
    expect(deps.removeTab).toHaveBeenCalledWith(101);
  });
});
