/**
 * sanitizePreview.js
 * PII Sanitization Preview UI Logic
 * UF-401: マスク情報の可視化機能 - Refactorフェーズ実装
 *
 * 【実装方針】TDD Greenフェーズ対応 - モジュール読み込み時のDOMアクセスを回避
 * 🟡 黄信号: テスト環境でのDOMモック問題を解決するための実装変更
 * 🟢 青信号: Refactorフェーズ対応 - 定数化・JSDoc充実化・関数分割実装
 */

import { getMessage } from './i18n.js';

const DOM_IDS = {
  MODAL: 'confirmationModal',
  PREVIEW_CONTENT: 'previewContent',
  MASK_STATUS_MESSAGE: 'maskStatusMessage',
};

const CLASS_NAMES = {
  MASK_STATUS_MESSAGE: 'mask-status-message',
};

const PII_TYPE_LABELS = {
  creditCard: () => getMessage('piiCreditCard'),
  myNumber: () => getMessage('piiMyNumber'),
  bankAccount: () => getMessage('piiBankAccount'),
  email: () => getMessage('piiEmail'),
  phoneJp: () => getMessage('piiPhoneJp'),
};

let resolvePromise = null;
let maskedPositions = [];
let currentMaskedIndex = -1;
let previousActiveElement = null;  // モーダル開く前のフォーカス要素

// PERF-007修正: ResizeObserverをモジュールレベルで保持し、メモリリークを防止
let resizeObserver = null;
let modalEventListenersAttached = false;

/**
 * DOM要素取得ヘルパー関数
 * 【機能概要】: 指定されたIDを持つDOM要素を取得する
 * 【実装方針】: 遅延評価アプローチにより、モジュール読み込み時のDOMアクセスを回避
 * 【テスト対応】: jest.resetModules()を使用するテスト環境でのDOMモック問題を解決
 */
function getModal() {
  return document.getElementById(DOM_IDS.MODAL);
}

function getPreviewContent() {
  return document.getElementById(DOM_IDS.PREVIEW_CONTENT);
}

function getMaskStatusMessage() {
  return document.getElementById(DOM_IDS.MASK_STATUS_MESSAGE);
}

/**
 * イベントリスナー初期化関数
 * 【機能概要】: プレビューモーダルのイベントリスナーを設定する
 *
 * 【PERF-007修正】ResizeObserverのメモリリーク防止:
 * - 既存のResizeObserverをdisconnectしてから再作成
 * - イベントリスナーの二重登録を防止
 */
export function initializeModalEvents() {
  // PERF-007修正: 既存のResizeObserverをdisconnectしてメモリリークを防止
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }

  const modal = getModal();
  const closeModalBtn = document.getElementById('closeModalBtn');
  const cancelBtn = document.getElementById('cancelPreviewBtn');
  const confirmBtn = document.getElementById('confirmPreviewBtn');

  // PERF-007修正: イベントリスナーの二重登録を防止
  const shouldAttachListeners = !modalEventListenersAttached;

  if (modal && closeModalBtn && cancelBtn && confirmBtn && shouldAttachListeners) {
    closeModalBtn.addEventListener('click', () => handleAction(false));
    cancelBtn.addEventListener('click', () => handleAction(false));
    confirmBtn.addEventListener('click', () => handleAction(true));
    modalEventListenersAttached = true;
  }

  // PERF-007修正: textareaのリサイズに合わせてポップアップ幅を追従させる
  // ResizeObserverをモジュール変数に保存して管理
  const previewContent = getPreviewContent();
  if (previewContent && typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => {
      const needed = previewContent.offsetWidth + 60; // padding + border分
      const minWidth = 320;
      document.body.style.width = Math.max(needed, minWidth) + 'px';
    });
    resizeObserver.observe(previewContent);
  }
}

/**
 * モーダルイベントリスナーをクリーンアップ
 * 【機能概要】: 初期化されたイベントリスナーとResizeObserverを解放する
 * 【PERF-007対応】メモリリーク防止のためのクリーンアップ関数
 */
export function cleanupModalEvents() {
  // ResizeObserverを解放
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }

  // イベントリスナー管理フラグをリセット
  modalEventListenersAttached = false;
}

const DEFAULT_WIDTH = '320px';

function resetBodyWidth() {
  document.body.style.width = DEFAULT_WIDTH;
}

/**
 * フォーカストラップ実装
 * @param {HTMLElement} modal - モーダル要素
 */
