/**
 * encryptedBackupPanel.ts
 * ダッシュボードの「暗号化バックアップ」ボタン・モーダルの結線
 *
 * PBI 2026-11-23-02: 単一形式に加えて分割形式（マニフェスト + パート群）を
 * 扱う。単一か分割かはファイルの形状で判別し、分割形式ではマニフェストを
 * 先に読んで不足・順序誤り・上限超過を復号（KDF）の前にはじく。不足した
 * まま KDF に進むと待ち時間が増えるため、順序は VULN-036 と同じく
 * ファイルサイズ、形状、エンベロープ長、KDF・認証復号の順序を保つ。
 */

import { MAX_BACKUP_FILE_BYTES, MAX_BACKUP_ENVELOPE_BASE64_LENGTH, MAX_ENVELOPE_BASE64_LENGTH } from '../utils/limits.js';
import { showPasswordAuthModal, setPasswordAuthProgress } from './masterPassword.js';
import { logDebug } from '../utils/logger/api.js';
import {
  exportEncryptedBackup,
  importEncryptedBackup,
  exportEncryptedSplitBackup,
  importEncryptedSplitBackup,
  isEncryptedBackupFile,
  isEncryptedSplitBackupFile,
} from './encryptedBackupService.js';
import {
  MAX_SPLIT_PART_COUNT,
  SPLIT_BACKUP_FORMAT_VERSION,
  SPLIT_BACKUP_KIND,
  type SplitBackupContainer,
} from './encryptedBackupSplitCodec.js';
import type { EncryptionEnvelope } from '../utils/crypto/index.js';
import { downloadBlob } from './exportLogsService.js';
import { errorMessage } from '../utils/errorUtils.js';
import { showStatus, type StatusType } from '../utils/ui/settingsUiHelper.js';
import { getMessageOr, getMessageWithSubstitutions } from '../utils/i18n.js';
import { withBusyButton } from './panels/asyncData/busyButton.js';

/** 分割マニフェストファイルの識別子（パネル入出力のファイル形式、PBI02）。 */
export const SPLIT_MANIFEST_FILE_KIND = 'yasumaro-split-backup-manifest';
/** 分割パートファイルの識別子（パネル入出力のファイル形式、PBI02）。 */
export const SPLIT_PART_FILE_KIND = 'yasumaro-split-backup-part';
/** パネル入出力の分割ファイル形式の版数。 */
export const SPLIT_PANEL_FILE_FORMAT_VERSION = 1;
/** コーデックのパート数上限のパネル別名（試験から上限値を参照するため）。 */
export const MAX_SPLIT_PART_COUNT_FOR_PANEL = MAX_SPLIT_PART_COUNT;

export interface SplitManifestFile {
  kind: typeof SPLIT_MANIFEST_FILE_KIND;
  formatVersion: number;
  total: number;
  manifest: EncryptionEnvelope;
}

export interface SplitPartFile {
  kind: typeof SPLIT_PART_FILE_KIND;
  formatVersion: number;
  index: number;
  total: number;
  part: EncryptionEnvelope;
}

function isRecord(data: unknown): data is Record<string, unknown> {
  return typeof data === 'object' && data !== null;
}

/** マニフェストファイルの形状判定。復号前の先行読みに使う純粋な形状確認。 */
export function isSplitManifestFile(data: unknown): data is SplitManifestFile {
  if (!isRecord(data)) return false;
  return (
    data['kind'] === SPLIT_MANIFEST_FILE_KIND &&
    data['formatVersion'] === SPLIT_PANEL_FILE_FORMAT_VERSION &&
    typeof data['total'] === 'number' &&
    Number.isInteger(data['total']) &&
    isRecord(data['manifest'])
  );
}

/** パートファイルの形状判定。復号前の先行読みに使う純粋な形状確認。 */
export function isSplitPartFile(data: unknown): data is SplitPartFile {
  if (!isRecord(data)) return false;
  return (
    data['kind'] === SPLIT_PART_FILE_KIND &&
    data['formatVersion'] === SPLIT_PANEL_FILE_FORMAT_VERSION &&
    typeof data['index'] === 'number' &&
    Number.isInteger(data['index']) &&
    typeof data['total'] === 'number' &&
    Number.isInteger(data['total']) &&
    isRecord(data['part'])
  );
}

/**
 * 期待パート番号 0..total-1 のうち存在しない番号を昇順で返す。
 * 重複や範囲外はここでは無視する（順序誤りとして別途報告する）。
 */
