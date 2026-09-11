/**
 * customPromptUtils.test.ts
 * customPromptUtils.ts の単体テスト
 */

import { Crypto } from '@peculiar/webcrypto';
Object.defineProperty(global, 'crypto', {
    value: new Crypto()
});

// logger モック
vi.mock('../logger.js', () => ({
    addLog: vi.fn(),
    LogType: { INFO: 'info', WARN: 'warn', ERROR: 'error', DEBUG: 'debug' }
}));

// promptSanitizer モック
vi.mock('../promptSanitizer.js', () => ({
    sanitizePromptContent: vi.fn(() => ({ dangerLevel: 'low', warnings: [] })),
    DangerLevel: { LOW: 'low', MEDIUM: 'medium', HIGH: 'high' }
}));

// tagUtils モック
vi.mock('../tagUtils.js', () => ({
    getAllCategories: vi.fn(() => ['IT', 'Science', 'Business'])
}));

// storage モック
vi.mock('../storage/types.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

      StorageKeys: {
          CUSTOM_PROMPTS: 'custom_prompts'
      }

  } as Record<string, unknown>;
  return {
    ...actual,
    ...Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [
        k,
        v !== null && typeof v === 'object' && !Array.isArray(v) &&
        actual[k] !== null && typeof actual[k] === 'object' && !Array.isArray(actual[k])
          ? { ...(actual[k] as Record<string, unknown>), ...(v as Record<string, unknown>) }
          : v,
      ]),
    ),
  };
});;
vi.mock('../storage/defaults.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

      StorageKeys: {
          CUSTOM_PROMPTS: 'custom_prompts'
      }

  } as Record<string, unknown>;
  return {
    ...actual,
    ...Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [
        k,
        v !== null && typeof v === 'object' && !Array.isArray(v) &&
        actual[k] !== null && typeof actual[k] === 'object' && !Array.isArray(actual[k])
          ? { ...(actual[k] as Record<string, unknown>), ...(v as Record<string, unknown>) }
          : v,
      ]),
    ),
  };
});;
vi.mock('../storage/encryptionSession.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

      StorageKeys: {
          CUSTOM_PROMPTS: 'custom_prompts'
      }

  } as Record<string, unknown>;
  return {
    ...actual,
    ...Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [
        k,
        v !== null && typeof v === 'object' && !Array.isArray(v) &&
        actual[k] !== null && typeof actual[k] === 'object' && !Array.isArray(actual[k])
          ? { ...(actual[k] as Record<string, unknown>), ...(v as Record<string, unknown>) }
          : v,
      ]),
    ),
  };
});;
vi.mock('../storage/savedUrlRepository.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

      StorageKeys: {
          CUSTOM_PROMPTS: 'custom_prompts'
      }

  } as Record<string, unknown>;
  return {
    ...actual,
    ...Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [
        k,
        v !== null && typeof v === 'object' && !Array.isArray(v) &&
        actual[k] !== null && typeof actual[k] === 'object' && !Array.isArray(actual[k])
          ? { ...(actual[k] as Record<string, unknown>), ...(v as Record<string, unknown>) }
          : v,
      ]),
    ),
  };
});;
vi.mock('../storage/domainFilterCache.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

      StorageKeys: {
          CUSTOM_PROMPTS: 'custom_prompts'
      }

  } as Record<string, unknown>;
  return {
    ...actual,
    ...Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [
        k,
        v !== null && typeof v === 'object' && !Array.isArray(v) &&
        actual[k] !== null && typeof actual[k] === 'object' && !Array.isArray(actual[k])
          ? { ...(actual[k] as Record<string, unknown>), ...(v as Record<string, unknown>) }
          : v,
      ]),
    ),
  };
});;
vi.mock('../storage/quota.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

      StorageKeys: {
          CUSTOM_PROMPTS: 'custom_prompts'
      }

  } as Record<string, unknown>;
  return {
    ...actual,
    ...Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [
        k,
        v !== null && typeof v === 'object' && !Array.isArray(v) &&
        actual[k] !== null && typeof actual[k] === 'object' && !Array.isArray(actual[k])
          ? { ...(actual[k] as Record<string, unknown>), ...(v as Record<string, unknown>) }
          : v,
      ]),
    ),
  };
});;

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
import { addLog } from '../logger.js';
import { sanitizePromptContent } from '../promptSanitizer.js';
import type { Settings } from '../storage/types.js';
import type { CustomPrompt } from '../customPromptUtils.js';

