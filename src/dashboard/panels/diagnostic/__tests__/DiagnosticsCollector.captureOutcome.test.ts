/**
 * DiagnosticsCollector.captureOutcome.test.ts
 * PBI 2026-10-22-06 slice 2 (diag wiring): the snapshot carries the last
 * settled capture outcome through the injected reader seam, and a reader
 * failure degrades to null instead of failing the whole snapshot.
 */
import { describe, it, expect, vi } from 'vitest';
import { DiagnosticsCollector } from '../DiagnosticsCollector.js';
import type { SettingsRepository } from '../../../../utils/storage/SettingsRepository.js';
import type { StorageKey, Settings } from '../../../../utils/storage/types.js';

vi.mock('../../../dashboardSqliteService.js', () => ({
  getSqliteStatus: vi.fn(),
  getLogCount: vi.fn(),
}));

function mockGetMany(partial: Partial<Settings>): SettingsRepository['getMany'] {
  return vi.fn(async (keys: readonly StorageKey[]) => {
    const out: Record<string, unknown> = {};
    for (const k of keys) {
      out[k] = partial[k as keyof Settings];
    }
    return out as Pick<Settings, typeof keys[number]>;
  });
}

function baseDeps(): ConstructorParameters<typeof DiagnosticsCollector>[0] {
  return {
    getMany: mockGetMany({}),
    getLogCount: vi.fn().mockResolvedValue({ data: 0 }),
    checkBuiltInAiAvailability: vi.fn().mockResolvedValue(null),
    getStorageBytesInUse: vi.fn().mockResolvedValue(0),
    getDebugMode: vi.fn().mockResolvedValue(false),
    getManifest: vi.fn(() => ({ version: '0.0.0', name: 'capture-outcome-test' })),
    getSqliteStatus: vi.fn().mockResolvedValue(null),
  };
}

describe('DiagnosticsCollector lastCapture', () => {
  it('carries the persisted outcome into the snapshot', async () => {
    const collector = new DiagnosticsCollector({
      ...baseDeps(),
      readLastCaptureOutcome: vi.fn().mockResolvedValue({ code: 'domain_excluded', at: 1729650000000 }),
    });
    const snapshot = await collector.collect();
    expect(snapshot.lastCapture).toEqual({ code: 'domain_excluded', at: 1729650000000 });
  });

  it('reads null when nothing was recorded yet', async () => {
    const collector = new DiagnosticsCollector({
      ...baseDeps(),
      readLastCaptureOutcome: vi.fn().mockResolvedValue(null),
    });
    const snapshot = await collector.collect();
    expect(snapshot.lastCapture).toBeNull();
  });

  it('degrades to null when the reader fails (snapshot still completes)', async () => {
    const collector = new DiagnosticsCollector({
      ...baseDeps(),
      readLastCaptureOutcome: vi.fn().mockRejectedValue(new Error('storage gone')),
    });
    const snapshot = await collector.collect();
    expect(snapshot.lastCapture).toBeNull();
    expect(snapshot.storage.savedUrls).toBe('0');
  });
});
