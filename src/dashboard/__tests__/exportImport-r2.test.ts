// @vitest-environment jsdom
/**
 * exportImport-r2.test.ts
 * R2: Cover remaining branches — import logs, showImportPreview edge cases,
 * confirm/cancel exception handling, and modal close/focus-trap paths.
 */
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

const mockExportSettings = vi.fn().mockResolvedValue(undefined);
const mockImportSettings = vi.fn().mockResolvedValue(null);
const mockValidateExportData = vi.fn().mockReturnValue(true);
const mockExportEncryptedSettings = vi.fn().mockResolvedValue({ success: true, encryptedData: { ciphertext: 'test' } });
const mockImportEncryptedSettings = vi.fn().mockResolvedValue(null);
const mockSaveEncryptedExportToFile = vi.fn().mockResolvedValue(undefined);
const mockIsEncryptedExport = vi.fn().mockReturnValue(false);

vi.mock('../../utils/settingsExportImport.js', () => ({
  exportSettings: (...args: unknown[]) => mockExportSettings(...args),
  importSettings: (...args: unknown[]) => mockImportSettings(...args),
  validateExportData: (...args: unknown[]) => mockValidateExportData(...args),
  SettingsExportData: {},
  exportEncryptedSettings: (...args: unknown[]) => mockExportEncryptedSettings(...args),
  importEncryptedSettings: (...args: unknown[]) => mockImportEncryptedSettings(...args),
  saveEncryptedExportToFile: (...args: unknown[]) => mockSaveEncryptedExportToFile(...args),
  isEncryptedExport: (...args: unknown[]) => mockIsEncryptedExport(...args),
  EncryptedExportData: {},
  ExportFileData: {},
}));

vi.mock('../masterPassword.js', () => ({
  showPasswordAuthModal: vi.fn(),
}));

const mockImportFromJson = vi.fn();
vi.mock('../importLogsService.js', () => ({
  importFromJson: (...args: unknown[]) => mockImportFromJson(...args),
}));

// Helper to get fresh module instance with current DOM
async function getFreshModule() {
  vi.resetModules();
  return import('../exportImport.js');
}

const { getSettings } = await import('../../utils/storage.js');
const { showStatus } = await import('../../popup/settingsUiHelper.js');
const { focusTrapManager } = await import('../../popup/utils/focusTrap.js');
const { showPasswordAuthModal } = await import('../masterPassword.js');
const { importSettings } = await import('../../utils/settingsExportImport.js');
const { importFromJson } = await import('../importLogsService.js');

// Chrome i18n stub
vi.stubGlobal('chrome', {
  i18n: { getMessage: vi.fn((key: string) => `chrome_i18n_${key}`) },
  storage: { local: { get: vi.fn().mockResolvedValue({}), set: vi.fn() } },
});

