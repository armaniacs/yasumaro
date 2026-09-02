// @layer 1 — Infrastructure (see ADR 2026-08-20; cycle now broken via SettingsRepository)
/**
 * trustDb.ts — Compatibility shim plus two-seam exposure.
 * Decomposed into:
 * - TrustDbKernel  — lifecycle + single chrome.storage read
 * - TrustPolicy    — readonly seam isDomainTrusted/isTrancoDomain (no storage)
 * - ManagedCollections — userTlds/sensitive/whitelist
 * - TrustDbAdmin   — mutation seam (addToWhitelist, updateTranco, save)
 * Readonly callers should use TrustPolicy; mutation callers use TrustDbAdmin.
 * This shim keeps getTrustDb() for backward compat.
 */

import type { TrustResult, TrustDatabase } from './trustDbSchema.js';
import { TrustDbKernel } from './TrustDbKernel.js';
import { TrustPolicy } from './TrustPolicy.js';
import { TrustDbAdmin } from './TrustDbAdmin.js';

export class TrustDb {
  private readonly kernel: TrustDbKernel;

  constructor() {
    this.kernel = new TrustDbKernel();
  }

  // Back-compat: tests poke (db as any).state directly and expect a mutable object.
  get state(): ReturnType<TrustDbKernel['_getState']> {
    return this.kernel._getState();
  }
  set state(v: ReturnType<TrustDbKernel['_getState']>) {
    this.kernel._setState(v);
  }

  // Back-compat: tests access (db as any).constructor.initPromise and static field
  static get initPromise(): Promise<void> | null {
    return TrustDbKernel.initPromise;
  }
  static set initPromise(v: Promise<void> | null) {
    TrustDbKernel.initPromise = v;
  }

  // For pipelineErrorRegression repairDatabase direct call
  repairDatabase(db: Record<string, unknown>): void {
    this.kernel.repairDatabase(db);
  }

  // Lifecycle
  async initialize(): Promise<void> { return this.kernel.initialize(); }
  async save(): Promise<void> { return this.kernel.save(); }

  // Trust seam
  isDomainTrusted(domain: string): TrustResult { return this.kernel.isDomainTrusted(domain); }
  isTrancoDomain(domain: string): boolean { return this.kernel.isTrancoDomain(domain); }

  // Tranco
  async updateTranco(domains: string[], tier: string): Promise<void> { return this.kernel.updateTranco(domains, tier); }

  // Collections
  async addUserTld(tld: string): Promise<{ success: boolean; error?: string }> { return this.kernel.addUserTld(tld); }
  async removeUserTld(tld: string): Promise<{ success: boolean; error?: string }> { return this.kernel.removeUserTld(tld); }
  getVersion(): string { return this.kernel.getVersion(); }
  getStatus(): ReturnType<TrustDbKernel['getStatus']> { return this.kernel.getStatus(); }
  getDatabase(): TrustDatabase | null { return this.kernel.getDatabase(); }
  getJpAnchorTlds(): string[] { return this.kernel.getJpAnchorTlds(); }
  async addJpAnchorTld(tld: string): Promise<{ success: boolean; error?: string }> { return this.kernel.addJpAnchorTld(tld); }
  async removeJpAnchorTld(tld: string): Promise<{ success: boolean; error?: string }> { return this.kernel.removeJpAnchorTld(tld); }
  getSensitiveDomains(category: 'finance' | 'gaming' | 'sns'): string[] { return this.kernel.getSensitiveDomains(category); }
  async addSensitiveDomain(domain: string, _category?: string): Promise<{ success: boolean; error?: string }> { return this.kernel.addSensitiveDomain(domain); }
  async removeSensitiveDomain(domain: string): Promise<{ success: boolean; error?: string }> { return this.kernel.removeSensitiveDomain(domain); }
  getWhitelist(): string[] { return this.kernel.getWhitelist(); }
  async addToWhitelist(domain: string): Promise<{ success: boolean; error?: string }> { return this.kernel.addToWhitelist(domain); }
  async removeFromWhitelist(domain: string): Promise<{ success: boolean; error?: string }> { return this.kernel.removeFromWhitelist(domain); }

  // Tranco version tracking
  getCurrentTrancoVersion(): string { return this.kernel.getCurrentTrancoVersion(); }
  async getSavedTrancoVersion(): Promise<string | null> { return this.kernel.getSavedTrancoVersion(); }
  async updateTrancoVersion(version: string, domains: string[]): Promise<void> { return this.kernel.updateTrancoVersion(version, domains); }
  async checkTrancoUpdate(): Promise<{ hasUpdate: boolean; oldVersion: string | null; newVersion: string }> { return this.kernel.checkTrancoUpdate(); }
  async getSavedTrancoDomains(): Promise<string[]> { return this.kernel.getSavedTrancoDomains(); }

  // Two-seam exposure (PBI 04)
  getPolicy(): TrustPolicy { return this.kernel.getPolicy(); }
  getAdmin(): TrustDbAdmin { return new TrustDbAdmin(this.kernel); }
}

let trustDbInstance: TrustDb | null = null;

export function getTrustDb(): TrustDb {
  if (!trustDbInstance) {
    trustDbInstance = new TrustDb();
  }
  return trustDbInstance;
}

let trustPolicyInstance: TrustPolicy | null = null;
export function getTrustPolicy(): TrustPolicy {
  if (!trustPolicyInstance) {
    trustPolicyInstance = getTrustDb().getPolicy();
  }
  return trustPolicyInstance;
}

let trustAdminInstance: TrustDbAdmin | null = null;
export function getTrustDbAdmin(): TrustDbAdmin {
  if (!trustAdminInstance) {
    trustAdminInstance = getTrustDb().getAdmin();
  }
  return trustAdminInstance;
}

export async function isDomainTrusted(domain: string): Promise<TrustResult> {
  const db = getTrustDb();
  await db.initialize();
  return db.isDomainTrusted(domain);
}
