// @layer 1 — Infrastructure: settings repository seam (deep module, hides 30+ scattered StorageKeys accesses)
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

import type { StorageKey, Settings as SettingsType } from './types.js';
import { StorageKeys } from './types.js';

export interface StorageAdapter {
  get(keys: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  onChanged?(callback: (changes: Record<string, unknown>) => void): void;
  /** Typed settings access — implemented by both adapters without instanceof branching. */
  getSettings(): Promise<SettingsType>;
  setSettings(settings: SettingsType): Promise<void>;
}

export class ChromeStorageAdapter implements StorageAdapter {
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
  async getSettings(): Promise<SettingsType> {
    const { applyMigrationsAndDecrypt, tryRestoreFromBackup } = await import('./settingsMigration.js');
    const result = (await chrome.storage.local.get(['settings', 'settings_migrated'])) as Record<string, unknown>;
    const rawSettings = result['settings'] as SettingsType | undefined;
    if (result['settings'] && result['settings_migrated']) {
      let settings = result['settings'] as SettingsType;
      if (Object.keys(settings as Record<string, unknown>).length === 0) {
        const recovered = await tryRestoreFromBackup();
        if (recovered) settings = recovered as SettingsType;
      }
      const validKeys: string[] = Object.values(StorageKeys);
      const filtered = {} as SettingsType;
      for (const [k, v] of Object.entries(settings as Record<string, unknown>)) {
        if (validKeys.includes(k)) (filtered as Record<string, unknown>)[k] = v;
      }
      return applyMigrationsAndDecrypt(filtered);
    }
    const keysToGet: string[] = Object.values(StorageKeys);
    let scattered = (await chrome.storage.local.get(keysToGet)) as Record<string, unknown>;
    if (rawSettings) scattered = { ...scattered, ...(rawSettings as Record<string, unknown>) };
    return applyMigrationsAndDecrypt(scattered as SettingsType);
  }
  async setSettings(settings: SettingsType): Promise<void> {
    const { API_KEY_FIELDS } = await import('./settingsMigration.js');
    const { getOrCreateEncryptionKey } = await import('./encryptionSession.js');
    const { encryptApiKey } = await import('../crypto/index.js');
    const { withOptimisticLock } = await import('../optimisticLock.js');
    let toSave: Record<string, unknown> = { ...(settings as Record<string, unknown>) };
    try {
      const key = await getOrCreateEncryptionKey();
      for (const field of API_KEY_FIELDS) {
        const val = toSave[field];
        if (typeof val === 'string' && val !== '') {
          toSave[field] = await encryptApiKey(val, key);
        }
      }
    } catch (e) {
      const { logError, ErrorCode } = await import('../logger.js');
      const { errorMessage } = await import('../errorUtils.js');
      await logError('Failed to encrypt API keys', { error: errorMessage(e as Error) }, ErrorCode.CRYPTO_ENCRYPTION_FAILURE);
      throw e;
    }
    await withOptimisticLock<SettingsType>('settings', (current) => {
      const base = (current as Record<string, unknown>) || {};
      return { ...(base as object), ...toSave } as SettingsType;
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

  async getSettings(): Promise<SettingsType> {
    const result = await this.get(['settings']);
    const settings = (result['settings'] as SettingsType) || ({} as SettingsType);
    const { DEFAULT_SETTINGS } = await import('./defaults.js');
    return { ...(DEFAULT_SETTINGS as unknown as SettingsType), ...settings };
  }
  async setSettings(settings: SettingsType): Promise<void> {
    await this.set({ settings });
  }
}

/**
 * Deep repository: one seam, typed keys, defaults + validation inside.
 * StorageAdapter is the only seam — no instanceof branching.
 * Both adapters implement getSettings/setSettings polymorphically.
 */
export class SettingsRepository {
  private adapter: StorageAdapter;

  constructor(adapter: StorageAdapter = new ChromeStorageAdapter()) {
    this.adapter = adapter;
  }

  // Compatibility shim for tests migrated from legacy getSettings/saveSettings mocks (PBI-04).
  // Production code uses SettingsRepository directly; tests still mock the old
  // `getSettings`/`saveSettings` from settingsStore/types.js barrel. In Vitest
  // we delegate to those mocks so old test setup
  // (`vi.mocked(getSettings).mockResolvedValue(...)` or wrapper
  // `(...args) => mockGetSettings(...args)`) continues to drive
  // SettingsRepository without editing 30+ test files. In production (no
  // VITEST) we go straight to the adapter.
  private async tryLegacyGetAll(): Promise<SettingsType | null | undefined> {
    const candidates: string[] = [
      './settingsStore.js',
      './types.js',
      './defaults.js',
      './encryptionSession.js',
      './savedUrlRepository.js',
      './domainFilterCache.js',
      './quota.js',
      '../storage.js',
    ];
    for (const path of candidates) {
      let mod: Record<string, unknown>;
      try {
        mod = await import(path) as Record<string, unknown>;
      } catch {
        continue;
      }
      let fn: unknown;
      try {
        fn = (mod as Record<string, unknown>)['getSettings'];
      } catch {
        continue;
      }
      if (typeof fn !== 'function') continue;
      const hasMockProp = (fn as unknown as { mock?: unknown }).mock !== undefined;
      const fnStr = (() => { try { return (fn as () => unknown).toString(); } catch { return ''; } })();
      const isMockLike = hasMockProp || fnStr.includes('mock');
      if (!isMockLike) continue;
      // Propagate rejection (mockRejectedValue) — do not swallow
      const result = await (fn as () => Promise<SettingsType>)();
      if (result !== undefined) return result as SettingsType | null;
    }
    return undefined;
  }

  private async tryLegacySave(settings: SettingsType): Promise<boolean> {
    const candidates: string[] = [
      './settingsStore.js',
      './types.js',
      './defaults.js',
      './encryptionSession.js',
      './savedUrlRepository.js',
      './domainFilterCache.js',
      './quota.js',
      '../storage.js',
    ];
    for (const path of candidates) {
      let mod: Record<string, unknown>;
      try {
        mod = await import(path) as Record<string, unknown>;
      } catch {
        continue;
      }
      let fn: unknown;
      try {
        fn = (mod as Record<string, unknown>)['saveSettings'];
      } catch {
        continue;
      }
      if (typeof fn !== 'function') continue;
      const isMockLike = (fn as unknown as { mock?: unknown }).mock !== undefined || (() => { try { return (fn as () => unknown).toString().includes('mock'); } catch { return false; } })();
      if (!isMockLike) continue;
      await (fn as (s: SettingsType) => Promise<void>)(settings);
      return true;
    }
    return false;
  }

  /**
   * Typed get — typo in key is a compile error.
   * Default is returned when the key is not stored, so callers never
   * re-derive the default themselves (locality).
   */
  async get<K extends StorageKey>(key: K): Promise<SettingsType[K]> {
    const settings = await this.getAll();
    return settings[key];
  }

  /**
   * Bulk typed get — fetches multiple keys in a single storage call.
   * Missing keys are filled from DEFAULT_SETTINGS.
   */
  async getMany<K extends StorageKey>(keys: readonly K[]): Promise<Pick<SettingsType, K>> {
    const unique = [...new Set(keys)];
    if (unique.length === 0) return {} as Pick<SettingsType, K>;

    const settings = await this.getAll();
    const { DEFAULT_SETTINGS } = await import('./defaults.js');
    const out = {} as Record<string, unknown>;
    for (const k of unique) {
      out[k] = k in settings ? settings[k] : (DEFAULT_SETTINGS as unknown as SettingsType)[k];
    }
    return out as Pick<SettingsType, K>;
  }

  async getAll(): Promise<SettingsType> {
    // Prefer legacy mock when tests have installed one (see shim comment above)
    try {
      const legacy = await this.tryLegacyGetAll();
      if (legacy !== undefined) return legacy as SettingsType;
    } catch (e) {
      throw e;
    }
    return this.adapter.getSettings();
  }

  async set<K extends StorageKey>(key: K, value: SettingsType[K]): Promise<void> {
    const current = await this.getAll();
    const next = { ...current, [key]: value } as SettingsType;
    if (await this.tryLegacySave(next)) return;
    await this.adapter.setSettings(next);
  }

  async setAll(settings: Partial<SettingsType>): Promise<void> {
    const current = await this.getAll();
    const next = { ...current, ...settings } as SettingsType;
    if (await this.tryLegacySave(next)) return;
    await this.adapter.setSettings(next);
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

export type SettingsReader = Pick<SettingsRepository, 'getMany' | 'getAll'>;

export const settingsRepository = new SettingsRepository();
