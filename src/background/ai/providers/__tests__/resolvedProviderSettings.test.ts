/**
 * resolvedProviderSettings.test.ts (PBI 2026-10-16-10)
 * BDD受け入れの自動テスト:
 * - Scenario「Adapterが解決済み値だけ読む」: 解決済み値を注入したAdapterは
 *   blobの値と食い違っても解決済み値を送る (Settings blob参照が残らない)。
 * - Scenario「上限変更が窓口だけで済む」: 既定値の変更は
 *   resolveProviderSettings の opts だけで効く。
 * 既存Hook呼出し・catalog・RemoteAIService注入は変えない (PBI 03/05維持)。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { fetchWithRetryMock, readJsonCappedMock, applyCustomPromptMock } = vi.hoisted(() => ({
  fetchWithRetryMock: vi.fn(),
  readJsonCappedMock: vi.fn(),
  applyCustomPromptMock: vi.fn(
    (_settings: unknown, _provider: string, content: string) => ({
      userPrompt: content,
      systemPrompt: 'system',
    }),
  ),
}));

vi.mock('../../../../utils/fetch.js', () => ({
  NO_REDIRECT_FETCH_POLICY: { redirect: 'error' },
  // PBI 2026-10-19-05: outbound paths take the policy through this seam.
  noRedirectInit: (options: Record<string, unknown> = {}) => ({ redirect: 'error', ...options }),
  fetchWithRetry: fetchWithRetryMock,
  fetchWithTimeout: vi.fn(),
  validateUrlForAIRequests: vi.fn(),
}));
vi.mock('../../../../utils/customPromptUtils.js', () => ({
  applyCustomPrompt: applyCustomPromptMock,
  getDefaultSystemPrompt: vi.fn(() => 'default system'),
}));
vi.mock('../../../../utils/readBodyCapped.js', () => ({
  readJsonCapped: readJsonCappedMock,
}));
vi.mock('../../../../utils/storage/urlWhitelist.js', () => ({
  buildAllowedUrls: vi.fn((): Set<string> => new Set<string>()),
}));
vi.mock('../../../../utils/aiUsageTracker.js', () => ({
  checkHardLimit: vi.fn(async () => ({ blocked: false })),
  checkUsageWarning: vi.fn(async () => ({ warning: false })),
  checkRateLimit: vi.fn(async () => ({ allowed: true })),
  getRateLimitMessage: vi.fn(() => 'limited'),
  recordUsage: vi.fn(),
}));
vi.mock('../../../../utils/promptSafety.js', () => ({
  checkPromptSafety: vi.fn((content: string) => ({ blocked: false, sanitized: content, warnings: [] })),
}));
vi.mock('../../../../utils/logger/core.js', () => ({
  addLog: vi.fn(),
}));
vi.mock('../../../../utils/logger/api.js', () => ({
  logDebug: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

import { StorageKeys, type Settings } from '../../../../utils/storage/types.js';
import {
  resolveProviderSettings,
} from '../providerSettingsResolver.js';
import { AiModelKey, resolveModelKey } from '../../aiModelKey.js';
import { GenericOpenAICompatibleProvider } from '../OpenAIProvider.js';
import { GeminiProvider } from '../GeminiProvider.js';

function settingsOf(overrides: Record<string, unknown>): Settings {
  return overrides as unknown as Settings;
}

function okResponse(): Response {
  return { ok: true, json: async () => ({}) } as Response;
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchWithRetryMock.mockResolvedValue(okResponse());
});

describe('resolveProviderSettings (上限変更の窓口)', () => {
  it('scoped > global > fallback の順で3ノブを一括解決する', () => {
    const settings = settingsOf({
      providers: { p1: { maxContentChars: 5000, maxTokens: 111 } },
      [StorageKeys.OPENAI_CONTENT_CHARS]: 15000,
      [StorageKeys.MAX_TOKENS_PER_PROMPT]: 222,
      [StorageKeys.AI_TIMEOUT_MS]: 45000,
    });
    const resolved = resolveProviderSettings(settings, 'p1', {
      isLocal: false,
      defaultContentChars: 10_000,
      contentCharsKey: StorageKeys.OPENAI_CONTENT_CHARS,
    });
    expect(resolved.providerId).toBe('p1');
    expect(resolved.maxContentChars).toBe(5000);
    expect(resolved.maxTokens).toBe(111);
    expect(resolved.timeoutMs).toBe(45000);
  });

  it('既定値の変更は opts だけで効く (resolver+catalogのみの編集で済む)', () => {
    const settings = settingsOf({});
    const before = resolveProviderSettings(settings, 'p1', { isLocal: false, defaultContentChars: 10_000 });
    const after = resolveProviderSettings(settings, 'p1', { isLocal: false, defaultContentChars: 99_000 });
    expect(before.maxContentChars).toBe(10_000);
    expect(after.maxContentChars).toBe(99_000);
    expect(after.maxTokens).toBe(before.maxTokens);
  });

  it('解決済みオブジェクトは凍結されている (Adapter側で書き換え不可)', () => {
    const resolved = resolveProviderSettings(settingsOf({}), 'p1', { isLocal: true, defaultContentChars: 10_000 });
    expect(Object.isFrozen(resolved)).toBe(true);
    expect(resolved.timeoutMs).toBe(120_000);
  });
});

describe('AiModelKey (値オブジェクト)', () => {
  it('catalogのmodelKeyと一致し、未知providerは汎用キーに倒す', () => {
    expect(AiModelKey.for('gemini').key).toBe('gemini_model');
    expect(AiModelKey.for('openai').key).toBe(resolveModelKey('openai'));
    expect(AiModelKey.for('unknown-future-provider').key).toBe('provider_model');
  });

  it('同一providerは等価、異種は非等価', () => {
    expect(AiModelKey.for('gemini').equals(AiModelKey.for('gemini'))).toBe(true);
    expect(AiModelKey.for('gemini').equals(AiModelKey.for('openai'))).toBe(false);
  });

  it('blobからモデル値を読む (Settings直読みの集約先)', () => {
    const key = AiModelKey.for('openai');
    expect(key.readModel(settingsOf({ [key.key]: 'gpt-x' }))).toBe('gpt-x');
    expect(key.readModel(settingsOf({}))).toBeUndefined();
  });
});

describe('Adapterは解決済み値だけ読む (BDD Scenario 1)', () => {
  it('OpenAI: blobと食い違う解決済み値が送信される', async () => {
    readJsonCappedMock.mockResolvedValue({ choices: [{ message: { content: 'ok' } }] });
    const blob = settingsOf({
      openai_base_url: 'https://api.openai.com/v1',
      openai_api_key: 'k',
      openai_model: 'gpt-3.5-turbo',
      [StorageKeys.MAX_TOKENS_PER_PROMPT]: 111,
      [StorageKeys.OPENAI_CONTENT_CHARS]: 5000,
      [StorageKeys.AI_TIMEOUT_MS]: 11111,
    });
    const resolved = resolveProviderSettings(
      settingsOf({ [StorageKeys.MAX_TOKENS_PER_PROMPT]: 222 }),
      'openai',
      { isLocal: false, defaultContentChars: 100, contentCharsKey: StorageKeys.OPENAI_CONTENT_CHARS },
    );
    const provider = new GenericOpenAICompatibleProvider(blob, 'openai', StorageKeys.OPENAI_CONTENT_CHARS, resolved);

    await provider.generateSummary('x'.repeat(5000));

    const [, init, ] = fetchWithRetryMock.mock.calls[0] as unknown as [{}, { timeoutMs: number }, {}];
    const body = JSON.parse(fetchWithRetryMock.mock.calls[0]![1].body as string) as {
      max_completion_tokens: number;
      messages: Array<{ content: string }>;
    };
    // blob(111)ではなく解決済み(222)が送られる
    expect(body.max_completion_tokens).toBe(222);
    expect(init.timeoutMs).toBe(resolved.timeoutMs);
    // 切り詰めも解決済み上限(100)が効く
    expect(body.messages[1]!.content.length).toBe(100);
  });

  it('OpenAI: 解決済み値なしではblobから導出する (既存呼出し互換)', () => {
    const blob = settingsOf({
      openai_base_url: 'https://api.openai.com/v1',
      [StorageKeys.MAX_TOKENS_PER_PROMPT]: 111,
    });
    const provider = new GenericOpenAICompatibleProvider(blob, 'openai');
    expect(provider.resolvedSettings.maxTokens).toBe(111);
  });

  it('Gemini: blobと食い違う解決済み値が送信される', async () => {
    readJsonCappedMock.mockResolvedValue({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] });
    const blob = settingsOf({
      gemini_api_key: 'k',
      gemini_model: 'gemini-2.0-flash',
      [StorageKeys.MAX_TOKENS_PER_PROMPT]: 111,
      [StorageKeys.GEMINI_CONTENT_CHARS]: 5000,
    });
    const resolved = resolveProviderSettings(
      settingsOf({ [StorageKeys.MAX_TOKENS_PER_PROMPT]: 333 }),
      'gemini',
      { isLocal: false, defaultContentChars: 100, contentCharsKey: StorageKeys.GEMINI_CONTENT_CHARS },
    );
    const provider = new GeminiProvider(blob, StorageKeys.GEMINI_CONTENT_CHARS, resolved);

    await provider.generateSummary('y'.repeat(5000));

    const body = JSON.parse(fetchWithRetryMock.mock.calls[0]![1].body as string) as {
      generationConfig: { maxOutputTokens: number };
      contents: Array<{ parts: Array<{ text: string }> }>;
    };
    expect(body.generationConfig.maxOutputTokens).toBe(333);
    expect(body.contents[0]!.parts[0]!.text.length).toBe(100);
  });

  it('Gemini: apiVersionは構築時に確定し、後のblob書換えを読まない', async () => {
    readJsonCappedMock.mockResolvedValue({ candidates: [{ content: { parts: [{ text: 'OK' }] } }] });
    const blob = settingsOf({
      gemini_api_key: 'k',
      gemini_model: 'gemini-2.0-flash',
      [StorageKeys.GEMINI_API_VERSION]: 'v9beta',
    });
    const provider = new GeminiProvider(blob);

    (blob as Record<string, unknown>)[StorageKeys.GEMINI_API_VERSION] = 'v1';
    await provider.testConnection();

    const url = fetchWithRetryMock.mock.calls[0]![0] as string;
    expect(url).toContain('/v9beta/');
  });
});