function trapFocus(modal) {
  // Focusable要素セレクタ
  const focusableSelector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
  const focusableElements = modal.querySelectorAll(focusableSelector);
  const firstFocusable = focusableElements[0];
  const lastFocusable = focusableElements[focusableElements.length - 1];

  if (!firstFocusable || !lastFocusable) return;

  // フォーカストラップイベントリスナー
  const keydownHandler = (e) => {
    if (e.key === 'Escape') {
      handleAction(false);
      return;
    }
    if (e.key !== 'Tab') return;

    if (e.shiftKey) {  // Shift+Tab: 前へ
      if (document.activeElement === firstFocusable) {
        e.preventDefault();
        lastFocusable.focus();
      }
    } else {  // Tab: 次へ
      if (document.activeElement === lastFocusable) {
        e.preventDefault();
        firstFocusable.focus();
      }
    }
  };

  // イベントリスナー追加（モーダル限定）
  if (!modal.trapFocusHandler) {
    modal.trapFocusHandler = keydownHandler;
    modal.addEventListener('keydown', keydownHandler);
  }
}

/**
 * フォーカストラップの解放
 * @param {HTMLElement} modal - モーダル要素
 */
function releaseFocusTrap(modal) {
  if (modal && modal.trapFocusHandler) {
    modal.removeEventListener('keydown', modal.trapFocusHandler);
    modal.trapFocusHandler = null;
  }
}

/**
 * プレビューモーダルを表示し、マスクされた個人情報を可視化する
 * UF-401: マスク情報の可視化機能 - Refactorフェーズ実装（定数化・JSDoc・関数分割）
 */
export function showPreview(content, maskedItems = null, maskedCount = 0) {
  const modal = getModal();
  const previewContent = getPreviewContent();
  const modalBody = modal?.querySelector('.modal-body');

  if (!modal) {
    console.error('Confirmation modal not found in DOM');
    return Promise.resolve({ confirmed: true, content });
  }

  // ステータスメッセージ要素の取得または動的作成
  let maskStatusMessage = getMaskStatusMessage();
  if (!maskStatusMessage) {
    maskStatusMessage = document.createElement('div');
    maskStatusMessage.id = DOM_IDS.MASK_STATUS_MESSAGE;
    maskStatusMessage.className = CLASS_NAMES.MASK_STATUS_MESSAGE;
    if (modalBody) {
      modalBody.insertBefore(maskStatusMessage, modalBody.firstChild);
    }
  }

  if (maskedCount > 0) {
    maskStatusMessage.textContent = buildMaskStatusText(maskedItems, maskedCount);
    maskStatusMessage.style.display = '';
  } else {
    maskStatusMessage.textContent = '';
    maskStatusMessage.style.display = 'none';
  }

  // プレビューコンテンツの設定（プレーンテキストのまま表示）
  setPreviewContent(previewContent, content || '');

  // マスク位置を収集してナビゲーション構築
  maskedPositions = collectMaskedPositions(content || '');
  currentMaskedIndex = -1;
  const navAnchor = document.getElementById('maskNavAnchor');
  buildMaskNavigation(navAnchor || modalBody);

  // モーダル表示前にフォーカス要素を記憶
  previousActiveElement = document.activeElement;

  // モーダル表示（トランジション付き）
  modal.style.display = 'flex';
  // Force reflow for CSS transition
  void modal.offsetHeight;
  modal.classList.add('show');

  // フォーカストラップ設定
  trapFocus(modal);

  // マスク箇所がある場合、最初の箇所へ自動ジャンプ
  if (maskedPositions.length > 0) {
    jumpToMaskedPosition(0);
  } else {
    // マスク箇所がない場合はtextareaに直接フォーカス
    previewContent?.focus();
  }

  return new Promise((resolve) => {
    resolvePromise = resolve;
  });
}

/**
 * プレビューコンテンツの設定
 */
function setPreviewContent(previewContent, text) {
  if (!previewContent) {
    return;
  }
  previewContent.value = text;
}

/**
 * アクション処理ハンドラ
 * @param {boolean} confirmed - ユーザーが確認したかどうか
 */
function handleAction(confirmed) {
  if (!resolvePromise) {
    return;
  }

  const modal = getModal();
  const previewContent = getPreviewContent();

  // DOM検証
  if (!modal || !previewContent) {
    console.error('Modal or preview content not found in DOM');
    resolvePromise = null;
    return;
  }

  // フォーカストラップ解放
  releaseFocusTrap(modal);

  modal.classList.remove('show');
  modal.style.display = 'none';
  resetBodyWidth();
  const content = previewContent.value;

  // 元のフォーカス要素に戻る
  if (previousActiveElement) {
    previousActiveElement.focus();
  }

  resolvePromise({
    confirmed,
    content: confirmed ? content : null
  });

  resolvePromise = null;
}

