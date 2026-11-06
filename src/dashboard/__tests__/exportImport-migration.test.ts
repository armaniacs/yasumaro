// @vitest-environment jsdom
/**
 * exportImport-migration.test.ts
 * PBI 2026-11-06-03: dashboard 配線。移行ボタンがファイル選択を開き、
 * 明示確認を経て移行経路を呼び出すこと。通常インポート配線は不変。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { waitForMock } from '../../../testDir/waitPolicy.js';

const { mockShowConfirmDialog } = vi.hoisted(() => ({
  mockShowConfirmDialog: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../utils/ui/confirmDialog.js', () => ({
  showConfirmDialog: mockShowConfirmDialog,
  showAlertDialog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../utils/i18n.js', () => ({
  getMessage: vi.fn((key: string) => `i18n_${key}`),
  getMessageOr: vi.fn((key: string, fallback: string) => fallback),
}));

vi.mock('../../utils/ui/settingsUiHelper.js', () => ({
  showStatus: vi.fn(),
}));

vi.mock('../../utils/ui/focusTrap.js', () => ({
  focusTrapManager: {
    trap: vi.fn().mockReturnValue('trap-id'),
    release: vi.fn(),
  },
}));

vi.mock('../settings/domainFilter.js', () => ({
  loadDomainSettings: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../settings/privacySettings.js', () => ({
  loadPrivacySettings: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../settings/contentSettings.js', () => ({
  loadContentSettings: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../settings/trustSettings.js', () => ({
  loadTrustSettings: vi.fn().mockResolvedValue(undefined),
}));

const { mockImportSettingsForMigration } = vi.hoisted(() => ({
  mockImportSettingsForMigration: vi.fn().mockResolvedValue({ theme: 'migrated' }),
}));

vi.mock('../../utils/settingsExportImport.js', () => ({
  exportSettings: vi.fn().mockResolvedValue(undefined),
  importSettings: vi.fn().mockResolvedValue(null),
  importSettingsForMigration: mockImportSettingsForMigration,
  validateExportData: vi.fn().mockReturnValue(true),
  exportEncryptedSettings: vi.fn(),
  importEncryptedSettings: vi.fn(),
  saveEncryptedExportToFile: vi.fn(),
  isEncryptedExport: vi.fn().mockReturnValue(false),
}));

const { mockImportLogsForMigration } = vi.hoisted(() => ({
  mockImportLogsForMigration: vi.fn().mockResolvedValue({ inserted: 1, skipped: 0, total: 1 }),
}));

vi.mock('../importLogsService.js', () => ({
  importFromJson: vi.fn(),
  importFromJsonForMigration: mockImportLogsForMigration,
  isImportError: (result: unknown): boolean =>
    typeof result === 'object' && result !== null && 'error' in result,
}));

vi.mock('../masterPassword.js', () => ({
  showPasswordAuthModal: vi.fn(),
}));

async function getFreshModule(): Promise<typeof import('../exportImport.js')> {
  vi.resetModules();
  return import('../exportImport.js');
}

function buildMigrationDom(): void {
  document.body.innerHTML = `
    <button id="exportSettingsBtn">Export</button>
    <button id="importSettingsBtn">Import</button>
    <input type="file" id="importFileInput" />
    <div id="importConfirmModal" class="hidden" style="display:none"></div>
    <div id="importPreview"></div>
    <button id="closeImportModalBtn"></button>
    <button id="cancelImportBtn"></button>
    <button id="confirmImportBtn"></button>
    <button id="importLogsBtn">Import logs</button>
    <input type="file" id="importLogsFileInput" />
    <div id="importLogsProgress" class="hidden"></div>
    <button id="migrateSettingsBtn">Migrate settings</button>
    <input type="file" id="migrateSettingsFileInput" />
    <button id="migrateLogsBtn">Migrate logs</button>
    <input type="file" id="migrateLogsFileInput" />
    <div id="exportImportStatus"></div>
  `;
}

function setFileOnInput(input: HTMLInputElement, file: File): void {
  Object.defineProperty(input, 'files', {
    value: [file],
    writable: false,
    configurable: true,
  });
}

describe('exportImport migration wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockShowConfirmDialog.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('settings migration entry', () => {
    it('opens the file picker when the migrate-settings button is clicked', async () => {
      buildMigrationDom();
      const { initExportImport } = await getFreshModule();
      initExportImport();

      const fileInput = document.getElementById('migrateSettingsFileInput') as HTMLInputElement;
      const clickSpy = vi.spyOn(fileInput, 'click');

      document.getElementById('migrateSettingsBtn')!.click();
      expect(clickSpy).toHaveBeenCalled();
    });

    it('runs the migration import after confirmation and clears the input', async () => {
      buildMigrationDom();
      const { initExportImport, destroyExportImport } = await getFreshModule();
      initExportImport();

      const fileInput = document.getElementById('migrateSettingsFileInput') as HTMLInputElement;
      setFileOnInput(
        fileInput,
        new File(['{"version":"1.1.0"}'], 'foreign-settings.json', { type: 'application/json' })
      );
      fileInput.dispatchEvent(new Event('change'));

      await waitForMock(() => expect(mockImportSettingsForMigration).toHaveBeenCalledTimes(1));
      expect(mockShowConfirmDialog).toHaveBeenCalledTimes(1);
      expect(fileInput.value).toBe('');
      destroyExportImport();
    });

    it('does not import when the migration confirmation is cancelled', async () => {
      mockShowConfirmDialog.mockResolvedValue(false);
      buildMigrationDom();
      const { initExportImport, destroyExportImport } = await getFreshModule();
      initExportImport();

      const fileInput = document.getElementById('migrateSettingsFileInput') as HTMLInputElement;
      setFileOnInput(
        fileInput,
        new File(['{"version":"1.1.0"}'], 'foreign-settings.json', { type: 'application/json' })
      );
      fileInput.dispatchEvent(new Event('change'));

      await waitForMock(() => expect(mockShowConfirmDialog).toHaveBeenCalledTimes(1));
      expect(mockImportSettingsForMigration).not.toHaveBeenCalled();
      expect(fileInput.value).toBe('');
      destroyExportImport();
    });
  });

  describe('logs migration entry', () => {
    it('opens the file picker when the migrate-logs button is clicked', async () => {
      buildMigrationDom();
      const { initExportImport } = await getFreshModule();
      initExportImport();

      const fileInput = document.getElementById('migrateLogsFileInput') as HTMLInputElement;
      const clickSpy = vi.spyOn(fileInput, 'click');

      document.getElementById('migrateLogsBtn')!.click();
      expect(clickSpy).toHaveBeenCalled();
    });

    it('runs the logs migration after confirmation and reports success', async () => {
      buildMigrationDom();
      const { initExportImport, destroyExportImport } = await getFreshModule();
      initExportImport();

      const fileInput = document.getElementById('migrateLogsFileInput') as HTMLInputElement;
      setFileOnInput(
        fileInput,
        new File(['{"version":2}'], 'foreign-logs.json', { type: 'application/json' })
      );
      fileInput.dispatchEvent(new Event('change'));

      await waitForMock(() => expect(mockImportLogsForMigration).toHaveBeenCalledTimes(1));
      expect(mockShowConfirmDialog).toHaveBeenCalledTimes(1);
      const progress = document.getElementById('importLogsProgress')!;
      expect(progress.textContent).toContain('✓');
      expect(fileInput.value).toBe('');
      destroyExportImport();
    });

    it('does not import logs when the migration confirmation is cancelled', async () => {
      mockShowConfirmDialog.mockResolvedValue(false);
      buildMigrationDom();
      const { initExportImport, destroyExportImport } = await getFreshModule();
      initExportImport();

      const fileInput = document.getElementById('migrateLogsFileInput') as HTMLInputElement;
      setFileOnInput(
        fileInput,
        new File(['{"version":2}'], 'foreign-logs.json', { type: 'application/json' })
      );
      fileInput.dispatchEvent(new Event('change'));

      await waitForMock(() => expect(mockShowConfirmDialog).toHaveBeenCalledTimes(1));
      expect(mockImportLogsForMigration).not.toHaveBeenCalled();
      expect(fileInput.value).toBe('');
      destroyExportImport();
    });
  });
});
