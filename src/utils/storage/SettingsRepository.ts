// @layer 1 — Infrastructure: settings repository seam (deep module, hides 30+ scattered StorageKeys accesses)
/**
 * SettingsRepository — deep module hiding the 30 scattered StorageKeys accesses
 *
 * Phase15 deepening:
 * - StoragePort { get/set/onChanged/getBytesInUse } is the single pure seam (thin wrapper)
 * - SettingsRepository { get/set/observe } owns defaults + migration + encryption + quota
 * - getSettings/setSettings double impl and rawEncrypted flag are removed
 * - re-encrypt side effect is via Port inside getAll, not direct chrome.storage
 * - optimisticLock is chrome-specific inside Settings layer; InMemory does not mimic version
 */

import { StorageKeys, type StorageKey, type Settings as SettingsType, type SqliteHealthCheck } from './types.js';
import { STORAGE_KEY_VALUES, restoreLatestSettingsBackup } from './settingsBackup.js';
import { ChromeStoragePort, InMemoryStoragePort, type StoragePort } from './storagePort.js';
// Static import (PBI 2026-10-16-12): no import cycle — none of
// settingsMigration's transitive deps import SettingsRepository back.
import { applyMigrationsAndDecryptWithReEncrypt, isSettingsBlobAuthoritative, API_KEY_FIELDS } from './settingsMigration.js';
import { StorageTransaction, deepEqual, type CasRetryOptions } from './storageTransaction.js';
import { ErrorCode } from '../logger/types.js';
import { logError } from '../logger/api.js';
import { errorMessage } from '../errorUtils.js';

/** Options forwarded to the storage write path. */
export interface SettingsWriteOptions {
  sqliteHealthCheck?: SqliteHealthCheck;
  /**
   * Called once when the write landed after coalescing at least one CAS
   * conflict — the updater (or delta) was re-applied on the re-derived fresh
   * base. Callers surface it so a coalesced save never reports a silent
   * success (PBI 2026-10-18-12, Scenario 5).
   */
  onConflictCoalesced?: () => void;
}

/** @deprecated Use StoragePort — kept for migration compat */
export type StorageAdapter = StoragePort;

/** Re-export Port impls under legacy Adapter names for backward compat */
export class ChromeStorageAdapter extends ChromeStoragePort implements StoragePort {}
export class InMemoryStorageAdapter extends InMemoryStoragePort implements StoragePort {}

/** Options for SettingsRepository construction */
export interface SettingsRepositoryOptions {
  /** Injected KeyProvider for decrypt/re-encrypt; defaults to getOrCreateEncryptionKey */
  keyProvider?: () => Promise<CryptoKey>;
}

/**
 * Deep repository: one seam (StoragePort), typed keys, defaults + validation inside.
 */
export class SettingsRepository {
  private port: StoragePort;
  private keyProvider: (() => Promise<CryptoKey>) | undefined;
  private cached: { data: SettingsType; timestamp: number; epoch: number } | null = null;
  /**
   * Monotonic invalidation counter, advanced by every completed write and by
   * every observed 'settings' change. A getAll() stamps its cache entry with
   * the epoch captured before its read, so a write landing inside the read's
   * async window invalidates the entry even when the assignment lands after
   * the write's post-drop — ordering alone cannot close that interleave,
   * because the stale assignment has no ordering handle on the write.
   */
  private writeEpoch = 0;
  private readonly CACHE_TTL = 1000;

  constructor(port: StoragePort = new ChromeStoragePort(), opts?: SettingsRepositoryOptions) {
    this.port = port;
    this.keyProvider = opts?.keyProvider;
  }

  /**
   * Resolve KeyProvider lazily to avoid circular import at top-level.
   */
  private async resolveKeyProvider(): Promise<() => Promise<CryptoKey>> {
    if (this.keyProvider) return this.keyProvider;
    const { getOrCreateEncryptionKey } = await import('./encryptionSession.js');
    return getOrCreateEncryptionKey;
  }

  /**
   * Spread `patch` over the blob read fresh under the write lock, so keys the
   * patch does not mention keep their stored values.
   */
  private mergeSettingsBlob(base: unknown, patch: Record<string, unknown>): SettingsType {
    const current = (base as Record<string, unknown>) || {};
    return { ...(current as object), ...patch } as SettingsType;
  }

