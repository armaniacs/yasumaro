/**
 * builtInAIClient.test.ts
 * builtInAIClient.ts の単体テスト
 *
 * Service Worker から self.LanguageModel を直接呼び出す実装のテスト。
 * 2026-07-28 実機検証（Yasumaro拡張機能のService Workerコンソール）で
 * availability()/create()/prompt() が権限拒否なく成功することを確認済み。
 */

import { webcrypto as crypto } from '@peculiar/webcrypto';
import { vi } from 'vitest';
Object.defineProperty(global, 'crypto', { value: crypto });

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

const { sanitizePromptContent } = vi.mocked(promptSanitizerModule);

// self.LanguageModel のモック
interface MockSession {
    prompt: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
    contextWindow?: number;
    contextUsage?: number;
}

function createMockSession(overrides: Partial<MockSession> = {}): MockSession {
    return {
        prompt: vi.fn(async () => 'Mock summary'),
        destroy: vi.fn(),
        contextWindow: 4096,
        contextUsage: 0,
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
        test('インスタンスを作成できる', () => {
            expect(client).toBeInstanceOf(BuiltInAIClient);
        });
    });

    describe('getAvailability', () => {
        test('available を返す', async () => {
            mockLanguageModel.availability.mockResolvedValueOnce('available');
            const result = await client.getAvailability();
            expect(result).toBe('available');
        });

        test('downloadable を返す', async () => {
            mockLanguageModel.availability.mockResolvedValueOnce('downloadable');
            const result = await client.getAvailability();
            expect(result).toBe('downloadable');
        });

        test('downloading を返す', async () => {
            mockLanguageModel.availability.mockResolvedValueOnce('downloading');
            const result = await client.getAvailability();
            expect(result).toBe('downloading');
        });

        test('unavailable を返す', async () => {
            mockLanguageModel.availability.mockResolvedValueOnce('unavailable');
            const result = await client.getAvailability();
            expect(result).toBe('unavailable');
        });

        test('LanguageModel が存在しない場合は unavailable を返す', async () => {
            delete (globalThis as unknown as { LanguageModel?: unknown }).LanguageModel;
            const result = await client.getAvailability();
            expect(result).toBe('unavailable');
        });

        test('availability() が例外を投げた場合は unavailable を返す', async () => {
            mockLanguageModel.availability.mockRejectedValueOnce(new Error('boom'));
            const result = await client.getAvailability();
            expect(result).toBe('unavailable');
        });

        test('キャッシュされた availability を再利用する（2回目は API を呼ばない）', async () => {
            mockLanguageModel.availability.mockResolvedValueOnce('available');
            const result1 = await client.getAvailability();
            expect(result1).toBe('available');

            // 2回目: availability() が呼ばれずキャッシュから返る
            const result2 = await client.getAvailability();
            expect(result2).toBe('available');
            expect(mockLanguageModel.availability).toHaveBeenCalledTimes(1);
        });

        test('downloading はキャッシュされず毎回再チェックする', async () => {
            mockLanguageModel.availability.mockResolvedValue('downloading');
            const result1 = await client.getAvailability();
            expect(result1).toBe('downloading');

            const result2 = await client.getAvailability();
            expect(result2).toBe('downloading');
            expect(mockLanguageModel.availability).toHaveBeenCalledTimes(2);
        });
    });

    describe('isAvailable', () => {
        test('available の場合は true', async () => {
            mockLanguageModel.availability.mockResolvedValueOnce('available');
            const result = await client.isAvailable();
            expect(result).toBe(true);
        });

        test('available 以外の場合は false', async () => {
            mockLanguageModel.availability.mockResolvedValueOnce('downloadable');
            const result = await client.isAvailable();
            expect(result).toBe(false);
        });
    });

    describe('resetAvailabilityCache', () => {
        test('キャッシュをクリアすると次の getAvailability で API を再呼び出しする', async () => {
            mockLanguageModel.availability.mockResolvedValue('available');
            await client.getAvailability(); // キャッシュされる
            client.resetAvailabilityCache();

            const result = await client.getAvailability();
            expect(result).toBe('available');
            expect(mockLanguageModel.availability).toHaveBeenCalledTimes(2);
        });
    });

    describe('summarize', () => {
        test('空コンテンツでエラーを返す', async () => {
            const result = await client.summarize('');
            expect(result.success).toBe(false);
            expect(result.error).toBe('Invalid content');
        });

        test('成功時にサマリーを返す', async () => {
            const session = createMockSession({ prompt: vi.fn(async () => 'Test summary') });
            mockLanguageModel.create.mockResolvedValueOnce(session);

            const result = await client.summarize('Some content to summarize');

            expect(result.success).toBe(true);
            expect(result.summary).toBe('Test summary');
            expect(result.sentTokens).toBeGreaterThan(0);
            expect(result.receivedTokens).toBeGreaterThan(0);
        });

        test('成功後に session.destroy() が呼ばれる', async () => {
            const session = createMockSession();
            mockLanguageModel.create.mockResolvedValueOnce(session);

            await client.summarize('Some content');

            expect(session.destroy).toHaveBeenCalled();
        });

        test('unavailable の場合はエラーを返し create() を呼ばない', async () => {
            mockLanguageModel.availability.mockResolvedValueOnce('unavailable');

            const result = await client.summarize('Some content');

            expect(result.success).toBe(false);
            expect(result.error).toContain('unavailable');
            expect(mockLanguageModel.create).not.toHaveBeenCalled();
        });

        test('create() が失敗した場合はエラーを返す', async () => {
            mockLanguageModel.create.mockRejectedValueOnce(new Error('Unable to create a text session because the service is not running.'));

            const result = await client.summarize('Some content');

            expect(result.success).toBe(false);
            expect(result.error).toContain('service is not running');
        });

        test('prompt() が失敗した場合はエラーを返し session.destroy() が呼ばれる', async () => {
            const session = createMockSession({
                prompt: vi.fn(async () => { throw new Error('QuotaExceededError'); })
            });
            mockLanguageModel.create.mockResolvedValueOnce(session);

            const result = await client.summarize('Some content');

            expect(result.success).toBe(false);
            expect(result.error).toContain('QuotaExceededError');
            expect(session.destroy).toHaveBeenCalled();
        });

        test('プロンプトインジェクション HIGH でブロックする', async () => {
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

        test('入力を aiLimits.ts の上限（16,384文字）に切り詰める', async () => {
            const longContent = 'a'.repeat(20000);
            const session = createMockSession();
            mockLanguageModel.create.mockResolvedValueOnce(session);

            await client.summarize(longContent);

            const sentText = session.prompt.mock.calls[0][0] as string;
            expect(sentText.length).toBeLessThanOrEqual(16384);
        });

        test('キャッシュされた availability を使用する（2回目の summarize は LanguageModel.availability() を呼ばない）', async () => {
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
    });
});
