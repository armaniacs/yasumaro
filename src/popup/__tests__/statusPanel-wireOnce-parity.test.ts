// @vitest-environment jsdom
// PBI 2026-10-02-03: parity pin — re-init must not stack duplicate
// statusAddDomain / statusAddPath handlers (wireOnce discipline, same as
// siblings :88,157,398,423). 2x init + 1 click => exactly 1 whitelist write.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drainMacrotask, waitForMock } from '../../../testDir/waitPolicy.js';

function readAttachBody(): string {
  const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'statusPanel.ts'),
    'utf-8',
  );
  const start = source.indexOf('function attachPrivacyActionListeners');
  expect(start).toBeGreaterThanOrEqual(0);
  const end = source.indexOf('\n}\n', start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

const {
  mockGetCurrentTab,
  mockGetMessage,
  mockIsAllUrlsPermitted,
  mockIsHostPermitted,
} = vi.hoisted(() => ({
  mockGetCurrentTab: vi.fn(),
  mockGetMessage: vi.fn(),
  mockIsAllUrlsPermitted: vi.fn(),
  mockIsHostPermitted: vi.fn(),
}));
const mockGetAll = vi.hoisted(() => vi.fn());
const mockSetAll = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockGetMany = vi.hoisted(() => vi.fn());
const mockLogError = vi.hoisted(() => vi.fn());
const mockExtractDomain = vi.hoisted(() => vi.fn((url: string) => {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return null; }
}));

vi.mock('../tabUtils.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../tabUtils.js')>();
  return {
    ...actual,
    getCurrentTab: mockGetCurrentTab,
    getActiveTabUrl: async () => (await mockGetCurrentTab())?.url ?? null,
  };
});

vi.mock('../../utils/storage/types.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, StorageKeys: { ...(actual.StorageKeys as Record<string, unknown>), DOMAIN_WHITELIST: 'domain_whitelist', PRIVACY_MODE: 'privacy_mode' } };
});
vi.mock('../../utils/storage/SettingsRepository.js', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return { ...actual, settingsRepository: { getAll: mockGetAll, setAll: mockSetAll, getMany: mockGetMany }, SettingsRepository: class { getAll = mockGetAll; setAll = mockSetAll; getMany = mockGetMany } };
});

vi.mock('../../utils/i18n.js', () => ({
  getMessage: mockGetMessage,
  getMessageOr: (key: string, fallback: string, subs?: unknown): string =>
    ((subs === undefined ? (mockGetMessage as (...a: any[]) => unknown)(key) : (mockGetMessage as (...a: any[]) => unknown)(key, subs)) || fallback) as string,
}));

vi.mock('../../utils/permissionManager.js', () => ({
  isAllUrlsPermitted: mockIsAllUrlsPermitted,
  requestAllUrls: vi.fn(),
  isHostPermitted: mockIsHostPermitted,
  recordDeniedVisit: vi.fn(),
  requestPermission: vi.fn(),
}));

vi.mock('../../utils/trustChecker.js', () => ({
  getTrustLevelDisplay: vi.fn().mockResolvedValue({ level: 'Trusted' }),
  checkDomainTrust: vi.fn().mockResolvedValue({ showAlert: false, trustResult: {} }),
}));

const mockCheckPageStatus = vi.hoisted(() => vi.fn());
vi.mock('../statusChecker.js', () => ({ checkPageStatus: mockCheckPageStatus }));

vi.mock('../../utils/logger/types.js', () => ({
  logError: mockLogError,
  ErrorCode: { INTERNAL_ERROR: 'INT_001' },
}));
vi.mock('../../utils/logger/core.js', () => ({
  logError: mockLogError,
  ErrorCode: { INTERNAL_ERROR: 'INT_001' },
}));
vi.mock('../../utils/logger/api.js', () => ({
  logError: mockLogError,
  ErrorCode: { INTERNAL_ERROR: 'INT_001' },
}));

vi.mock('../../utils/domainUtils.js', () => ({
  extractDomain: mockExtractDomain,
}));

// NOTE: domUtils is NOT mocked — the real wireOnce is the subject of the pin.

import { initStatusPanel } from '../statusPanel.js';

const defaultMessages: Record<string, string> = {
  statusTrustLocked: 'LOCKED',
  statusRecordable: 'Recordable',
  statusBlocked: 'Blocked',
  statusPrivateDetected: 'Private page detected',
  statusPublicPage: 'Public page',
  statusNoInfo: 'No information',
  statusReloadHint: 'Reload to check',
  statusCacheControlPrivate: 'Cache-Control: private',
  statusDomainAllowed: 'Allowed',
  statusDomainBlocked: 'Blocked',
  statusFilterModeDisabled: 'Disabled',
  statusCleansingNone: 'No cleansing',
  statusNotSaved: 'Not saved',
  statusShowDetails: 'Show Details',
  statusHideDetails: 'Hide Details',
  domainAddedToWhitelist: 'Domain added',
  pathAddedToWhitelist: 'Path added',
  errorGeneric: 'An error occurred.',
};

