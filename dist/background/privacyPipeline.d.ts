import { Settings } from '../utils/storage.js';
interface IAIClient {
    getLocalAvailability(): Promise<string>;
    summarizeLocally(content: string): Promise<{
        success: boolean;
        summary: string;
    }>;
    generateSummary(text: string): Promise<string>;
}
interface ISanitizers {
    sanitizeRegex(text: string): Promise<{
        text: string;
        maskedItems: any[];
    }>;
}
export interface PrivacyPipelineOptions {
    previewOnly?: boolean;
    alreadyProcessed?: boolean;
}
export interface PrivacyPipelineResult {
    summary?: string;
    success?: boolean;
    preview?: boolean;
    processedContent?: string;
    mode?: string;
    maskedCount?: number;
    maskedItems?: any[];
}
export declare class PrivacyPipeline {
    private settings;
    private aiClient;
    private sanitizers;
    private mode;
    constructor(settings: Settings, aiClient: IAIClient, sanitizers: ISanitizers);
    process(content: string, options?: PrivacyPipelineOptions): Promise<PrivacyPipelineResult>;
    private _logMasking;
}
export {};
//# sourceMappingURL=privacyPipeline.d.ts.map