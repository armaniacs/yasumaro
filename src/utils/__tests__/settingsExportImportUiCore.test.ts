// @vitest-environment jsdom
/**
 * settingsExportImportUiCore.test.ts
 * PBI 2026-10-21-04: the import-permission confirmation must carry an
 * explicit import label. showConfirmDialog's default label is the destructive
 * 'Delete', which mislabels a non-delete confirmation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockShowConfirmDialog } = vi.hoisted(() => ({
  mockShowConfirmDialog: vi.fn().mockResolvedValue(true),
}));

vi.mock('../ui/confirmDialog.js', () => ({
  showConfirmDialog: mockShowConfirmDialog,
  showAlertDialog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../settingsExportImport.js', () => ({
  exportSettings: vi.fn().mockResolvedValue(undefined),
  validateExportData: vi.fn().mockReturnValue(true),
  exportEncryptedSettings: vi.fn(),
  importEncryptedSettings: vi.fn(),
  saveEncryptedExportToFile: vi.fn(),
  isEncryptedExport: vi.fn().mockReturnValue(true),
}));

vi.mock('../storage/SettingsRepository.js', () => ({
  settingsRepository: {
    getAll: vi.fn().mockResolvedValue({ mp_require_on_import: false }),
    setAll: vi.fn().mockResolvedValue(undefined),
    getMany: vi.fn(),
  },
}));

import { handleFileImport } from '../settingsExportImportUiCore.js';
import type { ImportContext } from '../settingsExportImportUiCore.js';

function makeContext(): ImportContext {
  return {
    reloadFn: vi.fn().mockResolvedValue(undefined),
    showStatus: vi.fn(),
  };
}

describe('handleFileImport import-permission dialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes the confirmImport label to the dialog instead of the Delete default', async () => {
    const file = new File(['{}'], 'settings.json', { type: 'application/json' });
    await handleFileImport(file, makeContext(), vi.fn(), vi.fn());

    expect(mockShowConfirmDialog).toHaveBeenCalledTimes(1);
    // The label resolves through chrome.i18n (en bundle: "Import"), not the
    // destructive 'Delete' default.
    expect(chrome.i18n.getMessage).toHaveBeenCalledWith('confirmImport');
    const options = mockShowConfirmDialog.mock.calls[0][0];
    expect(options.message).toBeTruthy();
    expect(options.confirmLabel).toBe('Import');
  });
});
