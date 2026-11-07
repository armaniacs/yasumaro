import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PROVIDER_CATALOG as PROVIDER_REGISTRY, getRegistryEntry } from '../providerCatalog.js';
import { StorageKeys } from '../../../utils/storage/types.js';

vi.mock('../../../utils/logger/types.js', async () =>
  (await import('../../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    addLog: 'fn',
    LogType: { ERROR: 'error', WARN: 'warn', INFO: 'info', DEBUG: 'debug' },
  }),
);
vi.mock('../../../utils/logger/core.js', async () =>
  (await import('../../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    addLog: 'fn',
    LogType: { ERROR: 'error', WARN: 'warn', INFO: 'info', DEBUG: 'debug' },
  }),
);
vi.mock('../../../utils/logger/api.js', async () =>
  (await import('../../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    logDebug: 'fn',
    addLog: 'fn',
    LogType: { ERROR: 'error', WARN: 'warn', INFO: 'info', DEBUG: 'debug' },
  }),
);


vi.mock('../../../utils/fetch.js', () => ({
    NO_REDIRECT_FETCH_POLICY: { redirect: 'error' },
    fetchWithRetry: vi.fn(),
    validateUrlForAIRequests: vi.fn(),
}));

describe('PROVIDER_REGISTRY', () => {
    it('contains 8 providers', () => {
        expect(PROVIDER_REGISTRY.size).toBe(8);
        expect([...PROVIDER_REGISTRY.keys()].sort()).toEqual(
            ['built-in-ai', 'gemini', 'lm-studio', 'ollama', 'openai-official', 'openai', 'openai-compatible', 'openai2'].sort(),
        );
    });

    it('each entry references correct StorageKeys', () => {
        expect(getRegistryEntry('openai-official')).toMatchObject({
            apiKeyKey: StorageKeys.OPENAI_OFFICIAL_API_KEY,
            modelKey: StorageKeys.OPENAI_OFFICIAL_MODEL,
            chatCompletionsDialect: 'openai',
            defaultBaseUrl: 'https://api.openai.com/v1',
        });
        expect(getRegistryEntry('openai-official')?.baseUrlKey).toBeUndefined();
        expect(getRegistryEntry('openai')).toMatchObject({
            baseUrlKey: StorageKeys.OPENAI_BASE_URL,
            apiKeyKey: StorageKeys.OPENAI_API_KEY,
            modelKey: StorageKeys.OPENAI_MODEL,
        });
        expect(getRegistryEntry('openai2')).toMatchObject({
            baseUrlKey: StorageKeys.OPENAI_2_BASE_URL,
            apiKeyKey: StorageKeys.OPENAI_2_API_KEY,
            modelKey: StorageKeys.OPENAI_2_MODEL,
        });
        expect(getRegistryEntry('openai-compatible')).toMatchObject({
            baseUrlKey: StorageKeys.PROVIDER_BASE_URL,
            apiKeyKey: StorageKeys.PROVIDER_API_KEY,
            modelKey: StorageKeys.PROVIDER_MODEL,
        });
        expect(getRegistryEntry('lm-studio')).toMatchObject({
            baseUrlKey: StorageKeys.LM_STUDIO_BASE_URL,
            modelKey: StorageKeys.LM_STUDIO_MODEL,
        });
        expect(getRegistryEntry('lm-studio')?.apiKeyKey).toBeUndefined();
        expect(getRegistryEntry('ollama')).toMatchObject({
            baseUrlKey: StorageKeys.OLLAMA_BASE_URL,
            modelKey: StorageKeys.OLLAMA_MODEL,
        });
        expect(getRegistryEntry('ollama')?.apiKeyKey).toBeUndefined();
        expect(getRegistryEntry('gemini')).toMatchObject({
            apiKeyKey: StorageKeys.GEMINI_API_KEY,
            modelKey: StorageKeys.GEMINI_MODEL,
        });
        expect(getRegistryEntry('gemini')?.baseUrlKey).toBeUndefined();
        expect(getRegistryEntry('built-in-ai')).toMatchObject({
            requiresApiKey: false,
            isLocal: true,
        });
    });

    it('local providers have isLocal true and requiresApiKey false', () => {
        expect(getRegistryEntry('lm-studio')?.isLocal).toBe(true);
        expect(getRegistryEntry('lm-studio')?.requiresApiKey).toBe(false);
        expect(getRegistryEntry('ollama')?.isLocal).toBe(true);
        expect(getRegistryEntry('ollama')?.requiresApiKey).toBe(false);
        expect(getRegistryEntry('built-in-ai')?.isLocal).toBe(true);
    });

    it('cloud providers have requiresApiKey true and isLocal false', () => {
        expect(getRegistryEntry('openai')?.requiresApiKey).toBe(true);
        expect(getRegistryEntry('openai')?.isLocal).toBe(false);
        expect(getRegistryEntry('openai2')?.requiresApiKey).toBe(true);
        expect(getRegistryEntry('gemini')?.requiresApiKey).toBe(true);
        expect(getRegistryEntry('openai-compatible')?.requiresApiKey).toBe(true);
    });

    it('returns undefined for unknown provider', () => {
        expect(getRegistryEntry('unknown-provider')).toBeUndefined();
    });

    it('defaultBaseUrl is set for local and openai providers, not for generic', () => {
        expect(getRegistryEntry('openai')?.defaultBaseUrl).toBe('https://api.openai.com/v1');
        expect(getRegistryEntry('openai2')?.defaultBaseUrl).toBe('https://api.openai.com/v1');
        expect(getRegistryEntry('lm-studio')?.defaultBaseUrl).toBe('http://127.0.0.1:1234/v1');
        expect(getRegistryEntry('ollama')?.defaultBaseUrl).toBe('http://localhost:11434/v1');
        expect(getRegistryEntry('openai-compatible')?.defaultBaseUrl).toBeUndefined();
    });
});

