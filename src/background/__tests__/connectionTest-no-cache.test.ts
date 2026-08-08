/**
 * connectionTest-no-cache.test.ts
 *
 * 接続テストがブラウザのHTTPキャッシュを使わないことを保証する回帰テスト。
 *
 * 背景: 接続テストの GET (/v1/models, /v1beta/models, Obsidian root) に
 * cache 指定が無いと、fetch のデフォルト('default')でHTTPキャッシュに当たる。
 * その結果 所要時間が 0.0秒 と表示されるだけでなく、APIキー失効後や
 * オフラインでも「接続成功」を返しうる = テスト結果自体が信頼できなくなる。
 *
 * ここでは fetch/fetchWithRetry に渡る init の cache を直接検証することで、
 * 将来 cache 指定が外れた場合に必ず落ちるようにする。
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

vi.mock('../../utils/storage.js', () => ({
  getAllowedUrls: vi.fn(async () => null),
  getSettings: vi.fn(async () => ({})),
  StorageKeys: {
    PROVIDER_BASE_URL: 'provider_base_url',
    PROVIDER_API_KEY: 'provider_api_key',
    PROVIDER_MODEL: 'provider_model',
    GEMINI_API_KEY: 'gemini_api_key',
    GEMINI_MODEL: 'gemini_model',
    MAX_TOKENS_PER_PROMPT: 'max_tokens_per_prompt',
    OBSIDIAN_API_KEY: 'obsidian_api_key',
  },
  Settings: {},
}));

import { fetchWithRetry } from '../../utils/fetch.js';
import { OpenAIProvider } from '../ai/providers/OpenAIProvider.js';
import { GeminiProvider } from '../ai/providers/GeminiProvider.js';
import type { Settings } from '../../utils/storage.js';

const mockedFetchWithRetry = vi.mocked(fetchWithRetry);

function okResponse(): Response {
  return { ok: true, status: 200, statusText: 'OK' } as Response;
}

/** fetchWithRetry の第2引数(init)を取り出す */
function initOfFirstCall(): RequestInit {
  expect(mockedFetchWithRetry).toHaveBeenCalled();
  return mockedFetchWithRetry.mock.calls[0]![1] as RequestInit;
}

describe('接続テストはHTTPキャッシュを使わない', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedFetchWithRetry.mockResolvedValue(okResponse());
  });

  it("OpenAI互換プロバイダの testConnection は cache:'no-store' を渡す", async () => {
    const provider = new OpenAIProvider({
      provider_base_url: 'https://api.example.com/v1',
      provider_api_key: 'test-key',
      provider_model: 'test-model',
    } as unknown as Settings);

    const result = await provider.testConnection();

    expect(result.success).toBe(true);
    expect(initOfFirstCall().cache).toBe('no-store');
  });

  it("Gemini プロバイダの testConnection は cache:'no-store' を渡す", async () => {
    const provider = new GeminiProvider({
      gemini_api_key: 'test-key',
      gemini_model: 'gemini-test',
    } as unknown as Settings);

    const result = await provider.testConnection();

    expect(result.success).toBe(true);
    expect(initOfFirstCall().cache).toBe('no-store');
  });

  it("cache が 'default'(未指定時の既定) でないことを明示的に確認する", async () => {
    const provider = new OpenAIProvider({
      provider_base_url: 'https://api.example.com/v1',
      provider_api_key: 'test-key',
    } as unknown as Settings);

    await provider.testConnection();

    const cache = initOfFirstCall().cache;
    // 'default' や undefined だとHTTPキャッシュに当たりうる
    expect(cache).not.toBe('default');
    expect(cache).not.toBeUndefined();
  });
});
