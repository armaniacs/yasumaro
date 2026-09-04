import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TrustDecision } from '../TrustDecision.js';
import { getTrustPolicy, _resetTrustPolicyForTest } from '../TrustPolicy.js';
import { _resetTrustDbAdminForTest } from '../TrustDbAdmin.js';

function makeTrustDbMock(level: string = 'trusted', source: string = 'preset') {
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    isDomainTrusted: vi.fn().mockReturnValue({ level, source, reason: source }),
    addToWhitelist: vi.fn().mockResolvedValue({ success: true }),
    addSensitiveDomain: vi.fn().mockResolvedValue({ success: true }),
  } as unknown as import('../TrustDbAdmin.js').TrustDbAdmin;
}

function makePermissionMock(permitted: boolean) {
  return {
    isHostPermitted: vi.fn().mockResolvedValue(permitted),
  } as unknown as import('../../permissionManager.js').PermissionManager;
}

describe('TrustDecision — deep module via single seam isTrusted(url)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns trusted true for trusted domain', async () => {
    const td = new TrustDecision(makeTrustDbMock('trusted', 'tranco'), makePermissionMock(true));
    const r = await td.isTrusted('https://example.com/path');
    expect(r.trusted).toBe(true);
    expect(r.level).toBe('trusted');
  });

  it('returns trusted false for permission denied (locality)', async () => {
    const td = new TrustDecision(makeTrustDbMock('trusted'), makePermissionMock(false));
    const r = await td.isTrusted('https://blocked.example.com');
    expect(r.trusted).toBe(false);
    expect(r.reason).toBe('permission_denied');
  });

  it('returns trusted false for unverified', async () => {
    const td = new TrustDecision(makeTrustDbMock('unverified'), makePermissionMock(true));
    const r = await td.isTrusted('https://unknown.example');
    expect(r.trusted).toBe(false);
  });

  it('returns invalid_domain for malformed url', async () => {
    const td = new TrustDecision(makeTrustDbMock(), makePermissionMock(true));
    const r = await td.isTrusted('not-a-url');
    expect(r.trusted).toBe(false);
    expect(r.reason).toBe('invalid_domain');
  });

  it('addToAllowlist delegates to TrustDb via seam', async () => {
    const mockDb = makeTrustDbMock();
    const td = new TrustDecision(mockDb, makePermissionMock(true));
    const res = await td.addToAllowlist('example.com');
    expect(res.success).toBe(true);
    expect(mockDb.addToWhitelist).toHaveBeenCalledWith('example.com');
  });

  it('hides 4-module往復 — caller only knows isTrusted', async () => {
    // Caller does not need to know about ManagedStringList, domainUtils, PermissionManager, TrustDb
    // Only TrustDecision is imported
    const td = new TrustDecision(makeTrustDbMock('trusted'), makePermissionMock(true));
    // Single seam call hides all internal modules
    const result = await td.isTrusted('https://example.com');
    expect(result).toHaveProperty('trusted');
    expect(result).toHaveProperty('reason');
  });
});

