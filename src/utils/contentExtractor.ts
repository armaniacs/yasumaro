/**
 * contentExtractor.ts
 * 【機能概要】: Webページのメインコンテンツを抽出し、ノイズ（ナビゲーション、ヘッダー等）を除去する
 * 【設計方針】:
 *   - 外部ライブラリ不使用（バンドルサイズ抑止）
 *   - Readabilityアルゴリズムの簡易実装
 *   - ベストエフォートで抽出し、失敗時はフォールバック
 *   - 最大文字数制限の維持
 * 🟢
 */

/**
 * 除外するセクメンタルコンテンツのロール属性
 * HTMLテキスト抽出の際、ナビゲーションやバナー等の補助的UI要素を除外するために使用
 */
const EXCLUDED_ROLES = new Set([
    'navigation',    // ナビゲーションメニュー
    'banner',        // ヘッダー/バナー
    'contentinfo',   // フッター
    'complementary', // サイドバー
    'doc-credit',    // 著者情報等
    'doc-endnotes',  // 注釈
    'doc-footnotes'  // 脚注
]);

/**
 * 除外するタグ名
 */
const EXCLUDED_TAGS = new Set([
    'nav',
    'aside',
    'footer',
    'header'
]);

/**
 * 除外するクラス名パターン（大文字小文字を区別しない）
 */
const EXCLUDED_CLASS_PATTERNS = [
    'sidebar',
    'nav',
    'navigation',
    'menu',
    'breadcrumb',
    'cookie',
    'ad',
    'advertisement',
    'banner',
    'footer',
    'header'
];

/**
 * 要素が除外対象かどうかを判定
 * @internal テスト用にエクスポート
 */
export function isExcludedElement(element: Element): boolean {
    // タグ名で除外
    if (EXCLUDED_TAGS.has(element.tagName.toLowerCase())) {
        return true;
    }

    // role属性で除外
    const role = element.getAttribute('role');
    if (role && EXCLUDED_ROLES.has(role.toLowerCase())) {
        return true;
    }

    // aria-hiddenで除外
    if (element.getAttribute('aria-hidden') === 'true') {
        return true;
    }

    // クラス名パターンで除外
    const classes = element.className.toLowerCase();
    for (const pattern of EXCLUDED_CLASS_PATTERNS) {
        if (classes.includes(pattern)) {
            return true;
        }
    }

    return false;
}

/**
 * 要素のテキストスコアを計算
 * テキストの多さ、段落の数、リンク密度などに基づいてスコアを計算
 * 【パフォーマンス最適化】DOM走査を一度に集約し、querySelectorAll呼び出しを削減
 */
export function calculateTextScore(element: Element): number {
    let score = 0;

    // テキストノードの長さ
    const text = (element as any).innerText || element.textContent || '';
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
            linkTextLength += (elem as any).innerText?.length || elem.textContent?.length || 0;
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
function findMainContentCandidates(): Element[] {
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

/**
 * 要素内のテキストを抽出し、除外対象の子要素をフィルタリング
 * 【パフォーマンス最適化】Array#joinを使用し、O(n²)文字列連結を回避
 */
function extractTextFromElement(element: Element): string {
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

/**
 * ページのメインコンテンツを抽出する
 * 【機能概要】: メインコンテンツ（記事、本文等）をテキストとして抽出
 * 【処理内容】:
 *   1. article/mainタグを優先的に探索
 *   2. 見出し、段落の多い要素を選択
 *   3. ナビゲーション、ヘッダー等を除外
 *   4. 最大文字数で切り詰め
 * 【フォールバック】: メインコンテンツが見つからない場合は body.innerText を使用
 * 【サイズ制限】: maxChars で指定された最大文字数（デフォルト: 10000）
 * 🟢
 * @param maxChars - 最大文字数（デフォルト: 10000）
 * @returns 抽出されたテキスト（空白正規化済み、最大文字数制限適用）
 */
export function extractMainContent(maxChars: number = 10000): string {
    let content = '';

    try {
        const candidates = findMainContentCandidates();

        if (candidates.length > 0) {
            // 最高スコアの候補からテキストを抽出
            content = extractTextFromElement(candidates[0]);

            // 抽出テキストが短すぎる場合、フォールバック
            if (content.trim().length < 100) {
                content = document.body?.innerText || '';
            }
        } else {
            // 候補がない場合、フォールバック
            content = document.body?.innerText || '';
        }
    } catch (error) {
        // エラー時は安全なフォールバック
        content = document.body?.innerText || '';
    }

    // 空白文字の正規化
    content = content
        .replace(/\s+/g, ' ')
        .trim();

    // 最大文字数で切り詰め
    if (content.length > maxChars) {
        content = content.substring(0, maxChars);
    }

    return content;
}