  /**
   * The single settings write path: merge a delta under the write lock and drop
   * the repo cache around it.
   *
   * WHY: every write funnels through here so the delta-write contract (see
   * setAll) has one implementation — a full cached snapshot in the payload
   * would revert keys a concurrent writer changed.
   *
   * WHY the cache is dropped on both sides: a concurrent getAll() during the
   * merge window would otherwise re-populate it with the pre-write snapshot,
   * and the post-write drop is what keeps that snapshot from being served.
   *
   * WHY the epoch also advances: the drops alone cannot close the interleave
   * where a getAll() that started earlier assigns its pre-write snapshot after
   * both drops land. The epoch stamp invalidates such an entry on the next
   * cache hit instead.
   */
  private async persistMerged(patch: Record<string, unknown>, opts?: SettingsWriteOptions): Promise<void> {
    this.cached = null;
    const tx = new StorageTransaction(this.port);
    // The retry diagnostic is the CAS's own signal that a conflict was
    // detected and the merge re-ran on the re-derived base (Scenario 5).
    let coalescedConflict = false;
    await tx.withLock<SettingsType>('settings', (current) => this.mergeSettingsBlob(current, patch), {
      onRetryDiagnostic: (msg) => {
        if (msg.endsWith('retrying')) coalescedConflict = true;
      },
    });
    this.writeEpoch++;
    this.cached = null;
    if (coalescedConflict) opts?.onConflictCoalesced?.();
  }

  /**
   * Persist re-encryption results without carrying a patch generation across
   * the lock (PBI 2026-10-18-12): `reEncrypted` maps each field to the value
   * the migration produced from the read snapshot `source` — it is a map of
   * TRANSFORMED VALUES, not a map of intents. Inside the lock the current blob
   * is re-read, and a transformed value is written only while the stored field
   * still holds the exact value the transform was derived from. A field a
   * concurrent writer already changed is left untouched: that writer encrypted
   * it with the current KDF, so it needs no re-encryption. Merging the
   * captured value itself is what used to revert a committed credential save.
   */
  private async persistReEncrypted(reEncrypted: Record<string, unknown>, source: SettingsType): Promise<void> {
    if (Object.keys(reEncrypted).length === 0) return;
    this.cached = null;
    const tx = new StorageTransaction(this.port);
    await tx.withLock<SettingsType>('settings', (current) => this.mergeReEncryptedBlob(current, reEncrypted, source));
    this.writeEpoch++;
    this.cached = null;
  }

  /**
   * Value-level CAS merge: a re-encryption result applies only to the stored
   * value it was derived from. `reEncrypted` holds transformed values keyed by
   * field; `source` is the read snapshot they were derived from. A field whose
   * current value differs keeps whatever the concurrent writer stored.
   */
  private mergeReEncryptedBlob(current: unknown, reEncrypted: Record<string, unknown>, source: SettingsType): SettingsType {
    const base = (current as Record<string, unknown>) || {};
    const next: Record<string, unknown> = { ...base };
    const derivedFrom = source as Record<string, unknown>;
    for (const field of Object.keys(reEncrypted)) {
      const original = derivedFrom[field];
      if (original !== undefined && deepEqual(base[field], original)) {
        next[field] = reEncrypted[field];
      }
    }
    return next as SettingsType;
  }

