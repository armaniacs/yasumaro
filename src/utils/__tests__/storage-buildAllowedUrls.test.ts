/**
 * storage.ts - buildAllowedUrls のテスト
 * 許可URLリスト構築のテスト
 */

import { buildAllowedUrls, StorageKeys, computeUrlsHash, isDomainInWhitelist } from '../../utils/storage.js';

// Mock chrome API
const mockChrome = {
    storage: {
        local: {
            get: vi.fn(),
            set: vi.fn(),
            remove: vi.fn()
        }
    },
    runtime: {
        id: 'test-extension-id'
    }
};

(global as any).chrome = mockChrome;

// Mock crypto
const mockCrypto = {
    getRandomValues: vi.fn((arr: Uint8Array) => {
        for (let i = 0; i < arr.length; i++) {
            arr[i] = Math.floor(Math.random() * 256);
        }
        return arr;
    }),
    subtle: {
        importKey: vi.fn(),
        deriveKey: vi.fn(),
        encrypt: vi.fn(),
        decrypt: vi.fn()
    }
};

(global as any).crypto = mockCrypto;

describe('storage - buildAllowedUrls', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.resetModules();
    });

    describe('buildAllowedUrls', () => {
        it('should add Obsidian local URLs to allowed list', () => {
            const settings = {
                [StorageKeys.OBSIDIAN_PROTOCOL]: 'http',
                [StorageKeys.OBSIDIAN_PORT]: '27123'
            };
            
            const allowedUrls = buildAllowedUrls(settings);
            
            expect(allowedUrls.has('http://127.0.0.1:27123')).toBe(true);
            expect(allowedUrls.has('http://localhost:27123')).toBe(true);
        });

        it('should add HTTPS Obsidian local URLs', () => {
            const settings = {
                [StorageKeys.OBSIDIAN_PROTOCOL]: 'https',
                [StorageKeys.OBSIDIAN_PORT]: '27123'
            };
            
            const allowedUrls = buildAllowedUrls(settings);
            
            expect(allowedUrls.has('https://127.0.0.1:27123')).toBe(true);
            expect(allowedUrls.has('https://localhost:27123')).toBe(true);
        });

        it('should add Gemini API URL', () => {
            const settings = {};
            
            const allowedUrls = buildAllowedUrls(settings);
            
            expect(allowedUrls.has('https://generativelanguage.googleapis.com')).toBe(true);
        });

        it('should add whitelist domain for OpenAI base URL', () => {
            const settings = {
                [StorageKeys.OPENAI_BASE_URL]: 'https://api.openai.com/v1'
            };
            
            const allowedUrls = buildAllowedUrls(settings);
            
            expect(allowedUrls.has('https://api.openai.com/v1')).toBe(true);
        });

        it('should add whitelist domain for Groq', () => {
            const settings = {
                [StorageKeys.OPENAI_BASE_URL]: 'https://api.groq.com/openai/v1'
            };
            
            const allowedUrls = buildAllowedUrls(settings);
            
            expect(allowedUrls.has('https://api.groq.com/openai/v1')).toBe(true);
        });

        it('should add whitelist domain for openai2 (Ollama)', () => {
            const settings = {
                [StorageKeys.OPENAI_2_BASE_URL]: 'http://127.0.0.1:11434/v1'
            };
            
            const allowedUrls = buildAllowedUrls(settings);
            
            // localhost is in the whitelist
            expect(allowedUrls.has('http://127.0.0.1:11434/v1')).toBe(true);
        });

        it('should not add non-whitelisted domains', () => {
            const settings = {
                [StorageKeys.OPENAI_BASE_URL]: 'https://evil.example.com/v1'
            };
            
            const allowedUrls = buildAllowedUrls(settings);
            
            expect(allowedUrls.has('https://evil.example.com/v1')).toBe(false);
        });

        it('should add fixed filter list domains', () => {
            const settings = {};
            
            const allowedUrls = buildAllowedUrls(settings);
            
            expect(allowedUrls.has('https://raw.githubusercontent.com')).toBe(true);
            expect(allowedUrls.has('https://gitlab.com')).toBe(true);
            expect(allowedUrls.has('https://easylist.to')).toBe(true);
            expect(allowedUrls.has('https://pgl.yoyo.org')).toBe(true);
        });

        it('should add uBlock sources origins', () => {
            const settings = {
                [StorageKeys.UBLOCK_SOURCES]: [
                    { url: 'https://raw.githubusercontent.com/user/repo/main/filters.txt' },
                    { url: 'manual' }
                ]
            };
            
            const allowedUrls = buildAllowedUrls(settings);
            
            expect(allowedUrls.has('https://raw.githubusercontent.com')).toBe(true);
        });

        it('should handle empty settings', () => {
            const allowedUrls = buildAllowedUrls({});
            
            // Should still have default URLs
            expect(allowedUrls.size).toBeGreaterThan(0);
        });
    });

    describe('computeUrlsHash', () => {
        it('should compute hash for sorted URLs', () => {
            const urls = new Set(['https://b.com', 'https://a.com', 'https://c.com']);
            const hash = computeUrlsHash(urls);
            
            expect(hash).toBe('https://a.com|https://b.com|https://c.com');
        });

        it('should handle empty set', () => {
            const urls = new Set<string>();
            const hash = computeUrlsHash(urls);
            
            expect(hash).toBe('');
        });
    });

    describe('isDomainInWhitelist', () => {
        it('should return true for whitelisted domains', () => {
            expect(isDomainInWhitelist('https://api.openai.com')).toBe(true);
            expect(isDomainInWhitelist('https://api.groq.com')).toBe(true);
            expect(isDomainInWhitelist('https://generativelanguage.googleapis.com')).toBe(true);
        });

        it('should return true for localhost', () => {
            expect(isDomainInWhitelist('http://localhost:11434')).toBe(true);
            expect(isDomainInWhitelist('http://127.0.0.1:11434')).toBe(true);
        });

        it('should return false for non-whitelisted domains', () => {
            expect(isDomainInWhitelist('https://evil.example.com')).toBe(false);
            expect(isDomainInWhitelist('https://malicious-site.com')).toBe(false);
        });

        it('should handle invalid URLs', () => {
            expect(isDomainInWhitelist('not-a-url')).toBe(false);
            expect(isDomainInWhitelist('')).toBe(false);
        });
    });
});
