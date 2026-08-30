/**
 * modelsDevApi.ts
 * Type definitions and utilities for models.dev provider data
 */

export interface ModelsDevModel {
    id: string;
    name: string;
    contextLimit: number;
    inputPrice: number | null;
    outputPrice: number | null;
    isFreeTier: boolean;
}

export interface ModelsDevProvider {
    id: string;
    name: string;
    api: string;
    env: string[];
    doc: string;
    isAggregator: boolean;
    models: ModelsDevModel[];
}

export interface ModelsDevData {
    generatedAt: string;
    providers: ModelsDevProvider[];
    stats: {
        totalProviders: number;
        totalModels: number;
        aggregatorProviders: number;
        aggregatorModels: number;
    };
}

/**
 * Format context limit to human-readable string
 * e.g., 128000 -> "125K", 1000000 -> "1M", 204800 -> "200K"
 */
export function formatContextLimit(limit: number): string {
    if (limit >= 1000000) {
        return `${(limit / 1000000).toFixed(0)}M`;
    } else if (limit >= 1024) {
        return `${(limit / 1024).toFixed(0)}K`;
    }
    return `${limit}`;
}

/**
 * Find provider by ID
 */
export function findProviderById(providers: ModelsDevProvider[], providerId: string): ModelsDevProvider | null {
    return providers.find(p => p.id === providerId) || null;
}

/**
 * True only for an absolute https: URL. `doc`/`api` from the provider asset
 * are used as link hrefs and as the stored provider base URL, so anything that
 * is not https: (javascript:, http:, data:, relative) is rejected.
 */
export function isHttpsUrl(value: unknown): value is string {
    if (typeof value !== 'string' || value === '') return false;
    try {
        return new URL(value).protocol === 'https:';
    } catch {
        return false;
    }
}

/**
 * Runtime schema check for one provider entry. The asset is bundled today
 * (chrome.runtime.getURL), so this is defense-in-depth against a tampered or
 * malformed file; it becomes load-bearing if the source ever moves to a
 * remote fetch.
 */
export function isValidModelsDevProvider(p: unknown): p is ModelsDevProvider {
    if (typeof p !== 'object' || p === null) return false;
    const o = p as Record<string, unknown>;
    return (
        typeof o.id === 'string' &&
        typeof o.name === 'string' &&
        isHttpsUrl(o.api) &&
        isHttpsUrl(o.doc) &&
        typeof o.isAggregator === 'boolean' &&
        Array.isArray(o.models) &&
        Array.isArray(o.env)
    );
}

/**
 * Validates and narrows raw asset JSON. Returns null if the top-level shape is
 * wrong; otherwise keeps only the provider entries that pass the schema check.
 */
export function parseModelsDevData(raw: unknown): ModelsDevData | null {
    if (typeof raw !== 'object' || raw === null) return null;
    const o = raw as Record<string, unknown>;
    if (!Array.isArray(o.providers)) return null;
    const providers = o.providers.filter(isValidModelsDevProvider);
    return { ...(o as unknown as ModelsDevData), providers };
}

/**
 * Load models.dev data from extension assets
 */
export async function loadModelsDevData(): Promise<ModelsDevData | null> {
    try {
        const response = await fetch(chrome.runtime.getURL('data/models-dev-openai-compatible.json'));
        if (!response.ok) {
            console.warn('[ModelsDev] Failed to load provider data:', response.status);
            return null;
        }
        const parsed = parseModelsDevData(await response.json());
        if (!parsed) {
            console.warn('[ModelsDev] Provider data failed schema validation');
            return null;
        }
        return parsed;
    } catch (error) {
        console.warn('[ModelsDev] Error loading provider data:', error);
        return null;
    }
}

/**
 * Environment variable name mapping for providers
 * Cached constant to avoid recreating on every function call
 */
