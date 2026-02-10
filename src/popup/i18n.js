/**
 * i18nヘルパー
 * Chrome Extensionのi18n APIを使用して翻訳を適用する
 */

/**
 * 単一の翻訳キーから翻訳文字列を取得
 * @param {string} key - 翻訳キー
 * @param {Object} substitutions - 置換パラメータ（オプション）
 * @returns {string} 翻訳された文字列
 */
export function getMessage(key, substitutions = null) {
  const message = chrome.i18n.getMessage(key);
  if (!message) return "";

  if (substitutions && typeof substitutions === 'object' && !Array.isArray(substitutions)) {
    // Handle named substitutions (e.g. {count: 5})
    return message.replace(/\{(\w+)\}/g, (match, p1) => {
      return substitutions[p1] !== undefined ? substitutions[p1] : match;
    });
  }

  return message;
}

// getUserLocaleをlocaleUtilsから再エクスポート
import { getUserLocale } from '../utils/localeUtils.js';
export { getUserLocale };

/**
 * オプション要素の翻訳（selectタグ内のoption）
 */
function translateOptions() {
  const selectElements = document.querySelectorAll('select');
  selectElements.forEach(select => {
    select.querySelectorAll('option[data-i18n-opt]').forEach(option => {
      const key = option.getAttribute('data-i18n-opt');
      if (key) {
        option.text = getMessage(key);
      }
    });
  });
}

/**
 * ボタンのラベル属性を翻訳
 */
function translateButtonLabels() {
  const buttons = document.querySelectorAll('[data-i18n-label]');
  buttons.forEach(button => {
    const key = button.getAttribute('data-i18n-label');
    if (key) {
      button.textContent = getMessage(key);
    }
  });
}

/**
 * ヘルプテキスト（改行を含む）を翻訳
 * CSSの white-space: pre-line で改行を表示するため textContent を使用
 */
function translateHelpText() {
  const helpTexts = document.querySelectorAll('.help-text[data-i18n]');
  helpTexts.forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (key) {
      el.textContent = getMessage(key);
    }
  });
}

/**
 * HTML要素にdata-i18n属性があれば翻訳を適用
 * @param {HTMLElement} element - 対象の要素（オプション、省略時はdocument）
 */
export function applyI18n(element = document) {
  const elements = element.querySelectorAll('[data-i18n]');
  elements.forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (!key) return;

    const substitutions = el.getAttribute('data-i18n-args');
    let args = null;
    if (substitutions) {
      try {
        args = JSON.parse(substitutions);
      } catch (e) {
        // 不正なJSONは無視
      }
    }

    const translatedText = getMessage(key, args);

    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      // 入力要素のプレースホルダー
      el.placeholder = translatedText;
    } else if (el.tagName === 'IMG') {
      // 画像要素のツールチップ
      el.title = translatedText;
    } else {
      // 通常のテキスト要素
      el.textContent = translatedText;
    }
  });

  // data-i18n-input-placeholder 属性を持つ要素のプレースホルダーを翻訳
  const placeholderElements = element.querySelectorAll('[data-i18n-input-placeholder]');
  placeholderElements.forEach(el => {
    const key = el.getAttribute('data-i18n-input-placeholder');
    const substitutions = el.getAttribute('data-i18n-args');
    const args = substitutions ? JSON.parse(substitutions) : null;
    el.placeholder = getMessage(key, args);
  });

  // aria-label属性の翻訳
  const ariaLabelElements = element.querySelectorAll('[data-i18n-aria-label]');
  ariaLabelElements.forEach(el => {
    const key = el.getAttribute('data-i18n-aria-label');
    if (key) {
      el.setAttribute('aria-label', getMessage(key));
    }
  });

  // オプション要素の翻訳
  translateOptions();

  // ボタンのラベル属性を翻訳
  translateButtonLabels();

  // ヘルプテキストを翻訳
  translateHelpText();
}

/**
 * ページのタイトルを翻訳
 * @param {string} key - 翻訳キー
 */
export function translatePageTitle(key) {
  document.title = getMessage(key);
}

// DOMが読み込まれたら自動的に翻訳を適用（埋め込みスクリプト用）
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    applyI18n();
  });
} else {
  applyI18n();
}