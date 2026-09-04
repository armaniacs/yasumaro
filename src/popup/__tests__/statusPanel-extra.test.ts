// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockGetCurrentTab,
  mockGetMessage,
  mockIsAllUrlsPermitted,
  mockIsHostPermitted,
  mockGetTrustLevelDisplay,
  mockCheckDomainTrust,
  mockCheckPageStatus,
} = vi.hoisted(() => ({
  mockGetCurrentTab: vi.fn(),
  mockGetMessage: vi.fn(),
  mockIsAllUrlsPermitted: vi.fn(),
  mockIsHostPermitted: vi.fn(),
  mockGetTrustLevelDisplay: vi.fn(),
  mockCheckDomainTrust: vi.fn(),
  mockCheckPageStatus: vi.fn(),
}));
const mockGetAll = vi.hoisted(() => vi.fn());
const mockSetAll = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockGetMany = vi.hoisted(() => vi.fn());
const mockRecordDeniedVisit = vi.hoisted(() => vi.fn());
const mockRequestPermission = vi.hoisted(() => vi.fn());
const mockRequestAllUrls = vi.hoisted(() => vi.fn());
const mockExtractDomain = vi.hoisted(() => vi.fn((url: string) => {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return null; }
}));

vi.mock('../tabUtils.js', () => ({ getCurrentTab: mockGetCurrentTab }));

vi.mock('../../utils/storage/types.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, StorageKeys: { ...(actual.StorageKeys as Record<string, unknown>), DOMAIN_WHITELIST: 'domain_whitelist', PRIVACY_MODE: 'privacy_mode' } };
});
vi.mock('../../utils/storage/SettingsRepository.js', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return { ...actual, settingsRepository: { getAll: mockGetAll, setAll: mockSetAll, getMany: mockGetMany }, SettingsRepository: class { getAll = mockGetAll; setAll = mockSetAll; getMany = mockGetMany } };
});

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

vi.mock('../../utils/domainUtils.js', () => ({
  extractDomain: mockExtractDomain,
}));

vi.mock('../../utils/storage.js', () => ({
  saveSettings: mockSetAll,
}));

import {
  initStatusPanel,
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
  mockGetAll.mockResolvedValue({ privacy_mode: 'full_pipeline' });
  mockIsAllUrlsPermitted.mockResolvedValue(true);
  mockIsHostPermitted.mockResolvedValue(true);
});

// NOTE (PBI 2026-09-05-06): the statusPanel recordBtn onclick rewrite was dead
// in production (main.ts never set the hook), so its hook and the tests
// covering it were deleted. The session owns button wiring exclusively.

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
    mockGetAll.mockResolvedValue({ privacy_mode: 'local_only' });
    await initStatusPanel();
    const badge = document.getElementById('statusModeBadge')!;
    expect(badge.textContent).toBe('Local');
    expect(badge.className).toContain('mode-local_only');
  });

  it('shows mode badge for masked_cloud', async () => {
    mockGetAll.mockResolvedValue({ privacy_mode: 'masked_cloud' });
    await initStatusPanel();
    const badge = document.getElementById('statusModeBadge')!;
    expect(badge.textContent).toBe('Masked');
    expect(badge.className).toContain('mode-masked_cloud');
  });

  it('shows mode badge for full_pipeline', async () => {
    mockGetAll.mockResolvedValue({ privacy_mode: 'full_pipeline' });
    await initStatusPanel();
    const badge = document.getElementById('statusModeBadge')!;
    expect(badge.textContent).toBe('Full');
    expect(badge.className).toContain('mode-full_pipeline');
  });

  it('shows mode badge for unknown mode with fallback', async () => {
    mockGetAll.mockResolvedValue({ privacy_mode: 'unknown_mode' });
    await initStatusPanel();
    const badge = document.getElementById('statusModeBadge')!;
    expect(badge.textContent).toBe('Cloud');
  });

  it('handles missing mode badge element gracefully', async () => {
    document.getElementById('statusModeBadge')!.remove();
    await expect(initStatusPanel()).resolves.not.toThrow();
  });

  it('tolerates mode badge settings error silently', async () => {
    mockGetAll.mockRejectedValueOnce(new Error('storage fail'));
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

  it('handles undefined cleanseStats', () => {
    updateCleansingStatus(undefined as any);
    const el = document.getElementById('statusCleansingContent')!;
    expect(el.textContent).toContain('No cleansing');
  });

  it('handles null cleanseStats', () => {
    updateCleansingStatus(null as any);
    const el = document.getElementById('statusCleansingContent')!;
    expect(el.textContent).toContain('No cleansing');
  });

  it('does not render reason badge when cleansedReason is none', () => {
    updateCleansingStatus({ totalRemoved: 3, hardStripRemoved: 3, keywordStripRemoved: 0 }, 'none');
    const el = document.getElementById('statusCleansingContent')!;
    expect(el.textContent).not.toContain('Both');
    expect(el.textContent).toContain('Hard: 3');
  });

  it('renders only reason when hard/keyword are zero but total >0', () => {
    updateCleansingStatus({ totalRemoved: 5, hardStripRemoved: 0, keywordStripRemoved: 0 }, 'hard');
    const el = document.getElementById('statusCleansingContent')!;
    expect(el.textContent).toContain('Hard');
    expect(el.textContent).toContain('Total: 5');
  });
});

