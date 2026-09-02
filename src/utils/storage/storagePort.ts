// @layer 1 — Infrastructure: StoragePort pure seam
/**
 * StoragePort — pure thin wrapper over chrome.storage.local
 *
 * Pure interface with only primitive operations: get / set / onChanged / getBytesInUse.
 * No business logic (defaults, migration, encryption, quota) lives here.
 * SettingsRepository owns that logic and drives this port.
 */

import type { Settings } from './types.js';

// Local copy as string literals to avoid vi.mock hoisting issues where
// StorageKeys may be undefined at import time (customPromptManager tests mock
// SettingsRepository which is hoisted above StorageKeys definition).
const API_KEY_FIELDS: string[] = [
  'obsidian_api_key',
  'gemini_api_key',
  'openai_api_key',
  'openai_2_api_key',
  'provider_api_key',
  'github_pat',
];

const NORMALIZED_API_KEY_FIELDS = new Set(
  API_KEY_FIELDS.map((f) => f.toLowerCase().replace(/_/g, '')),
);

function isApiKeyField(field: string): boolean {
  return NORMALIZED_API_KEY_FIELDS.has(field.toLowerCase().replace(/_/g, ''));
}

export interface StoragePort {
  get(keys: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  onChanged?(callback: (changes: Record<string, unknown>) => void): void;
  getBytesInUse?(keys?: string | string[] | null): Promise<number>;
}

/**
 * VULN-014 (CWE-312): return a shallow copy of settings with every API-key
 * field emptied. Extracted from RecordingCache so cache modules do not need
 * to know about redaction; StoragePort decorator owns it.
 */
export function redactSettingsApiKeys(settings: Settings | null): Settings | null {
  if (!settings) return null;
  const copy = { ...settings } as Record<string, unknown>;
  for (const field of Object.keys(copy)) {
    if (isApiKeyField(field)) copy[field] = '';
  }
  // Also handle exact snake-case fields for completeness
  for (const field of API_KEY_FIELDS) {
    if (field in copy) copy[field] = '';
  }
  return copy as Settings;
}

/**
 * StoragePort decorator that redacts API keys before persisting.
 * Wraps an inner StoragePort and empties API-key fields on `set()`.
 * Cache modules remain unaware of redaction.
 */
export class RedactingStoragePort implements StoragePort {
  constructor(private readonly inner: StoragePort) {}

  async get(keys: string | string[] | null): Promise<Record<string, unknown>> {
    return this.inner.get(keys);
  }

  async set(items: Record<string, unknown>): Promise<void> {
    const redacted: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(items)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        const rec = v as Record<string, unknown>;
        const hasApiKey = Object.keys(rec).some(isApiKeyField);
        if (hasApiKey) {
          const copy = { ...rec };
          for (const f of Object.keys(copy)) if (isApiKeyField(f)) copy[f] = '';
          for (const f of API_KEY_FIELDS) if (f in copy) copy[f] = '';
          redacted[k] = copy;
          continue;
        }
        if ('settingsCache' in rec && rec.settingsCache && typeof rec.settingsCache === 'object') {
          const innerSettings = rec.settingsCache as Record<string, unknown>;
          const hasNestedKey = Object.keys(innerSettings).some(isApiKeyField);
          if (hasNestedKey) {
            const copy = { ...rec, settingsCache: { ...innerSettings } } as Record<string, unknown>;
            for (const f of Object.keys(copy.settingsCache as Record<string, unknown>)) if (isApiKeyField(f)) (copy.settingsCache as Record<string, unknown>)[f] = '';
            for (const f of API_KEY_FIELDS) if (f in (copy.settingsCache as Record<string, unknown>)) (copy.settingsCache as Record<string, unknown>)[f] = '';
            redacted[k] = copy;
            continue;
          }
        }
      }
      redacted[k] = v;
    }
    return this.inner.set(redacted);
  }

  onChanged(callback: (changes: Record<string, unknown>) => void): void {
    this.inner.onChanged?.(callback);
  }

  async getBytesInUse(keys?: string | string[] | null): Promise<number> {
    return this.inner.getBytesInUse?.(keys) ?? 0;
  }
}

