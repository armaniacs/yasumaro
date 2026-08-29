import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTabEventHandlers } from '../tabEventHandlers.js';

describe('tabEventHandlers', () => {
  let mockTabCache: any;
  let mockAutoSavedBadgeTabs: any;
  let mockPrivacyCache: Map<string, any>;

  beforeEach(() => {
    mockTabCache = { remove: vi.fn() };
    mockAutoSavedBadgeTabs = {
      restore: vi.fn().mockResolvedValue(undefined),
      has: vi.fn().mockReturnValue(false),
      delete: vi.fn(),
    };
    mockPrivacyCache = new Map();
    vi.stubGlobal('chrome', {
      tabs: { get: vi.fn().mockResolvedValue({ url: 'https://example.com/page' }) },
      action: { setBadgeText: vi.fn(), setBadgeBackgroundColor: vi.fn() },
      storage: { session: { get: vi.fn(), set: vi.fn() } },
    });
  });

  it('handleTabRemoved restores and deletes', async () => {
    const handlers = createTabEventHandlers({ tabCache: mockTabCache, autoSavedBadgeTabs: mockAutoSavedBadgeTabs });
    await handlers.handleTabRemoved(5);
    expect(mockAutoSavedBadgeTabs.restore).toHaveBeenCalled();
    expect(mockTabCache.remove).toHaveBeenCalledWith(5);
    expect(mockAutoSavedBadgeTabs.delete).toHaveBeenCalledWith(5);
  });

  it('handleTabActivated with autoSaved badge shows ◎', async () => {
    mockAutoSavedBadgeTabs.has.mockReturnValue(true);
    const handlers = createTabEventHandlers({ tabCache: mockTabCache, autoSavedBadgeTabs: mockAutoSavedBadgeTabs });
    await handlers.handleTabActivated({ tabId: 42 });
    expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ text: '◎', tabId: 42 });
  });

  it('handleTabActivated without url clears badge', async () => {
    vi.stubGlobal('chrome', {
      ...chrome,
      tabs: { get: vi.fn().mockResolvedValue({ url: undefined }) },
      action: { setBadgeText: vi.fn(), setBadgeBackgroundColor: vi.fn() },
    });
    const handlers = createTabEventHandlers({ tabCache: mockTabCache, autoSavedBadgeTabs: mockAutoSavedBadgeTabs });
    await handlers.handleTabActivated({ tabId: 1 });
    expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ text: '' });
  });

  it('handleTabActivated with private url shows !', async () => {
    const { HeaderDetector } = await import('../../headerDetector.js');
    const url = 'https://private.com/page';
    const normalized = HeaderDetector.normalizeUrl(url);
    vi.stubGlobal('chrome', {
      ...chrome,
      tabs: { get: vi.fn().mockResolvedValue({ url }) },
      action: { setBadgeText: vi.fn(), setBadgeBackgroundColor: vi.fn() },
    });
    mockPrivacyCache.set(normalized, { isPrivate: true });
    const handlers = createTabEventHandlers({ tabCache: mockTabCache, autoSavedBadgeTabs: mockAutoSavedBadgeTabs, getPrivacyCache: () => mockPrivacyCache });
    await handlers.handleTabActivated({ tabId: 1 });
    expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ text: '!' });
  });

  it('handleTabActivated without getPrivacyCache uses null cache', async () => {
    const handlers = createTabEventHandlers({ tabCache: mockTabCache, autoSavedBadgeTabs: mockAutoSavedBadgeTabs });
    await handlers.handleTabActivated({ tabId: 1 });
    expect(chrome.action.setBadgeText).toHaveBeenCalled();
  });

  it('handleTabActivated handles error and clears badge', async () => {
    vi.stubGlobal('chrome', {
      ...chrome,
      tabs: { get: vi.fn().mockRejectedValue(new Error('fail')) },
      action: { setBadgeText: vi.fn(), setBadgeBackgroundColor: vi.fn() },
    });
    const handlers = createTabEventHandlers({ tabCache: mockTabCache, autoSavedBadgeTabs: mockAutoSavedBadgeTabs });
    await handlers.handleTabActivated({ tabId: 999 });
    expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ text: '' });
  });

  it('handleTabUpdated skips when status not complete', async () => {
    const handlers = createTabEventHandlers({ tabCache: mockTabCache, autoSavedBadgeTabs: mockAutoSavedBadgeTabs });
    await handlers.handleTabUpdated(1, { status: 'loading' }, { url: 'https://example.com' });
    expect(mockAutoSavedBadgeTabs.delete).not.toHaveBeenCalled();
  });

  it('handleTabUpdated skips when url missing', async () => {
    const handlers = createTabEventHandlers({ tabCache: mockTabCache, autoSavedBadgeTabs: mockAutoSavedBadgeTabs });
    await handlers.handleTabUpdated(1, { status: 'complete' }, {});
    expect(mockAutoSavedBadgeTabs.delete).not.toHaveBeenCalled();
  });

  it('handleTabUpdated with private url shows ! with tabId', async () => {
    const { HeaderDetector } = await import('../../headerDetector.js');
    const url = 'https://private.com/page2';
    const normalized = HeaderDetector.normalizeUrl(url);
    mockPrivacyCache.set(normalized, { isPrivate: true });
    const handlers = createTabEventHandlers({ tabCache: mockTabCache, autoSavedBadgeTabs: mockAutoSavedBadgeTabs, getPrivacyCache: () => mockPrivacyCache });
    await handlers.handleTabUpdated(1, { status: 'complete' }, { url });
    expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ text: '!', tabId: 1 });
  });

  it('handleTabUpdated without getPrivacyCache', async () => {
    const handlers = createTabEventHandlers({ tabCache: mockTabCache, autoSavedBadgeTabs: mockAutoSavedBadgeTabs });
    await handlers.handleTabUpdated(1, { status: 'complete' }, { url: 'https://example.com' });
    expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ text: '', tabId: 1 });
  });

  it('handleTabUpdated with non-private url clears badge', async () => {
    const { HeaderDetector } = await import('../../headerDetector.js');
    const url = 'https://public.com/page';
    const normalized = HeaderDetector.normalizeUrl(url);
    mockPrivacyCache.set(normalized, { isPrivate: false });
    const handlers = createTabEventHandlers({ tabCache: mockTabCache, autoSavedBadgeTabs: mockAutoSavedBadgeTabs, getPrivacyCache: () => mockPrivacyCache });
    await handlers.handleTabUpdated(1, { status: 'complete' }, { url });
    expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ text: '', tabId: 1 });
  });
});
