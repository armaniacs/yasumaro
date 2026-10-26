/**
 * OpenAIProvider
 * OpenAI互換APIを使用するAIプロバイダー — registry 駆動の Generic 実装
 */

import { AIProviderConnectionResult, AISummaryResult, CONNECTION_TEST_PROMPT } from './ProviderStrategy.js';
import { HttpProviderStrategy, type HttpProviderHooks } from './HttpProviderStrategy.js';
import {
    resolveProviderSettings,
    type ResolvedProviderSettings,
} from './providerSettingsResolver.js';
import { validateUrlForAIRequests } from '../../../utils/fetch.js';
import { LogType } from '../../../utils/logger/types.js';
import { addLog } from '../../../utils/logger/core.js';
import { Settings, StorageKeys, type StorageKey } from '../../../utils/storage/types.js';
import { errorMessage } from '../../../utils/errorUtils.js';
import { FailureKind, createFailure } from '../../../utils/failureTaxonomy.js';
import { getRegistryEntry, isAllowedProviderBaseUrl } from '../providerCatalog.js';
import { assertApiKeyResolved } from '../../../utils/storage/encryptionLockedError.js';
import { PROVIDER_ALLOWLIST_ROWS, isProviderOriginAuthorized } from '../../../utils/storage/providerAllowlist.js';
import { OPENAI_OFFICIAL_BASE_URL } from '../../../utils/storage/providerDefaultBaseUrls.js';
import { pickDefined } from '../../../utils/objectUtils.js';

