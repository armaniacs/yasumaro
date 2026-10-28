/**
 * settingsExportImport.ts
 * Settings export and import functionality
 */

import type { HmacSigner } from './crypto/hmacSigner.js';
import { exportHmacSigner } from './storage/encryptionSession.js';
import { settingsRepository } from './storage/SettingsRepository.js';
import { API_KEY_FIELDS } from './storage/settingsMigration.js';
import { DEFAULT_SETTINGS } from './storage/defaults.js';
import { Settings, StorageKeys, isPrivacyMode } from './storage/types.js';
import {
  sealEncryptedExport,
  openEncryptedExport,
} from './crypto/encryptedExportCodec.js';
// Compatibility re-export: the version stamps live in the codec (PBI
// 2026-10-16-06). Existing importers keep working without touching numbers.
export {
  ENCRYPTED_EXPORT_VERSION,
  LEGACY_ENCRYPTED_EXPORT_VERSION,
} from './crypto/encryptedExportCodec.js';
import { ErrorCode } from './logger/types.js';
import { logError, logInfo, logWarn } from './logger/api.js';
import { errorMessage } from './errorUtils.js';
import { DEFAULT_IMPORT_SIZE_CAP_BYTES } from './importPipeline.js';
// NOTE (PBI 2026-10-16-01): only the size-cap constant is shared with
// importPipeline.ts. The settings flows do NOT run through runImportPipeline —
// the encrypted flow needs decrypt between authenticate and validate, which
// the four-stage pipeline has no stage for (see importPipeline.ts header).

/** Current export format version (plaintext settings) */
export const EXPORT_VERSION = '1.1.0';

/**
 * Version written before SSOT-derived key validation (PBI 04). Payloads with
 * this version predate many DEFAULT_SETTINGS keys, so they validate against
 * the frozen legacy contract instead of the full derived key set.
 */
export const LEGACY_EXPORT_VERSION = '1.0.0';

export interface SettingsExportData {
  version: string;
  exportedAt: string;
  settings: Settings;
  apiKeyExcluded: boolean;
  signature?: string;
}

// 【マスターパスワード暗号化形式】 — SSOT iterations, version:2 ciphertext-HMAC
export interface EncryptedExportData {
  encrypted: true;
  version: string;
  exportedAt: string;
  ciphertext: string;
  iv: string;
  hmac: string;
  salt: string;
  iterations?: number;
}

export type ExportFileData = SettingsExportData | EncryptedExportData;

// Deprecated: Internal use only, but keeping for compatibility if needed internally
interface ExportData extends SettingsExportData { }

/**
 * APIキーフィールドを除外した設定を取得する
 * @param {Settings} settings - 元の設定
 * @returns {Settings} APIキーが除外された設定
 */
/**
 * Strip device-local security state from a settings blob. Confirmations
 * travel with neither exports nor imports: a grant recorded on one device
 * must not silently authorize origins elsewhere, and an import payload must
 * not be able to smuggle authorizations back in.
 */
export function stripDeviceLocalSecurityState(settings: Settings): Settings {
  const stripped = { ...settings };
  delete (stripped as Record<string, unknown>)[StorageKeys.CONFIRMED_PROVIDER_ORIGINS];
  return stripped;
}

/**
 * The consent record itself (PBI 2026-10-19-12). Consent is an act the data
 * subject performs on *this* device, so a settings file must not carry it: an
 * export would grant consent on the target profile, and a revoked export would
 * withdraw a valid grant there.
 */
const CONSENT_RECORD_KEYS: readonly string[] = [
  StorageKeys.PRIVACY_CONSENT,
  StorageKeys.PRIVACY_CONSENT_VERSION,
  StorageKeys.PRIVACY_CONSENT_DENIED_COUNT,
  StorageKeys.PRIVACY_CONSENT_LAST_DENIAL_TIME,
];

