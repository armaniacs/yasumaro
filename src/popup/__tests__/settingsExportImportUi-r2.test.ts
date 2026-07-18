// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

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

/**
 * M21: importConfirmModal is now a native <dialog>. jsdom doesn't implement
 * showModal()/close(), so polyfill them.
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

describe('settingsExportImportUi - r2 missed branches', () => {
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
        settingsExported: 'Settings exported',
        settingsImported: 'Settings imported',
        exportError: 'Export error',
        importError: 'Import error',
        invalidSettingsFile: 'Invalid settings file',
        importPasswordRequired: 'Master password required',
      };
      return messages[key] || key;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('encrypted export failure', () => {
    it('should show error when encrypted export fails', async () => {
      mockGetSettings.mockResolvedValue({
        mp_protection_enabled: true,
        mp_encrypt_on_export: true,
      });
      mockExportEncryptedSettings.mockResolvedValue({ success: false, error: 'Encryption failed' });

      initSettingsExportImportUi(reloadFn, showPasswordAuthModal);
      await new Promise((resolve) => setTimeout(resolve, 0));

      mockExportSettings.mockRejectedValueOnce(new Error('not called'));
      const exportBtn = document.getElementById('exportSettingsBtn') as HTMLElement;
      exportBtn.click();

      await vi.waitFor(() => {
        expect(showPasswordAuthModal).toHaveBeenCalledWith('export', expect.any(Function));
      });

      const callback = showPasswordAuthModal.mock.calls[0][1];
      await callback('password');

      await vi.waitFor(() => {
        expect(mockSaveEncryptedExportToFile).not.toHaveBeenCalled();
        expect(mockShowStatus).toHaveBeenCalledWith('status', 'Export error: Encryption failed', 'error');
      });
    });
  });

  describe('export with MP enabled but not encrypt_on_export', () => {
    it('should use regular export when mp_encrypt_on_export is false', async () => {
      mockGetSettings.mockResolvedValue({
        mp_protection_enabled: true,
        mp_encrypt_on_export: false,
      });
      mockExportSettings.mockResolvedValue(undefined);

      initSettingsExportImportUi(reloadFn, showPasswordAuthModal);
      await new Promise((resolve) => setTimeout(resolve, 0));

      document.getElementById('exportSettingsBtn')!.click();

      await vi.waitFor(() => {
        expect(mockExportSettings).toHaveBeenCalled();
      });

      expect(showPasswordAuthModal).not.toHaveBeenCalled();
    });
  });

  describe('import encrypted with require_on_import false', () => {
    it('should show confirm dialog when mp_require_on_import is false', async () => {
      mockIsEncryptedExport.mockReturnValue(true);
      mockGetSettings.mockResolvedValue({ mp_require_on_import: false });

      const origConfirm = globalThis.confirm;
      globalThis.confirm = vi.fn().mockReturnValue(true);

      const fileContent = JSON.stringify({ encrypted: true, data: 'test' });

      initSettingsExportImportUi(reloadFn, showPasswordAuthModal);
      await new Promise((resolve) => setTimeout(resolve, 0));

      const fileInput = document.getElementById('importFileInput') as HTMLInputElement;
      Object.defineProperty(fileInput, 'files', {
        value: [createMockFile(fileContent)],
        writable: false,
      });
      fileInput.dispatchEvent(new Event('change'));

      await vi.waitFor(() => {
        expect(mockIsEncryptedExport).toHaveBeenCalled();
      });

      expect(globalThis.confirm).toHaveBeenCalled();
      expect(showPasswordAuthModal).toHaveBeenCalledWith('import', expect.any(Function));

      globalThis.confirm = origConfirm;
    });

    it('should not show auth modal when confirm is cancelled', async () => {
      mockIsEncryptedExport.mockReturnValue(true);
      mockGetSettings.mockResolvedValue({ mp_require_on_import: false });

      const origConfirm = globalThis.confirm;
      globalThis.confirm = vi.fn().mockReturnValue(false);

      const fileContent = JSON.stringify({ encrypted: true, data: 'test' });

      initSettingsExportImportUi(reloadFn, showPasswordAuthModal);
      await new Promise((resolve) => setTimeout(resolve, 0));

      const fileInput = document.getElementById('importFileInput') as HTMLInputElement;
      Object.defineProperty(fileInput, 'files', {
        value: [createMockFile(fileContent)],
        writable: false,
      });
      fileInput.dispatchEvent(new Event('change'));

      await vi.waitFor(() => {
        expect(globalThis.confirm).toHaveBeenCalled();
      });

      expect(showPasswordAuthModal).not.toHaveBeenCalled();

      globalThis.confirm = origConfirm;
    });
  });

  describe('import confirm with no pending data', () => {
    it('should close modal when no pendingImportJson', async () => {
      initSettingsExportImportUi(reloadFn, showPasswordAuthModal);
      await new Promise((resolve) => setTimeout(resolve, 0));

      document.getElementById('confirmImportBtn')!.click();
      await new Promise((resolve) => setTimeout(resolve, 10));

      const modal = document.getElementById('importConfirmModal') as HTMLDialogElement;
      expect(modal.open).toBe(false);
    });
  });

  describe('import modal close by outside click', () => {
    it('should close modal when clicking backdrop', async () => {
      mockValidateExportData.mockReturnValue(true);
      mockChromeI18nGetMessage.mockReturnValue('');

      const fileContent = JSON.stringify({
        version: '1.0',
        exportedAt: new Date().toISOString(),
        settings: {},
      });

      initSettingsExportImportUi(reloadFn, showPasswordAuthModal);
      await new Promise((resolve) => setTimeout(resolve, 0));

      const fileInput = document.getElementById('importFileInput') as HTMLInputElement;
      Object.defineProperty(fileInput, 'files', {
        value: [createMockFile(fileContent)],
        writable: false,
      });
      fileInput.dispatchEvent(new Event('change'));
      await new Promise((resolve) => setTimeout(resolve, 50));

      const modal = document.getElementById('importConfirmModal') as HTMLDialogElement;
      expect(modal.open).toBe(true);

      // Simulate a backdrop click: event.target === the dialog itself
      const backdropClick = new MouseEvent('click', { bubbles: true });
      Object.defineProperty(backdropClick, 'target', { value: modal });
      modal.dispatchEvent(backdropClick);
      expect(modal.open).toBe(false);
    });
  });

  describe('import modal close button (M21: native dialog)', () => {
    it('calls showModal()/close() instead of the old focus-trap flow', async () => {
      mockValidateExportData.mockReturnValue(true);
      mockChromeI18nGetMessage.mockReturnValue('');

      const fileContent = JSON.stringify({
        version: '1.0',
        exportedAt: new Date().toISOString(),
        settings: {},
      });

      initSettingsExportImportUi(reloadFn, showPasswordAuthModal);
      await new Promise((resolve) => setTimeout(resolve, 0));

      const modal = document.getElementById('importConfirmModal') as HTMLDialogElement;
      const showModalSpy = vi.spyOn(modal, 'showModal');
      const closeSpy = vi.spyOn(modal, 'close');

      const fileInput = document.getElementById('importFileInput') as HTMLInputElement;
      Object.defineProperty(fileInput, 'files', {
        value: [createMockFile(fileContent)],
        writable: false,
      });
      fileInput.dispatchEvent(new Event('change'));
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(showModalSpy).toHaveBeenCalled();

      document.getElementById('closeImportModalBtn')!.click();
      expect(closeSpy).toHaveBeenCalled();
    });
  });

  describe('import confirm import failure', () => {
    it('should show error when importSettings returns false', async () => {
      mockValidateExportData.mockReturnValue(true);
      mockImportSettings.mockResolvedValue(false);
      mockChromeI18nGetMessage.mockReturnValue('');

      const fileContent = JSON.stringify({
        version: '1.0',
        exportedAt: new Date().toISOString(),
        settings: { obsidian_protocol: 'https' },
      });

      initSettingsExportImportUi(reloadFn, showPasswordAuthModal);
      await new Promise((resolve) => setTimeout(resolve, 0));

      const fileInput = document.getElementById('importFileInput') as HTMLInputElement;
      Object.defineProperty(fileInput, 'files', {
        value: [createMockFile(fileContent)],
        writable: false,
      });
      fileInput.dispatchEvent(new Event('change'));
      await new Promise((resolve) => setTimeout(resolve, 50));

      document.getElementById('confirmImportBtn')!.click();
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockShowStatus).toHaveBeenCalledWith('status', 'Import error: Failed to apply settings', 'error');
    });
  });

  describe('import confirm success', () => {
    it('should call reloadFn and load domain/privacy settings', async () => {
      mockValidateExportData.mockReturnValue(true);
      mockImportSettings.mockResolvedValue(true);
      mockChromeI18nGetMessage.mockReturnValue('');

      const fileContent = JSON.stringify({
        version: '1.0',
        exportedAt: new Date().toISOString(),
        settings: { obsidian_protocol: 'https' },
      });

      initSettingsExportImportUi(reloadFn, showPasswordAuthModal);
      await new Promise((resolve) => setTimeout(resolve, 0));

      const fileInput = document.getElementById('importFileInput') as HTMLInputElement;
      Object.defineProperty(fileInput, 'files', {
        value: [createMockFile(fileContent)],
        writable: false,
      });
      fileInput.dispatchEvent(new Event('change'));
      await new Promise((resolve) => setTimeout(resolve, 50));

      document.getElementById('confirmImportBtn')!.click();
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockLoadDomainSettings).toHaveBeenCalled();
      expect(mockLoadPrivacySettings).toHaveBeenCalled();
      expect(reloadFn).toHaveBeenCalled();
    });
  });

  describe('import confirm with exception', () => {
    it('should log error when import throws', async () => {
      mockValidateExportData.mockReturnValue(true);
      mockImportSettings.mockRejectedValue(new Error('Import crashed'));
      mockChromeI18nGetMessage.mockReturnValue('');

      const fileContent = JSON.stringify({
        version: '1.0',
        exportedAt: new Date().toISOString(),
        settings: {},
      });

      initSettingsExportImportUi(reloadFn, showPasswordAuthModal);
      await new Promise((resolve) => setTimeout(resolve, 0));

      const fileInput = document.getElementById('importFileInput') as HTMLInputElement;
      Object.defineProperty(fileInput, 'files', {
        value: [createMockFile(fileContent)],
        writable: false,
      });
      fileInput.dispatchEvent(new Event('change'));
      await new Promise((resolve) => setTimeout(resolve, 50));

      document.getElementById('confirmImportBtn')!.click();
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockLogError).toHaveBeenCalledWith(
        'Import error',
        expect.objectContaining({ cause: 'Import crashed' }),
        'SETTINGS_IMPORT_FAILURE'
      );
    });
  });

  describe('encrypted import success', () => {
    it('should import encrypted settings and show success', async () => {
      mockIsEncryptedExport.mockReturnValue(true);
      mockGetSettings.mockResolvedValue({ mp_require_on_import: true });
      mockImportEncryptedSettings.mockResolvedValue(true);

      const fileContent = JSON.stringify({ encrypted: true, data: 'encrypted' });

      initSettingsExportImportUi(reloadFn, showPasswordAuthModal);
      await new Promise((resolve) => setTimeout(resolve, 0));

      const fileInput = document.getElementById('importFileInput') as HTMLInputElement;
      Object.defineProperty(fileInput, 'files', {
        value: [createMockFile(fileContent)],
        writable: false,
      });
      fileInput.dispatchEvent(new Event('change'));

      await vi.waitFor(() => {
        expect(showPasswordAuthModal).toHaveBeenCalledWith('import', expect.any(Function));
      });

      const callback = showPasswordAuthModal.mock.calls[0][1];
      await callback('password');

      await vi.waitFor(() => {
        expect(mockShowStatus).toHaveBeenCalledWith('status', 'Settings imported', 'success');
      });

      expect(reloadFn).toHaveBeenCalled();
      expect(mockLoadDomainSettings).toHaveBeenCalled();
      expect(mockLoadPrivacySettings).toHaveBeenCalled();
    });

    it('should show error when encrypted import fails', async () => {
      mockIsEncryptedExport.mockReturnValue(true);
      mockGetSettings.mockResolvedValue({ mp_require_on_import: true });
      mockImportEncryptedSettings.mockResolvedValue(null);

      const fileContent = JSON.stringify({ encrypted: true, data: 'encrypted' });

      initSettingsExportImportUi(reloadFn, showPasswordAuthModal);
      await new Promise((resolve) => setTimeout(resolve, 0));

      const fileInput = document.getElementById('importFileInput') as HTMLInputElement;
      Object.defineProperty(fileInput, 'files', {
        value: [createMockFile(fileContent)],
        writable: false,
      });
      fileInput.dispatchEvent(new Event('change'));

      await vi.waitFor(() => {
        expect(showPasswordAuthModal).toHaveBeenCalledWith('import', expect.any(Function));
      });

      const callback = showPasswordAuthModal.mock.calls[0][1];
      await callback('password');

      await vi.waitFor(() => {
        expect(mockShowStatus).toHaveBeenCalledWith(
          'status',
          expect.stringContaining('Failed to decrypt'),
          'error'
        );
      });
    });
  });
});
