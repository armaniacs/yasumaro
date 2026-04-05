/**
 * tagUtils.ts
 * タグ管理関連のユーティリティ関数
 * デフォルトカテゴリ定義、タグパース、カテゴリバリデーション
 */

import type { TagCategory } from './types.js';
import type { Settings } from './storageSettings.js';

/**
 * デフォルトカテゴリ定数
 */
export const DEFAULT_CATEGORIES = [
    'IT・プログラミング',
    'インフラ・ネットワーク',
    'サイエンス・アカデミック',
    'ビジネス・経済',
    'ライフスタイル・雑記',
    'フード・レシピ',
    'トラベル・アウトドア',
    'エンタメ・ゲーム',
    'クリエイティブ・アート',
    'ヘルス・ウェルネス',
] as const;

/**
 * デフォルトカテゴリを TagCategory 配列として取得
 * @returns {TagCategory[]} デフォルトカテゴリの配列
 */
export function getDefaultCategories(): TagCategory[] {
    return DEFAULT_CATEGORIES.map(name => ({
        name,
        isDefault: true,
        createdAt: Date.now()
    }));
}

/**
 * 設定から全カテゴリ（デフォルト + ユーザー追加）を取得
 * @param {Settings} settings - 設定オブジェクト
 * @returns {string[]} カテゴリ名の配列
 */
export function getAllCategories(settings: Settings): string[] {
    const defaultCategories = DEFAULT_CATEGORIES;
    const userCategories = settings.tag_categories || [];

    // カテゴリ名だけを抽出して結合
    const userCategoryNames = userCategories.map(c => c.name);
    return [...defaultCategories, ...userCategoryNames];
}

/**
 * カテゴリが有効かどうかを判定
 * @param {string} category - 検証するカテゴリ名
 * @param {Settings} settings - 設定オブジェクト
 * @returns {boolean} 有効な場合はtrue
 */
export function isValidCategory(category: string, settings: Settings): boolean {
    const allCategories = getAllCategories(settings);
    return allCategories.includes(category);
}

/**
 * AI要約結果からタグと要約文をパース
 * 出力形式: `#カテゴリ1 #カテゴリ2 | 要約文`
 * @param {string} summary - AI要約結果
 * @returns {{ tags: string[]; summary: string }} タグ配列と要約文
 */
/**
 * LLMが混入するノイズ行を除去する
 * 除去対象:
 *   - プロンプトのプレースホルダーリテラルを含む行 ("#カテゴリ1", "#カテゴリ2", "要約文（改行なし）")
 *   - "要約文：" / "要約文:" のような見出し語のみの行（本文の前置き）
 * ※ 実際のタグ名（"#トラベル・アウトドア" 等）や本文は除去しない
 */
function removeNoiseLines(text: string): string {
    return text
        .split('\n')
        .filter(line => !line.includes('#カテゴリ1') && !line.includes('#カテゴリ2'))
        .filter(line => !line.includes('要約文（改行なし）'))
        .filter(line => !/^\s*要約文[：:]\s*$/.test(line))
        .join('\n')
        .trim();
}

/**
 * summaryPart から最適なブロックを選択する
 * 優先順位:
 *   1. 「要約文：」または「要約文:」見出し行の直後のブロック（詳細本文）
 *   2. 最初のブロック（見出しがない場合）
 * LLMは1行目に短いタイトル的要約、「要約文：」以降に詳細本文を返すことが多い
 */
function selectBestBlock(text: string): string {
    // 「\n\n要約[文]?[：:][本文またはインライン]」パターンを探す
    // ケース1: "\n\n要約文：\n本文" — 見出し行の次行に本文
    // ケース2: "\n\n要約：インライン本文" — 見出しと本文が同じ行
    const detailMatch = text.match(/\n\n要約文?[：:]\n?([\s\S]+)/);
    if (detailMatch) {
        const detailText = detailMatch[1].trim();
        if (detailText.length > 0) {
            // 詳細本文の最初のブロックを返す
            const blocks = detailText.split('\n\n').map(b => b.trim()).filter(b => b.length > 0);
            return blocks[0] ?? '';
        }
    }
    // 「要約」パターンがない場合は最初のブロックを返す
    const blocks = text.split('\n\n').map(b => b.trim()).filter(b => b.length > 0);
    return blocks[0] ?? '';
}

export function parseTagsFromSummary(summary: string): { tags: string[]; summary: string } {
    // 出力形式: `#カテゴリ1 #カテゴリ2 | 要約文` のパターン
    // 最初の `|` でタグ部分と要約部分を分離
    const pipeMatch = summary.match(/^([^|]+)\|(.+)$/s);  // sフラグ: `.`が改行にもマッチ

    if (!pipeMatch) {
        // パターンに一致しない場合はタグなしとみなす
        return { tags: [], summary: removeNoiseLines(selectBestBlock(summary)) };
    }

    const tagPart = pipeMatch[1].trim();
    const summaryPart = pipeMatch[2].trim();

    // タグを抽出: `#カテゴリ` 形式
    const tagRegex = /#(\S+)/g;
    const tags: string[] = [];
    let match;

    while ((match = tagRegex.exec(tagPart)) !== null) {
        // 正規表現 /#(\S+)/g は # をキャプチャグループ外にあるため、match[1] には # は含まれない
        const tagName = match[1];
        if (tagName && !tags.includes(tagName)) {
            tags.push(tagName);
        }
    }

    // タグが1つも見つからない場合はタグなしとみなす
    if (tags.length === 0) {
        return { tags: [], summary: removeNoiseLines(selectBestBlock(summary)) };
    }

    // summaryPart から最適なブロックを選択し、ノイズ行を除去して返す
    return { tags, summary: removeNoiseLines(selectBestBlock(summaryPart)) };
}
