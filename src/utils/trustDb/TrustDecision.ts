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
  private _legacyPolicy: TrustPolicy | null = null;
  private admin: TrustDbAdmin;
  private permissionManager: PermissionManager;

  private get policy(): TrustPolicy {
    if (this._legacyPolicy) return this._legacyPolicy;
    return this.admin.getPolicy();
  }

  constructor(
    policy?: TrustPolicy,
    admin: TrustDbAdmin = getTrustDbAdmin(),
    permissionManager: PermissionManager = getPermissionManager()
  ) {
    const maybeLegacy = policy as unknown as {
      getPolicy?: () => TrustPolicy;
      getAdmin?: () => TrustDbAdmin;
      isDomainTrusted?: (d: string) => TrustResult;
      addToWhitelist?: (d: string) => Promise<{ success: boolean; error?: string }>;
      initialize?: () => Promise<void>;
    };
    // Legacy 2-arg signature: new TrustDecision(mockDb, mockPermission)
    if (
      maybeLegacy &&
      typeof maybeLegacy.isDomainTrusted === 'function' &&
      typeof maybeLegacy.addToWhitelist === 'function'
    ) {
      const legacy = maybeLegacy as unknown as {
        isDomainTrusted: (d: string) => TrustResult;
        isTrancoDomain?: (d: string) => boolean;
        initialize: () => Promise<void>;
        addToWhitelist: (d: string) => Promise<{ success: boolean; error?: string }>;
        addSensitiveDomain: (d: string) => Promise<{ success: boolean; error?: string }>;
      };
      this._legacyPolicy = {
        isDomainTrusted: legacy.isDomainTrusted.bind(legacy),
        isTrancoDomain: (legacy.isTrancoDomain?.bind(legacy) ?? (() => false)) as TrustPolicy['isTrancoDomain'],
      } as unknown as TrustPolicy;
      this.admin = {
        initialize: legacy.initialize.bind(legacy),
        addToWhitelist: legacy.addToWhitelist.bind(legacy),
        addSensitiveDomain: legacy.addSensitiveDomain.bind(legacy),
        isDomainTrusted: legacy.isDomainTrusted.bind(legacy),
      } as unknown as TrustDbAdmin;
      // second arg is actually PermissionManager in legacy call
      if (admin && typeof (admin as unknown as PermissionManager).isHostPermitted === 'function') {
        this.permissionManager = admin as unknown as PermissionManager;
      } else {
        this.permissionManager = permissionManager;
      }
      return;
    }
    // Legacy god object with getPolicy/getAdmin
    if (maybeLegacy && typeof maybeLegacy.getPolicy === 'function' && typeof maybeLegacy.getAdmin === 'function') {
      this._legacyPolicy = maybeLegacy.getPolicy();
      this.admin = maybeLegacy.getAdmin();
      this.permissionManager = permissionManager;
      return;
    }
    // Normal path: do not cache policy, look up via admin on each call
    // Keep _legacyPolicy null so getter delegates to admin.getPolicy()
    this._legacyPolicy = null;
    // second arg may be PermissionManager when called with old 2-arg signature and first arg is real Policy
    if (admin && typeof (admin as unknown as PermissionManager).isHostPermitted === 'function') {
      this.admin = getTrustDbAdmin();
      this.permissionManager = admin as unknown as PermissionManager;
      return;
    }
    this.admin = admin as TrustDbAdmin;
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
