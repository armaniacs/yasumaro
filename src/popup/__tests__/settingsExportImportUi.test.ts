// @vitest-environment jsdom
/**
 * settingsExportImportUi.test.ts
 * Tests for settings export/import UI functionality
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ============================================================================
// Mock Setup
// ============================================================================

const mockGetSettings = vi.hoisted(() => vi.fn());
const mockSaveSettingsWithAllowedUrls = vi.hoisted(() => vi.fn());
const mockLogError = vi.hoisted(() => vi.fn());
const mockGetMessage = vi.hoisted(() => vi.fn());
const mockShowStatus = vi.hoisted(() => vi.fn());
const mockExportSettings = vi.hoisted(() => vi.fn());
const mockImportSettings = vi.hoisted(() => vi.fn());
const mockValidateExportData = vi.hoisted(() => vi.fn());
const mockExportEncryptedSettings = vi.hoisted(() => vi.fn());
const mockImportEncryptedSettings = vi.hoisted(() => vi.fn());
const mockSaveEncryptedExportToFile = vi.hoisted(() => vi.fn());
const mockIsEncryptedExport = vi.hoisted(() => vi.fn());
const mockLoadDomainSettings = vi.hoisted(() => vi.fn());
const mockLoadPrivacySettings = vi.hoisted(() => vi.fn());
const mockChromeI18nGetMessage = vi.hoisted(() => vi.fn());

vi.mock('../../utils/storage.js', () => ({
  getSettings: mockGetSettings,
  saveSettingsWithAllowedUrls: mockSaveSettingsWithAllowedUrls,
}));

vi.mock('../../utils/logger.js', () => ({
  logError: mockLogError,
  ErrorCode: {
    SETTINGS_EXPORT_FAILURE: 'SETTINGS_EXPORT_FAILURE',
    SETTINGS_IMPORT_FAILURE: 'SETTINGS_IMPORT_FAILURE',
    INTERNAL_ERROR: 'INTERNAL_ERROR',
  },
}));

vi.mock('../../utils/settingsExportImport.js', () => ({
  exportSettings: mockExportSettings,
  importSettings: mockImportSettings,
  validateExportData: mockValidateExportData,
  exportEncryptedSettings: mockExportEncryptedSettings,
  importEncryptedSettings: mockImportEncryptedSettings,
  saveEncryptedExportToFile: mockSaveEncryptedExportToFile,
  isEncryptedExport: mockIsEncryptedExport,
}));

vi.mock('../settingsUiHelper.js', () => ({
  showStatus: mockShowStatus,
}));

vi.mock('../../utils/i18n.js', () => ({
  getMessage: mockGetMessage,
}));

vi.mock('../domainFilter.js', () => ({
  loadDomainSettings: mockLoadDomainSettings,
}));

vi.mock('../privacySettings.js', () => ({
  loadPrivacySettings: mockLoadPrivacySettings,
}));

vi.stubGlobal('chrome', {
  i18n: { getMessage: mockChromeI18nGetMessage },
  runtime: { getURL: vi.fn() },
});

import { initSettingsExportImportUi } from '../settingsExportImportUi.js';

// ============================================================================
// Helpers
// ============================================================================

/**
 * M21: importConfirmModal is now a native <dialog>. jsdom doesn't implement
 * showModal()/close(), so polyfill them (close() also fires a real 'close'
 * event, since settingsExportImportUi.ts listens for it to reset state on
 * ESC-triggered dismissal).
 */
