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
    generateSummary(content: string): Promise<string>;
    testConnection(): Promise<AIProviderConnectionResult>;
    private _getAllowedUrls;
    private _handleError;
    private _extractSummary;
}
//# sourceMappingURL=GeminiProvider.d.ts.map