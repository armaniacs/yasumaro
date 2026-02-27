/**
 * tagUtils.ts
 * タグ管理関連のユーティリティ関数
 * デフォルトカテゴリ定義、タグパース、カテゴリバリデーション
 */
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
];
/**
 * デフォルトカテゴリを TagCategory 配列として取得
 * @returns {TagCategory[]} デフォルトカテゴリの配列
 */
export function getDefaultCategories() {
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
export function getAllCategories(settings) {
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
export function isValidCategory(category, settings) {
    const allCategories = getAllCategories(settings);
    return allCategories.includes(category);
}
/**
 * AI要約結果からタグと要約文をパース
 * 出力形式: `#カテゴリ1 #カテゴリ2 | 要約文`
 * @param {string} summary - AI要約結果
 * @returns {{ tags: string[]; summary: string }} タグ配列と要約文
 */
export function parseTagsFromSummary(summary) {
    // 出力形式: `#カテゴリ1 #カテゴリ2 | 要約文` のパターン
    // 最初の `|` でタグ部分と要約部分を分離
    const pipeMatch = summary.match(/^([^|]+)\|(.+)$/s); // sフラグ: `.`が改行にもマッチ
    if (!pipeMatch) {
        // パターンに一致しない場合はタグなしとみなす
        return { tags: [], summary };
    }
    const tagPart = pipeMatch[1].trim();
    const summaryPart = pipeMatch[2].trim();
    // タグを抽出: `#カテゴリ` 形式
    const tagRegex = /#(\S+)/g;
    const tags = [];
    let match;
    while ((match = tagRegex.exec(tagPart)) !== null) {
        // 正規表現 /#(\S+)/g は # をキャプチャグループ外にあるため、match[1] には # は含まれない
        const tagName = match[1];
        if (tagName && !tags.includes(tagName)) {
            tags.push(tagName);
        }
    }
    // タグが1つも見つからない場合はタグなしとみなす（全文を要約として使用）
    if (tags.length === 0) {
        return { tags: [], summary };
    }
    return { tags, summary: summaryPart };
}
//# sourceMappingURL=tagUtils.js.map