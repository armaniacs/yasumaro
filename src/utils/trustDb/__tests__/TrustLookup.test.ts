/**
 * TrustLookup.test.ts
 * Pins the single async seam: lookup() resolution precedence + display table,
 * decideAlert() 4-level x 3-flag matrix (storage-mock-free), and the 2-path
 * convergence of checkDomain / getTrustLevelDisplay (both adapters over lookup).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DomainTrustLevel } from '../trustDbSchema.js';

// ---- Module mocks (same dynamics as trustChecker.test.ts) ----
const mockIsTrusted = vi.fn();
const mockAdminInitialize = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
const mockPolicyIsDomainTrusted = vi.fn();

vi.mock('../TrustDecision.js', () => ({
  // NOTE: regular function (not arrow) so `new TrustDecision()` works.
  TrustDecision: vi.fn().mockImplementation(function () {
    return { isTrusted: mockIsTrusted };
  }),
}));

vi.mock('../TrustDbAdmin.js', () => ({
  getTrustDbAdmin: vi.fn(() => ({
    initialize: mockAdminInitialize,
  })),
}));

vi.mock('../TrustPolicy.js', () => ({
  getTrustPolicy: vi.fn(() => ({
    isDomainTrusted: mockPolicyIsDomainTrusted,
  })),
}));

vi.mock('../../logger/api.js', () => ({
  logInfo: vi.fn().mockResolvedValue(undefined),
  logDebug: vi.fn().mockResolvedValue(undefined),
  logWarn: vi.fn().mockResolvedValue(undefined),
  logError: vi.fn().mockResolvedValue(undefined),
}));

const mockStorage = new Map<string, unknown>();

function setupChromeMocks(): void {
  (global as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: vi.fn().mockImplementation((keys: unknown) => {
          const result: Record<string, unknown> = {};
          if (keys !== null && typeof keys === 'object' && !Array.isArray(keys)) {
            for (const [key, defaultVal] of Object.entries(keys as Record<string, unknown>)) {
              result[key] = mockStorage.has(key) ? mockStorage.get(key) : defaultVal;
            }
          }
          return Promise.resolve(result);
        }),
        set: vi.fn().mockImplementation((items: unknown) => {
          for (const [key, value] of Object.entries(items as Record<string, unknown>)) {
            mockStorage.set(key, value);
          }
          return Promise.resolve();
        }),
      },
    },
  };
}

setupChromeMocks();

beforeEach(() => {
  vi.clearAllMocks();
  mockStorage.clear();
  setupChromeMocks();
  mockIsTrusted.mockReset();
  mockPolicyIsDomainTrusted.mockReset();
  mockAdminInitialize.mockReset();
  mockAdminInitialize.mockResolvedValue(undefined);
});

function trustResult(level: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { level, source: 'tranco', reason: 'test', ...extra };
}

describe('TrustLookup.lookup — resolution precedence', () => {
  it('uses TrustDecision.trustResult when present (admin+policy untouched)', async () => {
    const { lookup } = await import('../TrustLookup.js');
    mockIsTrusted.mockResolvedValue({
      trusted: true,
      reason: 'tranco',
      level: 'trusted',
      source: 'tranco',
      trustResult: trustResult('trusted'),
    });

    const found = await lookup('https://example.com');

    expect(found.level).toBe('trusted');
    expect(found.source).toBe('tranco');
    expect(found.trustResult).toEqual(trustResult('trusted'));
    expect(mockAdminInitialize).not.toHaveBeenCalled();
    expect(mockPolicyIsDomainTrusted).not.toHaveBeenCalled();
  });

  it('falls back to admin+policy when TrustDecision has no trustResult', async () => {
    const { lookup } = await import('../TrustLookup.js');
    mockIsTrusted.mockResolvedValue({ trusted: false, reason: 'permission_denied' });
    mockPolicyIsDomainTrusted.mockReturnValue(trustResult('sensitive', { category: 'finance' }));

    const found = await lookup('https://bank.example.com');

    expect(mockAdminInitialize).toHaveBeenCalled();
    expect(mockPolicyIsDomainTrusted).toHaveBeenCalled();
    expect(found.level).toBe('sensitive');
    expect(found.category).toBe('finance');
  });

  it('returns UNVERIFIED catch-all when every leg fails', async () => {
    const { lookup } = await import('../TrustLookup.js');
    mockIsTrusted.mockRejectedValue(new Error('decision failed'));
    mockAdminInitialize.mockRejectedValue(new Error('admin failed'));

    const found = await lookup('https://example.com');

    expect(found.level).toBe(DomainTrustLevel.UNVERIFIED);
    expect(found.source).toBe('unknown');
    expect(found.trustResult.reason).toBe('trust_check_failed');
  });
});

describe('TrustLookup.lookup — display table', () => {
  it.each([
    { level: 'trusted', label: 'TRUSTED', color: '#10b981', icon: '🟢' },
    { level: 'sensitive', label: 'SENSITIVE', color: '#f59e0b', icon: '🟡' },
    { level: 'unverified', label: 'UNVERIFIED', color: '#94a3b8', icon: '⚪' },
    { level: 'locked', label: 'LOCKED', color: '#6b7280', icon: '🔒' },
  ])('maps $level to $label/$color/$icon', async ({ level, label, color, icon }) => {
    const { lookup } = await import('../TrustLookup.js');
    mockIsTrusted.mockResolvedValue({ trusted: true, reason: level, trustResult: trustResult(level) });

    const found = await lookup('https://example.com');

    expect(found.display).toEqual({ label, color, icon });
  });

  it('falls back to unverified style for unknown levels', async () => {
    const { lookup } = await import('../TrustLookup.js');
    mockIsTrusted.mockResolvedValue({
      trusted: false,
      reason: 'unknown',
      trustResult: trustResult('unknown_level'),
    });

    const found = await lookup('https://example.com');

    expect(found.display).toEqual({ label: 'UNKNOWN_LEVEL', color: '#94a3b8', icon: '⚪' });
  });
});

describe('TrustLookup.decideAlert — 4 levels x 3 flags (storage-free)', () => {
  it.each([
    { name: 'trusted + all flags on', level: 'trusted', category: undefined, flags: { alertFinance: true, alertSensitive: true, alertUnverified: true }, showAlert: false },
    { name: 'trusted + all flags off', level: 'trusted', category: undefined, flags: { alertFinance: false, alertSensitive: false, alertUnverified: false }, showAlert: false },
    { name: 'sensitive/finance + alertFinance on', level: 'sensitive', category: 'finance', flags: { alertFinance: true, alertSensitive: false, alertUnverified: false }, showAlert: true },
    { name: 'sensitive/finance + alertFinance off', level: 'sensitive', category: 'finance', flags: { alertFinance: false, alertSensitive: true, alertUnverified: true }, showAlert: false },
    { name: 'sensitive/sns + alertSensitive on', level: 'sensitive', category: 'sns', flags: { alertFinance: false, alertSensitive: true, alertUnverified: false }, showAlert: true },
    { name: 'sensitive/gaming + alertSensitive off', level: 'sensitive', category: 'gaming', flags: { alertFinance: true, alertSensitive: false, alertUnverified: true }, showAlert: false },
    { name: 'sensitive without category falls through', level: 'sensitive', category: undefined, flags: { alertFinance: true, alertSensitive: true, alertUnverified: true }, showAlert: false },
    { name: 'unverified + alertUnverified on', level: 'unverified', category: undefined, flags: { alertFinance: false, alertSensitive: false, alertUnverified: true }, showAlert: true },
    { name: 'unverified + alertUnverified off', level: 'unverified', category: undefined, flags: { alertFinance: true, alertSensitive: true, alertUnverified: false }, showAlert: false },
  ])('$name', async ({ level, category, flags, showAlert }) => {
    const { decideAlert } = await import('../TrustLookup.js');

    const decision = decideAlert({ level: level as DomainTrustLevel, category: category as 'finance' | undefined }, flags);

    expect(decision.showAlert).toBe(showAlert);
    expect(decision.canProceed).toBe(true);
    expect(decision.reason).toBeUndefined();
  });

  it.each([
    { name: 'locked + all flags on', flags: { alertFinance: true, alertSensitive: true, alertUnverified: true } },
    { name: 'locked + all flags off', flags: { alertFinance: false, alertSensitive: false, alertUnverified: false } },
    { name: 'locked + mixed flags', flags: { alertFinance: true, alertSensitive: false, alertUnverified: true } },
  ])('$name always blocks without alert', async ({ flags }) => {
    const { decideAlert } = await import('../TrustLookup.js');

    const decision = decideAlert({ level: DomainTrustLevel.LOCKED, category: undefined }, flags);

    expect(decision).toEqual({
      showAlert: false,
      canProceed: false,
      reason: 'Trust check failed - recording blocked',
    });
  });
});

describe('TrustLookup — 2-path convergence (checkDomain vs getTrustLevelDisplay)', () => {
  it('both adapters judge identically for the same URL', async () => {
    const { TrustChecker } = await import('../../trustChecker.js');
    const { lookup } = await import('../TrustLookup.js');
    mockIsTrusted.mockResolvedValue({ trusted: false, reason: 'permission_denied' });
    mockPolicyIsDomainTrusted.mockReturnValue(trustResult('sensitive', { category: 'finance' }));

    const checker = new TrustChecker();
    await checker.loadAlertSettings();
    const checked = await checker.checkDomain('https://bank.example.com');
    const display = await checker.getTrustLevelDisplay('https://bank.example.com');
    const found = await lookup('https://bank.example.com');

    expect(checked.trustResult.level).toBe('sensitive');
    expect(display.level).toBe('SENSITIVE');
    expect(display.level).toBe(String(found.level).toUpperCase());
    expect(checked.showAlert).toBe(true);
    expect(checked.canProceed).toBe(true);
  });

  it('both adapters agree on locked (blocked) domains', async () => {
    const { TrustChecker } = await import('../../trustChecker.js');
    mockIsTrusted.mockResolvedValue({ trusted: false, reason: 'no-result' });
    mockPolicyIsDomainTrusted.mockReturnValue(trustResult('locked', { source: 'user-blacklist' }));

    const checker = new TrustChecker();
    await checker.loadAlertSettings();
    const checked = await checker.checkDomain('https://blocked.example.com');
    const display = await checker.getTrustLevelDisplay('https://blocked.example.com');

    expect(checked.canProceed).toBe(false);
    expect(checked.reason).toBeDefined();
    expect(display.level).toBe('LOCKED');
  });
});
