/**
 * localAiClient.ts
 * ローカルAI (Prompt API) Client
 * Service Worker (Manifest V3) environment -> Offscreen Document -> window.ai
 */
export interface LocalAISummaryResult {
    success: boolean;
    summary?: string;
    error?: string;
}
export type LocalAIAvailability = 'readily' | 'after-download' | 'no' | 'unsupported';
interface OffscreenResponse {
    status?: LocalAIAvailability;
    success?: boolean;
    summary?: string;
    error?: string;
    [key: string]: any;
}
export declare class LocalAIClient {
    private creatingOffscreenPromise;
    constructor();
    /**
     * Ensure the offscreen document is open.
     * @returns {Promise<void>}
     */
    ensureOffscreenDocument(): Promise<void>;
    /**
     * Send a message to the offscreen document.
     */
    msgOffscreen(type: string, payload?: Record<string, any>): Promise<OffscreenResponse>;
    /**
     * Check if Prompt API is available.
     * @returns {Promise<'readily'|'after-download'|'no'|'unsupported'>}
     */
    getAvailability(): Promise<LocalAIAvailability>;
    /**
     * Check if ready to use immediately.
     */
    isAvailable(): Promise<boolean>;
    /**
     * Summarize content.
     * @returns {Promise<{success: boolean, summary: string|null, error?: string}>}
     */
    summarize(content: string): Promise<LocalAISummaryResult>;
}
export {};
//# sourceMappingURL=localAiClient.d.ts.map