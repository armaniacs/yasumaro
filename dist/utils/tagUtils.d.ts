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
export declare const DEFAULT_CATEGORIES: readonly ["IT・プログラミング", "インフラ・ネットワーク", "サイエンス・アカデミック", "ビジネス・経済", "ライフスタイル・雑記", "フード・レシピ", "トラベル・アウトドア", "エンタメ・ゲーム", "クリエイティブ・アート", "ヘルス・ウェルネス"];
/**
 * デフォルトカテゴリを TagCategory 配列として取得
 * @returns {TagCategory[]} デフォルトカテゴリの配列
 */
export declare function getDefaultCategories(): TagCategory[];
/**
 * 設定から全カテゴリ（デフォルト + ユーザー追加）を取得
 * @param {Settings} settings - 設定オブジェクト
 * @returns {string[]} カテゴリ名の配列
 */
export declare function getAllCategories(settings: Settings): string[];
/**
 * カテゴリが有効かどうかを判定
 * @param {string} category - 検証するカテゴリ名
 * @param {Settings} settings - 設定オブジェクト
 * @returns {boolean} 有効な場合はtrue
 */
export declare function isValidCategory(category: string, settings: Settings): boolean;
/**
 * AI要約結果からタグと要約文をパース
 * 出力形式: `#カテゴリ1 #カテゴリ2 | 要約文`
 * @param {string} summary - AI要約結果
 * @returns {{ tags: string[]; summary: string }} タグ配列と要約文
 */
export declare function parseTagsFromSummary(summary: string): {
    tags: string[];
    summary: string;
};
//# sourceMappingURL=tagUtils.d.ts.map