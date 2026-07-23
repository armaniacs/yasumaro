// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockGetCurrentTab,
  mockGetSettings,
  mockSaveSettings,
  mockGetMessage,
  mockIsAllUrlsPermitted,
  mockIsHostPermitted,
  mockGetTrustLevelDisplay,
  mockCheckDomainTrust,
  mockCheckPageStatus,
} = vi.hoisted(() => ({
  mockGetCurrentTab: vi.fn(),
  mockGetSettings: vi.fn(),
  mockSaveSettings: vi.fn(),
  mockGetMessage: vi.fn(),
  mockIsAllUrlsPermitted: vi.fn(),
  mockIsHostPermitted: vi.fn(),
  mockGetTrustLevelDisplay: vi.fn(),
  mockCheckDomainTrust: vi.fn(),
  mockCheckPageStatus: vi.fn(),
}));

const mockRecordDeniedVisit = vi.fn();
const mockRequestPermission = vi.fn();
const mockRequestAllUrls = vi.fn();

vi.mock('../tabUtils.js', () => ({ getCurrentTab: mockGetCurrentTab }));

vi.mock('../../utils/storage.js', () => ({
  getSettings: mockGetSettings,
  saveSettings: mockSaveSettings,
  StorageKeys: {
    DOMAIN_WHITELIST: 'domainWhitelist',
    PRIVACY_MODE: 'privacy_mode',
  },
}));

vi.mock('../../utils/i18n.js', () => ({ getMessage: mockGetMessage }));

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

vi.mock('../statusChecker.js', () => ({ checkPageStatus: mockCheckPageStatus }));

vi.mock('../../utils/logger.js', () => ({
  logError: vi.fn(),
  ErrorCode: { INTERNAL_ERROR: 'INT_001' },
}));

vi.mock('../domUtils.js', () => ({
  updateStatusIcon: vi.fn(),
  escapeHtml: vi.fn((s: string) => s),
}));

import {
  initStatusPanel,
  setRecordCurrentPageFn,
  getCleansedReasonText,
  updateCleansingStatus,
} from '../statusPanel.js';

const defaultMessages: Record<string, string> = {
  statusRecordable: 'Recordable',
  statusBlocked: 'Blocked',
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
  statusDomainAllowed: 'Allowed',
  statusDomainBlocked: 'Blocked',
  statusPattern: 'Pattern: {0}',
  statusFilterModeWhitelist: 'Whitelist mode',
  statusFilterModeBlacklist: 'Blacklist mode',
  statusFilterModeDisabled: 'Disabled',
  statusCleansingNone: 'No cleansing',
  cleansedBadgeHard: '✅ Hard',
  cleansedBadgeKeyword: '✅ Keyword',
  cleansedBadgeBoth: '✅ Both',
  statusCleansingHard: 'Hard: {0}',
  statusCleansingKeyword: 'Keyword: {0}',
  statusCleansingTotal: 'Total: {0}',
  forceRecordAnyway: 'Record Anyway',
  recordNow: 'Record Now',
  statusTrustTrusted: 'Trusted',
  statusTrustSensitive: 'Sensitive',
  statusTrustUnverified: 'Unverified',
  statusTrustAlertFinance: 'Finance site',
  statusTrustAlertSensitive: 'Sensitive site',
  statusPageNotRecordable: 'Page not recordable',
  privacyModeLocalOnlyShort: 'Local',
  privacyModeFullPipelineShort: 'Full',
  privacyModeMaskedCloudShort: 'Masked',
  privacyModeCloudOnlyShort: 'Cloud',
  domainAddedToWhitelist: 'Domain added',
  pathAddedToWhitelist: 'Path added',
  saveDomain: 'Save domain',
  savePath: 'Save path',
};

function setDefaultChromeTabsQuery(): void {
  vi.stubGlobal('chrome', {
    ...chrome,
    tabs: {
      ...chrome.tabs,
      query: vi.fn().mockResolvedValue([{ url: 'https://example.com', id: 1 }]),
      sendMessage: vi.fn(),
    },
    runtime: {
      ...chrome.runtime,
      lastError: null,
      sendMessage: vi.fn(),
    },
  });
}