// ──────────────────────────────────────────────
// getCleansedReasonText — fallback and default
// ──────────────────────────────────────────────
describe('getCleansedReasonText — fallback branches', () => {
  it('returns empty for unknown value (default branch)', () => {
    expect(getCleansedReasonText('unexpected' as any)).toBe('');
  });

  it('falls back when getMessage returns empty for hard', () => {
    const orig = mockGetMessage.getMockImplementation();
    mockGetMessage.mockImplementation((key: string) => {
      if (key === 'cleansedBadgeHard') return '';
      return defaultMessages[key] || key;
    });
    // hard should return fallback '🧹 Hard' when i18n empty
    const result = getCleansedReasonText('hard');
    expect(result).toBe('🧹 Hard');
    if (orig) mockGetMessage.mockImplementation(orig as any);
    else mockGetMessage.mockImplementation((key: string) => defaultMessages[key] || key);
  });

  it('falls back when getMessage returns empty for keyword', () => {
    const orig = mockGetMessage.getMockImplementation();
    mockGetMessage.mockImplementation((key: string) => {
      if (key === 'cleansedBadgeKeyword') return '';
      return defaultMessages[key] || key;
    });
    expect(getCleansedReasonText('keyword')).toBe('🧹 Keyword');
    if (orig) mockGetMessage.mockImplementation(orig as any);
    else mockGetMessage.mockImplementation((key: string) => defaultMessages[key] || key);
  });

  it('falls back when getMessage returns empty for both', () => {
    const orig = mockGetMessage.getMockImplementation();
    mockGetMessage.mockImplementation((key: string) => {
      if (key === 'cleansedBadgeBoth') return '';
      return defaultMessages[key] || key;
    });
    expect(getCleansedReasonText('both')).toBe('🧹 Both');
    if (orig) mockGetMessage.mockImplementation(orig as any);
    else mockGetMessage.mockImplementation((key: string) => defaultMessages[key] || key);
  });
});

