import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createProviderStrategy, getRegistryEntry } from '../../providerCatalog.js';
import { GenericOpenAICompatibleProvider } from '../OpenAIProvider.js';
import { CONNECTION_TEST_PROMPT } from '../ProviderStrategy.js';
import { StorageKeys, type Settings } from '../../../../utils/storage/types.js';

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));

vi.mock('../../../../utils/fetch.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../../utils/fetch.js')>(),
  fetchWithRetry: fetchMock,
}));
vi.mock('../../../../utils/storage/urlWhitelist.js', () => ({
  buildAllowedUrls: () => new Set<string>(),
}));
vi.mock('../../../../utils/aiUsageTracker.js', () => ({
  checkHardLimit: async () => ({ blocked: false }),
  checkUsageWarning: async () => ({ warning: false }),
  checkRateLimit: async () => ({ allowed: true }),
  getRateLimitMessage: () => 'limited',
  recordUsage: vi.fn(),
}));
vi.mock('../../../../utils/promptSafety.js', () => ({
  checkPromptSafety: (content: string) => ({ blocked: false, sanitized: content, warnings: [] }),
}));
vi.mock('../../../../utils/customPromptUtils.js', () => ({
  applyCustomPrompt: (_settings: unknown, _provider: string, content: string) => ({
    userPrompt: content,
    systemPrompt: 'Summarize the text.',
  }),
  getDefaultSystemPrompt: () => 'Summarize the text.',
}));

interface Payload {
  model: string;
  messages: Array<{ role: string; content: string }>;
  max_tokens?: number;
  max_completion_tokens?: number;
  temperature?: number;
}

function settingsFor(providerId: string, baseUrl: string, model: string): Settings {
  const prefixes: Record<string, string> = {
    'openai-official': 'openai_official', openai: 'openai', openai2: 'openai_2', 'openai-compatible': 'provider', 'lm-studio': 'lm_studio',
  };
  const prefix = prefixes[providerId];
  return {
    [`${prefix}_base_url`]: baseUrl,
    [`${prefix}_api_key`]: 'test-key',
    [`${prefix}_model`]: model,
    [StorageKeys.MAX_TOKENS_PER_PROMPT]: 2048,
    [StorageKeys.CONFIRMED_PROVIDER_ORIGINS]: {
      [`${prefix}_base_url`]: [new URL(baseUrl).origin],
    },
  } as unknown as Settings;
}

function sentBody(index = 0): Payload {
  return JSON.parse(fetchMock.mock.calls[index]![1].body as string) as Payload;
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockImplementation(async () => Response.json({
    choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }],
  }));
});

