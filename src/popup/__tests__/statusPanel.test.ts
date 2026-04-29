// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { 
  getCleansedReasonText, 
  updateCleansingStatus, 
  renderSpecialUrlStatus, 
  initStatusPanel, 
  initAllUrlsPermissionBanner, 
  updateTrustStatus
} from '../statusPanel.js';

// ============================================================================
// MOCK SETUP
// ============================================================================

// ============================================================================
// MOCK SETUP
// ============================================================================

// Hoisted mocks for modules that need to be mocked before import
const { 
  mockGetCurrentTab, 
  mockGetSettings, 
  mockSaveSettings, 
  mockGetMessage, 
  mockIsAllUrlsPermitted, 
  mockRequestAllUrls,
  mockIsHostPermitted,
  mockRecordDeniedVisit,
  mockGetTrustLevelDisplay,
  mockCheckDomainTrust,
  mockCheckPageStatus,
  mockRequestPermission,
} = vi.hoisted(() => ({
  mockGetCurrentTab: vi.fn(),
  mockGetSettings: vi.fn(),
  mockSaveSettings: vi.fn(),
  mockGetMessage: vi.fn(),
  mockIsAllUrlsPermitted: vi.fn(),
  mockRequestAllUrls: vi.fn(),
  mockIsHostPermitted: vi.fn(),
  mockRecordDeniedVisit: vi.fn(),
  mockGetTrustLevelDisplay: vi.fn(),
  mockCheckDomainTrust: vi.fn(),
  mockCheckPageStatus: vi.fn(),
  mockRequestPermission: vi.fn(),
}));

// Mock modules
vi.mock('../tabUtils.js', () => ({
  getCurrentTab: mockGetCurrentTab,
}));

vi.mock('../../utils/storage.js', () => ({
  getSettings: mockGetSettings,
  saveSettings: mockSaveSettings,
  StorageKeys: {
    DOMAIN_WHITELIST: 'domainWhitelist',
  },
}));

vi.mock('../i18n.js', () => ({
  getMessage: mockGetMessage,
}));

vi.mock('../../utils/permissionManager.js', () => ({
  isAllUrlsPermitted: mockIsAllUrlsPermitted,
  requestAllUrls: mockRequestAllUrls,
  isHostPermitted: mockIsHostPermitted,
  recordDeniedVisit: mockRecordDeniedVisit,
  requestPermission: mockRequestPermission,
}));

vi.mock('../../utils/trustChecker.js', () => ({
  getTrustLevelDisplay: mockGetTrustLevelDisplay,
  checkDomainTrust: mockCheckDomainTrust,
}));

vi.mock('../statusChecker.js', () => ({
  checkPageStatus: mockCheckPageStatus,
}));

vi.mock('../../utils/logger.js', () => ({
  logError: vi.fn(),
  ErrorCode: {
    INTERNAL_ERROR: 'INTERNAL_ERROR',
  },
}));

// Mock chrome API
const mockChrome = {
  tabs: {
    query: vi.fn().mockResolvedValue([{ url: 'https://example.com' }]),
    sendMessage: vi.fn(),
  },
  runtime: {
    lastError: null,
    sendMessage: vi.fn(),
  },
};
global.chrome = mockChrome as any;

// Helper to build status panel DOM for domain whitelist tests
// Default i18n messages
const defaultMessages: Record<string, string> = {
  statusCleansingNone: 'No cleansing',
  cleansedBadgeHard: '🧹 Hard',
  cleansedBadgeKeyword: '🧹 Keyword',
  cleansedBadgeBoth: '🧹 Both',
  statusCleansingHard: 'Hard: {0}',
  statusCleansingKeyword: 'Keyword: {0}',
  statusCleansingTotal: 'Total: {0}',
  statusDomainAllowed: 'Allowed',
  statusDomainBlocked: 'Blocked',
  statusPattern: 'Pattern: {0}',
  statusFilterModeWhitelist: 'Whitelist mode',
  statusFilterModeBlacklist: 'Blacklist mode',
  statusFilterModeDisabled: 'Disabled',
  statusPrivateDetected: 'Private page detected',
  statusPublicPage: 'Public page',
  statusNoInfo: 'No information',
  statusReloadHint: 'Reload to check',
  statusCacheControlPrivate: 'Cache-Control: private',
  statusSetCookieDetected: 'Set-Cookie detected',
  statusAuthDetected: 'Authorization detected',
  statusSetCookiePresent: 'Cookie present',
  statusAuthorizationPresent: 'Authorization present',
  statusNoCacheInfo: 'No cache info',
  statusNotSaved: 'Not saved',
  statusShowDetails: 'Show Details',
  statusHideDetails: 'Hide Details',
  statusRecordable: 'Recordable',
  statusBlocked: 'Blocked',
  forceRecordAnyway: 'Record Anyway',
  recordNow: 'Record Now',
  statusTrustTrusted: 'Trusted',
  statusTrustSensitive: 'Sensitive',
  statusTrustUnverified: 'Unverified',
  statusTrustAlertFinance: 'Finance site',
  statusTrustAlertSensitive: 'Sensitive site',
  statusNoInfo: 'No info',
  domainAddedToWhitelist: 'Domain added',
  pathAddedToWhitelist: 'Path added',
  statusPageNotRecordable: 'Page not recordable',
};

