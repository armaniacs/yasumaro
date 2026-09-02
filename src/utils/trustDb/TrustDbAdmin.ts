// @layer 1 — TrustDbAdmin deep module (mutation seam)
/**
 * TrustDbAdmin — mutation seam for TrustDb.
 * Hides ManagedCollections, updateTranco, version tracking behind a small interface.
 * Readonly checks live on TrustPolicy; this module owns writes.
 * Persistence key (StorageKeys.TRUST_DB) is owned by storage layer and re-exported
 * here as the Admin seam's StoragePort key — Kernel consumes it via StorageKeys,
 * breaking the hardcoded string-key cycle.
 */

import type { TrustDbKernel } from './TrustDbKernel.js';
import { TrustDbKernel as TrustDbKernelClass } from './TrustDbKernel.js';
import { StorageKeys } from '../storage/types.js';

export const TRUST_DB_STORAGE_KEY = StorageKeys.TRUST_DB;

export class TrustDbAdmin {
  constructor(private readonly kernel: TrustDbKernel) {}

  // --- Lifecycle (owns StoragePort) ---
  async initialize(): Promise<void> {
    return this.kernel.initialize();
  }

  // --- Readonly delegation (share kernel state; storage-free check still via Policy) ---
  isDomainTrusted(domain: string): ReturnType<TrustDbKernel['isDomainTrusted']> {
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
}

// --- Singleton seam (mutation, owns StoragePort via StorageKeys.TRUST_DB) ---
let _adminInstance: TrustDbAdmin | null = null;

export function getTrustDbAdmin(): TrustDbAdmin {
  const g = (globalThis as unknown as Record<string, unknown>).__trustDbInstance as { getAdmin?: () => TrustDbAdmin } | undefined;
  if (g?.getAdmin) {
    const shared = g.getAdmin();
    _adminInstance = shared;
    return shared;
  }
  const gk = (globalThis as unknown as Record<string, unknown>).__trustDbKernel as TrustDbKernel | undefined;
  if (gk) {
    if (_adminInstance) return _adminInstance;
    _adminInstance = new TrustDbAdmin(gk);
    return _adminInstance;
  }
  if (_adminInstance) return _adminInstance;
  const kernel = new TrustDbKernelClass();
  (globalThis as unknown as Record<string, unknown>).__trustDbKernel = kernel;
  _adminInstance = new TrustDbAdmin(kernel);
  return _adminInstance;
}

export function _resetTrustDbAdminForTest(): void {
  _adminInstance = null;
}
