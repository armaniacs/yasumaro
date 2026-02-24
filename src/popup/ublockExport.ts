/**
 * @file src/popup/ublockExport.ts
 * uBlockエクスポートUIロジック
 */

import { StorageKeys, getSettings } from '../utils/storage.js';
import { addLog, LogType } from '../utils/logger.js';
import { showStatus } from './settingsUiHelper.js';

interface UblockRule {
  rawLine: string;
}

interface UblockRules {
  blockRules: UblockRule[];
  exceptionRules: UblockRule[];
}

/**
 * uBlockルールをテキスト形式でエクスポート
 * @param {UblockRules} rules - ルールセット
 * @returns {string} uBlock形式テキスト
 */
export function exportToText(rules: UblockRules): string {
  const lines: string[] = [];

  // メタデータ
  lines.push(`! Auto-exported from Obsidian Weave`);
  lines.push(`! Exported at: ${new Date().toISOString()}`);
  lines.push(`! Total rules: ${rules.blockRules.length + rules.exceptionRules.length}`);
  lines.push('');

  // 例外ルール
  rules.exceptionRules.forEach(rule => {
    lines.push(rule.rawLine);
  });

  // ブロックルール
  rules.blockRules.forEach(rule => {
    lines.push(rule.rawLine);
  });

  return lines.join('\n');
}

/**
 * uBlockルールを .txt ファイルとしてダウンロード
 * @param {UblockRules} rules - ルールセット
 * @param {string} [filename] - ファイル名
 */
export function downloadAsFile(rules: UblockRules, filename: string = 'ublock-filters.txt'): void {
  const text = exportToText(rules);
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * uBlockルールをクリップボードにコピー
 * @param {UblockRules} rules - ルールセット
 * @returns {Promise<boolean>}
 */
export async function copyToClipboard(rules: UblockRules): Promise<boolean> {
  const text = exportToText(rules);
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (error: any) {
    addLog(LogType.ERROR, 'クリップボードコピー失敗', { error: error.message });
    return false;
  }
}

/**
 * エクスポートUIの初期化
 */
export function init(): void {
  const exportBtn = document.getElementById('uBlockExportBtn');
  const copyBtn = document.getElementById('uBlockCopyBtn');

  if (exportBtn) {
    exportBtn.addEventListener('click', handleExport);
  }

  if (copyBtn) {
    copyBtn.addEventListener('click', handleCopy);
  }
}

/**
 * エクスポート処理
 */
async function handleExport(): Promise<void> {
  try {
    const settings = await getSettings();
    const rules = settings[StorageKeys.UBLOCK_RULES] as unknown as UblockRules;

    if (!rules) {
      showStatus('domainStatus', 'エクスポートするルールがありません', 'error');
      return;
    }

    downloadAsFile(rules);
    showStatus('domainStatus', 'エクスポートしました', 'success');
  } catch (error: any) {
    addLog(LogType.ERROR, 'エクスポートエラー', { error: error.message });
    showStatus('domainStatus', `エクスポートエラー: ${error.message}`, 'error');
  }
}

/**
 * コピー処理
 */
async function handleCopy(): Promise<void> {
  try {
    const settings = await getSettings();
    const rules = settings[StorageKeys.UBLOCK_RULES] as unknown as UblockRules;

    if (!rules) {
      showStatus('domainStatus', 'コピーするルールがありません', 'error');
      return;
    }

    const success = await copyToClipboard(rules);
    if (success) {
      showStatus('domainStatus', 'クリップボードにコピーしました', 'success');
    } else {
      showStatus('domainStatus', 'コピーに失敗しました', 'error');
    }
  } catch (error: any) {
    addLog(LogType.ERROR, 'コピーエラー', { error: error.message });
    showStatus('domainStatus', `コピーエラー: ${error.message}`, 'error');
  }
}

