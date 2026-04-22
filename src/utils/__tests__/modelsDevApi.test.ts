/**
 * modelsDevApi.test.ts
 * Unit tests for models.dev API type definitions and utilities
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  formatContextLimit,
  findProviderById,
  loadModelsDevData,
  getApiKeyEnvName,
  type ModelsDevProvider,
  type ModelsDevModel,
  type ModelsDevData,
} from '../modelsDevApi.js';

describe('modelsDevApi', () => {
  describe('formatContextLimit', () => {
    it('should format millions with M suffix', () => {
      expect(formatContextLimit(1_000_000)).toBe('1M');
      expect(formatContextLimit(2_000_000)).toBe('2M');
    });

    it('should format kilobytes with K suffix', () => {
      expect(formatContextLimit(1024)).toBe('1K');
      expect(formatContextLimit(128_000)).toBe('125K');
      expect(formatContextLimit(204_800)).toBe('200K');
    });

    it('should return raw number for values under 1024', () => {
      expect(formatContextLimit(0)).toBe('0');
      expect(formatContextLimit(512)).toBe('512');
      expect(formatContextLimit(1023)).toBe('1023');
    });
  });

  describe('findProviderById', () => {
    const providers: ModelsDevProvider[] = [
      {
        id: 'openai',
        name: 'OpenAI',
        api: 'https://api.openai.com',
        env: ['OPENAI_API_KEY'],
        doc: 'https://platform.openai.com/docs',
        isAggregator: false,
        models: [],
      },
      {
        id: 'groq',
        name: 'Groq',
        api: 'https://api.groq.com',
        env: ['GROQ_API_KEY'],
        doc: 'https://console.groq.com/docs',
        isAggregator: false,
        models: [],
      },
    ];

    it('should find provider by id', () => {
      const result = findProviderById(providers, 'openai');
      expect(result).not.toBeNull();
      expect(result?.name).toBe('OpenAI');
    });

    it('should return null when provider not found', () => {
      const result = findProviderById(providers, 'unknown');
      expect(result).toBeNull();
    });

    it('should return null for empty array', () => {
      const result = findProviderById([], 'openai');
      expect(result).toBeNull();
    });
  });

  describe('getApiKeyEnvName', () => {
    it('should return mapped env name for known providers', () => {
      expect(getApiKeyEnvName('openrouter')).toBe('OPENROUTER_API_KEY');
      expect(getApiKeyEnvName('groq')).toBe('GROQ_API_KEY');
      expect(getApiKeyEnvName('anthropic')).toBe('ANTHROPIC_API_KEY');
      expect(getApiKeyEnvName('openai')).toBe('OPENAI_API_KEY');
    });

    it('should generate uppercase env name for unknown providers', () => {
      expect(getApiKeyEnvName('custom')).toBe('CUSTOM_API_KEY');
      expect(getApiKeyEnvName('my-provider')).toBe('MY-PROVIDER_API_KEY');
    });
  });

  describe('loadModelsDevData', () => {
    const originalFetch = globalThis.fetch;
    const originalChrome = (globalThis as Record<string, unknown>).chrome;

    beforeEach(() => {
      vi.stubGlobal('chrome', {
        runtime: {
          getURL: vi.fn((path: string) => `chrome-extension://test-id/${path}`),
        },
      });
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      globalThis.fetch = originalFetch;
    });

    it('should load and return models.dev data', async () => {
      const mockData: ModelsDevData = {
        generatedAt: new Date().toISOString(),
        providers: [
          {
            id: 'openai',
            name: 'OpenAI',
            api: 'https://api.openai.com',
            env: ['OPENAI_API_KEY'],
            doc: 'https://platform.openai.com/docs',
            isAggregator: false,
            models: [
              {
                id: 'gpt-4',
                name: 'GPT-4',
                contextLimit: 128000,
                inputPrice: 0.03,
                outputPrice: 0.06,
                isFreeTier: false,
              },
            ],
          },
        ],
        stats: {
          totalProviders: 1,
          totalModels: 1,
          aggregatorProviders: 0,
          aggregatorModels: 0,
        },
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockData),
      } as unknown as Response);

      const result = await loadModelsDevData();

      expect(result).toEqual(mockData);
      expect(chrome.runtime.getURL).toHaveBeenCalledWith(
        'data/models-dev-openai-compatible.json'
      );
    });

    it('should return null on fetch failure', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      } as unknown as Response);

      const result = await loadModelsDevData();
      expect(result).toBeNull();
    });

    it('should return null on network error', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const result = await loadModelsDevData();
      expect(result).toBeNull();
    });
  });
});
