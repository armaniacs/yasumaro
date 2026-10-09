// @vitest-environment jsdom
// Golden pin for the popup whitelist buttons (statusAddDomain / statusAddPath).
//
// Pins the *behavior* of the shared wiring skeleton before it is extracted into
// wireWhitelistButton: tab retrieval -> whitelist writer call -> result branch
// -> statusChannel.report message composition -> reportHandlerError on throw.
// The writer seam is mocked so every result branch (ok+added / !ok no-domain /
// !ok invalid-pattern / not-added) and the throw path can be driven directly;
// the assertions record what the two hand-written blocks do today, so the
// refactor is proven behavior-preserving.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { waitForMock, drainMacrotask } from '../../../testDir/waitPolicy.js';

const {
  mockGetCurrentTab,
  mockGetMessage,
  mockIsAllUrlsPermitted,
  mockIsHostPermitted,
  mockCheckPageStatus,
  mockAddDomainToWhitelist,
  mockAddPathToWhitelist,
  mockExtractDomain,
} = vi.hoisted(() => ({
  mockGetCurrentTab: vi.fn(),
  mockGetMessage: vi.fn(),
  mockIsAllUrlsPermitted: vi.fn(),
  mockIsHostPermitted: vi.fn(),
  mockCheckPageStatus: vi.fn(),
  mockAddDomainToWhitelist: vi.fn(),
  mockAddPathToWhitelist: vi.fn(),
  mockExtractDomain: vi.fn(),
}));
const mockGetAll = vi.hoisted(() => vi.fn());
const mockSetAll = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockGetMany = vi.hoisted(() => vi.fn());
const mockLogError = vi.hoisted(() => vi.fn());

vi.mock('../tabUtils.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../tabUtils.js')>();
  return {
    ...actual,
    getCurrentTab: mockGetCurrentTab,
    getActiveTabUrl: async () => (await mockGetCurrentTab())?.url ?? null,
  };
});

vi.mock('../whitelistWriter.js', () => ({
  addDomainToWhitelist: mockAddDomainToWhitelist,
  addPathToWhitelist: mockAddPathToWhitelist,
}));

vi.mock('../../utils/domainUtils.js', () => ({ extractDomain: mockExtractDomain }));

vi.mock('../../utils/storage/types.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    StorageKeys: {
      ...(actual.StorageKeys as Record<string, unknown>),
      DOMAIN_WHITELIST: 'domain_whitelist',
      PRIVACY_MODE: 'privacy_mode',
    },
  };
});
vi.mock('../../utils/storage/SettingsRepository.js', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    settingsRepository: { getAll: mockGetAll, setAll: mockSetAll, getMany: mockGetMany },
    SettingsRepository: class {
      getAll = mockGetAll;
      setAll = mockSetAll;
      getMany = mockGetMany;
    },
  };
});

vi.mock('../../utils/i18n.js', async () => {
  const { mockGetMessage: i18nMock } = await import('../../../testDir/i18nMock.js');
  return i18nMock(mockGetMessage);
});

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

vi.mock('../statusChecker.js', () => ({ checkPageStatus: mockCheckPageStatus }));

vi.mock('../../utils/logger/types.js', async () =>
  (await import('../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    logError: mockLogError,
    ErrorCode: { INTERNAL_ERROR: 'INT_001' },
  }),
);
vi.mock('../../utils/logger/core.js', async () =>
  (await import('../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    logError: mockLogError,
    ErrorCode: { INTERNAL_ERROR: 'INT_001' },
  }),
);
vi.mock('../../utils/logger/api.js', async () =>
  (await import('../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    logError: mockLogError,
    ErrorCode: { INTERNAL_ERROR: 'INT_001' },
  }),
);

import { initStatusPanel } from '../statusPanel.js';
import { statusChannel } from '../../utils/ui/statusChannel.js';
import { setupPopupDom } from './helpers/popupDom.js';

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
  statusInvalidUrl: 'Invalid URL',
  errorPrefix: 'Error',
};

let reportSpy: ReturnType<typeof vi.spyOn>;

function setupDefaultDom(): void {
  setupPopupDom({ includePending: false, includeDialogs: false, includeStatusPanel: true });
}

