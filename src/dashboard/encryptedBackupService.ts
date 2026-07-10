/**
 * encryptedBackupService.ts
 * 履歴(SQLite DB全体)と設定を1つの暗号化ファイルにまとめてエクスポート/インポートする。
 */

import { getSettings, saveSettings } from '../utils/storage.js';
import { exportDb } from './exportLogsService.js';
import { restoreDb } from './dashboardSqliteService.js';
import { encryptEnvelope, decryptEnvelope, isEncryptionEnvelope } from '../utils/crypto.js';
import type { EncryptionEnvelope } from '../utils/crypto.js';
import type { Settings } from '../utils/storage/types.js';
import { errorMessage } from '../utils/errorUtils.js';
import { validateRestorableSettings } from '../utils/storage/restorableSettings.js';

export const BACKUP_PAYLOAD_VERSION = 1;

interface BackupPayload {
  version: number;
  exportedAt: string;
  settings: Settings;
  historyDbBase64: string;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function buildBackupPayload(): Promise<BackupPayload> {
  const settings = await getSettings();
  const dbBlob = await exportDb();
  if (!dbBlob) {
    throw new Error('Failed to read history database for backup');
  }
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
export async function exportEncryptedBackup(password: string): Promise<EncryptionEnvelope> {
  const payload = await buildBackupPayload();
  const json = JSON.stringify(payload);
  return encryptEnvelope(json, password);
}

/**
 * 暗号化バックアップをインポートし、設定とDBを復元する。
 * パスフレーズ誤り・データ破損・バージョン不一致の場合は既存データを一切変更せず失敗を返す。
 */
export async function importEncryptedBackup(
  envelope: EncryptionEnvelope,
  password: string
): Promise<{ success: boolean; error?: string }> {
  let json: string;
  try {
    json = await decryptEnvelope(envelope, password);
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

  const dbBytes = base64ToBytes(payload.historyDbBase64);
  const restored = await restoreDb(dbBytes);
  if (!restored) {
    return { success: false, error: 'Failed to restore history database' };
  }

  const sanitized = validateRestorableSettings(payload.settings as unknown as Record<string, unknown>);
  await saveSettings(sanitized);

  return { success: true };
}

export function isEncryptedBackupFile(data: unknown): data is EncryptionEnvelope {
  return isEncryptionEnvelope(data);
}
