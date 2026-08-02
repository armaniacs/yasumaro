/**
 * builtInAIClient.ts
 * Built-in AI (Prompt API) Client — Chrome (Gemini Nano) and Edge (Phi-mini)
 * Service Worker (Manifest V3) から self.LanguageModel を直接呼び出す。
 * Offscreen Document は経由しない（2026-07-28 実機検証で Service Worker 直接呼び出しの
 * 成功を確認済み。詳細: dev-docs/2026-07-28-built-in-ai-provider-integration-design.md）
 *
 * 2026-07-30 実機検証（Edge 150.0.4078.105 stable, Mac）により、Edge の Phi-mini は
 * self.LanguageModel を Chrome と同一の API 形状（availability()/create()/session.prompt()/
 * contextWindow/contextUsage/oncontextoverflow）で提供することを確認済み。
 * ブラウザごとの API 呼び出し分岐は不要で、差分はコンテキストウィンドウの実測値
 * （案内: pbi/2026-07-30-38-feat-edge-phi-mini-provider-support.md）と
 * unavailable 時の案内文言（フラグURL）のみ。
 */

import { addLog, LogType } from '../utils/logger.js';
import { sanitizePromptContent, DangerLevel } from '../utils/promptSanitizer.js';
import { errorMessage } from '../utils/errorUtils.js';
import { getProviderMaxTokens } from '../utils/aiLimits.js';
import { getMessage } from '../utils/i18n.js';
import { getBrowserName, getBuiltInAIFlagGuidance } from '../utils/browserSupport.js';

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
    inputQuota?: number;
    oncontextoverflow?: ((event: Event) => void) | null;
}

/** Progress reported while the on-device model downloads (Prompt API `monitor` option). */
export interface LanguageModelDownloadProgressEvent {
    loaded: number;
}

/** Passed to `LanguageModel.create({ monitor })` to observe download progress. */
export interface LanguageModelDownloadMonitor {
    addEventListener(type: 'downloadprogress', listener: (event: LanguageModelDownloadProgressEvent) => void): void;
}

interface LanguageModelGlobal {
    availability(): Promise<BuiltInAIAvailability>;
    create(options?: {
        initialPrompts?: Array<{ role: string; content: string }>;
        monitor?: (monitor: LanguageModelDownloadMonitor) => void;
    }): Promise<LanguageModelSession>;
}

declare global {
    // eslint-disable-next-line no-var
    var LanguageModel: LanguageModelGlobal | undefined;
}

const SYSTEM_PROMPT = `あなたはWebページ要約のエキスパートです。
与えられたテキストを日本語で1文または2文に要約してください。
重要なポイントのみを抽出し、個人情報や機密情報は含めないでください。
改行しないでください。`;

/**
 * Conservative chars-per-token estimate for Japanese/mixed content, used to derive
 * a dynamic truncation limit from session.contextWindow (token-based).
 * Deliberately conservative: real ratio varies by tokenizer and content language.
 */
const CHARS_PER_TOKEN_ESTIMATE = 2;

/** Safety margin applied to the contextWindow-derived limit to avoid QuotaExceededError. */
const CONTEXT_WINDOW_SAFETY_MARGIN = 0.8;

/**
 * Derive the effective truncation limit (in chars) from the static per-provider
 * limit and the session's actual contextWindow (in tokens), when available.
 * Takes the smaller of the two so a narrow on-device context window (e.g. Edge
 * Phi-mini's measured 9216 tokens) doesn't get overrun by the static 16,384-char cap.
 */
function computeEffectiveMaxChars(staticMaxChars: number, contextWindowTokens: number | undefined): number {
    // Treat both "undefined" (property unsupported) and "0" (no window reported)
    // as "no usable value" and fall back to the static limit.
    if (!contextWindowTokens) {
        return staticMaxChars;
    }
    const dynamicMaxChars = Math.floor(contextWindowTokens * CHARS_PER_TOKEN_ESTIMATE * CONTEXT_WINDOW_SAFETY_MARGIN);
    return Math.min(staticMaxChars, dynamicMaxChars);
}

/**
 * Build the localized "unavailable" error message, including flag guidance
 * (URL + name) for the detected browser when one is known (Chrome/Edge).
 * Falls back to a generic message when the browser or flag is unrecognized.
 */
function buildUnavailableMessage(status: BuiltInAIAvailability): string {
    const browserName = getBrowserName();
    const guidance = getBuiltInAIFlagGuidance(browserName);
    if (!guidance) {
        return getMessage('builtInAiUnavailableGeneric', { status }) || `Built-in AI is currently ${status}`;
    }
    return getMessage('builtInAiUnavailableWithFlag', { status, flagUrl: guidance.url, flagName: guidance.flagName })
        || `Built-in AI is currently ${status}. Enable "${guidance.flagName}" at ${guidance.url}`;
}

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

        const staticMaxChars = getProviderMaxTokens('localai');

        // Use cached availability when available; only call LanguageModel.availability()
        // when uncached ('downloading' is handled by getAvailability re-check).
        const status = this._availabilityCache && this._availabilityCache !== 'downloading'
            ? this._availabilityCache
            : await this.getAvailability();
        if (status !== 'available') {
            return { success: false, error: buildUnavailableMessage(status) };
        }

        const languageModel = globalThis.LanguageModel;
        if (!languageModel) {
            // Defensive: unreachable in practice since status === 'available' was
            // just confirmed above, but guards against LanguageModel disappearing
            // between the check and this point.
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

        // inputQuota is logged for diagnostics only; the truncation limit below is
        // derived from contextWindow (the session's total capacity) since this is a
        // freshly created single-turn session where inputQuota is expected to match it.
        addLog(LogType.DEBUG, 'BuiltInAIClient: session context info', {
            contextWindow: session.contextWindow,
            inputQuota: session.inputQuota,
        });

        let contextOverflowed = false;
        session.oncontextoverflow = () => {
            contextOverflowed = true;
            addLog(LogType.WARN, 'BuiltInAIClient: context overflow occurred, older content may have been dropped', {
                contextWindow: session.contextWindow,
            });
        };

        const effectiveMaxChars = computeEffectiveMaxChars(staticMaxChars, session.contextWindow);
        const truncatedContent = sanitizeResult.sanitized.substring(0, effectiveMaxChars);

        try {
            const summary = await session.prompt(truncatedContent);
            if (contextOverflowed) {
                addLog(LogType.WARN, 'BuiltInAIClient: summary returned after a context overflow; result may be based on truncated context', {});
            }
            return {
                success: true,
                summary,
                sentTokens: truncatedContent.length,
                receivedTokens: summary.length,
            };
        } catch (error: unknown) {
            addLog(LogType.ERROR, 'BuiltInAIClient: Prompt failed', {
                error: errorMessage(error),
                contextOverflowed,
            });
            return { success: false, error: `Prompt failed: ${errorMessage(error)}` };
        } finally {
            session.destroy();
        }
    }
}
