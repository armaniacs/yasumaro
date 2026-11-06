// @vitest-environment jsdom
/**
 * settingsExportImportUiCore-migration.test.ts
 * PBI 2026-11-06-03: 移行確認ゲート。確認なしでは何も適用されないこと。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockShowConfirmDialog } = vi.hoisted(() => ({
  mockShowConfirmDialog: vi.fn().mockResolvedValue(true),
}));

vi.mock('../ui/confirmDialog.js', () => ({
  showConfirmDialog: mockShowConfirmDialog,
  showAlertDialog: vi.fn().mockResolvedValue(undefined),
}));

const { mockValidateExportData, mockIsEncryptedExport, mockImportForMigration } = vi.hoisted(
  () => ({
    mockValidateExportData: vi.fn().mockReturnValue(true),
    mockIsEncryptedExport: vi.fn().mockReturnValue(false),
    mockImportForMigration: vi.fn().mockResolvedValue({ theme: 'migrated' }),
  })
);

vi.mock('../settingsExportImport.js', () => ({
  exportSettings: vi.fn().mockResolvedValue(undefined),
  validateExportData: mockValidateExportData,
  exportEncryptedSettings: vi.fn(),
  importEncryptedSettings: vi.fn(),
  importSettingsForMigration: mockImportForMigration,
  saveEncryptedExportToFile: vi.fn(),
  isEncryptedExport: mockIsEncryptedExport,
}));

vi.mock('../storage/SettingsRepository.js', () => ({
  settingsRepository: {
    getAll: vi.fn().mockResolvedValue({}),
    setAll: vi.fn().mockResolvedValue(undefined),
    getMany: vi.fn(),
  },
}));

import { handleMigrationSettingsImport } from '../settingsExportImportUiCore.js';
import type { ImportContext } from '../settingsExportImportUiCore.js';

function makeContext(): ImportContext {
  return {
    reloadFn: vi.fn().mockResolvedValue(undefined),
    showStatus: vi.fn(),
  };
}

describe('handleMigrationSettingsImport', () => {
  describe('migration confirmation gate', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      mockValidateExportData.mockReturnValue(true);
      mockIsEncryptedExport.mockReturnValue(false);
      mockShowConfirmDialog.mockResolvedValue(true);
      mockImportForMigration.mockResolvedValue({ theme: 'migrated' });
    });

    it('asks for explicit confirmation before applying anything', async () => {
      const file = new File(['{}'], 'foreign-profile-settings.json', {
        type: 'application/json',
      });

      await handleMigrationSettingsImport(file, makeContext());

      expect(mockShowConfirmDialog).toHaveBeenCalledTimes(1);
      const options = mockShowConfirmDialog.mock.calls[0]![0];
      expect(options.dangerous).toBe(true);
      expect(options.confirmLabel).toBeTruthy();
    });

    it('applies nothing when the confirmation is cancelled', async () => {
      mockShowConfirmDialog.mockResolvedValue(false);
      const ctx = makeContext();
      const file = new File(['{}'], 'foreign-profile-settings.json', {
        type: 'application/json',
      });

      const applied = await handleMigrationSettingsImport(file, ctx);

      expect(applied).toBe(false);
      expect(mockImportForMigration).not.toHaveBeenCalled();
      expect(ctx.reloadFn).not.toHaveBeenCalled();
      expect(ctx.showStatus).not.toHaveBeenCalled();
    });

    it('imports and reloads when the confirmation is accepted', async () => {
      const ctx = makeContext();
      const file = new File(['{}'], 'foreign-profile-settings.json', {
        type: 'application/json',
      });

      const applied = await handleMigrationSettingsImport(file, ctx);

      expect(applied).toBe(true);
      expect(mockImportForMigration).toHaveBeenCalledTimes(1);
      expect(ctx.reloadFn).toHaveBeenCalledTimes(1);
      expect(ctx.showStatus).toHaveBeenCalled();
    });

    it('applies nothing when the file is not valid JSON', async () => {
      const ctx = makeContext();
      const file = new File(['not json{{{'], 'broken.json', { type: 'application/json' });

      const applied = await handleMigrationSettingsImport(file, ctx);

      expect(applied).toBe(false);
      expect(mockShowConfirmDialog).not.toHaveBeenCalled();
      expect(mockImportForMigration).not.toHaveBeenCalled();
    });

    it('refuses encrypted exports on the plaintext migration path', async () => {
      mockIsEncryptedExport.mockReturnValue(true);
      const ctx = makeContext();
      const file = new File(['{}'], 'encrypted.json', { type: 'application/json' });

      const applied = await handleMigrationSettingsImport(file, ctx);

      expect(applied).toBe(false);
      expect(mockShowConfirmDialog).not.toHaveBeenCalled();
      expect(mockImportForMigration).not.toHaveBeenCalled();
      expect(ctx.showStatus).toHaveBeenCalled();
    });
  });
});
