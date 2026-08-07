/**
 * settingsExportImportUiCore.ts
 * 設定エクスポート/インポートUIの共有ロジック
 *
 * popup/settingsExportImportUi.ts と dashboard/exportImport.ts に重複していた
 * エクスポート/インポートのUIオーケストレーションを集約する。
 * 各UIは DOM要素の参照・モーダル開閉・ステータス表示先の差異分（アダプター）のみを
 * ImportContext / ExportContext として提供する。
 */

import { getSettings } from './storage.js';
import type { Settings } from './storage.js';
import { errorMessage } from './errorUtils.js';
import { getMessage } from './i18n.js';
import {
  exportSettings,
  validateExportData,
  exportEncryptedSettings,
  importEncryptedSettings,
  saveEncryptedExportToFile,
  isEncryptedExport,
} from './settingsExportImport.js';
import type { ExportFileData, SettingsExportData } from './settingsExportImport.js';

/** マスターパスワード認証モーダルを開く関数の型 */
export type ShowPasswordAuthModal = (
  actionType: 'export' | 'import',
  action: (password: string) => Promise<void>
) => void;

export interface ImportContext {
  /** インポート完了後のリロード関数 */
  reloadFn: () => Promise<void>;
  /** ステータス表示関数 */
  showStatus: (message: string, type: 'success' | 'error') => void;
  /** インポートエラー時のログ記録（popupのみ指定） */
  logImportError?: (cause: string) => void;
  /** ドメイン設定再読み込み */
  loadDomainSettings?: () => Promise<void>;
  /** プライバシー設定再読み込み */
  loadPrivacySettings?: () => Promise<void>;
  /** コンテンツ設定再読み込み */
  loadContentSettings?: () => Promise<void>;
  /** 信頼設定再読み込み */
  loadTrustSettings?: () => Promise<void>;
  /** 汎用設定再読み込み（dashboard はカスタムイベントを発火） */
  loadGeneralSettings?: () => Promise<void>;
}

export interface ExportContext {
  /** ステータス表示関数 */
  showStatus: (message: string, type: 'success' | 'error') => void;
  /** エクスポートエラー時のログ記録（popupのみ指定） */
  logExportError?: (cause: string) => void;
}

/**
 * エクスポートボタンクリックハンドラ
 * マスターパスワード保護+暗号化エクスポート設定時は認証モーダル経由で暗号化エクスポートを行う。
 */
export async function handleExport(
  ctx: ExportContext,
  showPasswordAuthModal: ShowPasswordAuthModal
): Promise<void> {
  let settings: Settings;
  try {
    settings = await getSettings();
  } catch (error) {
    ctx.logExportError?.(errorMessage(error));
    ctx.showStatus(`${getMessage('exportError')}: ${errorMessage(error)}`, 'error');
    return;
  }

  const isMpEnabled = settings.mp_protection_enabled === true;
  const isMpEncryptOnExport = settings.mp_encrypt_on_export === true;

  if (isMpEnabled && isMpEncryptOnExport) {
    showPasswordAuthModal('export', async (password) => {
      try {
        const result = await exportEncryptedSettings(password);
        if (result.success && result.encryptedData) {
          await saveEncryptedExportToFile(result.encryptedData);
          ctx.showStatus(getMessage('settingsExported'), 'success');
        } else {
          ctx.showStatus(`${getMessage('exportError')}: ${result.error || 'Unknown error'}`, 'error');
        }
      } catch (error) {
        ctx.logExportError?.(errorMessage(error));
        ctx.showStatus(`${getMessage('exportError')}: ${errorMessage(error)}`, 'error');
      }
    });
  } else {
    try {
      await exportSettings();
      ctx.showStatus(getMessage('settingsExported'), 'success');
    } catch (error) {
      ctx.logExportError?.(errorMessage(error));
      ctx.showStatus(`${getMessage('exportError')}: ${errorMessage(error)}`, 'error');
    }
  }
}

/**
 * インポート結果の適用と画面リロード
 * 暗号化インポート・確認モーダルからの適用の両方で使用する。
 */
export async function applyImportedSettings(
  ctx: ImportContext,
  imported: Settings | null,
  failureMessage = 'Failed to apply settings'
): Promise<void> {
  if (imported) {
    ctx.showStatus(getMessage('settingsImported'), 'success');
    await ctx.reloadFn();
    if (ctx.loadDomainSettings) await ctx.loadDomainSettings();
    if (ctx.loadPrivacySettings) await ctx.loadPrivacySettings();
    if (ctx.loadContentSettings) await ctx.loadContentSettings();
    if (ctx.loadTrustSettings) await ctx.loadTrustSettings();
    if (ctx.loadGeneralSettings) await ctx.loadGeneralSettings();
  } else {
    ctx.showStatus(`${getMessage('importError')}: ${failureMessage}`, 'error');
  }
}

/**
 * ファイル入力 change ハンドラ
 * 暗号化ファイルはパスワード認証モーダル経由で即時インポートし、
 * 平文ファイルは検証後に onPlainFileValidated へ委譲する（プレビュー+確認は呼び出し側が担当）。
 */
export async function handleFileImport(
  file: File,
  ctx: ImportContext,
  showPasswordAuthModal: ShowPasswordAuthModal,
  onPlainFileValidated: (data: SettingsExportData, jsonText: string) => void
): Promise<void> {
  let text: string;
  try {
    text = await file.text();
  } catch (error) {
    ctx.logImportError?.(errorMessage(error));
    ctx.showStatus(`${getMessage('importError')}: ${errorMessage(error)}`, 'error');
    return;
  }

  let parsed: ExportFileData;
  try {
    parsed = JSON.parse(text) as ExportFileData;
  } catch (error) {
    ctx.logImportError?.(errorMessage(error));
    ctx.showStatus(`${getMessage('importError')}: ${errorMessage(error)}`, 'error');
    return;
  }

  if (isEncryptedExport(parsed)) {
    let requirePasswordOnImport = true;
    try {
      const settings = await getSettings();
      requirePasswordOnImport = settings.mp_require_on_import === true;
    } catch (error) {
      ctx.logImportError?.(errorMessage(error));
      ctx.showStatus(`${getMessage('importError')}: ${errorMessage(error)}`, 'error');
      return;
    }

    const handleEncryptedImport = async (password: string): Promise<void> => {
      try {
        const imported = await importEncryptedSettings(text, password);
        await applyImportedSettings(ctx, imported, 'Failed to decrypt or apply settings');
      } catch (error) {
        ctx.logImportError?.(errorMessage(error));
        ctx.showStatus(`${getMessage('importError')}: ${errorMessage(error)}`, 'error');
      }
    };

    if (requirePasswordOnImport) {
      showPasswordAuthModal('import', handleEncryptedImport);
    } else {
      const warningMsg =
        getMessage('importPasswordRequired') || 'Master password is required to import encrypted settings.';
      if (confirm(warningMsg)) {
        showPasswordAuthModal('import', handleEncryptedImport);
      }
    }
    return;
  }

  if (!validateExportData(parsed)) {
    ctx.showStatus(getMessage('invalidSettingsFile'), 'error');
    return;
  }

  onPlainFileValidated(parsed, text);
}
