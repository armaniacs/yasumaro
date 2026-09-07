import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Mock } from 'vitest';
import { loadActiveTabStatus } from '../statusStore.js';
import * as statusChecker from '../statusChecker.js';
import { RecordingCache } from '../../background/__tests__/helpers/recordingCache.js';
import * as storageSavedUrls from '../../utils/storage/savedUrlRepository.js';

const mockGetAll = vi.hoisted(() => vi.fn());
vi.mock('../../utils/storage/SettingsRepository.js', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return { ...actual, settingsRepository: { getAll: mockGetAll, setAll: vi.fn(), getMany: vi.fn(), clearCache: vi.fn() }, SettingsRepository: class { getAll = mockGetAll; setAll = vi.fn(); getMany = vi.fn(); clearCache = vi.fn() } };
});

const mockTabsQuery = vi.hoisted(() => vi.fn());
const mockSendMessage = vi.hoisted(() => vi.fn());
global.chrome = {
  runtime: { sendMessage: mockSendMessage },
  i18n: { getMessage: vi.fn((key: string) => key) },
  tabs: { query: mockTabsQuery }
} as any;

// Wrap the real checkPageStatus so call counts can be asserted while the
// production logic still runs.
vi.mock('../statusChecker.js', async (importOriginal) => {
  const actual = await importOriginal() as typeof statusChecker;
  return { ...actual, checkPageStatus: vi.fn(actual.checkPageStatus) };
});

vi.mock('../../utils/storage/savedUrlRepository.js', () => ({
  getSavedUrlsWithTimestamps: vi.fn().mockResolvedValue(new Map())
}));

const checkPageStatusMock = statusChecker.checkPageStatus as unknown as Mock;

function mockStatusEnvironment(): void {
  mockSendMessage.mockResolvedValue({ success: false, cache: [] });
  mockGetAll.mockResolvedValue({
    domain_filter_mode: 'disabled',
    domain_whitelist: [],
    domain_blacklist: [],
    ublock_sources: []
  });
}

describe('statusStore.loadActiveTabStatus', () => {
  beforeEach(async () => {
    RecordingCache.resetCacheState();
    try {
      const { settingsRepository } = await import('../../utils/storage/SettingsRepository.js');
      settingsRepository.clearCache();
    } catch {}
    mockStatusEnvironment();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('fetches the active tab status exactly once through the single seam', async () => {
    mockTabsQuery.mockResolvedValue([{ url: 'https://example.com/page', id: 1 }]);

    const snapshot = await loadActiveTabStatus();

    expect(checkPageStatusMock).toHaveBeenCalledTimes(1);
    expect(checkPageStatusMock).toHaveBeenCalledWith('https://example.com/page');
    expect(snapshot.tab?.id).toBe(1);
    expect(snapshot.url).toBe('https://example.com/page');
    expect(snapshot.status).not.toBeNull();
    expect(snapshot.status?.domainFilter.allowed).toBe(true);
  });

  it('returns a null status snapshot when the active tab has no url', async () => {
    mockTabsQuery.mockResolvedValue([{ id: 2 }]);

    const snapshot = await loadActiveTabStatus();

    expect(checkPageStatusMock).not.toHaveBeenCalled();
    expect(snapshot.url).toBeNull();
    expect(snapshot.status).toBeNull();
  });

  it('returns a null status snapshot when no active tab exists', async () => {
    mockTabsQuery.mockResolvedValue([]);

    const snapshot = await loadActiveTabStatus();

    expect(snapshot.tab).toBeNull();
    expect(snapshot.url).toBeNull();
    expect(snapshot.status).toBeNull();
  });

  it('keeps url set but status null for special (chrome://) URLs', async () => {
    mockTabsQuery.mockResolvedValue([{ url: 'chrome://extensions/', id: 3 }]);

    const snapshot = await loadActiveTabStatus();

    expect(snapshot.url).toBe('chrome://extensions/');
    expect(snapshot.status).toBeNull();
  });
});