// ──────────────────────────────────────────────
// initStatusPanel — additional branch coverage
// ──────────────────────────────────────────────
describe('initStatusPanel — additional branches', () => {
  beforeEach(() => {
    setupDefaultDom();
    setDefaultChromeTabsQuery();
    mockGetAll.mockResolvedValue({ privacy_mode: 'full_pipeline' });
  });

  it('covers fallback when privacy_mode missing (branch 1)', async () => {
    mockGetAll.mockResolvedValue({});
    mockCheckPageStatus.mockResolvedValue({
      domainFilter: { allowed: true, mode: 'disabled' },
      privacy: { isPrivate: false, hasCache: false },
      cache: { hasCache: false },
      lastSaved: { exists: false },
    });
    await initStatusPanel();
    const badge = document.getElementById('statusModeBadge')!;
    expect(badge.className).toContain('mode-full_pipeline');
  });

  it('covers settings falsy branch (branch 0 else)', async () => {
    mockGetAll.mockResolvedValue(null as any);
    mockCheckPageStatus.mockResolvedValue({
      domainFilter: { allowed: true, mode: 'disabled' },
      privacy: { isPrivate: false, hasCache: false },
      cache: { hasCache: false },
      lastSaved: { exists: false },
    });
    await expect(initStatusPanel()).resolves.not.toThrow();
  });

  it('covers getMessage fallback for mode badge (branch 6)', async () => {
    const orig = mockGetMessage.getMockImplementation();
    mockGetMessage.mockImplementation((key: string) => {
      if (key === 'privacyModeFullPipelineShort') return '';
      return defaultMessages[key] || key;
    });
    mockCheckPageStatus.mockResolvedValue({
      domainFilter: { allowed: true, mode: 'disabled' },
      privacy: { isPrivate: false, hasCache: false },
      cache: { hasCache: false },
      lastSaved: { exists: false },
    });
    await initStatusPanel();
    const badge = document.getElementById('statusModeBadge')!;
    expect(badge.textContent).toBe('full_pipeline');
    if (orig) mockGetMessage.mockImplementation(orig as any);
    else mockGetMessage.mockImplementation((key: string) => defaultMessages[key] || key);
  });

  it('shows cloud_only mode correctly', async () => {
    mockGetAll.mockResolvedValue({ privacy_mode: 'cloud_only' });
    mockCheckPageStatus.mockResolvedValue({
      domainFilter: { allowed: true, mode: 'disabled' },
      privacy: { isPrivate: false, hasCache: false },
      cache: { hasCache: false },
      lastSaved: { exists: false },
    });
    await initStatusPanel();
    const badge = document.getElementById('statusModeBadge')!;
    expect(badge.textContent).toBe('Cloud');
    expect(badge.className).toContain('mode-cloud_only');
  });

  it('hides panel when tab url undefined but panel missing', async () => {
    document.body.innerHTML = '';
    vi.stubGlobal('chrome', {
      // @ts-ignore
      ...global.chrome,
      tabs: {
        ...global.chrome.tabs,
        query: vi.fn().mockResolvedValue([{ url: undefined, id: 1 }]),
        sendMessage: vi.fn(),
      },
    });
    await expect(initStatusPanel()).resolves.not.toThrow();
  });

  it('calls updateCleansingStatus via sendMessage success path', async () => {
    mockCheckPageStatus.mockResolvedValue({
      domainFilter: { allowed: true, mode: 'disabled' },
      privacy: { isPrivate: false, hasCache: false },
      cache: { hasCache: false },
      lastSaved: { exists: false },
    });
    const fakeTab = { url: 'https://example.com', id: 42 };
    vi.stubGlobal('chrome', {
      // @ts-ignore
      ...global.chrome,
      tabs: {
        query: vi.fn().mockResolvedValue([fakeTab]),
        sendMessage: vi.fn((tabId: number, msg: any, cb: any) => {
          expect(tabId).toBe(42);
          expect(msg.type).toBe('GET_CONTENT');
          cb({ cleanseStats: { totalRemoved: 3, hardStripRemoved: 2, keywordStripRemoved: 1 }, cleansedReason: 'both' });
        }),
      },
      runtime: { lastError: null, sendMessage: vi.fn() },
    });
    await initStatusPanel();
    // Allow callback to run
    await new Promise((r) => setTimeout(r, 0));
    const cleansing = document.getElementById('statusCleansingContent')!;
    expect(cleansing.textContent).toContain('Total: 3');
  });

  it('handles sendMessage with lastError branch', async () => {
    mockCheckPageStatus.mockResolvedValue({
      domainFilter: { allowed: true, mode: 'disabled' },
      privacy: { isPrivate: false, hasCache: false },
      cache: { hasCache: false },
      lastSaved: { exists: false },
    });
    const fakeTab = { url: 'https://example.com', id: 99 };
    vi.stubGlobal('chrome', {
      // @ts-ignore
      ...global.chrome,
      tabs: {
        query: vi.fn().mockResolvedValue([fakeTab]),
        sendMessage: vi.fn((tabId: number, msg: any, cb: any) => {
          // @ts-ignore
          global.chrome.runtime.lastError = { message: 'fail' };
          cb(undefined);
        }),
      },
      runtime: { lastError: { message: 'fail' }, sendMessage: vi.fn() },
    });
    await initStatusPanel();
    await new Promise((r) => setTimeout(r, 0));
    // should not throw and cleansing stays muted
    const cleansing = document.getElementById('statusCleansingContent')!;
    expect(cleansing).toBeTruthy();
    // @ts-ignore reset
    global.chrome.runtime.lastError = null;
  });

  it('handles toggle button with missing elements gracefully', async () => {
    // Remove toggleText
    document.getElementById('statusToggleText')!.remove();
    mockCheckPageStatus.mockResolvedValue({
      domainFilter: { allowed: true, mode: 'disabled' },
      privacy: { isPrivate: false, hasCache: false },
      cache: { hasCache: false },
      lastSaved: { exists: false },
    });
    await initStatusPanel();
    const btn = document.getElementById('statusToggleBtn')!;
    btn.click();
    expect(btn.getAttribute('aria-expanded')).toBe('true');
  });

  it('skips trust status update when tab url is missing', async () => {
    // ensure updateTrustStatus not called when url undefined — panel hidden
    vi.stubGlobal('chrome', {
      // @ts-ignore
      ...global.chrome,
      tabs: {
        query: vi.fn().mockResolvedValue([{ url: undefined, id: 1 }]),
        sendMessage: vi.fn(),
      },
    });
    await initStatusPanel();
    expect(document.getElementById('statusPanel')?.style.display).toBe('none');
  });
});

