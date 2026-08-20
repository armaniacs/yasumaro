// @layer 2 — High-level Utilities: trust decision seam (deep module, hides 4-module往復)
// TrustDecision — deep module hiding the 4-module往復 for trust judgement
//
// trustDb → permissionManager → ManagedStringList → domainUtils → extractDomain
// の分散した seam を `isTrusted(url) → Decision` の1 seam に集約。
// 呼び出し元は TrustDecision のみを知れば良い。

import { getTrustDb } from './trustDb.js';
import { PermissionManager, getPermissionManager } from '../permissionManager.js';
import { extractDomain } from '../domainUtils.js';
import { DomainTrustLevel } from './trustDbSchema.js';
import type { TrustResult } from './trustDbSchema.js';

export interface TrustDecisionResult {
  trusted: boolean;
  reason: string;
  level?: string;
  source?: string;
  trustResult?: TrustResult;
}

export class TrustDecision {
  private trustDb: ReturnType<typeof getTrustDb>;
  private permissionManager: PermissionManager;

  constructor(
    trustDb: ReturnType<typeof getTrustDb> = getTrustDb(),
    permissionManager: PermissionManager = getPermissionManager()
  ) {
    this.trustDb = trustDb;
    this.permissionManager = permissionManager;
  }

  /**
   * Deep seam: 1 method hides 4-module往復
   * - extractDomain via domainUtils
   * - permission check via PermissionManager
   * - trust check via TrustDb (BloomFilter + presets + Tranco)
   */
  async isTrusted(url: string): Promise<TrustDecisionResult> {
    const domain = extractDomain(url);
    if (!domain) {
      return { trusted: false, reason: 'invalid_domain' };
    }

    // PermissionManager check first (explicit user deny)
    try {
      const permitted = await this.permissionManager.isHostPermitted(domain);
      if (!permitted) {
        return { trusted: false, reason: 'permission_denied', level: 'denied' };
      }
    } catch {
      // Permission check failure → fall through to trust check
    }

    // TrustDb check (Tranco / presets / user lists)
    try {
      await this.trustDb.initialize();
      const result = this.trustDb.isDomainTrusted(domain);
      const isTrusted = result.level === DomainTrustLevel.TRUSTED || result.level === DomainTrustLevel.SENSITIVE;
      return {
        trusted: isTrusted,
        reason: result.reason || result.source,
        level: result.level,
        source: result.source,
        trustResult: result,
      };
    } catch {
      return { trusted: false, reason: 'trust_check_failed' };
    }
  }

  /**
   * Allowlist / blocklist helpers — also deep seam, hides ManagedStringList
   */
  async addToAllowlist(domain: string): Promise<{ success: boolean; error?: string }> {
    await this.trustDb.initialize();
    return this.trustDb.addToWhitelist(domain);
  }

  async addToBlocklist(domain: string): Promise<{ success: boolean; error?: string }> {
    await this.trustDb.initialize();
    return this.trustDb.addSensitiveDomain(domain);
  }
}

export const trustDecision = new TrustDecision();
