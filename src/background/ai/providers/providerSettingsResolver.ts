/**
 * providerSettingsResolver.ts
 *
 * The one place a provider setting is resolved.
 *
 * Timeout, request content budget and output token budget were three ladders
 * hand-written on the provider base, each spelling its own "per-provider first,
 * then global, then default" order. Adding a rung to one of them left the other
 * two as the counterexample, and nothing said which order was intended. This
 * module states the order once (`resolveProviderSetting`) and expresses all
 * three as rungs over it.
 *
 * The rungs differ where the settings genuinely differ, and only there: the
 * token budget is validated per provider id (the cap is provider-specific), and
 * only the content budget has a configurable global key. A rung returns
 * `undefined` to say "not configured here", never a sentinel, so a setting
 * stored as 0 or NaN falls through instead of becoming a budget of 0.
 */

import { validateMaxTokens } from '../../../utils/aiLimits.js';
import { StorageKeys, type Settings, type StorageKey } from '../../../utils/storage/types.js';

/** Constructor ritual: 0 (or anything unset) means "derive from the deployment". */
export const LOCAL_TIMEOUT_MS = 120_000;
export const CLOUD_TIMEOUT_MS = 30_000;

/** Output token budget when nothing is configured. */
export const DEFAULT_MAX_TOKENS = 1000;

/**
 * The three rungs, in resolution order. `scoped` reads the per-provider bag,
 * `global` the single storage key some settings have, `fallback` closes the
 * ladder. The first rung that answers wins; a rung that does not apply (no
 * global key, for instance) is simply absent.
 */
export interface ProviderSettingLadder<T> {
  /** 1. The per-provider entry in `settings.providers[providerId]`. */
  scoped: () => T | undefined;
  /** 2. The global storage value. */
  global: () => T | undefined;
  /** 3. The built-in default. */
  fallback: T;
}

export function resolveProviderSetting<T>(ladder: ProviderSettingLadder<T>): T {
  return ladder.scoped() ?? ladder.global() ?? ladder.fallback;
}

/**
 * Request timeout. Two rungs rather than three: a timeout is per deployment,
 * not per provider, so there is no scoped entry to read.
 */
export function resolveTimeoutMs(storedTimeoutMs: number, isLocal: boolean): number {
  return resolveProviderSetting<number>({
    scoped: () => undefined,
    global: () => (storedTimeoutMs > 0 ? storedTimeoutMs : undefined),
    fallback: isLocal ? LOCAL_TIMEOUT_MS : CLOUD_TIMEOUT_MS,
  });
}

/**
 * Largest request content a provider may send. `storageKey` is the catalog's
 * `contentCharsKey` — the caller owns which global key it is, so the ladder
 * does not have to know the provider registry.
 */
export function resolveMaxContentChars(
  settings: Settings,
  providerId: string,
  defaultValue: number,
  storageKey?: StorageKey,
): number {
  return resolveProviderSetting<number>({
    scoped: () => {
      const config = settings.providers?.[providerId];
      return typeof config?.maxContentChars === 'number' && config.maxContentChars > 0
        ? config.maxContentChars
        : undefined;
    },
    global: () => {
      if (!storageKey) return undefined;
      const stored = settings[storageKey] as unknown as number | undefined;
      return typeof stored === 'number' && stored > 0 ? stored : undefined;
    },
    fallback: defaultValue,
  });
}

/**
 * Output token budget. Every rung is validated against the provider id, so a
 * stored value above the provider's cap is clamped rather than sent.
 */
export function resolveMaxTokens(settings: Settings, providerId: string): number {
  return resolveProviderSetting<number>({
    scoped: () => {
      const scoped = settings.providers?.[providerId]?.maxTokens;
      return scoped ? validateMaxTokens(scoped, providerId) : undefined;
    },
    global: () => {
      const stored = settings[StorageKeys.MAX_TOKENS_PER_PROMPT] as number;
      return stored && !isNaN(stored) ? validateMaxTokens(stored, providerId) : undefined;
    },
    fallback: validateMaxTokens(DEFAULT_MAX_TOKENS, providerId),
  });
}