// ──────────────────────────────────────────────
// initStatusPanel — missing DOM elements branches
// ──────────────────────────────────────────────
describe('initStatusPanel — missing DOM branches', () => {
  it('handles missing domainIcon and privacyIcon gracefully', async () => {
    document.body.innerHTML = [
      '<div id="statusPanel">',
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
      '  <button id="recordBtn"></button>',
      '</div>',
    ].join('\n');
    setDefaultChromeTabsQuery();
    mockCheckPageStatus.mockResolvedValue({
      domainFilter: { allowed: true, mode: 'disabled' },
      privacy: { isPrivate: false, hasCache: false },
      cache: { hasCache: false },
      lastSaved: { exists: false },
    });
    await expect(initStatusPanel()).resolves.not.toThrow();
  });

  it('handles missing statusDomainState and others', async () => {
    document.body.innerHTML = '<div id="statusPanel"><div id="statusModeBadge"></div><button id="recordBtn"></button></div>';
    setDefaultChromeTabsQuery();
    mockCheckPageStatus.mockResolvedValue({
      domainFilter: { allowed: false, mode: 'blacklist', matchedPattern: 'x' },
      privacy: { isPrivate: true, hasCache: true, reason: 'cache-control' },
      cache: { hasCache: true, cacheControl: 'no-cache', hasCookie: true, hasAuth: true },
      lastSaved: { exists: true, timeAgo: '', formatted: '' },
    });
    await expect(initStatusPanel()).resolves.not.toThrow();
  });

  it('covers lastSaved with missing timeAgo/formatted', async () => {
    setupDefaultDom();
    setDefaultChromeTabsQuery();
    mockCheckPageStatus.mockResolvedValue({
      domainFilter: { allowed: true, mode: 'disabled' },
      privacy: { isPrivate: false, hasCache: false },
      cache: { hasCache: false },
      lastSaved: { exists: true, timeAgo: undefined as any, formatted: undefined as any },
    });
    await initStatusPanel();
    const el = document.getElementById('statusLastSavedContent')!;
    expect(el.innerHTML).toContain('status-value');
  });

  it('covers error path in outer catch', async () => {
    document.body.innerHTML = '<div id="statusPanel"></div>';
    vi.stubGlobal('chrome', {
      // @ts-ignore
      ...global.chrome,
      tabs: {
        query: vi.fn().mockRejectedValue(new Error('boom')),
        sendMessage: vi.fn(),
      },
    });
    await initStatusPanel();
    const panel = document.getElementById('statusPanel')!;
    expect(panel.style.display).toBe('none');
  });

  it('covers error path when panel missing in catch', async () => {
    document.body.innerHTML = '';
    vi.stubGlobal('chrome', {
      // @ts-ignore
      ...global.chrome,
      tabs: {
        query: vi.fn().mockRejectedValue(new Error('boom')),
        sendMessage: vi.fn(),
      },
    });
    await expect(initStatusPanel()).resolves.not.toThrow();
  });
});

