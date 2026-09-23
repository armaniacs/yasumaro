/**
 * BuiltInAiProvider
 * AIProviderStrategy アダプター for Chrome Built-in AI (BuiltInAIClient)
 *
 * ADR-015 の Strategy-only 方針に従い、built-in-ai を AIProviderStrategy
 * として登録する。内部的に BuiltInAIClient に委譲する。
 */

import { Settings } from '../../../utils/storage/types.js';
import { AIProviderStrategy, AISummaryResult, AIProviderConnectionResult, CONNECTION_TEST_PROMPT } from './ProviderStrategy.js';
import { BuiltInAIClient, type BuiltInAISummaryResult, type BuiltInAISummarizeOptions } from '../../builtInAIClient.js';
import { applyCustomPrompt } from '../../../utils/customPromptUtils.js';
import { LogType } from '../../../utils/logger/types.js';
import { addLog } from '../../../utils/logger/core.js';
import { errorMessage } from '../../../utils/errorUtils.js';
import { pickDefined } from '../../../utils/objectUtils.js';
import { PROVIDER_ALLOWLIST_ROWS } from '../../../utils/storage/providerAllowlist.js';

/**
 * The on-device summarize surface BuiltInAiProvider depends on. Structural so
 * tests can substitute a fake client without constructing BuiltInAIClient.
 */
export interface BuiltInAiSummarizer {
    summarize(content: string, options?: BuiltInAISummarizeOptions): Promise<BuiltInAISummaryResult>;
    /** Availability of the on-device model, e.g. 'available' / 'unavailable'. */
    getAvailability?(): Promise<string>;
}

export class BuiltInAiProvider extends AIProviderStrategy {
    private builtInAiClient: BuiltInAiSummarizer;

    constructor(settings: Settings, builtInAiClient: BuiltInAiSummarizer = new BuiltInAIClient()) {
        super(settings);
        // Structural baseUrl gate (same tier as the HTTP providers'): this
        // provider must never grow a settings-derived endpoint silently. The
        // allowlist row must stay baseUrlKey-less; adding one means the row
        // now carries a remote credential target and needs the full
        // origin-authorization gate wired before construction may proceed.
        const row = PROVIDER_ALLOWLIST_ROWS.find((r) => r.id === 'built-in-ai');
        if (row?.baseUrlKey !== undefined) {
            throw new Error('built-in-ai must not declare a baseUrlKey (on-device contract)');
        }
        this.builtInAiClient = builtInAiClient;
    }

    /**
     * コンテンツの要約を生成する
     */
    async generateSummary(content: string, tagSummaryMode?: boolean, _traceId?: string): Promise<AISummaryResult> {
        try {
            // Prompt-injection sanitize is owned by BuiltInAIClient.summarize
            // itself (checkPromptSafety with the on-device 'builtin-input'
            // profile). Adding a provider-side pass here would apply the HTTP
            // 'provider-input' profile to on-device content and run the check
            // twice with divergent labels; every caller of the client gets the
            // same single verdict at the model boundary.

            // Custom prompts (including 'all'-scope ones) apply here exactly as
            // they do for HTTP providers; without one the legacy raw-content
            // prompt is preserved.
            const { userPrompt, systemPrompt, isCustom } = applyCustomPrompt(
                this.settings,
                'built-in-ai',
                content,
                tagSummaryMode ?? false
            );
            const customPromptOptions = isCustom
                ? {
                    promptOverride: userPrompt,
                    ...(systemPrompt !== undefined ? { systemPromptOverride: systemPrompt } : {}),
                }
                : undefined;

            // checkPreFlight() is intentionally skipped: it enforces monthly
            // spend limits, usage warnings and rate limits, all of which exist
            // to protect against paid-API cost. On-device inference has no such
            // cost and no server-side rate limit.
            // getMaxTokens() is likewise skipped: BuiltInAIClient.summarize()
            // takes no token budget parameter.
            const result = isCustom
                ? await this.builtInAiClient.summarize(content, customPromptOptions)
                : await this.builtInAiClient.summarize(content);
            if (!result.success) {
                return {
                    success: false,
                    summary: result.error || 'Built-in AI returned no content',
                };
            }

            await this.recordUsageIfPresent(result.sentTokens, result.receivedTokens);

            return {
                success: true,
                summary: result.summary || '',
                providerName: 'built-in-ai',
                modelName: 'built-in-ai',
                ...pickDefined({ sentTokens: result.sentTokens, receivedTokens: result.receivedTokens }),
            };
        } catch (error: unknown) {
            addLog(LogType.ERROR, `Built-in AI generateSummary failed: ${errorMessage(error)}`, {});
            return {
                success: false,
                summary: `Error: Failed to generate summary. ${errorMessage(error)}`,
            };
        }
    }

    /**
     * 接続テストを実行する
     */
    async testConnection(): Promise<AIProviderConnectionResult> {
        try {
            const result = await this.builtInAiClient.summarize(CONNECTION_TEST_PROMPT);
            if (result.success && result.summary && result.summary.length > 0) {
                return {
                    success: true,
                    message: 'ok',
                    debug: {
                        prompt: CONNECTION_TEST_PROMPT,
                        response: result.summary,
                        endpoint: 'on-device (Built-in AI)',
                        hasContent: true,
                    },
                };
            }

            const errorMsg = result.error || (result.summary ? 'Summary was empty' : 'Provider reported failure');
            return {
                success: false,
                message: errorMsg,
                debug: {
                    prompt: CONNECTION_TEST_PROMPT,
                    endpoint: 'on-device (Built-in AI)',
                    hasContent: false,
                    ...pickDefined({ response: result.summary || undefined, error: result.error }),
                },
            };
        } catch (error: unknown) {
            const msg = errorMessage(error);
            addLog(LogType.ERROR, `Connection test failed for built-in-ai: ${msg}`, {});
            return {
                success: false,
                message: msg,
                debug: {
                    prompt: CONNECTION_TEST_PROMPT,
                    endpoint: 'on-device (Built-in AI)',
                    error: msg,
                    hasContent: false,
                },
            };
        }
    }

    /**
     * プロバイダー名を取得
     */
    getName(): string {
        return 'built-in-ai';
    }

    /**
     * プロバイダーIDを取得
     */
    override getProviderId(): string {
        return 'built-in-ai';
    }
}
