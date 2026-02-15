/**
 * index.ts
 * uBlockインポートモジュール - メインエントリーポイント
 */

import { readFile } from './fileReader.js';
import { fetchFromUrl } from './urlFetcher.js';
import { isValidUrl } from './validation.js';
import { rebuildRulesFromSources, previewUblockFilter } from './rulesBuilder.js';
import { loadAndDisplaySources, deleteSource, reloadSource, saveUblockSettings } from './sourceManager.js';
import { renderSourceList, updatePreviewUI, hidePreview, clearInput, exportSimpleFormat, copyToClipboard, buildUblockFormat } from './uiRenderer.js';
import { showStatus } from '../settingsUiHelper.js';
import { LogType, addLog } from '../../utils/logger.js';
import { StorageKeys, getSettings, saveSettings } from '../../utils/storage.js';
import { getMessage } from '../i18n.js';

// グローバル状態
let dropZoneActive = false;
let currentSourceUrl: string | null = null;

/**
 * uBlockインポートUIを初期化
 */
export async function init(): Promise<void> {
  setupTextInputPreview();
  setupFileInput();
  setupDragAndDrop();
  setupUrlImport();
  setupExportButtons();

  // ソース一覧を読み込んで表示
  await loadAndDisplaySources((sources) => {
    renderSourceList(
      sources,
      handleDeleteSource,
      handleReloadSource
    );
  });
}

// ============================================================================
// テキスト入力プレビュー機能
// ============================================================================

/**
 * テキスト入力のプレビュー更新
 */
function setupTextInputPreview(): void {
  const textarea = document.getElementById('uBlockFilterInput');
  if (textarea) {
    textarea.addEventListener('input', handleTextInputPreview);
  }
}

/**
 * テキスト入力プレビュー処理
 */
function handleTextInputPreview(): void {
  const textarea = document.getElementById('uBlockFilterInput') as HTMLTextAreaElement | null;
  const text = textarea ? textarea.value : '';
  const result = previewUblockFilter(text);
  updatePreviewUI(result);
}

// ============================================================================
// ファイル入力機能
// ============================================================================

/**
 * ファイル入力の設定
 */
function setupFileInput(): void {
  const fileBtn = document.getElementById('uBlockFileSelectBtn');
  const fileInput = document.getElementById('uBlockFileInput');

  if (fileBtn && fileInput) {
    fileBtn.addEventListener('click', () => {
      fileInput.click();
    });

    fileInput.addEventListener('change', handleFileSelect as EventListener);
  }
}

/**
 * ファイル選択処理
 */
async function handleFileSelect(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;

  try {
    const text = await readFile(file);
    const textarea = document.getElementById('uBlockFilterInput') as HTMLTextAreaElement | null;
    if (textarea) textarea.value = text;
    currentSourceUrl = null;
    handleTextInputPreview();
    showStatus('domainStatus', getMessage('fileLoaded', { filename: file.name }), 'success');
  } catch (error: any) {
    showStatus('domainStatus', `${getMessage('fileReadError')}: ${error.message}`, 'error');
  }
}

// ============================================================================
// URLインポート機能
// ============================================================================

/**
 * URLインポート機能の初期化
 */
function setupUrlImport(): void {
  const urlImportBtn = document.getElementById('uBlockUrlImportBtn');
  if (urlImportBtn) {
    urlImportBtn.addEventListener('click', handleUrlImport);
  }
}

// ============================================================================
// エクスポート・コピー機能
// ============================================================================

/**
 * エクスポートボタンとコピーボタンを設定
 */
function setupExportButtons(): void {
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
    const sources = settings[StorageKeys.UBLOCK_SOURCES] || [];

    if (sources.length === 0) {
      showStatus('domainStatus', getMessage('nothingToExport'), 'error');
      return;
    }

    const simpleFormat = exportSimpleFormat(sources);
    const blob = new Blob([simpleFormat], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `domain-list-${Date.now()}.txt`;
    a.click();

    URL.revokeObjectURL(url);
    showStatus('domainStatus', getMessage('fileExported'), 'success');
  } catch (error: any) {
    showStatus('domainStatus', `${getMessage('exportError')}: ${error.message}`, 'error');
  }
}