export function findMissingPartIndices(presentIndices: number[], total: number): number[] {
  const present = new Set(presentIndices.filter((i) => Number.isInteger(i) && i >= 0 && i < total));
  const missing: number[] = [];
  for (let i = 0; i < total; i++) {
    if (!present.has(i)) missing.push(i);
  }
  return missing;
}

export interface SplitDownloadNames {
  manifestName: string;
  partNames: string[];
}

/**
 * マニフェストとパート群のダウンロード名を同一 stem に統一する。
 * どれが組かがファイル名から一目で分かり、混ざっても選別できる。
 */
export function buildSplitDownloadNames(baseFileName: string, total: number): SplitDownloadNames {
  const stem = baseFileName.replace(/\.encrypted\.json$/, '');
  return {
    manifestName: `${stem}.manifest.encrypted.json`,
    partNames: Array.from({ length: total }, (_, index) => `${stem}.part-${index}-of-${total}.encrypted.json`),
  };
}

/** エンベロープの base64 テキスト 3 欄が汎用上限内に収まることの事前確認。 */
function isEnvelopeWithinGenericCap(envelope: unknown): boolean {
  if (!isRecord(envelope)) return false;
  for (const field of ['salt', 'iv', 'data'] as const) {
    const value = envelope[field];
    if (typeof value !== 'string' || value.length > MAX_ENVELOPE_BASE64_LENGTH) return false;
  }
  return true;
}

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
  // (60s bounded delay) — a synchronous revoke killed large backups
  // before Chromium finished persisting them.
  downloadBlob(new Blob([json], { type: 'application/json' }), filename);
}

function stageText(stage: 'readingDb' | 'encrypting' | 'decrypting' | 'restoringDb' | 'restoringSettings'): string {
  switch (stage) {
    case 'readingDb':
      return getMessageOr('backupStageReadingDb', 'Reading history database...');
    case 'encrypting':
      return getMessageOr('backupStageEncrypting', 'Encrypting...');
    case 'decrypting':
      return getMessageOr('backupStageDecrypting', 'Decrypting...');
    case 'restoringDb':
      return getMessageOr('backupStageRestoringDb', 'Restoring history database...');
    case 'restoringSettings':
      return getMessageOr('backupStageRestoringSettings', 'Restoring settings...');
  }
}

type ImportResult = { success: boolean; error?: string; skippedKeys?: string[] };