export class ChromeStoragePort implements StoragePort {
  async get(keys: string | string[] | null): Promise<Record<string, unknown>> {
    return chrome.storage.local.get(keys) as Promise<Record<string, unknown>>;
  }
  async set(items: Record<string, unknown>): Promise<void> {
    await chrome.storage.local.set(items);
  }
  onChanged(callback: (changes: Record<string, unknown>) => void): void {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      const local: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(changes)) local[k] = (v as { newValue: unknown }).newValue;
      callback(local);
    });
  }
  async getBytesInUse(keys?: string | string[] | null): Promise<number> {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.local?.getBytesInUse) {
        if (keys === null || keys === undefined) return await chrome.storage.local.getBytesInUse(null as unknown as string);
        if (typeof keys === 'string') return await chrome.storage.local.getBytesInUse(keys);
        if (Array.isArray(keys)) return await chrome.storage.local.getBytesInUse(keys);
        return await chrome.storage.local.getBytesInUse(null as unknown as string);
      }
    } catch {
      // fallback to 0 in test env
    }
    return 0;
  }
}

export class InMemoryStoragePort implements StoragePort {
  private store = new Map<string, unknown>();
  private versions = new Map<string, number>();
  private listeners: Array<(changes: Record<string, unknown>) => void> = [];

  async get(keys: string | string[] | null): Promise<Record<string, unknown>> {
    if (keys === null) {
      const all: Record<string, unknown> = {};
      for (const [k, v] of this.store) all[k] = v;
      for (const [k, v] of this.versions) all[`${k}_version`] = v;
      return all;
    }
    if (Array.isArray(keys)) {
      const result: Record<string, unknown> = {};
      for (const k of keys) {
        if (k.endsWith('_version')) {
          const base = k.slice(0, -8);
          if (this.versions.has(base)) result[k] = this.versions.get(base);
        } else if (this.store.has(k)) {
          result[k] = this.store.get(k);
        } else if (this.versions.has(k)) {
          // version key requested directly via base name fallback
          result[`${k}_version`] = this.versions.get(k);
        }
      }
      // also include version keys when base key is requested via version semantics
      for (const k of keys) {
        if (!k.endsWith('_version') && this.versions.has(k) && !keys.includes(`${k}_version`)) {
          // do not auto-include; only when explicitly requested
        }
      }
      return result;
    }
    if (typeof keys === 'string') {
      if (keys.endsWith('_version')) {
        const base = keys.slice(0, -8);
        return this.versions.has(base) ? { [keys]: this.versions.get(base) } : {};
      }
      return this.store.has(keys) ? { [keys]: this.store.get(keys) } : {};
    }
    return {};
  }

  async set(items: Record<string, unknown>): Promise<void> {
    for (const [k, v] of Object.entries(items)) {
      if (k.endsWith('_version') && typeof v === 'number') {
        const base = k.slice(0, -8);
        this.versions.set(base, v);
      } else if (!k.endsWith('_version')) {
        this.store.set(k, v);
      }
    }
    for (const cb of this.listeners) cb(items);
  }

  onChanged(callback: (changes: Record<string, unknown>) => void): void {
    this.listeners.push(callback);
  }

  async getBytesInUse(keys?: string | string[] | null): Promise<number> {
    // Estimate size for quota tests — sum JSON lengths of relevant keys
    const targetKeys = keys == null
      ? [...this.store.keys()]
      : typeof keys === 'string'
        ? [keys]
        : keys;
    let total = 0;
    for (const k of targetKeys) {
      if (k.endsWith('_version')) continue;
      const v = this.store.get(k);
      if (v !== undefined) {
        try { total += JSON.stringify(v).length; } catch { total += 256; }
      }
    }
    // include version overhead
    for (const k of targetKeys) {
      if (!k.endsWith('_version') && this.versions.has(k)) total += 8;
    }
    return total;
  }

  // Test helper to seed data
  seed(items: Record<string, unknown>): void {
    for (const [k, v] of Object.entries(items)) {
      if (k.endsWith('_version') && typeof v === 'number') {
        this.versions.set(k.slice(0, -8), v);
      } else {
        this.store.set(k, v);
      }
    }
  }

  // Testing helper: inspect underlying store
  dump(): Record<string, unknown> {
    const all: Record<string, unknown> = {};
    for (const [k, v] of this.store) all[k] = v;
    for (const [k, v] of this.versions) all[`${k}_version`] = v;
    return all;
  }

  clear(): void {
    this.store.clear();
    this.versions.clear();
    this.listeners = [];
  }

  // Test helper: read version for assertions
  getVersion(key: string): number | undefined {
    return this.versions.get(key);
  }
}
