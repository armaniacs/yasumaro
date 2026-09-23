// @layer 2 — TrustLookup: single async seam for trust lookup + alert decision
// checkDomain and getTrustLevelDisplay are both adapters over lookup()/decideAlert(),
// so the TrustDecision leg and the admin+policy fallback leg can no longer diverge
// between the two paths. Display colors/icons live in TRUST_DISPLAY_TABLE (not inline).

import type { TrustResult } from './trustDbSchema.js';
import { DomainTrustLevel } from './trustDbSchema.js';
import { getTrustDbAdmin } from './TrustDbAdmin.js';
import { getTrustPolicy } from './TrustPolicy.js';

export interface TrustDisplay {
  color: string;
  icon: string;
  label: string;
}

export interface TrustLookupResult {
  level: DomainTrustLevel;
  source: string;
  category?: TrustResult['category'];
  display: TrustDisplay;
  trustResult: TrustResult;
}

export interface AlertFlags {
  alertFinance: boolean;
  alertSensitive: boolean;
  alertUnverified: boolean;
}

export interface AlertDecision {
  showAlert: boolean;
  canProceed: boolean;
  reason?: string;
}

// Single display table (moved out of TrustChecker.getTrustLevelDisplay inline literal).
// Unknown levels fall back to the unverified style with an upper-cased label.
const TRUST_DISPLAY_TABLE: Record<string, { color: string; icon: string; label: string }> = {
  [DomainTrustLevel.TRUSTED]: { color: '#10b981', icon: '🟢', label: 'TRUSTED' },
  [DomainTrustLevel.SENSITIVE]: { color: '#f59e0b', icon: '🟡', label: 'SENSITIVE' },
  [DomainTrustLevel.UNVERIFIED]: { color: '#94a3b8', icon: '⚪', label: 'UNVERIFIED' },
  [DomainTrustLevel.LOCKED]: { color: '#6b7280', icon: '🔒', label: 'LOCKED' },
};

function toDisplay(level: string): TrustDisplay {
  const entry = TRUST_DISPLAY_TABLE[level];
  if (entry) return { ...entry };
  return { color: '#94a3b8', icon: '⚪', label: level.toUpperCase() };
}

/**
 * Single async trust seam. Resolution order mirrors the former
 * TrustChecker.checkDomain flow so both adapters judge identically:
 * TrustDecision (permission leg + policy) → admin+policy fallback → UNVERIFIED.
 */
export async function lookup(url: string): Promise<TrustLookupResult> {
  let trustResult: TrustResult;
  try {
    // Dynamic import keeps the await-import discipline (no new static edge into TrustDecision).
    const { TrustDecision } = await import('./TrustDecision.js');
    const decision = await new TrustDecision().isTrusted(url);
    if (decision.trustResult) {
      trustResult = decision.trustResult;
    } else {
      const admin = getTrustDbAdmin();
      await admin.initialize();
      trustResult = await getTrustPolicy().isDomainTrusted(url);
    }
  } catch {
    try {
      const admin = getTrustDbAdmin();
      await admin.initialize();
      trustResult = await getTrustPolicy().isDomainTrusted(url);
    } catch {
      trustResult = { level: DomainTrustLevel.UNVERIFIED, source: 'unknown', reason: 'trust_check_failed' };
    }
  }

  return {
    level: trustResult.level,
    source: trustResult.source,
    category: trustResult.category,
    display: toDisplay(trustResult.level),
    trustResult,
  };
}

function shouldShowAlert(level: DomainTrustLevel, category: TrustResult['category'], flags: AlertFlags): boolean {
  if (level === DomainTrustLevel.TRUSTED) {
    return false;
  }
  if (level === DomainTrustLevel.SENSITIVE && category) {
    if (category === 'finance') {
      return flags.alertFinance;
    }
    return flags.alertSensitive;
  }
  if (level === DomainTrustLevel.UNVERIFIED) {
    return flags.alertUnverified;
  }
  return false;
}

function blockReason(level: DomainTrustLevel, category: TrustResult['category']): string {
  if (level === DomainTrustLevel.UNVERIFIED) {
    return 'Unverified domain - recording blocked';
  }
  if (level === DomainTrustLevel.SENSITIVE && category === 'finance') {
    return 'Financial site - recording blocked';
  }
  if (level === DomainTrustLevel.SENSITIVE) {
    return `Sensitive site (${category}) - recording blocked`;
  }
  return 'Trust check failed - recording blocked';
}

/**
 * Single alert matrix (4 levels × 3 flags). Invariants preserved:
 * locked always blocks; every other level never blocks (badge-only).
 */
export function decideAlert(
  found: Pick<TrustLookupResult, 'level' | 'category'>,
  flags: AlertFlags,
): AlertDecision {
  if (found.level === DomainTrustLevel.LOCKED) {
    return { showAlert: false, canProceed: false, reason: blockReason(found.level, found.category) };
  }
  return { showAlert: shouldShowAlert(found.level, found.category, flags), canProceed: true };
}
