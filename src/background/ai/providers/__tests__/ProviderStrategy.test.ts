/**
 * ProviderStrategy.test.ts
 * Tests for abstract AIProviderStrategy base class
 */


import { vi, describe, test, expect, beforeEach } from 'vitest';
import type { Settings } from '../../../../utils/storage.js';
import { StorageKeys } from '../../../../utils/storage.js';
import {
    AIProviderStrategy,
    AIProviderConnectionResult,
    AISummaryResult
} from '../ProviderStrategy.js';

const {
    checkHardLimitMock,
    checkUsageWarningMock,
    checkRateLimitMock,
    getRateLimitMessageMock
} = vi.hoisted(() => ({
    checkHardLimitMock: vi.fn(async () => ({ blocked: false })),
    checkUsageWarningMock: vi.fn(async () => ({ warning: false })),
    checkRateLimitMock: vi.fn(async () => ({ allowed: true, remaining: 9, resetTime: Date.now() + 60000 })),
    getRateLimitMessageMock: vi.fn(() => 'Rate limit exceeded')
}));

vi.mock('../../../../utils/aiUsageTracker.js', () => ({
    checkHardLimit: checkHardLimitMock,
    checkUsageWarning: checkUsageWarningMock,
    checkRateLimit: checkRateLimitMock,
    getRateLimitMessage: getRateLimitMessageMock
}));

class TestProvider extends AIProviderStrategy {
    async generateSummary(content: string): Promise<AISummaryResult> {
        return { success: true, summary: 'test summary' };
    }

    async testConnection(): Promise<AIProviderConnectionResult> {
        return { success: true, message: 'OK' };
    }

    getName(): string {
        return 'test-provider';
    }

    async callCheckPreFlight() {
        return this.checkPreFlight();
    }
}

class CustomIdProvider extends AIProviderStrategy {
    async generateSummary(content: string): Promise<AISummaryResult> {
        return { success: true, summary: 'custom' };
    }

    async testConnection(): Promise<AIProviderConnectionResult> {
        return { success: true, message: 'OK' };
    }

    getName(): string {
        return 'openai';
    }

    getProviderId(): string {
        return 'openai';
    }
}