function setupDefaultDom(): void {
  document.body.innerHTML = [
    '<div id="statusPanel">',
    '  <div id="statusDomainIcon"></div>',
    '  <div id="statusPrivacyIcon"></div>',
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
  ].join('\n');
}

beforeEach(() => {
  vi.clearAllMocks();
mockGetMessage.mockImplementation((key: string, substitutions?: string | string[]) => {
  let msg = defaultMessages[key] || key;
  if (substitutions !== undefined) {
    const subs = Array.isArray(substitutions) ? substitutions : [substitutions];
    subs.forEach((s, i) => { msg = msg.replace(`{${i}}`, s); });
  }
  return msg;
});
  mockGetSettings.mockResolvedValue({ privacy_mode: 'full_pipeline' });
  mockIsAllUrlsPermitted.mockResolvedValue(true);
  mockIsHostPermitted.mockResolvedValue(true);
});

// ──────────────────────────────────────────────
// setRecordCurrentPageFn
// ──────────────────────────────────────────────
describe('setRecordCurrentPageFn', () => {
  it('calls the stored record function with force=false', async () => {
    const fn = vi.fn();
    setRecordCurrentPageFn(fn);
    setupDefaultDom();
    setDefaultChromeTabsQuery();
    mockGetCurrentTab.mockResolvedValue({ url: 'https://example.com', id: 1 });
    mockCheckPageStatus.mockResolvedValue({
      domainFilter: { allowed: true, mode: 'disabled', matched: false, matchedPattern: undefined },
      privacy: { isPrivate: false, hasCache: false },
      cache: { hasCache: false },
      lastSaved: { exists: false },
    });
    await initStatusPanel();
    const btn = document.getElementById('recordBtn') as HTMLButtonElement;
    expect(btn.textContent).toBe('Record Now');
    btn.click();
    expect(fn).toHaveBeenCalledWith(false);
  });
});

// ──────────────────────────────────────────────
// initStatusPanel — mode badge
// ──────────────────────────────────────────────
describe('initStatusPanel — mode badge', () => {
  beforeEach(() => {
    setupDefaultDom();
    setDefaultChromeTabsQuery();
    mockCheckPageStatus.mockResolvedValue({
      domainFilter: { allowed: true, mode: 'disabled' },
      privacy: { isPrivate: false, hasCache: false },
      cache: { hasCache: false },
      lastSaved: { exists: false },
    });
  });

  it('shows mode badge for local_only', async () => {
    mockGetSettings.mockResolvedValue({ privacy_mode: 'local_only' });
    await initStatusPanel();
    const badge = document.getElementById('statusModeBadge')!;
    expect(badge.textContent).toBe('Local');
    expect(badge.className).toContain('mode-local_only');
  });

  it('shows mode badge for masked_cloud', async () => {
    mockGetSettings.mockResolvedValue({ privacy_mode: 'masked_cloud' });
    await initStatusPanel();
    const badge = document.getElementById('statusModeBadge')!;
    expect(badge.textContent).toBe('Masked');
    expect(badge.className).toContain('mode-masked_cloud');
  });

  it('shows mode badge for full_pipeline', async () => {
    mockGetSettings.mockResolvedValue({ privacy_mode: 'full_pipeline' });
    await initStatusPanel();
    const badge = document.getElementById('statusModeBadge')!;
    expect(badge.textContent).toBe('Full');
    expect(badge.className).toContain('mode-full_pipeline');
  });

  it('shows mode badge for unknown mode with fallback', async () => {
    mockGetSettings.mockResolvedValue({ privacy_mode: 'unknown_mode' });
    await initStatusPanel();
    const badge = document.getElementById('statusModeBadge')!;
    expect(badge.textContent).toBe('Cloud');
  });

  it('handles missing mode badge element gracefully', async () => {
    document.getElementById('statusModeBadge')!.remove();
    await expect(initStatusPanel()).resolves.not.toThrow();
  });

  it('tolerates mode badge settings error silently', async () => {
    mockGetSettings.mockRejectedValueOnce(new Error('storage fail'));
    await expect(initStatusPanel()).resolves.not.toThrow();
  });
});

