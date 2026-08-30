/**
 * AI要約クレンジングヘルパー関数
 * セレクター生成・要素判定ユーティリティ
 */

import { escapeCssSelector } from '../cssUtils.js';
import { getLowerClassName } from '../elementClassName.js';
import { isBodyProtected } from './bodyProtection.js';
import { I18N_AD_TEXT_PATTERNS, I18N_SOCIAL_TEXT_PATTERNS } from './patterns.js';

/**
 * 要素を削除する前に本文保護チェックを行う
 * 本文と判定された要素は削除せずfalseを返す
 * @param element 削除対象の要素
 * @returns 削除に成功したかどうか（本文保護によりスキップされた場合はfalse）
 */
export function safeRemoveElement(element: Element): boolean {
    if (isBodyProtected(element)) {
        return false;  // 本文保護: 削除しない
    }
    element.remove();
    return true;
}

/**
 * 要素をテキストノードに差し替える（本文保護チェック付き）
 * アフィリエイト要素や吹き出しなど、要素自体はノイズだが中のテキストは保持したい場合に使用
 * @param element 差し替え対象の要素
 * @param text 差し替え後のテキスト
 * @returns 差し替えに成功したかどうか（本文保護によりスキップされた場合はfalse）
 */
export function safeReplaceWithText(element: Element, text: string): boolean {
    if (isBodyProtected(element)) {
        return false;
    }
    const textNode = document.createTextNode(text);
    element.replaceWith(textNode);
    return true;
}

/**
 * パターン配列から [class*="..."], [id*="..."] を結合したCSSセレクター文字列を生成する
 */
export function buildClassIdSelectors(patterns: string[]): string {
    return patterns.map(p => {
        const kw = escapeCssSelector(p.toLowerCase());
        return `[class*="${kw}"], [id*="${kw}"]`;
    }).join(', ');
}

/**
 * 要素がposition: fixed/stickyかを判定
 */
export function isFixedOrSticky(elem: Element): boolean {
    const style = elem.getAttribute('style') || '';
    return style.includes('position: fixed') || style.includes('position:fixed') ||
           style.includes('position: sticky') || style.includes('position:sticky');
}

/**
 * 要素が広告かどうかを判定
 * 「 ad 」は単語境界レベルでマッチし、header/loaded 等の誤マッチを防ぐ
 */
export function isLikelyAd(elem: Element): boolean {
    const className = getLowerClassName(elem);
    const id = (elem.id || '').toLowerCase();
    const rawText = elem.textContent || '';
    const text = rawText.toLowerCase();
    // \bはハイフンを認識しないため、CSSクラス向けに (^|[-_\s])ad([-_\s]|$) を使用
    const AD_WORD_RE = /(^|[-_\s])ad([-_\s]|$)/;
    if (AD_WORD_RE.test(className) || AD_WORD_RE.test(id)) return true;
    if (text.includes('sponsored') || text.includes('promoted') || text.includes('advertise')) return true;
    // i18n広告テキストパターン（テキストマッチ — クラス誤爆を避けるため RegExp[] で判定）
    if (I18N_AD_TEXT_PATTERNS.some((re) => re.test(rawText))) return true;
    return false;
}

/**
 * 要素がソーシャル/共有かどうかを判定（i18nテキストマッチ）
 */
export function isLikelySocial(elem: Element): boolean {
    const rawText = elem.textContent || '';
    if (I18N_SOCIAL_TEXT_PATTERNS.some((re) => re.test(rawText))) return true;
    const className = getLowerClassName(elem);
    const id = (elem.id || '').toLowerCase();
    // フォールバック: 英語系クラス/IDでも判定（既存 SOCIAL_CLASS_PATTERNS と一貫）
    return className.includes('social') || className.includes('share') ||
           id.includes('social') || id.includes('share');
}

/**
 * 要素がポップアップかどうかを判定
 */
export function isLikelyPopup(elem: Element): boolean {
    const className = getLowerClassName(elem);
    const id = (elem.id || '').toLowerCase();
    const style = elem.getAttribute('style') || '';
    return className.includes('popup') || className.includes('modal') ||
           className.includes('overlay') || className.includes('cookie') ||
           className.includes('consent') || className.includes('banner') ||
           id.includes('popup') || id.includes('modal') ||
           (style.includes('position: fixed') && className.length < 50);
}

/**
 * 要素がプラットフォームノイズかどうかを判定
 * 「 ad 」は単語境界レベルでマッチし、header/loaded 等の誤マッチを防ぐ
 */
export function isPlatformNoise(elem: Element): boolean {
    const className = getLowerClassName(elem);
    const id = (elem.id || '').toLowerCase();
    // \bはハイフンを認識しないため、CSSクラス向けに (^|[-_\s])ad([-_\s]|$) を使用
    const AD_WORD_RE = /(^|[-_\s])ad([-_\s]|$)/;
    return AD_WORD_RE.test(className) || AD_WORD_RE.test(id) ||
           className.includes('comment') && className.includes('youtube') ||
           id.includes('comment') || id.includes('related');
}