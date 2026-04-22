// @vitest-environment jsdom
/**
 * domainFilter.test.ts
 * Tests for src/popup/domainFilter.ts
 * Focus on increasing coverage beyond the existing 33.75%
 */

import { vi } from 'vitest';;

// Mock dependencies - all at top level
const mockGetSettings = vi.fn(() => Promise.resolve({
  domain_filter_mode: 'disabled',
  domain_whitelist: [],
  domain_blacklist: [],
  simple_format_enabled: true,
  ublock_format_enabled: false,
}));
const mockSaveSettings = vi.fn(() => Promise.resolve());

vi.mock('../../utils/storage.js', () => ({
  StorageKeys: {
    DOMAIN_FILTER_MODE: 'domain_filter_mode',
    DOMAIN_WHITELIST: 'domain_whitelist',
    DOMAIN_BLACKLIST: 'domain_blacklist',
    SIMPLE_FORMAT_ENABLED: 'simple_format_enabled',
    UBLOCK_FORMAT_ENABLED: 'ublock_format_enabled',
  },
  getSettings: mockGetSettings,
  saveSettings: mockSaveSettings,
}));

const mockParseDomainList = vi.fn((text: string) =>
  text.split('\n').map((s: string) => s.trim()).filter(Boolean)
);
const mockValidateDomainList = vi.fn(() => [] as string[]);

vi.mock('../../utils/domainUtils.js', () => ({
  extractDomain: vi.fn(),
  parseDomainList: mockParseDomainList,
  validateDomainList: mockValidateDomainList,
}));

const mockInitUblock = vi.fn();
const mockHandleSaveUblockSettings = vi.fn(() => Promise.resolve());

vi.mock('../ublockImport.js', () => ({
  init: mockInitUblock,
  handleSaveUblockSettings: mockHandleSaveUblockSettings,
}));

const mockAddLog = vi.fn();

vi.mock('../../utils/logger.js', () => ({
  addLog: mockAddLog,
  LogType: { ERROR: 'ERROR', INFO: 'INFO' },
}));

vi.mock('../tabUtils.js', () => ({
  getCurrentTab: vi.fn(),
  isRecordable: vi.fn(),
}));

const mockShowStatus = vi.fn();

vi.mock('../settingsUiHelper.js', () => ({
  showStatus: mockShowStatus,
}));

vi.mock('../i18n.js', () => ({
  getMessage: vi.fn((key: string) => {
    const msgs: Record<string, string> = {
      whitelistLabel: 'Whitelist (1 domain per line)',
      blacklistLabel: 'Blacklist (1 domain per line)',
      domainFilterSaved: 'Domain filter settings saved',
      filterModeRequired: 'Please select a filter mode',
      domainListError: 'Domain list errors:',
      saveError: 'Save error',
    };
    return msgs[key] || key;
  }),
}));

function setupFullDOM() {
  document.body.innerHTML = `
    <button id="generalTab" role="tab"></button>
    <button id="domainTab" role="tab"></button>
    <button id="promptTab" role="tab"></button>
    <button id="privacyTab" role="tab"></button>
    <div id="generalPanel" role="tabpanel"><button id="genBtn">Btn</button></div>
    <div id="domainPanel" role="tabpanel"></div>
    <div id="promptPanel" role="tabpanel"></div>
    <div id="privacyPanel" role="tabpanel"></div>
    <input type="radio" name="domainFilter" id="filterDisabled" value="disabled" checked />
    <input type="radio" name="domainFilter" id="filterWhitelist" value="whitelist" />
    <input type="radio" name="domainFilter" id="filterBlacklist" value="blacklist" />
    <div id="domainListSection"></div>
    <div id="domainListLabel"></div>
    <textarea id="domainList"></textarea>
    <textarea id="whitelistTextarea"></textarea>
    <textarea id="blacklistTextarea"></textarea>
    <button id="saveDomainSettings"></button>
    <input type="checkbox" id="simpleFormatEnabled" checked />
    <input type="checkbox" id="ublockFormatEnabled" />
    <div id="simpleFormatUI"></div>
    <div id="uBlockFormatUI"></div>
    <div id="tabList" role="tablist">
      <button role="tab" id="tab1"></button>
      <button role="tab" id="tab2"></button>
    </div>
    <div id="domainStatus"></div>
  `;
}

