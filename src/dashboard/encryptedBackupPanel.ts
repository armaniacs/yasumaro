/**
 * encryptedBackupPanel.ts
 * ダッシュボードの「暗号化バックアップ」ボタン・モーダルの結線
 */

import { MAX_ENVELOPE_CIPHERTEXT_LENGTH as ENVELOPE_CIPHERTEXT_LIMIT } from '../utils/limits.js';
import { showPasswordAuthModal } from './masterPassword.js';
import { setPasswordAuthProgress } from './masterPassword.js';
import { logDebug } from '../utils/logger/api.js';
import {
  exportEncryptedBackup,
  importEncryptedBackup,
  isEncryptedBackupFile,
} from './encryptedBackupService.js';
import { downloadBlob } from './exportLogsService.js';
import { errorMessage } from '../utils/errorUtils.js';
import { showStatus, type StatusType } from '../utils/ui/settingsUiHelper.js';
import { getMessageOr, getMessageWithSubstitutions } from '../utils/i18n.js';
import { withBusyButton } from './panels/asyncData/busyButton.js';

/** Backup files legitimately hold a base64 SQLite DB; allow more headroom. */
const MAX_BACKUP_FILE_BYTES = 50 * 1024 * 1024;
/** Upper bound on the base64 ciphertext field of an envelope. */
const MAX_ENVELOPE_CIPHERTEXT_LENGTH = ENVELOPE_CIPHERTEXT_LIMIT;

function getExportFilename(): string {
  const date = new Date();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `yasumaro-backup-${y}${m}${d}-${hh}${mm}${ss}.encrypted.json`;
}

function setStatus(message: string, isError: boolean, kind?: StatusType): void {
  showStatus('encryptedBackupStatus', message, kind ?? (isError ? 'error' : 'success'), { autoClear: false });
}

function downloadJson(data: unknown, filename: string): void {
  const json = JSON.stringify(data, null, 2);
  // SSOT: exportLogsService.downloadBlob owns the anchor-click revoke policy
  // (60s bounded delay) — a synchronous revoke here killed large backups
  // before Chromium finished persisting them.
  downloadBlob(new Blob([json], { type: 'application/json' }), filename);
}

export function initEncryptedBackupPanel(): void {
  const exportBtn = document.getElementById('exportEncryptedBackupBtn');
  const importBtn = document.getElementById('importEncryptedBackupBtn');
  const importFileInput = document.getElementById('importEncryptedBackupFileInput') as HTMLInputElement | null;
  let exportInFlight = false;
  let importInFlight = false;

  exportBtn?.addEventListener('click', () => {
    if (exportInFlight) return;
    showPasswordAuthModal('export', async (password: string) => {
      if (exportInFlight) return;
      exportInFlight = true;
      try {
        await withBusyButton(exportBtn as HTMLButtonElement, async () => {
          const filename = getExportFilename();
          setStatus(
            getMessageWithSubstitutions('encryptedBackupCreating', { filename }, '{filename} を作成しています...'),
            false,
            'updating',
          );
          const startedAt = Date.now();
          const envelope = await exportEncryptedBackup(password, (stage) => {
            const text =
              stage === 'readingDb'
                ? getMessageOr('backupStageReadingDb', 'Reading history database...')
                : getMessageOr('backupStageEncrypting', 'Encrypting...');
            setStatus(text, false, 'updating');
            setPasswordAuthProgress(text);
            void logDebug('encrypted-backup stage', { flow: 'export', stage, elapsedMs: Date.now() - startedAt }, 'encryptedBackupPanel');
          });
          setPasswordAuthProgress(null);
          void logDebug(
            'encrypted-backup done',
            { flow: 'export', elapsedMs: Date.now() - startedAt, envelopeChars: JSON.stringify(envelope).length },
            'encryptedBackupPanel',
          );
          downloadJson(envelope, filename);
          setStatus(getMessageWithSubstitutions('encryptedBackupCreated', { filename }, '暗号化バックアップを作成しました: {filename}'), false);
        });
      } catch (error) {
        setStatus(getMessageWithSubstitutions('encryptedBackupCreateFailed', { error: errorMessage(error) }, 'バックアップ作成に失敗しました: {error}'), true);
      } finally {
        exportInFlight = false;
      }
    });
  });

  importBtn?.addEventListener('click', () => {
    importFileInput?.click();
  });

  importFileInput?.addEventListener('change', async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    // Size cap BEFORE reading/parsing: a forged multi-hundred-MB file must not
    // be pulled into memory or handed to JSON.parse (VULN-036).
    if (file.size > MAX_BACKUP_FILE_BYTES) {
      setStatus(getMessageOr('encryptedBackupFileTooLarge', 'バックアップファイルが大きすぎます'), true);
      if (importFileInput) importFileInput.value = '';
      return;
    }

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);

      if (!isEncryptedBackupFile(parsed)) {
        setStatus(getMessageOr('encryptedBackupInvalidFile', '不正なバックアップファイルです'), true);
        if (importFileInput) importFileInput.value = '';
        return;
      }

      // Envelope-length validation at the boundary: reject an envelope whose
      // ciphertext field alone would amplify into an oversized allocation.
      if (
        typeof parsed.data === 'string' &&
        parsed.data.length > MAX_ENVELOPE_CIPHERTEXT_LENGTH
      ) {
        setStatus(getMessageOr('encryptedBackupInvalidFile', '不正なバックアップファイルです'), true);
        if (importFileInput) importFileInput.value = '';
        return;
      }

      showPasswordAuthModal('import', async (password: string) => {
        if (importInFlight) return;
        importInFlight = true;
        try {
          await withBusyButton(importBtn as HTMLButtonElement, async () => {
            const startedAt = Date.now();
            const result = await importEncryptedBackup(parsed, password, (stage) => {
              const text =
                stage === 'decrypting'
                  ? getMessageOr('backupStageDecrypting', 'Decrypting...')
                  : stage === 'restoringDb'
                    ? getMessageOr('backupStageRestoringDb', 'Restoring history database...')
                    : getMessageOr('backupStageRestoringSettings', 'Restoring settings...');
              setStatus(text, false, 'updating');
              setPasswordAuthProgress(text);
              void logDebug('encrypted-backup stage', { flow: 'import', stage, elapsedMs: Date.now() - startedAt }, 'encryptedBackupPanel');
            });
            if (result.success) {
              setPasswordAuthProgress(null);
              const skippedCount = result.skippedKeys?.length ?? 0;
              setStatus(
                skippedCount > 0
                  ? getMessageWithSubstitutions('encryptedBackupRestoredSkipped', { skipped: skippedCount }, 'バックアップから復元しました（{skipped}件の設定項目は無効なためスキップされました）')
                  : getMessageOr('encryptedBackupRestored', 'バックアップから復元しました'),
                false
              );
              document.dispatchEvent(new CustomEvent('reload-general-settings'));
            } else {
              setStatus(getMessageWithSubstitutions('encryptedBackupRestoreFailed', { error: String(result.error) }, '復元に失敗しました: {error}'), true);
            }
          });
        } finally {
          importInFlight = false;
        }
      });
    } catch (error) {
      setStatus(getMessageWithSubstitutions('encryptedBackupFileReadFailed', { error: errorMessage(error) }, 'ファイルの読み込みに失敗しました: {error}'), true);
    }

    if (importFileInput) importFileInput.value = '';
  });
}