function privateStatus(): void {
  mockCheckPageStatus.mockResolvedValue({
    domainFilter: { allowed: true, mode: 'disabled' },
    privacy: { isPrivate: true, hasCache: true, reason: 'cache-control' },
    cache: { hasCache: false },
    lastSaved: { exists: false },
  });
}

async function initPrivatePanel(): Promise<void> {
  setupDefaultDom();
  mockGetCurrentTab.mockResolvedValue({ url: 'https://example.com/page', id: undefined });
  privateStatus();
  await initStatusPanel();
}

/** report() calls aimed at the mainStatus surface, oldest first. */
function mainStatusReports(): unknown[][] {
  return reportSpy.mock.calls.filter((call) => call[0] === 'mainStatus');
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetMessage.mockImplementation((key: string) => defaultMessages[key] || key);
  mockGetAll.mockResolvedValue({ privacy_mode: 'full_pipeline', domain_whitelist: [] });
  mockSetAll.mockResolvedValue(undefined);
  mockIsAllUrlsPermitted.mockResolvedValue(true);
  mockIsHostPermitted.mockResolvedValue(true);
  mockExtractDomain.mockImplementation((url: string) => {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return null; }
  });
  reportSpy = vi.spyOn(statusChannel, 'report');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('whitelist buttons golden pin — statusAddDomain', () => {
  it('success: reads the tab, adds the extracted domain, reports success, re-inits', async () => {
    mockExtractDomain.mockReturnValue('example.com');
    mockAddDomainToWhitelist.mockResolvedValue({ ok: true, entry: 'example.com', added: true });
    await initPrivatePanel();
    const initsBefore = mockCheckPageStatus.mock.calls.length;

    document.getElementById('statusAddDomain')!.click();

    await waitForMock(() => expect(mockAddDomainToWhitelist).toHaveBeenCalled());
    expect(mockGetCurrentTab).toHaveBeenCalled();
    expect(mockExtractDomain).toHaveBeenCalledWith('https://example.com/page');
    expect(mockAddDomainToWhitelist).toHaveBeenCalledWith('example.com');
    await waitForMock(() => expect(mainStatusReports()).toHaveLength(1));
    expect(mainStatusReports()[0]).toEqual(['mainStatus', 'Domain added', 'success']);
    await waitForMock(() =>
      expect(mockCheckPageStatus.mock.calls.length).toBeGreaterThan(initsBefore),
    );
  });

  it('already added (ok, not added): no report', async () => {
    mockExtractDomain.mockReturnValue('example.com');
    mockAddDomainToWhitelist.mockResolvedValue({ ok: true, entry: 'example.com', added: false });
    await initPrivatePanel();

    document.getElementById('statusAddDomain')!.click();

    await waitForMock(() => expect(mockAddDomainToWhitelist).toHaveBeenCalled());
    await drainMacrotask();
    expect(mainStatusReports()).toHaveLength(0);
  });

  it('no-domain rejection: reports statusInvalidUrl text as error', async () => {
    mockExtractDomain.mockReturnValue('example.com');
    mockAddDomainToWhitelist.mockResolvedValue({ ok: false, reason: 'no-domain' });
    await initPrivatePanel();

    document.getElementById('statusAddDomain')!.click();

    await waitForMock(() => expect(mainStatusReports()).toHaveLength(1));
    expect(mainStatusReports()[0]).toEqual(['mainStatus', 'Invalid URL', 'error']);
  });

  it('invalid-pattern rejection: reports "Invalid pattern: <domain>" as error', async () => {
    mockExtractDomain.mockReturnValue('bad pattern');
    mockAddDomainToWhitelist.mockResolvedValue({ ok: false, reason: 'invalid-pattern', error: 'nope' });
    await initPrivatePanel();

    document.getElementById('statusAddDomain')!.click();

    await waitForMock(() => expect(mainStatusReports()).toHaveLength(1));
    expect(mainStatusReports()[0]).toEqual(['mainStatus', 'Invalid pattern: bad pattern', 'error']);
  });

  it('no extractable domain: skips the writer without any report', async () => {
    mockExtractDomain.mockReturnValue(null);
    await initPrivatePanel();

    document.getElementById('statusAddDomain')!.click();

    await drainMacrotask();
    expect(mockAddDomainToWhitelist).not.toHaveBeenCalled();
    expect(mainStatusReports()).toHaveLength(0);
  });

  it('thrown writer error: routes to reportHandlerError with the domain log message', async () => {
    mockExtractDomain.mockReturnValue('example.com');
    mockAddDomainToWhitelist.mockRejectedValue(new Error('settings are locked'));
    await initPrivatePanel();

    document.getElementById('statusAddDomain')!.click();

    await waitForMock(() => expect(mockLogError).toHaveBeenCalled());
    expect(mainStatusReports()).toHaveLength(1);
    expect(mainStatusReports()[0][0]).toBe('mainStatus');
    expect(mainStatusReports()[0][1]).toContain('settings are locked');
    expect(mainStatusReports()[0][2]).toBe('error');
    expect(mockLogError).toHaveBeenCalledWith(
      'Failed to add the domain to the whitelist',
      expect.objectContaining({ cause: expect.any(Error) }),
      'INT_001',
    );
  });
});

