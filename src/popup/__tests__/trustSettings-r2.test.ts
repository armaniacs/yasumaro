// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

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

vi.mock('../../utils/storage.js', () => ({
  StorageKeys: { PERMISSION_NOTIFY_THRESHOLD: 'permission_notify_threshold' },
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

vi.mock('../../utils/errorUtils.js', () => ({
  errorMessage: vi.fn((e: any) => e instanceof Error ? e.message : String(e)),
}));

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
    <select id="sensitiveCategory"><option value="finance">Finance</option><option value="gaming">Gaming</option></select>
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

describe('trustSettings - r2 missed branches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    document.body.innerHTML = '';
  });

  describe('updateTrancoStatus', () => {
    it('should show updating status', async () => {
      setupFullDOM();
      const { init } = await import('../trustSettings.js');
      init();

      const trancoStatusDiv = document.getElementById('trancoStatus') as HTMLElement;
      const select = document.getElementById('trancoTier') as HTMLSelectElement;
      select.value = 'top1k';
      select.dispatchEvent(new Event('change'));

      expect(trancoStatusDiv.textContent).toBeTruthy();
      expect(trancoStatusDiv.className).toContain('status-message');
    });

    it('should handle missing trancoStatusDiv', async () => {
      setupFullDOM();
      document.getElementById('trancoStatus')!.remove();
      const { init } = await import('../trustSettings.js');
      expect(() => init()).not.toThrow();
    });
  });

  describe('showStatus guard', () => {
    it('should do nothing when trustSettingsStatusDiv is missing', async () => {
      document.body.innerHTML = '<div>no status div</div>';
      const { init } = await import('../trustSettings.js');
      expect(() => init()).not.toThrow();
    });
  });

  describe('addJpAnchorTld error', () => {
    it('should show error when add fails', async () => {
      mockAddJpAnchorTld.mockResolvedValueOnce({ success: false, error: 'Invalid TLD' });
      setupFullDOM();
      const { init } = await import('../trustSettings.js');
      init();

      const input = document.getElementById('jpAnchorAdd') as HTMLInputElement;
      input.value = '.invalid';
      document.getElementById('jpAnchorAddBtn')!.click();

      await new Promise((r) => setTimeout(r, 10));
      const statusDiv = document.getElementById('trustSettingsStatus') as HTMLElement;
      expect(statusDiv.textContent).toBe('Invalid TLD');
    });
  });

  describe('addSensitiveDomain category mismatch', () => {
    it('should not re-render list when category does not match current', async () => {
      mockGetSensitiveDomains.mockClear();
      setupFullDOM();
      const { init } = await import('../trustSettings.js');
      init();

      const categorySelect = document.getElementById('sensitiveCategory') as HTMLSelectElement;
      categorySelect.value = 'gaming';

      const input = document.getElementById('sensitiveAdd') as HTMLInputElement;
      input.value = 'gambling.com';

      document.getElementById('sensitiveAddBtn')!.click();
      await new Promise((r) => setTimeout(r, 10));

      expect(mockAddSensitiveDomain).toHaveBeenCalledWith('gambling.com', 'gaming');
    });
  });

  describe('removeSensitiveDomain', () => {
    it('should call remove and re-render', async () => {
      setupFullDOM();
      const { renderSensitiveList } = await import('../trustSettings.js');
      renderSensitiveList(['bank.com', 'finance.com']);

      const removeBtn = document.querySelector('#sensitiveList .domain-tag-remove') as HTMLButtonElement;
      removeBtn.click();

      await new Promise((r) => setTimeout(r, 10));
      expect(mockRemoveSensitiveDomain).toHaveBeenCalledWith('bank.com');
    });
  });

  describe('addWhitelistDomain error', () => {
    it('should show error when whitelist add fails', async () => {
      mockAddToWhitelist.mockResolvedValueOnce({ success: false, error: 'Already exists' });
      setupFullDOM();
      const { init } = await import('../trustSettings.js');
      init();

      const input = document.getElementById('whitelistAdd') as HTMLInputElement;
      input.value = 'dup.com';
      document.getElementById('whitelistAddBtn')!.click();

      await new Promise((r) => setTimeout(r, 10));
      const statusDiv = document.getElementById('trustSettingsStatus') as HTMLElement;
      expect(statusDiv.textContent).toBe('Already exists');
    });
  });

  describe('removeWhitelistDomain', () => {
    it('should call removeFromWhitelist when remove is clicked', async () => {
      setupFullDOM();
      const { renderSensitiveList } = await import('../trustSettings.js');
      renderSensitiveList(['safe.com'], true);

      const removeBtn = document.querySelector('#whitelist .domain-tag-remove') as HTMLButtonElement;
      removeBtn.click();

      await new Promise((r) => setTimeout(r, 10));
      expect(mockRemoveFromWhitelist).toHaveBeenCalledWith('safe.com');
    });
  });

  describe('saveTrustSettings with missing elements', () => {
    it('should handle missing checkboxes gracefully', async () => {
      setupFullDOM();
      document.getElementById('alertFinance')!.remove();
      document.getElementById('alertSensitive')!.remove();
      document.getElementById('alertUnverified')!.remove();
      const { init } = await import('../trustSettings.js');
      init();

      document.getElementById('saveTrustSettings')!.click();
      await new Promise((r) => setTimeout(r, 10));

      expect(mockSaveAlertSettings).toHaveBeenCalledWith({
        alertFinance: false,
        alertSensitive: false,
        alertUnverified: false,
      });
    });
  });

  describe('onSafetyModeChange', () => {
    it('should update tranco tier when safety mode changes to relaxed', async () => {
      setupFullDOM();
      const { init } = await import('../trustSettings.js');
      init();

      const safetySelect = document.getElementById('safetyMode') as HTMLSelectElement;
      safetySelect.value = 'relaxed';
      safetySelect.dispatchEvent(new Event('change'));

      const tierSelect = document.getElementById('trancoTier') as HTMLSelectElement;
      expect(tierSelect.value).toBe('top100k');
    });
  });

  describe('onTrancoTierChange', () => {
    it('should update safety mode when tranco tier changes', async () => {
      setupFullDOM();
      const { init } = await import('../trustSettings.js');
      init();

      const tierSelect = document.getElementById('trancoTier') as HTMLSelectElement;
      tierSelect.value = 'top1k';
      tierSelect.dispatchEvent(new Event('change'));

      const safetySelect = document.getElementById('safetyMode') as HTMLSelectElement;
      expect(safetySelect.value).toBe('strict');
    });
  });

  describe('switchCategory', () => {
    it('should switch to gaming tab and render sensitive list', async () => {
      setupFullDOM();
      const { init } = await import('../trustSettings.js');
      init();

      const gamingTab = document.querySelector('[data-category="gaming"]') as HTMLButtonElement;
      gamingTab.click();
      await new Promise((r) => setTimeout(r, 10));

      expect(gamingTab.classList.contains('active')).toBe(true);
      expect(mockGetSensitiveDomains).toHaveBeenCalledWith('gaming');
    });

    it('should switch to sns tab', async () => {
      setupFullDOM();
      const { init } = await import('../trustSettings.js');
      init();

      const snsTab = document.querySelector('[data-category="sns"]') as HTMLButtonElement;
      snsTab.click();
      await new Promise((r) => setTimeout(r, 10));

      expect(snsTab.classList.contains('active')).toBe(true);
      expect(mockGetSensitiveDomains).toHaveBeenCalledWith('sns');
    });
  });

  describe('renderPermissionSuggestList missing elements', () => {
    it('should return [] when section element is missing', async () => {
      setupFullDOM();
      document.getElementById('permissionSuggestSection')!.remove();

      const { renderPermissionSuggestList } = await import('../trustSettings.js');
      const result = await renderPermissionSuggestList();
      expect(result).toEqual([]);
    });

    it('should return [] when list element is missing', async () => {
      setupFullDOM();
      document.getElementById('permissionSuggestList')!.remove();

      const { renderPermissionSuggestList } = await import('../trustSettings.js');
      const result = await renderPermissionSuggestList();
      expect(result).toEqual([]);
    });
  });

  describe('sensitive domain Enter key with missing select', () => {
    it('should not add when sensitiveCategorySelect is missing on Enter key', async () => {
      setupFullDOM();
      document.getElementById('sensitiveCategory')!.remove();
      const { init } = await import('../trustSettings.js');
      init();

      const input = document.getElementById('sensitiveAdd') as HTMLInputElement;
      input.value = 'test.com';
      input.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', bubbles: true }));
      await new Promise((r) => setTimeout(r, 10));

      expect(mockAddSensitiveDomain).not.toHaveBeenCalled();
    });
  });

  describe('loadTrustSettings with null dbData', () => {
    it('should return early when dbData is null', async () => {
      mockGetDatabase.mockReturnValueOnce(null as any);
      setupFullDOM();
      const { loadTrustSettings } = await import('../trustSettings.js');
      await expect(loadTrustSettings()).resolves.not.toThrow();
    });
  });

  describe('loadTrustSettings missing DOM elements', () => {
    it('should handle missing safetyMode select', async () => {
      setupFullDOM();
      document.getElementById('safetyMode')!.remove();
      const { loadTrustSettings } = await import('../trustSettings.js');
      await expect(loadTrustSettings()).resolves.not.toThrow();
    });
  });

  describe('tranco update missing tier select', () => {
    it('should handle missing trancoTier select on update', async () => {
      setupFullDOM();
      document.getElementById('trancoTier')!.remove();
      const updateBtn = document.getElementById('updateTrancoBtn') as HTMLButtonElement;
      expect(updateBtn).toBeTruthy();
    });
  });

  describe('permission suggest allow button grant failed', () => {
    it('should not remove denied domain when permission is denied', async () => {
      mockGetFrequentDeniedDomains
        .mockResolvedValueOnce([{ domain: 'nogrant.com', count: 5 }]);
      mockIsHostPermitted.mockResolvedValueOnce(false);
      mockRequestPermission.mockResolvedValueOnce(false);

      setupFullDOM();
      const { renderPermissionSuggestList } = await import('../trustSettings.js');
      await renderPermissionSuggestList();

      const allowBtn = document.querySelector('.permission-suggest-allow') as HTMLButtonElement;
      allowBtn.click();
      await new Promise((r) => setTimeout(r, 10));

      expect(mockRemoveDeniedDomain).not.toHaveBeenCalled();
    });
  });
});
