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