describe('whitelist buttons golden pin — statusAddPath', () => {
  it('success: reads the tab, adds the URL, reports success, re-inits', async () => {
    mockAddPathToWhitelist.mockResolvedValue({ ok: true, entry: 'example.com', added: true });
    await initPrivatePanel();
    const initsBefore = mockCheckPageStatus.mock.calls.length;

    document.getElementById('statusAddPath')!.click();

    await waitForMock(() => expect(mockAddPathToWhitelist).toHaveBeenCalled());
    expect(mockGetCurrentTab).toHaveBeenCalled();
    expect(mockAddPathToWhitelist).toHaveBeenCalledWith('https://example.com/page');
    await waitForMock(() => expect(mainStatusReports()).toHaveLength(1));
    expect(mainStatusReports()[0]).toEqual(['mainStatus', 'Path added', 'success']);
    await waitForMock(() =>
      expect(mockCheckPageStatus.mock.calls.length).toBeGreaterThan(initsBefore),
    );
  });

  it('already added (ok, not added): no report', async () => {
    mockAddPathToWhitelist.mockResolvedValue({ ok: true, entry: 'example.com', added: false });
    await initPrivatePanel();

    document.getElementById('statusAddPath')!.click();

    await waitForMock(() => expect(mockAddPathToWhitelist).toHaveBeenCalled());
    await drainMacrotask();
    expect(mainStatusReports()).toHaveLength(0);
  });

  it('no-domain rejection: reports statusInvalidUrl text as error', async () => {
    mockAddPathToWhitelist.mockResolvedValue({ ok: false, reason: 'no-domain' });
    await initPrivatePanel();

    document.getElementById('statusAddPath')!.click();

    await waitForMock(() => expect(mainStatusReports()).toHaveLength(1));
    expect(mainStatusReports()[0]).toEqual(['mainStatus', 'Invalid URL', 'error']);
  });

  it('invalid-pattern rejection: reports "Invalid pattern: <url>" as error', async () => {
    mockAddPathToWhitelist.mockResolvedValue({ ok: false, reason: 'invalid-pattern', error: 'nope' });
    await initPrivatePanel();

    document.getElementById('statusAddPath')!.click();

    await waitForMock(() => expect(mainStatusReports()).toHaveLength(1));
    expect(mainStatusReports()[0]).toEqual([
      'mainStatus',
      'Invalid pattern: https://example.com/page',
      'error',
    ]);
  });

  it('thrown writer error: routes to reportHandlerError with the path log message', async () => {
    mockAddPathToWhitelist.mockRejectedValue(new Error('settings are locked'));
    await initPrivatePanel();

    document.getElementById('statusAddPath')!.click();

    await waitForMock(() => expect(mockLogError).toHaveBeenCalled());
    expect(mainStatusReports()).toHaveLength(1);
    expect(mainStatusReports()[0][1]).toContain('settings are locked');
    expect(mainStatusReports()[0][2]).toBe('error');
    expect(mockLogError).toHaveBeenCalledWith(
      'Failed to add the path to the whitelist',
      expect.objectContaining({ cause: expect.any(Error) }),
      'INT_001',
    );
  });
});
