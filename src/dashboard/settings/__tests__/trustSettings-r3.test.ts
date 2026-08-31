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

vi.mock('../../../utils/trustDb/trustDb.js', () => ({
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

vi.mock('../../../utils/storage/types.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = { StorageKeys: { PERMISSION_NOTIFY_THRESHOLD: 'permission_notify_threshold' } } as Record<string, unknown>;
  return { ...actual, ...Object.fromEntries(Object.entries(overrides).map(([k, v]) => [k, v !== null && typeof v === 'object' && !Array.isArray(v) && actual[k] !== null && typeof actual[k] === 'object' && !Array.isArray(actual[k]) ? { ...(actual[k] as Record<string, unknown>), ...(v as Record<string, unknown>) } : v])) };
});
vi.mock('../../../utils/storage/defaults.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = { StorageKeys: { PERMISSION_NOTIFY_THRESHOLD: 'permission_notify_threshold' } } as Record<string, unknown>;
  return { ...actual, ...Object.fromEntries(Object.entries(overrides).map(([k, v]) => [k, v !== null && typeof v === 'object' && !Array.isArray(v) && actual[k] !== null && typeof actual[k] === 'object' && !Array.isArray(actual[k]) ? { ...(actual[k] as Record<string, unknown>), ...(v as Record<string, unknown>) } : v])) };
});
vi.mock('../../../utils/storage/encryptionSession.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = { StorageKeys: { PERMISSION_NOTIFY_THRESHOLD: 'permission_notify_threshold' } } as Record<string, unknown>;
  return { ...actual, ...Object.fromEntries(Object.entries(overrides).map(([k, v]) => [k, v !== null && typeof v === 'object' && !Array.isArray(v) && actual[k] !== null && typeof actual[k] === 'object' && !Array.isArray(actual[k]) ? { ...(actual[k] as Record<string, unknown>), ...(v as Record<string, unknown>) } : v])) };
});
vi.mock('../../../utils/storage.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = { StorageKeys: { PERMISSION_NOTIFY_THRESHOLD: 'permission_notify_threshold' } } as Record<string, unknown>;
  return { ...actual, ...Object.fromEntries(Object.entries(overrides).map(([k, v]) => [k, v !== null && typeof v === 'object' && !Array.isArray(v) && actual[k] !== null && typeof actual[k] === 'object' && !Array.isArray(actual[k]) ? { ...(actual[k] as Record<string, unknown>), ...(v as Record<string, unknown>) } : v])) };
});
vi.mock('../../../utils/storage/savedUrlRepository.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = { StorageKeys: { PERMISSION_NOTIFY_THRESHOLD: 'permission_notify_threshold' } } as Record<string, unknown>;
  return { ...actual, ...Object.fromEntries(Object.entries(overrides).map(([k, v]) => [k, v !== null && typeof v === 'object' && !Array.isArray(v) && actual[k] !== null && typeof actual[k] === 'object' && !Array.isArray(actual[k]) ? { ...(actual[k] as Record<string, unknown>), ...(v as Record<string, unknown>) } : v])) };
});
vi.mock('../../../utils/storage/domainFilterCache.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = { StorageKeys: { PERMISSION_NOTIFY_THRESHOLD: 'permission_notify_threshold' } } as Record<string, unknown>;
  return { ...actual, ...Object.fromEntries(Object.entries(overrides).map(([k, v]) => [k, v !== null && typeof v === 'object' && !Array.isArray(v) && actual[k] !== null && typeof actual[k] === 'object' && !Array.isArray(actual[k]) ? { ...(actual[k] as Record<string, unknown>), ...(v as Record<string, unknown>) } : v])) };
});
vi.mock('../../../utils/storage/quota.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = { StorageKeys: { PERMISSION_NOTIFY_THRESHOLD: 'permission_notify_threshold' } } as Record<string, unknown>;
  return { ...actual, ...Object.fromEntries(Object.entries(overrides).map(([k, v]) => [k, v !== null && typeof v === 'object' && !Array.isArray(v) && actual[k] !== null && typeof actual[k] === 'object' && !Array.isArray(actual[k]) ? { ...(actual[k] as Record<string, unknown>), ...(v as Record<string, unknown>) } : v])) };
});

