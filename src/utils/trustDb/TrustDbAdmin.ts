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
import { StorageKeys } from '../storage/types.js';

export const TRUST_DB_STORAGE_KEY = StorageKeys.TRUST_DB;

export class TrustDbAdmin {
  constructor(private readonly kernel: TrustDbKernel) {}

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
  addSensitiveDomain(domain: string): Promise<{ success: boolean; error?: string }> {
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
