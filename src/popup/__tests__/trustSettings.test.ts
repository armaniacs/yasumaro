// @vitest-environment jsdom
/**
 * trustSettings.test.ts
 * Tests for src/popup/trustSettings.ts
 * Covers init, loadTrustSettings, renderPermissionSuggestList,
 * renderJpAnchorList, renderSensitiveList
 */

import { vi } from 'vitest';;

// Mock dependencies - all at top level
vi.mock('../../utils/trustDb/trustDbSchema.js', () => ({}));

vi.mock('../../utils/storage.js', () => ({
  StorageKeys: {
    PERMISSION_NOTIFY_THRESHOLD: 'permission_notify_threshold',
  },
}));

const mockInitialize = vi.fn(() => Promise.resolve());
const mockGetDatabase = vi.fn(() => ({
  tranco: { tier: 'top10k', count: 10000, lastUpdated: '2025-01-01' },
  lastUpdated: '2025-01-01',
}));
const mockGetJpAnchorTlds = vi.fn(() => ['.jp', '.co.jp']);
const mockGetSensitiveDomains = vi.fn((cat: string) => {
  if (cat === 'finance') return ['bank.com'];
  if (cat === 'gaming') return ['game.com'];
  return ['social.com'];
});
const mockGetWhitelist = vi.fn(() => ['trusted.com']);
const mockAddJpAnchorTld = vi.fn(() => Promise.resolve({ success: true }));
const mockRemoveJpAnchorTld = vi.fn(() => Promise.resolve());
const mockAddSensitiveDomain = vi.fn(() => Promise.resolve({ success: true }));
const mockRemoveSensitiveDomain = vi.fn(() => Promise.resolve());
const mockAddToWhitelist = vi.fn(() => Promise.resolve({ success: true }));
const mockRemoveFromWhitelist = vi.fn(() => Promise.resolve());

vi.mock('../../utils/trustDb/trustDb.js', () => ({
  getTrustDb: vi.fn(() => ({
    initialize: mockInitialize,
    getDatabase: mockGetDatabase,
    getJpAnchorTlds: mockGetJpAnchorTlds,
    getSensitiveDomains: mockGetSensitiveDomains,
    getWhitelist: mockGetWhitelist,
    addJpAnchorTld: mockAddJpAnchorTld,
    removeJpAnchorTld: mockRemoveJpAnchorTld,
    addSensitiveDomain: mockAddSensitiveDomain,
    removeSensitiveDomain: mockRemoveSensitiveDomain,
    addToWhitelist: mockAddToWhitelist,
    removeFromWhitelist: mockRemoveFromWhitelist,
  })),
}));

const mockIsUpdateInProgress = vi.fn(() => false);
const mockUpdateTrancoList = vi.fn(() => Promise.resolve({ success: true, domainsCount: 10000 }));

vi.mock('../../utils/trustDb/trancoUpdater.js', () => ({
  getTrancoUpdater: vi.fn(() => ({
    isUpdateInProgress: mockIsUpdateInProgress,
    updateTrancoList: mockUpdateTrancoList,
  })),
}));

const mockLogInfo = vi.fn();
const mockLogWarn = vi.fn();
const mockLogError = vi.fn();

vi.mock('../../utils/logger.js', () => ({
  logInfo: mockLogInfo,
  logWarn: mockLogWarn,
  logError: mockLogError,
  ErrorCode: { TRANCO_FETCH_FAILED: 'TRANCO_FETCH_FAILED' },
}));