/**
 * マスク種別ごとの件数をまとめたステータステキストを生成する
 */
function buildMaskStatusText(maskedItems, maskedCount) {
  if (!Array.isArray(maskedItems) || maskedItems.length === 0) {
    return getMessage('maskStatusCount', { count: maskedCount });
  }

  // 種別ごとに件数を集計
  const typeCounts = {};
  for (const item of maskedItems) {
    const labelFunction = PII_TYPE_LABELS[item.type];
    const label = labelFunction ? labelFunction() : item.type;
    typeCounts[label] = (typeCounts[label] || 0) + 1;
  }

  const itemsLabel = getMessage('items');
  const details = Object.entries(typeCounts)
    .map(([label, count]) => `${label}${getMessage('itemsCount', { count })}`)
    .join(getMessage('items'));

  return getMessage('maskStatusDetails', { details });
}

/**
 * textarea内の[MASKED:*]トークン位置を収集する
 */
function collectMaskedPositions(text) {
  const positions = [];
  const regex = /\[MASKED:\w+\]/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    positions.push({ start: match.index, end: match.index + match[0].length });
  }
  return positions;
}

/**
 * 指定インデックスのマスク箇所にtextareaをスクロール＋選択する
 */
function jumpToMaskedPosition(index) {
  const previewContent = getPreviewContent();
  if (!previewContent || maskedPositions.length === 0) return;

  currentMaskedIndex = index;
  const pos = maskedPositions[index];
  previewContent.focus();
  previewContent.setSelectionRange(pos.start, pos.end);

  // ナビカウンター更新
  const counter = document.getElementById('maskNavCounter');
  if (counter) {
    counter.textContent = `${index + 1}/${maskedPositions.length}`;
  }
}

/**
 * 次のマスク箇所へジャンプ
 */
export function jumpToNextMasked() {
  if (maskedPositions.length === 0) return;
  const next = (currentMaskedIndex + 1) % maskedPositions.length;
  jumpToMaskedPosition(next);
}

/**
 * 前のマスク箇所へジャンプ
 */
export function jumpToPrevMasked() {
  if (maskedPositions.length === 0) return;
  const prev = (currentMaskedIndex - 1 + maskedPositions.length) % maskedPositions.length;
  jumpToMaskedPosition(prev);
}

/**
 * マスクナビゲーションUIを構築・表示する
 */
function buildMaskNavigation(container) {
  let nav = document.getElementById('maskNav');
  if (!nav) {
    nav = document.createElement('div');
    nav.id = 'maskNav';
    nav.style.cssText = 'display:flex;align-items:center;gap:6px;margin-top:6px;';

    const prevBtn = document.createElement('button');
    prevBtn.id = 'maskNavPrev';
    prevBtn.textContent = '▲';
    prevBtn.title = getMessage('previousMaskedItem');
    prevBtn.style.cssText = 'padding:2px 8px;font-size:11px;cursor:pointer;background:#f5f5f5;border:1px solid #ccc;border-radius:3px;';
    prevBtn.addEventListener('click', jumpToPrevMasked);

    const nextBtn = document.createElement('button');
    nextBtn.id = 'maskNavNext';
    nextBtn.textContent = '▼';
    nextBtn.title = getMessage('nextMaskedItem');
    nextBtn.style.cssText = 'padding:2px 8px;font-size:11px;cursor:pointer;background:#f5f5f5;border:1px solid #ccc;border-radius:3px;';
    nextBtn.addEventListener('click', jumpToNextMasked);

    const counter = document.createElement('span');
    counter.id = 'maskNavCounter';
    counter.style.cssText = 'font-size:11px;color:#666;';

    nav.appendChild(prevBtn);
    nav.appendChild(nextBtn);
    nav.appendChild(counter);
    container.appendChild(nav);
  }

  if (maskedPositions.length > 0) {
    nav.style.display = 'flex';
    const counter = document.getElementById('maskNavCounter');
    if (counter) counter.textContent = `0/${maskedPositions.length}`;
  } else {
    nav.style.display = 'none';
  }
}

// Events are initialized via initializeModalEvents() called from main.js