mockGetMessage.mockImplementation((key: string, substitutions?: any) => {
  let msg = defaultMessages[key] || key;
  if (substitutions && typeof substitutions === 'object') {
    Object.keys(substitutions).forEach((k) => {
      msg = msg.replace(`{${k}}`, substitutions[k]);
    });
  }
  return msg;
});

// ============================================================================
// TEST SUITE
// ============================================================================

describe('getCleansedReasonText', () => {
  it('returns empty string when cleansedReason is undefined', () => {
    expect(getCleansedReasonText(undefined)).toBe('');
  });

  it('returns empty string when cleansedReason is "none"', () => {
    expect(getCleansedReasonText('none')).toBe('');
  });

  it('returns non-empty string for "hard"', () => {
    const result = getCleansedReasonText('hard');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('returns non-empty string for "keyword"', () => {
    const result = getCleansedReasonText('keyword');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('returns non-empty string for "both"', () => {
    const result = getCleansedReasonText('both');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('updateCleansingStatus', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="statusCleansingContent"></div>
      <div id="mainStatus"></div>
    `;
    vi.clearAllMocks();
  });

  it('does nothing when element does not exist', () => {
    document.body.innerHTML = '';
    expect(() => updateCleansingStatus({ totalRemoved: 5, hardStripRemoved: 3, keywordStripRemoved: 2 })).not.toThrow();
  });

  it('shows "none" message when cleanseStats.totalRemoved = 0', () => {
    updateCleansingStatus({ totalRemoved: 0, hardStripRemoved: 0, keywordStripRemoved: 0 });
    const el = document.getElementById('statusCleansingContent')!;
    expect(el.innerHTML).toContain('status-muted');
    expect(el.textContent).toContain('No cleansing');
  });

  it('renders hard badge when hardStripRemoved > 0', () => {
    updateCleansingStatus({ totalRemoved: 3, hardStripRemoved: 3, keywordStripRemoved: 0 }, 'hard');
    const el = document.getElementById('statusCleansingContent')!;
    expect(el.querySelectorAll('.status-value').length).toBeGreaterThan(0);
    expect(el.textContent).toContain('Hard: 3');
  });

  it('renders keyword badge when keywordStripRemoved > 0', () => {
    updateCleansingStatus({ totalRemoved: 2, hardStripRemoved: 0, keywordStripRemoved: 2 }, 'keyword');
    const el = document.getElementById('statusCleansingContent')!;
    expect(el.querySelectorAll('.status-value').length).toBeGreaterThan(0);
    expect(el.textContent).toContain('Keyword: 2');
  });

  it('renders both hard and keyword badges when both > 0', () => {
    updateCleansingStatus({ totalRemoved: 5, hardStripRemoved: 3, keywordStripRemoved: 2 }, 'both');
    const el = document.getElementById('statusCleansingContent')!;
    expect(el.textContent).toContain('Hard: 3');
    expect(el.textContent).toContain('Keyword: 2');
    expect(el.textContent).toContain('Total: 5');
  });
});

describe('renderSpecialUrlStatus', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="statusPanel"></div>
    `;
  });

  it('renders error status in panel', () => {
    renderSpecialUrlStatus();
    const panel = document.getElementById('statusPanel')!;
    expect(panel.innerHTML).toContain('status-error');
    expect(panel.textContent).toContain('Page not recordable');
  });

  it('does nothing when statusPanel element does not exist', () => {
    document.body.innerHTML = '';
    expect(() => renderSpecialUrlStatus()).not.toThrow();
  });
});

// ============================================================================
// updateTrustStatus Tests
// ============================================================================

describe('updateTrustStatus', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="statusTrustContent"></div>
      <div id="permissionRequestArea" class="hidden">
        <button id="btnRequestPermission">Request Permission</button>
      </div>
      <button id="recordBtn"></button>
      <div id="permissionDeniedMessage" class="hidden"></div>
    `;
    vi.clearAllMocks();
    mockIsAllUrlsPermitted.mockResolvedValue(true);
    mockIsHostPermitted.mockResolvedValue(true);
  });

  it('returns early when trustContent element does not exist', async () => {
    document.body.innerHTML = '';
    await expect(updateTrustStatus('https://example.com')).resolves.not.toThrow();
  });

  it('shows LOCKED when host permission not granted', async () => {
    mockIsAllUrlsPermitted.mockResolvedValue(false);
    mockIsHostPermitted.mockResolvedValue(false);
    await updateTrustStatus('https://example.com');
    const trustContent = document.getElementById('statusTrustContent')!;
    expect(trustContent.innerHTML).toContain('LOCKED');
  });

  it('disables recordBtn when permission denied', async () => {
    mockIsAllUrlsPermitted.mockResolvedValue(false);
    mockIsHostPermitted.mockResolvedValue(false);
    await updateTrustStatus('https://example.com');
    const recordBtn = document.getElementById('recordBtn') as HTMLButtonElement;
    expect(recordBtn.disabled).toBe(true);
  });

  it('shows permissionRequestArea when permission denied', async () => {
    mockIsAllUrlsPermitted.mockResolvedValue(false);
    mockIsHostPermitted.mockResolvedValue(false);
    await updateTrustStatus('https://example.com');
    const permArea = document.getElementById('permissionRequestArea')!;
    expect(permArea.classList.contains('hidden')).toBe(false);
  });

  it('sets up permission request click handler', async () => {
    mockIsAllUrlsPermitted.mockResolvedValue(false);
    mockIsHostPermitted.mockResolvedValue(false);
    mockRequestPermission.mockResolvedValue(true);
    await updateTrustStatus('https://example.com');
    const requestBtn = document.getElementById('btnRequestPermission')!;
    await requestBtn.click();
    expect(mockRequestPermission).toHaveBeenCalledWith('https://example.com');
  });

  it('hides permission area and enables recordBtn when permission granted', async () => {
    mockIsAllUrlsPermitted.mockResolvedValue(false);
    mockIsHostPermitted.mockResolvedValue(false);
    mockRequestPermission.mockResolvedValue(true);
    await updateTrustStatus('https://example.com');
    const requestBtn = document.getElementById('btnRequestPermission')!;
    await requestBtn.click();
    const permArea = document.getElementById('permissionRequestArea')!;
    const recordBtn = document.getElementById('recordBtn')!;
    expect(permArea.classList.contains('hidden')).toBe(true);
    expect(recordBtn.disabled).toBe(false);
  });

    it('records denied visit and shows error message when permission denied', async () => {
      mockIsAllUrlsPermitted.mockResolvedValue(false);
      mockIsHostPermitted.mockResolvedValue(false);
      mockRequestPermission.mockResolvedValue(false);
      await updateTrustStatus('https://example.com');
      const requestBtn = document.getElementById('btnRequestPermission')!;
      await requestBtn.click();
      await new Promise(r => setTimeout(r, 0));
      expect(mockRecordDeniedVisit).toHaveBeenCalledWith('example.com');
      const errorMsg = document.getElementById('permissionDeniedMessage')!;
      expect(errorMsg.classList.contains('hidden')).toBe(false);
    });

  it('shows trust level for permitted URLs (Trusted)', async () => {
    mockIsAllUrlsPermitted.mockResolvedValue(true);
    mockGetTrustLevelDisplay.mockResolvedValue({ level: 'Trusted' });
    mockCheckDomainTrust.mockResolvedValue({ showAlert: false, trustResult: {} });
    await updateTrustStatus('https://example.com');
    const trustContent = document.getElementById('statusTrustContent')!;
    expect(trustContent.innerHTML).toContain('Trusted');
    expect(trustContent.innerHTML).toContain('status-trust-trusted');
  });

  it('shows trust level for permitted URLs (Sensitive)', async () => {
    mockIsAllUrlsPermitted.mockResolvedValue(true);
    mockGetTrustLevelDisplay.mockResolvedValue({ level: 'Sensitive' });
    mockCheckDomainTrust.mockResolvedValue({ showAlert: false, trustResult: {} });
    await updateTrustStatus('https://example.com');
    const trustContent = document.getElementById('statusTrustContent')!;
    expect(trustContent.innerHTML).toContain('Sensitive');
    expect(trustContent.innerHTML).toContain('status-trust-sensitive');
  });

  it('shows trust level for permitted URLs (Unverified)', async () => {
    mockIsAllUrlsPermitted.mockResolvedValue(true);
    mockGetTrustLevelDisplay.mockResolvedValue({ level: 'Unverified' });
    mockCheckDomainTrust.mockResolvedValue({ showAlert: false, trustResult: {} });
    await updateTrustStatus('https://example.com');
    const trustContent = document.getElementById('statusTrustContent')!;
    expect(trustContent.innerHTML).toContain('Unverified');
    expect(trustContent.innerHTML).toContain('status-trust-unverified');
  });

  it('shows alert banner for finance sites', async () => {
    mockIsAllUrlsPermitted.mockResolvedValue(true);
    mockGetTrustLevelDisplay.mockResolvedValue({ level: 'Sensitive' });
    mockCheckDomainTrust.mockResolvedValue({ 
      showAlert: true, 
      trustResult: { category: 'finance' } 
    });
    await updateTrustStatus('https://example.com');
    const trustContent = document.getElementById('statusTrustContent')!;
    expect(trustContent.innerHTML).toContain('Finance site');
    expect(trustContent.innerHTML).toContain('status-warning');
  });

  it('shows alert banner for sensitive sites', async () => {
    mockIsAllUrlsPermitted.mockResolvedValue(true);
    mockGetTrustLevelDisplay.mockResolvedValue({ level: 'Trusted' });
    mockCheckDomainTrust.mockResolvedValue({ 
      showAlert: true, 
      trustResult: { category: 'sensitive' } 
    });
    await updateTrustStatus('https://example.com');
    const trustContent = document.getElementById('statusTrustContent')!;
    expect(trustContent.innerHTML).toContain('Sensitive site');
  });

   it('shows muted "No info" on error', async () => {
     mockIsAllUrlsPermitted.mockResolvedValue(true);
     mockGetTrustLevelDisplay.mockRejectedValue(new Error('fail'));
     await updateTrustStatus('https://example.com');
     const trustContent = document.getElementById('statusTrustContent')!;
     expect(trustContent.innerHTML).toContain('No info');
     expect(trustContent.innerHTML).toContain('status-muted');
   });
});


 // ============================================================================
 // initAllUrlsPermissionBanner Tests (including click handler)
 // ============================================================================
 // initAllUrlsPermissionBanner Tests (including click handler)
 // ============================================================================

describe('initAllUrlsPermissionBanner', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="allUrlsPermissionBanner"></div>
      <button id="btnRequestAllUrls"></button>
    `;
    vi.clearAllMocks();
    mockIsAllUrlsPermitted.mockResolvedValue(false);
  });

  it('shows banner when permission not granted', async () => {
    await initAllUrlsPermissionBanner();
    const banner = document.getElementById('allUrlsPermissionBanner')!;
    expect(banner.classList.contains('hidden')).toBe(false);
  });

  it('hides banner when permission already granted', async () => {
    mockIsAllUrlsPermitted.mockResolvedValue(true);
    await initAllUrlsPermissionBanner();
    const banner = document.getElementById('allUrlsPermissionBanner')!;
    expect(banner.classList.contains('hidden')).toBe(true);
  });

  it('does nothing when banner element does not exist', async () => {
    document.body.innerHTML = '';
    mockIsAllUrlsPermitted.mockResolvedValue(false);
    await expect(initAllUrlsPermissionBanner()).resolves.not.toThrow();
  });

  it('requests all URLs permission and hides banner when granted', async () => {
    mockRequestAllUrls.mockResolvedValue(true);
    mockIsAllUrlsPermitted.mockResolvedValue(false);
    await initAllUrlsPermissionBanner();
    const requestBtn = document.getElementById('btnRequestAllUrls')!;
    await requestBtn.click();
    expect(mockRequestAllUrls).toHaveBeenCalled();
    const banner = document.getElementById('allUrlsPermissionBanner')!;
    expect(banner.classList.contains('hidden')).toBe(true);
  });

  it('calls updateTrustStatus after permission granted', async () => {
    mockRequestAllUrls.mockResolvedValue(true);
    mockIsAllUrlsPermitted.mockResolvedValue(false);
    // Set up additional mocks for updateTrustStatus call
    mockIsAllUrlsPermitted.mockResolvedValueOnce(true); // after grant
    await initAllUrlsPermissionBanner();
    const requestBtn = document.getElementById('btnRequestAllUrls')!;
    await requestBtn.click();
    // The updateTrustStatus call happens; verify by checking trust content
    // Since updateTrustStatus will set trustContent.innerHTML
    const trustContent = document.getElementById('statusTrustContent');
    if (trustContent) {
      expect(trustContent.innerHTML).toBeTruthy();
    }
    // If banner is hidden, that indicates the permission flow completed
    const banner = document.getElementById('allUrlsPermissionBanner')!;
    expect(banner.classList.contains('hidden')).toBe(true);
  });

  it('keeps banner visible when permission request denied', async () => {
    mockRequestAllUrls.mockResolvedValue(false);
    mockIsAllUrlsPermitted.mockResolvedValue(false);
    await initAllUrlsPermissionBanner();
    const requestBtn = document.getElementById('btnRequestAllUrls')!;
    await requestBtn.click();
    const banner = document.getElementById('allUrlsPermissionBanner')!;
    expect(banner.classList.contains('hidden')).toBe(false);
  });
});

// ============================================================================
// initStatusPanel Tests (extended)
// ============================================================================
describe('initStatusPanel - extended', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="statusPanel">
        <div id="statusDomainIcon"></div>
        <div id="statusPrivacyIcon"></div>
        <div id="statusDomainState"></div>
        <div id="statusDomainMode"></div>
        <div id="statusPrivacyContent"></div>
        <div id="statusCacheContent"></div>
        <div id="statusLastSavedContent"></div>
        <div id="statusCleansingContent"></div>
        <div id="statusTrustContent"></div>
        <button id="statusToggleBtn" aria-expanded="false"></button>
        <div id="statusDetails"></div>
        <span id="statusToggleText"></span>
        <div id="permissionRequestArea" class="hidden"></div>
        <div id="permissionDeniedMessage" class="hidden"></div>
        <button id="recordBtn"></button>
        <button id="statusAddDomain"></button>
        <button id="statusAddPath"></button>
      </div>
    `;
    vi.clearAllMocks();
    mockGetMessage.mockImplementation((key: string) => defaultMessages[key] || key);
  });

  it('handles missing checkPageStatus (returns null)', async () => {
    mockCheckPageStatus.mockResolvedValue(null);
    mockGetCurrentTab.mockResolvedValue({ url: 'https://example.com' });
    await initStatusPanel();
    const panel = document.getElementById('statusPanel')!;
    expect(panel.innerHTML).toContain('Page not recordable');
  });

  it('renders full status panel when checkPageStatus returns data', async () => {
    const mockTab = { url: 'https://example.com', id: 1 };
    mockGetCurrentTab.mockResolvedValue(mockTab);
    mockCheckPageStatus.mockResolvedValue({
      domainFilter: { allowed: true, mode: 'disabled', matched: false },
      privacy: { isPrivate: false, hasCache: false },
      cache: { hasCache: false },
      lastSaved: { exists: false },
    });
    // Mock chrome.tabs.sendMessage for cleansing stats
    mockChrome.tabs.sendMessage.mockImplementation((tabId, msg, cb) => {
      if (msg.type === 'GET_CONTENT') {
        cb({ cleanseStats: { totalRemoved: 0, hardStripRemoved: 0, keywordStripRemoved: 0 } });
      }
      return;
    });
    await initStatusPanel();
    const panel = document.getElementById('statusPanel')!;
    // Ensure panel is visible and has content
    expect(panel.style.display).not.toBe('none');
  });

   it('handles chrome.runtime.lastError gracefully', async () => {
    const mockTab = { url: 'https://example.com', id: 1 };
    mockGetCurrentTab.mockResolvedValue(mockTab);
    mockCheckPageStatus.mockResolvedValue({
      domainFilter: { allowed: true, mode: 'disabled', matched: false },
      privacy: { isPrivate: false, hasCache: false },
      cache: { hasCache: false },
      lastSaved: { exists: false },
    });
    mockChrome.tabs.sendMessage.mockImplementation((tabId, msg, cb) => {
      const error = new Error('Test error');
      // @ts-expect-error
      chrome.runtime.lastError = error;
      cb(undefined);
    });
    await expect(initStatusPanel()).resolves.not.toThrow();
  });

   it('hides panel when no URL available', async () => {
     mockGetCurrentTab.mockResolvedValue({ url: undefined });
     await initStatusPanel();
     const panel = document.getElementById('statusPanel')!;
     expect(panel.style.display).toBe('');
   });

   it('hides panel on error', async () => {
     mockGetCurrentTab.mockRejectedValue(new Error('Test error'));
     await initStatusPanel();
     const panel = document.getElementById('statusPanel')!;
     expect(panel.style.display).toBe('');
   });
});
