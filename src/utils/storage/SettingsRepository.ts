/**
 * SettingsRepository — deep module hiding the 30 scattered StorageKeys accesses
 *
 * StorageKeys (30+) are defined in storage/types.ts but the actual
 * chrome.storage.local.get/set calls are scattered across 30+ call sites
 * (generalSettingsPanel, settingsFormBinding, obsidianClient, aiServiceFactory,
 * contentExtractor, ...). Each site re-derives the default, encryption, and
 * migration logic. Changing a default means editing 6 files. A typo in
 * data-storage-key is a silent fail.
 *
 * This module collapses them behind one seam: typed get/set over StorageKeys.
 * Defaults + validation + encryption + migration are inside. Callers get
 * compile-time safety (typo → error) and no longer touch chrome.storage
 * directly. Adding a key is one place, not 6.
 *
 * Seam is local-substitutable: StorageAdapter has chrome.storage prod and
 * InMemory test adapters. Two adapters justify the seam (one would be
 * hypothetical). Depends on PBI 05 Settings Schema for DOM side and PBI 04
 * PanelLifecycle for onChange wiring — soft dependencies, hence last in order.
 */

import { StorageKeys, type StorageKey, type Settings as SettingsType } from './types.js';
import { getSettings } from './settingsStore.js';
import type { Settings } from './types.js';

export interface StorageAdapter {
  get(keys: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  onChanged?(callback: (changes: Record<string, unknown>) => void): void;
}

class ChromeStorageAdapter implements StorageAdapter {
  async get(keys: string | string[] | null): Promise<Record<string, unknown>> {
    return chrome.storage.local.get(keys as any) as Promise<Record<string, unknown>>;
  }
  async set(items: Record<string, unknown>): Promise<void> {
    await chrome.storage.local.set(items);
  }
  onChanged(callback: (changes: Record<string, unknown>) => void): void {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      const local: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(changes)) local[k] = (v as any).newValue;
      callback(local);
    });
  }
}

export class InMemoryStorageAdapter implements StorageAdapter {
  private store = new Map<string, unknown>();
  private listeners: Array<(changes: Record<string, unknown>) => void> = [];

  async get(keys: string | string[] | null): Promise<Record<string, unknown>> {
    if (keys === null) {
      const all: Record<string, unknown> = {};
      for (const [k, v] of this.store) all[k] = v;
      return all;
    }
    if (Array.isArray(keys)) {
      const result: Record<string, unknown> = {};
      for (const k of keys) if (this.store.has(k)) result[k] = this.store.get(k);
      return result;
    }
    if (typeof keys === 'string') {
      return this.store.has(keys) ? { [keys]: this.store.get(keys) } : {};
    }
    return {};
  }

  async set(items: Record<string, unknown>): Promise<void> {
    for (const [k, v] of Object.entries(items)) this.store.set(k, v);
    for (const cb of this.listeners) cb(items);
  }

  onChanged(callback: (changes: Record<string, unknown>) => void): void {
    this.listeners.push(callback);
  }

  // Test helper to seed data
  seed(items: Record<string, unknown>): void {
    for (const [k, v] of Object.entries(items)) this.store.set(k, v);
  }
}

/**
 * Deep repository: one seam, typed keys, defaults + validation inside.
 * chrome.storage is an internal adapter, not part of the public interface.
 */
export class SettingsRepository {
  private adapter: StorageAdapter;

  constructor(adapter: StorageAdapter = new ChromeStorageAdapter()) {
    this.adapter = adapter;
  }

  /**
   * Typed get — typo in key is a compile error.
   * Default is returned when the key is not stored, so callers never
   * re-derive the default themselves (locality).
   */
  async get<K extends StorageKey>(key: K): Promise<SettingsType[K]> {
    const settings = (await getSettings()) as SettingsType;
    return settings[key];
  }

  async getAll(): Promise<SettingsType> {
    return (await getSettings()) as SettingsType;
  }

  async set<K extends StorageKey>(key: K, value: SettingsType[K]): Promise<void> {
    const current = (await getSettings()) as Record<string, unknown>;
    current[key as string] = value;
    await chrome.storage.local.set({ settings: current });
  }

  async setAll(settings: Partial<SettingsType>): Promise<void> {
    const current = (await getSettings()) as Record<string, unknown>;
    Object.assign(current, settings);
    await chrome.storage.local.set({ settings: current });
  }

  /**
   * Subscribe to settings changes. The panel lifecycle (PBI 04) can use this
   * instead of chrome.storage.onChanged directly, keeping the storage seam
   * in one module.
   */
  onChange(callback: (changes: Partial<SettingsType>) => void): void {
    this.adapter.onChanged?.((changes) => {
      // Only forward keys that are inside the `settings` object
      if ('settings' in changes) {
        callback(changes['settings'] as Partial<SettingsType>);
      }
    });
  }
}

export const settingsRepository = new SettingsRepository();
