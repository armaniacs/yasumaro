/**
 * customPromptUtils.test.ts
 * customPromptUtils.ts の単体テスト
 */

import { webcrypto as crypto } from '@peculiar/webcrypto';
Object.defineProperty(global, 'crypto', {
    value: crypto
});

// logger モック
jest.mock('../logger.js', () => ({
    addLog: jest.fn(),
    LogType: { INFO: 'info', WARN: 'warn', ERROR: 'error', DEBUG: 'debug' }
}));

// promptSanitizer モック
jest.mock('../promptSanitizer.js', () => ({
    sanitizePromptContent: jest.fn(() => ({ dangerLevel: 'low', warnings: [] })),
    DangerLevel: { LOW: 'low', MEDIUM: 'medium', HIGH: 'high' }
}));

// tagUtils モック
jest.mock('../tagUtils.js', () => ({
    getAllCategories: jest.fn(() => ['IT', 'Science', 'Business'])
}));

// storage モック
jest.mock('../storage.js', () => ({
    StorageKeys: {
        CUSTOM_PROMPTS: 'custom_prompts'
    }
}));

import {
    getDefaultUserPrompt,
    getDefaultSystemPrompt,
    getBrowserLocale,
    DEFAULT_USER_PROMPT_JA,
    DEFAULT_USER_PROMPT_EN,
    DEFAULT_SYSTEM_PROMPT_JA,
    DEFAULT_SYSTEM_PROMPT_EN,
    DEFAULT_USER_PROMPT,
    DEFAULT_SYSTEM_PROMPT,
    PRESET_PROMPTS,
    getPresetPrompt,
    getPromptDisplayName,
    buildTaggedSummaryPrompt,
    replaceContentPlaceholder,
    validatePrompt,
    getActivePrompt,
    applyCustomPrompt,
    generatePromptId,
    createPrompt,
    updatePrompt,
    deletePrompt,
    setActivePrompt
} from '../customPromptUtils.js';

