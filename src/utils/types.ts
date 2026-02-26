/**
 * types.ts
 * 共通型定義
 * モジュール間の循環参照を避けるために型定義を集約
 */

/**
 * タグカテゴリ
 */
export interface TagCategory {
    name: string;
    isDefault: boolean;  // デフォルトカテゴリかどうか
    createdAt: number;
}

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
 * uBlockルール（ublockMatcher.ts 用）
 */
export interface UblockRule {
    domain: string;
    options?: Record<string, unknown>;
    [key: string]: unknown;
}

/**
 * uBlock形式ルールセット
 * ストレージに保存される軽量なルールデータ構造
 */
export interface UblockRules {
    blockDomains: string[];
    exceptionDomains: string[];
    blockRules?: UblockRule[];      // 古い形式との互換性（ublockMatcher.ts 用）
    exceptionRules?: UblockRule[];  // 古い形式との互換性（ublockMatcher.ts 用）
    metadata?: {
        importedAt: number;
        ruleCount: number;
    };
}

/**
 * uBlockソース
 */
export interface Source {
    url: string;
    ruleCount: number;
    blockDomains: string[];
    exceptionDomains: string[];
    importedAt: number;
}