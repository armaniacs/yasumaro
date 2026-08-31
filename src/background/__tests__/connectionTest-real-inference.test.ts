/**
 * connectionTest-no-cache.test.ts
 *
 * 接続テストが「実際にAPIへ到達したこと」を検証していることの回帰テスト。
 *
 * 背景と経緯:
 * 1. 当初 AI の接続テストは GET /models（モデル一覧）を叩くだけだった。
 *    これはメタデータ取得にすぎず、APIキーの有効性・モデル名の妥当性・
 *    実際の応答内容を検証できない。しかも軽量なため数十msで返り、
 *    表示が「0.0秒」になって計測値として意味をなさなかった。
 * 2. そこで実際に推論を走らせる方式(POST /chat/completions,
 *    :generateContent)に変更した。POST はHTTPキャッシュの対象外なので、
 *    キャッシュ由来の偽の成功も同時に解消される。
 *
 * ここでは「GETでのメタデータ取得に戻っていないこと」と
 * 「送受信内容が debug に記録されること」を固定する。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { webcrypto as crypto } from '@peculiar/webcrypto';
Object.defineProperty(global, 'crypto', { value: crypto });

vi.mock('../../utils/fetch.js', () => ({
  fetchWithRetry: vi.fn(),
  fetchWithTimeout: vi.fn(),
  validateUrlForAIRequests: vi.fn(),
  CONNECTION_TEST_CACHE_MODE: 'no-store',
}));

vi.mock('../../utils/logger.js', () => ({
  addLog: vi.fn(),
  LogType: { ERROR: 'error', WARN: 'warn', INFO: 'info', DEBUG: 'debug' },
}));

vi.mock('../../utils/storage/types.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

    getAllowedUrls: vi.fn(async () => null),
    getSettings: vi.fn(async () => ({})),
    StorageKeys: {
      PROVIDER_BASE_URL: 'provider_base_url',
      PROVIDER_API_KEY: 'provider_api_key',
      PROVIDER_MODEL: 'provider_model',
      GEMINI_API_KEY: 'gemini_api_key',
      GEMINI_MODEL: 'gemini_model',
      GEMINI_API_VERSION: 'gemini_api_version',
      MAX_TOKENS_PER_PROMPT: 'max_tokens_per_prompt',
    },
    Settings: {},

  } as Record<string, unknown>;
  return {
    ...actual,
    ...Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [
        k,
        v !== null && typeof v === 'object' && !Array.isArray(v) &&
        actual[k] !== null && typeof actual[k] === 'object' && !Array.isArray(actual[k])
          ? { ...(actual[k] as Record<string, unknown>), ...(v as Record<string, unknown>) }
          : v,
      ]),
    ),
  };
});;
vi.mock('../../utils/storage/defaults.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

    getAllowedUrls: vi.fn(async () => null),
    getSettings: vi.fn(async () => ({})),
    StorageKeys: {
      PROVIDER_BASE_URL: 'provider_base_url',
      PROVIDER_API_KEY: 'provider_api_key',
      PROVIDER_MODEL: 'provider_model',
      GEMINI_API_KEY: 'gemini_api_key',
      GEMINI_MODEL: 'gemini_model',
      GEMINI_API_VERSION: 'gemini_api_version',
      MAX_TOKENS_PER_PROMPT: 'max_tokens_per_prompt',
    },
    Settings: {},

  } as Record<string, unknown>;
  return {
    ...actual,
    ...Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [
        k,
        v !== null && typeof v === 'object' && !Array.isArray(v) &&
        actual[k] !== null && typeof actual[k] === 'object' && !Array.isArray(actual[k])
          ? { ...(actual[k] as Record<string, unknown>), ...(v as Record<string, unknown>) }
          : v,
      ]),
    ),
  };
});;
vi.mock('../../utils/storage/encryptionSession.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

    getAllowedUrls: vi.fn(async () => null),
    getSettings: vi.fn(async () => ({})),
    StorageKeys: {
      PROVIDER_BASE_URL: 'provider_base_url',
      PROVIDER_API_KEY: 'provider_api_key',
      PROVIDER_MODEL: 'provider_model',
      GEMINI_API_KEY: 'gemini_api_key',
      GEMINI_MODEL: 'gemini_model',
      GEMINI_API_VERSION: 'gemini_api_version',
      MAX_TOKENS_PER_PROMPT: 'max_tokens_per_prompt',
    },
    Settings: {},

  } as Record<string, unknown>;
  return {
    ...actual,
    ...Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [
        k,
        v !== null && typeof v === 'object' && !Array.isArray(v) &&
        actual[k] !== null && typeof actual[k] === 'object' && !Array.isArray(actual[k])
          ? { ...(actual[k] as Record<string, unknown>), ...(v as Record<string, unknown>) }
          : v,
      ]),
    ),
  };
});;
vi.mock('../../utils/storage.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

    getAllowedUrls: vi.fn(async () => null),
    getSettings: vi.fn(async () => ({})),
    StorageKeys: {
      PROVIDER_BASE_URL: 'provider_base_url',
      PROVIDER_API_KEY: 'provider_api_key',
      PROVIDER_MODEL: 'provider_model',
      GEMINI_API_KEY: 'gemini_api_key',
      GEMINI_MODEL: 'gemini_model',
      GEMINI_API_VERSION: 'gemini_api_version',
      MAX_TOKENS_PER_PROMPT: 'max_tokens_per_prompt',
    },
    Settings: {},

  } as Record<string, unknown>;
  return {
    ...actual,
    ...Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [
        k,
        v !== null && typeof v === 'object' && !Array.isArray(v) &&
        actual[k] !== null && typeof actual[k] === 'object' && !Array.isArray(actual[k])
          ? { ...(actual[k] as Record<string, unknown>), ...(v as Record<string, unknown>) }
          : v,
      ]),
    ),
  };
});;
vi.mock('../../utils/storage/savedUrlRepository.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

    getAllowedUrls: vi.fn(async () => null),
    getSettings: vi.fn(async () => ({})),
    StorageKeys: {
      PROVIDER_BASE_URL: 'provider_base_url',
      PROVIDER_API_KEY: 'provider_api_key',
      PROVIDER_MODEL: 'provider_model',
      GEMINI_API_KEY: 'gemini_api_key',
      GEMINI_MODEL: 'gemini_model',
      GEMINI_API_VERSION: 'gemini_api_version',
      MAX_TOKENS_PER_PROMPT: 'max_tokens_per_prompt',
    },
    Settings: {},

  } as Record<string, unknown>;
  return {
    ...actual,
    ...Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [
        k,
        v !== null && typeof v === 'object' && !Array.isArray(v) &&
        actual[k] !== null && typeof actual[k] === 'object' && !Array.isArray(actual[k])
          ? { ...(actual[k] as Record<string, unknown>), ...(v as Record<string, unknown>) }
          : v,
      ]),
    ),
  };
});;
vi.mock('../../utils/storage/domainFilterCache.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

    getAllowedUrls: vi.fn(async () => null),
    getSettings: vi.fn(async () => ({})),
    StorageKeys: {
      PROVIDER_BASE_URL: 'provider_base_url',
      PROVIDER_API_KEY: 'provider_api_key',
      PROVIDER_MODEL: 'provider_model',
      GEMINI_API_KEY: 'gemini_api_key',
      GEMINI_MODEL: 'gemini_model',
      GEMINI_API_VERSION: 'gemini_api_version',
      MAX_TOKENS_PER_PROMPT: 'max_tokens_per_prompt',
    },
    Settings: {},

  } as Record<string, unknown>;
  return {
    ...actual,
    ...Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [
        k,
        v !== null && typeof v === 'object' && !Array.isArray(v) &&
        actual[k] !== null && typeof actual[k] === 'object' && !Array.isArray(actual[k])
          ? { ...(actual[k] as Record<string, unknown>), ...(v as Record<string, unknown>) }
          : v,
      ]),
    ),
  };
});;
vi.mock('../../utils/storage/quota.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

    getAllowedUrls: vi.fn(async () => null),
    getSettings: vi.fn(async () => ({})),
    StorageKeys: {
      PROVIDER_BASE_URL: 'provider_base_url',
      PROVIDER_API_KEY: 'provider_api_key',
      PROVIDER_MODEL: 'provider_model',
      GEMINI_API_KEY: 'gemini_api_key',
      GEMINI_MODEL: 'gemini_model',
      GEMINI_API_VERSION: 'gemini_api_version',
      MAX_TOKENS_PER_PROMPT: 'max_tokens_per_prompt',
    },
    Settings: {},

  } as Record<string, unknown>;
  return {
    ...actual,
    ...Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [
        k,
        v !== null && typeof v === 'object' && !Array.isArray(v) &&
        actual[k] !== null && typeof actual[k] === 'object' && !Array.isArray(actual[k])
          ? { ...(actual[k] as Record<string, unknown>), ...(v as Record<string, unknown>) }
          : v,
      ]),
    ),
  };
});;

import { fetchWithRetry } from '../../utils/fetch.js';
import { OpenAIProvider } from '../ai/providers/OpenAIProvider.js';
import { GeminiProvider } from '../ai/providers/GeminiProvider.js';
import { CONNECTION_TEST_PROMPT } from '../ai/providers/ProviderStrategy.js';
import type { Settings } from '../../utils/storage.js';

const mockedFetchWithRetry = vi.mocked(fetchWithRetry);

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => body,
  } as unknown as Response;
}

/** fetchWithRetry の (url, init) を取り出す */
function firstCall(): { url: string; init: RequestInit } {
  expect(mockedFetchWithRetry).toHaveBeenCalled();
  const call = mockedFetchWithRetry.mock.calls[0]!;
  return { url: call[0] as string, init: call[1] as RequestInit };
}

