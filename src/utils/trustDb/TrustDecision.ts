// @layer 2 — High-level Utilities: trust decision seam (deep module, hides 4-module往復)
// TrustDecision — deep module hiding the 4-module往復 for trust judgement
//
// trustDb → permissionManager → ManagedStringList → domainUtils → extractDomain
// の分散した seam を `isTrusted(url) → Decision` の1 seam に集約。
// 呼び出し元は TrustDecision のみを知れば良い。

import { getTrustDbAdmin } from './TrustDbAdmin.js';
import type { TrustPolicy } from './TrustPolicy.js';
import type { TrustDbAdmin } from './TrustDbAdmin.js';
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
  // policy is not cached — always looked up via admin.getPolicy() to avoid stale orphan
  private admin: TrustDbAdmin;
  private permissionManager: PermissionManager;

  private get policy(): TrustPolicy {
    return this.admin.getPolicy();
  }

  constructor(
    admin: TrustDbAdmin = getTrustDbAdmin(),
    permissionManager: PermissionManager = getPermissionManager()
  ) {
    this.admin = admin;
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

    // TrustDb check (Tranco / presets / user lists) — readonly via Policy, lifecycle via Admin
    try {
      await this.admin.initialize();
      const result = this.policy.isDomainTrusted(domain);
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
    await this.admin.initialize();
    return this.admin.addToWhitelist(domain);
  }

  async addToBlocklist(domain: string): Promise<{ success: boolean; error?: string }> {
    await this.admin.initialize();
    return this.admin.addSensitiveDomain(domain);
  }
}

export const trustDecision = new TrustDecision();
