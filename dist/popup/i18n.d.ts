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
export declare function getMessage(key: string, substitutions?: any): string;
import { getUserLocale } from '../utils/localeUtils.js';
export { getUserLocale };
/**
 * HTML要素にdata-i18n属性があれば翻訳を適用
 * @param {HTMLElement | Document} element - 対象の要素（オプション、省略時はdocument）
 */
export declare function applyI18n(element?: HTMLElement | Document): void;
/**
 * ページのタイトルを翻訳
 * @param {string} key - 翻訳キー
 */
export declare function translatePageTitle(key: string): void;
//# sourceMappingURL=i18n.d.ts.map