// ──────────────────────────────────────────────
// initStatusPanel — toggle button
// ──────────────────────────────────────────────
describe('initStatusPanel — toggle button', () => {
  beforeEach(() => {
    setupDefaultDom();
    setDefaultChromeTabsQuery();
    mockCheckPageStatus.mockResolvedValue({
      domainFilter: { allowed: true, mode: 'disabled' },
      privacy: { isPrivate: false, hasCache: false },
      cache: { hasCache: false },
      lastSaved: { exists: false },
    });
  });

  it('toggles aria-expanded on click', async () => {
    await initStatusPanel();
    const btn = document.getElementById('statusToggleBtn')!;
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    btn.click();
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    btn.click();
    expect(btn.getAttribute('aria-expanded')).toBe('false');
  });

  it('toggles hidden class on details panel', async () => {
    await initStatusPanel();
    const btn = document.getElementById('statusToggleBtn')!;
    const details = document.getElementById('statusDetails')!;
    // Initially no 'hidden' class; toggle('hidden') adds it
    btn.click();
    expect(details.classList.contains('hidden')).toBe(true);
    // Second click: toggle('hidden') removes it
    btn.click();
    expect(details.classList.contains('hidden')).toBe(false);
  });

  it('toggles aria-hidden on details panel', async () => {
    await initStatusPanel();
    const btn = document.getElementById('statusToggleBtn')!;
    const details = document.getElementById('statusDetails')!;
    btn.click();
    // aria-hidden = String(isExpanded_before_click) = String(false) = "false"
    expect(details.getAttribute('aria-hidden')).toBe('false');
    btn.click();
    expect(details.getAttribute('aria-hidden')).toBe('true');
  });

  it('updates toggle text on click', async () => {
    await initStatusPanel();
    const toggleText = document.getElementById('statusToggleText')!;
    const btn = document.getElementById('statusToggleBtn')!;
    btn.click();
    expect(toggleText.textContent).toBe('Hide Details');
    btn.click();
    expect(toggleText.textContent).toBe('Show Details');
  });
});

// ──────────────────────────────────────────────
// initStatusPanel — privacy content branches
// ──────────────────────────────────────────────
describe('initStatusPanel — privacy content', () => {
  beforeEach(setupDefaultDom);

  it('shows reload hint when no cache', async () => {
    setDefaultChromeTabsQuery();
    mockCheckPageStatus.mockResolvedValue({
      domainFilter: { allowed: true, mode: 'disabled' },
      privacy: { isPrivate: false, hasCache: false },
      cache: { hasCache: false },
      lastSaved: { exists: false },
    });
    await initStatusPanel();
    const el = document.getElementById('statusPrivacyContent')!;
    expect(el.textContent).toContain('No information');
    expect(el.textContent).toContain('Reload to check');
  });

  it('shows cache-control private reason', async () => {
    setDefaultChromeTabsQuery();
    mockCheckPageStatus.mockResolvedValue({
      domainFilter: { allowed: true, mode: 'disabled' },
      privacy: { isPrivate: true, hasCache: true, reason: 'cache-control' },
      cache: { hasCache: false },
      lastSaved: { exists: false },
    });
    await initStatusPanel();
    const el = document.getElementById('statusPrivacyContent')!;
    expect(el.textContent).toContain('Cache-Control: private');
  });

  it('shows set-cookie reason', async () => {
    setDefaultChromeTabsQuery();
    mockCheckPageStatus.mockResolvedValue({
      domainFilter: { allowed: true, mode: 'disabled' },
      privacy: { isPrivate: true, hasCache: true, reason: 'set-cookie' },
      cache: { hasCache: false },
      lastSaved: { exists: false },
    });
    await initStatusPanel();
    const el = document.getElementById('statusPrivacyContent')!;
    expect(el.textContent).toContain('Set-Cookie detected');
  });

  it('shows authorization reason', async () => {
    setDefaultChromeTabsQuery();
    mockCheckPageStatus.mockResolvedValue({
      domainFilter: { allowed: true, mode: 'disabled' },
      privacy: { isPrivate: true, hasCache: true, reason: 'authorization' },
      cache: { hasCache: false },
      lastSaved: { exists: false },
    });
    await initStatusPanel();
    const el = document.getElementById('statusPrivacyContent')!;
    expect(el.textContent).toContain('Authorization detected');
  });

  it('shows public page when not private', async () => {
    setDefaultChromeTabsQuery();
    mockCheckPageStatus.mockResolvedValue({
      domainFilter: { allowed: true, mode: 'disabled' },
      privacy: { isPrivate: false, hasCache: true },
      cache: { hasCache: false },
      lastSaved: { exists: false },
    });
    await initStatusPanel();
    const el = document.getElementById('statusPrivacyContent')!;
    expect(el.textContent).toContain('Public page');
  });
});

