/**
 * types.test.ts
 * src/utils/types.ts のコンパイル時・実行時テスト
 * 型インターフェースが正しく使用でき、構造上の不整合を防ぐ
 */

import { describe, it, expect } from 'vitest';
import type { CustomPrompt, TagCategory, Source, UblockRule, UblockRules } from '../types.js';

describe('types: TagCategory', () => {
    it('有効な TagCategory オブジェクトが構築できる', () => {
        const category: TagCategory = {
            name: 'TestCategory',
            isDefault: false,
            createdAt: Date.now(),
        };
        expect(category.name).toBe('TestCategory');
        expect(category.isDefault).toBe(false);
        expect(typeof category.createdAt).toBe('number');
    });

    it('isDefault = true の TagCategory が構築できる', () => {
        const category: TagCategory = {
            name: 'Default',
            isDefault: true,
            createdAt: 0,
        };
        expect(category.isDefault).toBe(true);
    });
});

describe('types: CustomPrompt', () => {
    it('必須フィールドのみで CustomPrompt を構築できる', () => {
        const now = Date.now();
        const prompt: CustomPrompt = {
            id: 'prompt-1',
            name: 'Summarize',
            prompt: 'Summarize: {{content}}',
            provider: 'gemini',
            isActive: true,
            createdAt: now,
            updatedAt: now,
        };
        expect(prompt.id).toBe('prompt-1');
        expect(prompt.provider).toBe('gemini');
        expect(prompt.systemPrompt).toBeUndefined();
    });

    it('全プロバイダー値で CustomPrompt を構築できる', () => {
        const providers: CustomPrompt['provider'][] = ['gemini', 'openai', 'openai2', 'all'];
        const now = Date.now();
        providers.forEach((provider) => {
            const prompt: CustomPrompt = {
                id: `p-${provider}`,
                name: provider,
                prompt: 'test',
                provider,
                isActive: false,
                createdAt: now,
                updatedAt: now,
            };
            expect(prompt.provider).toBe(provider);
        });
    });

    it('systemPrompt を含む CustomPrompt が構築できる', () => {
        const now = Date.now();
        const prompt: CustomPrompt = {
            id: 'prompt-2',
            name: 'Translate',
            prompt: 'Translate: {{content}}',
            systemPrompt: 'You are a helpful assistant.',
            provider: 'openai',
            isActive: true,
            createdAt: now,
            updatedAt: now,
        };
        expect(prompt.systemPrompt).toBe('You are a helpful assistant.');
    });
});

describe('types: UblockRule', () => {
    it('オプションなしで UblockRule を構築できる', () => {
        const rule: UblockRule = {
            domain: 'example.com',
        };
        expect(rule.domain).toBe('example.com');
    });

    it('オプション付きで UblockRule を構築できる', () => {
        const rule: UblockRule = {
            domain: 'example.com',
            options: { block: true },
        };
        expect(rule.options).toEqual({ block: true });
    });

    it('追加プロパティを持つ UblockRule を構築できる', () => {
        const rule: UblockRule = {
            domain: 'example.com',
            foo: 'bar',
        };
        expect((rule as any).foo).toBe('bar');
    });
});

describe('types: UblockRules', () => {
    it('最小構成の UblockRules を構築できる', () => {
        const rules: UblockRules = {
            blockDomains: [],
            exceptionDomains: [],
        };
        expect(rules.blockDomains).toEqual([]);
        expect(rules.exceptionDomains).toEqual([]);
        expect(rules.blockRules).toBeUndefined();
        expect(rules.metadata).toBeUndefined();
    });

    it('完全な UblockRules を構築できる', () => {
        const rules: UblockRules = {
            blockDomains: ['ads.example.com'],
            exceptionDomains: ['safe.example.com'],
            blockRules: [{ domain: 'block.me' }],
            exceptionRules: [{ domain: 'allow.me' }],
            metadata: {
                importedAt: Date.now(),
                ruleCount: 42,
            },
        };
        expect(rules.metadata!.ruleCount).toBe(42);
        expect(rules.blockRules).toHaveLength(1);
    });
});

describe('types: Source', () => {
    it('有効な Source オブジェクトを構築できる', () => {
        const source: Source = {
            url: 'https://example.com/filters.txt',
            ruleCount: 100,
            blockDomains: ['bad.com'],
            exceptionDomains: ['good.com'],
            importedAt: Date.now(),
        };
        expect(source.url).toContain('filters.txt');
        expect(source.blockDomains).toContain('bad.com');
    });
});

describe('types: 型定義のファイル内整合性チェック', () => {
    it('UblockRules の blockDomains は string[] である', () => {
        const r: UblockRules = { blockDomains: ['a.com', 'b.com'], exceptionDomains: [] };
        expect(r.blockDomains.every((d) => typeof d === 'string')).toBe(true);
    });

    it('CustomPrompt の provider は4種類の文字列リテラルのいずれか', () => {
        const validProviders = new Set(['gemini', 'openai', 'openai2', 'all']);
        const now = Date.now();
        const prompt: CustomPrompt = {
            id: '1',
            name: 'n',
            prompt: 'p',
            provider: 'openai2',
            isActive: true,
            createdAt: now,
            updatedAt: now,
        };
        expect(validProviders.has(prompt.provider)).toBe(true);
    });
});

