/**
 * builtInAIClient.test.ts
 * builtInAIClient.ts の単体テスト
 *
 * Service Worker から self.LanguageModel を直接呼び出す実装のテスト。
 * 2026-07-28 実機検証（Yasumaro拡張機能のService Workerコンソール）で
 * availability()/create()/prompt() が権限拒否なく成功することを確認済み。
 */

import { Crypto } from '@peculiar/webcrypto';
import { vi } from 'vitest';

Object.defineProperty(global, 'crypto', { value: new Crypto() });

// logger モック
vi.mock('../../utils/logger.js', () => ({
    addLog: vi.fn(),
    LogType: { ERROR: 'error', WARN: 'warn', INFO: 'info', DEBUG: 'debug' }
}));

// promptSanitizer モック
vi.mock('../../utils/promptSanitizer.js', () => ({
    sanitizePromptContent: vi.fn((content: string) => ({
        sanitized: content,
        warnings: [],
        dangerLevel: 'low'
    })),
    DangerLevel: { LOW: 'low', MEDIUM: 'medium', HIGH: 'high' }
}));

import { BuiltInAIClient } from '../builtInAIClient.js';
import * as promptSanitizerModule from '../../utils/promptSanitizer.js';
import { addLog } from '../../utils/logger.js';

const { sanitizePromptContent } = vi.mocked(promptSanitizerModule);

// self.LanguageModel のモック
interface MockSession {
    prompt: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
    contextWindow?: number | undefined;
    contextUsage?: number | undefined;
    inputQuota?: number | undefined;
    oncontextoverflow?: ((event: Event) => void) | null;
}

function createMockSession(overrides: Partial<MockSession> = {}): MockSession {
    return {
        prompt: vi.fn(async () => 'Mock summary'),
        destroy: vi.fn(),
        contextWindow: 4096,
        contextUsage: 0,
        inputQuota: 4096,
        oncontextoverflow: null,
        ...overrides
    };
}

