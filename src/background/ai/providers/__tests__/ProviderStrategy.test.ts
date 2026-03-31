/**
 * ProviderStrategy.test.ts
 * Tests for abstract AIProviderStrategy base class
 */

import { describe, test, expect } from '@jest/globals';
import type { Settings } from '../../../../utils/storage.js';
import { StorageKeys } from '../../../../utils/storage.js';
import {
    AIProviderStrategy,
    AIProviderConnectionResult,
    AISummaryResult
} from '../ProviderStrategy.js';

class TestProvider extends AIProviderStrategy {
    async generateSummary(content: string): Promise<AISummaryResult> {
        return { summary: 'test summary' };
    }

    async testConnection(): Promise<AIProviderConnectionResult> {
        return { success: true, message: 'OK' };
    }

    getName(): string {
        return 'test-provider';
    }
}

class CustomIdProvider extends AIProviderStrategy {
    async generateSummary(content: string): Promise<AISummaryResult> {
        return { summary: 'custom' };
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
