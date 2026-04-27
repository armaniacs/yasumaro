/**
 * AI要約クレンジングヘルパー関数
 * セレクター生成・要素判定ユーティリティ
 */

import { escapeCssSelector } from '../cssUtils.js';
import { isBodyProtected } from './bodyProtection.js';

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
    const className = (elem.className || '').toLowerCase();
    const id = (elem.id || '').toLowerCase();
    const text = (elem.textContent || '').toLowerCase();
    // \bはハイフンを認識しないため、CSSクラス向けに (^|[-_\s])ad([-_\s]|$) を使用
    const AD_WORD_RE = /(^|[-_\s])ad([-_\s]|$)/;
    return AD_WORD_RE.test(className) || AD_WORD_RE.test(id) ||
           text.includes('sponsored') || text.includes('promoted') ||
           text.includes('advertise');
}

/**
 * 要素がポップアップかどうかを判定
 */
export function isLikelyPopup(elem: Element): boolean {
    const className = (elem.className || '').toLowerCase();
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
    const className = (elem.className || '').toLowerCase();
    const id = (elem.id || '').toLowerCase();
    // \bはハイフンを認識しないため、CSSクラス向けに (^|[-_\s])ad([-_\s]|$) を使用
    const AD_WORD_RE = /(^|[-_\s])ad([-_\s]|$)/;
    return AD_WORD_RE.test(className) || AD_WORD_RE.test(id) ||
           className.includes('comment') && className.includes('youtube') ||
           id.includes('comment') || id.includes('related');
}