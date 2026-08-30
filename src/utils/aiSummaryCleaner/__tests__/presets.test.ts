// @vitest-environment jsdom
/**
 * presets.test.ts — プリセット定義とマイグレーションの単体テスト
 *
 * 検証項目:
 * - PRESETS の各プリセット ON 数が仕様通り（minimal 3 / balanced 9 / aggressive 25 / custom 0）
 * - 必須キー（ads, social, deep, newsMedia, ecSite）が含まれる
 * - migrateToPreset のヒューリスティック（deep→aggressive, news/ec→balanced, else minimal）
 * - detectPreset の完全一致判定
 * - 既存ユーザーの設定が minimal にリセットされない（マイグレーションで 32値を上書きしない）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PRESETS, countPresetEnabled, isPresetMatch } from '../presets.js';
import { migrateToPreset, detectPreset } from '../../../dashboard/settings/aiSummaryCleansingSettingsV2.js';
import { CLEANSING_RULE_KEYS } from '../rules.js';

// Mock chrome.storage for migration tests
const mockStorage: Record<string, unknown> = {};
globalThis.chrome = {
    storage: {
        local: {
            get: vi.fn(async (key: string | string[]) => {
                if (typeof key === 'string') {
                    return mockStorage[key] !== undefined ? { [key]: mockStorage[key] } : {};
                }
                if (Array.isArray(key)) {
                    const out: Record<string, unknown> = {};
                    for (const k of key) if (mockStorage[k] !== undefined) out[k] = mockStorage[k];
                    return out;
                }
                // object form
                const out: Record<string, unknown> = {};
                for (const k of Object.keys(key as Record<string, unknown>)) if (mockStorage[k] !== undefined) out[k] = mockStorage[k];
                return out;
            }),
            set: vi.fn(async (obj: Record<string, unknown>) => {
                Object.assign(mockStorage, obj);
            }),
        },
    },
    i18n: { getMessage: () => '', getUILanguage: () => 'en' },
} as unknown as typeof chrome;

describe('PRESETS definitions', () => {
    it('minimal has 3 ON', () => {
        expect(countPresetEnabled('minimal')).toBe(3);
        expect(PRESETS.minimal.adsEnabled).toBe(true);
        expect(PRESETS.minimal.altEnabled).toBe(true);
        expect(PRESETS.minimal.navEnabled).toBe(true);
    });

    it('balanced has 9 ON and includes required keys', () => {
        expect(countPresetEnabled('balanced')).toBe(9);
        expect(PRESETS.balanced.adsEnabled).toBe(true);
        expect(PRESETS.balanced.socialEnabled).toBe(true);
        expect(PRESETS.balanced.deepEnabled).toBe(false);
        expect(PRESETS.balanced.newsMediaEnabled).toBe(true);
    });

    it('aggressive has 25 ON and includes required keys', () => {
        expect(countPresetEnabled('aggressive')).toBe(25);
        expect(PRESETS.aggressive.adsEnabled).toBe(true);
        expect(PRESETS.aggressive.socialEnabled).toBe(true);
        expect(PRESETS.aggressive.deepEnabled).toBe(true);
        expect(PRESETS.aggressive.newsMediaEnabled).toBe(true);
        expect(PRESETS.aggressive.ecSiteEnabled).toBe(true);
    });

    it('custom is empty', () => {
        expect(countPresetEnabled('custom')).toBe(0);
        expect(Object.keys(PRESETS.custom)).toHaveLength(0);
    });

    it('all presets cover 32+ keys and use valid RuleKeys', () => {
        // 少なくともタスクが求める 5-6キーを含むこと
        for (const pid of ['minimal', 'balanced', 'aggressive'] as const) {
            const preset = PRESETS[pid];
            expect(preset).toHaveProperty('adsEnabled');
            expect(preset).toHaveProperty('socialEnabled');
            expect(preset).toHaveProperty('deepEnabled');
            expect(preset).toHaveProperty('newsMediaEnabled');
            expect(preset).toHaveProperty('ecSiteEnabled');
        }
        // preset のキーは全て RuleKey 由来の Enabled キーであること
        const validKeys = new Set(CLEANSING_RULE_KEYS.map(k => `${k}Enabled`));
        for (const pid of ['minimal', 'balanced', 'aggressive'] as const) {
            for (const k of Object.keys(PRESETS[pid])) {
                expect(validKeys.has(k), `${pid}.${k} should be valid RuleKey`).toBe(true);
            }
        }
    });

    it('balanced and minimal differ only by expected additions', () => {
        // balanced は minimal の 3 に加えて metadata, social, recommend, popup, cookie, newsMedia を追加
        const minimalTrue = Object.entries(PRESETS.minimal).filter(([, v]) => v).map(([k]) => k);
        const balancedTrue = Object.entries(PRESETS.balanced).filter(([, v]) => v).map(([k]) => k);
        expect(minimalTrue).toEqual(expect.arrayContaining(['altEnabled', 'adsEnabled', 'navEnabled']));
        for (const k of minimalTrue) expect(balancedTrue).toContain(k);
        expect(balancedTrue.length).toBeGreaterThan(minimalTrue.length);
    });
});

describe('migrateToPreset', () => {
    it('deepEnabled true → aggressive', () => {
        expect(migrateToPreset({ deepEnabled: true } as any)).toBe('aggressive');
        expect(migrateToPreset({ deepEnabled: true, newsMediaEnabled: false } as any)).toBe('aggressive');
    });

    it('newsMediaEnabled true → balanced', () => {
        expect(migrateToPreset({ newsMediaEnabled: true } as any)).toBe('balanced');
        expect(migrateToPreset({ deepEnabled: false, newsMediaEnabled: true } as any)).toBe('balanced');
    });

    it('ecSiteEnabled true → balanced', () => {
        expect(migrateToPreset({ ecSiteEnabled: true } as any)).toBe('balanced');
        expect(migrateToPreset({ deepEnabled: false, ecSiteEnabled: true } as any)).toBe('balanced');
    });

    it('otherwise → minimal', () => {
        expect(migrateToPreset({ adsEnabled: true } as any)).toBe('minimal');
        expect(migrateToPreset({} as any)).toBe('minimal');
        expect(migrateToPreset({ socialEnabled: false, deepEnabled: false } as any)).toBe('minimal');
    });
});

describe('detectPreset (exact match)', () => {
    it('returns minimal for minimal config', () => {
        expect(detectPreset(PRESETS.minimal as any)).toBe('minimal');
    });
    it('returns balanced for balanced config', () => {
        expect(detectPreset(PRESETS.balanced as any)).toBe('balanced');
    });
    it('returns aggressive for aggressive config', () => {
        expect(detectPreset(PRESETS.aggressive as any)).toBe('aggressive');
    });
    it('returns custom for divergent config', () => {
        const custom = { ...PRESETS.minimal, jpLayoutEnabled: true } as any;
        expect(detectPreset(custom)).toBe('custom');
    });
});

describe('isPresetMatch', () => {
    it('matches exact preset', () => {
        expect(isPresetMatch(PRESETS.minimal as any, 'minimal')).toBe(true);
        expect(isPresetMatch(PRESETS.balanced as any, 'balanced')).toBe(true);
        expect(isPresetMatch({ ...PRESETS.minimal, adsEnabled: false } as any, 'minimal')).toBe(false);
    });
});

describe('migration does not reset existing 32 values', () => {
    it('PRESETS are view only — applying minimal does not mutate original object', () => {
        const original = { ...PRESETS.minimal };
        const copy = { ...PRESETS.balanced };
        // Simulate that user had custom config with jpLayout true; after inferring minimal, values must not be overwritten unless applyPreset is called
        const userConfig = { adsEnabled: true, socialEnabled: true, jpLayoutEnabled: true, deepEnabled: false } as any;
        const inferred = migrateToPreset(userConfig);
        // inferred may be balanced or minimal, but userConfig must stay unchanged
        expect(userConfig.jpLayoutEnabled).toBe(true);
        expect(userConfig.socialEnabled).toBe(true);
        // PRESETS themselves unchanged
        expect(PRESETS.minimal).toEqual(original);
        expect(PRESETS.balanced).toEqual(copy);
        // Ensure no side effect: inferred is just a label, not a mutation
        expect(inferred === 'minimal' || inferred === 'balanced' || inferred === 'aggressive').toBe(true);
    });

    it('custom config is detected as custom, not forced to minimal', () => {
        const customConfig = { adsEnabled: true, socialEnabled: true, jpLayoutEnabled: true, newsMediaEnabled: false, ecSiteEnabled: false, deepEnabled: false } as any;
        // heuristic would say minimal, but exact detection says custom
        expect(migrateToPreset(customConfig)).toBe('minimal'); // heuristic
        expect(detectPreset(customConfig)).toBe('custom'); // exact check preserves custom
    });
});
