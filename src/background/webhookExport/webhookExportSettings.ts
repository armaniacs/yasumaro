/**
 * webhookExportSettings.ts
 *
 * Transfer-condition settings for the minimal webhook export
 * (PBI 2026-10-22-05, box (a)).
 *
 * Own storage key, own module: the shared StorageKeys/defaults registry is
 * owned by other PBIs, so this feature persists under
 * WEBHOOK_EXPORT_SETTINGS_KEY via an injected store instead of extending the
 * shared registry. The value is one JSON string, so the module never touches
 * `any`/`unknown` shapes from chrome.storage typings.
 *
 * Fail-closed: anything unparsable normalizes to disabled with an empty
 * destination, which the send path refuses before any network happens.
 *
 * Save-time pre-flight: saveWebhookExportSettings judges the destination with
 * the SAME judgment source the send gate uses (judgeWebhookDestination), so a
 * save-permitted destination can never diverge from the send verdict. An
 * unchanged stored destination the initial allowlist covers is preserved
 * (grandfather clause). An empty destination has nothing to judge.
 */

import type { WebhookExportCondition } from './webhookExportPayload.js';
import {
  isWebhookDestinationInAllowlist,
  judgeWebhookDestination,
  type WebhookDestinationVerdict,
} from './webhookExportDestinations.js';
import { ChromeStoragePort, type StoragePort } from '../../utils/storage/storagePort.js';

/** Persisted transfer settings: destination + transfer conditions. */
export interface WebhookExportSettings {
  enabled: boolean;
  url: string;
  condition: WebhookExportCondition;
}

/** Single chrome.storage.local key owning this feature's settings. */
export const WEBHOOK_EXPORT_SETTINGS_KEY = 'webhook_export_settings_v1';

/** Destination URLs longer than this are truncated (storage-quota hygiene). */
export const WEBHOOK_EXPORT_MAX_URL_LENGTH = 2000;

/** Minimal storage seam (default: chrome.storage.local, one string value). */
export interface WebhookExportStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

/**
 * Production WebhookExportStore backend. Delegates to the StoragePort seam
 * (PBI 2026-11-07-04): same key, same single-string value — the raw
 * chrome.storage.local access lives in ChromeStoragePort only.
 */
export function chromeLocalWebhookExportStore(port: StoragePort = new ChromeStoragePort()): WebhookExportStore {
  return {
    get: async (key: string): Promise<string | null> => {
      const raw = await port.get(key);
      const value: string | null = typeof raw[key] === 'string' ? (raw[key] as string) : null;
      return value;
    },
    set: async (key: string, value: string): Promise<void> => {
      await port.set({ [key]: value });
    },
  };
}

/** Factory default: export off, no destination, no conditions. */
export function defaultWebhookExportSettings(): WebhookExportSettings {
  return { enabled: false, url: '', condition: {} };
}

interface RawConditionShape {
  tag?: string | undefined;
  minScrollDepth?: number | undefined;
  minVisitDuration?: number | undefined;
}

interface RawSettingsShape {
  enabled?: boolean | undefined;
  url?: string | undefined;
  condition?: RawConditionShape | null | undefined;
}

function isSettingsRecord(value: RawSettingsShape | null | undefined): value is RawSettingsShape {
  return typeof value === 'object' && value !== null;
}

function isConditionRecord(value: RawConditionShape | null | undefined): value is RawConditionShape {
  return typeof value === 'object' && value !== null;
}

function normalizeCondition(raw: RawConditionShape | null | undefined): WebhookExportCondition {
  if (!isConditionRecord(raw)) return {};
  const source: RawConditionShape = raw;
  const condition: WebhookExportCondition = {};
  if (typeof source.tag === 'string' && source.tag.trim() !== '') {
    condition.tag = source.tag.trim();
  }
  if (typeof source.minScrollDepth === 'number' && Number.isFinite(source.minScrollDepth)) {
    condition.minScrollDepth = Math.min(100, Math.max(0, source.minScrollDepth));
  }
  if (typeof source.minVisitDuration === 'number' && Number.isFinite(source.minVisitDuration)) {
    condition.minVisitDuration = Math.max(0, source.minVisitDuration);
  }
  return condition;
}

