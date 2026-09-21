// @vitest-environment jsdom
/**
 * cleansingKeyDerivation.test.ts — PBI 2026-09-21-05
 *
 * Part A (golden pin): byte-exact current PRESETS values for
 * minimal / balanced / aggressive, plus the CURRENT restorable behavior
 * where news_media / ec_site / qa_site / video_site are MISSING
 * (recorded here as the bug this PBI fixes).
 *
 * Part B (comprehensiveness): derived key sets must equal the
 * CLEANSING_RULES key set in both directions, for presets AND restorable,
 * plus a backup-restore roundtrip covering the 4 previously-dropped keys.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../storage/../logger/types.js', () => ({
  LogType: { DEBUG: 'DEBUG', WARN: 'WARN', INFO: 'INFO', ERROR: 'ERROR' },
}));
vi.mock('../../../storage/../logger/core.js', () => ({
  addLog: vi.fn(),
}));
vi.mock('../../logger/types.js', () => ({
  LogType: { DEBUG: 'DEBUG', WARN: 'WARN', INFO: 'INFO', ERROR: 'ERROR' },
}));
vi.mock('../../logger/core.js', () => ({
  addLog: vi.fn(),
}));

import { PRESETS } from '../presets.js';
import { CLEANSING_RULES, CLEANSING_RULE_KEYS } from '../rules.js';
import { validateRestorableSettings } from '../../storage/restorableSettings.js';

// ============================================================================
// Part A: golden pin of CURRENT preset values (must stay byte-equal)
// ============================================================================

const GOLDEN_MINIMAL = {
  altEnabled: true,
  metadataEnabled: false,
  adsEnabled: true,
  navEnabled: true,
  socialEnabled: false,
  deepEnabled: false,
  jsonLdEnabled: false,
  lazyLoadEnabled: false,
  skipLinkEnabled: false,
  cardEnabled: false,
  linkDensityEnabled: false,
  fixedEnabled: false,
  recommendEnabled: false,
  paginationEnabled: false,
  snsPromoEnabled: false,
  popupEnabled: false,
  cookieEnabled: false,
  platformEnabled: false,
  textDensityEnabled: false,
  shortSeqEnabled: false,
  symbolLineEnabled: false,
  linkParaEnabled: false,
  enhancedHiddenEnabled: false,
  emptyElemEnabled: false,
  jpLayoutEnabled: false,
  jpNavigationEnabled: false,
  authorEnabled: false,
  affiliateEnabled: false,
  speechBubbleEnabled: false,
  newsMediaEnabled: false,
  ecSiteEnabled: false,
  qaSiteEnabled: false,
  videoSiteEnabled: false,
};

const GOLDEN_BALANCED = {
  altEnabled: true,
  metadataEnabled: true,
  adsEnabled: true,
  navEnabled: true,
  socialEnabled: true,
  deepEnabled: false,
  jsonLdEnabled: false,
  lazyLoadEnabled: false,
  skipLinkEnabled: false,
  cardEnabled: false,
  linkDensityEnabled: false,
  fixedEnabled: false,
  recommendEnabled: true,
  paginationEnabled: false,
  snsPromoEnabled: false,
  popupEnabled: true,
  cookieEnabled: true,
  platformEnabled: false,
  textDensityEnabled: false,
  shortSeqEnabled: false,
  symbolLineEnabled: false,
  linkParaEnabled: false,
  enhancedHiddenEnabled: false,
  emptyElemEnabled: false,
  jpLayoutEnabled: false,
  jpNavigationEnabled: false,
  authorEnabled: false,
  affiliateEnabled: false,
  speechBubbleEnabled: false,
  newsMediaEnabled: true,
  ecSiteEnabled: false,
  qaSiteEnabled: false,
  videoSiteEnabled: false,
};

const GOLDEN_AGGRESSIVE = {
  altEnabled: true,
  metadataEnabled: true,
  adsEnabled: true,
  navEnabled: true,
  socialEnabled: true,
  deepEnabled: true,
  jsonLdEnabled: false,
  lazyLoadEnabled: false,
  skipLinkEnabled: false,
  cardEnabled: false,
  linkDensityEnabled: true,
  fixedEnabled: false,
  recommendEnabled: true,
  paginationEnabled: false,
  snsPromoEnabled: true,
  popupEnabled: true,
  cookieEnabled: true,
  platformEnabled: false,
  textDensityEnabled: true,
  shortSeqEnabled: true,
  symbolLineEnabled: true,
  linkParaEnabled: true,
  enhancedHiddenEnabled: true,
  emptyElemEnabled: true,
  jpLayoutEnabled: true,
  jpNavigationEnabled: true,
  authorEnabled: false,
  affiliateEnabled: true,
  speechBubbleEnabled: true,
  newsMediaEnabled: true,
  ecSiteEnabled: true,
  qaSiteEnabled: true,
  videoSiteEnabled: true,
};

describe('golden pin: PRESETS values (PBI 2026-09-21-05)', () => {
  it('minimal is byte-equal to the pinned object', () => {
    expect(PRESETS.minimal).toEqual(GOLDEN_MINIMAL);
    expect(Object.keys(PRESETS.minimal)).toEqual(Object.keys(GOLDEN_MINIMAL));
  });

  it('balanced is byte-equal to the pinned object', () => {
    expect(PRESETS.balanced).toEqual(GOLDEN_BALANCED);
    expect(Object.keys(PRESETS.balanced)).toEqual(Object.keys(GOLDEN_BALANCED));
  });

  it('aggressive is byte-equal to the pinned object', () => {
    expect(PRESETS.aggressive).toEqual(GOLDEN_AGGRESSIVE);
    expect(Object.keys(PRESETS.aggressive)).toEqual(Object.keys(GOLDEN_AGGRESSIVE));
  });
});

describe('fixed behavior: restorable keeps Category B keys (was the bug)', () => {
  it('news_media / ec_site / qa_site / video_site land in sanitized, not skippedKeys', () => {
    const { sanitized, skippedKeys } = validateRestorableSettings({
      ai_summary_cleansing_news_media: true,
      ai_summary_cleansing_ec_site: false,
      ai_summary_cleansing_qa_site: true,
      ai_summary_cleansing_video_site: false,
    });
    expect(sanitized.ai_summary_cleansing_news_media).toBe(true);
    expect(sanitized.ai_summary_cleansing_ec_site).toBe(false);
    expect(sanitized.ai_summary_cleansing_qa_site).toBe(true);
    expect(sanitized.ai_summary_cleansing_video_site).toBe(false);
    expect(skippedKeys).toEqual([]);
  });
});

// ============================================================================
// Part B: comprehensiveness — derived sets === SSOT set (both directions)
// ============================================================================

describe('comprehensiveness: presets cover exactly the SSOT key space', () => {
  const ruleConfigKeys = new Set(CLEANSING_RULE_KEYS.map((k) => `${k}Enabled`));

  for (const pid of ['minimal', 'balanced', 'aggressive'] as const) {
    it(`${pid}: preset keys === CLEANSING_RULES keys (no missing, no extra)`, () => {
      const presetKeys = new Set(Object.keys(PRESETS[pid]));
      for (const k of ruleConfigKeys) {
        expect(presetKeys.has(k), `${pid} missing ${k}`).toBe(true);
      }
      for (const k of presetKeys) {
        expect(ruleConfigKeys.has(k), `${pid} has extra ${k}`).toBe(true);
      }
    });
  }

  it('isPresetMatch scans all SSOT keys: one flipped flag breaks the match', async () => {
    const { isPresetMatch } = await import('../presets.js');
    for (const pid of ['minimal', 'balanced', 'aggressive'] as const) {
      const full = PRESETS[pid] as Record<string, boolean>;
      expect(isPresetMatch({ ...full }, pid)).toBe(true);
      for (const key of Object.keys(full)) {
        expect(isPresetMatch({ ...full, [key]: !full[key] }, pid), `${pid}.${key}`).toBe(false);
      }
    }
  });
});

describe('comprehensiveness: restorable cleansing booleans cover the SSOT', () => {
  it('every CLEANSING_RULES storageKey restores as boolean (incl. Category B)', () => {
    const payload: Record<string, unknown> = {};
    for (const rule of CLEANSING_RULES) payload[rule.storageKey] = true;
    const { sanitized, skippedKeys } = validateRestorableSettings(payload);
    for (const rule of CLEANSING_RULES) {
      expect(sanitized[rule.storageKey as keyof typeof sanitized]).toBe(true);
      expect(skippedKeys).not.toContain(rule.storageKey);
    }
  });

  it('wrong-typed Category B values are skipped (type derivation is boolean)', () => {
    const { sanitized, skippedKeys } = validateRestorableSettings({
      ai_summary_cleansing_news_media: 'yes',
    });
    expect(sanitized).not.toHaveProperty('ai_summary_cleansing_news_media');
    expect(skippedKeys).toEqual(['ai_summary_cleansing_news_media']);
  });

  it('backup-restore roundtrip keeps the 4 previously-dropped keys', () => {
    const backup = {
      ai_summary_cleansing_alt: true,
      ai_summary_cleansing_news_media: true,
      ai_summary_cleansing_ec_site: false,
      ai_summary_cleansing_qa_site: true,
      ai_summary_cleansing_video_site: false,
    };
    const { sanitized, skippedKeys } = validateRestorableSettings(backup);
    expect(sanitized).toEqual(backup);
    expect(skippedKeys).toEqual([]);
  });

  it('old backup without the 4 keys still restores (missing keys default-resolve)', () => {
    const { sanitized, skippedKeys } = validateRestorableSettings({
      ai_summary_cleansing_alt: true,
    });
    expect(sanitized.ai_summary_cleansing_alt).toBe(true);
    expect(skippedKeys).toEqual([]);
  });
});
