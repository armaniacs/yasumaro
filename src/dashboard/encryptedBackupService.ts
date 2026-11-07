/**
 * encryptedBackupService.ts
 * 履歴(SQLite DB全体)と設定を1つの暗号化ファイルにまとめてエクスポート/インポートする。
 */

import { settingsRepository } from '../utils/storage/SettingsRepository.js';
import { exportDb } from './exportLogsService.js';
import { restoreDb, isServiceError } from './dashboardSqliteService.js';
import { encryptEnvelope, decryptBackupEnvelope, isEncryptionEnvelope } from '../utils/crypto/index.js';
import type { EncryptionEnvelope } from '../utils/crypto/index.js';
import type { Settings } from '../utils/storage/types.js';
import { errorMessage } from '../utils/errorUtils.js';
import { validateRestorableSettings } from '../utils/storage/restorableSettings.js';
import { bytesToBase64, base64ToBytes } from '../utils/crypto/index.js';
import { isMasterPasswordEnabled, unlockWithPassword } from '../utils/storage/encryptionSession.js';
import { isLocked } from '../utils/storage/authGuard.js';

export const BACKUP_PAYLOAD_VERSION = 1;

interface BackupPayload {
  version: number;
  exportedAt: string;
  settings: Settings;
  historyDbBase64: string;
}

async function buildBackupPayload(): Promise<BackupPayload> {
  const settings = await settingsRepository.getAll();
  const dbBlob = await exportDb();
  const dbBuffer = await dbBlob.arrayBuffer();
  const historyDbBase64 = bytesToBase64(new Uint8Array(dbBuffer));

  return {
    version: BACKUP_PAYLOAD_VERSION,
    exportedAt: new Date().toISOString(),
    settings,
    historyDbBase64,
  };
}

function isBackupPayload(data: unknown): data is BackupPayload {
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  return (
    typeof d.version === 'number' &&
    typeof d.exportedAt === 'string' &&
    typeof d.settings === 'object' && d.settings !== null &&
    typeof d.historyDbBase64 === 'string'
  );
}

/**
 * 履歴+設定を暗号化バックアップとしてエクスポートする。
 * @throws exportDb() が失敗した場合（履歴DBが読めない場合）
 */
export async function exportEncryptedBackup(
  password: string,
  onStage?: (s: 'readingDb' | 'encrypting') => void,
): Promise<EncryptionEnvelope> {
  onStage?.('readingDb');
  const payload = await buildBackupPayload();
  const json = JSON.stringify(payload);
  onStage?.('encrypting');
  return encryptEnvelope(json, password);
}

/**
 * 暗号化バックアップをインポートし、設定とDBを復元する。
 * パスフレーズ誤り・データ破損・バージョン不一致の場合は既存データを一切変更せず失敗を返す。
 */
export async function importEncryptedBackup(
  envelope: EncryptionEnvelope,
  password: string,
  onStage?: (s: 'decrypting' | 'restoringDb' | 'restoringSettings') => void,
): Promise<{ success: boolean; error?: string; skippedKeys?: string[] }> {
  let json: string;
  try {
    onStage?.('decrypting');
    // WHY backup context, not the generic decryptEnvelope: a legitimate
    // backup embeds a base64 SQLite DB and may exceed the generic 10 MiB
    // pre-decode cap. The backup cap (limits.ts) is still a pre-auth length
    // gate — cheap-auth-first order is unchanged — it only budgets for the
    // file size the panel already enforces at pick time.
    json = await decryptBackupEnvelope(envelope, password);
  } catch (error) {
    return { success: false, error: `Decryption failed: ${errorMessage(error)}` };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(json);
  } catch (error) {
    return { success: false, error: `Invalid backup content: ${errorMessage(error)}` };
  }

  if (!isBackupPayload(payload)) {
    return { success: false, error: 'Invalid backup payload structure' };
  }

  if (payload.version !== BACKUP_PAYLOAD_VERSION) {
    return { success: false, error: `Unsupported backup version: ${payload.version}` };
  }

  // WHY: the dashboard auth modal verifies the password but deliberately
  // does not unlock the session, and a fresh set starts locked — so a
  // correct password alone would still fail below at setAll with
  // ENCRYPTION_LOCKED. Three cases after decryption proved the backup
  // password: (1) no master password is set — the anonymous-key path
  // applies untouched, nothing to unlock; (2) a master password is set and
  // the session is already unlocked — skip the unlock attempt entirely,
  // because the backup password is not necessarily the master password and
  // trying it would fail (or disturb) a ready session; (3) a master
  // password is set and the session is locked — establish the session from
  // the verified password (the same takeover changeMasterPassword performs)
  // before touching settings. A mismatch in case (3) means the backup
  // password is not the master password, so the error tells the user to
  // unlock with the master password first instead of failing at setAll.
  if (await isMasterPasswordEnabled()) {
    if (await isLocked()) {
      const unlocked = await unlockWithPassword(password);
      if (!unlocked) {
        return { success: false, error: 'Could not unlock the encryption session with the provided password. Unlock with the master password first, then retry the import.' };
      }
    }
  }

  const dbBytes = base64ToBytes(payload.historyDbBase64);
  onStage?.('restoringDb');
  const restored = await restoreDb(dbBytes);
  if (isServiceError(restored)) {
    return { success: false, error: `Failed to restore history database: ${restored.error}` };
  }

  // WHY: the runtime value is untrusted parsed JSON; the declared Settings
  // type is not verified, so the validator re-checks every key before restore.
  const { sanitized, skippedKeys } = validateRestorableSettings(payload.settings);
  onStage?.('restoringSettings');
  await settingsRepository.setAll(sanitized);

  return { success: true, skippedKeys };
}

export function isEncryptedBackupFile(data: unknown): data is EncryptionEnvelope {
  return isEncryptionEnvelope(data);
}