// ──────────────────────────────────────────────
// initStatusPanel — cache content branches
// ──────────────────────────────────────────────
describe('initStatusPanel — cache content', () => {
  beforeEach(() => {
    setupDefaultDom();
    setDefaultChromeTabsQuery();
  });

  it('shows no info when no cache', async () => {
    mockCheckPageStatus.mockResolvedValue({
      domainFilter: { allowed: true, mode: 'disabled' },
      privacy: { isPrivate: false, hasCache: false },
      cache: { hasCache: false },
      lastSaved: { exists: false },
    });
    await initStatusPanel();
    const el = document.getElementById('statusCacheContent')!;
    expect(el.textContent).toContain('No information');
  });

  it('shows cache-control value when present', async () => {
    mockCheckPageStatus.mockResolvedValue({
      domainFilter: { allowed: true, mode: 'disabled' },
      privacy: { isPrivate: false, hasCache: false },
      cache: { hasCache: true, cacheControl: 'public, max-age=3600', hasCookie: false, hasAuth: false },
      lastSaved: { exists: false },
    });
    await initStatusPanel();
    const el = document.getElementById('statusCacheContent')!;
    expect(el.textContent).toContain('Cache-Control:');
    expect(el.textContent).toContain('public, max-age=3600');
  });

  it('shows cookie and auth presence', async () => {
    mockCheckPageStatus.mockResolvedValue({
      domainFilter: { allowed: true, mode: 'disabled' },
      privacy: { isPrivate: false, hasCache: false },
      cache: { hasCache: true, cacheControl: '', hasCookie: true, hasAuth: true },
      lastSaved: { exists: false },
    });
    await initStatusPanel();
    const el = document.getElementById('statusCacheContent')!;
    expect(el.textContent).toContain('Cookie present');
    expect(el.textContent).toContain('Authorization present');
  });

  it('shows no cache info when hasCache but no details', async () => {
    mockCheckPageStatus.mockResolvedValue({
      domainFilter: { allowed: true, mode: 'disabled' },
      privacy: { isPrivate: false, hasCache: false },
      cache: { hasCache: true, cacheControl: '', hasCookie: false, hasAuth: false },
      lastSaved: { exists: false },
    });
    await initStatusPanel();
    const el = document.getElementById('statusCacheContent')!;
    expect(el.textContent).toContain('No cache info');
  });
});

