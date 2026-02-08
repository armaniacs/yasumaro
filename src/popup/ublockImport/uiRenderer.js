/**
 * uiRenderer.js
 * uBlockインポートモジュール - UI操作機能
 */

import { isValidUrl } from './validation.js';
import { previewUblockFilter } from './rulesBuilder.js';
import { getMessage } from '../i18n.js';

/**
 * ソースリストをUIに描画
 * @param {Array} sources - ソースリスト
 * @param {Function} deleteCallback - 削除コールバック
 * @param {Function} reloadCallback - 再読み込みコールバック
 */
export function renderSourceList(sources, deleteCallback, reloadCallback) {
  const container = document.getElementById('uBlockSourceItems');
  const noSourcesMsg = document.getElementById('uBlockNoSources');

  if (!container || !noSourcesMsg) return;

  container.innerHTML = '';

  if (sources.length === 0) {
    noSourcesMsg.style.display = 'block';
    return;
  }

  noSourcesMsg.style.display = 'none';

  sources.forEach((source, index) => {
    const item = createSourceItem(source, index);
    container.appendChild(item);
  });

  // イベントリスナーを設定
  container.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', (event) => {
      const index = parseInt(event.target.dataset.index, 10);
      if (deleteCallback) deleteCallback(index);
    });
  });

  container.querySelectorAll('.reload-btn').forEach(btn => {
    btn.addEventListener('click', (event) => {
      const index = parseInt(event.target.dataset.index, 10);
      if (reloadCallback) reloadCallback(index);
    });
  });
}

/**
 * ソースアイテム要素を作成
 * @param {Object} source - ソースデータ
 * @param {number} index - ソースインデックス
 * @returns {HTMLElement} ソースアイテム要素
 */
function createSourceItem(source, index) {
  const item = document.createElement('div');
  item.className = 'source-item';
  item.dataset.index = index;

  const urlText = source.url === 'manual' ? getMessage('manualInput') : source.url;
  const isUrl = source.url !== 'manual';

  // XSS対策: textContentを使用
  const urlElement = document.createElement(isUrl ? 'a' : 'span');
  urlElement.className = 'source-url';
  urlElement.textContent = urlText;
  if (isUrl && isValidUrl(source.url)) {
    urlElement.href = source.url;
    urlElement.target = '_blank';
    urlElement.rel = 'noopener noreferrer';
  }

  const date = new Date(source.importedAt);
  const dateStr = date.toLocaleString(navigator.language || 'en-US');

  const metaDiv = document.createElement('div');
  metaDiv.className = 'source-meta';

  const metaSpan = document.createElement('span');
  metaSpan.textContent = `${dateStr} | ${getMessage('rulesLabel')}: ${source.ruleCount}`;

  const actionDiv = document.createElement('div');

  if (isUrl) {
    const reloadBtn = createActionButton('reload-btn', getMessage('reload'), getMessage('reload'), index);
    actionDiv.appendChild(reloadBtn);
  }

  const deleteBtn = createActionButton('delete-btn', getMessage('delete'), getMessage('delete'), index);
  actionDiv.appendChild(deleteBtn);

  metaDiv.appendChild(metaSpan);
  metaDiv.appendChild(actionDiv);

  item.appendChild(urlElement);
  item.appendChild(metaDiv);

  return item;
}

/**
 * アクションボタン要素を作成
 * @param {string} className - CSSクラス名
 * @param {string} text - ボタンテキスト
 * @param {string} title - ツールチップ
 * @param {number} index - インデックス
 * @returns {HTMLElement} ボタン要素
 */
function createActionButton(className, text, title, index) {
  const btn = document.createElement('button');
  btn.className = className;
  btn.dataset.index = index;
  btn.textContent = text;
  btn.title = title;
  return btn;
}

/**
 * プレビューUI更新
 * @param {Object|string} result - プレビュー結果またはエラーメッセージ
 */