  /**
   * Read-modify-write for the DOMAIN_WHITELIST array: the updater receives the
   * whitelist read fresh under the write lock, so an add that raced another
   * context's add cannot wipe it (PBI 2026-10-18-12, Scenario 4). The CAS
   * retry re-runs the updater on the re-derived base, so two concurrent adds
   * both survive; keep the updater pure and idempotent (see
   * StorageTransaction.withLock). The lock-time current is coerced to an
   * array: a blob written before the whitelist key existed reads as undefined.
   */
  async updateDomainWhitelist(
    updater: (current: string[]) => string[],
    options?: CasRetryOptions
  ): Promise<{ whitelist: string[]; changed: boolean }> {
    this.cached = null;
    const tx = new StorageTransaction(this.port);
    let changed = false;
    let whitelist: string[] = [];
    // The whitelist lives inside the settings blob, so the lock guards the
    // whole blob and the updater operates on its DOMAIN_WHITELIST array.
    await tx.withLock<SettingsType>('settings', (current) => {
      const base = (current as Record<string, unknown>) || {};
      const stored = base[StorageKeys.DOMAIN_WHITELIST];
      const currentList = Array.isArray(stored) ? (stored as string[]) : [];
      const nextList = updater(currentList);
      changed = !deepEqual(currentList, nextList);
      whitelist = nextList;
      return { ...base, [StorageKeys.DOMAIN_WHITELIST]: nextList } as SettingsType;
    }, options);
    this.writeEpoch++;
    this.cached = null;
    return { whitelist, changed };
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
    // Captured before the first await: any write completing below advances the
    // epoch, so the entry assigned at the tail can never be served as current.
    const readEpoch = this.writeEpoch;
    const now = Date.now();
    if (this.cached && this.cached.epoch === this.writeEpoch && (now - this.cached.timestamp) < this.CACHE_TTL) {
      return this.cached.data;
    }
    const keyProvider = await this.resolveKeyProvider();

    // Unified read via Port (no direct chrome.storage). The master-password
    // flag rides along in the same call so the decrypt fallback below never
    // needs its own storage read.
    const result = await this.port.get(['settings', 'settings_migrated', StorageKeys.MASTER_PASSWORD_ENABLED]) as Record<string, unknown>;
    const masterFlag = { isMasterPasswordEnabled: Boolean(result[StorageKeys.MASTER_PASSWORD_ENABLED]) };

    let migratedResult: SettingsType;
    // A partial migration stage is truthy but not authoritative: reading the blob
    // alone there would hide raw keys the migration has not folded in yet, so
    // those states fall back to the scattered-key merge below.
    if (result['settings'] && isSettingsBlobAuthoritative(result['settings_migrated'])) {
      let settings = result['settings'] as SettingsType;
      if (Object.keys(settings as Record<string, unknown>).length === 0) {
        const recovered = await restoreLatestSettingsBackup(this.port);
        if (recovered) settings = recovered as SettingsType;
      }
      const filtered = {} as SettingsType;
      for (const [k, v] of Object.entries(settings as Record<string, unknown>)) {
        if (STORAGE_KEY_VALUES.has(k)) (filtered as Record<string, unknown>)[k] = v;
      }
      const { settings: migrated, reEncrypted } = await applyMigrationsAndDecryptWithReEncrypt(filtered, { getEncryptionKey: keyProvider, ...masterFlag });
      if (Object.keys(reEncrypted).length > 0) {
        await this.persistReEncrypted(reEncrypted, filtered);
      }
      migratedResult = migrated;
    } else {
      migratedResult = await this.__getAllScatteredFallback(result['settings'] as SettingsType | undefined, keyProvider);
    }
    this.cached = { data: migratedResult, timestamp: Date.now(), epoch: readEpoch };
    return migratedResult;
  }

  /**
   * @internal Test-only seam for the legacy scattered-key migration path.
   * Normal production code always writes a single `settings` object,
   * so this path is unreachable after first migration. Exposed only so
   * migration tests can exercise it without touching private internals.
   */
  async __getAllScatteredFallback(
    rawSettings: SettingsType | undefined,
    keyProvider: () => Promise<CryptoKey>
  ): Promise<SettingsType> {
    // Scattered fallback (legacy pre-migration path) — also via Port.
    // STORAGE_KEY_VALUES covers every StorageKeys value, so the scattered
    // read already carries the master-password flag: no extra storage read.
    const keysToGet: string[] = [...STORAGE_KEY_VALUES];
    let scattered = await this.port.get(keysToGet) as Record<string, unknown>;
    if (rawSettings) scattered = { ...scattered, ...(rawSettings as Record<string, unknown>) };
    const { settings: migrated, reEncrypted } = await applyMigrationsAndDecryptWithReEncrypt(scattered as SettingsType, {
      getEncryptionKey: keyProvider,
      isMasterPasswordEnabled: Boolean(scattered[StorageKeys.MASTER_PASSWORD_ENABLED]),
    });
    if (Object.keys(reEncrypted).length > 0) {
      await this.persistReEncrypted(reEncrypted, scattered as SettingsType);
    }
    return migrated;
  }

