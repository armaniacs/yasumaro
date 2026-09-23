/**
 * cleanseModeLadder.ts — one-shot cleanseMode → CleansingConfig resolver
 * for REGENERATE_SUMMARY (PBI 2026-09-22-04).
 *
 * Pure function: never persists anything (the ladder applies to a single
 * regeneration only — binding: storage への永続化は一切しない).
 *
 * Ladder (Ask 2026-09-22):
 * - 'current': global settings as-is (caller treats this as "no override").
 * - 'looser': ③ AI summary cleansing rules step one preset down
 *   (aggressive → balanced → minimal; balanced/custom/minimal → minimal floor).
 *   ② Content Cleansing flags are NOT touched by this level.
 * - 'loosest': ② Content Cleansing + ③ AI summary cleansing both disabled.
 *   Whitelist/dedup/overcut-guard flags stay untouched — guards keep firing
 *   during a loosened regeneration (binding: 緩和中もガード発火（統一）).
 *
 * ① candidate-selection has no loosening knob in v1 (binding): it is covered
 * by the PBI 05 guards at extraction time instead.
 */

import type { CleansingConfig } from '../cleansingConfig.js';
import { PRESETS, isPresetMatch, type PresetId } from './presets.js';

export type RegenerateCleanseMode = 'current' | 'looser' | 'loosest';

export const REGENERATE_CLEANSE_MODES: readonly RegenerateCleanseMode[] = [
    'current',
    'looser',
    'loosest',
];

/** Current preset of the ③ rule set, or 'custom' when it matches none. */
function currentPreset(config: CleansingConfig): PresetId {
    for (const id of ['aggressive', 'balanced', 'minimal'] as const) {
        if (isPresetMatch(config, id)) return id;
    }
    return 'custom';
}

/** One step milder than the current preset, floored at minimal. */
function stepDownPreset(preset: PresetId): PresetId {
    if (preset === 'aggressive') return 'balanced';
    return 'minimal';
}

export function resolveRegenerateCleansingConfig(
    config: CleansingConfig,
    mode: RegenerateCleanseMode,
): CleansingConfig {
    if (mode === 'current') {
        return config;
    }

    if (mode === 'loosest') {
        return {
            ...config,
            contentStripHardEnabled: false,
            contentStripKeywordEnabled: false,
            aiSummaryCleansingEnabled: false,
        };
    }

    // 'looser' — ③ preset step-down only (custom → minimal).
    const next = stepDownPreset(currentPreset(config));
    return { ...config, ...PRESETS[next] };
}
