/**
 * customPromptUtils.ts
 * カスタムプロンプト管理ユーティリティ
 * ユーザー定義のプロンプトを管理し、AI要約生成時に適用する
 */
import { StorageKeys } from './storage.js';
import { sanitizePromptContent, DangerLevel } from './promptSanitizer.js';
import { addLog, LogType } from './logger.js';
/**
 * デフォルトのユーザープロンプト
 */
export const DEFAULT_USER_PROMPT = `以下のWebページの内容を、日本語で簡潔に要約してください。
1文または2文で、重要なポイントをまとめてください。改行しないこと。

Content:
{{content}}`;
/**
 * デフォルトのシステムプロンプト（OpenAI用）
 */
export const DEFAULT_SYSTEM_PROMPT = 'You are a helpful assistant that summarizes web pages effectively and concisely in Japanese.';
/**
 * タグ付き要約用デフォルトプロンプト
 */
export const DEFAULT_TAGGED_SUMMARY_PROMPT = `以下のWebページの内容を分析し、指定したカテゴリから最も関連度の高いものを1つまたは2つ選んでタグ形式で出力し、その後に日本語で簡潔に要約してください。

カテゴリ候補:
[IT・プログラミング, インフラ・ネットワーク, サイエンス・アカデミック, ビジネス・経済, ライフスタイル・雑記, フード・レシピ, トラベル・アウトドア, エンタメ・ゲーム, クリエイティブ・アート, ヘルス・ウェルネス]

出力形式:
#カテゴリ1 #カテゴリ2 | 要約文（改行なし）

Content:
{{content}}`;
/**
 * プロンプト内のプレースホルダーを置換
 * @param {string} prompt - プロンプトテンプレート
 * @param {string} content - 置換するコンテンツ
 * @returns {string} 置換後のプロンプト
 */
export function replaceContentPlaceholder(prompt, content) {
    return prompt.replace(/\{\{content\}\}/gi, content);
}
/**
 * プロンプトが有効かどうかを検証
 * @param {string} prompt - 検証するプロンプト
 * @returns {{ valid: boolean; error?: string }} 検証結果
 */
export function validatePrompt(prompt) {
    if (!prompt || typeof prompt !== 'string') {
        return { valid: false, error: 'Prompt is required' };
    }
    if (prompt.length > 5000) {
        return { valid: false, error: 'Prompt is too long (max 5000 characters)' };
    }
    // {{content}}プレースホルダーの存在チェック（必須ではないが推奨）
    if (!prompt.includes('{{content}}') && !prompt.includes('{{CONTENT}}')) {
        // プレースホルダーがない場合は警告のみ（コンテンツが末尾に追加される）
        addLog(LogType.WARN, 'Prompt does not contain {{content}} placeholder. Content will be appended.');
    }
    // プロンプトインジェクションパターンのチェック
    const { dangerLevel, warnings } = sanitizePromptContent(prompt);
    if (dangerLevel === DangerLevel.HIGH) {
        return {
            valid: false,
            error: `Potentially unsafe prompt: ${warnings.join('; ')}`
        };
    }
    return { valid: true };
}
/**
 * 設定からアクティブなカスタムプロンプトを取得
 * @param {Settings} settings - 設定オブジェクト
 * @param {string} providerName - プロバイダー名 ('gemini' | 'openai' | 'openai2')
 * @returns {CustomPrompt | null} アクティブなプロンプト、またはnull
 */
export function getActivePrompt(settings, providerName) {
    const prompts = settings[StorageKeys.CUSTOM_PROMPTS] || [];
    if (!Array.isArray(prompts) || prompts.length === 0) {
        return null;
    }
    // 優先順位: プロバイダー固有 > all
    const providerPrompt = prompts.find(p => p.isActive && p.provider === providerName);
    if (providerPrompt) {
        return providerPrompt;
    }
    const allPrompt = prompts.find(p => p.isActive && p.provider === 'all');
    return allPrompt || null;
}
/**
 * カスタムプロンプトを適用してプロンプト文字列を生成
 * @param {Settings} settings - 設定オブジェクト
 * @param {string} providerName - プロバイダー名
 * @param {string} sanitizedContent - サニタイズ済みコンテンツ
 * @param {boolean} [tagSummaryMode=false] - タグ付き要約モード
 * @returns {PromptResult} 適用結果
 */
