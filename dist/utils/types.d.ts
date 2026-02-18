/**
 * types.ts
 * 共通型定義
 * モジュール間の循環参照を避けるために型定義を集約
 */
/**
 * カスタムプロンプトのデータ構造
 */
export interface CustomPrompt {
    id: string;
    name: string;
    prompt: string;
    systemPrompt?: string;
    provider: 'gemini' | 'openai' | 'openai2' | 'all';
    isActive: boolean;
    createdAt: number;
    updatedAt: number;
}
/**
 * uBlock形式ルールセット
 */
export interface UblockRules {
    blockDomains?: Set<string>;
    exceptionDomains?: Set<string>;
}
/**
 * uBlockソース
 */
export interface Source {
    url: string;
    ruleCount: number;
    blockDomains: string[];
    exceptionDomains: string[];
    importedAt?: number;
}
//# sourceMappingURL=types.d.ts.map