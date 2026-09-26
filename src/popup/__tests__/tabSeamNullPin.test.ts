// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetCurrentTab = vi.hoisted(() => vi.fn());
const mockGetMessage = vi.hoisted(() => vi.fn((key: string) => key));
const mockGetAll = vi.hoisted(() => vi.fn());
const mockCheckPageStatus = vi.hoisted(() => vi.fn());

vi.mock('../tabUtils.js', () => ({
  getCurrentTab: mockGetCurrentTab,
  getActiveTabUrl: vi.fn(async () => {
    const tab = await mockGetCurrentTab();
    return tab?.url ?? null;
  }),
  getActiveTabDomain: vi.fn(),
  getDomainForUrl: vi.fn((url: string | null | undefined) => {
    if (!url) return null;
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return null;
    }
  }),
  requireActiveTabUrl: vi.fn(),
}));

vi.mock('../statusChecker.js', () => ({ checkPageStatus: mockCheckPageStatus }));

vi.mock('../../utils/storage/SettingsRepository.js', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    settingsRepository: { getAll: mockGetAll, setAll: vi.fn(), getMany: vi.fn() },
  };
});

vi.mock('../../utils/i18n.js', () => ({ getMessage: mockGetMessage ,
getMessageOr: (key: string, fallback: string, subs?: unknown): string =>
      ((subs === undefined ? (mockGetMessage as (...a: any[]) => unknown)(key) : (mockGetMessage as (...a: any[]) => unknown)(key, subs)) || fallback) as string,
getMessageWithSubstitutions: (
        key: string,
        subs: Record<string, string | number>,
        fallback: string,
      ): string =>
      ((mockGetMessage as (...a: any[]) => unknown)(key, subs) ||
        fallback.replace(/\{(\w+)\}/g, (_m: string, n: string) =>
          subs[n] !== undefined ? String(subs[n]) : `{${n}}`)) as string,}));
vi.mock('../../utils/logger/api.js', () => ({
  logError: vi.fn(),
  ErrorCode: { INTERNAL_ERROR: 'INT_001' },
}));
vi.mock('../../utils/logger/types.js', () => ({
  logError: vi.fn(),
  ErrorCode: { INTERNAL_ERROR: 'INT_001' },
}));
vi.mock('../../utils/logger/core.js', () => ({
  logError: vi.fn(),
  ErrorCode: { INTERNAL_ERROR: 'INT_001' },
}));

import { initStatusPanel } from '../statusPanel.js';
import { loadActiveTabStatus } from '../statusStore.js';

function setupPanelDom(): void {
  document.body.innerHTML = '<div id="statusPanel"></div>';
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAll.mockResolvedValue({ privacy_mode: 'full_pipeline' });
  mockCheckPageStatus.mockResolvedValue({
    domainFilter: { allowed: true, mode: 'disabled' },
    privacy: { isPrivate: false, hasCache: false },
    cache: { hasCache: false },
    lastSaved: { exists: false },
  });
});

// PBI 2026-09-23-14: the null-time panel-hide path must stay unchanged after
// the active-tab reads converge on the tabUtils seam.
describe('tab seam null behavior pin', () => {
  it('hides the panel when there is no active tab', async () => {
    setupPanelDom();
    mockGetCurrentTab.mockResolvedValue(null);
    await initStatusPanel();
    expect(document.getElementById('statusPanel')!.style.display).toBe('none');
  });

  it('hides the panel when the active tab has no url', async () => {
    setupPanelDom();
    mockGetCurrentTab.mockResolvedValue({ id: 1 });
    await initStatusPanel();
    expect(document.getElementById('statusPanel')!.style.display).toBe('none');
  });

  it('loadActiveTabStatus keeps the null contract (null tab, null url, null status)', async () => {
    mockGetCurrentTab.mockResolvedValue(null);
    const snapshot = await loadActiveTabStatus();
    expect(snapshot).toEqual({ tab: null, url: null, status: null });
    expect(mockCheckPageStatus).not.toHaveBeenCalled();
  });
});