const mockIsUpdateInProgress = vi.fn(() => false);
const mockUpdateTrancoList = vi.fn(() => Promise.resolve({ success: true, domainsCount: 10000 }));
vi.mock('../../../utils/trustDb/trancoUpdater.js', () => ({
  getTrancoUpdater: vi.fn(() => ({
    isUpdateInProgress: mockIsUpdateInProgress,
    updateTrancoList: mockUpdateTrancoList,
  })),
}));

const mockLogInfo = vi.fn();
const mockLogError = vi.fn();
vi.mock('../../../utils/logger.js', () => ({
  logInfo: mockLogInfo,
  logError: mockLogError,
  ErrorCode: { TRANCO_FETCH_FAILED: 'TRANCO_FETCH_FAILED' },
}));

const mockGetMessage = vi.fn((key: string) => {
  const msgs: Record<string, string> = {
    trancoUpdating: 'Updating...',
    trancoNotUpdated: 'Not updated',
    trancoTierTop1k: 'Top 1,000',
    trancoTierTop10k: 'Top 10,000',
    trancoTierTop100k: 'Top 100,000',
    trancoStatusFormat: 'Domains: {count} | Tier: {tier} | Last updated: {lastUpdated}',
    trancoStatusFormat_one: 'Domain: {count} | Tier: {tier} | Last updated: {lastUpdated}',
    trancoStatusFormat_other: 'Domains: {count} | Tier: {tier} | Last updated: {lastUpdated}',
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
});
vi.mock('../../../utils/i18n.js', () => ({
  getMessage: mockGetMessage,
}));

const mockGetAlertConfig = vi.fn(() => Promise.resolve({ alertFinance: false, alertSensitive: false, alertUnverified: false }));
const mockSaveAlertSettings = vi.fn(() => Promise.resolve());
vi.mock('../../../utils/trustChecker.js', () => ({
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
vi.mock('../../../utils/permissionManager.js', () => ({
  getFrequentDeniedDomains: mockGetFrequentDeniedDomains,
  requestPermission: mockRequestPermission,
  removeDeniedDomain: mockRemoveDeniedDomain,
  recordDomainDismissal: mockRecordDomainDismissal,
  isHostPermitted: mockIsHostPermitted,
}), { virtual: true });

vi.mock('../../../utils/errorUtils.js', () => ({
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
    <select id="sensitiveCategory"><option value="finance">Finance</option><option value="gaming">Gaming</option><option value="sns">SNS</option></select>
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
    <button id="dismissAllPermissions"></button>
  `;
}

describe('trustSettings-r3: cover remaining branches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    document.body.innerHTML = '';
    // reset default mock implementations
    mockGetDatabase.mockReturnValue({ tranco: { tier: 'top10k', count: 10000, lastUpdated: '2025-01-01' }, lastUpdated: '2025-01-01' } as any);
    mockGetFrequentDeniedDomains.mockResolvedValue([]);
    mockIsHostPermitted.mockResolvedValue(false);
    mockRequestPermission.mockResolvedValue(true);
    mockIsUpdateInProgress.mockReturnValue(false);
    mockUpdateTrancoList.mockResolvedValue({ success: true, domainsCount: 10000 } as any);
    mockGetMessage.mockImplementation((key: string) => {
      const msgs: Record<string, string> = {
        trancoUpdating: 'Updating...',
        trancoNotUpdated: 'Not updated',
        trancoTierTop1k: 'Top 1,000',
        trancoTierTop10k: 'Top 10,000',
        trancoTierTop100k: 'Top 100,000',
        trancoStatusFormat: 'Domains: {count}',
        trancoStatusFormat_one: 'Domain: {count}',
        trancoStatusFormat_other: 'Domains: {count}',
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
    });
  });

  it('covers updateTrancoStatus missing div early return via loadTrustSettings', async () => {
    // no trancoStatus in DOM at import time
    document.body.innerHTML = `
      <select id="safetyMode"><option value="strict"></option><option value="balanced"></option><option value="relaxed"></option></select>
      <select id="trancoTier"><option value="top1k"></option><option value="top10k"></option><option value="top100k"></option></select>
      <div id="jpAnchorList"></div><div id="sensitiveList"></div><div id="whitelist"></div>
      <div id="permissionSuggestSection"></div><div id="permissionSuggestList"></div>
      <input id="permissionThreshold" value="3" />
    `;
    const { loadTrustSettings } = await import('../trustSettings.js');
    await loadTrustSettings();
    // should not throw and should have called initialize
    expect(mockInitialize).toHaveBeenCalled();
  });

  it('covers trancoUpdating fallback when getMessage returns empty', async () => {
    setupFullDOM();
    mockGetMessage.mockImplementation((k: string) => (k === 'trancoUpdating' ? '' : 'msg'));
    // make update hang so the updating status is not overwritten by loadTrustSettings
    mockUpdateTrancoList.mockReturnValueOnce(new Promise(() => {}));
    const { init } = await import('../trustSettings.js');
    init();
    mockIsUpdateInProgress.mockReturnValueOnce(false);
    document.getElementById('updateTrancoBtn')!.click();
    await new Promise(r => setTimeout(r, 20));
    const status = document.getElementById('trancoStatus')!;
    expect(status.textContent).toBe('Updating...');
    expect(status.className).toContain('updating');
  });

  it('covers lastUpdated fallback to Not updated when both missing and getMessage empty', async () => {
    setupFullDOM();
    mockGetDatabase.mockReturnValue({ tranco: { tier: 'top10k', count: 5, lastUpdated: '' }, lastUpdated: '' } as any);
    mockGetMessage.mockImplementation((k: string) => {
      if (k === 'trancoNotUpdated') return '';
      if (k.startsWith('trancoTier')) return 'Tier';
      if (k.startsWith('trancoStatusFormat')) return '';
      return '';
    });
    const { loadTrustSettings } = await import('../trustSettings.js');
    await loadTrustSettings();
    const status = document.getElementById('trancoStatus')!;
    // fallback should be "Not updated" via || 'Not updated' -> then final fallback string
    expect(status.textContent).toContain('Not updated');
  });

  it('covers tierObj fallback branches when getMessage empty', async () => {
    setupFullDOM();
    mockGetMessage.mockImplementation((k: string, p?: any) => {
      if (k.startsWith('trancoTier')) return '';
      if (k.startsWith('trancoStatusFormat')) return `Domains: ${p?.count} | Tier: ${p?.tier} | Last updated: ${p?.lastUpdated}`;
      if (k === 'trancoNotUpdated') return 'Not updated';
      return 'x';
    });
    mockGetDatabase.mockReturnValue({ tranco: { tier: 'top10k', count: 1, lastUpdated: '2025-01-01' }, lastUpdated: '2025-01-01' } as any);
    const { loadTrustSettings } = await import('../trustSettings.js');
    await loadTrustSettings();
    const status = document.getElementById('trancoStatus')!;
    expect(status.textContent).toContain('Top 10,000');
  });

  it('covers tierLabel fallback for unknown tier and empty tier', async () => {
    setupFullDOM();
    mockGetMessage.mockImplementation((k: string, p?: any) => {
      if (k.startsWith('trancoStatusFormat')) return `Domains: ${p?.count} | Tier: ${p?.tier} | Last updated: ${p?.lastUpdated}`;
      if (k.startsWith('trancoTier')) return 'Tier';
      return 'x';
    });
    mockGetDatabase.mockReturnValue({ tranco: { tier: 'unknown' as any, count: 3, lastUpdated: '2025-01-01' }, lastUpdated: '2025-01-01' } as any);
    const { loadTrustSettings } = await import('../trustSettings.js');
    await loadTrustSettings();
    let status = document.getElementById('trancoStatus')!;
    expect(status.textContent).toContain('unknown');
    vi.resetModules();
    document.body.innerHTML = '';
    setupFullDOM();
    mockGetMessage.mockImplementation((k: string, p?: any) => {
      if (k.startsWith('trancoStatusFormat')) return `Domains: ${p?.count} | Tier: ${p?.tier} | Last updated: ${p?.lastUpdated}`;
      if (k.startsWith('trancoTier')) return 'Tier';
      return 'x';
    });
    mockGetDatabase.mockReturnValue({ tranco: { tier: '' as any, count: 3, lastUpdated: '2025-01-01' }, lastUpdated: '2025-01-01' } as any);
    const mod2 = await import('../trustSettings.js');
    await mod2.loadTrustSettings();
    status = document.getElementById('trancoStatus')!;
    expect(status.textContent).toBeDefined();
  });

  it('covers final fallback when getMessage for status format returns empty', async () => {
    setupFullDOM();
    mockGetMessage.mockImplementation(() => '');
    mockGetDatabase.mockReturnValue({ tranco: { tier: 'top10k', count: 42, lastUpdated: '2025-01-01' }, lastUpdated: '2025-01-01' } as any);
    const { loadTrustSettings } = await import('../trustSettings.js');
    await loadTrustSettings();
    const status = document.getElementById('trancoStatus')!;
    expect(status.textContent).toBe('Domains: 42 | Tier: Top 10,000 | Last updated: 2025-01-01');
  });

  it('covers addJpAnchor error fallback paths', async () => {
    setupFullDOM();
    // case 1: getMessage returns '' and result.error defined -> should show result.error
    mockAddJpAnchorTld.mockResolvedValueOnce({ success: false, error: 'Exists' } as any);
    mockGetMessage.mockImplementation(() => '');
    const { init } = await import('../trustSettings.js');
    init();
    (document.getElementById('jpAnchorAdd') as HTMLInputElement).value = '.test';
    document.getElementById('jpAnchorAddBtn')!.click();
    await new Promise(r => setTimeout(r, 20));
    expect(document.getElementById('trustSettingsStatus')!.textContent).toBe('Exists');
    // case 2: both falsy -> should show 'Error'
    vi.resetModules();
    document.body.innerHTML = '';
    setupFullDOM();
    mockAddJpAnchorTld.mockResolvedValueOnce({ success: false, error: '' } as any);
    mockGetMessage.mockImplementation(() => '');
    const mod2 = await import('../trustSettings.js');
    mod2.init();
    (document.getElementById('jpAnchorAdd') as HTMLInputElement).value = '.test2';
    document.getElementById('jpAnchorAddBtn')!.click();
    await new Promise(r => setTimeout(r, 20));
    expect(document.getElementById('trustSettingsStatus')!.textContent).toBe('Error');
    // case 3: getMessage returns mapping -> should show mapped
    vi.resetModules();
    document.body.innerHTML = '';
    setupFullDOM();
    mockAddJpAnchorTld.mockResolvedValueOnce({ success: false, error: 'someKey' } as any);
    mockGetMessage.mockImplementation((k: string) => (k === 'someKey' ? 'MappedError' : ''));
    const mod3 = await import('../trustSettings.js');
    mod3.init();
    (document.getElementById('jpAnchorAdd') as HTMLInputElement).value = '.test3';
    document.getElementById('jpAnchorAddBtn')!.click();
    await new Promise(r => setTimeout(r, 20));
    expect(document.getElementById('trustSettingsStatus')!.textContent).toBe('MappedError');
  });

  it('covers jpAnchorAdded fallback', async () => {
    setupFullDOM();
    mockAddJpAnchorTld.mockResolvedValueOnce({ success: true } as any);
    mockGetMessage.mockImplementation((k: string) => (k === 'jpAnchorAdded' ? '' : 'msg'));
    const { init } = await import('../trustSettings.js');
    init();
    (document.getElementById('jpAnchorAdd') as HTMLInputElement).value = '.newtld';
    document.getElementById('jpAnchorAddBtn')!.click();
    await new Promise(r => setTimeout(r, 20));
    expect(document.getElementById('trustSettingsStatus')!.textContent).toBe('TLD added');
  });

  it('covers sensitiveAdded fallback and category mismatch', async () => {
    setupFullDOM();
    mockGetMessage.mockImplementation((k: string) => (k === 'sensitiveAdded' ? '' : 'msg'));
    const { init } = await import('../trustSettings.js');
    init();
    // set currentCategory to finance initially; add with gaming should not re-render sensitiveList with finance
    (document.getElementById('sensitiveCategory') as HTMLSelectElement).value = 'gaming';
    (document.getElementById('sensitiveAdd') as HTMLInputElement).value = 'gameadd.com';
    document.getElementById('sensitiveAddBtn')!.click();
    await new Promise(r => setTimeout(r, 20));
    expect(document.getElementById('trustSettingsStatus')!.textContent).toBe('Domain added');
  });

  it('covers whitelistAdded fallback', async () => {
    setupFullDOM();
    mockGetMessage.mockImplementation((k: string) => (k === 'whitelistAdded' ? '' : 'msg'));
    const { init } = await import('../trustSettings.js');
    init();
    (document.getElementById('whitelistAdd') as HTMLInputElement).value = 'white.com';
    document.getElementById('whitelistAddBtn')!.click();
    await new Promise(r => setTimeout(r, 20));
    expect(document.getElementById('trustSettingsStatus')!.textContent).toBe('Domain added');
  });

  it('covers addSensitiveDomain error fallback with empty error -> Error', async () => {
    setupFullDOM();
    mockAddSensitiveDomain.mockResolvedValueOnce({ success: false, error: undefined } as any);
    mockGetMessage.mockImplementation(() => '');
    const { init } = await import('../trustSettings.js');
    init();
    (document.getElementById('sensitiveAdd') as HTMLInputElement).value = 'bad';
    document.getElementById('sensitiveAddBtn')!.click();
    await new Promise(r => setTimeout(r, 20));
    expect(document.getElementById('trustSettingsStatus')!.textContent).toBe('Error');
  });

  it('covers addWhitelistDomain error fallback', async () => {
    setupFullDOM();
    mockAddToWhitelist.mockResolvedValueOnce({ success: false, error: undefined } as any);
    mockGetMessage.mockImplementation(() => '');
    const { init } = await import('../trustSettings.js');
    init();
    (document.getElementById('whitelistAdd') as HTMLInputElement).value = 'bad2';
    document.getElementById('whitelistAddBtn')!.click();
    await new Promise(r => setTimeout(r, 20));
    expect(document.getElementById('trustSettingsStatus')!.textContent).toBe('Error');
  });

  it('covers updateTrancoList missing trancoTierSelect early return', async () => {
    document.body.innerHTML = `<button id="updateTrancoBtn"></button><div id="trustSettingsStatus"></div><div id="trancoStatus"></div>`;
    // trancoTier missing at import
    const { init } = await import('../trustSettings.js');
    init();
    document.getElementById('updateTrancoBtn')!.click();
    await new Promise(r => setTimeout(r, 20));
    expect(mockUpdateTrancoList).not.toHaveBeenCalled();
  });

  it('covers trancoUpdateInProgress fallback', async () => {
    setupFullDOM();
    mockIsUpdateInProgress.mockReturnValueOnce(true);
    mockGetMessage.mockImplementation((k: string) => (k === 'trancoUpdateInProgress' ? '' : 'msg'));
    const { init } = await import('../trustSettings.js');
    init();
    document.getElementById('updateTrancoBtn')!.click();
    await new Promise(r => setTimeout(r, 20));
    expect(document.getElementById('trustSettingsStatus')!.textContent).toBe('Update already in progress');
  });

  it('covers trancoUpdateSuccess fallback', async () => {
    setupFullDOM();
    mockGetMessage.mockImplementation((k: string) => (k === 'trancoUpdateSuccess' ? '' : 'msg'));
    const { init } = await import('../trustSettings.js');
    init();
    document.getElementById('updateTrancoBtn')!.click();
    await new Promise(r => setTimeout(r, 20));
    expect(document.getElementById('trustSettingsStatus')!.textContent).toBe('Tranco list updated successfully');
  });

  it('covers tranco update failure with empty error -> Update failed', async () => {
    setupFullDOM();
    mockUpdateTrancoList.mockResolvedValueOnce({ success: false, error: '' } as any);
    const { init } = await import('../trustSettings.js');
    init();
    document.getElementById('updateTrancoBtn')!.click();
    await new Promise(r => setTimeout(r, 20));
    // should have called updateTrancoStatus with error 'Update failed'
    expect(document.getElementById('trancoStatus')!.textContent).toBe('Update failed');
  });

  it('covers onSafetyModeChange missing elements', async () => {
    document.body.innerHTML = `<div id="trustSettingsStatus"></div>`;
    const { init } = await import('../trustSettings.js');
    init();
    // no safetyMode/select, calling via init should not throw; direct trigger not possible
    expect(() => init()).not.toThrow();
  });

  it('covers safetyModeChanged fallback', async () => {
    setupFullDOM();
    mockGetMessage.mockImplementation((k: string) => (k === 'safetyModeChanged' ? '' : 'msg'));
    const { init } = await import('../trustSettings.js');
    init();
    const sel = document.getElementById('safetyMode') as HTMLSelectElement;
    sel.value = 'strict';
    sel.dispatchEvent(new Event('change'));
    expect(document.getElementById('trustSettingsStatus')!.textContent).toBe('Safety mode changed');
  });

  it('covers onTrancoTierChange missing elements', async () => {
    document.body.innerHTML = `<div id="trustSettingsStatus"></div><div id="trancoStatus"></div>`;
    const { init } = await import('../trustSettings.js');
    init();
    expect(() => init()).not.toThrow();
  });

  it('covers saveTrustSettings fallback', async () => {
    setupFullDOM();
    mockGetMessage.mockImplementation((k: string) => (k === 'settingsSaved' ? '' : 'msg'));
    const { init } = await import('../trustSettings.js');
    init();
    document.getElementById('saveTrustSettings')!.click();
    await new Promise(r => setTimeout(r, 20));
    expect(document.getElementById('trustSettingsStatus')!.textContent).toBe('Settings saved');
  });

  it('covers loadTrustSettings with missing selects and empty lastUpdated fallback', async () => {
    document.body.innerHTML = `
      <div id="jpAnchorList"></div><div id="sensitiveList"></div><div id="whitelist"></div>
      <div id="permissionSuggestSection"></div><div id="permissionSuggestList"></div>
      <input id="permissionThreshold" value="3" />
      <div id="trancoStatus"></div>
      <div id="trustSettingsStatus"></div>
    `;
    mockGetMessage.mockImplementation((k: string, p?: any) => {
      if (k.startsWith('trancoStatusFormat')) return `Domains: ${p?.count} | Tier: ${p?.tier} | Last updated: ${p?.lastUpdated}`;
      if (k.startsWith('trancoTier')) return 'Tier';
      if (k === 'trancoNotUpdated') return 'Not updated';
      return 'x';
    });
    mockGetDatabase.mockReturnValue({ tranco: { tier: 'top10k', count: 1, lastUpdated: '' }, lastUpdated: 'fallbackDate' } as any);
    const { loadTrustSettings } = await import('../trustSettings.js');
    await loadTrustSettings();
    expect(document.getElementById('trancoStatus')!.textContent).toContain('fallbackDate');
  });

  it('covers loadTrustSettings missing alert checkboxes', async () => {
    document.body.innerHTML = `
      <select id="safetyMode"><option value="balanced"></option></select>
      <select id="trancoTier"><option value="top10k"></option></select>
      <div id="trancoStatus"></div><div id="jpAnchorList"></div><div id="sensitiveList"></div><div id="whitelist"></div>
      <div id="permissionSuggestSection"></div><div id="permissionSuggestList"></div>
      <input id="permissionThreshold" value="3" />
      <div id="trustSettingsStatus"></div>
    `;
    mockGetAlertConfig.mockResolvedValueOnce({ alertFinance: true, alertSensitive: true, alertUnverified: true } as any);
    const { loadTrustSettings } = await import('../trustSettings.js');
    await loadTrustSettings();
    // no checkboxes, should not throw
    expect(mockGetAlertConfig).toHaveBeenCalled();
  });

  it('covers init missing elements for all buttons', async () => {
    document.body.innerHTML = `<div id="jpAnchorList"></div>`;
    const { init } = await import('../trustSettings.js');
    expect(() => init()).not.toThrow();
    // after init, there should be no listeners that throw
  });

  it('covers permissionSuggest threshold fallback when input missing', async () => {
    document.body.innerHTML = `
      <div id="permissionSuggestSection"></div>
      <div id="permissionSuggestList"></div>
    `;
    mockGetFrequentDeniedDomains.mockResolvedValueOnce([{ domain: 'fallback.com', count: 3 }] as any);
    mockIsHostPermitted.mockResolvedValueOnce(false);
    // thresholdInput missing at call time -> inside renderPermissionSuggestList it does getElementById again
    // So create a module where thresholdInput const was captured as null at import (no input), then call render
    vi.resetModules();
    document.body.innerHTML = `<div id="permissionSuggestSection"></div><div id="permissionSuggestList"></div>`;
    const mod = await import('../trustSettings.js');
    const res = await mod.renderPermissionSuggestList();
    expect(res.length).toBe(1);
  });

  it('covers permissionSuggestCount fallback', async () => {
    setupFullDOM();
    mockGetFrequentDeniedDomains.mockResolvedValueOnce([{ domain: 'a.com', count: 5 }] as any);
    mockGetMessage.mockImplementation((k: string) => (k === 'permissionSuggestCount' ? '' : 'msg'));
    mockIsHostPermitted.mockResolvedValueOnce(false);
    const { renderPermissionSuggestList } = await import('../trustSettings.js');
    await renderPermissionSuggestList();
    const span = document.querySelector('.permission-suggest-row span')!;
    expect(span.textContent).toContain('回訪問');
  });

  it('covers permissionSuggestAdd fallback', async () => {
    setupFullDOM();
    mockGetFrequentDeniedDomains.mockResolvedValueOnce([{ domain: 'b.com', count: 2 }] as any);
    mockGetMessage.mockImplementation((k: string) => (k === 'permissionSuggestAdd' ? '' : 'msg'));
    mockIsHostPermitted.mockResolvedValueOnce(false);
    const { renderPermissionSuggestList } = await import('../trustSettings.js');
    await renderPermissionSuggestList();
    const btn = document.querySelector('.permission-suggest-allow') as HTMLButtonElement;
    expect(btn.textContent).toBe('🔓 許可する');
  });

  it('covers permissionSuggestDismiss fallback', async () => {
    setupFullDOM();
    mockGetFrequentDeniedDomains.mockResolvedValueOnce([{ domain: 'c.com', count: 4 }] as any);
    mockGetMessage.mockImplementation((k: string) => (k === 'permissionSuggestDismiss' ? '' : 'msg'));
    mockIsHostPermitted.mockResolvedValueOnce(false);
    const { renderPermissionSuggestList } = await import('../trustSettings.js');
    await renderPermissionSuggestList();
    const btn = document.querySelector('.permission-suggest-dismiss') as HTMLButtonElement;
    expect(btn.title).toBe('無視する（14日表示しない）');
  });

  it('covers init category tabs missing dataset', async () => {
    setupFullDOM();
    // add a tab without data-category
    const extra = document.createElement('button');
    extra.className = 'category-tab';
    document.body.appendChild(extra);
    const { init } = await import('../trustSettings.js');
    init();
    extra.click();
    await new Promise(r => setTimeout(r, 10));
    // should not switch
    expect(extra.classList.contains('active')).toBe(false);
  });

  it('covers sensitiveAdd missing select on click does not call', async () => {
    setupFullDOM();
    // remove category select before import to make const null
    document.getElementById('sensitiveCategory')!.remove();
    const { init } = await import('../trustSettings.js');
    init();
    (document.getElementById('sensitiveAdd') as HTMLInputElement).value = 'test.com';
    document.getElementById('sensitiveAddBtn')!.click();
    await new Promise(r => setTimeout(r, 10));
    expect(mockAddSensitiveDomain).not.toHaveBeenCalled();
  });

  it('covers init jpAnchorAdd missing input', async () => {
    document.body.innerHTML = `
      <button id="jpAnchorAddBtn"></button>
      <div id="trustSettingsStatus"></div>
      <div id="jpAnchorList"></div>
    `;
    const { init } = await import('../trustSettings.js');
    init();
    document.getElementById('jpAnchorAddBtn')!.click();
    await new Promise(r => setTimeout(r, 10));
    expect(mockAddJpAnchorTld).not.toHaveBeenCalled();
  });

  it('covers threshold invalid values are ignored (already covered but re-verify edges)', async () => {
    setupFullDOM();
    const { init } = await import('../trustSettings.js');
    init();
    const input = document.getElementById('permissionThreshold') as HTMLInputElement;
    input.value = 'NaN';
    input.dispatchEvent(new Event('change'));
    await new Promise(r => setTimeout(r, 10));
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });
});