describe('AIProviderStrategy', () => {
    describe('constructor', () => {
        test('settingsを設定する', () => {
            const settings = {} as Settings;
            const provider = new TestProvider(settings);
            expect(provider).toBeDefined();
        });
    });

    describe('getProviderId', () => {
        test('デフォルトでgetName()と同じ値を返す', () => {
            const settings = {} as Settings;
            const provider = new TestProvider(settings);
            expect(provider.getProviderId()).toBe('test-provider');
        });
    });

    describe('getMaxTokens', () => {
        test('プロバイダー別設定のmaxTokensを返す', () => {
            const settings = {
                providers: {
                    'test-provider': {
                        maxTokens: 5000
                    }
                }
            } as unknown as Settings;

            const provider = new TestProvider(settings);
            const maxTokens = (provider as any).getMaxTokens();
            expect(maxTokens).toBe(5000);
        });

        test('グローバル設定のmaxTokensを返す', () => {
            const settings = {
                [StorageKeys.MAX_TOKENS_PER_PROMPT]: 8000
            } as unknown as Settings;

            const provider = new TestProvider(settings);
            const maxTokens = (provider as any).getMaxTokens();
            expect(maxTokens).toBe(8000);
        });

        test('設定がない場合デフォルト値1000を返す', () => {
            const settings = {} as Settings;

            const provider = new TestProvider(settings);
            const maxTokens = (provider as any).getMaxTokens();
            expect(maxTokens).toBe(1000);
        });

        test('providers設定が空の場合グローバル設定を使用する', () => {
            const settings = {
                providers: {},
                [StorageKeys.MAX_TOKENS_PER_PROMPT]: 4000
            } as unknown as Settings;

            const provider = new TestProvider(settings);
            const maxTokens = (provider as any).getMaxTokens();
            expect(maxTokens).toBe(4000);
        });

        test('グローバル設定がNaNの場合はデフォルト値を使用する', () => {
            const settings = {
                [StorageKeys.MAX_TOKENS_PER_PROMPT]: NaN
            } as unknown as Settings;

            const provider = new TestProvider(settings);
            const maxTokens = (provider as any).getMaxTokens();
            expect(maxTokens).toBe(1000);
        });

        test('プロバイダー設定のmaxTokensが0の場合はグローバル設定にフォールバック', () => {
            const settings = {
                providers: {
                    'test-provider': {
                        maxTokens: 0
                    }
                },
                [StorageKeys.MAX_TOKENS_PER_PROMPT]: 6000
            } as unknown as Settings;

            const provider = new TestProvider(settings);
            const maxTokens = (provider as any).getMaxTokens();
            // 0 is falsy, so it should fall through to global
            expect(maxTokens).toBe(6000);
        });

        test('getProviderIdをオーバーライドした場合、そのIDで設定を検索する', () => {
            const settings = {
                providers: {
                    'openai': {
                        maxTokens: 12000
                    }
                }
            } as unknown as Settings;

            const provider = new CustomIdProvider(settings);
            const maxTokens = (provider as any).getMaxTokens();
            expect(maxTokens).toBe(12000);
        });
    });

    describe('getMaxContentChars', () => {
        test('プロバイダー別設定の maxContentChars を返す', () => {
            const settings = {
                providers: {
                    'test-provider': {
                        maxContentChars: 5000
                    }
                }
            } as unknown as Settings;

            const provider = new TestProvider(settings);
            const maxChars = (provider as any).getMaxContentChars(10_000);
            expect(maxChars).toBe(5000);
        });

        test('storageKey 指定時はグローバル設定を優先して返す', () => {
            const settings = {
                [StorageKeys.OPENAI_CONTENT_CHARS]: 15000
            } as unknown as Settings;

            const provider = new TestProvider(settings);
            const maxChars = (provider as any).getMaxContentChars(10_000, StorageKeys.OPENAI_CONTENT_CHARS);
            expect(maxChars).toBe(15000);
        });

        test('プロバイダー別設定が優先される', () => {
            const settings = {
                providers: {
                    'test-provider': {
                        maxContentChars: 7000
                    }
                },
                [StorageKeys.OPENAI_CONTENT_CHARS]: 15000
            } as unknown as Settings;

            const provider = new TestProvider(settings);
            const maxChars = (provider as any).getMaxContentChars(10_000, StorageKeys.OPENAI_CONTENT_CHARS);
            expect(maxChars).toBe(7000);
        });

        test('設定がない場合はデフォルト値を返す', () => {
            const settings = {} as Settings;

            const provider = new TestProvider(settings);
            const maxChars = (provider as any).getMaxContentChars(30_000);
            expect(maxChars).toBe(30_000);
        });
    });

    describe('abstract methods', () => {
        test('generateSummaryを実装できる', async () => {
            const settings = {} as Settings;
            const provider = new TestProvider(settings);
            const result = await provider.generateSummary('test content');
            expect(result.summary).toBe('test summary');
        });

        test('testConnectionを実装できる', async () => {
            const settings = {} as Settings;
            const provider = new TestProvider(settings);
            const result = await provider.testConnection();
            expect(result.success).toBe(true);
            expect(result.message).toBe('OK');
        });

        test('getNameを実装できる', () => {
            const settings = {} as Settings;
            const provider = new TestProvider(settings);
            expect(provider.getName()).toBe('test-provider');
        });
    });
});

describe('checkPreFlight', () => {
    beforeEach(() => {
        checkHardLimitMock.mockResolvedValue({ blocked: false });
        checkUsageWarningMock.mockResolvedValue({ warning: false });
        checkRateLimitMock.mockResolvedValue({ allowed: true, remaining: 9, resetTime: Date.now() + 60000 });
        getRateLimitMessageMock.mockReturnValue('Rate limit exceeded');
    });

    test('hardLimitブロック時は { blocked: true, message } を返す', async () => {
        checkHardLimitMock.mockResolvedValue({ blocked: true, message: 'Monthly limit reached' });
        const settings = {} as Settings;
        const provider = new TestProvider(settings);
        const result = await provider.callCheckPreFlight();
        expect(result.blocked).toBe(true);
        expect(result.message).toBe('Error: Monthly limit reached');
    });

    test('usageWarning時は { blocked: true, message } を返す', async () => {
        checkUsageWarningMock.mockResolvedValue({ warning: true, message: 'Usage warning' });
        const settings = {} as Settings;
        const provider = new TestProvider(settings);
        const result = await provider.callCheckPreFlight();
        expect(result.blocked).toBe(true);
        expect(result.message).toBe('Error: Usage warning');
    });

    test('rateLimitブロック時は { blocked: true, message } を返す', async () => {
        checkRateLimitMock.mockResolvedValue({ allowed: false, remaining: 0, resetTime: Date.now() + 60000 });
        const settings = {} as Settings;
        const provider = new TestProvider(settings);
        const result = await provider.callCheckPreFlight();
        expect(result.blocked).toBe(true);
        expect(result.message).toBe('Error: Rate limit exceeded');
    });

    test('全チェック通過時は { blocked: false } を返す', async () => {
        const settings = {} as Settings;
        const provider = new TestProvider(settings);
        const result = await provider.callCheckPreFlight();
        expect(result.blocked).toBe(false);
    });
});