describe('customPromptUtils', () => {

    describe('定数', () => {
        test('DEFAULT_USER_PROMPT_JA が定義されている', () => {
            expect(DEFAULT_USER_PROMPT_JA).toContain('{{content}}');
            expect(DEFAULT_USER_PROMPT_JA).toContain('日本語');
        });

        test('DEFAULT_USER_PROMPT_EN が定義されている', () => {
            expect(DEFAULT_USER_PROMPT_EN).toContain('{{content}}');
            expect(DEFAULT_USER_PROMPT_EN).toContain('English');
        });

        test('DEFAULT_SYSTEM_PROMPT_JA が定義されている', () => {
            expect(DEFAULT_SYSTEM_PROMPT_JA).toContain('Japanese');
        });

        test('DEFAULT_SYSTEM_PROMPT_EN が定義されている', () => {
            expect(DEFAULT_SYSTEM_PROMPT_EN).toContain('English');
        });

        test('DEFAULT_USER_PROMPT は JA のエイリアス', () => {
            expect(DEFAULT_USER_PROMPT).toBe(DEFAULT_USER_PROMPT_JA);
        });

        test('DEFAULT_SYSTEM_PROMPT は JA のエイリアス', () => {
            expect(DEFAULT_SYSTEM_PROMPT).toBe(DEFAULT_SYSTEM_PROMPT_JA);
        });

        test('PRESET_PROMPTS が5つ定義されている', () => {
            expect(PRESET_PROMPTS).toHaveLength(5);
            expect(PRESET_PROMPTS.map(p => p.id)).toEqual(['default', 'tagged', 'bullet', 'english', 'technical']);
        });

        test('各プリセットに必須フィールドが含まれる', () => {
            for (const preset of PRESET_PROMPTS) {
                expect(preset.id).toBeDefined();
                expect(preset.name).toBeDefined();
                expect(preset.nameJa).toBeDefined();
                expect(preset.userPrompt).toBeDefined();
                expect(preset.userPrompt).toContain('{{content}}');
            }
        });
    });

    describe('getDefaultUserPrompt', () => {
        test('ja ロケールで日本語プロンプトを返す', () => {
            expect(getDefaultUserPrompt('ja')).toBe(DEFAULT_USER_PROMPT_JA);
        });

        test('en ロケールで英語プロンプトを返す', () => {
            expect(getDefaultUserPrompt('en')).toBe(DEFAULT_USER_PROMPT_EN);
        });

        test('デフォルトは ja', () => {
            expect(getDefaultUserPrompt()).toBe(DEFAULT_USER_PROMPT_JA);
        });
    });

    describe('getDefaultSystemPrompt', () => {
        test('ja ロケールで日本語システムプロンプトを返す', () => {
            expect(getDefaultSystemPrompt('ja')).toBe(DEFAULT_SYSTEM_PROMPT_JA);
        });

        test('en ロケールで英語システムプロンプトを返す', () => {
            expect(getDefaultSystemPrompt('en')).toBe(DEFAULT_SYSTEM_PROMPT_EN);
        });

        test('デフォルトは ja', () => {
            expect(getDefaultSystemPrompt()).toBe(DEFAULT_SYSTEM_PROMPT_JA);
        });
    });

    describe('getBrowserLocale', () => {
        test('日本語ロケールの場合は ja を返す', () => {
            Object.defineProperty(global, 'navigator', {
                value: { language: 'ja-JP' },
                configurable: true,
                writable: true
            });
            expect(getBrowserLocale()).toBe('ja');
        });

        test('英語ロケールの場合は en を返す', () => {
            Object.defineProperty(global, 'navigator', {
                value: { language: 'en-US' },
                configurable: true,
                writable: true
            });
            expect(getBrowserLocale()).toBe('en');
        });

        test('文字列を返す', () => {
            const locale = getBrowserLocale();
            expect(['ja', 'en']).toContain(locale);
        });
    });

    describe('getPresetPrompt', () => {
        test('有効な ID でプリセットを返す', () => {
            const preset = getPresetPrompt('default');
            expect(preset).toBeDefined();
            expect(preset?.id).toBe('default');
        });

        test('無効な ID で undefined を返す', () => {
            expect(getPresetPrompt('nonexistent')).toBeUndefined();
        });

        test('全プリセットが取得できる', () => {
            for (const p of PRESET_PROMPTS) {
                expect(getPresetPrompt(p.id)).toEqual(p);
            }
        });
    });

    describe('getPromptDisplayName', () => {
        const preset = PRESET_PROMPTS[0];

        test('ja ロケールで日本語名を返す', () => {
            expect(getPromptDisplayName(preset, 'ja')).toBe(preset.nameJa);
        });

        test('en ロケールで英語名を返す', () => {
            expect(getPromptDisplayName(preset, 'en')).toBe(preset.name);
        });
    });

    describe('buildTaggedSummaryPrompt', () => {
        test('カテゴリとコンテンツを含むプロンプトを生成する', () => {
            const settings = {};
            const result = buildTaggedSummaryPrompt(settings, 'test content');

            expect(result).toContain('test content');
            expect(result).toContain('IT');
            expect(result).toContain('Science');
            expect(result).toContain('Business');
        });

        test('プロンプトに "#カテゴリ1" "#カテゴリ2" というリテラルが含まれない', () => {
            // instruction leakage 対策: LLMがこの文字列をオウム返しするのを防ぐ
            const result = buildTaggedSummaryPrompt({}, 'content');
            expect(result).not.toContain('#カテゴリ1');
            expect(result).not.toContain('#カテゴリ2');
        });

        test('プロンプトに "要約文（改行なし）" というリテラルが含まれない', () => {
            // instruction leakage 対策
            const result = buildTaggedSummaryPrompt({}, 'content');
            expect(result).not.toContain('要約文（改行なし）');
        });

        test('出力形式の指示が1行のみであることを明示する', () => {
            const result = buildTaggedSummaryPrompt({}, 'content');
            // 1行出力の指示が含まれる
            expect(result.toLowerCase()).toMatch(/one line|1行|1 line/i);
        });
    });

    describe('replaceContentPlaceholder', () => {
        test('{{content}} を置換する', () => {
            const result = replaceContentPlaceholder('Hello {{content}}', 'World');
            expect(result).toBe('Hello World');
        });

        test('大文字小文字を区別しない', () => {
            const result = replaceContentPlaceholder('Hello {{CONTENT}}', 'World');
            expect(result).toBe('Hello World');
        });

        test('プレースホルダーがない場合はそのまま返す', () => {
            const result = replaceContentPlaceholder('No placeholder', 'World');
            expect(result).toBe('No placeholder');
        });

        test('複数のプレースホルダーを置換する', () => {
            const result = replaceContentPlaceholder('{{content}} and {{content}}', 'X');
            expect(result).toBe('X and X');
        });
    });

    describe('validatePrompt', () => {
        test('有効なプロンプトで valid: true を返す', () => {
            const result = validatePrompt('Summarize: {{content}}');
            expect(result.valid).toBe(true);
        });

        test('空文字列で valid: false を返す', () => {
            const result = validatePrompt('');
            expect(result.valid).toBe(false);
            expect(result.error).toBe('Prompt is required');
        });

        test('5000文字超過で valid: false を返す', () => {
            const longPrompt = 'a'.repeat(5001);
            const result = validatePrompt(longPrompt);
            expect(result.valid).toBe(false);
            expect(result.error).toContain('too long');
        });

        test('5000文字ちょうどで valid: true', () => {
            const prompt = 'a'.repeat(5000);
            const result = validatePrompt(prompt);
            expect(result.valid).toBe(true);
        });
    });

    describe('getActivePrompt', () => {
        test('プロバイダー固有のプロンプトを返す', () => {
            const settings = {
                custom_prompts: [
                    { id: '1', name: 'Test', prompt: 'test', isActive: true, provider: 'gemini', createdAt: 0, updatedAt: 0 }
                ]
            };
            const result = getActivePrompt(settings, 'gemini');
            expect(result).not.toBeNull();
            expect(result?.id).toBe('1');
        });

        test('all プロバイダーのプロンプトを返す', () => {
            const settings = {
                custom_prompts: [
                    { id: '1', name: 'Test', prompt: 'test', isActive: true, provider: 'all', createdAt: 0, updatedAt: 0 }
                ]
            };
            const result = getActivePrompt(settings, 'gemini');
            expect(result).not.toBeNull();
            expect(result?.id).toBe('1');
        });

        test('プロンプトが空の場合は null', () => {
            const settings = { custom_prompts: [] };
            expect(getActivePrompt(settings, 'gemini')).toBeNull();
        });

        test('カスタムプロンプトがない場合は null', () => {
            const settings = {};
            expect(getActivePrompt(settings, 'gemini')).toBeNull();
        });

        test('isActive=false のプロンプトは返さない', () => {
            const settings = {
                custom_prompts: [
                    { id: '1', name: 'Test', prompt: 'test', isActive: false, provider: 'gemini', createdAt: 0, updatedAt: 0 }
                ]
            };
            expect(getActivePrompt(settings, 'gemini')).toBeNull();
        });

        test('プロバイダー固有が優先される', () => {
            const settings = {
                custom_prompts: [
                    { id: '1', name: 'All', prompt: 'all', isActive: true, provider: 'all', createdAt: 0, updatedAt: 0 },
                    { id: '2', name: 'Gemini', prompt: 'gemini', isActive: true, provider: 'gemini', createdAt: 0, updatedAt: 0 }
                ]
            };
            const result = getActivePrompt(settings, 'gemini');
            expect(result?.id).toBe('2');
        });
    });

    describe('applyCustomPrompt', () => {
        test('カスタムプロンプトが有効な場合はそれを使用する', () => {
            const settings = {
                custom_prompts: [
                    { id: '1', name: 'Custom', prompt: 'Custom: {{content}}', isActive: true, provider: 'gemini', createdAt: 0, updatedAt: 0 }
                ]
            };
            const result = applyCustomPrompt(settings, 'gemini', 'test content');

            expect(result.isCustom).toBe(true);
            expect(result.userPrompt).toBe('Custom: test content');
        });

        test('カスタムがない場合はデフォルトを使用する', () => {
            const settings = {};
            const result = applyCustomPrompt(settings, 'gemini', 'test content');

            expect(result.isCustom).toBe(false);
            expect(result.userPrompt).toContain('test content');
        });

        test('タグ付き要約モードでプロンプトを生成する', () => {
            const settings = {};
            const result = applyCustomPrompt(settings, 'gemini', 'test content', true);

            expect(result.isCustom).toBe(false);
            expect(result.userPrompt).toContain('test content');
            expect(result.userPrompt).toContain('カテゴリ');
        });

        test('カスタムシステムプロンプトを使用する', () => {
            const settings = {
                custom_prompts: [
                    { id: '1', name: 'Custom', prompt: '{{content}}', systemPrompt: 'Custom system', isActive: true, provider: 'gemini', createdAt: 0, updatedAt: 0 }
                ]
            };
            const result = applyCustomPrompt(settings, 'gemini', 'test');

            expect(result.systemPrompt).toBe('Custom system');
        });

        test('システムプロンプトがない場合はデフォルトを使用する', () => {
            Object.defineProperty(global, 'navigator', {
                value: { language: 'ja-JP' },
                configurable: true,
                writable: true
            });
            const settings = {
                custom_prompts: [
                    { id: '1', name: 'Custom', prompt: '{{content}}', isActive: true, provider: 'gemini', createdAt: 0, updatedAt: 0 }
                ]
            };
            const result = applyCustomPrompt(settings, 'gemini', 'test');

            expect(result.systemPrompt).toBe(DEFAULT_SYSTEM_PROMPT_JA);
        });

        test('en ロケールでデフォルト英語プロンプトを使用する', () => {
            const settings = {};
            const result = applyCustomPrompt(settings, 'gemini', 'test', false, 'en');

            expect(result.userPrompt).toContain('test');
            expect(result.systemPrompt).toBe(DEFAULT_SYSTEM_PROMPT_EN);
        });
    });

    describe('generatePromptId', () => {
        test('prompt_ プレフィックスを持つ', () => {
            const id = generatePromptId();
            expect(id).toMatch(/^prompt_\d+_[a-z0-9]+$/);
        });

        test('毎回異なるIDを生成する', () => {
            const id1 = generatePromptId();
            const id2 = generatePromptId();
            expect(id1).not.toBe(id2);
        });
    });

    describe('createPrompt', () => {
        test('createdAt と updatedAt が設定される', () => {
            const before = Date.now();
            const prompt = createPrompt({
                name: 'Test',
                prompt: '{{content}}',
                isActive: false,
                provider: 'gemini'
            });
            const after = Date.now();

            expect(prompt.id).toMatch(/^prompt_/);
            expect(prompt.createdAt).toBeGreaterThanOrEqual(before);
            expect(prompt.createdAt).toBeLessThanOrEqual(after);
            expect(prompt.updatedAt).toBe(prompt.createdAt);
            expect(prompt.name).toBe('Test');
        });
    });

    describe('updatePrompt', () => {
        test('指定したIDのプロンプトを更新する', () => {
            const prompts = [
                { id: '1', name: 'A', prompt: 'a', isActive: false, provider: 'all', createdAt: 0, updatedAt: 0 },
                { id: '2', name: 'B', prompt: 'b', isActive: false, provider: 'all', createdAt: 0, updatedAt: 0 }
            ];
            const result = updatePrompt(prompts, '1', { name: 'Updated' });

            expect(result[0].name).toBe('Updated');
            expect(result[1].name).toBe('B');
        });

        test('updatedAt が更新される', () => {
            const prompts = [
                { id: '1', name: 'A', prompt: 'a', isActive: false, provider: 'all', createdAt: 0, updatedAt: 0 }
            ];
            const result = updatePrompt(prompts, '1', { name: 'Updated' });

            expect(result[0].updatedAt).toBeGreaterThan(0);
        });

        test('存在しないIDの場合は変更しない', () => {
            const prompts = [
                { id: '1', name: 'A', prompt: 'a', isActive: false, provider: 'all', createdAt: 0, updatedAt: 0 }
            ];
            const result = updatePrompt(prompts, 'nonexistent', { name: 'Updated' });

            expect(result[0].name).toBe('A');
        });
    });

    describe('deletePrompt', () => {
        test('指定したIDのプロンプトを削除する', () => {
            const prompts = [
                { id: '1', name: 'A', prompt: 'a', isActive: false, provider: 'all', createdAt: 0, updatedAt: 0 },
                { id: '2', name: 'B', prompt: 'b', isActive: false, provider: 'all', createdAt: 0, updatedAt: 0 }
            ];
            const result = deletePrompt(prompts, '1');

            expect(result).toHaveLength(1);
            expect(result[0].id).toBe('2');
        });

        test('存在しないIDの場合はそのまま返す', () => {
            const prompts = [
                { id: '1', name: 'A', prompt: 'a', isActive: false, provider: 'all', createdAt: 0, updatedAt: 0 }
            ];
            const result = deletePrompt(prompts, 'nonexistent');

            expect(result).toHaveLength(1);
        });
    });

    describe('setActivePrompt', () => {
        test('指定したプロンプトをアクティブにする', () => {
            const prompts = [
                { id: '1', name: 'A', prompt: 'a', isActive: false, provider: 'gemini', createdAt: 0, updatedAt: 0 }
            ];
            const result = setActivePrompt(prompts, '1', 'gemini');

            expect(result[0].isActive).toBe(true);
        });

        test('同じスコープの他のプロンプトを非アクティブにする', () => {
            const prompts = [
                { id: '1', name: 'A', prompt: 'a', isActive: true, provider: 'gemini', createdAt: 0, updatedAt: 0 },
                { id: '2', name: 'B', prompt: 'b', isActive: false, provider: 'gemini', createdAt: 0, updatedAt: 0 }
            ];
            const result = setActivePrompt(prompts, '2', 'gemini');

            expect(result[0].isActive).toBe(false);
            expect(result[1].isActive).toBe(true);
        });

        test('存在しないIDの場合は変更しない', () => {
            const prompts = [
                { id: '1', name: 'A', prompt: 'a', isActive: false, provider: 'gemini', createdAt: 0, updatedAt: 0 }
            ];
            const result = setActivePrompt(prompts, 'nonexistent', 'gemini');

            expect(result[0].isActive).toBe(false);
        });

        test('all スコープのプロンプトが他のプロバイダープロンプトも管理する', () => {
            const prompts = [
                { id: '1', name: 'All', prompt: 'a', isActive: true, provider: 'all', createdAt: 0, updatedAt: 0 },
                { id: '2', name: 'Gemini', prompt: 'b', isActive: true, provider: 'gemini', createdAt: 0, updatedAt: 0 }
            ];
            const result = setActivePrompt(prompts, '1', 'all');

            expect(result[0].isActive).toBe(true);
            expect(result[1].isActive).toBe(false);
        });
    });
});
