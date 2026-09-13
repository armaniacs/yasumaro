/**
 * ProviderStrategy.test.ts
 * Tests for abstract AIProviderStrategy base class
 */


import { vi, describe, test, expect, beforeEach } from 'vitest';
import type { Settings } from '../../../../utils/storage/types.js';
import { StorageKeys } from '../../../../utils/storage/types.js';
import {
    AIProviderStrategy,
    AIProviderConnectionResult,
    AISummaryResult
} from '../ProviderStrategy.js';

const {
    checkHardLimitMock,
    checkUsageWarningMock,
    checkRateLimitMock,
    getRateLimitMessageMock,
    sanitizePromptContentMock,
    addLogMock
} = vi.hoisted(() => ({
    checkHardLimitMock: vi.fn(async (): Promise<{ blocked: boolean; message?: string }> => ({ blocked: false })),
    checkUsageWarningMock: vi.fn(async (): Promise<{ warning: boolean; message?: string }> => ({ warning: false })),
    checkRateLimitMock: vi.fn(async () => ({ allowed: true, remaining: 9, resetTime: Date.now() + 60000 })),
    getRateLimitMessageMock: vi.fn(() => 'Rate limit exceeded'),
    sanitizePromptContentMock: vi.fn((): { sanitized: string; warnings: string[]; dangerLevel: string } => ({ sanitized: 'safe content', warnings: [], dangerLevel: 'low' })),
    addLogMock: vi.fn()
}));

vi.mock('../../../../utils/aiUsageTracker.js', () => ({
    checkHardLimit: checkHardLimitMock,
    checkUsageWarning: checkUsageWarningMock,
    checkRateLimit: checkRateLimitMock,
    getRateLimitMessage: getRateLimitMessageMock
}));

vi.mock('../../../../utils/promptSanitizer.js', () => ({
    sanitizePromptContent: sanitizePromptContentMock
}));