vi.mock('../i18n.js', () => ({
  getMessage: vi.fn((key: string) => {
    const msgs: Record<string, string> = {
      trancoUpdating: 'Updating...',
      trancoNotUpdated: 'Not updated',
      trancoTierTop1k: 'Top 1,000',
      trancoTierTop10k: 'Top 10,000',
      trancoTierTop100k: 'Top 100,000',
      trancoStatusFormat: 'Domains: {count} | Tier: {tier} | Last updated: {lastUpdated}',
      jpAnchorAdded: 'TLD added',
      sensitiveAdded: 'Domain added',
      whitelistAdded: 'Domain added',
      trancoUpdateInProgress: 'Update already in progress',
      trancoUpdateSuccess: 'Tranco list updated successfully',
      safetyModeChanged: 'Safety mode changed',
      settingsSaved: 'Settings saved',
      permissionSuggestCount: ' visits',
      permissionSuggestAdd: 'Allow',
      permissionSuggestDismiss: 'Dismiss',
    };
    return msgs[key] || key;
  }),
}));

const mockGetAlertConfig = vi.fn(() => Promise.resolve({
  alertFinance: false,
  alertSensitive: false,
  alertUnverified: false,
}));
const mockSaveAlertSettings = vi.fn(() => Promise.resolve());

vi.mock('../../utils/trustChecker.js', () => ({
  getTrustChecker: vi.fn(() => ({
    getAlertConfig: mockGetAlertConfig,
    saveAlertSettings: mockSaveAlertSettings,
  })),
}));

const mockGetFrequentDeniedDomains = vi.fn(() => Promise.resolve([]));
const mockRequestPermission = vi.fn(() => Promise.resolve(true));
const mockRemoveDeniedDomain = vi.fn(() => Promise.resolve());
const mockRecordDomainDismissal = vi.fn(() => Promise.resolve());
const mockIsHostPermitted = vi.fn(() => Promise.resolve(false));

vi.mock('../../utils/permissionManager.js', () => ({
  getFrequentDeniedDomains: mockGetFrequentDeniedDomains,
  requestPermission: mockRequestPermission,
  removeDeniedDomain: mockRemoveDeniedDomain,
  recordDomainDismissal: mockRecordDomainDismissal,
  isHostPermitted: mockIsHostPermitted,
}), { virtual: true });

function setupFullDOM() {
  document.body.innerHTML = `
    <select id="safetyMode"><option value="strict">Strict</option><option value="balanced">Balanced</option><option value="relaxed">Relaxed</option></select>
    <select id="trancoTier"><option value="top1k">1k</option><option value="top10k">10k</option><option value="top100k">100k</option></select>
    <div id="trancoStatus"></div>
    <button id="updateTrancoBtn"></button>
    <div id="jpAnchorList"></div>
    <input id="jpAnchorAdd" />
    <button id="jpAnchorAddBtn"></button>
    <div id="sensitiveList"></div>
    <select id="sensitiveCategory"><option value="finance">Finance</option></select>
    <input id="sensitiveAdd" />
    <button id="sensitiveAddBtn"></button>
    <div id="whitelist"></div>
    <input id="whitelistAdd" />
    <button id="whitelistAddBtn"></button>
    <input type="checkbox" id="alertFinance" />
    <input type="checkbox" id="alertSensitive" />
    <input type="checkbox" id="alertUnverified" />
    <button id="saveTrustSettings"></button>
    <div id="trustSettingsStatus"></div>
    <input id="permissionThreshold" value="3" />
    <div id="permissionSuggestSection"></div>
    <div id="permissionSuggestList"></div>
    <button class="category-tab active" data-category="finance"></button>
    <button class="category-tab" data-category="gaming"></button>
    <button class="category-tab" data-category="sns"></button>
  `;
}