/**
 * Normalizes an untrusted stored shape. Unknown fields are dropped; a
 * non-object (corrupt backup, older version) yields the disabled default.
 */
export function normalizeWebhookExportSettings(raw: RawSettingsShape | null | undefined): WebhookExportSettings {
  if (!isSettingsRecord(raw)) return defaultWebhookExportSettings();
  const source: RawSettingsShape = raw;
  const url: string = typeof source.url === 'string' ? source.url.trim().slice(0, WEBHOOK_EXPORT_MAX_URL_LENGTH) : '';
  return {
    enabled: source.enabled === true,
    url,
    condition: normalizeCondition(source.condition === null ? undefined : source.condition),
  };
}

function parseStored(raw: string | null): RawSettingsShape | null {
  if (raw === null) return null;
  try {
    const parsed: RawSettingsShape = JSON.parse(raw) as RawSettingsShape;
    return parsed;
  } catch {
    return null;
  }
}

export async function loadWebhookExportSettings(
  store: WebhookExportStore = chromeLocalWebhookExportStore(),
): Promise<WebhookExportSettings> {
  return normalizeWebhookExportSettings(parseStored(await store.get(WEBHOOK_EXPORT_SETTINGS_KEY)));
}

/**
 * Typed save rejection. The verdict carries origin-only data: the full
 * webhook URL (possibly token-bearing) never rides the error or any UI.
 */
export class WebhookDestinationBlockedError extends Error {
  readonly verdict: WebhookDestinationVerdict;

  constructor(verdict: WebhookDestinationVerdict) {
    super(`webhook destination not permitted: ${verdict.reason} ${verdict.origin}`);
    this.name = 'WebhookDestinationBlockedError';
    this.verdict = verdict;
  }
}

/** The save-time pre-flight outcome for one destination. */
export interface WebhookSavePreflight {
  /** `null` when there is no destination to judge (empty URL: feature off / cleared). */
  verdict: WebhookDestinationVerdict | null;
  /** True when the save proceeds with a non-permitted destination (grandfather clause). */
  grandfathered: boolean;
}

/**
 * Save-time pre-flight judgment. The grandfather clause is scoped to the
 * initial allowlist: an unchanged stored destination OUTSIDE the list is
 * still rejected, since it was already send-blocked and the rejection is what
 * surfaces the silent-block accident. The flag is derived from the stored
 * destination, never persisted, so no storage-schema migration is needed.
 */
export function evaluateWebhookExportSave(
  incoming: WebhookExportSettings,
  existing: WebhookExportSettings | null,
): WebhookSavePreflight {
  if (incoming.url === '') {
    return { verdict: null, grandfathered: false };
  }
  const verdict = judgeWebhookDestination(incoming.url);
  if (verdict.permitted) {
    return { verdict, grandfathered: false };
  }
  const grandfathered =
    existing !== null && existing.url === incoming.url && isWebhookDestinationInAllowlist(incoming.url);
  return { verdict, grandfathered };
}

/**
 * Returns the destination verdict so the UI never claims a permission the
 * send gate does not grant (a grandfathered non-https destination reports
 * non-permitted). Throws WebhookDestinationBlockedError on rejection.
 */
export async function saveWebhookExportSettings(
  settings: WebhookExportSettings,
  store: WebhookExportStore = chromeLocalWebhookExportStore(),
): Promise<WebhookDestinationVerdict | null> {
  const normalized: WebhookExportSettings = normalizeWebhookExportSettings(settings);
  const existing: WebhookExportSettings = await loadWebhookExportSettings(store);
  const preflight = evaluateWebhookExportSave(normalized, existing);
  if (preflight.verdict !== null && !preflight.verdict.permitted && !preflight.grandfathered) {
    throw new WebhookDestinationBlockedError(preflight.verdict);
  }
  await store.set(WEBHOOK_EXPORT_SETTINGS_KEY, JSON.stringify(normalized));
  return preflight.verdict;
}
