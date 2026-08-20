import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TrustDecision } from '../TrustDecision.js';

function makeTrustDbMock(level: string = 'trusted', source: string = 'preset') {
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    isDomainTrusted: vi.fn().mockReturnValue({ level, source, reason: source }),
    addToWhitelist: vi.fn().mockResolvedValue({ success: true }),
    addSensitiveDomain: vi.fn().mockResolvedValue({ success: true }),
  } as unknown as import('../trustDb.js').TrustDb;
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
