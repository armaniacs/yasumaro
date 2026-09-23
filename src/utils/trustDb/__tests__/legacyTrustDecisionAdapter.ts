// Test-only adapter: rebuilds the removed legacy 2-arg
// TrustDecision(mockDb, mockPermission) signature on top of the strict
// (admin, permissionManager) constructor. Production code must not use this.

import { TrustDecision } from '../TrustDecision.js';
import type { TrustDbAdmin } from '../TrustDbAdmin.js';
import type { TrustPolicy } from '../TrustPolicy.js';
import type { PermissionManager } from '../../permissionManager.js';
import type { TrustResult } from '../trustDbSchema.js';

export interface LegacyMockDb {
  initialize: () => Promise<void>;
  isDomainTrusted: (domain: string) => TrustResult;
  isTrancoDomain?: (domain: string) => boolean;
  addToWhitelist: (domain: string) => Promise<{ success: boolean; error?: string }>;
  addSensitiveDomain: (domain: string) => Promise<{ success: boolean; error?: string }>;
}

export function createLegacyTrustDecision(mockDb: LegacyMockDb, mockPermission: PermissionManager): TrustDecision {
  const policy = {
    isDomainTrusted: mockDb.isDomainTrusted.bind(mockDb),
    isTrancoDomain: mockDb.isTrancoDomain?.bind(mockDb) ?? (() => false),
  } as unknown as TrustPolicy;
  const admin = {
    initialize: mockDb.initialize.bind(mockDb),
    getPolicy: () => policy,
    addToWhitelist: mockDb.addToWhitelist.bind(mockDb),
    addSensitiveDomain: mockDb.addSensitiveDomain.bind(mockDb),
    isDomainTrusted: mockDb.isDomainTrusted.bind(mockDb),
  } as unknown as TrustDbAdmin;
  return new TrustDecision(admin, mockPermission);
}