const openAiSettings = {
  provider_base_url: 'https://api.example.com/v1',
  provider_api_key: 'test-key',
  provider_model: 'test-model',
} as unknown as Settings;

const geminiSettings = {
  gemini_api_key: 'test-key',
  gemini_model: 'gemini-test',
} as unknown as Settings;

describe('AI接続テストは実際に推論を走らせる', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('OpenAI互換プロバイダ', () => {
    beforeEach(() => {
      mockedFetchWithRetry.mockResolvedValue(jsonResponse({
        choices: [{ message: { content: 'OK' } }],
        usage: { prompt_tokens: 7, completion_tokens: 1 },
      }));
    });

    it('GETでのモデル一覧取得ではなくPOSTで推論を要求する', async () => {
      await new OpenAIProvider(openAiSettings, 'openai-compatible').testConnection();

      const { url, init } = firstCall();
      expect(init.method).toBe('POST');
      expect(url).toContain('/chat/completions');
      // メタデータ取得(GET /models)への逆戻りを防ぐ
      expect(url).not.toMatch(/\/models$/);
    });

    it('接続テスト用プロンプトを本文に載せる', async () => {
      await new OpenAIProvider(openAiSettings, 'openai-compatible').testConnection();

      const body = JSON.parse(String(firstCall().init.body));
      expect(body.messages[0].content).toBe(CONNECTION_TEST_PROMPT);
      expect(body.model).toBe('test-model');
    });

    it('送信内容と受信内容を debug に記録する', async () => {
      const result = await new OpenAIProvider(openAiSettings, 'openai-compatible').testConnection();

      expect(result.success).toBe(true);
      expect(result.debug?.prompt).toBe(CONNECTION_TEST_PROMPT);
      expect(result.debug?.response).toBe('OK');
      expect(result.debug?.endpoint).toContain('/chat/completions');
      expect(result.debug?.sentTokens).toBe(7);
      expect(result.debug?.receivedTokens).toBe(1);
    });

    it('応答本文が空なら成功扱いにしない', async () => {
      mockedFetchWithRetry.mockResolvedValue(jsonResponse({ choices: [{ message: { content: '   ' } }] }));

      const result = await new OpenAIProvider(openAiSettings, 'openai-compatible').testConnection();

      expect(result.success).toBe(false);
      expect(result.debug?.hasContent).toBe(false);
    });
  });

  describe('Geminiプロバイダ', () => {
    beforeEach(() => {
      mockedFetchWithRetry.mockResolvedValue(jsonResponse({
        candidates: [{ content: { parts: [{ text: 'OK' }] } }],
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 1 },
      }));
    });

    it('GETでのモデル一覧取得ではなくPOSTで推論を要求する', async () => {
      await new GeminiProvider(geminiSettings).testConnection();

      const { url, init } = firstCall();
      expect(init.method).toBe('POST');
      expect(url).toContain(':generateContent');
      expect(url).not.toMatch(/\/models$/);
    });

    it('送信内容と受信内容を debug に記録する', async () => {
      const result = await new GeminiProvider(geminiSettings).testConnection();

      expect(result.success).toBe(true);
      expect(result.debug?.prompt).toBe(CONNECTION_TEST_PROMPT);
      expect(result.debug?.response).toBe('OK');
      expect(result.debug?.endpoint).toContain(':generateContent');
      expect(result.debug?.sentTokens).toBe(5);
      expect(result.debug?.receivedTokens).toBe(1);
    });

    it('応答本文が空なら成功扱いにしない', async () => {
      mockedFetchWithRetry.mockResolvedValue(jsonResponse({ candidates: [] }));

      const result = await new GeminiProvider(geminiSettings).testConnection();

      expect(result.success).toBe(false);
      expect(result.debug?.hasContent).toBe(false);
    });

    it('thinkingを無効化して送る（思考がトークン枠を食い潰すのを防ぐ）', async () => {
      await new GeminiProvider(geminiSettings).testConnection();

      const body = JSON.parse(String(firstCall().init.body));
      expect(body.generationConfig.thinkingConfig.thinkingBudget).toBe(0);
      // 思考が入っても本文が残る余裕を持たせる
      expect(body.generationConfig.maxOutputTokens).toBeGreaterThanOrEqual(256);
    });

    it('MAX_TOKENSで本文が空な場合、原因が分かるメッセージを返す', async () => {
      // Gemini 2.5系以降の thinking がトークン枠を使い切ったケース
      mockedFetchWithRetry.mockResolvedValue(jsonResponse({
        candidates: [{ content: { parts: [] }, finishReason: 'MAX_TOKENS' }],
        usageMetadata: { promptTokenCount: 7, thoughtsTokenCount: 1000 },
      }));

      const result = await new GeminiProvider(geminiSettings).testConnection();

      expect(result.success).toBe(false);
      // 「応答が空」で終わらせず、切り詰められたことを伝える
      expect(result.message).toContain('MAX_TOKENS');
      expect(result.debug?.error).toContain('thoughtsTokens=1000');
      expect(result.debug?.error).toContain('thinking consumed the output budget');
    });

    it('複数partsに分かれた応答を結合する', async () => {
      mockedFetchWithRetry.mockResolvedValue(jsonResponse({
        candidates: [{ content: { parts: [{ text: 'O' }, { text: 'K' }] } }],
      }));

      const result = await new GeminiProvider(geminiSettings).testConnection();

      expect(result.success).toBe(true);
      expect(result.debug?.response).toBe('OK');
    });

    it('セーフティフィルタでブロックされた場合はその旨を返す', async () => {
      mockedFetchWithRetry.mockResolvedValue(jsonResponse({
        candidates: [{ content: { parts: [] }, finishReason: 'SAFETY' }],
      }));

      const result = await new GeminiProvider(geminiSettings).testConnection();

      expect(result.success).toBe(false);
      expect(result.message).toContain('SAFETY');
    });
  });
});