// ──────────────────────────────────────────────
// attachPrivacyActionListeners — core branches (374-390, 398-412)
// ──────────────────────────────────────────────
describe('attachPrivacyActionListeners — addDomain/addPath branches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMessage.mockImplementation((key: string, subs?: any) => {
      let msg = defaultMessages[key] || key;
      if (subs) {
        const arr = Array.isArray(subs) ? subs : [subs];
        arr.forEach((s: string, i: number) => { msg = msg.replace(`{${i}}`, s); });
      }
      return msg;
    });
    mockGetAll.mockResolvedValue({ privacy_mode: 'full_pipeline', domain_whitelist: [] });
    mockSetAll.mockResolvedValue(undefined);
    mockExtractDomain.mockImplementation((url: string) => {
      try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return null; }
    });
    mockGetCurrentTab.mockResolvedValue({ url: 'https://example.com/page', id: 1 });
  });

  async function initPrivatePanel() {
    setupDefaultDom();
    setDefaultChromeTabsQuery();
    // ensure mainStatus exists for branch
    document.body.insertAdjacentHTML('beforeend', '<div id="mainStatus"></div>');
    mockCheckPageStatus.mockResolvedValue({
      domainFilter: { allowed: true, mode: 'disabled' },
      privacy: { isPrivate: true, hasCache: true, reason: 'cache-control' },
      cache: { hasCache: false },
      lastSaved: { exists: false },
    });
    await initStatusPanel();
  }

  it('addDomain: success path — adds domain, updates statusDiv, re-inits', async () => {
    mockGetAll.mockResolvedValue({ domain_whitelist: [] });
    mockExtractDomain.mockReturnValue('example.com');
    await initPrivatePanel();
    const btn = document.getElementById('statusAddDomain') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    btn.click();
    await new Promise((r) => setTimeout(r, 20));
    expect(mockGetCurrentTab).toHaveBeenCalled();
    expect(mockExtractDomain).toHaveBeenCalledWith('https://example.com/page');
    expect(mockSetAll).toHaveBeenCalled();
    const savedArg = mockSetAll.mock.calls[0][0];
    expect(savedArg.domain_whitelist).toContain('example.com');
    expect(document.getElementById('mainStatus')!.textContent).toContain('Domain added');
    expect(document.getElementById('mainStatus')!.className).toBe('success');
  });

  it('addDomain: domain already in whitelist — skips save', async () => {
    mockGetAll.mockResolvedValue({ domain_whitelist: ['example.com'] });
    mockExtractDomain.mockReturnValue('example.com');
    await initPrivatePanel();
    const btn = document.getElementById('statusAddDomain') as HTMLButtonElement;
    btn.click();
    await new Promise((r) => setTimeout(r, 20));
    expect(mockSetAll).not.toHaveBeenCalled();
  });

  it('addDomain: tab.url undefined — early return', async () => {
    mockGetCurrentTab.mockResolvedValue({ url: undefined } as any);
    await initPrivatePanel();
    const btn = document.getElementById('statusAddDomain') as HTMLButtonElement;
    btn.click();
    await new Promise((r) => setTimeout(r, 20));
    expect(mockSetAll).not.toHaveBeenCalled();
  });

  it('addDomain: getCurrentTab returns null — early return', async () => {
    mockGetCurrentTab.mockResolvedValue(null as any);
    await initPrivatePanel();
    const btn = document.getElementById('statusAddDomain') as HTMLButtonElement;
    btn.click();
    await new Promise((r) => setTimeout(r, 20));
    expect(mockSetAll).not.toHaveBeenCalled();
  });

  it('addDomain: extractDomain returns null — early return', async () => {
    mockExtractDomain.mockReturnValue(null);
    await initPrivatePanel();
    const btn = document.getElementById('statusAddDomain') as HTMLButtonElement;
    btn.click();
    await new Promise((r) => setTimeout(r, 20));
    expect(mockSetAll).not.toHaveBeenCalled();
  });

  it('addDomain: extractDomain returns empty string — early return', async () => {
    mockExtractDomain.mockReturnValue('' as any);
    await initPrivatePanel();
    const btn = document.getElementById('statusAddDomain') as HTMLButtonElement;
    btn.click();
    await new Promise((r) => setTimeout(r, 20));
    expect(mockSetAll).not.toHaveBeenCalled();
  });

  it('addDomain: whitelist undefined falls back to []', async () => {
    mockGetAll.mockResolvedValue({}); // no whitelist
    mockExtractDomain.mockReturnValue('example.com');
    await initPrivatePanel();
    const btn = document.getElementById('statusAddDomain') as HTMLButtonElement;
    btn.click();
    await new Promise((r) => setTimeout(r, 20));
    expect(mockSetAll).toHaveBeenCalled();
    expect(mockSetAll.mock.calls[0][0].domain_whitelist).toContain('example.com');
  });

  it('addDomain: statusDiv missing — still saves but no DOM update', async () => {
    mockGetAll.mockResolvedValue({ domain_whitelist: [] });
    mockExtractDomain.mockReturnValue('example.com');
    await initPrivatePanel();
    document.getElementById('mainStatus')!.remove();
    const btn = document.getElementById('statusAddDomain') as HTMLButtonElement;
    btn.click();
    await new Promise((r) => setTimeout(r, 20));
    expect(mockSetAll).toHaveBeenCalled();
  });

  it('addDomain: getMessage fallback when empty', async () => {
    mockGetAll.mockResolvedValue({ domain_whitelist: [] });
    mockExtractDomain.mockReturnValue('example.com');
    const orig = mockGetMessage.getMockImplementation();
    mockGetMessage.mockImplementation((key: string) => {
      if (key === 'domainAddedToWhitelist') return '';
      return defaultMessages[key] || key;
    });
    await initPrivatePanel();
    const btn = document.getElementById('statusAddDomain') as HTMLButtonElement;
    btn.click();
    await new Promise((r) => setTimeout(r, 20));
    expect(document.getElementById('mainStatus')!.textContent).toContain('Added example.com');
    if (orig) mockGetMessage.mockImplementation(orig as any);
  });

  it('addPath: success path — adds full url', async () => {
    mockGetAll.mockResolvedValue({ domain_whitelist: [] });
    await initPrivatePanel();
    const btn = document.getElementById('statusAddPath') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    btn.click();
    await new Promise((r) => setTimeout(r, 20));
    expect(mockSetAll).toHaveBeenCalled();
    const savedArg = mockSetAll.mock.calls[0][0] as any;
    // Settings repository receives whitelist array containing full URL
    expect(savedArg.domain_whitelist).toContain('https://example.com/page');
    expect(document.getElementById('mainStatus')!.textContent).toContain('Path added');
  });

  it('addPath: url already in whitelist — skips save', async () => {
    mockGetAll.mockResolvedValue({ domain_whitelist: ['https://example.com/page'] });
    await initPrivatePanel();
    const btn = document.getElementById('statusAddPath') as HTMLButtonElement;
    btn.click();
    await new Promise((r) => setTimeout(r, 20));
    expect(mockSetAll).not.toHaveBeenCalled();
  });

  it('addPath: tab.url undefined — early return', async () => {
    mockGetCurrentTab.mockResolvedValue({ url: undefined } as any);
    await initPrivatePanel();
    const btn = document.getElementById('statusAddPath') as HTMLButtonElement;
    btn.click();
    await new Promise((r) => setTimeout(r, 20));
    expect(mockSetAll).not.toHaveBeenCalled();
  });

  it('addPath: tab is null — early return', async () => {
    mockGetCurrentTab.mockResolvedValue(null as any);
    await initPrivatePanel();
    const btn = document.getElementById('statusAddPath') as HTMLButtonElement;
    btn.click();
    await new Promise((r) => setTimeout(r, 20));
    expect(mockSetAll).not.toHaveBeenCalled();
  });

  it('addPath: whitelist undefined fallback', async () => {
    mockGetAll.mockResolvedValue({} as any);
    await initPrivatePanel();
    const btn = document.getElementById('statusAddPath') as HTMLButtonElement;
    btn.click();
    await new Promise((r) => setTimeout(r, 20));
    expect(mockSetAll).toHaveBeenCalled();
  });

  it('addPath: statusDiv missing — still saves', async () => {
    mockGetAll.mockResolvedValue({ domain_whitelist: [] });
    await initPrivatePanel();
    document.getElementById('mainStatus')!.remove();
    const btn = document.getElementById('statusAddPath') as HTMLButtonElement;
    btn.click();
    await new Promise((r) => setTimeout(r, 20));
    expect(mockSetAll).toHaveBeenCalled();
  });

  it('addPath: getMessage fallback when empty', async () => {
    mockGetAll.mockResolvedValue({ domain_whitelist: [] });
    const orig = mockGetMessage.getMockImplementation();
    mockGetMessage.mockImplementation((key: string) => {
      if (key === 'pathAddedToWhitelist') return '';
      return defaultMessages[key] || key;
    });
    await initPrivatePanel();
    const btn = document.getElementById('statusAddPath') as HTMLButtonElement;
    btn.click();
    await new Promise((r) => setTimeout(r, 20));
    expect(document.getElementById('mainStatus')!.textContent).toContain('Added path');
    if (orig) mockGetMessage.mockImplementation(orig as any);
  });

  it('handles missing addDomain/addPath buttons gracefully', async () => {
    setupDefaultDom();
    setDefaultChromeTabsQuery();
    // Remove buttons before init so attachPrivacy finds null
    document.getElementById('statusAddDomain')!.remove();
    document.getElementById('statusAddPath')!.remove();
    // Manually trigger private panel rendering but with no buttons in template
    // We instead call init with private and then ensure no throw when buttons missing
    // The render creates buttons, so we remove them immediately after init before second init
    mockCheckPageStatus.mockResolvedValue({
      domainFilter: { allowed: true, mode: 'disabled' },
      privacy: { isPrivate: true, hasCache: true, reason: 'set-cookie' },
      cache: { hasCache: false },
      lastSaved: { exists: false },
    });
    await initStatusPanel();
    // Remove the newly created buttons to simulate missing
    document.getElementById('statusAddDomain')?.remove();
    document.getElementById('statusAddPath')?.remove();
    // Re-run attach via another private init without buttons present in DOM at attach time
    mockCheckPageStatus.mockResolvedValue({
      domainFilter: { allowed: true, mode: 'disabled' },
      privacy: { isPrivate: true, hasCache: true, reason: 'authorization' },
      cache: { hasCache: false },
      lastSaved: { exists: false },
    });
    // Temporarily remove privacyContent to skip rendering? Instead directly ensure no error
    await expect(initStatusPanel()).resolves.not.toThrow();
  });
});