describe('GenericOpenAICompatibleProvider', () => {
  describe('OpenAI Chat Completions parameters', () => {
    it.each(['openai', 'openai2', 'openai-compatible'])('uses the current token parameter through %s for both flows', async (providerId) => {
      const provider = new GenericOpenAICompatibleProvider(
        settingsFor(providerId, 'https://api.openai.com/v1/', 'gpt-6-luna'), providerId,
      );

      await provider.generateSummary('A short public test article.');
      await provider.testConnection();

      expect(fetchMock).toHaveBeenCalledTimes(2);
      for (const index of [0, 1]) {
        expect(fetchMock.mock.calls[index]![0]).toBe('https://api.openai.com/v1/chat/completions');
        expect(sentBody(index)).toMatchObject({ model: 'gpt-6-luna', max_completion_tokens: 2048 });
        expect(sentBody(index)).not.toHaveProperty('max_tokens');
        expect(sentBody(index)).not.toHaveProperty('temperature');
      }
      expect(sentBody(0).messages[1]?.content).toBe('A short public test article.');
      expect(sentBody(1).messages).toEqual([{ role: 'user', content: CONNECTION_TEST_PROMPT }]);
    });

    it('passes a simulated reasoning API contract instead of returning HTTP 400 or empty content', async () => {
      // Local contract simulation, not a live OpenAI call. It checks the actual
      // serialized request; the original implementation fails this test.
      fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string) as Payload;
        if ('max_tokens' in body || 'temperature' in body) {
          return Response.json({ error: { code: 'unsupported_parameter' } }, { status: 400 });
        }
        const hasBudget = (body.max_completion_tokens ?? 0) > 16;
        return Response.json({ choices: [{
          message: { content: hasBudget ? 'OK' : '' },
          finish_reason: hasBudget ? 'stop' : 'length',
        }] });
      });
      const provider = new GenericOpenAICompatibleProvider(
        settingsFor('openai2', 'https://api.openai.com/v1', 'gpt-6-luna'), 'openai2',
      );

      const summary = await provider.generateSummary('A short public test article.');
      const connection = await provider.testConnection();

      expect(summary.success).toBe(true);
      expect(connection.success).toBe(true);
      expect(connection.debug?.hasContent).toBe(true);
    });

    it.each(['gpt-6-luna', 'gpt-4o-mini', 'future-model', 'ft:unknown-family:custom'])('uses the official dialect for both flows without classifying model %s', async (model) => {
      const provider = createProviderStrategy('openai-official', settingsFor('openai-official', 'https://api.openai.com/v1', model));

      await provider.generateSummary('A short public test article.');
      await provider.testConnection();

      for (const index of [0, 1]) {
        expect(sentBody(index)).toMatchObject({ model, max_completion_tokens: 2048 });
        expect(sentBody(index)).not.toHaveProperty('max_tokens');
        expect(sentBody(index)).not.toHaveProperty('temperature');
      }
    });

    it('uses the fixed official endpoint and its own credentials independently of legacy settings', async () => {
      const settings = {
        ...settingsFor('openai2', 'https://api.groq.com/openai/v1', 'vendor-model'),
        openai_2_api_key: 'legacy-key',
        openai_official_api_key: 'official-key',
      } as Settings;
      const provider = createProviderStrategy('openai-official', settings);

      await provider.testConnection();

      expect(getRegistryEntry('openai-official')).toMatchObject({ defaultBaseUrl: 'https://api.openai.com/v1', chatCompletionsDialect: 'openai' });
      expect(fetchMock.mock.calls[0]![0]).toBe('https://api.openai.com/v1/chat/completions');
      expect(fetchMock.mock.calls[0]![1].headers.Authorization).toBe('Bearer official-key');
      expect(sentBody()).toMatchObject({ model: 'gpt-6-luna', max_completion_tokens: 2048 });
      expect(settings.openai_2_api_key).toBe('legacy-key');
    });

    it('requires the official credential instead of borrowing a legacy key', async () => {
      const provider = createProviderStrategy('openai-official', settingsFor('openai2', 'https://api.openai.com/v1', 'gpt-6-luna'));

      const result = await provider.testConnection();

      expect(result.success).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('upgrades an existing official endpoint regardless of the model name', async () => {
      const provider = new GenericOpenAICompatibleProvider(settingsFor('openai', 'https://api.openai.com/v1', 'future-model'));

      await provider.generateSummary('A short public test article.');
      await provider.testConnection();

      expect(sentBody(0)).toMatchObject({ max_completion_tokens: 2048 });
      expect(sentBody(1)).toMatchObject({ max_completion_tokens: 2048 });
      expect(sentBody(0)).not.toHaveProperty('temperature');
      expect(sentBody(1)).not.toHaveProperty('temperature');
    });

    it.each([
      ['openai2', 'https://api.groq.com/openai/v1'],
      ['openai-compatible', 'https://api.deepseek.com/v1'],
      ['lm-studio', 'http://127.0.0.1:1234/v1'],
      ['openai2', 'https://api.openai.com.example.org/v1'],
      ['openai2', 'https://api.openai.com:8443/v1'],
    ])('preserves legacy parameters for %s at %s even with a reasoning-like model name', async (providerId, baseUrl) => {
      const provider = new GenericOpenAICompatibleProvider(settingsFor(providerId, baseUrl, 'gpt-6-luna'), providerId);

      await provider.generateSummary('A short public test article.');
      await provider.testConnection();

      expect(sentBody(0)).toMatchObject({ max_tokens: 2048, temperature: 0.1 });
      expect(sentBody(1)).toMatchObject({ max_tokens: 16, temperature: 0 });
      expect(sentBody(0)).not.toHaveProperty('max_completion_tokens');
      expect(sentBody(1)).not.toHaveProperty('max_completion_tokens');
    });

    it('keeps both legacy official slots independent without rewriting settings', async () => {
      const settings = {
        ...settingsFor('openai', 'https://api.openai.com/v1', 'future-a'),
        ...settingsFor('openai2', 'https://api.openai.com/v1', 'future-b'),
        openai_api_key: 'first-key', openai_2_api_key: 'second-key',
        providers: { openai: { maxTokens: 64 }, openai2: { maxTokens: 128 } },
      } as Settings;
      const before = structuredClone(settings);
      await createProviderStrategy('openai', settings).testConnection();
      await createProviderStrategy('openai2', settings).testConnection();

      expect(sentBody(0)).toMatchObject({ model: 'future-a', max_completion_tokens: 64 });
      expect(sentBody(1)).toMatchObject({ model: 'future-b', max_completion_tokens: 128 });
      expect(fetchMock.mock.calls[0]![1].headers.Authorization).toBe('Bearer first-key');
      expect(fetchMock.mock.calls[1]![1].headers.Authorization).toBe('Bearer second-key');
      expect(settings).toEqual(before);
    });

    it.each(['openai-official', 'openai2'])('honors a small configured budget for %s without silently increasing it', async (providerId) => {
      const settings = settingsFor(providerId, 'https://api.openai.com/v1', 'gpt-6-luna');
      settings.providers = { [providerId]: { maxTokens: 32 } };
      const provider = createProviderStrategy(providerId, settings);

      await provider.testConnection();

      expect(sentBody()).toMatchObject({ max_completion_tokens: 32 });
    });
  });
});