describe('types: TagCategory edge cases', () => {
    it('handles empty name string', () => {
        const category: TagCategory = {
            name: '',
            isDefault: false,
            createdAt: 0,
        };
        expect(category.name).toBe('');
    });

    it('handles very long name', () => {
        const longName = 'x'.repeat(1000);
        const category: TagCategory = {
            name: longName,
            isDefault: false,
            createdAt: Date.now(),
        };
        expect(category.name).toHaveLength(1000);
    });

    it('handles negative createdAt timestamp', () => {
        const category: TagCategory = {
            name: 'Old',
            isDefault: true,
            createdAt: -1,
        };
        expect(category.createdAt).toBe(-1);
    });
});

describe('types: CustomPrompt edge cases', () => {
    it('handles empty prompt string', () => {
        const now = Date.now();
        const prompt: CustomPrompt = {
            id: 'empty',
            name: 'Empty',
            prompt: '',
            provider: 'all',
            isActive: false,
            createdAt: now,
            updatedAt: now,
        };
        expect(prompt.prompt).toBe('');
    });

    it('handles prompt with special characters', () => {
        const now = Date.now();
        const prompt: CustomPrompt = {
            id: 'special',
            name: 'Special',
            prompt: '{{content}}\n\t日本語 <>&',
            provider: 'gemini',
            isActive: true,
            createdAt: now,
            updatedAt: now,
        };
        expect(prompt.prompt).toContain('日本語');
    });

    it('handles empty systemPrompt', () => {
        const now = Date.now();
        const prompt: CustomPrompt = {
            id: 'empty-sys',
            name: 'Empty Sys',
            prompt: 'test',
            systemPrompt: '',
            provider: 'openai',
            isActive: true,
            createdAt: now,
            updatedAt: now,
        };
        expect(prompt.systemPrompt).toBe('');
    });

    it('has createdAt equal to updatedAt when newly created', () => {
        const now = Date.now();
        const prompt: CustomPrompt = {
            id: 'new',
            name: 'New',
            prompt: 'test',
            provider: 'gemini',
            isActive: true,
            createdAt: now,
            updatedAt: now,
        };
        expect(prompt.createdAt).toBe(prompt.updatedAt);
    });
});

describe('types: UblockRules edge cases', () => {
    it('handles empty arrays for all list fields', () => {
        const rules: UblockRules = {
            blockDomains: [],
            exceptionDomains: [],
            blockRules: [],
            exceptionRules: [],
            metadata: {
                importedAt: 0,
                ruleCount: 0,
            },
        };
        expect(rules.blockRules).toHaveLength(0);
        expect(rules.exceptionRules).toHaveLength(0);
        expect(rules.metadata!.ruleCount).toBe(0);
    });

    it('handles large domain lists', () => {
        const domains = Array.from({ length: 1000 }, (_, i) => `domain-${i}.com`);
        const rules: UblockRules = {
            blockDomains: domains,
            exceptionDomains: [],
        };
        expect(rules.blockDomains).toHaveLength(1000);
    });

    it('allows metadata with zero ruleCount', () => {
        const rules: UblockRules = {
            blockDomains: [],
            exceptionDomains: [],
            metadata: {
                importedAt: 0,
                ruleCount: 0,
            },
        };
        expect(rules.metadata!.importedAt).toBe(0);
    });
});

describe('types: Source edge cases', () => {
    it('handles empty URL string', () => {
        const source: Source = {
            url: '',
            ruleCount: 0,
            blockDomains: [],
            exceptionDomains: [],
            importedAt: 0,
        };
        expect(source.url).toBe('');
    });

    it('handles empty domain arrays', () => {
        const source: Source = {
            url: 'https://example.com/filters.txt',
            ruleCount: 0,
            blockDomains: [],
            exceptionDomains: [],
            importedAt: Date.now(),
        };
        expect(source.blockDomains).toHaveLength(0);
        expect(source.exceptionDomains).toHaveLength(0);
    });

    it('handles overlapping domains in block and exception lists', () => {
        const source: Source = {
            url: 'https://example.com/filters.txt',
            ruleCount: 2,
            blockDomains: ['example.com', 'test.com'],
            exceptionDomains: ['example.com', 'safe.com'],
            importedAt: Date.now(),
        };
        expect(source.blockDomains).toContain('example.com');
        expect(source.exceptionDomains).toContain('example.com');
    });
});

describe('types: UblockRule edge cases', () => {
    it('handles empty string domain', () => {
        const rule: UblockRule = {
            domain: '',
        };
        expect(rule.domain).toBe('');
    });

    it('handles wildcard domain', () => {
        const rule: UblockRule = {
            domain: '*.example.com',
            options: { wildcard: true },
        };
        expect(rule.domain).toBe('*.example.com');
    });

    it('handles numerous extra properties', () => {
        const rule: UblockRule = {
            domain: 'example.com',
            foo: 'bar',
            baz: 123,
            nested: { deep: true },
        };
        expect((rule as any).foo).toBe('bar');
        expect((rule as any).baz).toBe(123);
    });
});
