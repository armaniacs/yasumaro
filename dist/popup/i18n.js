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
    if (!message)
        return "";
    if (substitutions && typeof substitutions === 'object' && !Array.isArray(substitutions)) {
        // Handle named substitutions (e.g. {count: 5})
        return message.replace(/\{(\w+)\}/g, (match, p1) => {
            return substitutions[p1] !== undefined ? substitutions[p1] : match;
        });
    }
    // Handle array substitutions which chrome.i18n supports natively but wrapper might want strict control
    if (Array.isArray(substitutions)) {
        // Re-fetch with substitutions if array provided, though chrome.i18n.getMessage(key, substitutions) works.
        // But here we already fetched message without substitutions.
        // Actually chrome.i18n.getMessage(key, substitutions) is standard.
        return chrome.i18n.getMessage(key, substitutions) || "";
    }
    return message;
}
// getUserLocaleとisRTLをlocaleUtilsから再エクスポート
import { getUserLocale, isRTL } from '../utils/localeUtils.js';
export { getUserLocale, isRTL };
/**
 * オプション要素の翻訳（selectタグ内のoption）
 */
function translateOptions(element = document.body) {
    const selectElements = element.querySelectorAll('select');
    selectElements.forEach(select => {
        select.querySelectorAll('option[data-i18n-opt]').forEach(option => {
            const opt = option;
            const key = opt.getAttribute('data-i18n-opt');
            if (key) {
                opt.text = getMessage(key);
            }
        });
    });
}
/**
 * ボタンのラベル属性を翻訳
 */
function translateButtonLabels(element = document.body) {
    const buttons = element.querySelectorAll('[data-i18n-label]');
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
function translateHelpText(element = document.body) {
    const helpTexts = element.querySelectorAll('.help-text[data-i18n]');
    helpTexts.forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (key) {
            el.textContent = getMessage(key);
        }
    });
}
/**
 * HTML要素にdata-i18n属性があれば翻訳を適用
 * @param {HTMLElement | Document} element - 対象の要素（オプション、省略時はdocument）
 */
export function applyI18n(element = document) {
    const rootElement = element instanceof Document ? document.body : element;
    const elements = rootElement.querySelectorAll('[data-i18n]');
    elements.forEach(el => {
        const htmlEl = el;
        const key = htmlEl.getAttribute('data-i18n');
        if (!key)
            return;
        const substitutions = htmlEl.getAttribute('data-i18n-args');
        let args = null;
        if (substitutions) {
            try {
                args = JSON.parse(substitutions);
            }
            catch (e) {
                // 不正なJSONは無視
            }
        }
        const translatedText = getMessage(key, args);
        if (htmlEl.tagName === 'INPUT' || htmlEl.tagName === 'TEXTAREA') {
            // 入力要素のプレースホルダー
            htmlEl.placeholder = translatedText;
        }
        else if (htmlEl.tagName === 'IMG') {
            // 画像要素のツールチップ
            htmlEl.title = translatedText;
        }
        else {
            // 通常のテキスト要素
            htmlEl.textContent = translatedText;
        }
    });
    // data-i18n-input-placeholder 属性を持つ要素のプレースホルダーを翻訳
    const placeholderElements = rootElement.querySelectorAll('[data-i18n-input-placeholder]');
    placeholderElements.forEach(el => {
        const htmlEl = el;
        const key = htmlEl.getAttribute('data-i18n-input-placeholder');
        if (key) { // Check if key exists
            const substitutions = htmlEl.getAttribute('data-i18n-args');
            const args = substitutions ? JSON.parse(substitutions) : null;
            htmlEl.placeholder = getMessage(key, args);
        }
    });
    // aria-label属性の翻訳
    const ariaLabelElements = rootElement.querySelectorAll('[data-i18n-aria-label]');
    ariaLabelElements.forEach(el => {
        const key = el.getAttribute('data-i18n-aria-label');
        if (key) {
            el.setAttribute('aria-label', getMessage(key));
        }
    });
    // オプション要素の翻訳
    translateOptions(rootElement);
    // ボタンのラベル属性を翻訳
    translateButtonLabels(rootElement);
    // ヘルプテキストを翻訳
    translateHelpText(rootElement);
}
/**
 * ページのタイトルを翻訳
 * @param {string} key - 翻訳キー
 */
export function translatePageTitle(key) {
    document.title = getMessage(key);
}
/**
 * HTMLのlang属性とdir属性を動的に設定します
 * ユーザーロケールを取得し、それに応じてlang属性と RTL/LTR のdir属性を設定します
 *
 * [用途] ページ読み込み時に呼び出して、ページ全体の言語とテキスト方向を設定
 *
 * @see getUserLocale - ユーザーロケールを取得する関数
 * @see isRTL - RTL言語かどうかを判定する関数
 */
export function setHtmlLangAndDir() {
    const locale = getUserLocale();
    const htmlElement = document.documentElement;
    // lang属性を設定
    htmlElement.lang = locale;
    // dir属性を設定（RTL言語の場合は'rtl'、それ以外は'ltr'）
    htmlElement.dir = isRTL(locale) ? 'rtl' : 'ltr';
}
// DOMが読み込まれたら自動的に翻訳を適用（埋め込みスクリプト用）
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        setHtmlLangAndDir();
        applyI18n();
    });
}
else {
    // If document is already loaded, apply i18n immediately
    // But we need to make sure applyI18n is available when imported as module
    // This side-effect might be undesirable if imported.
    // We can leave it for now as it was in original JS.
    setHtmlLangAndDir();
    applyI18n();
}
//# sourceMappingURL=i18n.js.map