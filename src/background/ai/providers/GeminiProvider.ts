/**
 * GeminiProvider
 * Google Gemini APIを使用するAIプロバイダー
 */

import { AIProviderStrategy, AIProviderConnectionResult, AISummaryResult, CONNECTION_TEST_PROMPT } from './ProviderStrategy.js';
import { fetchWithRetry, validateUrlForAIRequests } from '../../../utils/fetch.js';
import { addLog, LogType } from '../../../utils/logger.js';
import { getAllowedUrls, Settings, StorageKeys } from '../../../utils/storage.js';
import { errorMessage } from '../../../utils/errorUtils.js';
import { applyCustomPrompt, getDefaultSystemPrompt } from '../../../utils/customPromptUtils.js';
import { recordUsage } from '../../../utils/aiUsageTracker.js';

interface GeminiApiResponse {
    candidates?: Array<{ content?: { parts: Array<{ text: string }> } }>;
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

export class GeminiProvider extends AIProviderStrategy {
    private apiKey: string;
    private model: string;
    private timeoutMs: number;

    constructor(settings: Settings) {
        super(settings);
        // storage.jsのStorageKeysと対応するキー名を使用（snake_case）
        this.apiKey = (settings.gemini_api_key as string) || '';
        this.model = settings.gemini_model || 'gemini-3.1-flash-lite';
        // タイムアウト設定: 設定値が0の場合はデフォルト30000ms
        const storedTimeout = Number(settings[StorageKeys.AI_TIMEOUT_MS] ?? 0);
        this.timeoutMs = storedTimeout > 0 ? storedTimeout : 30000;
    }

    getName(): string {
        return 'gemini';
    }

    /**
     * 要約を生成する
     * @param {string} content - 要約対象のコンテンツ
     * @param {boolean} [tagSummaryMode=false] - タグ付き要約モード
     */
    async generateSummary(content: string, tagSummaryMode: boolean = false, traceId: string = ''): Promise<AISummaryResult> {
        if (!this.apiKey) {
            return { success: false, summary: "Error: API key is missing. Please check your settings." };
        }

        // 共通プリフライトガード
        const preFlight = await this.checkPreFlight();
        if (preFlight.blocked) {
            return { success: false, summary: preFlight.message! };
        }

        const cleanModelName = this.model.replace(/^models\//, '');
        const apiVersion = this._getApiVersion();
        const url = `https://generativelanguage.googleapis.com/${apiVersion}/models/${cleanModelName}:generateContent`;
        const maxContentChars = this.getMaxContentChars(30_000, StorageKeys.GEMINI_CONTENT_CHARS);
        const truncatedContent = content.substring(0, maxContentChars);

        // 共通サニタイズ
        const sanitizeResult = this.sanitizeContent(truncatedContent, this.getName(), traceId);
        if (sanitizeResult.blocked) {
            return { success: false, summary: `Error: Content blocked due to potential security risk. (原因: ${sanitizeResult.warnings.join('; ')})` };
        }

        // カスタムプロンプトを適用（タグ付き要約モード対応）
        const { userPrompt, systemPrompt } = applyCustomPrompt(this.settings, this.getName(), sanitizeResult.sanitized, tagSummaryMode);

        const payload = {
            systemInstruction: {
                parts: [{
                    text: systemPrompt || getDefaultSystemPrompt()
                }]
            },
            contents: [{
                parts: [{
                    text: userPrompt
                }]
            }],
            generationConfig: {
                temperature: 0.1,
                maxOutputTokens: this.getMaxTokens()
            }
        };

        try {
            const allowedUrls = await this._getAllowedUrls();

            const response = await fetchWithRetry(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-goog-api-key': this.apiKey
                },
                body: JSON.stringify(payload),
                allowedUrls,
                timeoutMs: this.timeoutMs
            }, {
                maxRetryCount: 3,
                initialDelayMs: 1000,
                backoffMultiplier: 2,
                maxDelayMs: 60000
            });

            if (!response.ok) {
                return this._handleError(response);
            }

            const data = await response.json();
            return await this._extractSummary(data, traceId);
        } catch (error: unknown) {
            const msg = errorMessage(error);
            const isTimeout = error instanceof Error && error.name === 'AbortError';
            if (isTimeout || msg.includes('timed out')) {
                return { success: false, summary: "Error: AI request timed out. Please check your connection." };
            }
            return { success: false, summary: "Error: Failed to generate summary. Please try again or check your settings." };
        }
    }

    private _getApiVersion(): string {
        const version = (this.settings[StorageKeys.GEMINI_API_VERSION] as string | undefined)?.trim();
        if (version && /^(v\d+([a-z]+)?)$/.test(version)) {
            return version;
        }
        return 'v1beta';
    }

