// @layer 1 — TrustDbAdmin deep module (mutation seam)
/**
 * TrustDbAdmin — mutation seam for TrustDb.
 * Hides ManagedCollections, updateTranco, version tracking behind a small interface.
 * Readonly checks live on TrustPolicy; this module owns writes.
 * Persistence key (StorageKeys.TRUST_DB) is owned by storage layer and re-exported
 * here as the Admin seam's StoragePort key — Kernel consumes it via StorageKeys,
 * breaking the hardcoded string-key cycle.
 */

import type { TrustResult } from './trustDbSchema.js';
import type { TrustDbKernel } from './TrustDbKernel.js';
import { TrustDbKernel as TrustDbKernelClass } from './TrustDbKernel.js';
import { StorageKeys } from '../storage/types.js';

export const TRUST_DB_STORAGE_KEY = StorageKeys.TRUST_DB;

export class TrustDbAdmin {
  constructor(private readonly kernel: TrustDbKernel) {}

  /** Test-only seam: exposes kernel state for (db as any).state poking */
  get state(): ReturnType<TrustDbKernel['_getState']> {
    return this.kernel._getState();
  }
  set state(v: ReturnType<TrustDbKernel['_getState']>) {
    this.kernel._setState(v);
  }

  /** Convenience: reset initPromise for tests that need re-init */
  static get initPromise(): Promise<void> | null {
    return TrustDbKernelClass.initPromise;
  }
  static set initPromise(v: Promise<void> | null) {
    TrustDbKernelClass.initPromise = v;
  }

  // --- Lifecycle (owns StoragePort) ---
  async initialize(): Promise<void> {
    return this.kernel.initialize();
  }

  // --- Readonly delegation (share kernel state; storage-free check still via Policy) ---
  isDomainTrusted(domain: string): TrustResult {
    return this.kernel.isDomainTrusted(domain);
  }
  isTrancoDomain(domain: string): boolean {
    return this.kernel.isTrancoDomain(domain);
  }
  getStatus(): ReturnType<TrustDbKernel['getStatus']> {
    return this.kernel.getStatus();
  }
  getDatabase(): ReturnType<TrustDbKernel['getDatabase']> {
    return this.kernel.getDatabase();
  }
  getVersion(): string {
    return this.kernel.getVersion();
  }
  getWhitelist(): string[] {
    return this.kernel.getWhitelist();
  }
  getSensitiveDomains(category: 'finance' | 'gaming' | 'sns'): string[] {
    return this.kernel.getSensitiveDomains(category);
  }
  getJpAnchorTlds(): string[] {
    return this.kernel.getJpAnchorTlds();
  }
  getCurrentTrancoVersion(): string {
    return this.kernel.getCurrentTrancoVersion();
  }
  getSavedTrancoVersion(): Promise<string | null> {
    return this.kernel.getSavedTrancoVersion();
  }
  getSavedTrancoDomains(): Promise<string[]> {
    return this.kernel.getSavedTrancoDomains();
  }
  checkTrancoUpdate(): Promise<{ hasUpdate: boolean; oldVersion: string | null; newVersion: string }> {
    return this.kernel.checkTrancoUpdate();
  }

  // Collections mutation
  addUserTld(tld: string): Promise<{ success: boolean; error?: string }> {
    return this.kernel.addUserTld(tld);
  }
  removeUserTld(tld: string): Promise<{ success: boolean; error?: string }> {
    return this.kernel.removeUserTld(tld);
  }
  addJpAnchorTld(tld: string): Promise<{ success: boolean; error?: string }> {
    return this.kernel.addJpAnchorTld(tld);
  }
  removeJpAnchorTld(tld: string): Promise<{ success: boolean; error?: string }> {
    return this.kernel.removeJpAnchorTld(tld);
  }
  addSensitiveDomain(domain: string, _category?: string): Promise<{ success: boolean; error?: string }> {
    return this.kernel.addSensitiveDomain(domain);
  }
  removeSensitiveDomain(domain: string): Promise<{ success: boolean; error?: string }> {
    return this.kernel.removeSensitiveDomain(domain);
  }
  addToWhitelist(domain: string): Promise<{ success: boolean; error?: string }> {
    return this.kernel.addToWhitelist(domain);
  }
  removeFromWhitelist(domain: string): Promise<{ success: boolean; error?: string }> {
    return this.kernel.removeFromWhitelist(domain);
  }

  // Tranco mutation
  updateTranco(domains: string[], tier: string): Promise<void> {
    return this.kernel.updateTranco(domains, tier);
  }
  updateTrancoVersion(version: string, domains: string[]): Promise<void> {
    return this.kernel.updateTrancoVersion(version, domains);
  }

  // Lifecycle mutation
  save(): Promise<void> {
    return this.kernel.save();
  }
  repairDatabase(db: Record<string, unknown>): void {
    return this.kernel.repairDatabase(db);
  }

  /** Expose policy for backward compat and for getTrustPolicy singleton seam */
  getPolicy(): ReturnType<TrustDbKernel['getPolicy']> {
    return this.kernel.getPolicy();
  }
}

// --- Singleton seam (mutation, owns StoragePort via StorageKeys.TRUST_DB) ---
let _adminInstance: TrustDbAdmin | null = null;

export function getTrustDbAdmin(): TrustDbAdmin {
  if (_adminInstance) return _adminInstance;
  const kernel = new TrustDbKernelClass();
  _adminInstance = new TrustDbAdmin(kernel);
  return _adminInstance;
}

export function _resetTrustDbAdminForTest(): void {
  _adminInstance = null;
}