/**
 * Keys an import must ignore on top of the consent record: the evidence
 * `migrateLegacyPrivacyConsent` reads to decide "this profile used privacy
 * features before" and auto-grant consent. That judgement belongs to this
 * device's own history, not to a file from another device, so an imported
 * payload must not be able to trigger it.
 *
 * These stay in the export on purpose. They are ordinary configuration (which
 * pipeline runs) and part of the fail-closed required-key contract, so removing
 * them from the file would both break that contract and lose the setting for
 * no security gain — the import-side drop is the defence.
 */
const IMPORT_ONLY_IGNORED_KEYS: readonly string[] = [
  StorageKeys.PRIVACY_MODE,
  StorageKeys.PII_CONFIRMATION_UI,
];

/**
 * Strip the consent record from a settings blob (export side).
 */
function stripDeviceLocalConsentState(settings: Settings): Settings {
  const stripped = { ...settings };
  for (const key of CONSENT_RECORD_KEYS) {
    delete (stripped as Record<string, unknown>)[key];
  }
  return stripped;
}

/**
 * Strip everything consent-related from an imported blob (import side). Ignoring
 * rather than rejecting keeps old backups usable; the target device keeps its own
 * consent record because `setAll` merges the patch and these keys are absent.
 */
function stripImportedConsentKeys(settings: Settings): Settings {
  const stripped = stripDeviceLocalConsentState(settings);
  for (const key of IMPORT_ONLY_IGNORED_KEYS) {
    delete (stripped as Record<string, unknown>)[key];
  }
  return stripped;
}

function sanitizeSettingsForExport(settings: Settings): Settings {
  const sanitized = stripDeviceLocalConsentState(stripDeviceLocalSecurityState(settings));

  for (const field of API_KEY_FIELDS) {
    delete sanitized[field];
  }

  return sanitized;
}

/**
 * Minimal repo seam for import post-processing (PBI 2026-10-16-01).
 * Structural (not nominal): a fake `{ getAll, setAll }` satisfies it, so
 * tests verify the import flow without mocking `settingsRepository`.
 */
export interface SettingsImportRepo {
  getAll(): Promise<Settings>;
  setAll(settings: Partial<Settings>): Promise<void>;
}

/** Verifier seam for import authentication (PBI 2026-10-16-01). */
export type ImportHmacVerifier = Pick<HmacSigner, 'verify'>;

export interface FinalizeImportedSettingsOptions {
  apiKeyExcluded: boolean;
  repo?: SettingsImportRepo | undefined;
}

export interface ImportSettingsOptions {
  repo?: SettingsImportRepo;
  signer?: ImportHmacVerifier;
}

/**
 * Single owner of import post-processing: merge→strip→save (PBI 2026-10-16-01).
 *
 * Every import path (plaintext `importSettings`, encrypted
 * `importEncryptedSettings`) funnels through here so the order can no longer
 * drift per call site: when keys were excluded, existing API keys are merged
 * back first; then device-local security state is stripped; then the SAME
 * stripped object is both persisted and returned (save/return parity).
 */
export async function finalizeImportedSettings(
  importedSettings: Settings,
  opts: FinalizeImportedSettingsOptions
): Promise<Settings> {
  const repo: SettingsImportRepo = opts.repo ?? settingsRepository;
  const merged = opts.apiKeyExcluded
    ? await mergeWithExistingApiKeys(importedSettings, repo)
    : importedSettings;
  const toSave = stripImportedConsentKeys(stripDeviceLocalSecurityState(merged));
  await repo.setAll(toSave);
  return toSave;
}

/**
 * インポート設定とAPIキーをマージする（APIキー除外時の共通処理）
 */
async function mergeWithExistingApiKeys(
  importedSettings: Settings,
  repo: SettingsImportRepo = settingsRepository
): Promise<Settings> {
  const existingSettings = await repo.getAll();
  const merged: Settings = { ...importedSettings };
  for (const field of API_KEY_FIELDS) {
    (merged as Record<string, unknown>)[field] = existingSettings[field];
  }
  return merged;
}