interface OpenAIApiResponse {
    choices?: Array<{ message?: { content: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/** Confirmed origins for one baseUrl slot, read from the settings blob. */
function collectConfirmed(baseUrlKey: string, settings: Record<string, unknown>): Set<string> {
    const all = settings[StorageKeys.CONFIRMED_PROVIDER_ORIGINS] as Record<string, string[]> | undefined;
    return new Set(all?.[baseUrlKey] ?? []);
}

export class GenericOpenAICompatibleProvider extends HttpProviderStrategy {
    protected providerName: string;
    protected baseUrl: string;
    protected apiKey: string | undefined;
    protected model: string;
    protected timeoutMs: number;
    protected isLocal: boolean;
    private readonly openAIParameters: boolean;
    /**
     * Where the API key was resolved from (storage key name or fallback
     * description). Recorded for diagnostics only — never the key itself.
     */
    readonly apiKeySource: string;
    /**
     * 要約切り詰め上限を参照するストレージキー。providerCatalog の
     * contentCharsKey が SSOT であり、createProviderStrategy がエントリ値を
     * 渡す。エントリにキーがない場合と直接構築時は現行キーと同一の
     * OPENAI_CONTENT_CHARS に倒すため、挙動は不変。
     */
    protected readonly contentCharsKey: StorageKey;
    /**
     * 解決済み値オブジェクト (PBI 2026-10-16-10)。timeout・content上限・
     * token上限はhooks閉包からここだけ読む。未注入時はblobから導出するため
     * 既存の構築呼出しはそのまま動く。Hook形状・catalog・生成注入は不変。
     */
    public readonly resolvedSettings: ResolvedProviderSettings;

    constructor(settings: Settings, providerName: string = 'openai', contentCharsKey?: StorageKey, resolvedSettings?: ResolvedProviderSettings) {
        super(settings);
        this.providerName = providerName;

        const s = settings as Record<string, unknown>;
        const str = (key: string, fallback = '') => String(s[key] ?? fallback) || fallback;

        const entry = getRegistryEntry(providerName);
        if (entry) {
            if (entry.baseUrlKey) {
                this.baseUrl = str(entry.baseUrlKey, entry.defaultBaseUrl ?? '');
            } else {
                this.baseUrl = entry.defaultBaseUrl ?? '';
            }
            if (entry.apiKeyKey) {
                const rawKey = s[entry.apiKeyKey];
                assertApiKeyResolved(rawKey);
                this.apiKey = rawKey as string | undefined;
                this.apiKeySource = entry.apiKeyKey;
            } else {
                this.apiKey = undefined;
                this.apiKeySource = 'none (registry entry has no apiKeyKey)';
            }
            if (entry.modelKey) {
                this.model = str(entry.modelKey, entry.defaultModel ?? '');
            } else {
                this.model = entry.defaultModel ?? '';
            }
            this.isLocal = entry.isLocal;
        } else {
            // Fallback for unknown providers — preserve legacy string-replace behavior.
            // Placement decision (PBI 2026-09-17-10): kept here, not moved into the
            // catalog. Cataloging it would ripple into dropdown order, conformance
            // tests, and createProviderStrategy's UnknownProviderError contract.
            // createProviderStrategy rejects unknown ids before reaching this branch;
            // this path serves direct construction only.
            const normalizedName = providerName.replace('2', '_2').replace(/-/g, '_').toLowerCase();
            this.baseUrl = str(`${normalizedName}_base_url`, 'https://api.openai.com/v1');
            const rawLegacyKey = s[`${normalizedName}_api_key`];
            assertApiKeyResolved(rawLegacyKey);
            this.apiKey = rawLegacyKey as string | undefined;
            this.apiKeySource = `${normalizedName}_api_key (legacy fallback)`;
            const modelKey = providerName === 'openai-compatible' ? StorageKeys.PROVIDER_MODEL : `${normalizedName}_model`;
            this.model = str(modelKey, 'gpt-3.5-turbo');
            this.isLocal = this.baseUrl ? GenericOpenAICompatibleProvider.isLocalUrl(this.baseUrl) : false;
        }

        this.contentCharsKey = contentCharsKey ?? entry?.contentCharsKey ?? StorageKeys.OPENAI_CONTENT_CHARS;

        // Diagnostics: record where the API key came from (SSOT on the base).
        this.logApiKeySource(this.apiKeySource, providerName);

        // BaseUrl SSRF対策 — validateUrlForAIRequests + registry allowlist (PBI04)
        if (this.baseUrl) {
            try {
                validateUrlForAIRequests(this.baseUrl);
                if (!isAllowedProviderBaseUrl(this.baseUrl, this.isLocal)) {
                    throw new Error(`Base URL not allowed for ${providerName}: ${this.baseUrl}`);
                }
                // Origin authorization on top of the deny-only SSRF layer: a
                // baseUrl must be a pinned row domain, a user-confirmed
                // origin, or a loopback. A poisoned setting can no longer
                // point the provider credential at an arbitrary origin.
                const row = PROVIDER_ALLOWLIST_ROWS.find((r) => r.id === providerName);
                if (row && row.baseUrlKey) {
                    const confirmed = isProviderOriginAuthorized(
                        this.baseUrl,
                        row,
                        collectConfirmed(row.baseUrlKey, s),
                    );
                    if (!confirmed.authorized) {
                        throw new Error(
                            `Base URL not authorized for ${providerName}: ${this.baseUrl} (${confirmed.reason})`,
                        );
                    }
                }
                // No allowlist row (direct construction with an unknown id):
                // the factory rejects unknown ids first, so this branch stays
                // on the deny-only SSRF gate alone.
            } catch (error: unknown) {
                addLog(LogType.ERROR, `Invalid baseUrl for ${providerName}: ${errorMessage(error)}`);
                throw new Error(`Invalid baseUrl: ${errorMessage(error)}`);
            }
        }

        // Existing slots keep their own credentials, prompts and budgets.
        // The origin bridge upgrades their request dialect without rewriting
        // settings or copying ciphertext bound to another field name.
        this.openAIParameters = entry?.chatCompletionsDialect === 'openai'
            || (entry?.legacyOpenAIEndpoint === true
                && this.baseUrl !== ''
                && new URL(this.baseUrl).origin === new URL(OPENAI_OFFICIAL_BASE_URL).origin);

        // timeout・上限は解決済み値に一本化: 注入があればそれを使い、
        // なければblobから導出 (既存構築互換)。hooks閉包は以後この値を読む。
        this.resolvedSettings = resolvedSettings ?? resolveProviderSettings(
            settings,
            this.getProviderId(),
            { isLocal: this.isLocal, defaultContentChars: 10_000, contentCharsKey: this.contentCharsKey },
        );
        this.timeoutMs = this.resolvedSettings.timeoutMs;
    }

    static isLocalUrl(url: string): boolean {
        try {
            const { hostname } = new URL(url);
            if (hostname === 'localhost' || hostname.endsWith('.localhost')) return true;
            const firstOctet = Number(hostname.split('.')[0]);
            if (firstOctet === 127) return true;
            if (hostname.toLowerCase() === '::1') return true;
        } catch {
            // 無効なURLは非ローカル扱い
        }
        return false;
    }

    private getMaxContentLength(): number {
        return this.resolvedSettings.maxContentChars;
    }

    getName(): string {
        return this.providerName;
    }

    /**
     * catalog の requiresApiKey が真でキーが空なら true。Gemini 側の
     * `!this.apiKey` gate と同条件。requiresApiKey=false（ollama /
     * lm-studio 等）や catalog 未登録の legacy 直構築は gate しない。
     */
    private isApiKeyMissing(): boolean {
        return getRegistryEntry(this.providerName)?.requiresApiKey === true && !this.apiKey;
    }

    /** Both HTTP flows follow the provider dialect; model names are opaque. */
    private generationParameters(maxTokens: number, temperature: number): Record<string, number> {
        // Official completion budgets include reasoning tokens. Omitting
        // optional sampling works without predicting a model's capabilities.
        return this.openAIParameters
            ? { max_completion_tokens: maxTokens }
            : { max_tokens: maxTokens, temperature };
    }

    /**
     * OpenAI互換の癖1組。要約と接続テストはこの同じオブジェクトを共有する
     * （PBI 2026-10-16-05）ため、資格文面の変更は1箇所で両フローに届く。
     */
    private hooks(): HttpProviderHooks {
        return {
            providerName: this.providerName,
            providerLabel: this.providerName,
            timeoutMs: this.timeoutMs,
            checkCredentials: () => {
                if (!this.baseUrl) {
                    return {
                        summaryMessage: "Error: Base URL is missing. Please check your settings.",
                        testMessage: 'Base URL is not set.',
                        testError: 'Base URL is missing',
                    };
                }
                if (this.isApiKeyMissing()) {
                    return {
                        summaryMessage: "Error: API key is missing. Please check your settings.",
                        testMessage: `${this.providerName} API Key is not set. Please enter it in the AI provider settings.`,
                        testError: 'API key is missing',
                    };
                }
                return null;
            },
            contentLimit: () => this.isLocal
                ? 4000
                : this.getMaxContentLength(),
            prepareRequest: async (userPrompt, systemPrompt) => {
                const trimmedBaseUrl = this.baseUrl.replace(/\/$/, '');
                const url = `${trimmedBaseUrl}/chat/completions`;
                const payload = {
                    model: this.model,
                    messages: [
                        {
                            role: "system",
                            content: systemPrompt
                        },
                        {
                            role: "user",
                            content: userPrompt
                        }
                    ],
                    ...this.generationParameters(this.resolvedSettings.maxTokens, 0.1),
                };
                const headers: Record<string, string> = { 'Content-Type': 'application/json' };
                if (this.apiKey) {
                    headers['Authorization'] = `Bearer ${this.apiKey}`;
                }
                return { url, headers, body: JSON.stringify(payload) };
            },
            buildRequest: async () => {
                const trimmedBaseUrl = this.baseUrl.replace(/\/$/, '');
                // モデル一覧(GET /models)ではなく実際に推論を走らせる。メタデータ取得では
                // APIキーの有効性やモデル名の妥当性、実際の応答内容が検証できないため。
                const url = `${trimmedBaseUrl}/chat/completions`;

                const headers: Record<string, string> = { 'Content-Type': 'application/json' };
                if (this.apiKey) {
                    headers['Authorization'] = `Bearer ${this.apiKey}`;
                }

                const payload = {
                    model: this.model,
                    messages: [{ role: 'user', content: CONNECTION_TEST_PROMPT }],
                    // A 16-token budget can be exhausted before reasoning
                    // produces visible text. Respect the configured cap.
                    ...this.generationParameters(
                        this.openAIParameters ? this.resolvedSettings.maxTokens : 16,
                        0,
                    ),
                };
                return { url, headers, body: JSON.stringify(payload), modelName: this.model };
            },
            extractSummary: (data, tid) => this._extractSummary(data as OpenAIApiResponse, tid),
            extractResponse: (data, ctx) => {
                const typed = data as OpenAIApiResponse;
                const text = typed.choices?.[0]?.message?.content ?? '';
                const hasContent = text.trim().length > 0;

                return {
                    success: hasContent,
                    message: hasContent ? 'Connected to AI API.' : 'Response contained no content.',
                    debug: {
                        ...this.buildTestDebugBase(ctx, hasContent, text),
                        ...(typed.usage?.prompt_tokens !== undefined ? { sentTokens: typed.usage.prompt_tokens } : {}),
                        ...(typed.usage?.completion_tokens !== undefined ? { receivedTokens: typed.usage.completion_tokens } : {}),
                        ...(hasContent ? {} : { error: 'choices[0].message.content was empty' }),
                    },
                };
            },
        };
    }

    /**
     * 要約を生成する
     * @param {string} content - 要約対象のコンテンツ
     * @param {boolean} [tagSummaryMode=false] - タグ付き要約モード
     */
    async generateSummary(content: string, tagSummaryMode: boolean = false, traceId: string = ''): Promise<AISummaryResult> {
        // 順序（資格→pre-flight→切り詰め→サニタイズ→プロンプト→fetch→timeout変換）は
        // 基底テンプレートが所有。ここには OpenAI の癖だけを hooks として渡す。
        return this.executeHttpSummaryFlow(content, tagSummaryMode, traceId, this.hooks());
    }

    async testConnection(): Promise<AIProviderConnectionResult> {
        // 順序（資格→構築→fetch→HTTPエラー変換→読み取り→例外変換）は
        // 基底テンプレートが所有。癖は generateSummary と同じ1組の hooks。
        return this.executeHttpTestFlow(this.hooks());
    }

    private async _extractSummary(data: OpenAIApiResponse, traceId: string = ''): Promise<AISummaryResult> {
        if (!data.choices || data.choices.length === 0) {
            return this.failInvalidSchema('OpenAI schema validation failed: choices is missing or empty', traceId);
        }
        if (!data.choices[0]?.message) {
            return this.failInvalidSchema('OpenAI schema validation failed: choices[0].message is missing', traceId);
        }
        const content = data.choices[0].message.content;
        if (typeof content !== 'string') {
            return this.failInvalidSchema('OpenAI schema validation failed: message.content is not a string', traceId);
        }
        // Same condition and wording as the test path's emptiness check
        // (extractResponse): a body that answers 200 with no text is a failed
        // request, not a summary. It must not reach the caller as success just
        // to be caught downstream by the min-length gate, and the kind lets the
        // breaker see a provider that answers with nothing.
        if (content.trim().length === 0) {
            return {
                success: false,
                summary: 'Error: Response contained no content.',
                error: 'choices[0].message.content was empty',
                failure: createFailure(FailureKind.HTTP),
            };
        }
        const sentTokens = data.usage?.prompt_tokens;
        const receivedTokens = data.usage?.completion_tokens;

        // トークン使用量を記録（成功時のみ、かつ数値が得られた場合のみ）
        await this.recordUsageIfPresent(sentTokens, receivedTokens);

        return { success: true, summary: content, providerName: this.providerName, modelName: this.model, ...pickDefined({ sentTokens, receivedTokens }) };
    }
}

/**
 * @deprecated Use GenericOpenAICompatibleProvider directly. Kept so importers
 * of the public providers/index.js surface keep working for the promised
 * deprecation window: 次メジャーで削除（再評価 2026-12-31）。
 * New code must not reference this class (enforced by check-deprecated-aliases).
 */
export class OpenAIProvider extends GenericOpenAICompatibleProvider {
    constructor(settings: Settings, providerName: string = 'openai', contentCharsKey?: StorageKey) {
        super(settings, providerName, contentCharsKey);
    }

    // Keep static helper for callers that reference OpenAIProvider.isLocalUrl
    static override isLocalUrl(url: string): boolean {
        return GenericOpenAICompatibleProvider.isLocalUrl(url);
    }
}
