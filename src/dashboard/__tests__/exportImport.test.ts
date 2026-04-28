// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ------------------------------------------------------------------
// Mocks (must be before any imports)
// ------------------------------------------------------------------
vi.mock('../../utils/storage.js', () => ({
  getSettings: vi.fn().mockResolvedValue({}),
  saveSettingsWithAllowedUrls: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../popup/i18n.js', () => ({
  getMessage: vi.fn((key: string) => `i18n_${key}`),
}));

vi.mock('../../popup/settingsUiHelper.js', () => ({
  showStatus: vi.fn(),
}));

vi.mock('../../popup/utils/focusTrap.js', () => ({
  focusTrapManager: {
    trap: vi.fn().mockReturnValue('trap-id'),
    release: vi.fn(),
  },
}));

vi.mock('../../popup/domainFilter.js', () => ({
  loadDomainSettings: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../popup/privacySettings.js', () => ({
  loadPrivacySettings: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../popup/contentSettings.js', () => ({
  loadContentSettings: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../popup/trustSettings.js', () => ({
  loadTrustSettings: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../utils/settingsExportImport.js', () => ({
  exportSettings: vi.fn().mockResolvedValue(undefined),
  importSettings: vi.fn().mockResolvedValue(null),
  validateExportData: vi.fn().mockReturnValue(true),
  SettingsExportData: {},
  exportEncryptedSettings: vi.fn().mockResolvedValue({ success: true, encryptedData: { ciphertext: 'test' } }),
  importEncryptedSettings: vi.fn().mockResolvedValue(null),
  saveEncryptedExportToFile: vi.fn().mockResolvedValue(undefined),
  isEncryptedExport: vi.fn().mockReturnValue(false),
  EncryptedExportData: {},
  ExportFileData: {},
}));

vi.mock('../masterPassword.js', () => ({
  showPasswordAuthModal: vi.fn(),
}));

// Import mocked utilities for assertions
const { getSettings } = await import('../../utils/storage.js');
const { showStatus } = await import('../../popup/settingsUiHelper.js');
const { focusTrapManager } = await import('../../popup/utils/focusTrap.js');
const { showPasswordAuthModal } = await import('../masterPassword.js');
const {
  exportSettings,
  importSettings,
  validateExportData,
  exportEncryptedSettings,
  importEncryptedSettings,
  saveEncryptedExportToFile,
  isEncryptedExport,
} = await import('../../utils/settingsExportImport.js');
const { loadDomainSettings } = await import('../../popup/domainFilter.js');
const { loadPrivacySettings } = await import('../../popup/privacySettings.js');
const { loadContentSettings } = await import('../../popup/contentSettings.js');
const { loadTrustSettings } = await import('../../popup/trustSettings.js');

// Helper to get fresh module instance with current DOM
async function getFreshModule() {
  vi.resetModules();
  return import('../exportImport.js');
}

// ------------------------------------------------------------------
// closeImportModal tests
// ------------------------------------------------------------------
describe('closeImportModal', () => {
  it('hides the import modal', async () => {
    document.body.innerHTML = `
      <div id="importConfirmModal" class="show" style="display:flex" aria-hidden="false"></div>
      <div id="importPreview">preview</div>
    `;
    const { closeImportModal } = await getFreshModule();

    closeImportModal();
    const modal = document.getElementById('importConfirmModal')!;
    expect(modal.classList.contains('show')).toBe(false);
    expect(modal.style.display).toBe('none');
    expect(modal.classList.contains('hidden')).toBe(true);
    expect(modal.getAttribute('aria-hidden')).toBe('true');
  });

  it('does not throw when modal is missing', async () => {
    document.body.innerHTML = '';
    const { closeImportModal } = await getFreshModule();
    expect(() => closeImportModal()).not.toThrow();
  });

  it('clears import preview', async () => {
    document.body.innerHTML = `
      <div id="importConfirmModal"></div>
      <div id="importPreview">test data</div>
    `;
    const { closeImportModal } = await getFreshModule();
    closeImportModal();
    expect(document.getElementById('importPreview')!.textContent).toBe('');
  });
});

