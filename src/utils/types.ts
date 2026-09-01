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
 * タグ正規化辞書のエントリ
 * from → to のマッピングを定義
 */
export interface TagNormalizationEntry {
    from: string;
    to: string;
}

/**
 * カスタムプロンプトのデータ構造
 */
export interface CustomPrompt {
    id: string;
    name: string;
    prompt: string;           // ユーザープロンプト（{{content}}プレースホルダーを含む）
    systemPrompt?: string;    // OpenAI用システムプロンプト（オプション）
    provider: 'gemini' | 'openai' | 'openai2' | 'lm-studio' | 'ollama' | 'all';
    isActive: boolean;
    createdAt: number;
    updatedAt: number;
}

/**
 * ローカル Markdown 書き出しテンプレートのデータ構造
 */
export interface MarkdownExportTemplate {
    id: string;
    name: string;
    fileTemplate: string;   // {{date}} {{entryCount}} {{entries}} を使用
    entryTemplate: string;  // {{timestamp}} {{title}} {{url}} {{summary}} {{tags}} {{domain}} を使用
    isDefault?: boolean;    // true の場合、編集・削除不可(組み込みデフォルト)
    createdAt: number;
    updatedAt: number;
}

/**
 * Markdown テンプレートのエントリ1件分の生データ
 */
export interface MarkdownTemplateEntryData {
    timestamp: string;
    title: string;
    url: string;
    summary: string;
    tags: string;
    domain: string;
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