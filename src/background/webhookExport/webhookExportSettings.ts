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
 */

import type { WebhookExportCondition } from './webhookExportPayload.js';

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

export function chromeLocalWebhookExportStore(): WebhookExportStore {
  return {
    get: async (key: string): Promise<string | null> => {
      const raw = await chrome.storage.local.get(key);
      const value: string | null = typeof raw[key] === 'string' ? (raw[key] as string) : null;
      return value;
    },
    set: async (key: string, value: string): Promise<void> => {
      await chrome.storage.local.set({ [key]: value });
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

export async function saveWebhookExportSettings(
  settings: WebhookExportSettings,
  store: WebhookExportStore = chromeLocalWebhookExportStore(),
): Promise<void> {
  const normalized: WebhookExportSettings = normalizeWebhookExportSettings(settings);
  await store.set(WEBHOOK_EXPORT_SETTINGS_KEY, JSON.stringify(normalized));
}
