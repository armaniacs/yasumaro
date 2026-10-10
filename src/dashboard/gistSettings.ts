/**
 * gistSettings.ts
 * GitHub Gist sync settings UI logic.
 *
 * Three responsibilities, kept apart by the seams below:
 * - DOM binding stays in this module.
 * - Settings persistence stays behind SettingsRepository: reads go through the
 *   injected `SettingsReader`, writes through the repository singleton because
 *   `SettingsReader` is read-only by design.
 * - The connection test runs through the injected `GistConnectionTester` port.
 *   The dashboard may not construct background runtime classes (dev-docs/LAYERS.md
 *   limits dashboard → background to constants, types and catalog tables), so the
 *   tester is produced by a factory seam and the default resolves the sync target
 *   lazily.
 */

import { StorageKeys, Settings } from '../utils/storage/types.js';
import { settingsRepository, type SettingsReader } from '../utils/storage/SettingsRepository.js';
import type { EncryptedData } from '../utils/crypto/types.js';
import { errorMessage } from '../utils/errorUtils.js';
import { showStatus } from '../utils/ui/settingsUiHelper.js';
import { getMessageOr, getMessageWithSubstitutions } from '../utils/i18n.js';

export interface GistConnectionTestResult {
  success: boolean;
  message: string;
}

export interface GistConnectionTester {
  testConnection(): Promise<GistConnectionTestResult>;
}

/** Produces the connection tester; may resolve it lazily. */
export type GistConnectionTesterFactory = () => GistConnectionTester | Promise<GistConnectionTester>;

/**
 * Production default: hand the sync target the canonical shared SqliteClient
 * instead of building a second one. The manifest's `sqliteClient` entry and this
 * path then observe the same gateway, which is the both-paths-one-instance
 * contract documented on getSharedSqliteClient
 * (src/background/sqlite/offscreenGateway.ts).
 */
async function createSharedGistConnectionTester(): Promise<GistConnectionTester> {
  const [{ GistSyncTarget }, { getSharedSqliteClient }] = await Promise.all([
    import('../background/syncTargets/gistSyncTarget.js'),
    import('../background/sqlite/offscreenGateway.js'),
  ]);
  return new GistSyncTarget(getSharedSqliteClient());
}

function stringOrEmpty(value: string | EncryptedData | undefined): string {
  return typeof value === 'string' ? value : '';
}

function setStatus(message: string, isError: boolean): void {
  showStatus('gistStatus', message, isError ? 'error' : 'success', { autoClear: false });
}

export async function initGistSettings(
  repo: SettingsReader = settingsRepository,
  createConnectionTester: GistConnectionTesterFactory = createSharedGistConnectionTester,
): Promise<void> {
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
      setStatus(getMessageOr('gistSettingsSaved', 'Gist settings saved'), false);
    } catch (error) {
      setStatus(getMessageWithSubstitutions('gistSaveFailed', { error: errorMessage(error) }, 'Save failed: {error}'), true);
    }
  });

  // Test connection handler — resolving the tester is part of the try scope, so
  // a failure to reach the shared gateway reports like any other test failure.
  testBtn?.addEventListener('click', async () => {
    try {
      const tester = await createConnectionTester();
      const result = await tester.testConnection();
      setStatus(result.message, !result.success);
    } catch (error) {
      setStatus(getMessageWithSubstitutions('gistTestFailed', { error: errorMessage(error) }, 'Test failed: {error}'), true);
    }
  });
}