export function updatePreviewUI(result) {
  const previewElement = document.getElementById('uBlockPreview');

  if (typeof result === 'string') {
    // エラーメッセージの場合
    document.getElementById('uBlockRuleCount').textContent = '0';
    document.getElementById('uBlockExceptionCount').textContent = '0';
    document.getElementById('uBlockErrorCount').textContent = '1';
    document.getElementById('uBlockErrorDetails').textContent = result;
  } else {
    // プレビュー結果の場合
    const ruleCountEl = document.getElementById('uBlockRuleCount');
    const exceptionCountEl = document.getElementById('uBlockExceptionCount');
    const errorCountEl = document.getElementById('uBlockErrorCount');

    ruleCountEl.textContent = result.blockCount;
    exceptionCountEl.textContent = result.exceptionCount;
    errorCountEl.textContent = result.errorCount;

    // i18nラベルspanのdata属性を更新して翻訳を再適用
    const labelPairs = [
      [ruleCountEl, 'ruleCount', result.blockCount],
      [exceptionCountEl, 'exceptionCount', result.exceptionCount],
      [errorCountEl, 'errorCount', result.errorCount],
    ];
    labelPairs.forEach(([el, key, count]) => {
      const labelSpan = el.parentElement?.querySelector(`[data-i18n="${key}"]`);
      if (labelSpan) {
        labelSpan.setAttribute('data-i18n-args', JSON.stringify({ count }));
        labelSpan.textContent = getMessage(key, { count });
      }
    });

    const errorDetailsElement = document.getElementById('uBlockErrorDetails');
    if (Array.isArray(result.errorDetails)) {
      const errorTexts = result.errorDetails.map(e => {
        if (typeof e === 'string') return e;
        // エラーオブジェクトの場合、行番号、メッセージ、実際の行内容を表示
        const lineInfo = `${e.lineNumber}: ${e.message}`;
        const lineContent = e.line ? `\n  → ${e.line}` : '';
        return lineInfo + lineContent;
      });
      errorDetailsElement.textContent = errorTexts.join('\n');
    } else {
      errorDetailsElement.textContent = result.errorDetails;
    }
  }

  previewElement.style.display = 'block';
}

/**
 * プレビューを非表示にする
 */
export function hidePreview() {
  const preview = document.getElementById('uBlockPreview');
  if (preview) {
    preview.style.display = 'none';
  }
}

/**
 * 入力エリアのテキストをクリア
 */
export function clearInput() {
  const textarea = document.getElementById('uBlockFilterInput');
  if (textarea) {
    textarea.value = '';
  }
}

/**
 * ドメインリストをシンプル形式でエクスポート
 * @param {Array} sources - ソースリスト
 */
export function exportSimpleFormat(sources) {
  const domains = [];
  sources.forEach(source => {
    if (source.blockDomains && Array.isArray(source.blockDomains)) {
      source.blockDomains.forEach(domain => {
        if (!domains.includes(domain)) {
          domains.push(domain);
        }
      });
    }
  });
  return domains.join('\n');
}

/**
 * uBlock形式のテキストをクリップボードにコピー
 */
export function copyToClipboard(text) {
  return navigator.clipboard.writeText(text).then(() => {
    return true;
  }).catch(err => {
    throw new Error(getMessage('clipboardCopyFailed'));
  });
}

/**
 * ドメインリストをuBlock形式で構築
 * @param {Array} sources - ソースリスト
 */
export function buildUblockFormat(sources) {
  const lines = [];
  lines.push(getMessage('generatedBy'));
  lines.push('');
  sources.forEach(source => {
    if (source.blockDomains && Array.isArray(source.blockDomains)) {
      source.blockDomains.forEach(domain => {
        lines.push(`||${domain}^`);
      });
    }
    if (source.exceptionDomains && Array.isArray(source.exceptionDomains)) {
      source.exceptionDomains.forEach(domain => {
        lines.push(`@@||${domain}^`);
      });
    }
  });
  return lines.join('\n');
}