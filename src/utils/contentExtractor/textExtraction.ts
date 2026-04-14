/**
 * contentExtractor テキスト抽出
 * 要素からテキストを抽出し、除外対象の子要素をフィルタリング
 */

import { isExcludedElement } from './classifier.js';

/**
 * 要素内のテキストを抽出し、除外対象の子要素をフィルタリング
 * 【パフォーマンス最適化】Array#joinを使用し、O(n²)文字列連結を回避
 */
export function extractTextFromElement(element: Element): string {
    // 文字列連結用の配列（パフォーマンス改善）
    const parts: string[] = [];

    // 再帰的にテキストを抽出
    for (const node of Array.from(element.childNodes)) {
        // ノードタイプ定数（jsdom互換性のために直接数値を使用）
        const TEXT_NODE = 3 as number;
        const ELEMENT_NODE = 1 as number;

        if (node.nodeType === TEXT_NODE) {
            // テキストノードを配列に追加
            parts.push(node.nodeValue || '');
        } else if (node.nodeType === ELEMENT_NODE) {
            const elem = node as Element;

            // 画像はスキップ（テキストコンテンツのみ）
            if (elem.tagName.toLowerCase() === 'img') {
                continue;
            }

            // 除外対象ならスキップ
            if (isExcludedElement(elem)) {
                continue;
            }

            // 再帰的に子要素を処理（パフォーマンス改善）
            parts.push(extractTextFromElement(elem));
            parts.push(' ');
        }
    }

    // 一度に結合（パフォーマンス改善）
    return parts.join('');
}