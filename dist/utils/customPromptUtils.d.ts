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
 * タグ付き要約用プロンプトを動的生成
 * ユーザー追加カテゴリを含む全カテゴリをプロンプトに反映する
 * @param {Settings} settings - 設定オブジェクト
 * @param {string} content - 要約対象コンテンツ
 * @returns {string} タグ付き要約用プロンプト
 */
export declare function buildTaggedSummaryPrompt(settings: Settings, content: string): string;
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