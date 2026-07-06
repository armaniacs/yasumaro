/**
 * gistSettings.ts
 * GitHub Gist sync settings UI logic.
 */

import { getSettings, saveSettings, StorageKeys } from '../utils/storage.js';
import { GistSyncTarget } from '../background/syncTargets/gistSyncTarget.js';
import { SqliteClient } from '../background/sqliteClient.js';
import { errorMessage } from '../utils/errorUtils.js';

function setStatus(message: string, isError: boolean): void {
  const el = document.getElementById('gistStatus');
  if (!el) return;
  el.textContent = message;
  el.className = isError ? 'status-message error' : 'status-message success';
}

export async function initGistSettings(): Promise<void> {
  const gistEnabled = document.getElementById('gistEnabled') as HTMLInputElement | null;
  const githubPat = document.getElementById('githubPat') as HTMLInputElement | null;
  const saveBtn = document.getElementById('saveGistSettingsBtn');
  const testBtn = document.getElementById('testGistConnectionBtn');

  // Load current settings
  const settings = await getSettings();
  if (gistEnabled) {
    gistEnabled.checked = Boolean(settings[StorageKeys.GIST_ENABLED]);
  }
  if (githubPat) {
    githubPat.value = (settings[StorageKeys.GITHUB_PAT] as string) || '';
  }

  // Save handler
  saveBtn?.addEventListener('click', async () => {
    try {
      await saveSettings({
        [StorageKeys.GIST_ENABLED]: gistEnabled?.checked ?? false,
        [StorageKeys.GITHUB_PAT]: githubPat?.value ?? '',
      } as any);
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
