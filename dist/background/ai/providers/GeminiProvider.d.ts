/**
 * GeminiProvider
 * Google Gemini APIを使用するAIプロバイダー
 */
import { AIProviderStrategy, AIProviderConnectionResult } from './ProviderStrategy.js';
import { Settings } from '../../../utils/storage.js';
export declare class GeminiProvider extends AIProviderStrategy {
    private apiKey;
    private model;
    private timeoutMs;
    constructor(settings: Settings);
    getName(): string;
    /**
     * 要約を生成する
     * @param {string} content - 要約対象のコンテンツ
     * @param {boolean} [tagSummaryMode=false] - タグ付き要約モード
     */
    generateSummary(content: string, tagSummaryMode?: boolean): Promise<string>;
    testConnection(): Promise<AIProviderConnectionResult>;
    private _getAllowedUrls;
    private _handleError;
    private _extractSummary;
}
//# sourceMappingURL=GeminiProvider.d.ts.map