describe('GenericOpenAICompatibleProvider registry wiring', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('resolves baseUrl/apiKey/model from registry entry', async () => {
        const { GenericOpenAICompatibleProvider } = await import('../providers/OpenAIProvider.js');
        const settings: Record<string, unknown> = {
            openai_base_url: 'https://api.openai.com/v1',
            openai_api_key: 'sk-test',
            openai_model: 'gpt-4',
        };
        const provider = new GenericOpenAICompatibleProvider(settings as never, 'openai');
        expect((provider as unknown as { baseUrl: string }).baseUrl).toBe('https://api.openai.com/v1');
        expect((provider as unknown as { apiKey: string }).apiKey).toBe('sk-test');
        expect((provider as unknown as { model: string }).model).toBe('gpt-4');
    });

    it('uses defaultBaseUrl when setting is missing (lm-studio, ollama)', async () => {
        const { GenericOpenAICompatibleProvider } = await import('../providers/OpenAIProvider.js');
        const provider1 = new GenericOpenAICompatibleProvider({} as never, 'lm-studio');
        expect((provider1 as unknown as { baseUrl: string }).baseUrl).toBe('http://127.0.0.1:1234/v1');
        const provider2 = new GenericOpenAICompatibleProvider({} as never, 'ollama');
        expect((provider2 as unknown as { baseUrl: string }).baseUrl).toBe('http://localhost:11434/v1');
    });

    it('falls back to defaultModel for openai when model key missing', async () => {
        const { GenericOpenAICompatibleProvider } = await import('../providers/OpenAIProvider.js');
        const provider = new GenericOpenAICompatibleProvider({} as never, 'openai');
        expect((provider as unknown as { model: string }).model).toBe('gpt-3.5-turbo');
    });

    it('isLocal flag drives timeout (local=120s, cloud=30s)', async () => {
        const { GenericOpenAICompatibleProvider } = await import('../providers/OpenAIProvider.js');
        const local = new GenericOpenAICompatibleProvider({} as never, 'ollama');
        expect((local as unknown as { timeoutMs: number }).timeoutMs).toBe(120000);
        expect((local as unknown as { isLocal: boolean }).isLocal).toBe(true);
        const cloud = new GenericOpenAICompatibleProvider({ openai_base_url: 'https://api.openai.com/v1' } as never, 'openai');
        expect((cloud as unknown as { timeoutMs: number }).timeoutMs).toBe(30000);
        expect((cloud as unknown as { isLocal: boolean }).isLocal).toBe(false);
    });

    it('GenericOpenAICompatibleProvider resolves registry values (isLocalUrl still works)', async () => {
        const { GenericOpenAICompatibleProvider } = await import('../providers/OpenAIProvider.js');
        const provider = new GenericOpenAICompatibleProvider({} as never, 'lm-studio');
        expect((provider as unknown as { isLocal: boolean }).isLocal).toBe(true);
        expect(GenericOpenAICompatibleProvider.isLocalUrl('http://localhost:11434/v1')).toBe(true);
        expect(GenericOpenAICompatibleProvider.isLocalUrl('https://api.openai.com/v1')).toBe(false);
    });
});

describe('PROVIDER_VIEW_METADATA (PBI 2026-10-14-05)', () => {
    it('derives exactly the catalog keys (no parallel id list)', async () => {
        const { PROVIDER_VIEW_METADATA } = await import('../providerCatalog.js');
        expect([...PROVIDER_VIEW_METADATA.keys()].sort()).toEqual([...PROVIDER_REGISTRY.keys()].sort());
    });

    it('carries the gemini view values and carries official endpoint help and defaults everything else', async () => {
        const { PROVIDER_VIEW_METADATA } = await import('../providerCatalog.js');
        expect(PROVIDER_VIEW_METADATA.get('gemini')).toMatchObject({ cssClass: '', defaultOpen: true });
        expect(PROVIDER_VIEW_METADATA.get('gemini')?.extraFields).toHaveLength(1);
        expect(PROVIDER_VIEW_METADATA.get('openai-official')).toEqual({ helpI18nKey: 'openaiOfficialHelp' });
        const offenders: Array<[string, unknown]> = [];
        for (const [id, meta] of PROVIDER_VIEW_METADATA) {
            if (id === 'gemini' || id === 'openai-official') continue;
            // Single assertion (vitest/valid-expect allows one arg): collect
            // offenders so the failure diff names the provider ids.
            if (Object.keys(meta).length > 0) offenders.push([id, meta]);
        }
        expect(offenders).toEqual([]);
    });
});