const asSettings = (value: unknown): Settings => value as Settings;
const asPrompts = (value: unknown): CustomPrompt[] => value as CustomPrompt[];

describe('customPromptUtils', () => {

    describe('定数', () => {
        test('defines DEFAULT_USER_PROMPT_JA', () => {
            expect(DEFAULT_USER_PROMPT_JA).toContain('{{content}}');
            expect(DEFAULT_USER_PROMPT_JA).toContain('日本語');
        });

        test('defines DEFAULT_USER_PROMPT_EN', () => {
            expect(DEFAULT_USER_PROMPT_EN).toContain('{{content}}');
            expect(DEFAULT_USER_PROMPT_EN).toContain('English');
        });

        test('defines DEFAULT_SYSTEM_PROMPT_JA', () => {
            expect(DEFAULT_SYSTEM_PROMPT_JA).toContain('Japanese');
        });

        test('defines DEFAULT_SYSTEM_PROMPT_EN', () => {
            expect(DEFAULT_SYSTEM_PROMPT_EN).toContain('English');
        });

        test('aliases DEFAULT_USER_PROMPT to JA', () => {
            expect(DEFAULT_USER_PROMPT).toBe(DEFAULT_USER_PROMPT_JA);
        });

        test('aliases DEFAULT_SYSTEM_PROMPT to JA', () => {
            expect(DEFAULT_SYSTEM_PROMPT).toBe(DEFAULT_SYSTEM_PROMPT_JA);
        });

        test('defines 5 PRESET_PROMPTS', () => {
            expect(PRESET_PROMPTS).toHaveLength(5);
            expect(PRESET_PROMPTS.map(p => p.id)).toEqual(['default', 'tagged', 'bullet', 'english', 'technical']);
        });

        test('includes required fields in each preset', () => {
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
        test('returns the Japanese prompt for the ja locale', () => {
            expect(getDefaultUserPrompt('ja')).toBe(DEFAULT_USER_PROMPT_JA);
        });

        test('returns the English prompt for the en locale', () => {
            expect(getDefaultUserPrompt('en')).toBe(DEFAULT_USER_PROMPT_EN);
        });

        test('uses the browser UI language (Japanese) when locale is omitted', () => {
            Object.defineProperty(global, 'navigator', {
                value: { language: 'ja-JP' },
                configurable: true,
                writable: true
            });
            expect(getDefaultUserPrompt()).toBe(DEFAULT_USER_PROMPT_JA);
        });

        test('uses the browser UI language (English) when locale is omitted', () => {
            Object.defineProperty(global, 'navigator', {
                value: { language: 'en-US' },
                configurable: true,
                writable: true
            });
            expect(getDefaultUserPrompt()).toBe(DEFAULT_USER_PROMPT_EN);
        });
    });

    describe('getDefaultSystemPrompt', () => {
        test('returns the Japanese system prompt for the ja locale', () => {
            expect(getDefaultSystemPrompt('ja')).toBe(DEFAULT_SYSTEM_PROMPT_JA);
        });

        test('returns the English system prompt for the en locale', () => {
            expect(getDefaultSystemPrompt('en')).toBe(DEFAULT_SYSTEM_PROMPT_EN);
        });

        test('uses the browser UI language (Japanese) when locale is omitted', () => {
            Object.defineProperty(global, 'navigator', {
                value: { language: 'ja-JP' },
                configurable: true,
                writable: true
            });
            expect(getDefaultSystemPrompt()).toBe(DEFAULT_SYSTEM_PROMPT_JA);
        });

        test('uses the browser UI language (English) when locale is omitted', () => {
            Object.defineProperty(global, 'navigator', {
                value: { language: 'en-US' },
                configurable: true,
                writable: true
            });
            expect(getDefaultSystemPrompt()).toBe(DEFAULT_SYSTEM_PROMPT_EN);
        });
    });

    describe('getBrowserLocale', () => {
        test('returns ja for a Japanese locale', () => {
            Object.defineProperty(global, 'navigator', {
                value: { language: 'ja-JP' },
                configurable: true,
                writable: true
            });
            expect(getBrowserLocale()).toBe('ja');
        });

        test('returns en for an English locale', () => {
            Object.defineProperty(global, 'navigator', {
                value: { language: 'en-US' },
                configurable: true,
                writable: true
            });
            expect(getBrowserLocale()).toBe('en');
        });

        test('returns a ja or en string', () => {
            const locale = getBrowserLocale();
            expect(['ja', 'en']).toContain(locale);
        });
    });

    describe('getPresetPrompt', () => {
        test('returns the preset for a valid ID', () => {
            const preset = getPresetPrompt('default');
            expect(preset).toBeDefined();
            expect(preset?.id).toBe('default');
        });

        test('returns undefined for an invalid ID', () => {
            expect(getPresetPrompt('nonexistent')).toBeUndefined();
        });

        test('retrieves all presets', () => {
            for (const p of PRESET_PROMPTS) {
                expect(getPresetPrompt(p.id)).toEqual(p);
            }
        });
    });

    describe('getPromptDisplayName', () => {
        const preset = PRESET_PROMPTS[0]!;

        test('returns the Japanese name for the ja locale', () => {
            expect(getPromptDisplayName(preset, 'ja')).toBe(preset.nameJa);
        });

        test('returns the English name for the en locale', () => {
            expect(getPromptDisplayName(preset, 'en')).toBe(preset.name);
        });
    });

    describe('buildTaggedSummaryPrompt', () => {
        test('generates a prompt containing categories and content', () => {
            const settings = {};
            const result = buildTaggedSummaryPrompt(settings, 'test content');

            expect(result).toContain('test content');
            expect(result).toContain('IT');
            expect(result).toContain('Science');
            expect(result).toContain('Business');
        });

        test('excludes hardcoded category placeholder literals from the prompt', () => {
            // instruction leakage 対策: LLMがこの文字列をオウム返しするのを防ぐ
            const result = buildTaggedSummaryPrompt({}, 'content');
            expect(result).not.toContain('#カテゴリ1');
            expect(result).not.toContain('#カテゴリ2');
        });

        test('excludes the hardcoded summary-line literal from the prompt', () => {
            // instruction leakage 対策
            const result = buildTaggedSummaryPrompt({}, 'content');
            expect(result).not.toContain('要約文（改行なし）');
        });

        test('states that the output format instruction is a single line', () => {
            const result = buildTaggedSummaryPrompt({}, 'content');
            // 1行出力の指示が含まれる
            expect(result.toLowerCase()).toMatch(/one line|1行|1 line/i);
        });
    });

    describe('replaceContentPlaceholder', () => {
        test('replaces {{content}}', () => {
            const result = replaceContentPlaceholder('Hello {{content}}', 'World');
            expect(result).toBe('Hello World');
        });

        test('matches placeholders case-insensitively', () => {
            const result = replaceContentPlaceholder('Hello {{CONTENT}}', 'World');
            expect(result).toBe('Hello World');
        });

        test('returns the template unchanged when it has no placeholders', () => {
            const result = replaceContentPlaceholder('No placeholder', 'World');
            expect(result).toBe('No placeholder');
        });

        test('replaces multiple placeholders', () => {
            const result = replaceContentPlaceholder('{{content}} and {{content}}', 'X');
            expect(result).toBe('X and X');
        });
    });

    describe('validatePrompt', () => {
        test('returns valid: true for a valid prompt', () => {
            const result = validatePrompt('Summarize: {{content}}');
            expect(result.valid).toBe(true);
        });

        test('returns valid: false for an empty string', () => {
            const result = validatePrompt('');
            expect(result.valid).toBe(false);
            expect(result.error).toBe('Prompt is required');
        });

        test('returns valid: false when exceeding 5000 characters', () => {
            const longPrompt = 'a'.repeat(5001);
            const result = validatePrompt(longPrompt);
            expect(result.valid).toBe(false);
            expect(result.error).toContain('too long');
        });

        test('returns valid: true at exactly 5000 characters', () => {
            const prompt = 'a'.repeat(5000);
            const result = validatePrompt(prompt);
            expect(result.valid).toBe(true);
        });

        test('logs a warning and returns valid: true when LOW severity is detected', () => {
            const mocked = vi.mocked(sanitizePromptContent);
            mocked.mockReturnValueOnce({
                sanitized: '',
                dangerLevel: 'low',
                warnings: ['Detected potential command: "system"'],
            });

            const result = validatePrompt('Summarize: {{content}}');
            expect(result.valid).toBe(true);
            expect(addLog).toHaveBeenCalledWith(
                'warn',
                'Low-risk prompt injection detected in custom prompt',
                expect.objectContaining({
                    dangerLevel: 'low',
                    category: 'generic_term',
                })
            );
        });
    });

    describe('getActivePrompt', () => {
        test('returns the provider-specific prompt', () => {
            const settings = {
                custom_prompts: [
                    { id: '1', name: 'Test', prompt: 'test', isActive: true, provider: 'gemini', createdAt: 0, updatedAt: 0 }
                ]
            };
            const result = getActivePrompt(asSettings(settings), 'gemini');
            expect(result).not.toBeNull();
            expect(result?.id).toBe('1');
        });

        test('returns the prompt for the all provider', () => {
            const settings = {
                custom_prompts: [
                    { id: '1', name: 'Test', prompt: 'test', isActive: true, provider: 'all', createdAt: 0, updatedAt: 0 }
                ]
            };
            const result = getActivePrompt(asSettings(settings), 'gemini');
            expect(result).not.toBeNull();
            expect(result?.id).toBe('1');
        });

        test('returns null when the prompt is empty', () => {
            const settings = { custom_prompts: [] };
            expect(getActivePrompt(asSettings(settings), 'gemini')).toBeNull();
        });

        test('returns null when no custom prompt exists', () => {
            const settings = {};
            expect(getActivePrompt(asSettings(settings), 'gemini')).toBeNull();
        });

        test('does not return prompts with isActive=false', () => {
            const settings = {
                custom_prompts: [
                    { id: '1', name: 'Test', prompt: 'test', isActive: false, provider: 'gemini', createdAt: 0, updatedAt: 0 }
                ]
            };
            expect(getActivePrompt(asSettings(settings), 'gemini')).toBeNull();
        });

        test('prefers the provider-specific prompt', () => {
            const settings = {
                custom_prompts: [
                    { id: '1', name: 'All', prompt: 'all', isActive: true, provider: 'all', createdAt: 0, updatedAt: 0 },
                    { id: '2', name: 'Gemini', prompt: 'gemini', isActive: true, provider: 'gemini', createdAt: 0, updatedAt: 0 }
                ]
            };
            const result = getActivePrompt(asSettings(settings), 'gemini');
            expect(result?.id).toBe('2');
        });
    });

    describe('applyCustomPrompt', () => {
        test('uses the custom prompt when one is active', () => {
            const settings = {
                custom_prompts: [
                    { id: '1', name: 'Custom', prompt: 'Custom: {{content}}', isActive: true, provider: 'gemini', createdAt: 0, updatedAt: 0 }
                ]
            };
            const result = applyCustomPrompt(asSettings(settings), 'gemini', 'test content');

            expect(result.isCustom).toBe(true);
            expect(result.userPrompt).toBe('Custom: test content');
        });

        test('uses the default when no custom prompt exists', () => {
            const settings = {};
            const result = applyCustomPrompt(asSettings(settings), 'gemini', 'test content');

            expect(result.isCustom).toBe(false);
            expect(result.userPrompt).toContain('test content');
        });

        test('generates a prompt in tagged-summary mode', () => {
            const settings = {};
            const result = applyCustomPrompt(asSettings(settings), 'gemini', 'test content', true);

            expect(result.isCustom).toBe(false);
            expect(result.userPrompt).toContain('test content');
            expect(result.userPrompt).toContain('カテゴリ');
        });

        test('uses the custom system prompt', () => {
            const settings = {
                custom_prompts: [
                    { id: '1', name: 'Custom', prompt: '{{content}}', systemPrompt: 'Custom system', isActive: true, provider: 'gemini', createdAt: 0, updatedAt: 0 }
                ]
            };
            const result = applyCustomPrompt(asSettings(settings), 'gemini', 'test');

            expect(result.systemPrompt).toBe('Custom system');
        });

        test('uses the default when no system prompt exists', () => {
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
            const result = applyCustomPrompt(asSettings(settings), 'gemini', 'test');

            expect(result.systemPrompt).toBe(DEFAULT_SYSTEM_PROMPT_JA);
        });

        test('uses the default English prompt for the en locale', () => {
            const settings = {};
            const result = applyCustomPrompt(asSettings(settings), 'gemini', 'test', false, 'en');

            expect(result.userPrompt).toContain('test');
            expect(result.systemPrompt).toBe(DEFAULT_SYSTEM_PROMPT_EN);
        });
    });

    describe('generatePromptId', () => {
        test('has the prompt_ prefix', () => {
            const id = generatePromptId();
            expect(id).toMatch(/^prompt_\d+_[a-z0-9]+$/);
        });

        test('generates a different ID each time', () => {
            const id1 = generatePromptId();
            const id2 = generatePromptId();
            expect(id1).not.toBe(id2);
        });
    });

    describe('createPrompt', () => {
        test('sets createdAt and updatedAt', () => {
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
        test('updates the prompt with the given ID', () => {
            const prompts = [
                { id: '1', name: 'A', prompt: 'a', isActive: false, provider: 'all', createdAt: 0, updatedAt: 0 },
                { id: '2', name: 'B', prompt: 'b', isActive: false, provider: 'all', createdAt: 0, updatedAt: 0 }
            ];
            const result = updatePrompt(asPrompts(prompts),'1', { name: 'Updated' });

            expect(result[0]!.name).toBe('Updated');
            expect(result[1]!.name).toBe('B');
        });

        test('updates updatedAt', () => {
            const prompts = [
                { id: '1', name: 'A', prompt: 'a', isActive: false, provider: 'all', createdAt: 0, updatedAt: 0 }
            ];
            const result = updatePrompt(asPrompts(prompts),'1', { name: 'Updated' });

            expect(result[0]!.updatedAt).toBeGreaterThan(0);
        });

        test('leaves state unchanged for a nonexistent ID', () => {
            const prompts = [
                { id: '1', name: 'A', prompt: 'a', isActive: false, provider: 'all', createdAt: 0, updatedAt: 0 }
            ];
            const result = updatePrompt(asPrompts(prompts),'nonexistent', { name: 'Updated' });

            expect(result[0]!.name).toBe('A');
        });
    });

    describe('deletePrompt', () => {
        test('deletes the prompt with the given ID', () => {
            const prompts = [
                { id: '1', name: 'A', prompt: 'a', isActive: false, provider: 'all', createdAt: 0, updatedAt: 0 },
                { id: '2', name: 'B', prompt: 'b', isActive: false, provider: 'all', createdAt: 0, updatedAt: 0 }
            ];
            const result = deletePrompt(asPrompts(prompts),'1');

            expect(result).toHaveLength(1);
            expect(result[0]!.id).toBe('2');
        });

        test('returns the list unchanged for a nonexistent ID', () => {
            const prompts = [
                { id: '1', name: 'A', prompt: 'a', isActive: false, provider: 'all', createdAt: 0, updatedAt: 0 }
            ];
            const result = deletePrompt(asPrompts(prompts),'nonexistent');

            expect(result).toHaveLength(1);
        });
    });

    describe('setActivePrompt', () => {
        test('activates the specified prompt', () => {
            const prompts = [
                { id: '1', name: 'A', prompt: 'a', isActive: false, provider: 'gemini', createdAt: 0, updatedAt: 0 }
            ];
            const result = setActivePrompt(asPrompts(prompts),'1', 'gemini');

            expect(result[0]!.isActive).toBe(true);
        });

        test('deactivates other prompts in the same scope', () => {
            const prompts = [
                { id: '1', name: 'A', prompt: 'a', isActive: true, provider: 'gemini', createdAt: 0, updatedAt: 0 },
                { id: '2', name: 'B', prompt: 'b', isActive: false, provider: 'gemini', createdAt: 0, updatedAt: 0 }
            ];
            const result = setActivePrompt(asPrompts(prompts),'2', 'gemini');

            expect(result[0]!.isActive).toBe(false);
            expect(result[1]!.isActive).toBe(true);
        });

        test('leaves state unchanged for a nonexistent ID', () => {
            const prompts = [
                { id: '1', name: 'A', prompt: 'a', isActive: false, provider: 'gemini', createdAt: 0, updatedAt: 0 }
            ];
            const result = setActivePrompt(asPrompts(prompts),'nonexistent', 'gemini');

            expect(result[0]!.isActive).toBe(false);
        });

        test('manages other provider prompts with an all-scope prompt', () => {
            const prompts = [
                { id: '1', name: 'All', prompt: 'a', isActive: true, provider: 'all', createdAt: 0, updatedAt: 0 },
                { id: '2', name: 'Gemini', prompt: 'b', isActive: true, provider: 'gemini', createdAt: 0, updatedAt: 0 }
            ];
            const result = setActivePrompt(asPrompts(prompts),'1', 'all');

            expect(result[0]!.isActive).toBe(true);
            expect(result[1]!.isActive).toBe(false);
        });
    });
});
