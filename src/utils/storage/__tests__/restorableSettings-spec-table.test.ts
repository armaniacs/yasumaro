/**
 * restorableSettings-spec-table.test.ts
 * PBI 2026-09-18-13: pins the structural invariants of the merged
 * RESTORABLE_KEY_SPECS table — the allowlist is derived from it, API key
 * fields never appear, and the cleansing-key families keep full coverage.
 */
import { describe, it, expect } from 'vitest';
import {
  RESTORABLE_KEY_SPECS,
  RESTORABLE_KEYS,
  validateRestorableSettings,
} from '../restorableSettings.js';
import { API_KEY_FIELDS } from '../settingsMigration.js';
import { isStorageKeyValue } from '../settingsBackup.js';

describe('restorableSettings spec table invariants (PBI 13)', () => {
  it('derives RESTORABLE_KEYS from the spec table (no drift possible)', () => {
    expect(RESTORABLE_KEYS.size).toBe(Object.keys(RESTORABLE_KEY_SPECS).length);
    for (const key of Object.keys(RESTORABLE_KEY_SPECS)) {
      expect(RESTORABLE_KEYS.has(key)).toBe(true);
    }
  });

  it('never allowlists sensitive API key fields', () => {
    for (const field of API_KEY_FIELDS) {
      expect(RESTORABLE_KEYS.has(field)).toBe(false);
    }
  });

  it('keeps the allowlist a subset of StorageKeys', () => {
    // PBI 2026-10-21-05: safety_mode / tranco_tier stayed allowlisted after the
    // Trust DB unification dropped both from StorageKeys, so restoring a backup
    // wrote keys nothing read (the legacy-restore path filtered them out, the
    // encrypted-restore path did not). This invariant detects that drift
    // structurally instead of per incident.
    const outsideStorageKeys = [...RESTORABLE_KEYS].filter((key) => !isStorageKeyValue(key));
    expect(outsideStorageKeys).toEqual([]);
  });

  it('keeps every cleansing flag typed as boolean', () => {
    // 1 ai_summary_cleansing_enabled + 33 CLEANSING_RULES-derived flags +
    // 1 body_protection_enabled. Derived from the SSOT table since
    // PBI 2026-09-21-05, so a new rule cannot skip typing.
    const cleansingBooleans = Object.entries(RESTORABLE_KEY_SPECS)
      .filter(([key, spec]) => key.startsWith('ai_summary_cleansing_') && spec.type === 'boolean');
    expect(cleansingBooleans.length).toBe(35);
  });

  it('keeps numeric cleansing keys type-less (non-numbers pass through as today)', () => {
    // Byte-identical behavior guard: range check applies only to numbers.
    const numericSpecs = Object.entries(RESTORABLE_KEY_SPECS)
      .filter(([key]) => key.startsWith('ai_summary_cleansing_') && RESTORABLE_KEY_SPECS[key]?.range);
    expect(numericSpecs.length).toBe(6);
    for (const [, spec] of numericSpecs) {
      expect(spec.type).toBeUndefined();
    }
    const result = validateRestorableSettings({ ai_summary_cleansing_body_protection_threshold: 'not-a-number' });
    expect(result.sanitized.ai_summary_cleansing_body_protection_threshold).toBe('not-a-number');
    expect(result.skippedKeys).toEqual([]);
  });
});
