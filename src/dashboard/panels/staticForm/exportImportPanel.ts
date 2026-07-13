import { type StaticFormPanel } from '../types.js';
import { initExportImport } from '../../exportImport.js';
import { initEncryptedBackupPanel } from '../../encryptedBackupPanel.js';
import { initGistSettings } from '../../gistSettings.js';

export function createExportImportPanel(): StaticFormPanel {
  return {
    id: 'panel-export-import',
    category: 'static-form',
    async mount(_container) {
      initExportImport();
      initEncryptedBackupPanel();
      await initGistSettings();
    },
    async refresh() {},
  };
}