const ENV_MAP: Record<string, string> = {
    'openrouter': 'OPENROUTER_API_KEY',
    'groq': 'GROQ_API_KEY',
    'perplexity': 'PERPLEXITY_API_KEY',
    'anthropic': 'ANTHROPIC_API_KEY',
    'cohere': 'COHERE_API_KEY',
    'mistral': 'MISTRAL_API_KEY',
    'together': 'TOGETHER_API_KEY',
    'fireworks': 'FIREWORKS_API_KEY',
    'deepseek': 'DEEPSEEK_API_KEY',
    'xai': 'XAI_API_KEY',
    'google': 'GOOGLE_API_KEY',
    'openai': 'OPENAI_API_KEY',
    'moonshot': 'MOONSHOT_API_KEY',
    'zhipu': 'ZHIPU_API_KEY',
    'minimax': 'MINIMAX_API_KEY',
};

/**
 * Get API key environment name for a provider
 */
export function getApiKeyEnvName(providerId: string): string {
    return ENV_MAP[providerId] || `${providerId.toUpperCase()}_API_KEY`;
}

/**
 * Known API key creation page URLs for major providers.
 * Fallback: use provider's doc field or undefined (no link shown).
 */
const API_KEY_URLS: Record<string, string> = {
    'openrouter':             'https://openrouter.ai/settings/keys',
    'groq':                   'https://console.groq.com/keys',
    'perplexity':             'https://www.perplexity.ai/settings/api',
    'deepseek':               'https://platform.deepseek.com/api_keys',
    'mistral':                'https://console.mistral.ai/api-keys/',
    'together':               'https://api.together.ai/settings/api-keys',
    'fireworks-ai':           'https://fireworks.ai/account/api-keys',
    'cohere':                 'https://dashboard.cohere.com/api-keys',
    'anthropic':              'https://console.anthropic.com/settings/keys',
    'nvidia':                 'https://build.nvidia.com/settings/api-key',
    'huggingface':            'https://huggingface.co/settings/tokens',
    'github-models':          'https://github.com/settings/tokens',
    'cloudflare-workers-ai':  'https://dash.cloudflare.com/profile/api-tokens',
    'nebius':                 'https://studio.nebius.ai/settings/api-keys',
    'scaleway':               'https://console.scaleway.com/iam/api-keys',
    'ovhcloud':               'https://endpoints.ai.cloud.ovh.net/',
    'friendli':               'https://suite.friendli.ai/user-settings/tokens',
    'upstage':                'https://console.upstage.ai/api-keys',
    'moonshotai':             'https://platform.moonshot.ai/console/api-keys',
    'zhipuai':                'https://bigmodel.cn/usercenter/apikeys',
    'alibaba':                'https://bailian.console.aliyun.com/settings#/api-key',
    'siliconflow':            'https://cloud.siliconflow.cn/account/ak',
    'stepfun':                'https://platform.stepfun.com/account/apiKey',
    'minimax-cn':             'https://platform.minimaxi.com/user-center/basic-information/interface-key',
    'minimax':                'https://platform.minimaxi.com/user-center/basic-information/interface-key',
    'vultr':                  'https://my.vultr.com/settings/#settingsapi',
    'baseten':                'https://app.baseten.co/settings/account/api_keys',
    'wandb':                  'https://wandb.ai/settings#api',
    'abacus':                 'https://abacus.ai/settings/api',
    'novita-ai':              'https://novita.ai/settings/key-management',
    'inception':              'https://platform.inceptionlabs.ai/account',
    'berget':                 'https://api.berget.ai/settings/keys',
    'llama':                  'https://llama.developer.meta.com/',
    'stackit':                'https://console.stackit.cloud/iam/service-accounts',
    'modelscope':             'https://modelscope.cn/my/myaccesstoken',
};

/**
 * Get the API key creation page URL for a provider.
 * Returns the known URL if available, falls back to the provider's doc URL.
 */
export function getApiKeyUrl(providerId: string, docUrl?: string): string | undefined {
    const candidate = API_KEY_URLS[providerId] ?? docUrl;
    return isHttpsUrl(candidate) ? candidate : undefined;
}