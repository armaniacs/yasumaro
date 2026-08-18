/**
 * BuiltInAiProvider
 * AIProviderStrategy アダプター for Chrome Built-in AI (BuiltInAIClient)
 *
 * ADR-015 の Strategy-only 方針に従い、built-in-ai を AIProviderStrategy
 * として登録する。内部的に BuiltInAIClient に委譲する。
 */

import { Settings } from '../../../utils/storage.js';
import { AIProviderStrategy, AISummaryResult, AIProviderConnectionResult, CONNECTION_TEST_PROMPT } from './ProviderStrategy.js';
import { BuiltInAIClient } from '../../builtInAIClient.js';
import { addLog, LogType } from '../../../utils/logger.js';
import { errorMessage } from '../../../utils/errorUtils.js';

export class BuiltInAiProvider extends AIProviderStrategy {
    private builtInAiClient: BuiltInAIClient;

    constructor(settings: Settings) {
        super(settings);
        this.builtInAiClient = new BuiltInAIClient();
    }

    /**
     * コンテンツの要約を生成する
     */
    async generateSummary(content: string, _tagSummaryMode?: boolean, _traceId?: string): Promise<AISummaryResult> {
        try {
            // Prompt-injection guard. The model runs on-device so nothing leaves
            // the machine, but an injected instruction can still poison the
            // summary that gets written into the user's Obsidian vault.
            const { blocked, sanitized } = this.sanitizeContent(content, 'built-in-ai', _traceId ?? '');
            if (blocked) {
                return {
                    success: false,
                    summary: 'Error: Content blocked due to potential prompt injection.',
                };
            }

            // checkPreFlight() is intentionally skipped: it enforces monthly
            // spend limits, usage warnings and rate limits, all of which exist
            // to protect against paid-API cost. On-device inference has no such
            // cost and no server-side rate limit.
            // getMaxTokens() is likewise skipped: BuiltInAIClient.summarize()
            // takes no token budget parameter.
            const result = await this.builtInAiClient.summarize(sanitized);
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
                sentTokens: result.sentTokens,
                receivedTokens: result.receivedTokens,
                providerName: 'built-in-ai',
                modelName: 'built-in-ai',
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
                    response: result.summary || undefined,
                    endpoint: 'on-device (Built-in AI)',
                    error: result.error,
                    hasContent: false,
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