describe('PBI-02 trust-policy orphan singleton fix', () => {
  let originalKernel: unknown;

  beforeEach(() => {
    originalKernel = (globalThis as unknown as Record<string, unknown>).__trustDbKernel;
    // Clear singleton to simulate not-initialized state
    delete (globalThis as unknown as Record<string, unknown>).__trustDbKernel;
    _resetTrustDbAdminForTest();
    _resetTrustPolicyForTest();
  });

  afterEach(() => {
    if (originalKernel !== undefined) {
      (globalThis as unknown as Record<string, unknown>).__trustDbKernel = originalKernel;
    } else {
      delete (globalThis as unknown as Record<string, unknown>).__trustDbKernel;
    }
    _resetTrustDbAdminForTest();
    _resetTrustPolicyForTest();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('getTrustPolicy() throws when TrustDbKernel is not initialized (no orphan fallback)', () => {
    expect(() => getTrustPolicy()).toThrow('TrustDb not initialized');
    expect(() => getTrustPolicy()).toThrow(/call getTrustDbAdmin\(\)\.initialize\(\) first/);
  });

  it('TrustDecision constructor with no TrustPolicy does not eagerly call admin.getPolicy()', async () => {
    const mockPolicy = {
      isDomainTrusted: vi.fn().mockReturnValue({ level: 'trusted', source: 'preset', reason: 'preset' }),
      isTrancoDomain: vi.fn().mockReturnValue(false),
    };
    const mockAdmin = {
      initialize: vi.fn().mockResolvedValue(undefined),
      getPolicy: vi.fn().mockReturnValue(mockPolicy),
      addToWhitelist: vi.fn().mockResolvedValue({ success: true }),
      addSensitiveDomain: vi.fn().mockResolvedValue({ success: true }),
      isDomainTrusted: vi.fn(),
    } as unknown as import('../TrustDbAdmin.js').TrustDbAdmin;

    const td = new TrustDecision(undefined, mockAdmin, makePermissionMock(true));

    // Constructor must not have called getPolicy eagerly — lazy lookup only on isTrusted
    expect(mockAdmin.getPolicy).not.toHaveBeenCalled();

    // First isTrusted triggers exactly one lookup
    const r = await td.isTrusted('https://example.com');
    expect(r.trusted).toBe(true);
    expect(mockAdmin.getPolicy).toHaveBeenCalledTimes(1);
  });

  it('TrustDecision constructor with no args does not throw even when kernel not initialized', () => {
    // No eager getTrustPolicy() inside constructor — should not throw
    expect(() => new TrustDecision()).not.toThrow();
  });

  it('TrustDecision.isTrusted() uses admin.getPolicy() on each call (not cached) — reflects policy change', async () => {
    const policyA = {
      isDomainTrusted: vi.fn().mockReturnValue({ level: 'trusted', source: 'preset', reason: 'preset' }),
      isTrancoDomain: vi.fn().mockReturnValue(false),
    };
    const policyB = {
      isDomainTrusted: vi.fn().mockReturnValue({ level: 'unverified', source: 'unknown', reason: 'unknown' }),
      isTrancoDomain: vi.fn().mockReturnValue(false),
    };
    const mockAdmin = {
      initialize: vi.fn().mockResolvedValue(undefined),
      getPolicy: vi.fn().mockReturnValueOnce(policyA).mockReturnValueOnce(policyB),
      addToWhitelist: vi.fn().mockResolvedValue({ success: true }),
      addSensitiveDomain: vi.fn().mockResolvedValue({ success: true }),
      isDomainTrusted: vi.fn(),
    } as unknown as import('../TrustDbAdmin.js').TrustDbAdmin;

    const td = new TrustDecision(undefined, mockAdmin, makePermissionMock(true));

    const r1 = await td.isTrusted('https://example.com');
    expect(r1.trusted).toBe(true);
    expect(r1.level).toBe('trusted');
    expect(policyA.isDomainTrusted).toHaveBeenCalledTimes(1);
    expect(policyB.isDomainTrusted).not.toHaveBeenCalled();

    const r2 = await td.isTrusted('https://example.com');
    expect(r2.trusted).toBe(false);
    expect(r2.level).toBe('unverified');
    expect(policyB.isDomainTrusted).toHaveBeenCalledTimes(1);

    // Must have looked up policy fresh on each call, not reused cached instance
    expect(mockAdmin.getPolicy).toHaveBeenCalledTimes(2);
  });

  it('Legacy 2-arg constructor still works (backward compat)', async () => {
    const td = new TrustDecision(makeTrustDbMock('trusted', 'preset'), makePermissionMock(true));
    const r = await td.isTrusted('https://legacy.example.com');
    expect(r.trusted).toBe(true);
    expect(r.level).toBe('trusted');
  });

  it('Legacy 2-arg constructor with unverified still returns not trusted', async () => {
    const td = new TrustDecision(makeTrustDbMock('unverified', 'unknown'), makePermissionMock(true));
    const r = await td.isTrusted('https://unknown.example');
    expect(r.trusted).toBe(false);
  });

  it('Legacy 2-arg constructor delegates addToAllowlist via seam', async () => {
    const mockDb = makeTrustDbMock('trusted');
    const td = new TrustDecision(mockDb, makePermissionMock(true));
    const res = await td.addToAllowlist('legacy.example.com');
    expect(res.success).toBe(true);
    expect(mockDb.addToWhitelist).toHaveBeenCalledWith('legacy.example.com');
  });
});