// ──────────────────────────────────────────────
// initStatusPanel — last saved content
// ──────────────────────────────────────────────
describe('initStatusPanel — last saved', () => {
  beforeEach(() => {
    setupDefaultDom();
    setDefaultChromeTabsQuery();
  });

  it('shows not saved when lastSaved does not exist', async () => {
    mockCheckPageStatus.mockResolvedValue({
      domainFilter: { allowed: true, mode: 'disabled' },
      privacy: { isPrivate: false, hasCache: false },
      cache: { hasCache: false },
      lastSaved: { exists: false },
    });
    await initStatusPanel();
    const el = document.getElementById('statusLastSavedContent')!;
    expect(el.textContent).toContain('Not saved');
  });

  it('shows time when lastSaved exists', async () => {
    mockCheckPageStatus.mockResolvedValue({
      domainFilter: { allowed: true, mode: 'disabled' },
      privacy: { isPrivate: false, hasCache: false },
      cache: { hasCache: false },
      lastSaved: { exists: true, timeAgo: '2 min ago', formatted: '2024-01-15 10:30' },
    });
    await initStatusPanel();
    const el = document.getElementById('statusLastSavedContent')!;
    expect(el.textContent).toContain('2 min ago');
    expect(el.textContent).toContain('2024-01-15 10:30');
  });
});

// ──────────────────────────────────────────────
// initStatusPanel — domain filter display
// ──────────────────────────────────────────────
describe('initStatusPanel — domain filter display', () => {
  beforeEach(() => {
    setupDefaultDom();
    setDefaultChromeTabsQuery();
  });

  it('shows allowed state and matched pattern', async () => {
    mockCheckPageStatus.mockResolvedValue({
      domainFilter: { allowed: true, mode: 'whitelist', matched: true, matchedPattern: '*.example.com' },
      privacy: { isPrivate: false, hasCache: false },
      cache: { hasCache: false },
      lastSaved: { exists: false },
    });
    await initStatusPanel();
    const el = document.getElementById('statusDomainState')!;
    expect(el.textContent).toContain('Allowed');
    expect(el.textContent).toContain('*.example.com');
  });

  it('shows blocked state and filter mode', async () => {
    mockCheckPageStatus.mockResolvedValue({
      domainFilter: { allowed: false, mode: 'blacklist', matched: true },
      privacy: { isPrivate: false, hasCache: false },
      cache: { hasCache: false },
      lastSaved: { exists: false },
    });
    await initStatusPanel();
    const el = document.getElementById('statusDomainState')!;
    expect(el.textContent).toContain('Blocked');
    const modeEl = document.getElementById('statusDomainMode')!;
    expect(modeEl.textContent).toContain('Blacklist');
  });

  it('sets domain icon aria-label for blocked', async () => {
    mockCheckPageStatus.mockResolvedValue({
      domainFilter: { allowed: false, mode: 'disabled' },
      privacy: { isPrivate: false, hasCache: false },
      cache: { hasCache: false },
      lastSaved: { exists: false },
    });
    await initStatusPanel();
    const icon = document.getElementById('statusDomainIcon')!;
    expect(icon.getAttribute('aria-label')).toBe('Blocked');
  });

  it('sets domain icon aria-label for allowed', async () => {
    mockCheckPageStatus.mockResolvedValue({
      domainFilter: { allowed: true, mode: 'disabled' },
      privacy: { isPrivate: false, hasCache: false },
      cache: { hasCache: false },
      lastSaved: { exists: false },
    });
    await initStatusPanel();
    const icon = document.getElementById('statusDomainIcon')!;
    expect(icon.getAttribute('aria-label')).toBe('Recordable');
  });
});

// ──────────────────────────────────────────────
// initStatusPanel — privacy icon display
// ──────────────────────────────────────────────
describe('initStatusPanel — privacy icon', () => {
  beforeEach(() => {
    setupDefaultDom();
    setDefaultChromeTabsQuery();
  });

  it('sets privacy icon to warning for private page', async () => {
    mockCheckPageStatus.mockResolvedValue({
      domainFilter: { allowed: true, mode: 'disabled' },
      privacy: { isPrivate: true, hasCache: true },
      cache: { hasCache: false },
      lastSaved: { exists: false },
    });
    await initStatusPanel();
    const icon = document.getElementById('statusPrivacyIcon')!;
    expect(icon.className).toContain('status-warning');
    expect(icon.getAttribute('aria-label')).toBe('Private page detected');
  });

  it('sets privacy icon to muted when no info', async () => {
    mockCheckPageStatus.mockResolvedValue({
      domainFilter: { allowed: true, mode: 'disabled' },
      privacy: { isPrivate: false, hasCache: false },
      cache: { hasCache: false },
      lastSaved: { exists: false },
    });
    await initStatusPanel();
    const icon = document.getElementById('statusPrivacyIcon')!;
    expect(icon.className).toContain('status-muted');
    expect(icon.getAttribute('aria-label')).toBe('No information');
  });
});