function isOverImportSizeCap(jsonData: string): boolean {
  return new TextEncoder().encode(jsonData).length > DEFAULT_IMPORT_SIZE_CAP_BYTES;
}

async function logImportSizeCapExceeded(): Promise<void> {
  await logError(
    'Import rejected: file exceeds size cap',
    {},
    ErrorCode.SETTINGS_IMPORT_FAILURE,
    'settingsExportImport.ts'
  );
}

async function finalizeParsedImport(
  parsed: ExportData,
  opts?: ImportSettingsOptions
): Promise<Settings | null> {
  if (parsed.apiKeyExcluded) {
    await logInfo(
      'Imported settings have API keys excluded. Existing API keys will be preserved.',
      { apiKeyExcluded: true },
      'settingsExportImport.ts'
    );
    return finalizeImportedSettings(parsed.settings, {
      apiKeyExcluded: true,
      repo: opts?.repo,
    });
  }
  return finalizeImportedSettings(parsed.settings, {
    apiKeyExcluded: false,
    repo: opts?.repo,
  });
}

/**
 * Settings keys that must be present for a current-format export payload to
 * validate. Derived from the canonical defaults minus API key fields so newly
 * added settings become required automatically instead of via a hand-maintained
 * parallel list that can drift out of sync.
 *
 * Device-local consent keys are excluded for the same reason they are excluded
 * from the payload (PBI 2026-10-19-12): a key the exporter never writes cannot be
 * required of an importer. Without this filter the exporter would produce files
 * its own validator rejects (`missing_required_key`). Files written by older
 * releases still carry these keys, which is fine — the check is a lower bound.
 */
const API_KEY_FIELD_SET: ReadonlySet<string> = new Set<string>(API_KEY_FIELDS);
const CONSENT_RECORD_KEY_SET: ReadonlySet<string> = new Set<string>(CONSENT_RECORD_KEYS);
// These additive provider fields were absent from earlier 1.1.0 backups.
// Keep those backups importable; setAll preserves existing values for gaps,
// and the settings read path supplies defaults on a fresh install.
const ADDITIVE_OPENAI_EXPORT_KEYS: ReadonlySet<string> = new Set<string>([
  StorageKeys.OPENAI_OFFICIAL_MODEL,
  StorageKeys.OPENAI_OFFICIAL_API_KEY,
]);
const REQUIRED_EXPORT_KEYS: readonly string[] = Object.keys(DEFAULT_SETTINGS).filter(
  (key) => !API_KEY_FIELD_SET.has(key) && !CONSENT_RECORD_KEY_SET.has(key) && !ADDITIVE_OPENAI_EXPORT_KEYS.has(key)
);

/**
 * Frozen required-key contract of pre-1.1.0 export files. Never add keys
 * here: it mirrors what old releases actually wrote, and rejecting on keys
 * they could not contain would break imports of legacy exports.
 */
const LEGACY_REQUIRED_EXPORT_KEYS: readonly string[] = [
  'obsidian_protocol', 'obsidian_port',
  'min_visit_duration', 'min_scroll_depth',
  'gemini_model', 'obsidian_daily_path', 'ai_provider',
  'openai_base_url', 'openai_model',
  'openai_2_base_url', 'openai_2_model',
  'domain_whitelist', 'domain_blacklist', 'domain_filter_mode',
  'privacy_mode', 'pii_confirmation_ui', 'pii_sanitize_logs',
  'ublock_rules', 'ublock_sources', 'ublock_format_enabled',
  'simple_format_enabled',
];

/** API key fields the legacy format required when keys were included. */
const LEGACY_API_KEY_FIELDS: readonly string[] = [
  'obsidian_api_key', 'gemini_api_key',
  'openai_api_key', 'openai_2_api_key',
];

/**
 * Persist a JSON payload as a downloadable file, owning the
 * Blob anchor click revoke lifecycle in one place.
 * @param {string} json - serialized payload to save
 * @param {string} filename - download filename for the anchor
 */
