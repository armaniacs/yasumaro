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
import { pickDefined } from '../../../utils/objectUtils.js';


interface GeminiApiResponse {
    candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
        /** STOP / MAX_TOKENS / SAFETY 等。空応答の原因切り分けに使う。 */
        finishReason?: string;
    }>;
    usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        /** thinking(推論)で消費したトークン。maxOutputTokens に加算される。 */
        thoughtsTokenCount?: number;
    };
    promptFeedback?: { blockReason?: string };
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
                maxOutputTokens: this.getMaxTokens(),
                // Gemini 2.5系以降は thinking がデフォルト有効で、思考トークンが
                // maxOutputTokens に加算される。要約は思考を必要としないため
                // 明示的に切り、枠をすべて本文に使う。これを入れないと
                // maxOutputTokens が小さい設定(既定1000)では思考だけで枠を
                // 使い切り、要約が空文字で返る。
                thinkingConfig: { thinkingBudget: 0 }
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
                maxDelayMs: 60000,
                shouldRetry: (error, attempt, response, method) =>
                    this.shouldRetrySummaryRequest(error, attempt, response, method)
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

        // Gemini 2.5系以降は thinking(推論)がデフォルト有効で、思考トークンが
        // maxOutputTokens に加算される。枠が小さいと思考だけで使い切り、本文が
        // 空のまま finishReason=MAX_TOKENS で返る。そのため
        //   - thinkingBudget: 0 で思考を明示的に切る（対応モデルのみ有効）
        //   - maxOutputTokens は思考が入っても本文が残る余裕を持たせる
        // の二段構えにする。
        const payload = {
            contents: [{ parts: [{ text: CONNECTION_TEST_PROMPT }] }],
            generationConfig: {
                maxOutputTokens: 256,
                temperature: 0,
                thinkingConfig: { thinkingBudget: 0 },
            },
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
            const candidate = data.candidates?.[0];
            // 応答が複数 parts に分かれる場合があるため全て結合する
            const text = (candidate?.content?.parts ?? [])
                .map(part => part.text ?? '')
                .join('')
                .trim();
            const hasContent = text.length > 0;
            const usage = data.usageMetadata;

            return {
                success: hasContent,
                message: hasContent
                    ? 'Connected to Gemini API.'
                    : GeminiProvider.describeEmptyResponse(candidate?.finishReason, data.promptFeedback?.blockReason),
                debug: {
                    prompt: CONNECTION_TEST_PROMPT,
                    endpoint: `POST ${testUrl}`,
                    modelName: cleanModelName,
                    statusCode: response.status,
                    hasContent,
                    ...pickDefined({ response: hasContent ? text : undefined }),
                    ...(usage?.promptTokenCount !== undefined ? { sentTokens: usage.promptTokenCount } : {}),
                    ...(usage?.candidatesTokenCount !== undefined ? { receivedTokens: usage.candidatesTokenCount } : {}),
                    ...(hasContent ? {} : {
                        error: GeminiProvider.describeEmptyResponseDetail(
                            candidate?.finishReason,
                            data.promptFeedback?.blockReason,
                            usage?.thoughtsTokenCount,
                        ),
                    }),
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

    /**
     * 空応答をユーザー向けの一文にする。
     * finishReason ごとに原因が異なるため、一括りに「応答が空」とは言わない。
     */
    private static describeEmptyResponse(finishReason?: string, blockReason?: string): string {
        if (blockReason) return `Request blocked by safety filter (${blockReason}).`;
        switch (finishReason) {
            case 'MAX_TOKENS':
                return 'Response was truncated before any text was produced (MAX_TOKENS).';
            case 'SAFETY':
                return 'Response blocked by safety filter (SAFETY).';
            case 'RECITATION':
                return 'Response blocked as recitation (RECITATION).';
            default:
                return 'Response contained no content.';
        }
    }

    /**
     * 空応答の技術的な内訳。thinking がトークンを食い切ったケースを明示する。
     */
    private static describeEmptyResponseDetail(
        finishReason?: string,
        blockReason?: string,
        thoughtsTokenCount?: number,
    ): string {
        const parts: string[] = ['candidates[0].content.parts had no text'];
        if (finishReason) parts.push(`finishReason=${finishReason}`);
        if (blockReason) parts.push(`blockReason=${blockReason}`);
        if (thoughtsTokenCount !== undefined) {
            parts.push(`thoughtsTokens=${thoughtsTokenCount}`);
            if (finishReason === 'MAX_TOKENS') {
                parts.push('thinking consumed the output budget — raise maxOutputTokens or disable thinking');
            }
        }
        return parts.join(' | ');
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
        // length guard above guarantees [0] exists
        const candidate = data.candidates[0];
        if (!candidate?.content) {
            const error = 'Gemini schema validation failed: candidates[0].content is missing';
            addLog(LogType.ERROR, error, { traceId });
            return { success: false, summary: "Error: Invalid API response format - unexpected schema.", error };
        }
        const parts = candidate.content.parts;
        // 応答が複数 parts に分かれる場合があるため全て結合する
        const summary = (parts ?? []).map(part => part.text ?? '').join('');
        if (summary.trim().length === 0) {
            const finishReason = candidate.finishReason;
            const thoughts = data.usageMetadata?.thoughtsTokenCount;
            const error = GeminiProvider.describeEmptyResponseDetail(
                finishReason,
                data.promptFeedback?.blockReason,
                thoughts,
            );
            addLog(LogType.ERROR, `Gemini returned an empty summary: ${error}`, { traceId });
            // MAX_TOKENS は設定で解決できるため、対処法が分かる文言にする
            if (finishReason === 'MAX_TOKENS') {
                return {
                    success: false,
                    summary: "Error: AI response was truncated before producing text. Increase the max tokens setting.",
                    error,
                };
            }
            return { success: false, summary: "Error: AI returned an empty response.", error };
        }
        const sentTokens = data.usageMetadata?.promptTokenCount;
        const receivedTokens = data.usageMetadata?.candidatesTokenCount;

        // トークン使用量を記録（数値が得られた場合のみ。
        // 以前は || 0 で丸めて必ず記録し、統計に誤った 0 が混入していた）
        await this.recordUsageIfPresent(sentTokens, receivedTokens);

        return { success: true, summary, providerName: this.getName(), modelName: this.model, ...pickDefined({ sentTokens, receivedTokens }) };
    }
}