export function applyCustomPrompt(settings, providerName, sanitizedContent, tagSummaryMode = false) {
    const customPrompt = getActivePrompt(settings, providerName);
    if (customPrompt) {
        // カスタムプロンプトを適用
        const userPrompt = replaceContentPlaceholder(customPrompt.prompt, sanitizedContent);
        addLog(LogType.INFO, `Using custom prompt: ${customPrompt.name} for ${providerName}`);
        return {
            userPrompt,
            systemPrompt: customPrompt.systemPrompt || DEFAULT_SYSTEM_PROMPT,
            isCustom: true
        };
    }
    // デフォルトプロンプトを使用
    // タグ付き要約モードの場合はタグ付きプロンプトを使用
    const basePrompt = tagSummaryMode ? DEFAULT_TAGGED_SUMMARY_PROMPT : DEFAULT_USER_PROMPT;
    return {
        userPrompt: replaceContentPlaceholder(basePrompt, sanitizedContent),
        systemPrompt: DEFAULT_SYSTEM_PROMPT,
        isCustom: false
    };
}
/**
 * 一意のIDを生成
 * @returns {string} 一意のID
 */
export function generatePromptId() {
    return `prompt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}
/**
 * 新しいカスタムプロンプトを作成
 * @param {Omit<CustomPrompt, 'id' | 'createdAt' | 'updatedAt'>} data - プロンプトデータ
 * @returns {CustomPrompt} 作成されたプロンプト
 */
export function createPrompt(data) {
    const now = Date.now();
    return {
        ...data,
        id: generatePromptId(),
        createdAt: now,
        updatedAt: now
    };
}
/**
 * カスタムプロンプトを更新
 * @param {CustomPrompt[]} prompts - プロンプト配列
 * @param {string} id - 更新対象のID
 * @param {Partial<CustomPrompt>} updates - 更新内容
 * @returns {CustomPrompt[]} 更新後のプロンプト配列
 */
export function updatePrompt(prompts, id, updates) {
    return prompts.map(p => {
        if (p.id === id) {
            return {
                ...p,
                ...updates,
                updatedAt: Date.now()
            };
        }
        return p;
    });
}
/**
 * カスタムプロンプトを削除
 * @param {CustomPrompt[]} prompts - プロンプト配列
 * @param {string} id - 削除対象のID
 * @returns {CustomPrompt[]} 削除後のプロンプト配列
 */
export function deletePrompt(prompts, id) {
    return prompts.filter(p => p.id !== id);
}
/**
 * アクティブなプロンプトを設定（他のプロンプトのisActiveをfalseに）
 * @param {CustomPrompt[]} prompts - プロンプト配列
 * @param {string} id - アクティブにするプロンプトのID
 * @param {string} _provider - プロバイダー名（互換性のために残すが、内部ではプロンプトのproviderを使用）
 * @returns {CustomPrompt[]} 更新後のプロンプト配列
 */
export function setActivePrompt(prompts, id, _provider) {
    // 1. 対象となるプロンプトをアクティブにする
    const activated = prompts.map(p => {
        if (p.id === id) {
            return { ...p, isActive: true, updatedAt: Date.now() };
        }
        return p;
    });
    // 2. 同一スコープの他のプロンプトを非アクティブにする
    // プロンプト自身が持つproviderスコープを使用
    const activePrompt = activated.find(p => p.id === id);
    if (!activePrompt) {
        return prompts; // 見つからない場合は変更なし
    }
    const scope = activePrompt.provider;
    return activated.map(p => {
        // 対象スコープのプロンプトで、かつアクティブなものを非アクティブに
        // 'all'スコープは全てのプロバイダーを管理
        // 特定プロバイダーは、そのプロバイダーと'all'プロンプトを管理
        const shouldDeactivate = p.isActive && p.id !== id && (scope === 'all' || // 'all'プロンプトなら全てを管理
            p.provider === scope || // 同じプロバイダー
            (p.provider === 'all') // 'all'プロンプトも管理対象
        );
        if (shouldDeactivate) {
            return { ...p, isActive: false, updatedAt: Date.now() };
        }
        return p;
    });
}
//# sourceMappingURL=customPromptUtils.js.map