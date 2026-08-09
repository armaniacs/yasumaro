// @vitest-environment jsdom
/**
 * ruleDefaultsConsistency.test.ts
 *
 * Locks the property PBI-20 exists to establish: a rule's storage key and its
 * new-user default are declared once, in CLEANSING_RULES, not restated in
 * DEFAULT_SETTINGS / pageState.ts / the destructure defaults independently.
 *
 * Before this table gained storageKey/newUserDefault, three independent
 * tables disagreed on 7 rules (deep, linkDensity, jpLayout, newsMedia,
 * ecSite, qaSite, videoSite) — see pbi/2026-08-09-20 for the investigation.
 */
import { describe, it, expect } from 'vitest';
import { CLEANSING_RULES } from '../rules.js';
import { DEFAULT_SETTINGS } from '../../storage/defaults.js';

describe('CLEANSING_RULES — storageKey / newUserDefault consistency', () => {
  it('every rule declares a storageKey present in DEFAULT_SETTINGS', () => {
    for (const rule of CLEANSING_RULES) {
      expect(DEFAULT_SETTINGS, `${rule.key}.storageKey -> ${rule.storageKey}`)
        .toHaveProperty(rule.storageKey);
    }
  });

  it('DEFAULT_SETTINGS reflects each rule\'s newUserDefault', () => {
    for (const rule of CLEANSING_RULES) {
      expect(
        (DEFAULT_SETTINGS as Record<string, unknown>)[rule.storageKey],
        `${rule.key}: DEFAULT_SETTINGS[${rule.storageKey}] should equal newUserDefault`,
      ).toBe(rule.newUserDefault);
    }
  });

  it('storageKey values are unique', () => {
    const keys = CLEANSING_RULES.map(r => r.storageKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
