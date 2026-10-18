// @layer 1 — Infrastructure: StoragePort pure seam
/**
 * StoragePort — pure thin wrapper over chrome.storage.local
 *
 * Pure interface with only primitive operations: get / set / onChanged / getBytesInUse.
 * No business logic (defaults, migration, encryption, quota) lives here.
 * SettingsRepository owns that logic and drives this port.
 */

import type { Settings } from './types.js';
import { API_KEY_FIELD_NAMES, isApiKeyField } from './apiKeyFields.js';
import { cloneAtStorageBoundary as cloneAtBoundary } from './structuredCloneBoundary.js';

// Canonical list lives in apiKeyFields.ts (dependency-free so this module
// stays importable under hoisted vi.mock of SettingsRepository).
const API_KEY_FIELDS: readonly string[] = API_KEY_FIELD_NAMES;

export interface StoragePort {
  get(keys: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  /**
   * Optional because only the destructive paths need it (legacy-key cleanup
   * in the settings migration). Ports that do not implement it keep working;
   * callers must feature-detect before removing keys.
   */
  remove?(keys: string | string[]): Promise<void>;
  onChanged?(callback: (changes: Record<string, unknown>) => void): void;
  getBytesInUse?(keys?: string | string[] | null): Promise<number>;
}

/**
 * VULN-014 (CWE-312): return a shallow copy of settings with every API-key
 * field emptied. Extracted from RecordingCache so cache modules do not need
 * to know about redaction.
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

export class ChromeStoragePort implements StoragePort {
  async get(keys: string | string[] | null): Promise<Record<string, unknown>> {
    return chrome.storage.local.get(keys) as Promise<Record<string, unknown>>;
  }
  async set(items: Record<string, unknown>): Promise<void> {
    await chrome.storage.local.set(items);
  }
  async remove(keys: string | string[]): Promise<void> {
    await chrome.storage.local.remove(keys);
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

/**
 * Test double for `chrome.storage.local`: a faithful key-value store.
 *
 * `*_version` note (2026-10-19): the name suffix carries two unrelated meanings
 * in this codebase, and the port must not try to tell them apart.
 *   1. `<key>_version` numeric CAS generation — written by
 *      `StorageTransaction` as a plain sibling key (`{ [key]: v, [key_version]: n }`).
 *   2. An ordinary key whose name happens to end in `_version` and whose value is
 *      a string — every such `StorageKeys` value is this shape
 *      (`privacy_consent_version`, `gemini_api_version`, `tranco_version`).
 * In both cases chrome stores whatever it is given under that exact key, so this
 * port does the same. It previously kept a separate `versions` map for the
 * numeric shape and dropped the string shape on `set`, which made tests read a
 * store production never exposes.
 */
export class InMemoryStoragePort implements StoragePort {
  private store = new Map<string, unknown>();
  private listeners: Array<(changes: Record<string, unknown>) => void> = [];

  async get(keys: string | string[] | null): Promise<Record<string, unknown>> {
    if (keys === null) {
      const all: Record<string, unknown> = {};
      for (const [k, v] of this.store) all[k] = cloneAtBoundary(v);
      return all;
    }
    if (Array.isArray(keys)) {
      const result: Record<string, unknown> = {};
      for (const k of keys) {
        if (this.store.has(k)) result[k] = cloneAtBoundary(this.store.get(k));
      }
      return result;
    }
    if (typeof keys === 'string') {
      return this.store.has(keys) ? { [keys]: cloneAtBoundary(this.store.get(keys)) } : {};
    }
    return {};
  }

  async set(items: Record<string, unknown>): Promise<void> {
    for (const [k, v] of Object.entries(items)) {
      this.store.set(k, cloneAtBoundary(v));
    }
    const changes: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(items)) changes[k] = cloneAtBoundary(v);
    for (const cb of this.listeners) cb(changes);
  }

  async remove(keys: string | string[]): Promise<void> {
    const list = Array.isArray(keys) ? keys : [keys];
    for (const k of list) this.store.delete(k);
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
      const v = this.store.get(k);
      if (v !== undefined) {
        try { total += JSON.stringify(v).length; } catch { total += 256; }
      }
    }
    return total;
  }

  // Test helper to seed data
  seed(items: Record<string, unknown>): void {
    for (const [k, v] of Object.entries(items)) {
      this.store.set(k, cloneAtBoundary(v));
    }
  }

  // Testing helper: inspect underlying store
  dump(): Record<string, unknown> {
    const all: Record<string, unknown> = {};
    for (const [k, v] of this.store) all[k] = cloneAtBoundary(v);
    return all;
  }

  clear(): void {
    this.store.clear();
    this.listeners = [];
  }

  // Test helper: read a numeric CAS generation for assertions
  getVersion(key: string): number | undefined {
    const raw = this.store.get(`${key}_version`);
    return typeof raw === 'number' ? raw : undefined;
  }
}
