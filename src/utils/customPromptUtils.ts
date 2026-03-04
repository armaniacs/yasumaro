/**
 * customPromptUtils.ts
 * カスタムプロンプト管理ユーティリティ
 * ユーザー定義のプロンプトを管理し、AI要約生成時に適用する
 */

import { Settings, StorageKeys } from './storage.js';
import { sanitizePromptContent, DangerLevel } from './promptSanitizer.js';
import { addLog, LogType } from './logger.js';
import { CustomPrompt } from './types.js';
import { getAllCategories } from './tagUtils.js';

// 型を再エクスポート
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
export const DEFAULT_USER_PROMPT = `以下のWebページの内容を、日本語で簡潔に要約してください。
1文または2文で、重要なポイントをまとめてください。改行しないこと。

Content:
{{content}}`;

/**
 * デフォルトのシステムプロンプト（OpenAI用）
 */
export const DEFAULT_SYSTEM_PROMPT = 'You are a helpful assistant that summarizes web pages effectively and concisely in Japanese.';

/**
 * プリセットプロンプトの定義
 */
export interface PresetPrompt {
    id: string;
    name: string;
    nameJa: string;
    userPrompt: string;
    systemPrompt?: string;
}

/**
 * プリセットプロンプト一覧
 */
export const PRESET_PROMPTS: PresetPrompt[] = [
    {
        id: 'default',
        name: 'Default',
        nameJa: 'デフォルト',
        userPrompt: `以下のWebページの内容を、日本語で簡潔に要約してください。
1文または2文で、重要なポイントをまとめてください。改行しないこと。

Content:
{{content}}`,
        systemPrompt: DEFAULT_SYSTEM_PROMPT
    },
    {
        id: 'tagged',
        name: 'With Tags',
        nameJa: 'タグ付き要約',
        userPrompt: `以下のWebページの内容を分析し、指定したカテゴリから最も関連度の高いものを1つまたは2つ選んでタグ形式で出力し、その後に日本語で簡潔に要約してください。

カテゴリ候補:
[IT・プログラミング, インフラ・ネットワーク, サイエンス・アカデミック, ビジネス・経済, ライフスタイル・雑記, フード・レシピ, トラベル・アウトドア, エンタメ・ゲーム, クリエイティブ・アート, ヘルス・ウェルネス]

出力形式:
#カテゴリ1 #カテゴリ2 | 要約文（改行なし）

Content:
{{content}}`,
        systemPrompt: DEFAULT_SYSTEM_PROMPT
    },
    {
        id: 'bullet',
        name: 'Bullet Points',
        nameJa: '箇条書き',
        userPrompt: `以下のWebページの内容を、日本語で箇条書き3点で要約してください。

{{content}}`,
        systemPrompt: 'You are a helpful assistant that organizes information into clear bullet points.'
    },
    {
        id: 'english',
        name: 'English Summary',
        nameJa: '英語要約',
        userPrompt: `Please summarize the following web page in English in 1-2 sentences.

Content:
{{content}}`,
        systemPrompt: 'You are a helpful assistant that summarizes web pages effectively and concisely in English.'
    },
    {
        id: 'technical',
        name: 'Technical Focus',
        nameJa: '技術的観点',
        userPrompt: `以下のWebページの技術的なポイントを日本語で簡潔に3点まとめてください。

{{content}}`,
        systemPrompt: 'You are a technical assistant. Focus on technical details and key insights.'
    }
];

/**
 * IDからプリセットプロンプトを取得
 * @param {string} id - プリセットID
 * @returns {PresetPrompt | undefined} プリセットプロンプト、またはundefined
 */
export function getPresetPrompt(id: string): PresetPrompt | undefined {
    return PRESET_PROMPTS.find(p => p.id === id);
}

/**
 * 使用言語に基づいてプリセットの表示名を取得
 * @param {PresetPrompt} preset - プリセットプロンプト
 * @param {string} locale - 言語コード ('ja' または 'en')
 * @returns {string} 表示名
 */
export function getPromptDisplayName(preset: PresetPrompt, locale: string): string {
    return locale === 'ja' ? preset.nameJa : preset.name;
}

/**
 * タグ付き要約用プロンプトを動的生成
 * ユーザー追加カテゴリを含む全カテゴリをプロンプトに反映する
 * @param {Settings} settings - 設定オブジェクト
 * @param {string} content - 要約対象コンテンツ
 * @returns {string} タグ付き要約用プロンプト
 */
export function buildTaggedSummaryPrompt(settings: Settings, content: string): string {
    const categories = getAllCategories(settings);
    const categoryList = categories.join(', ');
    return `以下のWebページの内容を分析し、指定したカテゴリから最も関連度の高いものを1つまたは2つ選んでタグ形式で出力し、その後に日本語で簡潔に要約してください。

カテゴリ候補:
[${categoryList}]

出力形式:
#カテゴリ1 #カテゴリ2 | 要約文（改行なし）

Content:
${content}`;
}

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
 * @param {boolean} [tagSummaryMode=false] - タグ付き要約モード
 * @returns {PromptResult} 適用結果
 */
export function applyCustomPrompt(
    settings: Settings,
    providerName: string,
    sanitizedContent: string,
    tagSummaryMode: boolean = false
): PromptResult {
    const customPrompt = getActivePrompt(settings, providerName);

    if (customPrompt) {
        // カスタムプロンプトを適用
        const userPrompt = replaceContentPlaceholder(customPrompt.prompt, sanitizedContent);
        addLog(LogType.INFO, `Using custom prompt: ${customPrompt.name} for ${providerName}`);
        // カスタムプロンプトが有効な場合、タグ付き要約モードは無視される
        if (tagSummaryMode) {
            addLog(LogType.WARN, `[applyCustomPrompt] tagSummaryMode is enabled but a custom prompt is active ("${customPrompt.name}"). Tag extraction may not work unless the custom prompt includes tag output format.`);
        }

        return {
            userPrompt,
            systemPrompt: customPrompt.systemPrompt || DEFAULT_SYSTEM_PROMPT,
            isCustom: true
        };
    }

    // デフォルトプロンプトを使用
    // タグ付き要約モードの場合はユーザー追加カテゴリを含む動的プロンプトを使用
    if (tagSummaryMode) {
        return {
            userPrompt: buildTaggedSummaryPrompt(settings, sanitizedContent),
            systemPrompt: DEFAULT_SYSTEM_PROMPT,
            isCustom: false
        };
    }

    return {
        userPrompt: replaceContentPlaceholder(DEFAULT_USER_PROMPT, sanitizedContent),
        systemPrompt: DEFAULT_SYSTEM_PROMPT,
        isCustom: false
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
