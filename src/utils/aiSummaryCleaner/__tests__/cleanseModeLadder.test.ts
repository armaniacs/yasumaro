import { describe, it, expect } from 'vitest';
import {
  resolveRegenerateCleansingConfig,
  REGENERATE_CLEANSE_MODES,
} from '../cleanseModeLadder.js';
import { PRESETS, isPresetMatch } from '../presets.js';
import { createDefaultCleansingConfig } from '../../cleansingConfig.js';
import type { CleansingConfig } from '../../cleansingConfig.js';

/** Real default config with a preset applied — the shape callers hold. */
function configAs(preset: 'minimal' | 'balanced' | 'aggressive'): CleansingConfig {
  return { ...createDefaultCleansingConfig(), ...PRESETS[preset] } as CleansingConfig;
}

/**
 * Deterministic 'custom': start from balanced, then flip a MINIMAL-owned flag
 * so no preset (minimal/balanced/aggressive) can match, regardless of what
 * the global defaults contain.
 */
function customConfig(): CleansingConfig {
  const minimalOwnedFlag = Object.keys(PRESETS.minimal)[0]!;
  return {
    ...createDefaultCleansingConfig(),
    ...PRESETS.balanced,
    [minimalOwnedFlag]: !PRESETS.minimal[minimalOwnedFlag as keyof typeof PRESETS.minimal],
  } as CleansingConfig;
}

/** One rule flag ON in aggressive but OFF in balanced (computed, not hardcoded). */
function aggressiveOnlyFlag(): string {
  const agg = PRESETS.aggressive as Record<string, unknown>;
  const bal = PRESETS.balanced as Record<string, unknown>;
  const key = Object.keys(agg).find((k) => agg[k] === true && bal[k] === false);
  if (!key) throw new Error('no aggressive-only flag found');
  return key;
}

describe('REGENERATE_CLEANSE_MODES', () => {
  it('exposes exactly current/looser/loosest', () => {
    expect([...REGENERATE_CLEANSE_MODES]).toEqual(['current', 'looser', 'loosest']);
  });
});

describe("resolveRegenerateCleansingConfig — 'current'", () => {
  it('returns the identical reference (no override, no clone)', () => {
    const base = configAs('aggressive');
    expect(resolveRegenerateCleansingConfig(base, 'current')).toBe(base);
  });
});

describe("resolveRegenerateCleansingConfig — 'looser' (CRITICAL: ladder + floor)", () => {
  it('steps aggressive one preset down to balanced', () => {
    const resolved = resolveRegenerateCleansingConfig(configAs('aggressive'), 'looser');
    expect(isPresetMatch(resolved, 'balanced')).toBe(true);
    expect(isPresetMatch(resolved, 'aggressive')).toBe(false);
  });

  it('steps balanced down to minimal', () => {
    const resolved = resolveRegenerateCleansingConfig(configAs('balanced'), 'looser');
    expect(isPresetMatch(resolved, 'minimal')).toBe(true);
  });

  it('floors minimal at minimal (no-op on the rule flags)', () => {
    const resolved = resolveRegenerateCleansingConfig(configAs('minimal'), 'looser');
    expect(isPresetMatch(resolved, 'minimal')).toBe(true);
  });

  it('floors custom at minimal', () => {
    const base = customConfig();
    expect(isPresetMatch(base, 'minimal')).toBe(false);
    expect(isPresetMatch(base, 'balanced')).toBe(false);
    expect(isPresetMatch(base, 'aggressive')).toBe(false);
    const resolved = resolveRegenerateCleansingConfig(base, 'looser');
    expect(isPresetMatch(resolved, 'minimal')).toBe(true);
  });

  it('does NOT touch Content Cleansing flags at this level', () => {
    const base = configAs('aggressive');
    const resolved = resolveRegenerateCleansingConfig(base, 'looser');
    expect(resolved.contentStripHardEnabled).toBe(base.contentStripHardEnabled);
    expect(resolved.contentStripKeywordEnabled).toBe(base.contentStripKeywordEnabled);
    expect(resolved.aiSummaryCleansingEnabled).toBe(base.aiSummaryCleansingEnabled);
  });

  it('never mutates the input config (one-shot, no persistence)', () => {
    const base = configAs('aggressive');
    const flag = aggressiveOnlyFlag();
    const before = (base as Record<string, unknown>)[flag];
    resolveRegenerateCleansingConfig(base, 'looser');
    expect((base as Record<string, unknown>)[flag]).toBe(before);
  });
});

describe("resolveRegenerateCleansingConfig — 'loosest' (CRITICAL: ②③ off, guards on)", () => {
  it('disables Content Cleansing + AI summary cleansing together', () => {
    const resolved = resolveRegenerateCleansingConfig(configAs('aggressive'), 'loosest');
    expect(resolved.contentStripHardEnabled).toBe(false);
    expect(resolved.contentStripKeywordEnabled).toBe(false);
    expect(resolved.aiSummaryCleansingEnabled).toBe(false);
  });

  it('leaves whitelist/dedup/guard flags untouched (guards keep firing — binding)', () => {
    const base = configAs('aggressive');
    const resolved = resolveRegenerateCleansingConfig(base, 'loosest');
    expect(resolved.whitelistExtractionEnabled).toBe(base.whitelistExtractionEnabled);
    expect(resolved.contentDedupEnabled).toBe(base.contentDedupEnabled);
    expect(resolved.candidateGuardEnabled).toBe(base.candidateGuardEnabled);
    expect(resolved.cleanseGuardEnabled).toBe(base.cleanseGuardEnabled);
    expect(resolved.aiSummaryCleansingFallbackMinChars).toBe(base.aiSummaryCleansingFallbackMinChars);
  });

  it('never mutates the input config', () => {
    const base = configAs('aggressive');
    resolveRegenerateCleansingConfig(base, 'loosest');
    expect(base.contentStripHardEnabled).toBe(true);
    expect(base.aiSummaryCleansingEnabled).toBe(true);
  });
});
