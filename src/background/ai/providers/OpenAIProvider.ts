/**
 * OpenAIProvider
 * OpenAI互換APIを使用するAIプロバイダー — registry 駆動の Generic 実装
 */

import { AIProviderStrategy, AIProviderConnectionResult, AISummaryResult, CONNECTION_TEST_PROMPT } from './ProviderStrategy.js';
import { validateUrlForAIRequests } from '../../../utils/fetch.js';
import { LogType } from '../../../utils/logger/types.js';
import { addLog } from '../../../utils/logger/core.js';
import { Settings, StorageKeys, type StorageKey } from '../../../utils/storage/types.js';
import { errorMessage } from '../../../utils/errorUtils.js';
import { getRegistryEntry, isAllowedProviderBaseUrl } from '../providerCatalog.js';
import { PROVIDER_ALLOWLIST_ROWS, isProviderOriginAuthorized } from '../../../utils/storage/providerAllowlist.js';
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

export class GenericOpenAICompatibleProvider extends AIProviderStrategy {
    protected providerName: string;
    protected baseUrl: string;
    protected apiKey: string | undefined;
    protected model: string;
    protected timeoutMs: number;
    protected isLocal: boolean;
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

    constructor(settings: Settings, providerName: string = 'openai', contentCharsKey?: StorageKey) {
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
                this.apiKey = s[entry.apiKeyKey] as string | undefined;
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
            this.apiKey = s[`${normalizedName}_api_key`] as string | undefined;
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

        // タイムアウト設定: 0=自動（isLocal から導出 — SSOT on the base）
        const storedTimeout = Number(s[StorageKeys.AI_TIMEOUT_MS] ?? 0);
        this.timeoutMs = this.resolveTimeoutMs(storedTimeout, this.isLocal);
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
        return this.getMaxContentChars(10_000, this.contentCharsKey);
    }

    getName(): string {
        return this.providerName;
    }

    /**
     * 要約を生成する
     * @param {string} content - 要約対象のコンテンツ
     * @param {boolean} [tagSummaryMode=false] - タグ付き要約モード
     */
    async generateSummary(content: string, tagSummaryMode: boolean = false, traceId: string = ''): Promise<AISummaryResult> {
        // 順序（資格→pre-flight→切り詰め→サニタイズ→プロンプト→fetch→timeout変換）は
        // 基底テンプレートが所有。ここには OpenAI の癖だけを hooks として渡す。
        return this.executeHttpSummaryFlow(content, tagSummaryMode, traceId, {
            providerName: this.providerName,
            timeoutMs: this.timeoutMs,
            checkCredentials: () => !this.baseUrl
                ? "Error: Base URL is missing. Please check your settings."
                : null,
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
                    max_tokens: this.getMaxTokens(),
                    temperature: 0.1
                };
                const headers: Record<string, string> = { 'Content-Type': 'application/json' };
                if (this.apiKey) {
                    headers['Authorization'] = `Bearer ${this.apiKey}`;
                }
                return { url, headers, body: JSON.stringify(payload) };
            },
            handleErrorResponse: async (response) => ({
                success: false,
                summary: "Error: Failed to generate summary. Please check your API settings.",
                // Bare status only — the summary deliberately omits it (security
                // pins); `error` is the diagnostic channel surfaced per-slot.
                error: `HTTP ${response.status}`,
            }),
            extractSummary: (data, tid) => this._extractSummary(data as OpenAIApiResponse, tid),
        });
    }

    async testConnection(): Promise<AIProviderConnectionResult> {
        // 順序（資格→構築→fetch→HTTPエラー変換→読み取り→例外変換）は
        // 基底テンプレートが所有。ここには OpenAI の癖だけを hooks として渡す。
        return this.executeHttpTestFlow({
            providerLabel: this.providerName,
            timeoutMs: this.timeoutMs,
            checkCredentials: () => !this.baseUrl
                ? {
                    success: false,
                    message: 'Base URL is not set.',
                    debug: { error: 'Base URL is missing' },
                }
                : null,
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
                    max_tokens: 16,
                    temperature: 0,
                };
                return { url, headers, body: JSON.stringify(payload), modelName: this.model };
            },
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
        });
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
        const sentTokens = data.usage?.prompt_tokens;
        const receivedTokens = data.usage?.completion_tokens;

        // トークン使用量を記録（成功時のみ、かつ数値が得られた場合のみ）
        await this.recordUsageIfPresent(sentTokens, receivedTokens);

        return { success: true, summary: content, providerName: this.providerName, modelName: this.model, ...pickDefined({ sentTokens, receivedTokens }) };
    }
}

/**
 * @deprecated Use GenericOpenAICompatibleProvider directly. Kept for backward compatibility.
 * Sunset: remove in next major (re-evaluate 2026-12-31).
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
