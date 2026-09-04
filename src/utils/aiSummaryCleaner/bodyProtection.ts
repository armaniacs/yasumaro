import { calculateReadabilityScore } from './readabilityScore.js';

const BODY_PROTECTION_ATTR = 'data-ow-body-protected';
export const DEFAULT_BODY_SCORE_THRESHOLD = 120;  // M4 Spike: 200→120 で短文3/3保護（33%→100%）

/**
 * Default threshold for the cleanse entry (cleanseAISummaryContent).
 * Kept at 200: the dashboard settings default (`?? 200` in
 * aiSummaryCleansingSettingsV2.ts) and every contentExtractor caller rely on
 * the implicit 200, so adopting 120 here would silently expand body
 * protection on the extractor path. Unify here — the single owner of body
 * protection defaults — rather than as a magic number at the call site.
 */
export const DEFAULT_CLEANSE_BODY_PROTECTION_THRESHOLD = 200;

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