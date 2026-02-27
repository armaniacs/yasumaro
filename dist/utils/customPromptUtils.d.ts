/**
 * customPromptUtils.ts
 * カスタムプロンプト管理ユーティリティ
 * ユーザー定義のプロンプトを管理し、AI要約生成時に適用する
 */
import { Settings } from './storage.js';
import { CustomPrompt } from './types.js';
export type { CustomPrompt } from './types.js';
/**
 * プロンプト適用結果
 */
export interface PromptResult {
    userPrompt: string;
    systemPrompt?: string;
    isCustom: boolean;
}
/**
 * デフォルトのユーザープロンプト
 */
export declare const DEFAULT_USER_PROMPT = "\u4EE5\u4E0B\u306EWeb\u30DA\u30FC\u30B8\u306E\u5185\u5BB9\u3092\u3001\u65E5\u672C\u8A9E\u3067\u7C21\u6F54\u306B\u8981\u7D04\u3057\u3066\u304F\u3060\u3055\u3044\u3002\n1\u6587\u307E\u305F\u306F2\u6587\u3067\u3001\u91CD\u8981\u306A\u30DD\u30A4\u30F3\u30C8\u3092\u307E\u3068\u3081\u3066\u304F\u3060\u3055\u3044\u3002\u6539\u884C\u3057\u306A\u3044\u3053\u3068\u3002\n\nContent:\n{{content}}";
/**
 * デフォルトのシステムプロンプト（OpenAI用）
 */
export declare const DEFAULT_SYSTEM_PROMPT = "You are a helpful assistant that summarizes web pages effectively and concisely in Japanese.";
/**
 * タグ付き要約用デフォルトプロンプト
 */
export declare const DEFAULT_TAGGED_SUMMARY_PROMPT = "\u4EE5\u4E0B\u306EWeb\u30DA\u30FC\u30B8\u306E\u5185\u5BB9\u3092\u5206\u6790\u3057\u3001\u6307\u5B9A\u3057\u305F\u30AB\u30C6\u30B4\u30EA\u304B\u3089\u6700\u3082\u95A2\u9023\u5EA6\u306E\u9AD8\u3044\u3082\u306E\u30921\u3064\u307E\u305F\u306F2\u3064\u9078\u3093\u3067\u30BF\u30B0\u5F62\u5F0F\u3067\u51FA\u529B\u3057\u3001\u305D\u306E\u5F8C\u306B\u65E5\u672C\u8A9E\u3067\u7C21\u6F54\u306B\u8981\u7D04\u3057\u3066\u304F\u3060\u3055\u3044\u3002\n\n\u30AB\u30C6\u30B4\u30EA\u5019\u88DC:\n[IT\u30FB\u30D7\u30ED\u30B0\u30E9\u30DF\u30F3\u30B0, \u30A4\u30F3\u30D5\u30E9\u30FB\u30CD\u30C3\u30C8\u30EF\u30FC\u30AF, \u30B5\u30A4\u30A8\u30F3\u30B9\u30FB\u30A2\u30AB\u30C7\u30DF\u30C3\u30AF, \u30D3\u30B8\u30CD\u30B9\u30FB\u7D4C\u6E08, \u30E9\u30A4\u30D5\u30B9\u30BF\u30A4\u30EB\u30FB\u96D1\u8A18, \u30D5\u30FC\u30C9\u30FB\u30EC\u30B7\u30D4, \u30C8\u30E9\u30D9\u30EB\u30FB\u30A2\u30A6\u30C8\u30C9\u30A2, \u30A8\u30F3\u30BF\u30E1\u30FB\u30B2\u30FC\u30E0, \u30AF\u30EA\u30A8\u30A4\u30C6\u30A3\u30D6\u30FB\u30A2\u30FC\u30C8, \u30D8\u30EB\u30B9\u30FB\u30A6\u30A7\u30EB\u30CD\u30B9]\n\n\u51FA\u529B\u5F62\u5F0F:\n#\u30AB\u30C6\u30B4\u30EA1 #\u30AB\u30C6\u30B4\u30EA2 | \u8981\u7D04\u6587\uFF08\u6539\u884C\u306A\u3057\uFF09\n\nContent:\n{{content}}";
/**
 * プロンプト内のプレースホルダーを置換
 * @param {string} prompt - プロンプトテンプレート
 * @param {string} content - 置換するコンテンツ
 * @returns {string} 置換後のプロンプト
 */
export declare function replaceContentPlaceholder(prompt: string, content: string): string;
/**
 * プロンプトが有効かどうかを検証
 * @param {string} prompt - 検証するプロンプト
 * @returns {{ valid: boolean; error?: string }} 検証結果
 */
export declare function validatePrompt(prompt: string): {
    valid: boolean;
    error?: string;
};
/**
 * 設定からアクティブなカスタムプロンプトを取得
 * @param {Settings} settings - 設定オブジェクト
 * @param {string} providerName - プロバイダー名 ('gemini' | 'openai' | 'openai2')
 * @returns {CustomPrompt | null} アクティブなプロンプト、またはnull
 */
export declare function getActivePrompt(settings: Settings, providerName: string): CustomPrompt | null;
/**
 * カスタムプロンプトを適用してプロンプト文字列を生成
 * @param {Settings} settings - 設定オブジェクト
 * @param {string} providerName - プロバイダー名
 * @param {string} sanitizedContent - サニタイズ済みコンテンツ
 * @param {boolean} [tagSummaryMode=false] - タグ付き要約モード
 * @returns {PromptResult} 適用結果
 */
export declare function applyCustomPrompt(settings: Settings, providerName: string, sanitizedContent: string, tagSummaryMode?: boolean): PromptResult;
/**
 * 一意のIDを生成
 * @returns {string} 一意のID
 */
export declare function generatePromptId(): string;
/**
 * 新しいカスタムプロンプトを作成
 * @param {Omit<CustomPrompt, 'id' | 'createdAt' | 'updatedAt'>} data - プロンプトデータ
 * @returns {CustomPrompt} 作成されたプロンプト
 */
export declare function createPrompt(data: Omit<CustomPrompt, 'id' | 'createdAt' | 'updatedAt'>): CustomPrompt;
/**
 * カスタムプロンプトを更新
 * @param {CustomPrompt[]} prompts - プロンプト配列
 * @param {string} id - 更新対象のID
 * @param {Partial<CustomPrompt>} updates - 更新内容
 * @returns {CustomPrompt[]} 更新後のプロンプト配列
 */
export declare function updatePrompt(prompts: CustomPrompt[], id: string, updates: Partial<CustomPrompt>): CustomPrompt[];
/**
 * カスタムプロンプトを削除
 * @param {CustomPrompt[]} prompts - プロンプト配列
 * @param {string} id - 削除対象のID
 * @returns {CustomPrompt[]} 削除後のプロンプト配列
 */
export declare function deletePrompt(prompts: CustomPrompt[], id: string): CustomPrompt[];
/**
 * アクティブなプロンプトを設定（他のプロンプトのisActiveをfalseに）
 * @param {CustomPrompt[]} prompts - プロンプト配列
 * @param {string} id - アクティブにするプロンプトのID
 * @param {string} _provider - プロバイダー名（互換性のために残すが、内部ではプロンプトのproviderを使用）
 * @returns {CustomPrompt[]} 更新後のプロンプト配列
 */
export declare function setActivePrompt(prompts: CustomPrompt[], id: string, _provider: string): CustomPrompt[];
//# sourceMappingURL=customPromptUtils.d.ts.map