function setupDefaultDom(): void {
  document.body.innerHTML = [
    '<div id="statusPanel">',
    '  <div id="statusDomainIcon"></div>',
    '  <span id="statusDomainLabel" class="status-label"></span>',
    '  <div id="statusPrivacyIcon"></div>',
    '  <span id="statusPrivacyLabel" class="status-label"></span>',
    '  <div id="statusDomainState"></div>',
    '  <div id="statusDomainMode"></div>',
    '  <div id="statusPrivacyContent"></div>',
    '  <div id="statusCacheContent"></div>',
    '  <div id="statusLastSavedContent"></div>',
    '  <div id="statusCleansingContent"></div>',
    '  <div id="statusTrustContent"></div>',
    '  <div id="statusModeBadge"></div>',
    '  <button id="statusToggleBtn" aria-expanded="false"></button>',
    '  <div id="statusDetails"></div>',
    '  <span id="statusToggleText"></span>',
    '  <div id="permissionRequestArea" class="hidden"></div>',
    '  <div id="permissionDeniedMessage" class="hidden"></div>',
    '  <button id="recordBtn"></button>',
    '  <button id="statusAddDomain"></button>',
    '  <button id="statusAddPath"></button>',
    '</div>',
    '<div id="mainStatus"></div>',
  ].join('\n');
}

function stubTabs(): void {
  mockGetCurrentTab.mockResolvedValue({ url: 'https://example.com/page', id: 1 });
  vi.stubGlobal('chrome', {
    tabs: {
      query: vi.fn().mockResolvedValue([{ url: 'https://example.com/page', id: 1 }]),
      sendMessage: vi.fn(),
    },
    runtime: { lastError: null, sendMessage: vi.fn() },
    // The failure boundary now derives its sentence via errorUtils, which
    // reads chrome.i18n directly — a stub without it turns the boundary into
    // an unhandled rejection instead of a displayed message.
    i18n: {
      getMessage: vi.fn((key: string) => key),
      getUILanguage: vi.fn(() => 'en'),
    },
  });
}

function privateStatus(): void {
  mockCheckPageStatus.mockResolvedValue({
    domainFilter: { allowed: true, mode: 'disabled' },
    privacy: { isPrivate: true, hasCache: true, reason: 'cache-control' },
    cache: { hasCache: false },
    lastSaved: { exists: false },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetMessage.mockImplementation((key: string) => defaultMessages[key] || key);
  mockGetAll.mockResolvedValue({ privacy_mode: 'full_pipeline', domain_whitelist: [] });
  mockSetAll.mockResolvedValue(undefined);
  mockExtractDomain.mockImplementation((url: string) => {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return null; }
  });
  mockIsAllUrlsPermitted.mockResolvedValue(true);
  mockIsHostPermitted.mockResolvedValue(true);
});

describe('statusPanel wireOnce wiring — attachPrivacyActionListeners uses the shared seam', () => {
  it('statusAddDomain is wired through wireOnce, not a bare addEventListener', () => {
    const body = readAttachBody();
    expect(body).toMatch(/wireOnce\(\s*addDomainBtn/);
    expect(body).not.toMatch(/addDomainBtn\?\.\s*addEventListener/);
  });

  it('statusAddPath is wired through wireOnce, not a bare addEventListener', () => {
    const body = readAttachBody();
    expect(body).toMatch(/wireOnce\(\s*addPathBtn/);
    expect(body).not.toMatch(/addPathBtn\?\.\s*addEventListener/);
  });
});

describe('statusPanel wireOnce parity — re-init does not duplicate whitelist writes', () => {
  it('statusAddDomain: 2x init + 1 click => exactly 1 write', async () => {
    setupDefaultDom();
    stubTabs();
    privateStatus();
    await initStatusPanel();
    await initStatusPanel();
    mockGetCurrentTab.mockResolvedValue({ url: 'https://example.com/page', id: 1 } as any);
    document.getElementById('statusAddDomain')!.click();
    await waitForMock(() => expect(mockSetAll).toHaveBeenCalled());
    // Negative pin: a stacked duplicate handler resolves in the same flush,
    // so yield macrotask turns (no fixed duration) to let it land before
    // asserting the count stays at 1.
    await drainMacrotask();
    await drainMacrotask();
    expect(mockSetAll).toHaveBeenCalledTimes(1);
  });

  it('statusAddPath: 2x init + 1 click => exactly 1 write', async () => {
    setupDefaultDom();
    stubTabs();
    privateStatus();
    await initStatusPanel();
    await initStatusPanel();
    mockGetCurrentTab.mockResolvedValue({ url: 'https://example.com/page', id: 1 } as any);
    document.getElementById('statusAddPath')!.click();
    await waitForMock(() => expect(mockSetAll).toHaveBeenCalled());
    await drainMacrotask();
    await drainMacrotask();
    expect(mockSetAll).toHaveBeenCalledTimes(1);
  });
});
