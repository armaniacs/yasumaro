/**
 * privacyMode.test.ts
 *
 * PBI 2026-10-11-02: `privacy_mode` is persisted user data that can be corrupted
 * or smuggled in through a settings backup. The pipeline derives `useMasking`
 * from it, so an unknown value must fail closed to the default (`masked_cloud`)
 * instead of being treated as "some other mode" (which would send raw text to
 * cloud AI). `cloud_only` stays legal because the user selects it explicitly.
 */
import { describe, expect, it } from 'vitest';
import { PRIVACY_MODES, isPrivacyMode } from '../types.js';
import { DEFAULT_SETTINGS } from '../defaults.js';
import { StorageKeys } from '../types.js';

describe('PRIVACY_MODES / isPrivacyMode', () => {
  it('lists exactly the four selectable modes', () => {
    expect([...PRIVACY_MODES]).toEqual(['local_only', 'full_pipeline', 'masked_cloud', 'cloud_only']);
  });

  it('accepts every selectable mode', () => {
    for (const mode of PRIVACY_MODES) {
      // eslint-disable-next-line vitest/valid-expect -- assert the failing mode
      expect(isPrivacyMode(mode), mode).toBe(true);
    }
  });

  it('rejects unknown, malformed and non-string values', () => {
    for (const value of [
      'cloud-only',
      'CLOUD_ONLY',
      '',
      'masked',
      undefined,
      null,
      0,
      true,
      {},
      ['masked_cloud'],
    ]) {
      // eslint-disable-next-line vitest/valid-expect -- assert the failing value
      expect(isPrivacyMode(value), String(value)).toBe(false);
    }
  });
});

describe('normalizePrivacyMode', () => {
  it('keeps the default in one place (masked_cloud)', () => {
    expect(DEFAULT_SETTINGS[StorageKeys.PRIVACY_MODE]).toBe('masked_cloud');
  });

  it('passes every known mode through unchanged', async () => {
    const { normalizePrivacyMode } = await import('../defaults.js');
    for (const mode of PRIVACY_MODES) {
      expect(normalizePrivacyMode(mode)).toBe(mode);
    }
  });

  it('fails closed to masked_cloud for unknown or missing values', async () => {
    const { normalizePrivacyMode } = await import('../defaults.js');
    for (const value of ['corrupt', '', undefined, null, 42, {}, ['local_only']]) {
      // eslint-disable-next-line vitest/valid-expect -- assert the failing value
      expect(normalizePrivacyMode(value), String(value)).toBe('masked_cloud');
    }
  });
});
