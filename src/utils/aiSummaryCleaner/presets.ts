/**
 * presets.ts — クレンジングプリセット定義
 *
 * 32トグルの view として機能。保存形式は既存 32キーそのままで、
 * プリセットは UI から 32値を一括で埋めるショートカット。
 *
 * E2E 手動検証手順（Playwright）:
 *   1. npm run build && Chrome で dist/chromium-mv3 を Load unpacked
 *   2. Dashboard → AI Summary Cleansing で preset "Aggressive" を選択
 *   3. chrome.storage.local.get で 32キーが 25 ON になったことを確認
 *   4. リロード → preset select が "aggressive" のまま、checkbox も維持されていることを確認
 *   5. いずれかの checkbox を手動で toggle → preset が "custom" に切り替わることを確認
 *   6. preset "Minimal" を選択 → 3 ON のみに変わることを確認
 */

import type { AiSummaryCleanseOptions, RuleKey } from './types.js';
import { CLEANSING_RULE_KEYS } from './rules.js';

export type PresetId = 'minimal' | 'balanced' | 'aggressive' | 'custom';

/**
 * CleansingConfig は AiSummaryCleanseOptions のルールフラグ部分。
 * 32キーの Enabled フラグで構成される。
 */
export type CleansingConfig = AiSummaryCleanseOptions;

/**
 * 各プリセットのフラグマップ。
 * - minimal: 3 ON (ads, alt, nav)
 * - balanced: 9 ON (minimal + metadata, social, recommend, popup, cookie, newsMedia)
 * - aggressive: 25 ON (ほぼ全 ON、8つだけ OFF)
 * - custom: 空（個別調整）
 *
 * 値は CLEANSING_RULE_KEYS 上の allow / deny リストから派生する。
 * 新ルールは deny に載らない限り aggressive で ON、載せない限り
 * minimal / balanced で OFF になるため、ルール追加時の追従が不要。
 * 出力オブジェクトは従来の手書き列挙と byte 等価（golden pin で保護）。
 */
type PresetFlags = Partial<CleansingConfig> & Record<string, boolean | undefined>;

/** minimal / balanced: ON にする鍵だけ列挙し、残りは OFF になる。 */
const MINIMAL_ON: readonly RuleKey[] = ['alt', 'ads', 'nav'];
const BALANCED_ON: readonly RuleKey[] = [
    ...MINIMAL_ON,
    'metadata',
    'social',
    'recommend',
    'popup',
    'cookie',
    'newsMedia',
];

/** aggressive: OFF にする鍵だけ列挙し、残りは ON になる。 */
const AGGRESSIVE_OFF: readonly RuleKey[] = [
    'jsonLd',
    'lazyLoad',
    'skipLink',
    'card',
    'fixed',
    'pagination',
    'platform',
    'author',
];

function buildPreset(on: ReadonlySet<RuleKey>): PresetFlags {
    return Object.fromEntries(
        CLEANSING_RULE_KEYS.map((key) => [`${key}Enabled`, on.has(key)]),
    ) as PresetFlags;
}

export const PRESETS: Record<PresetId, Partial<CleansingConfig>> = {
    minimal: buildPreset(new Set(MINIMAL_ON)),
    balanced: buildPreset(new Set(BALANCED_ON)),
    aggressive: buildPreset(
        new Set(CLEANSING_RULE_KEYS.filter((key) => !AGGRESSIVE_OFF.includes(key))),
    ),
    custom: {},
};

/**
 * プリセットの ON 数を数える（テスト用）
 */
export function countPresetEnabled(presetId: PresetId): number {
    const preset = PRESETS[presetId];
    return Object.values(preset).filter(v => v === true).length;
}

/**
 * config が preset と完全一致するか判定。
 * 走査対象は CLEANSING_RULES の鍵集合であり、preset エントリの列挙に
 * 依存しない。新ルール追加時に判定から漏れることが構造的にない。
 */
export function isPresetMatch(config: Partial<CleansingConfig>, presetId: PresetId): boolean {
    const preset = PRESETS[presetId] as Record<string, unknown>;
    if (presetId === 'custom') return Object.keys(preset).length === 0;
    for (const key of CLEANSING_RULE_KEYS) {
        const flag = `${key}Enabled`;
        if ((config as Record<string, unknown>)[flag] !== preset[flag]) return false;
    }
    return true;
}