vi.mock('../../../../utils/logger.js', () => ({
    addLog: addLogMock,
    LogType: { WARN: 'warn', ERROR: 'error', INFO: 'info', DEBUG: 'debug' }
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

    callSanitizeContent(content: string, providerName: string, traceId: string) {
        return this.sanitizeContent(content, providerName, traceId);
    }

    callMapConnectionError(statusCode: number, providerLabel: string) {
        return this.mapConnectionError(statusCode, providerLabel);
    }

    callParseAndMapFetchError(msg: string, providerLabel: string, errorName?: string) {
        return this.parseAndMapFetchError(msg, providerLabel, errorName);
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

    override getProviderId(): string {
        return 'openai';
    }
}

describe('AIProviderStrategy', () => {
    describe('constructor', () => {
        test('stores the settings', () => {
            const settings = {} as Settings;
            const provider = new TestProvider(settings);
            expect(provider).toBeDefined();
        });
    });

    describe('getProviderId', () => {
        test('returns the same value as getName() by default', () => {
            const settings = {} as Settings;
            const provider = new TestProvider(settings);
            expect(provider.getProviderId()).toBe('test-provider');
        });
    });

    describe('getMaxTokens', () => {
        test('returns the per-provider maxTokens setting', () => {
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

        test('returns the global maxTokens setting', () => {
            const settings = {
                [StorageKeys.MAX_TOKENS_PER_PROMPT]: 8000
            } as unknown as Settings;

            const provider = new TestProvider(settings);
            const maxTokens = (provider as any).getMaxTokens();
            expect(maxTokens).toBe(8000);
        });

        test('returns the default value 1000 when no setting exists', () => {
            const settings = {} as Settings;

            const provider = new TestProvider(settings);
            const maxTokens = (provider as any).getMaxTokens();
            expect(maxTokens).toBe(1000);
        });

        test('uses the global setting when the providers setting is empty', () => {
            const settings = {
                providers: {},
                [StorageKeys.MAX_TOKENS_PER_PROMPT]: 4000
            } as unknown as Settings;

            const provider = new TestProvider(settings);
            const maxTokens = (provider as any).getMaxTokens();
            expect(maxTokens).toBe(4000);
        });

        test('uses the default value when the global setting is NaN', () => {
            const settings = {
                [StorageKeys.MAX_TOKENS_PER_PROMPT]: NaN
            } as unknown as Settings;

            const provider = new TestProvider(settings);
            const maxTokens = (provider as any).getMaxTokens();
            expect(maxTokens).toBe(1000);
        });

        test('falls back to the global setting when the provider maxTokens is 0', () => {
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

        test('looks up settings by that ID when getProviderId is overridden', () => {
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
        test('returns the per-provider maxContentChars setting', () => {
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

        test('prefers the global setting when a storageKey is specified', () => {
            const settings = {
                [StorageKeys.OPENAI_CONTENT_CHARS]: 15000
            } as unknown as Settings;

            const provider = new TestProvider(settings);
            const maxChars = (provider as any).getMaxContentChars(10_000, StorageKeys.OPENAI_CONTENT_CHARS);
            expect(maxChars).toBe(15000);
        });

        test('prefers the per-provider setting', () => {
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

        test('returns the default value when no setting exists', () => {
            const settings = {} as Settings;

            const provider = new TestProvider(settings);
            const maxChars = (provider as any).getMaxContentChars(30_000);
            expect(maxChars).toBe(30_000);
        });
    });

    describe('abstract methods', () => {
        test('implements generateSummary', async () => {
            const settings = {} as Settings;
            const provider = new TestProvider(settings);
            const result = await provider.generateSummary('test content');
            expect(result.summary).toBe('test summary');
        });

        test('implements testConnection', async () => {
            const settings = {} as Settings;
            const provider = new TestProvider(settings);
            const result = await provider.testConnection();
            expect(result.success).toBe(true);
            expect(result.message).toBe('OK');
        });

        test('implements getName', () => {
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

    test('returns { blocked: true, message } when blocked by hardLimit', async () => {
        checkHardLimitMock.mockResolvedValue({ blocked: true, message: 'Monthly limit reached' });
        const settings = {} as Settings;
        const provider = new TestProvider(settings);
        const result = await provider.callCheckPreFlight();
        expect(result.blocked).toBe(true);
        expect(result.message).toBe('Error: Monthly limit reached');
    });

    test('returns { blocked: true, message } on usageWarning', async () => {
        checkUsageWarningMock.mockResolvedValue({ warning: true, message: 'Usage warning' });
        const settings = {} as Settings;
        const provider = new TestProvider(settings);
        const result = await provider.callCheckPreFlight();
        expect(result.blocked).toBe(true);
        expect(result.message).toBe('Error: Usage warning');
    });

    test('returns { blocked: true, message } when blocked by rateLimit', async () => {
        checkRateLimitMock.mockResolvedValue({ allowed: false, remaining: 0, resetTime: Date.now() + 60000 });
        const settings = {} as Settings;
        const provider = new TestProvider(settings);
        const result = await provider.callCheckPreFlight();
        expect(result.blocked).toBe(true);
        expect(result.message).toBe('Error: Rate limit exceeded');
    });

    test('returns { blocked: false } when all checks pass', async () => {
        const settings = {} as Settings;
        const provider = new TestProvider(settings);
        const result = await provider.callCheckPreFlight();
        expect(result.blocked).toBe(false);
    });
});

describe('sanitizeContent', () => {
    test('returns { blocked: true } when dangerLevel=high', () => {
        sanitizePromptContentMock.mockReturnValue({
            sanitized: 'sanitized',
            warnings: ['injection detected'],
            dangerLevel: 'high'
        });
        const settings = {} as Settings;
        const provider = new TestProvider(settings);
        const result = provider.callSanitizeContent('malicious content', 'test-provider', 'trace-1');
        expect(result.blocked).toBe(true);
        expect(result.warnings).toContain('injection detected');
    });

    test('returns { blocked: false, sanitized } when dangerLevel=low', () => {
        sanitizePromptContentMock.mockReturnValue({
            sanitized: 'safe content',
            warnings: [],
            dangerLevel: 'low'
        });
        const settings = {} as Settings;
        const provider = new TestProvider(settings);
        const result = provider.callSanitizeContent('safe content', 'test-provider', 'trace-1');
        expect(result.blocked).toBe(false);
        expect(result.sanitized).toBe('safe content');
    });

    test('includes category=generic_term in the structured log when dangerLevel=low', () => {
        sanitizePromptContentMock.mockReturnValue({
            sanitized: 'sanitized',
            warnings: ['Detected potential command: "system"'],
            dangerLevel: 'low'
        });
        const settings = {} as Settings;
        const provider = new TestProvider(settings);
        provider.callSanitizeContent('content with generic term', 'test-provider', 'trace-2');

        expect(addLogMock).toHaveBeenCalledWith(
            'warn',
            expect.stringContaining('Prompt injection detected'),
            expect.objectContaining({
                traceId: 'trace-2',
                dangerLevel: 'low',
                category: 'generic_term',
            })
        );
    });
});

describe('mapConnectionError', () => {
    test('returns an authentication failure message on 401', () => {
        const settings = {} as Settings;
        const provider = new TestProvider(settings);
        const result = provider.callMapConnectionError(401, 'OpenAI');
        expect(result.success).toBe(false);
        expect(result.message).toContain('Authentication failed');
        expect(result.debug?.statusCode).toBe(401);
    });

    test('returns an endpoint-not-found message on 404', () => {
        const settings = {} as Settings;
        const provider = new TestProvider(settings);
        const result = provider.callMapConnectionError(404, 'Gemini');
        expect(result.success).toBe(false);
        expect(result.message).toContain('not found');
    });

    test('returns a rate-limit message on 429', () => {
        const settings = {} as Settings;
        const provider = new TestProvider(settings);
        const result = provider.callMapConnectionError(429, 'OpenAI');
        expect(result.success).toBe(false);
        expect(result.message).toContain('Rate limit');
    });

    test('returns a server error message on 500', () => {
        const settings = {} as Settings;
        const provider = new TestProvider(settings);
        const result = provider.callMapConnectionError(500, 'Gemini');
        expect(result.success).toBe(false);
        expect(result.message).toContain('API Error');
    });
});

describe('parseAndMapFetchError', () => {
    test('returns a timeout message on a timeout error', () => {
        const settings = {} as Settings;
        const provider = new TestProvider(settings);
        const result = provider.callParseAndMapFetchError('Request timed out after 30000ms', 'OpenAI');
        expect(result.success).toBe(false);
        expect(result.message).toContain('timed out');
    });

    test('returns a timeout message when the error name is AbortError', () => {
        const settings = {} as Settings;
        const provider = new TestProvider(settings);
        const result = provider.callParseAndMapFetchError('The operation was aborted', 'OpenAI', 'AbortError');
        expect(result.success).toBe(false);
        expect(result.message).toContain('timed out');
    });

    test('returns the matching status message for an HTTP error message', () => {
        const settings = {} as Settings;
        const provider = new TestProvider(settings);
        const result = provider.callParseAndMapFetchError('HTTP 401: Unauthorized', 'Gemini');
        expect(result.success).toBe(false);
        expect(result.message).toContain('Invalid API key');
    });

    test('returns a connection error message on a network error', () => {
        const settings = {} as Settings;
        const provider = new TestProvider(settings);
        const result = provider.callParseAndMapFetchError('Failed to fetch', 'OpenAI');
        expect(result.success).toBe(false);
        expect(result.message).toContain('Cannot connect');
    });

    test('returns a generic error message for other errors', () => {
        const settings = {} as Settings;
        const provider = new TestProvider(settings);
        const result = provider.callParseAndMapFetchError('Unknown error', 'Gemini');
        expect(result.success).toBe(false);
        expect(result.message).toContain('Connection error');
    });
});