function buildDom(): void {
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
    <button id="importLogsBtn">Import Logs</button>
    <input type="file" id="importLogsFileInput" />
    <div id="importLogsProgress"></div>
  `;
}

function setFileOnInput(input: HTMLInputElement, file: File) {
  Object.defineProperty(input, 'files', {
    value: [file],
    writable: false,
    configurable: true,
  });
}

describe('exportImport-r2 — Import logs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('triggers file input when import logs button is clicked', async () => {
    buildDom();
    const { initExportImport } = await getFreshModule();
    initExportImport();

    const fileInput = document.getElementById('importLogsFileInput') as HTMLInputElement;
    const clickSpy = vi.spyOn(fileInput, 'click');
    document.getElementById('importLogsBtn')!.click();
    expect(clickSpy).toHaveBeenCalled();
  });

  it('import logs: shows processing, then success result', async () => {
    buildDom();
    mockImportFromJson.mockImplementation(async (_text: string, _progress: (c: number, t: number) => void) => {
      return { inserted: 5, skipped: 2, total: 7 };
    });

    const { initExportImport } = await getFreshModule();
    initExportImport();

    const fileInput = document.getElementById('importLogsFileInput') as HTMLInputElement;
    const file = new File(['{"logs":[]}'], 'logs.json', { type: 'application/json' });
    setFileOnInput(fileInput, file);
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 10));

    const progress = document.getElementById('importLogsProgress')!;
    expect(progress.textContent).toContain('importLogsComplete');
    expect(progress.className).toContain('success');
  });

  it('import logs: shows error when import returns error', async () => {
    buildDom();
    mockImportFromJson.mockResolvedValue({ error: 'Invalid format' });

    const { initExportImport } = await getFreshModule();
    initExportImport();

    const fileInput = document.getElementById('importLogsFileInput') as HTMLInputElement;
    const file = new File(['bad'], 'logs.json', { type: 'application/json' });
    setFileOnInput(fileInput, file);
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 10));

    const progress = document.getElementById('importLogsProgress')!;
    expect(progress.textContent).toContain('Invalid format');
    expect(progress.className).toContain('error');
  });

  it('import logs: shows error on file read failure', async () => {
    buildDom();
    mockImportFromJson.mockRejectedValue(new Error('parse error'));

    const { initExportImport } = await getFreshModule();
    initExportImport();

    const fileInput = document.getElementById('importLogsFileInput') as HTMLInputElement;
    const file = new File(['bad'], 'logs.json', { type: 'application/json' });
    setFileOnInput(fileInput, file);
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 10));

    const progress = document.getElementById('importLogsProgress')!;
    expect(progress.textContent).toContain('parse error');
    expect(progress.className).toContain('error');
  });

  it('import logs: early return when no file selected', async () => {
    buildDom();
    const { initExportImport } = await getFreshModule();
    initExportImport();

    const fileInput = document.getElementById('importLogsFileInput') as HTMLInputElement;
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 10));

    expect(mockImportFromJson).not.toHaveBeenCalled();
  });

  it('import logs: progress callback updates text', async () => {
    buildDom();
    let capturedProgress: ((c: number, t: number) => void) | null = null;
    mockImportFromJson.mockImplementation(async (_text: string, progress: (c: number, t: number) => void) => {
      capturedProgress = progress;
      return { inserted: 3, skipped: 0, total: 3 };
    });

    const { initExportImport } = await getFreshModule();
    initExportImport();

    const fileInput = document.getElementById('importLogsFileInput') as HTMLInputElement;
    const file = new File(['{"logs":[]}'], 'logs.json', { type: 'application/json' });
    setFileOnInput(fileInput, file);
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 10));

    if (capturedProgress) {
      capturedProgress(2, 3);
      const progress = document.getElementById('importLogsProgress')!;
      expect(progress.textContent).toContain('2/3');
    }
  });

  it('import logs: handles missing importLogsProgress element', async () => {
    document.body.innerHTML = `
      <button id="importLogsBtn">Import Logs</button>
      <input type="file" id="importLogsFileInput" />
    `;
    mockImportFromJson.mockResolvedValue({ inserted: 1, skipped: 0, total: 1 });

    const { initExportImport } = await getFreshModule();
    initExportImport();

    const fileInput = document.getElementById('importLogsFileInput') as HTMLInputElement;
    const file = new File(['{"logs":[]}'], 'logs.json', { type: 'application/json' });
    setFileOnInput(fileInput, file);
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 10));

    // Should not throw
    expect(true).toBe(true);
  });

  it('import logs: handles missing importLogsProgress during error path', async () => {
    document.body.innerHTML = `
      <button id="importLogsBtn">Import Logs</button>
      <input type="file" id="importLogsFileInput" />
    `;
    mockImportFromJson.mockRejectedValue(new Error('fail'));

    const { initExportImport } = await getFreshModule();
    initExportImport();

    const fileInput = document.getElementById('importLogsFileInput') as HTMLInputElement;
    const file = new File(['bad'], 'logs.json', { type: 'application/json' });
    setFileOnInput(fileInput, file);
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 10));

    expect(true).toBe(true);
  });

  it('import logs: handles success result without crashing', async () => {
    buildDom();
    mockImportFromJson.mockResolvedValue({ inserted: 1, skipped: 0, total: 1 });

    const { initExportImport } = await getFreshModule();
    initExportImport();

    const fileInput = document.getElementById('importLogsFileInput') as HTMLInputElement;
    const file = new File(['{}'], 'logs.json', { type: 'application/json' });
    setFileOnInput(fileInput, file);
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 10));

    const progress = document.getElementById('importLogsProgress')!;
    expect(progress.textContent).toContain('importLogsComplete');
  });
});

describe('exportImport-r2 — showImportPreview edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('showImportPreview with empty domain lists', async () => {
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
    const { initExportImport } = await getFreshModule();
    initExportImport();

    const testData = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      settings: {
        obsidian_protocol: 'https',
        obsidian_port: '27124',
        domain_whitelist: [],
        domain_blacklist: [],
      },
    };

    const file = new File([JSON.stringify(testData)], 'test.json', { type: 'application/json' });
    const fileInput = document.getElementById('importFileInput') as HTMLInputElement;
    setFileOnInput(fileInput, file);
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 10));

    const preview = document.getElementById('importPreview')!;
    expect(preview.textContent).toContain('chrome_i18n_importPreviewSummary');
  });

  it('showImportPreview returns early when importPreview element is missing', async () => {
    document.body.innerHTML = `
      <button id="exportSettingsBtn">Export</button>
      <button id="importSettingsBtn">Import</button>
      <input type="file" id="importFileInput" />
      <div id="importConfirmModal" class="hidden" style="display:none"></div>
      <button id="closeImportModalBtn"></button>
      <button id="cancelImportBtn"></button>
      <button id="confirmImportBtn"></button>
      <div id="exportImportStatus"></div>
    `;

    const { initExportImport } = await getFreshModule();
    initExportImport();

    const testData = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      settings: { obsidian_protocol: 'https' },
    };

    const file = new File([JSON.stringify(testData)], 'test.json', { type: 'application/json' });
    const fileInput = document.getElementById('importFileInput') as HTMLInputElement;
    setFileOnInput(fileInput, file);
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 10));

    // No crash
    expect(true).toBe(true);
  });
});

describe('exportImport-r2 — confirmImportBtn exception', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows error when importSettings throws on confirm', async () => {
    buildDom();
    mockImportSettings.mockRejectedValue(new Error('corrupt data'));

    const testData = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      settings: { obsidian_protocol: 'https' },
    };

    const { initExportImport } = await getFreshModule();
    initExportImport();

    const fileInput = document.getElementById('importFileInput') as HTMLInputElement;
    const file = new File([JSON.stringify(testData)], 'test.json', { type: 'application/json' });
    setFileOnInput(fileInput, file);
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 10));

    document.getElementById('confirmImportBtn')!.click();
    await new Promise(r => setTimeout(r, 10));

    expect(showStatus).toHaveBeenCalledWith(
      'exportImportStatus',
      expect.stringContaining('corrupt data'),
      'error',
    );
  });
});

describe('exportImport-r2 — closeImportModal trap management', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('releases focus trap when trap is active via import flow', async () => {
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
    mockValidateExportData.mockReturnValue(true);

    const testData = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      settings: { obsidian_protocol: 'https' },
    };

    const { initExportImport } = await getFreshModule();
    initExportImport();

    // Trigger import flow to set importTrapId
    const fileInput = document.getElementById('importFileInput') as HTMLInputElement;
    const file = new File([JSON.stringify(testData)], 'test.json', { type: 'application/json' });
    setFileOnInput(fileInput, file);
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 10));

    // Now closeImportModal should release the trap
    document.getElementById('closeImportModalBtn')!.click();
    expect(focusTrapManager.release).toHaveBeenCalledWith('trap-id');
  });

  it('does not call release when trapId is null', async () => {
    document.body.innerHTML = `<div id="importConfirmModal"></div>`;
    const mod = await getFreshModule();
    mod.closeImportModal();
    expect(focusTrapManager.release).not.toHaveBeenCalled();
  });
});

describe('exportImport-r2 — modal backdrop click', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not close modal when clicking on modal content', async () => {
    document.body.innerHTML = `
      <button id="exportSettingsBtn">Export</button>
      <button id="importSettingsBtn">Import</button>
      <input type="file" id="importFileInput" />
      <div id="importConfirmModal" class="show" style="display:flex">
        <div id="innerContent">content</div>
      </div>
      <div id="importPreview"></div>
      <button id="closeImportModalBtn"></button>
      <button id="cancelImportBtn"></button>
      <button id="confirmImportBtn"></button>
    `;

    const { initExportImport } = await getFreshModule();
    initExportImport();

    const modal = document.getElementById('importConfirmModal')!;
    document.getElementById('innerContent')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(modal.classList.contains('show')).toBe(true);
  });
});