export function saveJsonToFile(json: string, filename: string): void {
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Generate filename for export with timestamp
 * @returns {string} filename for settings export
 */
function getExportFilename(): string {
  const date = new Date();
  const pad = (value: number): string => String(value).padStart(2, '0');
  const day = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `yasumaro-settings-${day}-${time}.json`;
}

async function buildExportData(): Promise<ExportData> {
  const settings = await settingsRepository.getAll();
  return {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    settings: sanitizeSettingsForExport(settings),
    apiKeyExcluded: true,
  };
}

/**
 * マスターパスワードで暗号化して設定をエクスポート
 * @param {string} masterPassword - マスターパスワード
 * @returns {Promise<{ success: boolean; encryptedData?: EncryptedExportData; error?: string }>}
 */
export async function exportEncryptedSettings(
  masterPassword: string
): Promise<{ success: boolean; encryptedData?: EncryptedExportData; error?: string }> {
  try {
    const exportData = await buildExportData();
    const json = JSON.stringify(exportData, null, 2);

    // Seal (salt, KDF, encrypt, HMAC) is owned by the codec; the settings
    // side passes only the JSON and the password (plus its signer).
    const sealed = await sealEncryptedExport(json, masterPassword, exportHmacSigner);

    const encryptedExportData: EncryptedExportData = {
      encrypted: true,
      version: sealed.version,
      exportedAt: new Date().toISOString(),
      ciphertext: sealed.ciphertext,
      iv: sealed.iv,
      hmac: sealed.hmac,
      salt: sealed.salt,
      iterations: sealed.iterations,
    };

    return { success: true, encryptedData: encryptedExportData };
  } catch (error) {
    return {
      success: false,
      error: errorMessage(error)
    };
  }
}

/**
 * マスターパスワードで復号して設定をインポート
 * @param {string} jsonData - 暗号化されたエクスポートデータのJSON文字列
 * @param {string} masterPassword - マスターパスワード
 * @returns {Promise<Settings|null>}
 */
export async function importEncryptedSettings(
  jsonData: string,
  masterPassword: string,
  opts?: ImportSettingsOptions
): Promise<Settings | null> {
  try {
    // Size cap before any decode/KDF/decrypt work (VULN-034): a forged giant
    // file must not reach PBKDF2.
    if (isOverImportSizeCap(jsonData)) {
      await logImportSizeCapExceeded();
      return null;
    }

    const encryptedData = JSON.parse(jsonData) as EncryptedExportData;

    // 暗号化されたデータかどうか確認
    if (!encryptedData.encrypted) {
      await logError(
        'Not an encrypted export file',
        {},
        ErrorCode.SETTINGS_IMPORT_FAILURE,
        'settingsExportImport.ts'
      );
      return null;
    }

    // Open (ciphertext HMAC, KDF dispatch, legacy plaintext check) is owned
    // by the codec; the settings side passes only the password and the file
    // envelope (plus its verifier) and maps the outcome to logs.
    const verifier: ImportHmacVerifier = opts?.signer ?? exportHmacSigner;
    let decryptedJson: string;
    try {
        const opened = await openEncryptedExport(masterPassword, encryptedData, verifier);
        if (opened.status === 'rejected') {
            if (opened.reason === 'hmac-mismatch') {
                await logError(
                    'HMAC verification failed',
                    {},
                    ErrorCode.SETTINGS_SIGNATURE_FAILURE,
                    'settingsExportImport.ts'
                );
            } else {
                await logError(
                    'Decryption failed',
                    {},
                    ErrorCode.SETTINGS_IMPORT_FAILURE,
                    'settingsExportImport.ts'
                );
            }
            return null;
        }
        decryptedJson = opened.decryptedJson;
        if (opened.needsRehash) {
            await logInfo(
                'Decrypted with legacy iterations — re-encrypt recommended',
                { usedIterations: 'legacy' },
                'settingsExportImport.ts'
            );
        }
        if (opened.legacyUnsigned) {
            // Pre-signing exports carry no hmac and cannot be authenticated; they
            // stay importable so existing backups are not orphaned.
            await logWarn(
                'Importing an unsigned legacy encrypted export',
                { version: String(encryptedData.version) },
                undefined,
                'settingsExportImport.ts'
            );
        }
    } catch {
        await logError(
            'Decryption failed',
            {},
            ErrorCode.SETTINGS_IMPORT_FAILURE,
            'settingsExportImport.ts'
        );
        return null;
    }

    // 復号されたJSONを解析してインポート
    const parsed = JSON.parse(decryptedJson) as ExportData;

    // 構造検証（拒否理由を記録して fail-closed）
    const decryptedValidationError = getExportValidationError(parsed);
    if (decryptedValidationError !== null) {
      await logError(
        'Encrypted import rejected: invalid export structure',
        { ...decryptedValidationError },
        ErrorCode.SETTINGS_IMPORT_FAILURE,
        'settingsExportImport.ts'
      );
      return null;
    }

    // APIキーが除外されている場合
    return finalizeParsedImport(parsed, opts);
  } catch (error) {
    await logError(
      'Failed to import encrypted settings',
      { error: errorMessage(error) },
      ErrorCode.SETTINGS_IMPORT_FAILURE,
      'settingsExportImport.ts'
    );
    return null;
  }
}

/**
 * エクスポートデータが暗号化されているかどうかを判定
 */
export function isEncryptedExport(data: unknown): data is EncryptedExportData {
  const obj = data as { encrypted?: unknown };
  return typeof data === 'object' &&
    data !== null &&
    'encrypted' in obj &&
    obj.encrypted === true;
}

/**
 * Plaintext twin of `isEncryptedExport` for the centralized backup query
 * (PBI 2026-10-24-06). Both file variants belong to the single `settings`
 * shape: the encrypted/plaintext split stays inside this codec seam
 * (NN02 unified open/seal), the query only needs "this file is a settings
 * retire". An encrypted envelope never satisfies this (its `settings` blob
 * is sealed inside `ciphertext`), so the two predicates are disjoint.
 */
export function isPlaintextSettingsPayload(candidate: {
  encrypted?: boolean;
  settings?: object;
  exportedAt?: string;
}): boolean {
  if (candidate.encrypted === true) {
    return false;
  }
  return (
    typeof candidate.settings === 'object' &&
    candidate.settings !== null &&
    typeof candidate.exportedAt === 'string'
  );
}

/**
 * Export all settings to a JSON file
 */
export async function exportSettings(): Promise<void> {
  const exportData = await buildExportData();

  // HMAC署名を計算
  const signature = await exportHmacSigner.sign(JSON.stringify(exportData, null, 2));

  // 署名付きエクスポートデータ
  const signedExportData: ExportData = {
    ...exportData,
    signature,
  };

  const signedJson = JSON.stringify(signedExportData, null, 2);
  saveJsonToFile(signedJson, getExportFilename());
}

/**
 * 暗号化エクスポートデータをファイルとして保存
 */
export async function saveEncryptedExportToFile(
  encryptedData: EncryptedExportData
): Promise<void> {
  const json = JSON.stringify(encryptedData, null, 2);
  saveJsonToFile(json, getExportFilename().replace('.json', '-encrypted.json'));
}

/**
 * Export format versions produced by this codebase. The `version` field of an
 * export payload is the schema stamp that lets an importer tell a newer
 * (future) payload apart from a corrupt one — see `getExportValidationError`.
 * No separate stamp field exists on purpose: adding one would change the
 * signed export format and break existing backups/tests.
 */
export const KNOWN_EXPORT_VERSIONS = [LEGACY_EXPORT_VERSION, EXPORT_VERSION] as const;

/**
 * Whether an export `version` stamp was never produced by a known release.
 * An unknown stamp together with an unknown `privacy_mode` most likely means
 * a future value; the same unknown value under a known stamp means corruption.
 */
export function isUnrecognizedExportVersion(version: unknown): boolean {
  if (typeof version !== 'string') {
    return true;
  }
  return version !== LEGACY_EXPORT_VERSION && version !== EXPORT_VERSION;
}

/** Machine-readable reason for a rejected settings export payload. */
export type ExportValidationReason =
  | 'not_an_object'
  | 'missing_version'
  | 'missing_exported_at'
  | 'missing_settings'
  | 'missing_required_key'
  | 'missing_api_key'
  | 'unknown_privacy_mode';

export interface ExportValidationError {
  /** Top-level field or `settings.<key>` that failed validation. */
  field: string;
  reason: ExportValidationReason;
  /** `typeof` the offending value (`missing` when a required key is absent). */
  receivedType: string;
  /** Length of the offending string value, when applicable. */
  receivedLength?: number;
  /**
   * Truncated preview (first 64 chars) of an offending string value.
   * Deliberately not the full value: a corrupt payload can carry arbitrary
   * text, and while log details pass through the central PII/sanitizer
   * pipeline, bounding the size keeps the record safe by construction.
   */
  receivedPreview?: string;
  /** Raw `version` stamp of the rejected payload, when present. */
  exportVersion?: unknown;
  /** True when the stamp itself was never produced by a known release. */
  isUnrecognizedVersion: boolean;
}

/** Max chars of an offending string value kept in a validation error. */
const INVALID_VALUE_PREVIEW_LIMIT = 64;

function typeName(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (value === undefined) {
    return 'missing';
  }
  return typeof value;
}

/**
 * Structured validation for export payloads. Returns `null` when the payload
 * is valid, otherwise the first failure with field/reason details so callers
 * can record *why* a backup was rejected (fail-closed is preserved: every
 * non-null result still means rejection).
 */
export function getExportValidationError(data: unknown): ExportValidationError | null {
  if (typeof data !== 'object' || data === null) {
    return {
      field: '(root)',
      reason: 'not_an_object',
      receivedType: typeName(data),
      isUnrecognizedVersion: true,
    };
  }

  const obj = data as Record<string, unknown>;
  const exportVersion = obj.version;
  const isUnrecognizedVersion = isUnrecognizedExportVersion(exportVersion);

  // Check required fields
  if (typeof exportVersion !== 'string') {
    return {
      field: 'version',
      reason: 'missing_version',
      receivedType: typeName(exportVersion),
      isUnrecognizedVersion,
    };
  }

  if (typeof obj.exportedAt !== 'string') {
    return {
      field: 'exportedAt',
      reason: 'missing_exported_at',
      receivedType: typeName(obj.exportedAt),
      exportVersion,
      isUnrecognizedVersion,
    };
  }

  if (typeof obj.settings !== 'object' || obj.settings === null) {
    return {
      field: 'settings',
      reason: 'missing_settings',
      receivedType: typeName(obj.settings),
      exportVersion,
      isUnrecognizedVersion,
    };
  }

  const settings = obj.settings as Record<string, unknown>;

  // Key presence below is skipped when the payload declares keys excluded.
  const apiKeyExcluded = obj.apiKeyExcluded === true;

  // Current format requires the full SSOT-derived set; older formats are
  // validated against their frozen contract so legacy exports stay importable
  // (setAll() merges over current settings, filling anything the payload lacks).
  const isCurrentFormat = obj.version === EXPORT_VERSION;
  const requiredKeys = isCurrentFormat ? REQUIRED_EXPORT_KEYS : LEGACY_REQUIRED_EXPORT_KEYS;

  for (const key of requiredKeys) {
    if (!(key in settings)) {
      return {
        field: `settings.${key}`,
        reason: 'missing_required_key',
        receivedType: 'missing',
        exportVersion,
        isUnrecognizedVersion,
      };
    }
  }

  // API key presence is required only when the payload claims to include keys.
  if (!apiKeyExcluded) {
    const apiKeyKeys = isCurrentFormat ? API_KEY_FIELDS : LEGACY_API_KEY_FIELDS;
    for (const key of apiKeyKeys) {
      if (isCurrentFormat && ADDITIVE_OPENAI_EXPORT_KEYS.has(key)) continue;
      if (!(key in settings)) {
        return {
          field: `settings.${key}`,
          reason: 'missing_api_key',
          receivedType: 'missing',
          exportVersion,
          isUnrecognizedVersion,
        };
      }
    }
  }

  // Value-range check: a corrupted `privacy_mode` would otherwise be carried into
  // settings and fail open in the pipeline (masking off while cloud AI stays on).
  // `cloud_only` is a legal explicit choice; unknown values are rejected instead
  // of being silently repaired, so the user learns the backup is damaged.
  const exportedPrivacyMode = settings['privacy_mode'];
  if (exportedPrivacyMode !== undefined && !isPrivacyMode(exportedPrivacyMode)) {
    return {
      field: 'settings.privacy_mode',
      reason: 'unknown_privacy_mode',
      receivedType: typeName(exportedPrivacyMode),
      ...(typeof exportedPrivacyMode === 'string'
        ? {
            receivedLength: exportedPrivacyMode.length,
            receivedPreview: exportedPrivacyMode.slice(0, INVALID_VALUE_PREVIEW_LIMIT),
          }
        : {}),
      exportVersion,
      isUnrecognizedVersion,
    };
  }

  return null;
}

/**
 * Validate export data structure
 * @param {unknown} data - data to validate
 * @returns {boolean} true if data is valid
 */
export function validateExportData(data: unknown): boolean {
  return getExportValidationError(data) === null;
}

/**
 * Import settings from JSON string
 * @param {string} jsonData - JSON string containing export data
 * @returns {Promise<Settings|null>} imported Settings or null if validation fails
 */
export async function importSettings(
  jsonData: string,
  opts?: ImportSettingsOptions
): Promise<Settings | null> {
  try {
    if (isOverImportSizeCap(jsonData)) {
      await logImportSizeCapExceeded();
      return null;
    }

    const parsed = JSON.parse(jsonData) as ExportData;

    // 【セキュリティ強化】署名があるかチェック
    // 【実装方針】: 署名なしファイルは即時拒否（警告ダイアログあり＝i18n化済み）
    // 【テスト対応】: settingsExportImport-signature.test.ts
    // 🟢 信頼性レベル: 青信号（要件定義書の署名強化仕様通り）
    if (!parsed.signature) {
      await logError(
        'Import rejected: Missing signature',
        {},
        ErrorCode.SETTINGS_SIGNATURE_FAILURE,
        'settingsExportImport.ts'
      );
      // Rejection is surfaced by the UI layer (importNoSignature status);
      // utils must not open dialogs (PBI 2026-09-17-19).
      return null; // 旧形式の互換性を削除
    }

    // 署名を除いてハッシュ計算
    const { signature, ...dataForVerification } = parsed;
    const dataJson = JSON.stringify(dataForVerification, null, 2);

    const verifier: ImportHmacVerifier = opts?.signer ?? exportHmacSigner;
    if (!(await verifier.verify(dataJson, signature))) {
      await logError(
        'Signature verification failed',
        {},
        ErrorCode.SETTINGS_SIGNATURE_FAILURE,
        'settingsExportImport.ts'
      );
      // VULN-009 fix: reject import unconditionally when signature verification fails
      // Do not allow force-import via confirm() dialog as it bypasses integrity check
      return null;
    }

    // 構造検証（拒否理由を記録して fail-closed）
    const validationError = getExportValidationError(parsed);
    if (validationError !== null) {
      await logError(
        'Import rejected: invalid export structure',
        { ...validationError },
        ErrorCode.SETTINGS_IMPORT_FAILURE,
        'settingsExportImport.ts'
      );
      return null;
    }

    // APIキーが除外されている場合、インポートしない
    return finalizeParsedImport(parsed, opts);
  } catch (error) {
    await logError(
      'Failed to import settings',
      { error: errorMessage(error) },
      ErrorCode.SETTINGS_IMPORT_FAILURE,
      'settingsExportImport.ts'
    );
    return null;
  }
}
