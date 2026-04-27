import { calculateReadabilityScore } from './readabilityScore.js';

const BODY_PROTECTION_ATTR = 'data-ow-body-protected';
const DEFAULT_BODY_SCORE_THRESHOLD = 200;  // デフォルト閾値

// クレンジング前: 本文スコアが高い要素に保護マーカーを付ける
export function markBodyElements(root: Element, threshold: number = DEFAULT_BODY_SCORE_THRESHOLD): void {
    const elements = root.querySelectorAll('p, div, section, article');
    for (const elem of elements) {
        const score = calculateReadabilityScore(elem);
        if (score >= threshold) {
            elem.setAttribute(BODY_PROTECTION_ATTR, 'true');
        }
    }
}

// クレンジング後: マーカーを除去する（DOMのクリーンアップ）
export function unmarkBodyElements(root: Element): void {
    const marked = root.querySelectorAll(`[${BODY_PROTECTION_ATTR}]`);
    for (const elem of marked) {
        elem.removeAttribute(BODY_PROTECTION_ATTR);
    }
}

// 要素が保護されているか確認
export function isBodyProtected(element: Element): boolean {
    // 自身または祖先要素が保護されているかチェック
    return element.closest(`[${BODY_PROTECTION_ATTR}]`) !== null;
}