describe('trustSettings.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    document.body.innerHTML = '';
  });

  // =========================================================================
  // init()
  // =========================================================================
  describe('init()', () => {
    test('should initialize without errors', async () => {
      setupFullDOM();
      const { init } = await import('../trustSettings.js');
      expect(() => init()).not.toThrow();
    });

    test('should handle missing elements gracefully', async () => {
      document.body.innerHTML = '<div id="jpAnchorList"></div>';
      const { init } = await import('../trustSettings.js');
      expect(() => init()).not.toThrow();
    });

    test('should sync safety mode to tranco tier on change', async () => {
      setupFullDOM();
      const { init } = await import('../trustSettings.js');
      init();

      const safetyModeSelect = document.getElementById('safetyMode') as HTMLSelectElement;
      safetyModeSelect.value = 'strict';
      safetyModeSelect.dispatchEvent(new Event('change'));

      const trancoTierSelect = document.getElementById('trancoTier') as HTMLSelectElement;
      expect(trancoTierSelect.value).toBe('top1k');
    });

    test('should sync tranco tier to safety mode on change', async () => {
      setupFullDOM();
      const { init } = await import('../trustSettings.js');
      init();

      const trancoTierSelect = document.getElementById('trancoTier') as HTMLSelectElement;
      trancoTierSelect.value = 'top100k';
      trancoTierSelect.dispatchEvent(new Event('change'));

      const safetyModeSelect = document.getElementById('safetyMode') as HTMLSelectElement;
      expect(safetyModeSelect.value).toBe('relaxed');
    });

    test('should handle update tranco button click', async () => {
      setupFullDOM();
      const { init } = await import('../trustSettings.js');
      init();

      document.getElementById('updateTrancoBtn')!.click();
      await new Promise(r => setTimeout(r, 10));

      expect(mockUpdateTrancoList).toHaveBeenCalledWith(expect.stringMatching(/top\d+k/));
    });

    test('should handle jp anchor add button click', async () => {
      setupFullDOM();
      const { init } = await import('../trustSettings.js');
      init();

      const input = document.getElementById('jpAnchorAdd') as HTMLInputElement;
      input.value = '.org';
      document.getElementById('jpAnchorAddBtn')!.click();

      await new Promise(r => setTimeout(r, 10));
      expect(mockAddJpAnchorTld).toHaveBeenCalledWith('.org');
    });

    test('should handle jp anchor Enter key', async () => {
      setupFullDOM();
      const { init } = await import('../trustSettings.js');
      init();

      const input = document.getElementById('jpAnchorAdd') as HTMLInputElement;
      input.value = '.net';
      input.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', bubbles: true }));

      await new Promise(r => setTimeout(r, 10));
      expect(mockAddJpAnchorTld).toHaveBeenCalledWith('.net');
    });

    test('should not trigger add on non-Enter key', async () => {
      setupFullDOM();
      const { init } = await import('../trustSettings.js');
      init();

      const input = document.getElementById('jpAnchorAdd') as HTMLInputElement;
      input.value = '.org';
      input.dispatchEvent(new KeyboardEvent('keypress', { key: 'Tab', bubbles: true }));

      await new Promise(r => setTimeout(r, 10));
      expect(mockAddJpAnchorTld).not.toHaveBeenCalled();
    });

    test('should handle save settings button click', async () => {
      setupFullDOM();
      const { init } = await import('../trustSettings.js');
      init();

      document.getElementById('saveTrustSettings')!.click();
      await new Promise(r => setTimeout(r, 10));

      expect(mockSaveAlertSettings).toHaveBeenCalled();
    });

    test('should save threshold on valid change', async () => {
      setupFullDOM();
      const { init } = await import('../trustSettings.js');
      init();

      const thresholdInput = document.getElementById('permissionThreshold') as HTMLInputElement;
      thresholdInput.value = '5';
      thresholdInput.dispatchEvent(new Event('change'));

      await new Promise(r => setTimeout(r, 10));
      expect(chrome.storage.local.set).toHaveBeenCalledWith(
        expect.objectContaining({ permission_notify_threshold: 5 })
      );
    });

    test('should ignore threshold below 1', async () => {
      setupFullDOM();
      const { init } = await import('../trustSettings.js');
      init();

      const thresholdInput = document.getElementById('permissionThreshold') as HTMLInputElement;
      thresholdInput.value = '0';
      thresholdInput.dispatchEvent(new Event('change'));

      await new Promise(r => setTimeout(r, 10));
      expect(chrome.storage.local.set).not.toHaveBeenCalled();
    });

    test('should ignore threshold above 50', async () => {
      setupFullDOM();
      const { init } = await import('../trustSettings.js');
      init();

      const thresholdInput = document.getElementById('permissionThreshold') as HTMLInputElement;
      thresholdInput.value = '51';
      thresholdInput.dispatchEvent(new Event('change'));

      await new Promise(r => setTimeout(r, 10));
      expect(chrome.storage.local.set).not.toHaveBeenCalled();
    });

    test('should handle category tab click', async () => {
      setupFullDOM();
      const { init } = await import('../trustSettings.js');
      init();

      const gamingTab = document.querySelector('[data-category="gaming"]') as HTMLButtonElement;
      gamingTab.click();

      await new Promise(r => setTimeout(r, 10));
      expect(gamingTab.classList.contains('active')).toBe(true);
      expect(
        (document.querySelector('[data-category="finance"]') as HTMLButtonElement).classList.contains('active')
      ).toBe(false);
    });
  });

  // =========================================================================
  // loadTrustSettings()
  // =========================================================================
  describe('loadTrustSettings()', () => {
    test('should load settings and populate UI', async () => {
      setupFullDOM();
      const { loadTrustSettings } = await import('../trustSettings.js');
      await loadTrustSettings();

      expect((document.getElementById('safetyMode') as HTMLSelectElement).value).toBe('balanced');
      expect((document.getElementById('trancoTier') as HTMLSelectElement).value).toBe('top10k');
    });

    test('should handle null database gracefully', async () => {
      mockGetDatabase.mockReturnValueOnce(null as any);

      setupFullDOM();
      const { loadTrustSettings } = await import('../trustSettings.js');
      await expect(loadTrustSettings()).resolves.not.toThrow();
    });

    test('should load alert settings from trust checker', async () => {
      mockGetAlertConfig.mockResolvedValueOnce({
        alertFinance: true,
        alertSensitive: true,
        alertUnverified: false,
      });

      setupFullDOM();
      const { loadTrustSettings } = await import('../trustSettings.js');
      await loadTrustSettings();

      expect((document.getElementById('alertFinance') as HTMLInputElement).checked).toBe(true);
      expect((document.getElementById('alertSensitive') as HTMLInputElement).checked).toBe(true);
    });
  });

  // =========================================================================
  // renderJpAnchorList()
  // =========================================================================
  describe('renderJpAnchorList()', () => {
    test('should render TLD tags with textContent', async () => {
      setupFullDOM();
      const { renderJpAnchorList } = await import('../trustSettings.js');
      renderJpAnchorList(['.jp', '.co.jp']);

      const tags = document.getElementById('jpAnchorList')!.querySelectorAll('.domain-tag');
      expect(tags.length).toBe(2);
      expect(tags[0].querySelector('span')!.textContent).toBe('.jp');
      expect(tags[1].querySelector('span')!.textContent).toBe('.co.jp');
    });

    test('should create remove buttons with aria-labels', async () => {
      setupFullDOM();
      const { renderJpAnchorList } = await import('../trustSettings.js');
      renderJpAnchorList(['.jp']);

      const btn = document.querySelector('.domain-tag-remove') as HTMLButtonElement;
      expect(btn.getAttribute('aria-label')).toBe('Remove .jp');
    });

    test('should handle empty list', async () => {
      setupFullDOM();
      const { renderJpAnchorList } = await import('../trustSettings.js');
      renderJpAnchorList([]);

      expect(document.getElementById('jpAnchorList')!.children.length).toBe(0);
    });

    test('should handle missing jpAnchorList container', async () => {
      document.body.innerHTML = '';
      const { renderJpAnchorList } = await import('../trustSettings.js');
      expect(() => renderJpAnchorList(['.jp'])).not.toThrow();
    });
  });

  // =========================================================================
  // renderSensitiveList()
  // =========================================================================
  describe('renderSensitiveList()', () => {
    test('should render domain tags in sensitive list', async () => {
      setupFullDOM();
      const { renderSensitiveList } = await import('../trustSettings.js');
      renderSensitiveList(['bank.com', 'finance.com']);

      const tags = document.getElementById('sensitiveList')!.querySelectorAll('.domain-tag');
      expect(tags.length).toBe(2);
      expect(tags[0].querySelector('span')!.textContent).toBe('bank.com');
    });

    test('should render domain tags in whitelist when isWhitelist=true', async () => {
      setupFullDOM();
      const { renderSensitiveList } = await import('../trustSettings.js');
      renderSensitiveList(['safe.com'], true);

      const tags = document.getElementById('whitelist')!.querySelectorAll('.domain-tag');
      expect(tags.length).toBe(1);
      expect(tags[0].querySelector('span')!.textContent).toBe('safe.com');
    });

    test('should create remove buttons with aria-labels', async () => {
      setupFullDOM();
      const { renderSensitiveList } = await import('../trustSettings.js');
      renderSensitiveList(['bank.com']);

      const btn = document.querySelector('.domain-tag-remove') as HTMLButtonElement;
      expect(btn.getAttribute('aria-label')).toBe('Remove bank.com');
    });

    test('should handle empty domain list', async () => {
      setupFullDOM();
      const { renderSensitiveList } = await import('../trustSettings.js');
      renderSensitiveList([]);

      expect(document.getElementById('sensitiveList')!.children.length).toBe(0);
    });

    test('should handle missing sensitiveList container', async () => {
      document.body.innerHTML = '';
      const { renderSensitiveList } = await import('../trustSettings.js');
      expect(() => renderSensitiveList(['test.com'])).not.toThrow();
    });

    test('should handle missing whitelist container', async () => {
      document.body.innerHTML = '';
      const { renderSensitiveList } = await import('../trustSettings.js');
      expect(() => renderSensitiveList(['test.com'], true)).not.toThrow();
    });
  });

  // =========================================================================
  // renderPermissionSuggestList()
  // =========================================================================
  describe('renderPermissionSuggestList()', () => {
    test('should return empty array when section is missing', async () => {
      document.body.innerHTML = '';
      const { renderPermissionSuggestList } = await import('../trustSettings.js');
      const result = await renderPermissionSuggestList();
      expect(result).toEqual([]);
    });

    test('should return empty array when no denied domains', async () => {
      mockGetFrequentDeniedDomains.mockResolvedValueOnce([]);
      setupFullDOM();
      const { renderPermissionSuggestList } = await import('../trustSettings.js');
      const result = await renderPermissionSuggestList();
      expect(result).toEqual([]);
    });

    test('should render denied domains with allow/dismiss buttons', async () => {
      mockGetFrequentDeniedDomains.mockResolvedValueOnce([
        { domain: 'blocked.com', count: 5 },
      ]);
      mockIsHostPermitted.mockResolvedValueOnce(false);

      setupFullDOM();
      const { renderPermissionSuggestList } = await import('../trustSettings.js');
      const result = await renderPermissionSuggestList();

      expect(result.length).toBe(1);
      expect(result[0].domain).toBe('blocked.com');
      expect(result[0].count).toBe(5);

      const section = document.getElementById('permissionSuggestSection')!;
      expect(section.classList.contains('hidden')).toBe(false);

      const list = document.getElementById('permissionSuggestList')!;
      expect(list.querySelector('.permission-suggest-allow')).toBeDefined();
      expect(list.querySelector('.permission-suggest-dismiss')).toBeDefined();
    });

    test('should hide section when no denied domains', async () => {
      mockGetFrequentDeniedDomains.mockResolvedValueOnce([]);
      setupFullDOM();
      const { renderPermissionSuggestList } = await import('../trustSettings.js');
      await renderPermissionSuggestList();

      const section = document.getElementById('permissionSuggestSection')!;
      expect(section.classList.contains('hidden')).toBe(true);
    });

    test('should remove domain when already permitted', async () => {
      mockGetFrequentDeniedDomains.mockResolvedValueOnce([
        { domain: 'allowed.com', count: 3 },
      ]);
      mockIsHostPermitted.mockResolvedValueOnce(true);

      setupFullDOM();
      const { renderPermissionSuggestList } = await import('../trustSettings.js');
      await renderPermissionSuggestList();

      expect(mockRemoveDeniedDomain).toHaveBeenCalledWith('allowed.com');
    });
  });

  // =========================================================================
  // Tranco update edge cases
  // =========================================================================
  describe('tranco update', () => {
    test('should show error when update already in progress', async () => {
      mockIsUpdateInProgress.mockReturnValueOnce(true);

      setupFullDOM();
      const { init } = await import('../trustSettings.js');
      init();

      document.getElementById('updateTrancoBtn')!.click();
      await new Promise(r => setTimeout(r, 10));

      const statusDiv = document.getElementById('trustSettingsStatus')!;
      expect(statusDiv.textContent).toContain('already in progress');
    });

    test('should handle tranco update failure', async () => {
      mockUpdateTrancoList.mockResolvedValueOnce({ success: false, error: 'Network error' });

      setupFullDOM();
      const { init } = await import('../trustSettings.js');
      init();

      document.getElementById('updateTrancoBtn')!.click();
      await new Promise(r => setTimeout(r, 10));

      expect(mockLogError).toHaveBeenCalled();
    });

    test('should handle tranco update exception', async () => {
      mockUpdateTrancoList.mockRejectedValueOnce(new Error('Timeout'));

      setupFullDOM();
      const { init } = await import('../trustSettings.js');
      init();

      document.getElementById('updateTrancoBtn')!.click();
      await new Promise(r => setTimeout(r, 10));

      expect(mockLogError).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // JP Anchor error handling
  // =========================================================================
  describe('JP Anchor error handling', () => {
    test('should show error message when jp anchor add fails', async () => {
      mockAddJpAnchorTld.mockResolvedValueOnce({ success: false, error: 'Already exists' });

      setupFullDOM();
      const { init } = await import('../trustSettings.js');
      init();

      const input = document.getElementById('jpAnchorAdd') as HTMLInputElement;
      input.value = '.jp';
      document.getElementById('jpAnchorAddBtn')!.click();

      await new Promise(r => setTimeout(r, 10));

      const statusDiv = document.getElementById('trustSettingsStatus')!;
      expect(statusDiv.textContent).toBe('Already exists');
    });
  });

  // =========================================================================
  // JP Anchor remove
  // =========================================================================
  describe('JP Anchor remove', () => {
    test('should call removeJpAnchorTld when remove button is clicked', async () => {
      setupFullDOM();
      const { renderJpAnchorList } = await import('../trustSettings.js');
      renderJpAnchorList(['.jp', '.co.jp']);

      const removeBtn = document.querySelector('.domain-tag-remove') as HTMLButtonElement;
      removeBtn.click();

      await new Promise(r => setTimeout(r, 10));
      expect(mockRemoveJpAnchorTld).toHaveBeenCalledWith('.jp');
    });
  });

  // =========================================================================
  // Sensitive domain add/remove
  // =========================================================================
  describe('sensitive domain add/remove', () => {
    test('should add sensitive domain on button click', async () => {
      setupFullDOM();
      const { init } = await import('../trustSettings.js');
      init();

      const input = document.getElementById('sensitiveAdd') as HTMLInputElement;
      input.value = 'bank.com';
      document.getElementById('sensitiveAddBtn')!.click();

      await new Promise(r => setTimeout(r, 10));
      expect(mockAddSensitiveDomain).toHaveBeenCalledWith('bank.com', 'finance');
    });

    test('should add sensitive domain on Enter key', async () => {
      setupFullDOM();
      const { init } = await import('../trustSettings.js');
      init();

      const input = document.getElementById('sensitiveAdd') as HTMLInputElement;
      input.value = 'invest.com';
      input.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', bubbles: true }));

      await new Promise(r => setTimeout(r, 10));
      expect(mockAddSensitiveDomain).toHaveBeenCalledWith('invest.com', 'finance');
    });

    test('should not add sensitive domain on non-Enter key', async () => {
      setupFullDOM();
      const { init } = await import('../trustSettings.js');
      init();

      const input = document.getElementById('sensitiveAdd') as HTMLInputElement;
      input.value = 'test.com';
      input.dispatchEvent(new KeyboardEvent('keypress', { key: 'Tab', bubbles: true }));

      await new Promise(r => setTimeout(r, 10));
      expect(mockAddSensitiveDomain).not.toHaveBeenCalled();
    });

    test('should show error when sensitive domain add fails', async () => {
      mockAddSensitiveDomain.mockResolvedValueOnce({ success: false, error: 'Invalid domain' });

      setupFullDOM();
      const { init } = await import('../trustSettings.js');
      init();

      const input = document.getElementById('sensitiveAdd') as HTMLInputElement;
      input.value = 'bad';
      document.getElementById('sensitiveAddBtn')!.click();

      await new Promise(r => setTimeout(r, 10));
      const statusDiv = document.getElementById('trustSettingsStatus')!;
      expect(statusDiv.textContent).toBe('Invalid domain');
    });

    test('should remove sensitive domain when remove button is clicked', async () => {
      setupFullDOM();
      const { renderSensitiveList } = await import('../trustSettings.js');
      renderSensitiveList(['bank.com', 'finance.com']);

      const removeBtn = document.querySelector('.domain-tag-remove') as HTMLButtonElement;
      removeBtn.click();

      await new Promise(r => setTimeout(r, 10));
      expect(mockRemoveSensitiveDomain).toHaveBeenCalledWith('bank.com');
    });
  });

  // =========================================================================
  // Whitelist add/remove
  // =========================================================================
  describe('whitelist add/remove', () => {
    test('should add whitelist domain on button click', async () => {
      setupFullDOM();
      const { init } = await import('../trustSettings.js');
      init();

      const input = document.getElementById('whitelistAdd') as HTMLInputElement;
      input.value = 'safe.com';
      document.getElementById('whitelistAddBtn')!.click();

      await new Promise(r => setTimeout(r, 10));
      expect(mockAddToWhitelist).toHaveBeenCalledWith('safe.com');
    });

    test('should add whitelist domain on Enter key', async () => {
      setupFullDOM();
      const { init } = await import('../trustSettings.js');
      init();

      const input = document.getElementById('whitelistAdd') as HTMLInputElement;
      input.value = 'trusted.org';
      input.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', bubbles: true }));

      await new Promise(r => setTimeout(r, 10));
      expect(mockAddToWhitelist).toHaveBeenCalledWith('trusted.org');
    });

    test('should not add whitelist domain on non-Enter key', async () => {
      setupFullDOM();
      const { init } = await import('../trustSettings.js');
      init();

      const input = document.getElementById('whitelistAdd') as HTMLInputElement;
      input.value = 'test.com';
      input.dispatchEvent(new KeyboardEvent('keypress', { key: 'Space', bubbles: true }));

      await new Promise(r => setTimeout(r, 10));
      expect(mockAddToWhitelist).not.toHaveBeenCalled();
    });

    test('should show error when whitelist add fails', async () => {
      mockAddToWhitelist.mockResolvedValueOnce({ success: false, error: 'Duplicate' });

      setupFullDOM();
      const { init } = await import('../trustSettings.js');
      init();

      const input = document.getElementById('whitelistAdd') as HTMLInputElement;
      input.value = 'dup.com';
      document.getElementById('whitelistAddBtn')!.click();

      await new Promise(r => setTimeout(r, 10));
      const statusDiv = document.getElementById('trustSettingsStatus')!;
      expect(statusDiv.textContent).toBe('Duplicate');
    });

    test('should remove whitelist domain when remove button is clicked', async () => {
      setupFullDOM();
      const { renderSensitiveList } = await import('../trustSettings.js');
      renderSensitiveList(['safe.com'], true);

      const removeBtn = document.querySelector('#whitelist .domain-tag-remove') as HTMLButtonElement;
      removeBtn.click();

      await new Promise(r => setTimeout(r, 10));
      expect(mockRemoveFromWhitelist).toHaveBeenCalledWith('safe.com');
    });
  });

  // =========================================================================
  // Permission dismiss handlers
  // =========================================================================
  describe('permission dismiss handlers', () => {
    test('should handle dismissAllPermissions click', async () => {
      mockGetFrequentDeniedDomains
        .mockResolvedValueOnce([{ domain: 'a.com', count: 5 }])
        .mockResolvedValueOnce([]);

      setupFullDOM();
      const dismissBtn = document.createElement('button');
      dismissBtn.id = 'dismissAllPermissions';
      document.body.appendChild(dismissBtn);

      const { init } = await import('../trustSettings.js');
      init();

      dismissBtn.click();
      await new Promise(r => setTimeout(r, 10));

      expect(mockRecordDomainDismissal).toHaveBeenCalledWith('a.com');
    });

    test('should handle permission allow button click', async () => {
      mockGetFrequentDeniedDomains
        .mockResolvedValueOnce([{ domain: 'blocked.com', count: 5 }])
        .mockResolvedValueOnce([]);
      mockIsHostPermitted.mockResolvedValueOnce(false);

      setupFullDOM();
      const { renderPermissionSuggestList } = await import('../trustSettings.js');
      await renderPermissionSuggestList();

      const allowBtn = document.querySelector('.permission-suggest-allow') as HTMLButtonElement;
      expect(allowBtn).toBeTruthy();
      allowBtn.click();

      await new Promise(r => setTimeout(r, 10));
      expect(mockRequestPermission).toHaveBeenCalledWith('https://blocked.com');
    });

    test('should handle permission dismiss button click', async () => {
      mockGetFrequentDeniedDomains
        .mockResolvedValueOnce([{ domain: 'ignore.com', count: 3 }])
        .mockResolvedValueOnce([]);
      mockIsHostPermitted.mockResolvedValueOnce(false);

      setupFullDOM();
      const { renderPermissionSuggestList } = await import('../trustSettings.js');
      await renderPermissionSuggestList();

      const dismissBtn = document.querySelector('.permission-suggest-dismiss') as HTMLButtonElement;
      expect(dismissBtn).toBeTruthy();
      dismissBtn.click();

      await new Promise(r => setTimeout(r, 10));
      expect(mockRecordDomainDismissal).toHaveBeenCalledWith('ignore.com');
    });

    test('should not re-render when permission grant fails', async () => {
      mockGetFrequentDeniedDomains
        .mockResolvedValueOnce([{ domain: 'fail.com', count: 5 }]);
      mockIsHostPermitted.mockResolvedValueOnce(false);
      mockRequestPermission.mockResolvedValueOnce(false);

      setupFullDOM();
      const { renderPermissionSuggestList } = await import('../trustSettings.js');
      await renderPermissionSuggestList();

      const allowBtn = document.querySelector('.permission-suggest-allow') as HTMLButtonElement;
      allowBtn.click();

      await new Promise(r => setTimeout(r, 10));
      expect(mockRemoveDeniedDomain).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // showStatus timeout
  // =========================================================================
  describe('showStatus timeout', () => {
    test('should clear status message after 3s timeout', async () => {
      setupFullDOM();
      const { init } = await import('../trustSettings.js');
      init();

      vi.useFakeTimers();

      document.getElementById('saveTrustSettings')!.click();
      await Promise.resolve();

      const statusDiv = document.getElementById('trustSettingsStatus')!;
      expect(statusDiv.textContent).toBe('Settings saved');

      vi.advanceTimersByTime(3000);
      expect(statusDiv.textContent).toBe('');
      expect(statusDiv.className).toBe('status-message');

      vi.useRealTimers();
    });
  });
});
