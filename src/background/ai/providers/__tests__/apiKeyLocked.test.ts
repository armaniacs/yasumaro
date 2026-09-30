import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenAIProvider } from '../OpenAIProvider.js';
import { GeminiProvider } from '../GeminiProvider.js';
import { EncryptionLockedError } from '../../../../utils/storage/encryptionLockedError.js';
import type { Settings } from '../../../../utils/storage/types.js';

vi.mock('../../../utils/aiUsageTracker.js', () => ({
  checkHardLimit: vi.fn(async () => ({ blocked: false })),
  checkUsageWarning: vi.fn(async () => ({ warning: false })),
  checkRateLimit: vi.fn(async () => ({ allowed: true, remaining: 9, resetTime: Date.now() + 60000 })),
  getRateLimitMessage: vi.fn(() => 'Rate limit exceeded'),
  recordUsage: vi.fn(),
}));
vi.mock('../../../utils/promptSanitizer.js', () => ({
  sanitizePromptContent: vi.fn((content: string) => ({ sanitized: content, warnings: [], dangerLevel: 'low' })),
}));
vi.mock('../../../utils/customPromptUtils.js', () => ({
  applyCustomPrompt: vi.fn((settings: unknown, provider: string, content: string) => ({
    userPrompt: `summarize: ${content}`,
    systemPrompt: 'You are a helpful assistant.',
  })),
}));
vi.mock('../../../utils/fetch.js', () => ({
  CONNECTION_TEST_CACHE_MODE: 'no-store',
  fetchWithRetry: vi.fn(),
  validateUrlForAIRequests: vi.fn(),
}));
vi.mock('../../../utils/storage/types.js', async () => {
  const actual = await vi.importActual<typeof import('../../../utils/storage/types.js')>('../../../utils/storage/types.js');
  return { ...actual, getAllowedUrls: vi.fn(() => Promise.resolve([])) };
});
vi.mock('../../../utils/storage/defaults.js', async () => {
  const actual = await vi.importActual<typeof import('../../../utils/storage/defaults.js')>('../../../utils/storage/defaults.js');
  return { ...actual, getAllowedUrls: vi.fn(() => Promise.resolve([])) };
});
vi.mock('../../../utils/storage/encryptionSession.js', async () => {
  const actual = await vi.importActual<typeof import('../../../utils/storage/encryptionSession.js')>('../../../utils/storage/encryptionSession.js');
  return { ...actual, getAllowedUrls: vi.fn(() => Promise.resolve([])) };
});
vi.mock('../../../utils/storage/savedUrlRepository.js', async () => {
  const actual = await vi.importActual<typeof import('../../../utils/storage/savedUrlRepository.js')>('../../../utils/storage/savedUrlRepository.js');
  return { ...actual, getAllowedUrls: vi.fn(() => Promise.resolve([])) };
});
vi.mock('../../../utils/storage/domainFilterCache.js', async () => {
  const actual = await vi.importActual<typeof import('../../../utils/storage/domainFilterCache.js')>('../../../utils/storage/domainFilterCache.js');
  return { ...actual, getAllowedUrls: vi.fn(() => Promise.resolve([])) };
});
vi.mock('../../../utils/storage/quota.js', async () => {
  const actual = await vi.importActual<typeof import('../../../utils/storage/quota.js')>('../../../utils/storage/quota.js');
  return { ...actual, getAllowedUrls: vi.fn(() => Promise.resolve([])) };
});

describe('providers reject undecrypted (object) API keys', () => {
  const openaiBase = {
    openai_base_url: 'https://api.openai.com/v1',
    openai_api_key: 'test_key',
    openai_model: 'gpt-3.5-turbo',
  } as unknown as Settings;
  const geminiBase = {
    gemini_api_key: 'test_key',
    gemini_model: 'gemini-3.1-flash-lite',
  } as unknown as Settings;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRestore();
  });

  it('OpenAIProvider rejects an undecrypted (object) API key', () => {
    expect(
      () => new OpenAIProvider({ ...openaiBase, openai_api_key: { iv: 'a', ciphertext: 'b' } } as unknown as Settings),
    ).toThrow(EncryptionLockedError);
  });

  it('GeminiProvider rejects an undecrypted (object) API key', () => {
    expect(
      () => new GeminiProvider({ ...geminiBase, gemini_api_key: { iv: 'a', ciphertext: 'b' } } as unknown as Settings),
    ).toThrow(EncryptionLockedError);
  });
});