/**
 * クリップボードにコピー処理
 */
async function handleCopy(): Promise<void> {
  try {
    const textarea = document.getElementById('uBlockFilterInput') as HTMLTextAreaElement | null;
    const text = textarea ? textarea.value : '';

    if (!text.trim()) {
      showStatus('domainStatus', getMessage('noTextToCopy'), 'error');
      return;
    }

    await copyToClipboard(text);
    showStatus('domainStatus', getMessage('copiedToClipboard'), 'success');
  } catch (error: any) {
    showStatus('domainStatus', `${getMessage('copyError')}: ${error.message}`, 'error');
  }
}

/**
 * URLインポートのイベントハンドラ
 */
async function handleUrlImport(): Promise<void> {
  const urlInput = document.getElementById('uBlockUrlInput') as HTMLInputElement | null;
  if (!urlInput) return;

  const url = urlInput.value.trim();

  if (!url) {
    showStatus('domainStatus', getMessage('loadEmptyUrl'), 'error');
    return;
  }

  const importBtn = document.getElementById('uBlockUrlImportBtn') as HTMLButtonElement | null;
  if (importBtn) {
    importBtn.textContent = getMessage('loadingUrl');
    importBtn.disabled = true;
  }

  try {
    const filterText = await fetchFromUrl(url);
    const textarea = document.getElementById('uBlockFilterInput') as HTMLTextAreaElement | null;
    if (textarea) textarea.value = filterText;
    currentSourceUrl = url;
    handleTextInputPreview();

    showStatus('domainStatus', getMessage('loadedFromUrl', { url }), 'success');
  } catch (error: any) {
    showStatus('domainStatus', error.message, 'error');
  } finally {
    if (importBtn) {
      importBtn.textContent = getMessage('importFromUrl');
      importBtn.disabled = false;
    }
  }
}

// ============================================================================
// ソース管理イベントハンドラ
// ============================================================================

/**
 * ソース削除ハンドラ
 */
async function handleDeleteSource(index: number): Promise<void> {
  try {
    await deleteSource(index, (sources) => {
      renderSourceList(
        sources,
        handleDeleteSource,
        handleReloadSource
      );
    });
  } catch (error: any) {
    showStatus('domainStatus', `${getMessage('deleteError')}: ${error.message}`, 'error');
  }
}

/**
 * ソース再読み込みハンドラ
 */
async function handleReloadSource(index: number): Promise<void> {
  const btn = document.querySelector(`.reload-btn[data-index="${index}"]`) as HTMLButtonElement | null;
  if (btn) {
    btn.disabled = true;
    btn.textContent = '...';
  }

  // Fetch current settings to get the old rule count
  const settings = await getSettings();
  const currentSources = settings[StorageKeys.UBLOCK_SOURCES] || [];
  const oldRuleCount = currentSources[index]?.ruleCount || 0;

  try {
    const { sources, ruleCount: newRuleCount } = await reloadSource(index, fetchFromUrl);

    renderSourceList(
      sources,
      handleDeleteSource,
      handleReloadSource
    );

    // Calculate difference
    const diff = newRuleCount - oldRuleCount;
    const diffStr = diff >= 0 ? `+${diff}` : `${diff}`;

    showStatus('domainStatus', getMessage('sourceUpdatedWithDiff', { ruleCount: newRuleCount, diff: diffStr }), 'success');
  } catch (error: any) {
    addLog(LogType.ERROR, getMessage('reloadError'), { error: error.message });
    showStatus('domainStatus', `${getMessage('reloadError')}: ${error.message}`, 'error');

    // Use preserved currentSources for button state reset
    renderSourceList(
      currentSources,
      handleDeleteSource,
      handleReloadSource
    );
  }
}

/**
 * uBlock設定の保存メインハンドラ
 * UIの状態を確認し、必要に応じて実際の保存処理を呼び出す
 */