// ──────────────────────────────────────────────
// initStatusPanel — no tab URL
// ──────────────────────────────────────────────
describe('initStatusPanel — no tab URL', () => {
  beforeEach(setupDefaultDom);

  it('hides panel when tab has no url', async () => {
    vi.stubGlobal('chrome', {
      ...chrome,
      tabs: {
        ...chrome.tabs,
        query: vi.fn().mockResolvedValue([{ url: undefined, id: 1 }]),
      },
    });
    await initStatusPanel();
    const panel = document.getElementById('statusPanel')!;
    expect(panel.style.display).toBe('none');
  });
});

// ──────────────────────────────────────────────
// initStatusPanel — recordBtn domain blocked
// ──────────────────────────────────────────────
describe('initStatusPanel — recordBtn with blocked domain', () => {
  beforeEach(() => {
    setupDefaultDom();
    setDefaultChromeTabsQuery();
    const fn = vi.fn();
    setRecordCurrentPageFn(fn);
  });

  it('sets recordBtn text to forceRecordAnyway when domain blocked', async () => {
    mockCheckPageStatus.mockResolvedValue({
      domainFilter: { allowed: false, mode: 'blacklist', matched: true },
      privacy: { isPrivate: false, hasCache: false },
      cache: { hasCache: false },
      lastSaved: { exists: false },
    });
    await initStatusPanel();
    const btn = document.getElementById('recordBtn') as HTMLButtonElement;
    expect(btn.textContent).toBe('Record Anyway');
  });

  it('calls record fn with force=true when domain blocked and btn clicked', async () => {
    const fn = vi.fn();
    setRecordCurrentPageFn(fn);
    mockCheckPageStatus.mockResolvedValue({
      domainFilter: { allowed: false, mode: 'blacklist', matched: true },
      privacy: { isPrivate: false, hasCache: false },
      cache: { hasCache: false },
      lastSaved: { exists: false },
    });
    await initStatusPanel();
    const btn = document.getElementById('recordBtn') as HTMLButtonElement;
    btn.click();
    expect(fn).toHaveBeenCalledWith(true);
  });
});

// ──────────────────────────────────────────────
// getCleansedReasonText — all branches
// ──────────────────────────────────────────────
describe('getCleansedReasonText — full coverage', () => {
  it('returns empty for undefined', () => {
    expect(getCleansedReasonText(undefined)).toBe('');
  });

  it('returns empty for none', () => {
    expect(getCleansedReasonText('none')).toBe('');
  });

  it('returns hard badge text', () => {
    expect(getCleansedReasonText('hard')).toContain('Hard');
  });

  it('returns keyword badge text', () => {
    expect(getCleansedReasonText('keyword')).toContain('Keyword');
  });

  it('returns both badge text', () => {
    expect(getCleansedReasonText('both')).toContain('Both');
  });
});

// ──────────────────────────────────────────────
// updateCleansingStatus — edge cases
// ──────────────────────────────────────────────
describe('updateCleansingStatus — edge cases', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="statusCleansingContent"></div>';
  });

  it('shows reason badge when cleansedReason is provided and totalRemoved > 0', () => {
    updateCleansingStatus({ totalRemoved: 1, hardStripRemoved: 0, keywordStripRemoved: 0 }, 'both');
    const el = document.getElementById('statusCleansingContent')!;
    expect(el.textContent).toContain('Both');
  });

  it('includes total even when hard and keyword are zero', () => {
    updateCleansingStatus({ totalRemoved: 2, hardStripRemoved: 0, keywordStripRemoved: 0 });
    const el = document.getElementById('statusCleansingContent')!;
    expect(el.textContent).toContain('Total: 2');
  });
});
