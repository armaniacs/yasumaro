/**
 * contentExtractor スコアリング・候補探索
 * テキストスコア計算とメインコンテンツ候補要素の抽出
 */

import { isExcludedElement, isAsianContentElement } from './classifier.js';

/**
 * 要素のテキストスコアを計算
 * テキストの多さ、段落の数、リンク密度などに基づいてスコアを計算
 * 【パフォーマンス最適化】DOM走査を一度に集約し、querySelectorAll呼び出しを削減
 */
export function calculateTextScore(element: Element): number {
    let score = 0;

    // テキストノードの長さ
    const text = ('innerText' in element ? (element as HTMLElement).innerText : null) || element.textContent || '';
    score += text.length;

    // 単一DOM走覧でp, h*, ul, ol, aの要素をカウント（パフォーマンス改善）
    let pCount = 0;
    let hCount = 0;
    let listCount = 0;
    let linkCount = 0;
    let linkTextLength = 0;

    const walker = document.createTreeWalker(
        element,
        NodeFilter.SHOW_ELEMENT,
        undefined
    );

    let node: Node | null = walker.nextNode();
    while (node) {
        const elem = node as Element;
        const tag = elem.tagName.toLowerCase();

        if (tag === 'p') {
            pCount++;
        } else if (/^h[1-7]$/.test(tag)) {
            hCount++;
        } else if (tag === 'ul' || tag === 'ol') {
            listCount++;
        } else if (tag === 'a') {
            linkCount++;
            linkTextLength += ('innerText' in elem ? (elem as HTMLElement).innerText?.length : null) || elem.textContent?.length || 0;
        }

        node = walker.nextNode();
    }

    // スコア計算
    score += pCount * 50;      // 段落: 50点
    score += hCount * 100;     // 見出し: 100点
    score += listCount * 30;   // リスト: 30点

    // リンク密度（比率が高い場合はスコアを下げる）
    const linkRatio = text.length > 0 ? linkTextLength / text.length : 0;
    if (linkRatio > 0.5) {
        score *= 0.3; // リンクが多い要素はスコアを下げる
    }

    return score;
}

/**
 * メインコンテンツの候補要素を抽出
 */
export function findMainContentCandidates(): Element[] {
    const candidates: Element[] = [];

    // 優先ターゲット: article, main
    const mainTags = document.querySelectorAll('article, main');
    for (const tag of mainTags) {
        if (!isExcludedElement(tag)) {
            candidates.push(tag);
        }
    }

    // 候補がある場合、最もスコアの高い要素を選択
    if (candidates.length > 0) {
        // スコア順にソート
        candidates.sort((a, b) => calculateTextScore(b) - calculateTextScore(a));
        return candidates.slice(0, 1);
    }

    // アジア圏のコンテンツ構造を検索
    const allElements = document.querySelectorAll('div, section');
    for (const elem of allElements) {
        if (isAsianContentElement(elem) && !isExcludedElement(elem)) {
            candidates.push(elem);
        }
    }

    // アジアコンテンツが見つかった場合、スコア順にソートして返す
    if (candidates.length > 0) {
        candidates.sort((a, b) => calculateTextScore(b) - calculateTextScore(a));
        return candidates.slice(0, 3);
    }

    // 候補がない場合、階層的に探索
    const body = document.body;
    if (!body) {
        return [];
    }

    // body直下の子要素を候補にする
    const directChildren = Array.from(body.children).filter(
        child => !isExcludedElement(child)
    );

    for (const child of directChildren) {
        candidates.push(child);
    }

    // スコア順にソートし、上位3候補を返す
    candidates.sort((a, b) => calculateTextScore(b) - calculateTextScore(a));
    return candidates.slice(0, 3);
}