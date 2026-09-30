/**
 * providerSettingsResolver.test.ts
 * Golden pins for the three settings ladders that used to be hand-written on
 * the provider base. The wording-free values here are the contract: which rung
 * wins, and what "not configured" means for each setting.
 */
import { describe, test, expect } from 'vitest';
import { validateMaxTokens } from '../../../../utils/aiLimits.js';
import { StorageKeys, type Settings } from '../../../../utils/storage/types.js';
import {
  CLOUD_TIMEOUT_MS,
  DEFAULT_MAX_TOKENS,
  LOCAL_TIMEOUT_MS,
  resolveMaxContentChars,
  resolveMaxTokens,
  resolveProviderSetting,
  resolveTimeoutMs,
} from '../providerSettingsResolver.js';

function settingsOf(overrides: Record<string, unknown>): Settings {
  return overrides as unknown as Settings;
}

describe('resolveProviderSetting', () => {
  test('the first rung that answers wins', () => {
    const value = resolveProviderSetting({
      scoped: () => 'scoped',
      global: () => 'global',
      fallback: 'default',
    });

    expect(value).toBe('scoped');
  });

  test('an absent rung falls through to the next', () => {
    const value = resolveProviderSetting({
      scoped: () => undefined,
      global: () => 'global',
      fallback: 'default',
    });

    expect(value).toBe('global');
  });

  test('two absent rungs land on the default', () => {
    const value = resolveProviderSetting({
      scoped: () => undefined,
      global: () => undefined,
      fallback: 'default',
    });

    expect(value).toBe('default');
  });
});

describe('resolveTimeoutMs', () => {
  test('a stored timeout above zero wins over the deployment default', () => {
    expect(resolveTimeoutMs(45_000, true)).toBe(45_000);
    expect(resolveTimeoutMs(45_000, false)).toBe(45_000);
  });

  test('0 means auto: a local deployment gets the longer budget', () => {
    expect(resolveTimeoutMs(0, true)).toBe(LOCAL_TIMEOUT_MS);
  });

  test('0 means auto: a cloud deployment gets the shorter budget', () => {
    expect(resolveTimeoutMs(0, false)).toBe(CLOUD_TIMEOUT_MS);
  });

  test('a negative stored value is not a timeout', () => {
    expect(resolveTimeoutMs(-1, false)).toBe(CLOUD_TIMEOUT_MS);
  });
});

describe('resolveMaxContentChars', () => {
  const providerId = 'test-provider';

  test('returns the per-provider maxContentChars setting', () => {
    const settings = settingsOf({ providers: { [providerId]: { maxContentChars: 5000 } } });

    expect(resolveMaxContentChars(settings, providerId, 10_000)).toBe(5000);
  });

  test('prefers the global setting when a storageKey is specified', () => {
    const settings = settingsOf({ [StorageKeys.OPENAI_CONTENT_CHARS]: 15000 });

    expect(
      resolveMaxContentChars(settings, providerId, 10_000, StorageKeys.OPENAI_CONTENT_CHARS),
    ).toBe(15000);
  });

  test('prefers the per-provider setting over the global one', () => {
    const settings = settingsOf({
      providers: { [providerId]: { maxContentChars: 7000 } },
      [StorageKeys.OPENAI_CONTENT_CHARS]: 15000,
    });

    expect(
      resolveMaxContentChars(settings, providerId, 10_000, StorageKeys.OPENAI_CONTENT_CHARS),
    ).toBe(7000);
  });

  test('returns the default value when no setting exists', () => {
    expect(resolveMaxContentChars(settingsOf({}), providerId, 30_000)).toBe(30_000);
  });

  test('a per-provider value of 0 is not a budget and falls through', () => {
    const settings = settingsOf({
      providers: { [providerId]: { maxContentChars: 0 } },
      [StorageKeys.OPENAI_CONTENT_CHARS]: 15000,
    });

    expect(
      resolveMaxContentChars(settings, providerId, 10_000, StorageKeys.OPENAI_CONTENT_CHARS),
    ).toBe(15000);
  });

  test('a global value is ignored when the caller owns no storage key', () => {
    const settings = settingsOf({ [StorageKeys.OPENAI_CONTENT_CHARS]: 15000 });

    expect(resolveMaxContentChars(settings, providerId, 10_000)).toBe(10_000);
  });

  test('looks up the bag by the provider id it is given, not by getName()', () => {
    const settings = settingsOf({ providers: { openai: { maxContentChars: 12000 } } });

    expect(resolveMaxContentChars(settings, 'openai', 10_000)).toBe(12000);
  });
});

describe('resolveMaxTokens', () => {
  const providerId = 'test-provider';

  test('returns the per-provider maxTokens setting', () => {
    const settings = settingsOf({ providers: { [providerId]: { maxTokens: 5000 } } });

    expect(resolveMaxTokens(settings, providerId)).toBe(5000);
  });

  test('returns the global maxTokens setting', () => {
    const settings = settingsOf({ [StorageKeys.MAX_TOKENS_PER_PROMPT]: 8000 });

    expect(resolveMaxTokens(settings, providerId)).toBe(8000);
  });

  test('returns the default value 1000 when no setting exists', () => {
    expect(resolveMaxTokens(settingsOf({}), providerId)).toBe(DEFAULT_MAX_TOKENS);
  });

  test('uses the global setting when the providers setting is empty', () => {
    const settings = settingsOf({
      providers: {},
      [StorageKeys.MAX_TOKENS_PER_PROMPT]: 4000,
    });

    expect(resolveMaxTokens(settings, providerId)).toBe(4000);
  });

  test('uses the default value when the global setting is NaN', () => {
    const settings = settingsOf({ [StorageKeys.MAX_TOKENS_PER_PROMPT]: NaN });

    expect(resolveMaxTokens(settings, providerId)).toBe(DEFAULT_MAX_TOKENS);
  });

  test('falls back to the global setting when the provider maxTokens is 0', () => {
    const settings = settingsOf({
      providers: { [providerId]: { maxTokens: 0 } },
      [StorageKeys.MAX_TOKENS_PER_PROMPT]: 6000,
    });

    // 0 is falsy, so it should fall through to global
    expect(resolveMaxTokens(settings, providerId)).toBe(6000);
  });

  test('looks up settings by the provider id it is given', () => {
    const settings = settingsOf({ providers: { openai: { maxTokens: 12000 } } });

    expect(resolveMaxTokens(settings, 'openai')).toBe(12000);
  });

  // A stored value above the provider's cap is clamped rather than sent, and
  // the clamp is what the summary request must carry. The cap itself belongs
  // to aiLimits, so the pin is "this rung validates", not a number here.
  test('clamps a stored value to the provider cap', () => {
    const settings = settingsOf({ providers: { [providerId]: { maxTokens: 9_999_999 } } });

    expect(resolveMaxTokens(settings, providerId)).toBe(validateMaxTokens(9_999_999, providerId));
  });
});