// ------------------------------------------------------------------
// initExportImport tests
// ------------------------------------------------------------------
describe('initExportImport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Helper to build standard DOM
  function buildDom() {
    document.body.innerHTML = `
      <button id="exportSettingsBtn">Export</button>
      <button id="importSettingsBtn">Import</button>
      <input type="file" id="importFileInput" />
      <div id="importConfirmModal" class="hidden" style="display:none"></div>
      <div id="importPreview"></div>
      <button id="closeImportModalBtn"></button>
      <button id="cancelImportBtn"></button>
      <button id="confirmImportBtn"></button>
      <div id="exportImportStatus"></div>
    `;
  }

  it('exports plain settings when master password is disabled', async () => {
    buildDom();
    vi.mocked(getSettings).mockResolvedValue({
      mp_protection_enabled: false,
      mp_encrypt_on_export: false,
    });

    const { initExportImport } = await getFreshModule();
    initExportImport();

    document.getElementById('exportSettingsBtn')!.click();
    await new Promise(r => setTimeout(r, 10));

    expect(exportSettings).toHaveBeenCalled();
    expect(showStatus).toHaveBeenCalledWith('exportImportStatus', expect.any(String), 'success');
  });

  it('exports encrypted settings when master password is enabled', async () => {
    buildDom();
    vi.mocked(getSettings).mockResolvedValue({
      mp_protection_enabled: true,
      mp_encrypt_on_export: true,
    });
    vi.mocked(showPasswordAuthModal).mockImplementation((_type, callback) => {
      callback('test-password');
    });

    const { initExportImport } = await getFreshModule();
    initExportImport();

    document.getElementById('exportSettingsBtn')!.click();
    await new Promise(r => setTimeout(r, 10));

    expect(showPasswordAuthModal).toHaveBeenCalledWith('export', expect.any(Function));
    expect(exportEncryptedSettings).toHaveBeenCalledWith('test-password');
    expect(saveEncryptedExportToFile).toHaveBeenCalled();
  });

  it('shows error when encrypted export fails', async () => {
    buildDom();
    vi.mocked(getSettings).mockResolvedValue({
      mp_protection_enabled: true,
      mp_encrypt_on_export: true,
    });
    vi.mocked(exportEncryptedSettings).mockResolvedValue({ success: false, error: 'Bad password' });
    vi.mocked(showPasswordAuthModal).mockImplementation((_type, callback) => {
      callback('test-password');
    });

    const { initExportImport } = await getFreshModule();
    initExportImport();

    document.getElementById('exportSettingsBtn')!.click();
    await new Promise(r => setTimeout(r, 10));

    expect(showStatus).toHaveBeenCalledWith('exportImportStatus', expect.stringContaining('exportError'), 'error');
  });

  it('shows export error on exception', async () => {
    buildDom();
    vi.mocked(getSettings).mockRejectedValue(new Error('Storage error'));

    const { initExportImport } = await getFreshModule();
    initExportImport();

    document.getElementById('exportSettingsBtn')!.click();
    await new Promise(r => setTimeout(r, 10));

    expect(showStatus).toHaveBeenCalledWith('exportImportStatus', expect.stringContaining('Storage error'), 'error');
  });

  it('triggers import file input when import button is clicked', async () => {
    buildDom();
    const { initExportImport } = await getFreshModule();
    initExportImport();

    const fileInput = document.getElementById('importFileInput') as HTMLInputElement;
    const clickSpy = vi.spyOn(fileInput, 'click');

    document.getElementById('importSettingsBtn')!.click();
    expect(clickSpy).toHaveBeenCalled();
  });

  // Helper to set files on input without DataTransfer
  function setFileOnInput(input: HTMLInputElement, file: File) {
    Object.defineProperty(input, 'files', {
      value: [file],
      writable: false,
      configurable: true,
    });
  }

  it('imports plain settings from file change event', async () => {
    buildDom();
    vi.mocked(isEncryptedExport).mockReturnValue(false);
    vi.mocked(validateExportData).mockReturnValue(true);

    const testData = {
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      settings: {
        obsidian_protocol: 'https',
        obsidian_port: '27124',
        min_visit_duration: 5,
        min_scroll_depth: 30,
        gemini_model: 'gemini-pro',
        obsidian_daily_path: 'Daily Notes',
        ai_provider: 'gemini',
        openai_base_url: 'https://api.openai.com',
        openai_model: 'gpt-4',
        openai_2_base_url: '',
        openai_2_model: '',
        domain_whitelist: [],
        domain_blacklist: [],
        domain_filter_mode: 'disabled',
        privacy_mode: 'disabled',
        pii_confirmation_ui: false,
        pii_sanitize_logs: false,
        ublock_rules: [],
        ublock_sources: [],
        ublock_format_enabled: false,
        simple_format_enabled: false,
      },
    };

    const file = new File([JSON.stringify(testData)], 'test.json', { type: 'application/json' });

    const { initExportImport } = await getFreshModule();
    initExportImport();

    const fileInput = document.getElementById('importFileInput') as HTMLInputElement;
    setFileOnInput(fileInput, file);
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));

    await new Promise(r => setTimeout(r, 10));

    expect(validateExportData).toHaveBeenCalled();
    const modal = document.getElementById('importConfirmModal')!;
    expect(modal.classList.contains('hidden')).toBe(false);
    expect(modal.style.display).toBe('flex');
    expect(focusTrapManager.trap).toHaveBeenCalled();
  });

  it('imports encrypted settings when mp_require_on_import is true', async () => {
    buildDom();
    vi.mocked(getSettings).mockResolvedValue({ mp_require_on_import: true });
    vi.mocked(isEncryptedExport).mockReturnValue(true);
    vi.mocked(importEncryptedSettings).mockResolvedValue({ obsidian_protocol: 'https' });
    vi.mocked(showPasswordAuthModal).mockImplementation((_type, callback) => {
      callback('secret-password');
    });

    const encryptedData = {
      encrypted: true,
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      ciphertext: 'abc',
      iv: 'def',
      hmac: 'ghi',
      salt: 'jkl',
    };

    const file = new File([JSON.stringify(encryptedData)], 'test-encrypted.json', { type: 'application/json' });

    const { initExportImport } = await getFreshModule();
    initExportImport();

    const fileInput = document.getElementById('importFileInput') as HTMLInputElement;
    setFileOnInput(fileInput, file);
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));

    await new Promise(r => setTimeout(r, 10));

    expect(showPasswordAuthModal).toHaveBeenCalledWith('import', expect.any(Function));
    expect(importEncryptedSettings).toHaveBeenCalledWith(expect.any(String), 'secret-password');
    expect(showStatus).toHaveBeenCalledWith('exportImportStatus', expect.any(String), 'success');
    expect(loadDomainSettings).toHaveBeenCalled();
    expect(loadPrivacySettings).toHaveBeenCalled();
    expect(loadContentSettings).toHaveBeenCalled();
    expect(loadTrustSettings).toHaveBeenCalled();
  });

  it('shows warning and prompts password when mp_require_on_import is false for encrypted file', async () => {
    buildDom();
    vi.mocked(getSettings).mockResolvedValue({ mp_require_on_import: false });
    vi.mocked(isEncryptedExport).mockReturnValue(true);

    const originalConfirm = window.confirm;
    window.confirm = vi.fn().mockReturnValue(true);
    vi.mocked(showPasswordAuthModal).mockImplementation((_type, callback) => {
      callback('secret-password');
    });

    const encryptedData = {
      encrypted: true,
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      ciphertext: 'abc',
      iv: 'def',
      hmac: 'ghi',
      salt: 'jkl',
    };

    const file = new File([JSON.stringify(encryptedData)], 'test-encrypted.json', { type: 'application/json' });

    const { initExportImport } = await getFreshModule();
    initExportImport();

    const fileInput = document.getElementById('importFileInput') as HTMLInputElement;
    setFileOnInput(fileInput, file);
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));

    await new Promise(r => setTimeout(r, 10));

    expect(window.confirm).toHaveBeenCalled();
    expect(showPasswordAuthModal).toHaveBeenCalledWith('import', expect.any(Function));

    window.confirm = originalConfirm;
  });

  it('shows error for invalid settings file', async () => {
    buildDom();
    vi.mocked(isEncryptedExport).mockReturnValue(false);
    vi.mocked(validateExportData).mockReturnValue(false);

    const testData = { version: '1.0.0', settings: {} };
    const file = new File([JSON.stringify(testData)], 'test.json', { type: 'application/json' });

    const { initExportImport } = await getFreshModule();
    initExportImport();

    const fileInput = document.getElementById('importFileInput') as HTMLInputElement;
    setFileOnInput(fileInput, file);
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));

    await new Promise(r => setTimeout(r, 10));

    expect(showStatus).toHaveBeenCalledWith('exportImportStatus', expect.stringContaining('invalidSettingsFile'), 'error');
    expect(fileInput.value).toBe('');
  });

  it('shows import error on JSON parse error', async () => {
    buildDom();
    const file = new File(['not valid json'], 'test.json', { type: 'application/json' });

    const { initExportImport } = await getFreshModule();
    initExportImport();

    const fileInput = document.getElementById('importFileInput') as HTMLInputElement;
    setFileOnInput(fileInput, file);
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));

    await new Promise(r => setTimeout(r, 10));

    expect(showStatus).toHaveBeenCalledWith('exportImportStatus', expect.stringContaining('importError'), 'error');
  });

  it('closes modal when close button is clicked', async () => {
    document.body.innerHTML = `
      <button id="exportSettingsBtn">Export</button>
      <button id="importSettingsBtn">Import</button>
      <input type="file" id="importFileInput" />
      <div id="importConfirmModal" class="show" style="display:flex" aria-hidden="false"></div>
      <div id="importPreview"></div>
      <button id="closeImportModalBtn"></button>
      <button id="cancelImportBtn"></button>
      <button id="confirmImportBtn"></button>
      <div id="exportImportStatus"></div>
    `;

    const { initExportImport, closeImportModal } = await getFreshModule();
    initExportImport();

    document.getElementById('closeImportModalBtn')!.click();
    const modal = document.getElementById('importConfirmModal')!;
    expect(modal.classList.contains('show')).toBe(false);
  });

  it('closes modal when cancel button is clicked', async () => {
    document.body.innerHTML = `
      <button id="exportSettingsBtn">Export</button>
      <button id="importSettingsBtn">Import</button>
      <input type="file" id="importFileInput" />
      <div id="importConfirmModal" class="show" style="display:flex" aria-hidden="false"></div>
      <div id="importPreview"></div>
      <button id="closeImportModalBtn"></button>
      <button id="cancelImportBtn"></button>
      <button id="confirmImportBtn"></button>
      <div id="exportImportStatus"></div>
    `;

    const { initExportImport } = await getFreshModule();
    initExportImport();

    document.getElementById('cancelImportBtn')!.click();
    const modal = document.getElementById('importConfirmModal')!;
    expect(modal.classList.contains('show')).toBe(false);
  });

  it('closes modal when clicking outside modal content', async () => {
    document.body.innerHTML = `
      <button id="exportSettingsBtn">Export</button>
      <button id="importSettingsBtn">Import</button>
      <input type="file" id="importFileInput" />
      <div id="importConfirmModal" class="show" style="display:flex" aria-hidden="false"></div>
      <div id="importPreview"></div>
      <button id="closeImportModalBtn"></button>
      <button id="cancelImportBtn"></button>
      <button id="confirmImportBtn"></button>
      <div id="exportImportStatus"></div>
    `;

    const { initExportImport } = await getFreshModule();
    initExportImport();

    const modal = document.getElementById('importConfirmModal')!;
    modal.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(modal.classList.contains('show')).toBe(false);
  });

  it('does not close modal when clicking inside modal content', async () => {
    document.body.innerHTML = `
      <button id="exportSettingsBtn">Export</button>
      <button id="importSettingsBtn">Import</button>
      <input type="file" id="importFileInput" />
      <div id="importConfirmModal" class="show" style="display:flex" aria-hidden="false">
        <div id="modalInner">Inner</div>
      </div>
      <div id="importPreview"></div>
      <button id="closeImportModalBtn"></button>
      <button id="cancelImportBtn"></button>
      <button id="confirmImportBtn"></button>
      <div id="exportImportStatus"></div>
    `;

    const { initExportImport } = await getFreshModule();
    initExportImport();

    const modal = document.getElementById('importConfirmModal')!;
    document.getElementById('modalInner')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(modal.classList.contains('show')).toBe(true);
  });

  it('confirms import and applies settings', async () => {
    buildDom();
    vi.mocked(isEncryptedExport).mockReturnValue(false);
    vi.mocked(validateExportData).mockReturnValue(true);
    vi.mocked(importSettings).mockResolvedValue({ obsidian_protocol: 'https' });

    const testData = {
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      settings: {
        obsidian_protocol: 'https',
        obsidian_port: '27124',
        min_visit_duration: 5,
        min_scroll_depth: 30,
        gemini_model: 'gemini-pro',
        obsidian_daily_path: 'Daily Notes',
        ai_provider: 'gemini',
        openai_base_url: 'https://api.openai.com',
        openai_model: 'gpt-4',
        openai_2_base_url: '',
        openai_2_model: '',
        domain_whitelist: [],
        domain_blacklist: [],
        domain_filter_mode: 'disabled',
        privacy_mode: 'disabled',
        pii_confirmation_ui: false,
        pii_sanitize_logs: false,
        ublock_rules: [],
        ublock_sources: [],
        ublock_format_enabled: false,
        simple_format_enabled: false,
      },
    };

    const file = new File([JSON.stringify(testData)], 'test.json', { type: 'application/json' });

    const { initExportImport } = await getFreshModule();
    initExportImport();

    const fileInput = document.getElementById('importFileInput') as HTMLInputElement;
    setFileOnInput(fileInput, file);
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));

    await new Promise(r => setTimeout(r, 10));

    document.getElementById('confirmImportBtn')!.click();
    await new Promise(r => setTimeout(r, 10));

    expect(importSettings).toHaveBeenCalledWith(expect.any(String));
    expect(showStatus).toHaveBeenCalledWith('exportImportStatus', expect.any(String), 'success');
    expect(loadDomainSettings).toHaveBeenCalled();
  });

  it('shows error when import apply fails', async () => {
    buildDom();
    vi.mocked(isEncryptedExport).mockReturnValue(false);
    vi.mocked(validateExportData).mockReturnValue(true);
    vi.mocked(importSettings).mockResolvedValue(null);

    const testData = {
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      settings: {
        obsidian_protocol: 'https',
        obsidian_port: '27124',
        min_visit_duration: 5,
        min_scroll_depth: 30,
        gemini_model: 'gemini-pro',
        obsidian_daily_path: 'Daily Notes',
        ai_provider: 'gemini',
        openai_base_url: 'https://api.openai.com',
        openai_model: 'gpt-4',
        openai_2_base_url: '',
        openai_2_model: '',
        domain_whitelist: [],
        domain_blacklist: [],
        domain_filter_mode: 'disabled',
        privacy_mode: 'disabled',
        pii_confirmation_ui: false,
        pii_sanitize_logs: false,
        ublock_rules: [],
        ublock_sources: [],
        ublock_format_enabled: false,
        simple_format_enabled: false,
      },
    };

    const file = new File([JSON.stringify(testData)], 'test.json', { type: 'application/json' });

    const { initExportImport } = await getFreshModule();
    initExportImport();

    const fileInput = document.getElementById('importFileInput') as HTMLInputElement;
    setFileOnInput(fileInput, file);
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));

    await new Promise(r => setTimeout(r, 10));

    document.getElementById('confirmImportBtn')!.click();
    await new Promise(r => setTimeout(r, 10));

    expect(showStatus).toHaveBeenCalledWith('exportImportStatus', expect.stringContaining('importError'), 'error');
  });

  it('returns early when confirm import with no pending data', async () => {
    buildDom();

    const { initExportImport } = await getFreshModule();
    initExportImport();

    document.getElementById('confirmImportBtn')!.click();
    await new Promise(r => setTimeout(r, 10));

    expect(importSettings).not.toHaveBeenCalled();
  });

  it('shows error when encrypted import decrypt fails', async () => {
    buildDom();
    vi.mocked(getSettings).mockResolvedValue({ mp_require_on_import: true });
    vi.mocked(isEncryptedExport).mockReturnValue(true);
    vi.mocked(importEncryptedSettings).mockResolvedValue(null);
    vi.mocked(showPasswordAuthModal).mockImplementation((_type, callback) => {
      callback('wrong-password');
    });

    const encryptedData = {
      encrypted: true,
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      ciphertext: 'abc',
      iv: 'def',
      hmac: 'ghi',
      salt: 'jkl',
    };

    const file = new File([JSON.stringify(encryptedData)], 'test-encrypted.json', { type: 'application/json' });

    const { initExportImport } = await getFreshModule();
    initExportImport();

    const fileInput = document.getElementById('importFileInput') as HTMLInputElement;
    setFileOnInput(fileInput, file);
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));

    await new Promise(r => setTimeout(r, 10));

    expect(showPasswordAuthModal).toHaveBeenCalledWith('import', expect.any(Function));
    expect(importEncryptedSettings).toHaveBeenCalledWith(expect.any(String), 'wrong-password');
    expect(showStatus).toHaveBeenCalledWith('exportImportStatus', expect.stringContaining('importError'), 'error');
  });

  it('shows error when confirm import throws exception', async () => {
    buildDom();
    vi.mocked(isEncryptedExport).mockReturnValue(false);
    vi.mocked(validateExportData).mockReturnValue(true);
    vi.mocked(importSettings).mockRejectedValue(new Error('storage full'));

    const testData = {
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      settings: {
        obsidian_protocol: 'https',
        obsidian_port: '27124',
        domain_whitelist: [],
        domain_blacklist: [],
        domain_filter_mode: 'disabled',
        privacy_mode: 'disabled',
      },
    };

    const file = new File([JSON.stringify(testData)], 'test.json', { type: 'application/json' });

    const { initExportImport } = await getFreshModule();
    initExportImport();

    const fileInput = document.getElementById('importFileInput') as HTMLInputElement;
    setFileOnInput(fileInput, file);
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));

    await new Promise(r => setTimeout(r, 10));

    document.getElementById('confirmImportBtn')!.click();
    await new Promise(r => setTimeout(r, 10));

    expect(showStatus).toHaveBeenCalledWith('exportImportStatus', expect.stringContaining('storage full'), 'error');
  });
});