describe('domainFilter.ts (improved coverage)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    document.body.innerHTML = '';
    // Reset mock defaults
    mockGetSettings.mockResolvedValue({
      domain_filter_mode: 'disabled',
      domain_whitelist: [],
      domain_blacklist: [],
      simple_format_enabled: true,
      ublock_format_enabled: false,
    });
    mockHandleSaveUblockSettings.mockResolvedValue(undefined);
    mockSaveSettings.mockResolvedValue(undefined);
    mockValidateDomainList.mockReturnValue([]);
  });

  // =========================================================================
  // init()
  // =========================================================================
  describe('init()', () => {
    test('should initialize with full DOM', async () => {
      setupFullDOM();
      const { init } = await import('../domainFilter.js');
      expect(() => init()).not.toThrow();
    });

    test('should call loadDomainSettings on init', async () => {
      setupFullDOM();
      mockGetSettings.mockClear();

      const { init } = await import('../domainFilter.js');
      init();
      await new Promise(r => setTimeout(r, 10));

      expect(mockGetSettings).toHaveBeenCalled();
    });

    test('should call initUblockImport on init', async () => {
      setupFullDOM();
      mockInitUblock.mockClear();

      const { init } = await import('../domainFilter.js');
      init();

      expect(mockInitUblock).toHaveBeenCalled();
    });

    test('should handle domain tab click and reload settings', async () => {
      setupFullDOM();
      mockGetSettings.mockClear();

      const { init } = await import('../domainFilter.js');
      init();

      document.getElementById('domainTab')!.dispatchEvent(new Event('click'));
      await new Promise(r => setTimeout(r, 10));

      expect(mockGetSettings).toHaveBeenCalled();
    });

    test('should show whitelist label when whitelist radio selected', async () => {
      setupFullDOM();
      const { init } = await import('../domainFilter.js');
      init();

      const whitelistRadio = document.getElementById('filterWhitelist') as HTMLInputElement;
      whitelistRadio.checked = true;
      whitelistRadio.dispatchEvent(new Event('change'));

      const section = document.getElementById('domainListSection')!;
      expect(section.style.display).toBe('block');

      const label = document.getElementById('domainListLabel')!;
      expect(label.textContent).toContain('Whitelist');
    });

    test('should hide section on disabled filter mode', async () => {
      setupFullDOM();
      const { init } = await import('../domainFilter.js');
      init();

      const disabledRadio = document.getElementById('filterDisabled') as HTMLInputElement;
      disabledRadio.checked = true;
      disabledRadio.dispatchEvent(new Event('change'));

      const section = document.getElementById('domainListSection')!;
      expect(section.style.display).toBe('none');
    });

    test('should show blacklist label when blacklist radio selected', async () => {
      setupFullDOM();
      const { init } = await import('../domainFilter.js');
      init();

      const blacklistRadio = document.getElementById('filterBlacklist') as HTMLInputElement;
      blacklistRadio.checked = true;
      blacklistRadio.dispatchEvent(new Event('change'));

      const section = document.getElementById('domainListSection')!;
      expect(section.style.display).toBe('block');

      const label = document.getElementById('domainListLabel')!;
      expect(label.textContent).toContain('Blacklist');
    });
  });

  // =========================================================================
  // toggleFormatUI()
  // =========================================================================
  describe('toggleFormatUI()', () => {
    test('should show simple format UI when checked', async () => {
      setupFullDOM();
      const { toggleFormatUI } = await import('../domainFilter.js');
      toggleFormatUI();

      expect(document.getElementById('simpleFormatUI')!.style.display).toBe('block');
    });

    test('should hide simple format UI when unchecked', async () => {
      setupFullDOM();
      (document.getElementById('simpleFormatEnabled') as HTMLInputElement).checked = false;

      const { toggleFormatUI } = await import('../domainFilter.js');
      toggleFormatUI();

      expect(document.getElementById('simpleFormatUI')!.style.display).toBe('none');
    });

    test('should show uBlock format UI when checked', async () => {
      setupFullDOM();
      (document.getElementById('ublockFormatEnabled') as HTMLInputElement).checked = true;

      const { toggleFormatUI } = await import('../domainFilter.js');
      toggleFormatUI();

      expect(document.getElementById('uBlockFormatUI')!.style.display).toBe('block');
    });

    test('should hide uBlock format UI when unchecked', async () => {
      setupFullDOM();
      const { toggleFormatUI } = await import('../domainFilter.js');
      toggleFormatUI();

      expect(document.getElementById('uBlockFormatUI')!.style.display).toBe('none');
    });
  });

  // =========================================================================
  // loadDomainSettings()
  // =========================================================================
  describe('loadDomainSettings()', () => {
    test('should load whitelist mode settings', async () => {
      setupFullDOM();
      mockGetSettings.mockResolvedValueOnce({
        domain_filter_mode: 'whitelist',
        domain_whitelist: ['example.com', 'test.org'],
        domain_blacklist: ['ads.com'],
        simple_format_enabled: true,
        ublock_format_enabled: false,
      });

      const { loadDomainSettings } = await import('../domainFilter.js');
      await loadDomainSettings();

      expect((document.getElementById('filterWhitelist') as HTMLInputElement).checked).toBe(true);
      expect((document.getElementById('domainList') as HTMLTextAreaElement).value).toContain('example.com');
    });

    test('should load blacklist mode settings', async () => {
      setupFullDOM();
      mockGetSettings.mockResolvedValueOnce({
        domain_filter_mode: 'blacklist',
        domain_whitelist: [],
        domain_blacklist: ['spam.com'],
        simple_format_enabled: true,
        ublock_format_enabled: false,
      });

      const { loadDomainSettings } = await import('../domainFilter.js');
      await loadDomainSettings();

      expect((document.getElementById('filterBlacklist') as HTMLInputElement).checked).toBe(true);
      expect((document.getElementById('domainList') as HTMLTextAreaElement).value).toContain('spam.com');
    });

    test('should reject invalid filter mode (CSS injection prevention)', async () => {
      setupFullDOM();
      mockGetSettings.mockResolvedValueOnce({
        domain_filter_mode: 'bad-mode][value="',
        domain_whitelist: [],
        domain_blacklist: [],
        simple_format_enabled: true,
        ublock_format_enabled: false,
      });

      const { loadDomainSettings } = await import('../domainFilter.js');
      await loadDomainSettings();

      expect((document.getElementById('filterDisabled') as HTMLInputElement).checked).toBe(true);
    });

    test('should store lists in hidden textareas', async () => {
      setupFullDOM();
      mockGetSettings.mockResolvedValueOnce({
        domain_filter_mode: 'disabled',
        domain_whitelist: ['a.com', 'b.com'],
        domain_blacklist: ['c.com'],
        simple_format_enabled: true,
        ublock_format_enabled: false,
      });

      const { loadDomainSettings } = await import('../domainFilter.js');
      await loadDomainSettings();

      expect((document.getElementById('whitelistTextarea') as HTMLTextAreaElement).value).toBe('a.com\nb.com');
      expect((document.getElementById('blacklistTextarea') as HTMLTextAreaElement).value).toBe('c.com');
    });

    test('should load simple_format_enabled=false', async () => {
      setupFullDOM();
      mockGetSettings.mockResolvedValueOnce({
        domain_filter_mode: 'disabled',
        domain_whitelist: [],
        domain_blacklist: [],
        simple_format_enabled: false,
        ublock_format_enabled: false,
      });

      const { loadDomainSettings } = await import('../domainFilter.js');
      await loadDomainSettings();

      expect((document.getElementById('simpleFormatEnabled') as HTMLInputElement).checked).toBe(false);
    });

    test('should load ublock_format_enabled=true', async () => {
      setupFullDOM();
      mockGetSettings.mockResolvedValueOnce({
        domain_filter_mode: 'disabled',
        domain_whitelist: [],
        domain_blacklist: [],
        simple_format_enabled: true,
        ublock_format_enabled: true,
      });

      const { loadDomainSettings } = await import('../domainFilter.js');
      await loadDomainSettings();

      expect((document.getElementById('ublockFormatEnabled') as HTMLInputElement).checked).toBe(true);
    });
  });

  // =========================================================================
  // handleSaveDomainSettings()
  // =========================================================================
  describe('handleSaveDomainSettings()', () => {
    test('should save whitelist settings', async () => {
      setupFullDOM();
      (document.getElementById('filterWhitelist') as HTMLInputElement).checked = true;
      (document.getElementById('domainList') as HTMLTextAreaElement).value = 'example.com\ntest.org';

      const { handleSaveDomainSettings } = await import('../domainFilter.js');
      await handleSaveDomainSettings();

      expect(mockSaveSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          domain_filter_mode: 'whitelist',
          domain_whitelist: ['example.com', 'test.org'],
        }),
        true
      );
    });

    test('should save blacklist settings', async () => {
      setupFullDOM();
      (document.getElementById('filterBlacklist') as HTMLInputElement).checked = true;
      (document.getElementById('domainList') as HTMLTextAreaElement).value = 'ads.com\nspam.net';

      const { handleSaveDomainSettings } = await import('../domainFilter.js');
      await handleSaveDomainSettings();

      expect(mockSaveSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          domain_filter_mode: 'blacklist',
          domain_blacklist: ['ads.com', 'spam.net'],
        }),
        true
      );
    });

    test('should call handleSaveUblockSettings', async () => {
      setupFullDOM();
      (document.getElementById('filterDisabled') as HTMLInputElement).checked = true;

      const { handleSaveDomainSettings } = await import('../domainFilter.js');
      await handleSaveDomainSettings();

      expect(mockHandleSaveUblockSettings).toHaveBeenCalled();
    });

    test('should handle save error gracefully', async () => {
      setupFullDOM();
      (document.getElementById('filterDisabled') as HTMLInputElement).checked = true;
      mockHandleSaveUblockSettings.mockRejectedValueOnce(new Error('Save failed'));

      const { handleSaveDomainSettings } = await import('../domainFilter.js');
      await handleSaveDomainSettings();

      expect(mockAddLog).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining('Error saving domain settings'),
        expect.objectContaining({ error: 'Save failed' })
      );
    });

    test('should show error when no filter mode selected', async () => {
      setupFullDOM();
      document.querySelectorAll('input[name="domainFilter"]').forEach((el) => {
        (el as HTMLInputElement).checked = false;
      });

      const { handleSaveDomainSettings } = await import('../domainFilter.js');
      await handleSaveDomainSettings();

      expect(mockShowStatus).toHaveBeenCalledWith('domainStatus', expect.any(String), 'error');
    });

    test('should validate domain list before saving', async () => {
      setupFullDOM();
      mockValidateDomainList.mockReturnValueOnce(['Invalid domain: bad..domain']);
      (document.getElementById('filterWhitelist') as HTMLInputElement).checked = true;
      (document.getElementById('domainList') as HTMLTextAreaElement).value = 'bad..domain';

      const { handleSaveDomainSettings } = await import('../domainFilter.js');
      await handleSaveDomainSettings();

      expect(mockShowStatus).toHaveBeenCalledWith('domainStatus', expect.stringContaining('Invalid domain'), 'error');
    });

    test('should handle storage saveSettings throwing', async () => {
      setupFullDOM();
      (document.getElementById('filterDisabled') as HTMLInputElement).checked = true;
      mockSaveSettings.mockRejectedValueOnce(new Error('Storage full'));

      const { handleSaveDomainSettings } = await import('../domainFilter.js');
      await handleSaveDomainSettings();

      expect(mockAddLog).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining('Error saving'),
        expect.objectContaining({ error: 'Storage full' })
      );
    });
  });

  // =========================================================================
  // Tab switching
  // =========================================================================
  describe('tab switching via init', () => {
    test('should activate general tab on click', async () => {
      setupFullDOM();
      const { init } = await import('../domainFilter.js');
      init();

      document.getElementById('generalTab')!.dispatchEvent(new Event('click'));

      expect(document.getElementById('generalTab')!.classList.contains('active')).toBe(true);
      expect(document.getElementById('generalTab')!.getAttribute('aria-selected')).toBe('true');
      expect(document.getElementById('domainTab')!.classList.contains('active')).toBe(false);
    });

    test('should activate prompt tab on click', async () => {
      setupFullDOM();
      const { init } = await import('../domainFilter.js');
      init();

      document.getElementById('promptTab')!.dispatchEvent(new Event('click'));

      expect(document.getElementById('promptTab')!.classList.contains('active')).toBe(true);
      expect(document.getElementById('promptPanel')!.classList.contains('active')).toBe(true);
      expect(document.getElementById('promptPanel')!.getAttribute('aria-hidden')).toBe('false');
    });

    test('should activate privacy tab on click', async () => {
      setupFullDOM();
      const { init } = await import('../domainFilter.js');
      init();

      document.getElementById('privacyTab')!.dispatchEvent(new Event('click'));

      expect(document.getElementById('privacyTab')!.classList.contains('active')).toBe(true);
    });

    test('should focus first focusable element in panel', async () => {
      setupFullDOM();
      const { init } = await import('../domainFilter.js');
      init();

      document.getElementById('generalTab')!.dispatchEvent(new Event('click'));

      expect(document.activeElement).toBe(document.getElementById('genBtn'));
    });
  });

  // =========================================================================
  // Keyboard navigation
  // =========================================================================
  describe('tab keyboard navigation', () => {
    test('should handle ArrowRight', async () => {
      setupFullDOM();
      const { init } = await import('../domainFilter.js');
      init();

      const tab1 = document.getElementById('tab1')!;
      tab1.focus();
      tab1.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

      expect(document.activeElement).toBe(document.getElementById('tab2'));
    });

    test('should handle ArrowLeft', async () => {
      setupFullDOM();
      const { init } = await import('../domainFilter.js');
      init();

      const tab2 = document.getElementById('tab2')!;
      tab2.focus();
      tab2.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));

      expect(document.activeElement).toBe(document.getElementById('tab1'));
    });

    test('should handle Home key', async () => {
      setupFullDOM();
      const { init } = await import('../domainFilter.js');
      init();

      document.getElementById('tab2')!.focus();
      document.getElementById('tab2')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));

      expect(document.activeElement).toBe(document.getElementById('tab1'));
    });

    test('should handle End key', async () => {
      setupFullDOM();
      const { init } = await import('../domainFilter.js');
      init();

      document.getElementById('tab1')!.focus();
      document.getElementById('tab1')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));

      expect(document.activeElement).toBe(document.getElementById('tab2'));
    });

    test('should handle Enter key to click active tab', async () => {
      setupFullDOM();
      const { init } = await import('../domainFilter.js');
      init();

      const tab1 = document.getElementById('tab1')!;
      const clickSpy = vi.spyOn(tab1, 'click');
      tab1.focus();
      tab1.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

      expect(clickSpy).toHaveBeenCalled();
    });

    test('should handle Space key to click active tab', async () => {
      setupFullDOM();
      const { init } = await import('../domainFilter.js');
      init();

      const tab1 = document.getElementById('tab1')!;
      const clickSpy = vi.spyOn(tab1, 'click');
      tab1.focus();
      tab1.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));

      expect(clickSpy).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Edge cases
  // =========================================================================
  describe('edge cases', () => {
    test('should handle missing optional DOM elements in init', async () => {
      document.body.innerHTML = '';
      const { init } = await import('../domainFilter.js');
      expect(() => init()).not.toThrow();
    });

    test('simple format checkbox change triggers toggleFormatUI', async () => {
      setupFullDOM();
      const { init } = await import('../domainFilter.js');
      init();

      const simpleCheckbox = document.getElementById('simpleFormatEnabled') as HTMLInputElement;
      simpleCheckbox.checked = false;
      simpleCheckbox.dispatchEvent(new Event('change'));

      expect(document.getElementById('simpleFormatUI')!.style.display).toBe('none');
    });

    test('ublock checkbox change triggers toggleFormatUI', async () => {
      setupFullDOM();
      const { init } = await import('../domainFilter.js');
      init();

      const ublockCheckbox = document.getElementById('ublockFormatEnabled') as HTMLInputElement;
      ublockCheckbox.checked = true;
      ublockCheckbox.dispatchEvent(new Event('change'));

      expect(document.getElementById('uBlockFormatUI')!.style.display).toBe('block');
    });
  });
});