/** 単一・分割で共有する復元結果の表示。成功時は設定再読込を通知する。 */
function applyImportResult(result: ImportResult): void {
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
    throw new Error(String(result.error));
  }
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
          const reportStage = (stage: 'readingDb' | 'encrypting'): void => {
            const text = stageText(stage);
            setStatus(text, false, 'updating');
            setPasswordAuthProgress(text);
            void logDebug('encrypted-backup stage', { flow: 'export', stage, elapsedMs: Date.now() - startedAt }, 'encryptedBackupPanel');
          };
          const envelope = await exportEncryptedBackup(password, reportStage);
          if (envelope.data.length <= MAX_BACKUP_ENVELOPE_BASE64_LENGTH) {
            setPasswordAuthProgress(null);
            void logDebug(
              'encrypted-backup done',
              { flow: 'export', elapsedMs: Date.now() - startedAt, envelopeChars: JSON.stringify(envelope).length },
              'encryptedBackupPanel',
            );
            downloadJson(envelope, filename);
            setStatus(getMessageWithSubstitutions('encryptedBackupCreated', { filename }, '暗号化バックアップを作成しました: {filename}'), false);
            return;
          }
          // 単一エンベロープでは上限に収まらない大容量バックアップは分割形式
          // で出し直す。ファイル名の stem を統一し、マニフェストと全パートを
          // 複数ダウンロードする（直列・bounded revoke は維持）。
          const container = await exportEncryptedSplitBackup(password, reportStage);
          setPasswordAuthProgress(null);
          const names = buildSplitDownloadNames(filename, container.parts.length);
          downloadJson(
            {
              kind: SPLIT_MANIFEST_FILE_KIND,
              formatVersion: SPLIT_PANEL_FILE_FORMAT_VERSION,
              total: container.parts.length,
              manifest: container.manifest,
            } satisfies SplitManifestFile,
            names.manifestName,
          );
          container.parts.forEach((part, index) => {
            downloadJson(
              {
                kind: SPLIT_PART_FILE_KIND,
                formatVersion: SPLIT_PANEL_FILE_FORMAT_VERSION,
                index,
                total: container.parts.length,
                part,
              } satisfies SplitPartFile,
              names.partNames[index]!,
            );
          });
          void logDebug(
            'encrypted-backup done',
            { flow: 'export-split', elapsedMs: Date.now() - startedAt, parts: container.parts.length },
            'encryptedBackupPanel',
          );
          // 複数ダウンロードの完了はページから観測できない（anchor-click は
          // fire-and-forget で、ブラウザが 2 件目以降を抑止しうる）。成功
          // 断定はせず、件数と先頭名を示して利用者の確認を促す。
          setStatus(
            getMessageWithSubstitutions(
              'encryptedBackupSplitCreated',
              { filename: names.manifestName, count: container.parts.length + 1 },
              'Requested download of {count} split backup files starting with {filename}. Browsers may block multiple automatic downloads: confirm all {count} files are in your download folder and allow them if prompted.',
            ),
            false,
          );
        });
      } catch (error) {
        setStatus(getMessageWithSubstitutions('encryptedBackupCreateFailed', { error: errorMessage(error) }, 'バックアップ作成に失敗しました: {error}'), true);
        throw error instanceof Error ? error : new Error(String(errorMessage(error)));
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
    const files = Array.from(input.files ?? []);
    if (files.length === 0) return;

    // Size cap BEFORE reading/parsing: a forged multi-hundred-MB file must not
    // be pulled into memory or handed to JSON.parse (VULN-036).
    for (const file of files) {
      if (file.size > MAX_BACKUP_FILE_BYTES) {
        setStatus(getMessageOr('encryptedBackupFileTooLarge', 'バックアップファイルが大きすぎます'), true);
        if (importFileInput) importFileInput.value = '';
        return;
      }
    }

    const resetInput = (): void => {
      if (importFileInput) importFileInput.value = '';
    };

    const reportImportStage = (flow: 'import' | 'import-split', startedAt: number) =>
      (stage: 'decrypting' | 'restoringDb' | 'restoringSettings'): void => {
        const text = stageText(stage);
        setStatus(text, false, 'updating');
        setPasswordAuthProgress(text);
        void logDebug('encrypted-backup stage', { flow, stage, elapsedMs: Date.now() - startedAt }, 'encryptedBackupPanel');
      };

    try {
      // 逐次読み（全件 Promise.all 読みは DoS 面で不利）。1 件読むたびに
      // 分割ラッパーの汎用上限を確認し、超過時は残りを読まずに打ち切る。
      // 単一判定→分割判定の分岐順序と復号前ゲート順序は下流で維持し、
      // この先行打ち切りは下流でも同じ理由で弾かれる入力に限る。
      const parsed: unknown[] = [];
      let earlyAborted = false;
      let partFilesSeen = 0;
      for (const [position, file] of files.entries()) {
        parsed.push(JSON.parse(await file.text()) as unknown);
        const item = parsed[position]!;
        if (isSplitManifestFile(item)) {
          if (item.total > MAX_SPLIT_PART_COUNT) {
            setStatus(
              getMessageWithSubstitutions(
                'encryptedBackupSplitTooLarge',
                { detail: `declares ${item.total} parts, above the cap of ${MAX_SPLIT_PART_COUNT}` },
                'Split backup exceeds the size limit: {detail}',
              ),
              true,
            );
            resetInput();
            earlyAborted = true;
            break;
          }
          if (!isEnvelopeWithinGenericCap(item.manifest)) {
            setStatus(
              getMessageWithSubstitutions(
                'encryptedBackupSplitTooLarge',
                { detail: 'manifest envelope exceeds the generic length limit' },
                'Split backup exceeds the size limit: {detail}',
              ),
              true,
            );
            resetInput();
            earlyAborted = true;
            break;
          }
        } else if (isSplitPartFile(item)) {
          if (!isEnvelopeWithinGenericCap(item.part)) {
            setStatus(
              getMessageWithSubstitutions(
                'encryptedBackupSplitTooLarge',
                { detail: `part file at position ${position} exceeds the generic length limit` },
                'Split backup exceeds the size limit: {detail}',
              ),
              true,
            );
            resetInput();
            earlyAborted = true;
            break;
          }
          partFilesSeen += 1;
          if (partFilesSeen > MAX_SPLIT_PART_COUNT) {
            setStatus(
              getMessageWithSubstitutions(
                'encryptedBackupSplitTooLarge',
                { detail: `selects more part files than the cap of ${MAX_SPLIT_PART_COUNT}` },
                'Split backup exceeds the size limit: {detail}',
              ),
              true,
            );
            resetInput();
            earlyAborted = true;
            break;
          }
        }
      }
      if (earlyAborted) return;

      // 単一形式の判定を先に行う。分割ファイル群が単一輸入に紛れ込まない
      // ことと、単一形式の従来動作を試験で固定するための分岐順序。
      if (parsed.length === 1 && isEncryptedBackupFile(parsed[0])) {
        const envelope = parsed[0] as EncryptionEnvelope;

        // Envelope-length validation at the boundary (PBI 2026-11-06-02): reject
        // an envelope whose data field alone exceeds the BACKUP base64 cap
        // before the password prompt. This is the base64-text layer
        // (MAX_BACKUP_ENVELOPE_BASE64_LENGTH) — never the 64 MiB binary
        // ciphertext cap, which measures decoded bytes and is a different layer.
        // An over-cap file is reported as too large (cause-identifying), not as
        // an invalid file, and decryption is never attempted (VULN-036 order:
        // file size -> shape -> envelope length -> KDF/auth decrypt).
        if (envelope.data.length > MAX_BACKUP_ENVELOPE_BASE64_LENGTH) {
          setStatus(getMessageOr('encryptedBackupFileTooLarge', 'Backup file is too large'), true);
          resetInput();
          return;
        }

        showPasswordAuthModal('import', async (password: string) => {
          if (importInFlight) return;
          importInFlight = true;
          try {
            await withBusyButton(importBtn as HTMLButtonElement, async () => {
              const startedAt = Date.now();
              const result = await importEncryptedBackup(envelope, password, reportImportStage('import', startedAt));
              applyImportResult(result);
            });
          } finally {
            importInFlight = false;
          }
        });
        resetInput();
        return;
      }

      // 単一ファイルの分割コンテナ（PBI01 形式そのまま）を直接受ける退路。
      if (parsed.length === 1 && isEncryptedSplitBackupFile(parsed[0])) {
        const container = parsed[0];
        if (container.parts.length > MAX_SPLIT_PART_COUNT) {
          setStatus(
            getMessageWithSubstitutions(
              'encryptedBackupSplitTooLarge',
              { detail: `declares ${container.parts.length} parts, above the cap of ${MAX_SPLIT_PART_COUNT}` },
              'Split backup exceeds the size limit: {detail}',
            ),
            true,
          );
          resetInput();
          return;
        }

        showPasswordAuthModal('import', async (password: string) => {
          if (importInFlight) return;
          importInFlight = true;
          try {
            await withBusyButton(importBtn as HTMLButtonElement, async () => {
              const startedAt = Date.now();
              const result = await importEncryptedSplitBackup(container, password, reportImportStage('import-split', startedAt));
              applyImportResult(result);
            });
          } finally {
            importInFlight = false;
          }
        });
        resetInput();
        return;
      }

      // 分割形式: マニフェスト先行読み。形状で判別し、不足・順序誤り・
      // 上限超過はすべてパスワード入力（KDF）の前に案内する。
      const manifests = parsed.filter(isSplitManifestFile);
      const parts = parsed.filter(isSplitPartFile);
      const unrecognized = parsed.filter((item) => !isSplitManifestFile(item) && !isSplitPartFile(item));
      if (unrecognized.length > 0 || manifests.length === 0) {
        setStatus(
          unrecognized.length > 0
            ? getMessageOr('encryptedBackupInvalidFile', '不正なバックアップファイルです')
            : getMessageOr(
              'encryptedBackupSplitManifestMissing',
              'Select the manifest file together with all part files to restore the split backup',
            ),
          true,
        );
        resetInput();
        return;
      }
      if (manifests.length > 1) {
        setStatus(
          getMessageWithSubstitutions(
            'encryptedBackupSplitOrderError',
            { detail: 'more than one manifest file selected' },
            'Split backup parts are inconsistent: {detail}. Re-select the manifest and all part files.',
          ),
          true,
        );
        resetInput();
        return;
      }
      const manifestFile = manifests[0]!;
      if (!Number.isInteger(manifestFile.total) || manifestFile.total < 1) {
        setStatus(getMessageOr('encryptedBackupSplitInvalidManifest', 'The split backup manifest is invalid'), true);
        resetInput();
        return;
      }
      if (manifestFile.total > MAX_SPLIT_PART_COUNT) {
        setStatus(
          getMessageWithSubstitutions(
            'encryptedBackupSplitTooLarge',
            { detail: `declares ${manifestFile.total} parts, above the cap of ${MAX_SPLIT_PART_COUNT}` },
            'Split backup exceeds the size limit: {detail}',
          ),
          true,
        );
        resetInput();
        return;
      }
      if (!isEnvelopeWithinGenericCap(manifestFile.manifest)) {
        setStatus(
          getMessageWithSubstitutions(
            'encryptedBackupSplitTooLarge',
            { detail: 'manifest envelope exceeds the generic length limit' },
            'Split backup exceeds the size limit: {detail}',
          ),
          true,
        );
        resetInput();
        return;
      }
      // 順序誤り（total 不一致・範囲外・重複）は不足より先に報告し、
      // 原因特定できる文言に分ける。
      for (const [position, partFile] of parts.entries()) {
        if (partFile.total !== manifestFile.total) {
          setStatus(
            getMessageWithSubstitutions(
              'encryptedBackupSplitOrderError',
              { detail: `part file at position ${position} declares total ${partFile.total}, manifest declares ${manifestFile.total}` },
              'Split backup parts are inconsistent: {detail}. Re-select the manifest and all part files.',
            ),
            true,
          );
          resetInput();
          return;
        }
        if (partFile.index < 0 || partFile.index >= manifestFile.total) {
          setStatus(
            getMessageWithSubstitutions(
              'encryptedBackupSplitOrderError',
              { detail: `part file at position ${position} names out-of-range index ${partFile.index}` },
              'Split backup parts are inconsistent: {detail}. Re-select the manifest and all part files.',
            ),
            true,
          );
          resetInput();
          return;
        }
        if (!isEnvelopeWithinGenericCap(partFile.part)) {
          setStatus(
            getMessageWithSubstitutions(
              'encryptedBackupSplitTooLarge',
              { detail: `part file at position ${position} exceeds the generic length limit` },
              'Split backup exceeds the size limit: {detail}',
            ),
            true,
          );
          resetInput();
          return;
        }
      }
      const seen = new Set<number>();
      for (const partFile of parts) {
        if (seen.has(partFile.index)) {
          setStatus(
            getMessageWithSubstitutions(
              'encryptedBackupSplitOrderError',
              { detail: `part index ${partFile.index} appears more than once` },
              'Split backup parts are inconsistent: {detail}. Re-select the manifest and all part files.',
            ),
            true,
          );
          resetInput();
          return;
        }
        seen.add(partFile.index);
      }
      const missing = findMissingPartIndices(parts.map((p) => p.index), manifestFile.total);
      if (missing.length > 0) {
        setStatus(
          getMessageWithSubstitutions(
            'encryptedBackupSplitMissingParts',
            { missing: missing.join(', '), have: parts.length, total: manifestFile.total },
            'Split backup is missing part(s) {missing} ({have} of {total} selected). Select all part files before retrying.',
          ),
          true,
        );
        resetInput();
        return;
      }

      // 全パートがそろったので初めてパスワード入力へ進む。
      const orderedParts = [...parts].sort((a, b) => a.index - b.index).map((p) => p.part);
      const container: SplitBackupContainer = {
        kind: SPLIT_BACKUP_KIND,
        formatVersion: SPLIT_BACKUP_FORMAT_VERSION,
        manifest: manifestFile.manifest,
        parts: orderedParts,
      };
      showPasswordAuthModal('import', async (password: string) => {
        if (importInFlight) return;
        importInFlight = true;
        try {
          await withBusyButton(importBtn as HTMLButtonElement, async () => {
            const startedAt = Date.now();
            const result = await importEncryptedSplitBackup(container, password, reportImportStage('import-split', startedAt));
            applyImportResult(result);
          });
        } finally {
          importInFlight = false;
        }
      });
      resetInput();
    } catch (error) {
      setStatus(getMessageWithSubstitutions('encryptedBackupFileReadFailed', { error: errorMessage(error) }, 'ファイルの読み込みに失敗しました: {error}'), true);
    }

    if (importFileInput) importFileInput.value = '';
  });
}
