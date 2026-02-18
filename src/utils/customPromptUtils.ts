/**
 * customPromptUtils.ts
 * カスタムプロンプト管理ユーティリティ
 * ユーザー定義のプロンプトを管理し、AI要約生成時に適用する
 */

import { Settings, StorageKeys } from './storage.js';
import { sanitizePromptContent, DangerLevel } from './promptSanitizer.js';
import { addLog, LogType } from './logger.js';

/**
 * カスタムプロンプトのデータ構造
 */
export interface CustomPrompt {
    id: string;
    name: string;
    prompt: string;           // ユーザープロンプト（{{content}}プレースホルダーを含む）
    systemPrompt?: string;    // OpenAI用システムプロンプト（オプション）
    provider: 'gemini' | 'openai' | 'openai2' | 'all';
    isActive: boolean;
    createdAt: number;
    updatedAt: number;
}

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
export const DEFAULT_USER_PROMPT = `以下のWebページの内容を、日本語で簡潔に要約してください。
1文または2文で、重要なポイントをまとめてください。改行しないこと。

Content:
{{content}}`;

/**
 * デフォルトのシステムプロンプト（OpenAI用）
 */
export const DEFAULT_SYSTEM_PROMPT = 'You are a helpful assistant that summarizes web pages effectively and concisely in Japanese.';

/**
 * プロンプト内のプレースホルダーを置換
 * @param {string} prompt - プロンプトテンプレート
 * @param {string} content - 置換するコンテンツ
 * @returns {string} 置換後のプロンプト
 */
export function replaceContentPlaceholder(prompt: string, content: string): string {
    return prompt.replace(/\{\{content\}\}/gi, content);
}

/**
 * プロンプトが有効かどうかを検証
 * @param {string} prompt - 検証するプロンプト
 * @returns {{ valid: boolean; error?: string }} 検証結果
 */
export function validatePrompt(prompt: string): { valid: boolean; error?: string } {
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
export function getActivePrompt(settings: Settings, providerName: string): CustomPrompt | null {
    const prompts = (settings[StorageKeys.CUSTOM_PROMPTS] as CustomPrompt[]) || [];
    
    if (!Array.isArray(prompts) || prompts.length === 0) {
        return null;
    }

    // 優先順位: プロバイダー固有 > all
    const providerPrompt = prompts.find(
        p => p.isActive && p.provider === providerName
    );
    if (providerPrompt) {
        return providerPrompt;
    }

    const allPrompt = prompts.find(
        p => p.isActive && p.provider === 'all'
    );
    return allPrompt || null;
}

/**
 * カスタムプロンプトを適用してプロンプト文字列を生成
 * @param {Settings} settings - 設定オブジェクト
 * @param {string} providerName - プロバイダー名
 * @param {string} sanitizedContent - サニタイズ済みコンテンツ
 * @returns {PromptResult} 適用結果
 */
export function applyCustomPrompt(
    settings: Settings, 
    providerName: string, 
    sanitizedContent: string
): PromptResult {
    const customPrompt = getActivePrompt(settings, providerName);

    if (!customPrompt) {
        // デフォルトプロンプトを使用
        return {
            userPrompt: replaceContentPlaceholder(DEFAULT_USER_PROMPT, sanitizedContent),
            systemPrompt: DEFAULT_SYSTEM_PROMPT,
            isCustom: false
        };
    }

    // カスタムプロンプトを適用
    const userPrompt = replaceContentPlaceholder(customPrompt.prompt, sanitizedContent);
    
    // カスタムプロンプトの使用をログに記録
    addLog(LogType.INFO, `Using custom prompt: ${customPrompt.name} for ${providerName}`);

    return {
        userPrompt,
        systemPrompt: customPrompt.systemPrompt || DEFAULT_SYSTEM_PROMPT,
        isCustom: true
    };
}

/**
 * 一意のIDを生成
 * @returns {string} 一意のID
 */
export function generatePromptId(): string {
    return `prompt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * 新しいカスタムプロンプトを作成
 * @param {Omit<CustomPrompt, 'id' | 'createdAt' | 'updatedAt'>} data - プロンプトデータ
 * @returns {CustomPrompt} 作成されたプロンプト
 */
export function createPrompt(
    data: Omit<CustomPrompt, 'id' | 'createdAt' | 'updatedAt'>
): CustomPrompt {
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
export function updatePrompt(
    prompts: CustomPrompt[], 
    id: string, 
    updates: Partial<CustomPrompt>
): CustomPrompt[] {
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
export function deletePrompt(prompts: CustomPrompt[], id: string): CustomPrompt[] {
    return prompts.filter(p => p.id !== id);
}

/**
 * アクティブなプロンプトを設定（他のプロンプトのisActiveをfalseに）
 * @param {CustomPrompt[]} prompts - プロンプト配列
 * @param {string} id - アクティブにするプロンプトのID
 * @param {string} _provider - プロバイダー名（互換性のために残すが、内部ではプロンプトのproviderを使用）
 * @returns {CustomPrompt[]} 更新後のプロンプト配列
 */
export function setActivePrompt(
    prompts: CustomPrompt[],
    id: string,
    _provider: string
): CustomPrompt[] {
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
        const shouldDeactivate = p.isActive && p.id !== id && (
            scope === 'all' || // 'all'プロンプトなら全てを管理
            p.provider === scope || // 同じプロバイダー
            (p.provider === 'all') // 'all'プロンプトも管理対象
        );

        if (shouldDeactivate) {
            return { ...p, isActive: false, updatedAt: Date.now() };
        }
        return p;
    });
}
