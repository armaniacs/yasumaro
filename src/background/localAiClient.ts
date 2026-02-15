/**
 * localAiClient.ts
 * ローカルAI (Prompt API) Client
 * Service Worker (Manifest V3) environment -> Offscreen Document -> window.ai
 */

import { addLog, LogType } from '../utils/logger.js';

const OFFSCREEN_DOCUMENT_PATH = 'src/offscreen/offscreen.html';
const MESSAGE_TIMEOUT_MS = 30000; // 30秒

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

export class LocalAIClient {
    private creatingOffscreenPromise: Promise<void> | null;

    constructor() {
        this.creatingOffscreenPromise = null;
    }

    /**
     * Ensure the offscreen document is open.
     * @returns {Promise<void>}
     */
    async ensureOffscreenDocument(): Promise<void> {
        const hasOffscreen = await chrome.offscreen.hasDocument();
        if (hasOffscreen) return;

        if (this.creatingOffscreenPromise) {
            await this.creatingOffscreenPromise;
            return;
        }

        this.creatingOffscreenPromise = chrome.offscreen.createDocument({
            url: OFFSCREEN_DOCUMENT_PATH,
            reasons: [chrome.offscreen.Reason.WORKERS], // generic reason for "background work"
            justification: 'To access the chrome.ai Prompt API which is only available in window context.',
        });

        await this.creatingOffscreenPromise;
        this.creatingOffscreenPromise = null;
    }

    /**
     * Send a message to the offscreen document.
     */
    async msgOffscreen(type: string, payload: Record<string, any> = {}): Promise<OffscreenResponse> {
        await this.ensureOffscreenDocument();
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({
                type,
                target: 'offscreen',
                payload
            }, (response: OffscreenResponse) => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                } else if (response && response.error) {
                    reject(new Error(response.error));
                } else {
                    resolve(response);
                }
            });
        });
    }

    /**
     * Check if Prompt API is available.
     * @returns {Promise<'readily'|'after-download'|'no'|'unsupported'>}
     */
    async getAvailability(): Promise<LocalAIAvailability> {
        try {
            const response = await this.msgOffscreen('CHECK_AVAILABILITY');
            return response?.status || 'unsupported';
        } catch (e: any) {
            addLog(LogType.ERROR, 'LocalAIClient: Failed to check availability via offscreen', { error: e.message });
            return 'unsupported';
        }
    }

    /**
     * Check if ready to use immediately.
     */
    async isAvailable(): Promise<boolean> {
        const status = await this.getAvailability();
        return status === 'readily';
    }

    /**
     * Summarize content.
     * @returns {Promise<{success: boolean, summary: string|null, error?: string}>}
     */
    async summarize(content: string): Promise<LocalAISummaryResult> {
        if (!content) {
            return { success: false, error: 'Invalid content' };
        }

        let timeoutId: NodeJS.Timeout | undefined;
        try {
            const response = await Promise.race([
                this.msgOffscreen('SUMMARIZE', { content }),
                new Promise<OffscreenResponse>((_, reject) => {
                    timeoutId = setTimeout(() => {
                        reject(new Error('Error: Local AI request timed out. Please try again.'));
                    }, MESSAGE_TIMEOUT_MS);
                })
            ]);

            // 成功またはエラー応答をクリアする
            if (timeoutId) {
                clearTimeout(timeoutId);
            }

            if (response.success) {
                return { success: true, summary: response.summary };
            } else {
                return { success: false, error: response.error };
            }
        } catch (error: any) {
            // タイムアウトやその他のエラー時にクリアする
            if (timeoutId) {
                clearTimeout(timeoutId);
            }

            if (error.message.includes('timed')) {
                addLog(LogType.ERROR, 'LocalAIClient: Summarization timed out', { timeout: MESSAGE_TIMEOUT_MS });
            } else {
                addLog(LogType.ERROR, 'LocalAIClient: Summarization failed', { error: error.message });
            }
            return { success: false, error: error.message };
        }
    }
}