async function handleSaveUblockSettings(): Promise<void> {
  const checkbox = document.getElementById('ublockFormatEnabled') as HTMLInputElement | null;
  const ublockEnabled = checkbox ? checkbox.checked : false;

  // 1. uBlock形式が無効な場合
  if (!ublockEnabled) {
    await saveSettings({ [StorageKeys.UBLOCK_FORMAT_ENABLED]: false });
    return;
  }

  // 2. uBlock形式が有効だが入力が空の場合
  const textarea = document.getElementById('uBlockFilterInput') as HTMLTextAreaElement | null;
  const text = textarea ? textarea.value.trim() : '';

  if (!text) {
    // 入力が空でも「有効化フラグ」だけは保存する（既存のソースは維持される）
    await saveSettings({ [StorageKeys.UBLOCK_FORMAT_ENABLED]: true });
    return;
  }

  // 3. 入力がある場合、新規ソースとして保存/更新
  try {
    const { sources, action, ruleCount } = await saveUblockSettings(text, currentSourceUrl);

    renderSourceList(
      sources,
      handleDeleteSource,
      handleReloadSource
    );

    clearInput();
    hidePreview();
    currentSourceUrl = null;
  } catch (error) {
    // エラーメッセージは saveUblockSettings 内で表示済み
    throw error;
  }
}

// ============================================================================
// ドラッグ&ドロップ機能
// ============================================================================

/**
 * ドラッグ&ドロップの設定
 */
export function setupDragAndDrop(): void {
  const dropZone = document.getElementById('uBlockDropZone');
  const textarea = document.getElementById('uBlockFilterInput');
  const uBlockFormatUI = document.getElementById('uBlockFormatUI');

  if (!dropZone || !textarea || !uBlockFormatUI) return;

  textarea.addEventListener('dragover', (event) => {
    event.preventDefault();
    if (!dropZoneActive) {
      dropZone.style.display = 'block';
      dropZone.classList.add('active');
      dropZoneActive = true;
    }
  });

  uBlockFormatUI.addEventListener('dragleave', (event: DragEvent) => {
    if (dropZoneActive && !isElementInDropZone(event.relatedTarget as HTMLElement, dropZone)) {
      dropZone.classList.remove('active');
      dropZone.style.display = 'none';
      dropZoneActive = false;
    }
  });

  dropZone.addEventListener('drop', handleDrop);
}

/**
 * ドロップ処理
 */
function handleDrop(event: DragEvent): void {
  event.preventDefault();
  const dropZone = document.getElementById('uBlockDropZone');
  if (dropZone) {
    dropZone.classList.remove('active');
    dropZone.style.display = 'none';
  }
  dropZoneActive = false;

  const file = event.dataTransfer?.files[0];
  if (file && file.type === 'text/plain') {
    processFile(file);
  } else {
    showStatus('domainStatus', getMessage('textFileOnly'), 'error');
  }
}

/**
 * ファイル処理
 */
async function processFile(file: File): Promise<void> {
  try {
    const text = await readFile(file);
    const textarea = document.getElementById('uBlockFilterInput') as HTMLTextAreaElement | null;
    if (textarea) textarea.value = text;
    currentSourceUrl = null;
    handleTextInputPreview();
    showStatus('domainStatus', getMessage('fileLoaded', { filename: file.name }), 'success');
  } catch (error: any) {
    showStatus('domainStatus', `${getMessage('fileReadError')}: ${error.message}`, 'error');
  }
}

/**
 * 要素がドロップゾーン内にあるかどうかをチェック
 */
function isElementInDropZone(element: HTMLElement | null, dropZone: HTMLElement): boolean {
  while (element) {
    if (element === dropZone) {
      return true;
    }
    element = element.parentElement;
  }
  return false;
}

// ============================================================================
// Public API
// ============================================================================

// エクスポート（テスト用など）
export {
  isValidUrl,
  rebuildRulesFromSources,
  previewUblockFilter,
  fetchFromUrl,
  readFile,
  renderSourceList,
  updatePreviewUI,
  hidePreview,
  clearInput,
  loadAndDisplaySources,
  deleteSource,
  reloadSource,
  saveUblockSettings,
  handleSaveUblockSettings
};