  clearCache(): void {
    this.cached = null;
  }

  async set<K extends StorageKey>(key: K, value: SettingsType[K]): Promise<void> {
    // Delta write (PBI 2026-09-17-17): only this key enters the write payload.
    // Spreading getAll() here used to carry repo-cache staleness into storage
    // and silently revert unrelated keys a concurrent writer had changed.
    await this.writeSettings({ [key]: value } as Partial<SettingsType>);
  }

  /**
   * Write the given keys as a delta: unspecified keys keep their stored
   * values, re-read fresh under the write lock at save time. Do NOT pass a
   * full cached snapshot — its unrelated keys would overwrite concurrent
   * writers' changes with stale values.
   *
   * Patch generation must not be carried across the lock (PBI 2026-10-18-12):
   * a patch whose content was captured from a read taken before the lock is
   * re-merged as-is when the CAS retries, so the retry lands the same stale
   * patch on the fresh base and the conflict detection cannot help. The write
   * path therefore accepts two shapes only:
   *   - a delta of user-intent values (this method — the values ARE the
   *     intent, e.g. the form's input or an encrypted caller value), and
   *   - an updater applied to the lock-internal current blob
   *     (updateDomainWhitelist / persistReEncrypted).
   * A re-encryption style patch that re-derives stored state must go through
   * the updater shape; full-payload replacement stays the intended exception
   * for settings import / backup restore (see settingsBackup.ts).
   */
  async setAll(settings: Partial<SettingsType>, opts?: SettingsWriteOptions): Promise<void> {
    await this.writeSettings(settings, opts);
  }

  private async writeSettings(delta: Partial<SettingsType>, opts?: SettingsWriteOptions): Promise<void> {
    const { encryptApiKey } = await import('../crypto/index.js');
    const { ensureStorageQuota } = await import('./storageMaintenance.js');
    let toSave: Record<string, unknown> = { ...(delta as Record<string, unknown>) };
    const keyProvider = await this.resolveKeyProvider();
    try {
      const key = await keyProvider();
      for (const field of API_KEY_FIELDS) {
        const val = toSave[field];
        if (typeof val === 'string' && val !== '') {
          toSave[field] = await encryptApiKey(val, key, field);
        }
      }
    } catch (e) {
      await logError('Failed to encrypt API keys', { error: errorMessage(e as Error) }, ErrorCode.CRYPTO_ENCRYPTION_FAILURE);
      throw e;
    }
    await ensureStorageQuota(toSave, opts?.sqliteHealthCheck);
    await this.persistMerged(toSave, opts);
  }

  /**
   * Subscribe to settings changes. The panel lifecycle can use this
   * instead of chrome.storage.onChanged directly, keeping the storage seam
   * in one module.
   */
  onChange(callback: (changes: Partial<SettingsType>) => void): void {
    this.observe(callback);
  }

  /**
   * Primary observe API — typed key only, via StoragePort.
   */
  observe(callback: (changes: Partial<SettingsType>) => void): void {
    this.port.onChanged?.((changes) => {
      if ('settings' in changes) {
        // Same invalidation the write path performs: an in-flight getAll()
        // that assigns after this drop must not serve the pre-change snapshot.
        this.writeEpoch++;
        this.cached = null;
        callback(changes['settings'] as Partial<SettingsType>);
      }
    });
  }

  /** Compat for legacy clearSettingsCache — clears repo cache */
  clearSettingsCache(): void {
    this.clearCache();
  }

  /** Expose underlying port for advanced uses / testing */
  getPort(): StoragePort {
    return this.port;
  }
}

export type SettingsReader = Pick<SettingsRepository, 'getMany' | 'getAll'>;

export const settingsRepository = new SettingsRepository();

/** Re-export StoragePort types for external import paths */
export type { StoragePort } from './storagePort.js';
export { ChromeStoragePort, InMemoryStoragePort } from './storagePort.js';
