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
 * Load models.dev data from extension assets
 */
export async function loadModelsDevData(): Promise<ModelsDevData | null> {
    try {
        const response = await fetch(chrome.runtime.getURL('data/models-dev-openai-compatible.json'));
        if (!response.ok) {
            console.warn('[ModelsDev] Failed to load provider data:', response.status);
            return null;
        }
        return await response.json() as ModelsDevData;
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