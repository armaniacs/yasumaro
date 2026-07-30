/**
 * builtInAIClient.ts
 * Chrome Built-in AI (Prompt API) Client
 * Service Worker (Manifest V3) から self.LanguageModel を直接呼び出す。
 * Offscreen Document は経由しない（2026-07-28 実機検証で Service Worker 直接呼び出しの
 * 成功を確認済み。詳細: dev-docs/2026-07-28-built-in-ai-provider-integration-design.md）
 */

import { addLog, LogType } from '../utils/logger.js';
import { sanitizePromptContent, DangerLevel } from '../utils/promptSanitizer.js';
import { errorMessage } from '../utils/errorUtils.js';
import { getProviderMaxTokens } from '../utils/aiLimits.js';

export type BuiltInAIAvailability = 'available' | 'downloadable' | 'downloading' | 'unavailable';

export interface BuiltInAISummaryResult {
    success: boolean;
    summary?: string;
    error?: string;
    sentTokens?: number;
    receivedTokens?: number;
}

interface LanguageModelSession {
    prompt(text: string): Promise<string>;
    destroy(): void;
    contextWindow?: number;
    contextUsage?: number;
}

interface LanguageModelGlobal {
    availability(): Promise<BuiltInAIAvailability>;
    create(options?: { initialPrompts?: Array<{ role: string; content: string }> }): Promise<LanguageModelSession>;
}

declare global {
    // eslint-disable-next-line no-var
    var LanguageModel: LanguageModelGlobal | undefined;
}

const SYSTEM_PROMPT = `あなたはWebページ要約のエキスパートです。
与えられたテキストを日本語で1文または2文に要約してください。
重要なポイントのみを抽出し、個人情報や機密情報は含めないでください。
改行しないでください。`;

export class BuiltInAIClient {
    /** Cache for availability to avoid redundant LanguageModel.availability() calls.
     *  null means uncached; otherwise one of the BuiltInAIAvailability values.
     *  Reset when 'downloading' is detected so the next call re-checks. */
    private _availabilityCache: BuiltInAIAvailability | null = null;

    /**
     * Check if the Prompt API (LanguageModel) is available.
     * Returns cached value when available (except 'downloading' which always re-checks).
     */
    async getAvailability(): Promise<BuiltInAIAvailability> {
        if (this._availabilityCache && this._availabilityCache !== 'downloading') {
            return this._availabilityCache;
        }

        const languageModel = globalThis.LanguageModel;
        if (!languageModel) {
            this._availabilityCache = 'unavailable';
            return 'unavailable';
        }
        try {
            const status = await languageModel.availability();
            this._availabilityCache = status;
            return status;
        } catch (error: unknown) {
            addLog(LogType.ERROR, 'BuiltInAIClient: Failed to check availability', { error: errorMessage(error) });
            this._availabilityCache = 'unavailable';
            return 'unavailable';
        }
    }

    /**
     * Check if ready to use immediately.
     */
    async isAvailable(): Promise<boolean> {
        const status = await this.getAvailability();
        return status === 'available';
    }

    /**
     * Reset availability cache. Useful for testing or when the model state
     * is known to have changed (e.g., after a download completes).
     */
    resetAvailabilityCache(): void {
        this._availabilityCache = null;
    }

    /**
     * Summarize content.
     */
    async summarize(content: string): Promise<BuiltInAISummaryResult> {
        if (!content) {
            return { success: false, error: 'Invalid content' };
        }

        // Sanitize content to prevent prompt injection (match LocalAIClient/OpenAIProvider behavior)
        const sanitizeResult = sanitizePromptContent(content);
        if (sanitizeResult.dangerLevel === DangerLevel.HIGH) {
            addLog(LogType.WARN, 'Content blocked due to high danger level', { warnings: sanitizeResult.warnings, source: 'BuiltInAI' });
            return { success: false, error: 'Content contains potentially dangerous patterns' };
        }

        const maxChars = getProviderMaxTokens('localai');
        const truncatedContent = sanitizeResult.sanitized.substring(0, maxChars);

        // Use cached availability when available; only call LanguageModel.availability()
        // when uncached ('downloading' is handled by getAvailability re-check).
        const status = this._availabilityCache && this._availabilityCache !== 'downloading'
            ? this._availabilityCache
            : await this.getAvailability();
        if (status !== 'available') {
            return { success: false, error: `Built-in AI is currently ${status}` };
        }

        const languageModel = globalThis.LanguageModel;
        if (!languageModel) {
            return { success: false, error: 'Built-in AI is currently unavailable' };
        }

        let session: LanguageModelSession;
        try {
            session = await languageModel.create({
                initialPrompts: [{ role: 'system', content: SYSTEM_PROMPT }]
            });
        } catch (error: unknown) {
            addLog(LogType.ERROR, 'BuiltInAIClient: Failed to create session', { error: errorMessage(error) });
            return { success: false, error: `Session creation failed: ${errorMessage(error)}` };
        }

        try {
            const summary = await session.prompt(truncatedContent);
            return {
                success: true,
                summary,
                sentTokens: truncatedContent.length,
                receivedTokens: summary.length,
            };
        } catch (error: unknown) {
            addLog(LogType.ERROR, 'BuiltInAIClient: Prompt failed', { error: errorMessage(error) });
            return { success: false, error: `Prompt failed: ${errorMessage(error)}` };
        } finally {
            session.destroy();
        }
    }
}