    async testConnection(): Promise<AIProviderConnectionResult> {
        if (!this.apiKey) {
            return {
                success: false,
                message: 'Gemini API Key is not set.',
                debug: { error: 'API key is missing' },
            };
        }

        // モデル一覧(GET /models)ではなく実際に推論を走らせる。メタデータ取得では
        // APIキーの有効性やモデル名の妥当性、実際の応答内容が検証できないため。
        const cleanModelName = this.model.replace(/^models\//, '');
        const testUrl = `https://generativelanguage.googleapis.com/${this._getApiVersion()}/models/${cleanModelName}:generateContent`;

        // BaseUrl SSRF対策 - テストURLの検証
        try {
            validateUrlForAIRequests(testUrl);
        } catch (error: unknown) {
            addLog(LogType.ERROR, `Invalid test URL for Gemini: ${errorMessage(error)}`);
            return {
                success: false,
                message: `Invalid test URL: ${errorMessage(error)}`,
                debug: { error: errorMessage(error) },
            };
        }

        const payload = {
            contents: [{ parts: [{ text: CONNECTION_TEST_PROMPT }] }],
            generationConfig: { maxOutputTokens: 16, temperature: 0 },
        };

        try {
            const allowedUrls = await this._getAllowedUrls();

            const response = await fetchWithRetry(
                testUrl,
                {
                    method: 'POST',
                    headers: {
                        'x-goog-api-key': this.apiKey,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(payload),
                    allowedUrls,
                    timeoutMs: this.timeoutMs
                },
                {
                    maxRetryCount: 1,
                    initialDelayMs: 500,
                    backoffMultiplier: 2,
                    maxDelayMs: 3000
                }
            );

            if (!response.ok) {
                const mapped = this.mapConnectionError(response.status, 'Gemini');
                return {
                    ...mapped,
                    debug: {
                        ...mapped.debug,
                        prompt: CONNECTION_TEST_PROMPT,
                        endpoint: `POST ${testUrl}`,
                        statusCode: response.status,
                    },
                };
            }

            const data = await response.json() as GeminiApiResponse;
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
            const hasContent = text.trim().length > 0;

            return {
                success: hasContent,
                message: hasContent ? 'Connected to Gemini API.' : 'Response contained no content.',
                debug: {
                    prompt: CONNECTION_TEST_PROMPT,
                    response: hasContent ? text : undefined,
                    endpoint: `POST ${testUrl}`,
                    modelName: cleanModelName,
                    statusCode: response.status,
                    hasContent,
                    ...(data.usageMetadata?.promptTokenCount !== undefined ? { sentTokens: data.usageMetadata.promptTokenCount } : {}),
                    ...(data.usageMetadata?.candidatesTokenCount !== undefined ? { receivedTokens: data.usageMetadata.candidatesTokenCount } : {}),
                    ...(hasContent ? {} : { error: 'candidates[0].content.parts[0].text was empty' }),
                },
            };
        } catch (e: unknown) {
            const msg = errorMessage(e);
            const errorName = e instanceof Error ? e.name : undefined;
            // 共通エラーパース
            const mapped = this.parseAndMapFetchError(msg, 'Gemini', errorName);
            return {
                ...mapped,
                debug: { ...mapped.debug, prompt: CONNECTION_TEST_PROMPT, endpoint: `POST ${testUrl}` },
            };
        }
    }

    private async _getAllowedUrls(): Promise<Set<string>> {
        return getAllowedUrls();
    }

    private async _handleError(response: Response): Promise<AISummaryResult> {
        // const errorText = await response.text();
        if (response.status === 404) {
            return { success: false, summary: "Error: Model not found. Please check your AI model settings." };
        }
        return { success: false, summary: "Error: Failed to generate summary. Please check your API settings." };
    }

    private async _extractSummary(data: GeminiApiResponse, traceId: string = ''): Promise<AISummaryResult> {
        if (!data.candidates || data.candidates.length === 0) {
            const error = 'Gemini schema validation failed: candidates is missing or empty';
            addLog(LogType.ERROR, error, { traceId });
            return { success: false, summary: "Error: Invalid API response format - unexpected schema.", error };
        }
        if (!data.candidates[0].content) {
            const error = 'Gemini schema validation failed: candidates[0].content is missing';
            addLog(LogType.ERROR, error, { traceId });
            return { success: false, summary: "Error: Invalid API response format - unexpected schema.", error };
        }
        const parts = data.candidates[0].content.parts;
        if (!parts || parts.length === 0 || typeof parts[0].text !== 'string') {
            const error = 'Gemini schema validation failed: candidates[0].content.parts[0].text is not a string';
            addLog(LogType.ERROR, error, { traceId });
            return { success: false, summary: "Error: Invalid API response format - unexpected schema.", error };
        }
        const summary = parts[0].text;
        const sentTokens = data.usageMetadata?.promptTokenCount || 0;
        const receivedTokens = data.usageMetadata?.candidatesTokenCount || 0;

        // トークン使用量を記録
        await recordUsage(sentTokens, receivedTokens);

        return { success: true, summary, sentTokens, receivedTokens, providerName: this.getName(), modelName: this.model };
    }
}