describe('BuiltInAIClient', () => {
    let client: BuiltInAIClient;
    let mockLanguageModel: {
        availability: ReturnType<typeof vi.fn>;
        create: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
        vi.clearAllMocks();
        client = new BuiltInAIClient();
        mockLanguageModel = {
            availability: vi.fn(async () => 'available'),
            create: vi.fn(async () => createMockSession())
        };
        (globalThis as unknown as { LanguageModel?: unknown }).LanguageModel = mockLanguageModel;
    });

    afterEach(() => {
        delete (globalThis as unknown as { LanguageModel?: unknown }).LanguageModel;
    });

    describe('constructor', () => {
        test('creates an instance', () => {
            expect(client).toBeInstanceOf(BuiltInAIClient);
        });
    });

    describe('getAvailability', () => {
        test('returns available', async () => {
            mockLanguageModel.availability.mockResolvedValueOnce('available');
            const result = await client.getAvailability();
            expect(result).toBe('available');
        });

        test('returns downloadable', async () => {
            mockLanguageModel.availability.mockResolvedValueOnce('downloadable');
            const result = await client.getAvailability();
            expect(result).toBe('downloadable');
        });

        test('returns downloading', async () => {
            mockLanguageModel.availability.mockResolvedValueOnce('downloading');
            const result = await client.getAvailability();
            expect(result).toBe('downloading');
        });

        test('returns unavailable', async () => {
            mockLanguageModel.availability.mockResolvedValueOnce('unavailable');
            const result = await client.getAvailability();
            expect(result).toBe('unavailable');
        });

        test('returns unavailable when LanguageModel is missing', async () => {
            delete (globalThis as unknown as { LanguageModel?: unknown }).LanguageModel;
            const result = await client.getAvailability();
            expect(result).toBe('unavailable');
        });

        test('returns unavailable when availability() throws', async () => {
            mockLanguageModel.availability.mockRejectedValueOnce(new Error('boom'));
            const result = await client.getAvailability();
            expect(result).toBe('unavailable');
        });

        test('calls availability() with the same expectedOutputs as create()', async () => {
            mockLanguageModel.availability.mockResolvedValueOnce('available');
            await client.getAvailability();
            expect(mockLanguageModel.availability).toHaveBeenCalledWith({
                expectedOutputs: [{ type: 'text', languages: ['ja'] }],
            });
        });

        test('reuses the cached availability (does not call the API a second time)', async () => {
            mockLanguageModel.availability.mockResolvedValueOnce('available');
            const result1 = await client.getAvailability();
            expect(result1).toBe('available');

            // 2回目: availability() が呼ばれずキャッシュから返る
            const result2 = await client.getAvailability();
            expect(result2).toBe('available');
            expect(mockLanguageModel.availability).toHaveBeenCalledTimes(1);
        });

        test('does not cache downloading and rechecks every time', async () => {
            mockLanguageModel.availability.mockResolvedValue('downloading');
            const result1 = await client.getAvailability();
            expect(result1).toBe('downloading');

            const result2 = await client.getAvailability();
            expect(result2).toBe('downloading');
            expect(mockLanguageModel.availability).toHaveBeenCalledTimes(2);
        });
    });

    describe('isAvailable', () => {
        test('returns true when available', async () => {
            mockLanguageModel.availability.mockResolvedValueOnce('available');
            const result = await client.isAvailable();
            expect(result).toBe(true);
        });

        test('returns false when not available', async () => {
            mockLanguageModel.availability.mockResolvedValueOnce('downloadable');
            const result = await client.isAvailable();
            expect(result).toBe(false);
        });
    });

    describe('resetAvailabilityCache', () => {
        test('recalls the API on the next getAvailability after clearing the cache', async () => {
            mockLanguageModel.availability.mockResolvedValue('available');
            await client.getAvailability(); // キャッシュされる
            client.resetAvailabilityCache();

            const result = await client.getAvailability();
            expect(result).toBe('available');
            expect(mockLanguageModel.availability).toHaveBeenCalledTimes(2);
        });
    });

    describe('summarize', () => {
        test('returns an error for empty content', async () => {
            const result = await client.summarize('');
            expect(result.success).toBe(false);
            expect(result.error).toBe('Invalid content');
        });

        test('returns a summary on success', async () => {
            const session = createMockSession({ prompt: vi.fn(async () => 'Test summary') });
            mockLanguageModel.create.mockResolvedValueOnce(session);

            const result = await client.summarize('Some content to summarize');

            expect(result.success).toBe(true);
            expect(result.summary).toBe('Test summary');
            expect(result.sentTokens).toBeGreaterThan(0);
            expect(result.receivedTokens).toBeGreaterThan(0);
        });

        test('calls session.destroy() after success', async () => {
            const session = createMockSession();
            mockLanguageModel.create.mockResolvedValueOnce(session);

            await client.summarize('Some content');

            expect(session.destroy).toHaveBeenCalled();
        });

        test('returns an error without calling create() when unavailable', async () => {
            mockLanguageModel.availability.mockResolvedValueOnce('unavailable');

            const result = await client.summarize('Some content');

            expect(result.success).toBe(false);
            expect(result.error).toContain('unavailable');
            expect(mockLanguageModel.create).not.toHaveBeenCalled();
        });

        test('returns an error when create() fails', async () => {
            mockLanguageModel.create.mockRejectedValueOnce(new Error('Unable to create a text session because the service is not running.'));

            const result = await client.summarize('Some content');

            expect(result.success).toBe(false);
            expect(result.error).toContain('service is not running');
        });

        test('returns an error and calls session.destroy() when prompt() fails', async () => {
            const session = createMockSession({
                prompt: vi.fn(async () => { throw new Error('QuotaExceededError'); })
            });
            mockLanguageModel.create.mockResolvedValueOnce(session);

            const result = await client.summarize('Some content');

            expect(result.success).toBe(false);
            expect(result.error).toContain('QuotaExceededError');
            expect(session.destroy).toHaveBeenCalled();
        });

        test('blocks on HIGH prompt injection', async () => {
            sanitizePromptContent.mockReturnValueOnce({
                sanitized: 'blocked',
                warnings: ['injection detected'],
                dangerLevel: 'high'
            });

            const result = await client.summarize('malicious content');
            expect(result.success).toBe(false);
            expect(result.error).toContain('dangerous patterns');
            expect(mockLanguageModel.create).not.toHaveBeenCalled();
        });

        test('logs a warning and continues processing on LOW prompt injection', async () => {
            sanitizePromptContent.mockReturnValueOnce({
                sanitized: 'sanitized content',
                warnings: ['Detected potential command: "system"'],
                dangerLevel: 'low'
            });
            mockLanguageModel.create.mockResolvedValueOnce(createMockSession());

            await client.summarize('content with generic term');

            expect(addLog).toHaveBeenCalledWith(
                'warn',
                'Low-risk prompt injection detected in built-in AI input',
                expect.objectContaining({
                    source: 'BuiltInAI',
                    dangerLevel: 'low',
                    category: 'generic_term',
                })
            );
        });

        test('truncates input to the aiLimits.ts limit (16,384 chars)', async () => {
            const longContent = 'a'.repeat(20000);
            const session = createMockSession();
            mockLanguageModel.create.mockResolvedValueOnce(session);

            await client.summarize(longContent);

            const sentText = session.prompt.mock.calls[0]![0] as string;
            expect(sentText.length).toBeLessThanOrEqual(16384);
        });

        test('uses the cached availability (the second summarize does not call LanguageModel.availability())', async () => {
            const session1 = createMockSession({ prompt: vi.fn(async () => 'summary 1') });
            const session2 = createMockSession({ prompt: vi.fn(async () => 'summary 2') });
            mockLanguageModel.create.mockResolvedValueOnce(session1).mockResolvedValueOnce(session2);

            // 1回目の summarize は availability() を呼ぶ
            await client.summarize('content 1');
            expect(mockLanguageModel.availability).toHaveBeenCalledTimes(1);

            // 2回目の summarize は availability がキャッシュされているため availability() を呼ばない
            await client.summarize('content 2');
            expect(mockLanguageModel.availability).toHaveBeenCalledTimes(1); // 変わらず1回
        });

        test('truncates based on session.contextWindow when it is narrower than the static limit (Edge Phi-mini measured value)', async () => {
            const longContent = 'a'.repeat(20000);
            // 実機検証済みの Edge Phi-mini contextWindow 実測値
            const session = createMockSession({ contextWindow: 9216 });
            mockLanguageModel.create.mockResolvedValueOnce(session);

            await client.summarize(longContent);

            const sentText = session.prompt.mock.calls[0]![0] as string;
            // 9216 tokens * 2 chars/token * 0.8 safety margin = 14745
            expect(sentText.length).toBeLessThanOrEqual(14745);
            expect(sentText.length).toBeLessThan(16384);
        });

        test('uses only the static limit (16,384 chars) when session.contextWindow is undefined', async () => {
            const longContent = 'a'.repeat(20000);
            const session = createMockSession({ contextWindow: undefined });
            mockLanguageModel.create.mockResolvedValueOnce(session);

            await client.summarize(longContent);

            const sentText = session.prompt.mock.calls[0]![0] as string;
            expect(sentText.length).toBe(16384);
        });

        test('uses the static limit (16,384 chars) when session.contextWindow is wider than it', async () => {
            const longContent = 'a'.repeat(20000);
            const session = createMockSession({ contextWindow: 100000 });
            mockLanguageModel.create.mockResolvedValueOnce(session);

            await client.summarize(longContent);

            const sentText = session.prompt.mock.calls[0]![0] as string;
            expect(sentText.length).toBe(16384);
        });

        test('sets session.oncontextoverflow', async () => {
            const session = createMockSession();
            mockLanguageModel.create.mockResolvedValueOnce(session);

            await client.summarize('Some content');

            expect(session.oncontextoverflow).toBeInstanceOf(Function);
        });

        test('still returns a success result after contextoverflow (warning is logged only, type is unchanged)', async () => {
            // prompt() 呼び出し内で oncontextoverflow を同期的に発火させ、
            // マイクロタスクのタイミングに依存せず contextOverflowed の捕捉を検証する。
            const session = createMockSession({
                prompt: vi.fn(async function (this: MockSession, text: string) {
                    this.oncontextoverflow?.(new Event('contextoverflow'));
                    return 'Mock summary';
                })
            });
            mockLanguageModel.create.mockResolvedValueOnce(session);

            const result = await client.summarize('Some content');

            expect(result.success).toBe(true);
            expect(result).not.toHaveProperty('contextOverflowed');
        });
    });

    describe('unavailable メッセージのブラウザ別案内', () => {
        afterEach(() => {
            vi.unstubAllGlobals();
        });

        test('includes the chrome://flags guidance in Chrome', async () => {
            vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 Chrome/126.0.0.0' });
            mockLanguageModel.availability.mockResolvedValueOnce('unavailable');

            const result = await client.summarize('Some content');

            expect(result.error).toContain('chrome://flags');
        });

        test('includes the edge://flags guidance in Edge', async () => {
            vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 Chrome/126.0.0.0 Edg/126.0.0.0' });
            mockLanguageModel.availability.mockResolvedValueOnce('unavailable');

            const result = await client.summarize('Some content');

            expect(result.error).toContain('edge://flags');
        });

        test('falls back to generic guidance without a flags URL in unknown browsers', async () => {
            vi.stubGlobal('navigator', { userAgent: 'SomeOtherBrowser/1.0' });
            mockLanguageModel.availability.mockResolvedValueOnce('unavailable');

            const result = await client.summarize('Some content');

            expect(result.error).not.toContain('://flags');
            expect(result.error).toContain('unavailable');
        });
    });
});
