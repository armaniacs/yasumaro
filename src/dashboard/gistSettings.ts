/**
 * gistSettings.ts
 * GitHub Gist sync settings UI logic.
 */

import { StorageKeys, Settings } from '../utils/storage/types.js';
import { settingsRepository, type SettingsReader } from '../utils/storage/SettingsRepository.js';
import type { EncryptedData } from '../utils/crypto/types.js';
import { GistSyncTarget } from '../background/syncTargets/gistSyncTarget.js';
import { SqliteClient } from '../background/sqlite/offscreenGateway.js';
import { errorMessage } from '../utils/errorUtils.js';

function stringOrEmpty(value: string | EncryptedData | undefined): string {
  return typeof value === 'string' ? value : '';
}

function setStatus(message: string, isError: boolean): void {
  const el = document.getElementById('gistStatus');
  if (!el) return;
  el.textContent = message;
  el.className = isError ? 'status-message error' : 'status-message success';
}

export async function initGistSettings(repo: SettingsReader = settingsRepository): Promise<void> {
  const gistEnabled = document.getElementById('gistEnabled') as HTMLInputElement | null;
  const githubPat = document.getElementById('githubPat') as HTMLInputElement | null;
  const saveBtn = document.getElementById('saveGistSettingsBtn');
  const testBtn = document.getElementById('testGistConnectionBtn');

  // Load current settings
  const settings = await repo.getAll();
  if (gistEnabled) {
    gistEnabled.checked = Boolean(settings[StorageKeys.GIST_ENABLED]);
  }
  if (githubPat) {
    githubPat.value = stringOrEmpty(settings[StorageKeys.GITHUB_PAT]);
  }

  // Save handler
  saveBtn?.addEventListener('click', async () => {
    try {
      await settingsRepository.setAll({
        [StorageKeys.GIST_ENABLED]: gistEnabled?.checked ?? false,
        [StorageKeys.GITHUB_PAT]: githubPat?.value ?? '',
      } as Settings);
      setStatus('Gist settings saved', false);
    } catch (error) {
      setStatus(`Save failed: ${errorMessage(error)}`, true);
    }
  });

  // Test connection handler
  testBtn?.addEventListener('click', async () => {
    try {
      const sqliteClient = new SqliteClient();
      const target = new GistSyncTarget(sqliteClient);
      const result = await target.testConnection();
      setStatus(result.message, !result.success);
    } catch (error) {
      setStatus(`Test failed: ${errorMessage(error)}`, true);
    }
  });
}
