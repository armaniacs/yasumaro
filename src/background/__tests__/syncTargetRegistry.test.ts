/**
 * syncTargetRegistry.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SyncTargetRegistry } from '../syncTargetRegistry.js';

describe('SyncTargetRegistry', () => {
  let registry: SyncTargetRegistry;
  let mockTarget: {
    isConfigured: ReturnType<typeof vi.fn>;
    sync: ReturnType<typeof vi.fn>;
    syncBatch: ReturnType<typeof vi.fn>;
    testConnection: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    registry = new SyncTargetRegistry();
    mockTarget = {
      isConfigured: vi.fn().mockResolvedValue(true),
      sync: vi.fn().mockResolvedValue({ success: true }),
      syncBatch: vi.fn().mockResolvedValue(3),
      testConnection: vi.fn().mockResolvedValue({ success: true, message: 'OK' }),
    };
  });

  it('registers and retrieves targets', () => {
    registry.register('obsidian', mockTarget as any);
    expect(registry.getAll().size).toBe(1);
    expect(registry.getAll().get('obsidian')).toBe(mockTarget);
  });

  it('unregisters a target', () => {
    registry.register('obsidian', mockTarget as any);
    registry.unregister('obsidian');
    expect(registry.getAll().size).toBe(0);
  });

  it('syncAll calls all configured targets', async () => {
    registry.register('obsidian', mockTarget as any);
    registry.register('gist', mockTarget as any);

    await registry.syncAll(1, 'https://example.com', 'Test', 'Summary');

    expect(mockTarget.sync).toHaveBeenCalledTimes(2);
  });

  it('syncAll isolates failures between targets', async () => {
    const failingTarget = {
      ...mockTarget,
      sync: vi.fn().mockRejectedValue(new Error('Target failed')),
    };
    registry.register('failing', failingTarget as any);
    registry.register('working', mockTarget as any);

    const results = await registry.syncAll(1, 'https://example.com', 'Test', 'Summary');

    expect(results.failing).toEqual({ success: false, error: expect.any(String) });
    expect(results.working).toEqual({ success: true });
  });

  it('syncBatchAll collects results from all targets', async () => {
    registry.register('obsidian', mockTarget as any);
    registry.register('gist', mockTarget as any);

    const results = await registry.syncBatchAll();

    expect(results.obsidian).toBe(3);
    expect(results.gist).toBe(3);
  });

  it('testAllConnections tests all targets', async () => {
    registry.register('obsidian', mockTarget as any);

    const results = await registry.testAllConnections();

    expect(results.obsidian).toEqual({ success: true, message: 'OK' });
  });
});
