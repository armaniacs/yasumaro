import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GenericOpenAICompatibleProvider } from '../OpenAIProvider.js';
import type { Settings } from '../../../../utils/storage/types.js';

vi.mock('../../../../utils/aiUsageTracker.js', () => ({
  checkHardLimit: vi.fn(async () => ({ blocked: false })),
  checkUsageWarning: vi.fn(async () => ({ warning: false })),
  checkRateLimit: vi.fn(async () => ({ allowed: true, remaining: 9, resetTime: Date.now() + 60000 })),
  getRateLimitMessage: vi.fn(() => 'Rate limit exceeded'),
  recordUsage: vi.fn(),
}));
vi.mock('../../../../utils/promptSanitizer.js', () => ({
  sanitizePromptContent: vi.fn((content: string) => ({ sanitized: content, warnings: [], dangerLevel: 'low' })),
}));
vi.mock('../../../../utils/customPromptUtils.js', () => ({
  applyCustomPrompt: vi.fn((settings: unknown, provider: string, content: string) => ({
    userPrompt: `summarize: ${content}`,
    systemPrompt: 'You are a helpful assistant.',
  })),
}));
vi.mock('../../../../utils/fetch.js', () => ({
  CONNECTION_TEST_CACHE_MODE: 'no-store',
  NO_REDIRECT_FETCH_POLICY: { redirect: 'error' },
  // PBI 2026-10-19-05: outbound paths take the policy through this seam.
  noRedirectInit: (options: Record<string, unknown> = {}) => ({ redirect: 'error', ...options }),
  fetchWithRetry: vi.fn(),
  validateUrlForAIRequests: vi.fn(),
}));
vi.mock('../../../../utils/storage/types.js', async () => {
  const actual = await vi.importActual<typeof import('../../../../utils/storage/types.js')>('../../../../utils/storage/types.js');
  return { ...actual, getAllowedUrls: vi.fn(() => Promise.resolve([])) };
});
vi.mock('../../../../utils/storage/defaults.js', async () => {
  const actual = await vi.importActual<typeof import('../../../../utils/storage/defaults.js')>('../../../../utils/storage/defaults.js');
  return { ...actual, getAllowedUrls: vi.fn(() => Promise.resolve([])) };
});
vi.mock('../../../../utils/storage/encryptionSession.js', async () => {
  const actual = await vi.importActual<typeof import('../../../../utils/storage/encryptionSession.js')>('../../../../utils/storage/encryptionSession.js');
  return { ...actual, getAllowedUrls: vi.fn(() => Promise.resolve([])) };
});
vi.mock('../../../../utils/storage/savedUrlRepository.js', async () => {
  const actual = await vi.importActual<typeof import('../../../../utils/storage/savedUrlRepository.js')>('../../../../utils/storage/savedUrlRepository.js');
  return { ...actual, getAllowedUrls: vi.fn(() => Promise.resolve([])) };
});
vi.mock('../../../../utils/storage/domainFilterCache.js', async () => {
  const actual = await vi.importActual<typeof import('../../../../utils/storage/domainFilterCache.js')>('../../../../utils/storage/domainFilterCache.js');
  return { ...actual, getAllowedUrls: vi.fn(() => Promise.resolve([])) };
});
vi.mock('../../../../utils/storage/quota.js', async () => {
  const actual = await vi.importActual<typeof import('../../../../utils/storage/quota.js')>('../../../../utils/storage/quota.js');
  return { ...actual, getAllowedUrls: vi.fn(() => Promise.resolve([])) };
});

describe('GenericOpenAICompatibleProvider: requiresApiKey gate (PBI 2026-10-16-02)', () => {
  const keylessOpenAISettings = {
    openai_base_url: 'https://api.openai.com/v1',
    openai_model: 'gpt-3.5-turbo',
  } as unknown as Settings;

  beforeEach(() => {
    global.fetch = vi.fn();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('generateSummary fails before fetch when a requiresApiKey provider has no key', async () => {
    const fetchModule = await import('../../../../utils/fetch.js');
    const provider = new GenericOpenAICompatibleProvider(keylessOpenAISettings, 'openai');
    const result = await provider.generateSummary('page content');
    expect(result.success).toBe(false);
    expect(result.summary).toContain('API key is missing');
    expect(fetchModule.fetchWithRetry).not.toHaveBeenCalled();
  });

  it('testConnection reports invalid without fetch when the key is missing', async () => {
    const fetchModule = await import('../../../../utils/fetch.js');
    const provider = new GenericOpenAICompatibleProvider(keylessOpenAISettings, 'openai');
    const result = await provider.testConnection();
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/API [Kk]ey/);
    expect(fetchModule.fetchWithRetry).not.toHaveBeenCalled();
  });

  it('requiresApiKey=false local providers still send without a key', async () => {
    const settings = {
      lm_studio_base_url: 'http://127.0.0.1:1234/v1',
      lm_studio_model: 'local-model',
    } as unknown as Settings;
    const fetchModule = await import('../../../../utils/fetch.js');
    vi.mocked(fetchModule.fetchWithRetry).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ choices: [{ message: { content: 'ok' } }] }),
    } as Response);
    const provider = new GenericOpenAICompatibleProvider(settings, 'lm-studio');
    const result = await provider.generateSummary('content');
    expect(result.success).toBe(true);
    expect(fetchModule.fetchWithRetry).toHaveBeenCalledTimes(1);
  });
});