function polyfillDialogMethods(): void {
  const modal = document.getElementById('importConfirmModal') as any;
  if (!modal) return;
  modal.showModal = function () { this.open = true; };
  modal.close = function () {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
}

function setupDom(): void {
  document.body.innerHTML = `
    <button id="settingsMenuBtn" aria-expanded="false">Menu</button>
    <div id="settingsMenu" class="hidden"></div>
    <button id="exportSettingsBtn">Export</button>
    <button id="importSettingsBtn">Import</button>
    <input id="importFileInput" type="file" style="display:none" />
    <dialog id="importConfirmModal">
      <div id="importPreview"></div>
      <button id="closeImportModalBtn">Close</button>
      <button id="cancelImportBtn">Cancel</button>
      <button id="confirmImportBtn">Confirm</button>
    </dialog>
    <div id="status"></div>
  `;
  polyfillDialogMethods();
}

function createMockFile(content: string, name = 'settings.json'): File {
  return new File([content], name, { type: 'application/json' });
}

// ============================================================================
// Tests
// ============================================================================

describe('settingsExportImportUi', () => {
  let reloadFn: ReturnType<typeof vi.fn>;
  let showPasswordAuthModal: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setupDom();
    reloadFn = vi.fn().mockResolvedValue(undefined);
    showPasswordAuthModal = vi.fn();

    mockGetSettings.mockReset();
    mockSaveSettingsWithAllowedUrls.mockReset();
    mockLogError.mockReset();
    mockGetMessage.mockReset();
    mockShowStatus.mockReset();
    mockExportSettings.mockReset();
    mockImportSettings.mockReset();
    mockValidateExportData.mockReset();
    mockExportEncryptedSettings.mockReset();
    mockImportEncryptedSettings.mockReset();
    mockSaveEncryptedExportToFile.mockReset();
    mockIsEncryptedExport.mockReset();
    mockLoadDomainSettings.mockReset();
    mockLoadPrivacySettings.mockReset();
    mockChromeI18nGetMessage.mockReset();

    mockGetMessage.mockImplementation((key: string) => {
      const messages: Record<string, string> = {
        settingsExported: '設定をエクスポートしました',
        settingsImported: '設定をインポートしました',
        exportError: 'エクスポートエラー',
        importError: 'インポートエラー',
        invalidSettingsFile: '無効な設定ファイルです',
      };
      return messages[key] || key;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should toggle settings menu on button click', () => {
    initSettingsExportImportUi(reloadFn, showPasswordAuthModal);

    const menuBtn = document.getElementById('settingsMenuBtn') as HTMLElement;
    const menu = document.getElementById('settingsMenu') as HTMLElement;

    expect(menu.classList.contains('hidden')).toBe(true);

    menuBtn.click();
    expect(menu.classList.contains('hidden')).toBe(false);
    expect(menuBtn.getAttribute('aria-expanded')).toBe('true');

    menuBtn.click();
    expect(menu.classList.contains('hidden')).toBe(true);
    expect(menuBtn.getAttribute('aria-expanded')).toBe('false');
  });

  it('should close menu when clicking outside', () => {
    initSettingsExportImportUi(reloadFn, showPasswordAuthModal);

    const menuBtn = document.getElementById('settingsMenuBtn') as HTMLElement;
    const menu = document.getElementById('settingsMenu') as HTMLElement;

    menuBtn.click();
    expect(menu.classList.contains('hidden')).toBe(false);

    document.body.click();
    expect(menu.classList.contains('hidden')).toBe(true);
    expect(menuBtn.getAttribute('aria-expanded')).toBe('false');
  });

  it('should trigger file import dialog on import button click', () => {
    initSettingsExportImportUi(reloadFn, showPasswordAuthModal);
    const importBtn = document.getElementById('importSettingsBtn') as HTMLElement;
    const fileInput = document.getElementById('importFileInput') as HTMLInputElement;

    const clickSpy = vi.spyOn(fileInput, 'click');

    importBtn.click();
    expect(clickSpy).toHaveBeenCalled();
  });

  it('should call exportSettings when export button is clicked without MP', async () => {
    mockGetSettings.mockResolvedValue({ mp_protection_enabled: false });
    mockExportSettings.mockResolvedValue(undefined);

    initSettingsExportImportUi(reloadFn, showPasswordAuthModal);
    await new Promise(resolve => setTimeout(resolve, 0));

    const exportBtn = document.getElementById('exportSettingsBtn') as HTMLElement;
    exportBtn.click();

    await vi.waitFor(() => {
      expect(mockExportSettings).toHaveBeenCalled();
    });
    expect(mockShowStatus).toHaveBeenCalledWith(
      'status', '設定をエクスポートしました', 'success'
    );
  });

  it('should show password auth for encrypted export when MP enabled', async () => {
    mockGetSettings.mockResolvedValue({
      mp_protection_enabled: true,
      mp_encrypt_on_export: true,
    });

    initSettingsExportImportUi(reloadFn, showPasswordAuthModal);
    await new Promise(resolve => setTimeout(resolve, 0));

    const exportBtn = document.getElementById('exportSettingsBtn') as HTMLElement;
    exportBtn.click();

    await vi.waitFor(() => {
      expect(showPasswordAuthModal).toHaveBeenCalledWith(
        'export', expect.any(Function)
      );
    });
  });

  it('should handle export errors gracefully', async () => {
    mockGetSettings.mockRejectedValue(new Error('Storage failed'));

    initSettingsExportImportUi(reloadFn, showPasswordAuthModal);
    await new Promise(resolve => setTimeout(resolve, 0));

    const exportBtn = document.getElementById('exportSettingsBtn') as HTMLElement;
    exportBtn.click();

    await vi.waitFor(() => {
      expect(mockLogError).toHaveBeenCalledWith(
        'Export error',
        expect.objectContaining({ cause: 'Storage failed' }),
        'SETTINGS_EXPORT_FAILURE'
      );
    });
  });

  it('should show import preview when a valid file is imported', async () => {
    mockValidateExportData.mockReturnValue(true);
    mockChromeI18nGetMessage.mockImplementation((key: string) => {
      if (key === 'importPreviewSummary') return 'Summary:';
      if (key === 'importPreviewNote') return 'Note:';
      return key;
    });

    const fileContent = JSON.stringify({
      version: '1.0',
      exportedAt: new Date().toISOString(),
      settings: {
        obsidian_protocol: 'https',
        obsidian_port: '27124',
        ai_provider: 'gemini',
        domain_whitelist: ['example.com'],
        domain_blacklist: [],
        ublock_sources: ['source1'],
      },
    });

    initSettingsExportImportUi(reloadFn, showPasswordAuthModal);
    await new Promise(resolve => setTimeout(resolve, 0));

    const fileInput = document.getElementById('importFileInput') as HTMLInputElement;
    const file = createMockFile(fileContent);
    // jsdom File constructor may not support File, so use Object.defineProperty
    Object.defineProperty(fileInput, 'files', {
      value: [file],
      writable: false,
    });

    fileInput.dispatchEvent(new Event('change'));
    await new Promise(resolve => setTimeout(resolve, 50));

    const preview = document.getElementById('importPreview');
    expect(preview?.textContent).toContain('Summary:');
    expect(preview?.textContent).toContain('https');

    const modal = document.getElementById('importConfirmModal') as HTMLDialogElement;
    expect(modal.open).toBe(true);
  });

  it('should reject invalid import files', async () => {
    mockValidateExportData.mockReturnValue(false);

    const fileContent = JSON.stringify({ version: '1.0', settings: {} });

    initSettingsExportImportUi(reloadFn, showPasswordAuthModal);
    await new Promise(resolve => setTimeout(resolve, 0));

    const fileInput = document.getElementById('importFileInput') as HTMLInputElement;
    Object.defineProperty(fileInput, 'files', {
      value: [createMockFile(fileContent)],
      writable: false,
    });

    fileInput.dispatchEvent(new Event('change'));
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(mockShowStatus).toHaveBeenCalledWith(
      'status', '無効な設定ファイルです', 'error'
    );
  });

  it('should import settings on confirm', async () => {
    mockValidateExportData.mockReturnValue(true);
    mockImportSettings.mockResolvedValue(true);
    mockChromeI18nGetMessage.mockImplementation((key: string) => '');

    const fileContent = JSON.stringify({
      version: '1.0',
      exportedAt: new Date().toISOString(),
      settings: { obsidian_protocol: 'https' },
    });

    initSettingsExportImportUi(reloadFn, showPasswordAuthModal);
    await new Promise(resolve => setTimeout(resolve, 0));

    // Load file
    const fileInput = document.getElementById('importFileInput') as HTMLInputElement;
    Object.defineProperty(fileInput, 'files', {
      value: [createMockFile(fileContent)],
      writable: false,
    });
    fileInput.dispatchEvent(new Event('change'));
    await new Promise(resolve => setTimeout(resolve, 50));

    // Click confirm
    const confirmBtn = document.getElementById('confirmImportBtn') as HTMLElement;
    confirmBtn.click();
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(mockImportSettings).toHaveBeenCalled();
    expect(mockShowStatus).toHaveBeenCalledWith(
      'status', '設定をインポートしました', 'success'
    );
    expect(reloadFn).toHaveBeenCalled();
  });

  it('should close import modal when close button is clicked', async () => {
    mockValidateExportData.mockReturnValue(true);
    mockChromeI18nGetMessage.mockReturnValue('');

    const fileContent = JSON.stringify({
      version: '1.0',
      exportedAt: new Date().toISOString(),
      settings: {},
    });

    initSettingsExportImportUi(reloadFn, showPasswordAuthModal);
    await new Promise(resolve => setTimeout(resolve, 0));

    // Load file
    const fileInput = document.getElementById('importFileInput') as HTMLInputElement;
    Object.defineProperty(fileInput, 'files', {
      value: [createMockFile(fileContent)],
      writable: false,
    });
    fileInput.dispatchEvent(new Event('change'));
    await new Promise(resolve => setTimeout(resolve, 50));

    const modal = document.getElementById('importConfirmModal') as HTMLDialogElement;
    expect(modal.open).toBe(true);

    const closeBtn = document.getElementById('closeImportModalBtn') as HTMLElement;
    closeBtn.click();
    expect(modal.open).toBe(false);
  });

  it('should handle encrypted import flow', async () => {
    mockIsEncryptedExport.mockReturnValue(true);
    mockGetSettings.mockResolvedValue({ mp_require_on_import: true });
    mockImportEncryptedSettings.mockResolvedValue(true);

    const fileContent = JSON.stringify({
      encrypted: true,
      data: 'encrypted-data',
    });

    initSettingsExportImportUi(reloadFn, showPasswordAuthModal);
    await new Promise(resolve => setTimeout(resolve, 0));

    const fileInput = document.getElementById('importFileInput') as HTMLInputElement;
    Object.defineProperty(fileInput, 'files', {
      value: [createMockFile(fileContent)],
      writable: false,
    });
    fileInput.dispatchEvent(new Event('change'));

    await vi.waitFor(() => {
      expect(mockIsEncryptedExport).toHaveBeenCalled();
    });
    expect(showPasswordAuthModal).toHaveBeenCalledWith(
      'import', expect.any(Function)
    );
  });

  it('should handle non-encrypted flow when import file has no valid data', async () => {
    initSettingsExportImportUi(reloadFn, showPasswordAuthModal);
    await new Promise(resolve => setTimeout(resolve, 0));

    const fileInput = document.getElementById('importFileInput') as HTMLInputElement;
    Object.defineProperty(fileInput, 'files', {
      value: [createMockFile('not json')],
      writable: false,
    });
    fileInput.dispatchEvent(new Event('change'));
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(mockLogError).toHaveBeenCalled();
  });
});