describe('additional branch coverage — trust and record fallback', () => {
  beforeEach(() => {
    setupDefaultDom();
    setDefaultChromeTabsQuery();
    mockGetAll.mockResolvedValue({ privacy_mode: 'full_pipeline' });
    vi.clearAllMocks();
    mockGetMessage.mockImplementation((key: string, subs?: any) => {
      let msg = defaultMessages[key] || key;
      if (subs) {
        const arr = Array.isArray(subs) ? subs : [subs];
        arr.forEach((s: string, i: number) => { msg = msg.replace(`{${i}}`, s); });
      }
      return msg;
    });
    mockGetAll.mockResolvedValue({ privacy_mode: 'full_pipeline' });
  });

  it('covers getMessage fallback for trust level (branch 40)', async () => {
    const { updateTrustStatus } = await import('../statusPanel.js');
    document.body.innerHTML = `
      <div id="statusTrustContent"></div>
      <div id="permissionRequestArea" class="hidden"></div>
      <button id="recordBtn"></button>
    `;
    mockIsAllUrlsPermitted.mockResolvedValue(true);
    mockIsHostPermitted.mockResolvedValue(true);
    mockGetTrustLevelDisplay.mockResolvedValue({ level: 'Trusted' });
    mockCheckDomainTrust.mockResolvedValue({ showAlert: false, trustResult: {} });
    const orig = mockGetMessage.getMockImplementation();
    mockGetMessage.mockImplementation((key: string) => {
      if (key === 'statusTrustTrusted') return '';
      return defaultMessages[key] || key;
    });
    await updateTrustStatus('https://example.com');
    const el = document.getElementById('statusTrustContent')!;
    expect(el.textContent).toContain('Trusted');
    if (orig) mockGetMessage.mockImplementation(orig as any);
  });



  it('covers permArea missing branch (177) and updateTrustStatus with no errorMsg', async () => {
    const { updateTrustStatus } = await import('../statusPanel.js');
    document.body.innerHTML = `
      <div id="statusTrustContent"></div>
      <button id="recordBtn"></button>
    `;
    mockIsAllUrlsPermitted.mockResolvedValue(false);
    mockIsHostPermitted.mockResolvedValue(false);
    await updateTrustStatus('https://example.com');
    const el = document.getElementById('statusTrustContent')!;
    expect(el.innerHTML).toContain('LOCKED');
    // click with missing errorMsg should not throw
    const btn = document.getElementById('btnRequestPermission');
    expect(btn).toBeNull();
  });

  it('covers trust denied with no errorMsg element (146,147 else)', async () => {
    const { updateTrustStatus } = await import('../statusPanel.js');
    document.body.innerHTML = `
      <div id="statusTrustContent"></div>
      <div id="permissionRequestArea" class="hidden">
        <button id="btnRequestPermission"></button>
      </div>
      <button id="recordBtn"></button>
    `;
    mockIsAllUrlsPermitted.mockResolvedValue(false);
    mockIsHostPermitted.mockResolvedValue(false);
    mockRequestPermission.mockResolvedValue(false);
    // ensure errorMsg not present
    await updateTrustStatus('https://example.com');
    const btn = document.getElementById('btnRequestPermission') as HTMLButtonElement;
    await btn.click();
    await new Promise((r) => setTimeout(r, 10));
    expect(mockRecordDeniedVisit).toHaveBeenCalled();
  });

  it('covers permission denied animation branch with errorMsg present', async () => {
    vi.useFakeTimers();
    const { updateTrustStatus } = await import('../statusPanel.js');
    document.body.innerHTML = `
      <div id="statusTrustContent"></div>
      <div id="permissionRequestArea" class="hidden">
        <button id="btnRequestPermission"></button>
      </div>
      <button id="recordBtn"></button>
      <div id="permissionDeniedMessage" class="hidden"></div>
    `;
    mockIsAllUrlsPermitted.mockResolvedValue(false);
    mockIsHostPermitted.mockResolvedValue(false);
    mockRequestPermission.mockResolvedValue(false);
    const rafSpy = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb: any) => { cb(0); return 0 as any; });
    await updateTrustStatus('https://example.com');
    const btn = document.getElementById('btnRequestPermission') as HTMLButtonElement;
    await btn.click();
    await Promise.resolve();
    // advance timers for setTimeout 3000 + 300
    await vi.advanceTimersByTimeAsync(3300);
    const err = document.getElementById('permissionDeniedMessage')!;
    expect(err.classList.contains('hidden')).toBe(true);
    rafSpy.mockRestore();
    vi.useRealTimers();
  });

  it('covers initAllUrlsPermissionBanner tabs[0].url missing branch (437)', async () => {
    const { initAllUrlsPermissionBanner } = await import('../statusPanel.js');
    document.body.innerHTML = `
      <div id="allUrlsPermissionBanner" class="hidden"></div>
      <button id="btnRequestAllUrls"></button>
      <div id="statusTrustContent"></div>
    `;
    mockIsAllUrlsPermitted.mockResolvedValue(false);
    const { isAllUrlsPermitted, requestAllUrls } = await import('../../utils/permissionManager.js');
    // Need to mock requestAllUrls to grant
    mockRequestAllUrls.mockResolvedValue(true);
    vi.stubGlobal('chrome', {
      // @ts-ignore
      ...global.chrome,
      tabs: {
        query: vi.fn().mockResolvedValue([{ url: undefined, id: 1 }]),
        sendMessage: vi.fn(),
      },
    });
    await initAllUrlsPermissionBanner();
    const btn = document.getElementById('btnRequestAllUrls') as HTMLButtonElement;
    await btn.click();
    await new Promise((r) => setTimeout(r, 10));
    expect(mockRequestAllUrls).toHaveBeenCalled();
  });

  it('covers missing recordBtn/recordBtn disabled branches (146,153)', async () => {
    const { updateTrustStatus } = await import('../statusPanel.js');
    // missing recordBtn, denied
    document.body.innerHTML = `
      <div id="statusTrustContent"></div>
      <div id="permissionRequestArea" class="hidden">
        <button id="btnRequestPermission"></button>
      </div>
      <div id="permissionDeniedMessage" class="hidden"></div>
    `;
    mockIsAllUrlsPermitted.mockResolvedValue(false);
    mockIsHostPermitted.mockResolvedValue(false);
    await updateTrustStatus('https://example.com');
    expect(document.getElementById('statusTrustContent')!.textContent).toContain('LOCKED');
    // granted path with missing permArea/recordBtn
    document.body.innerHTML = `
      <div id="statusTrustContent"></div>
    `;
    mockIsAllUrlsPermitted.mockResolvedValue(true);
    mockGetTrustLevelDisplay.mockResolvedValue({ level: 'Trusted' });
    mockCheckDomainTrust.mockResolvedValue({ showAlert: false, trustResult: {} });
    await updateTrustStatus('https://example.com');
    expect(document.getElementById('statusTrustContent')!.textContent).toContain('Trusted');
  });
});
