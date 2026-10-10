import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RecordingTriggerManager } from '../recordingTriggerManager.js';
import { settingsRepository } from '../../utils/storage/SettingsRepository.js';

describe('RecordingTriggerManager', () => {
  let manager: RecordingTriggerManager;
  let mockStorage: Record<string, unknown>;

  beforeEach(() => {
    mockStorage = {};
    (globalThis as any).chrome = {
      storage: {
        local: {
          get: vi.fn().mockImplementation((keys: string | string[]) => {
            if (Array.isArray(keys)) {
              const result: Record<string, unknown> = {};
              for (const k of keys) result[k] = mockStorage[k];
              return Promise.resolve(result);
            }
            return Promise.resolve({ [keys]: mockStorage[keys] });
          }),
          set: vi.fn().mockImplementation((items: Record<string, unknown>) => {
            Object.assign(mockStorage, items);
            return Promise.resolve();
          }),
        },
      },
    };
    manager = new RecordingTriggerManager();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('shouldRecord', () => {
    it('returns true for scroll_idle when scroll >= 50% and duration >= 5s and trigger enabled', async () => {
      mockStorage['recording_triggers'] = JSON.stringify({ scrollAndTime: true });
      manager.invalidateCache();
      expect(await manager.shouldRecord({
        type: 'scroll_idle',
        scrollPercent: 75,
        visitDuration: 10000,
      })).toBe(true);
    });

    it('returns false for scroll_idle when scroll < 50%', async () => {
      mockStorage['recording_triggers'] = JSON.stringify({ scrollAndTime: true });
      manager.invalidateCache();
      expect(await manager.shouldRecord({
        type: 'scroll_idle',
        scrollPercent: 25,
        visitDuration: 10000,
      })).toBe(false);
    });

    it('returns false for scroll_idle when duration < 5s', async () => {
      mockStorage['recording_triggers'] = JSON.stringify({ scrollAndTime: true });
      manager.invalidateCache();
      expect(await manager.shouldRecord({
        type: 'scroll_idle',
        scrollPercent: 80,
        visitDuration: 2000,
      })).toBe(false);
    });

    it('returns false for scroll_idle when trigger is disabled', async () => {
      expect(await manager.shouldRecord({
        type: 'scroll_idle',
        scrollPercent: 100,
        visitDuration: 60000,
      })).toBe(false); // scrollAndTime defaults to false
    });

    it('honors blob thresholds instead of defaults (PBI 2026-09-28-24)', async () => {
      mockStorage['recording_triggers'] = JSON.stringify({ scrollAndTime: true });
      // Mark migration complete so the seeded blob survives getAll(), and drop
      // the repository's 1s TTL cache so earlier tests' empty reads don't leak.
      mockStorage['settings_migrated'] = { stage: 'completed', schemaVersion: 2 };
      mockStorage['settings'] = { min_scroll_depth: 80, min_visit_duration: 30 };
      settingsRepository.clearCache();
      manager.invalidateCache();
      // 75% passes the default 50 but not the configured 80: proves the blob
      // value (not the fallback) drives the decision.
      expect(await manager.shouldRecord({
        type: 'scroll_idle',
        scrollPercent: 75,
        visitDuration: 40000,
      })).toBe(false);
      expect(await manager.shouldRecord({
        type: 'scroll_idle',
        scrollPercent: 85,
        visitDuration: 40000,
      })).toBe(true);
    });

    it('returns true for manual_save when enabled (default)', async () => {
      expect(await manager.shouldRecord({ type: 'manual_save' })).toBe(true);
    });

    it('returns true for snapshot when periodicSnapshot is enabled', async () => {
      mockStorage['recording_triggers'] = JSON.stringify({ periodicSnapshot: true });
      manager.invalidateCache();
      expect(await manager.shouldRecord({ type: 'snapshot' })).toBe(true);
    });

    it('returns false for snapshot when periodicSnapshot is disabled', async () => {
      expect(await manager.shouldRecord({ type: 'snapshot' })).toBe(false);
    });

    it('returns false for unknown event type', async () => {
      expect(await manager.shouldRecord({ type: 'unknown' as any })).toBe(false);
    });

    it('handles missing scrollPercent/visitDuration gracefully', async () => {
      mockStorage['recording_triggers'] = JSON.stringify({ scrollAndTime: true });
      manager.invalidateCache();
      expect(await manager.shouldRecord({ type: 'scroll_idle' })).toBe(false);
    });
  });

  describe('validate', () => {
    it('returns valid when at least one trigger is enabled', () => {
      expect(manager.validate({
        scrollAndTime: false,
        manualSave: true,  // Manual Save is default enabled
        periodicSnapshot: false,
      })).toEqual({ valid: true });
    });

    it('returns invalid when no triggers are enabled', () => {
      const result = manager.validate({
        scrollAndTime: false,
        manualSave: false,
        periodicSnapshot: false,
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('At least one');
    });
  });

  describe('getSnapshotIntervalMinutes', () => {
    it('returns default 5 when not set', async () => {
      expect(await manager.getSnapshotIntervalMinutes()).toBe(5);
    });

    it('returns stored value', async () => {
      mockStorage['snapshot_interval_minutes'] = 15;
      expect(await manager.getSnapshotIntervalMinutes()).toBe(15);
    });
  });

  describe('invalidateCache', () => {
    it('forces reload from storage on next loadTriggers call', async () => {
      const getSpy = (globalThis as any).chrome.storage.local.get as ReturnType<typeof vi.fn>;

      await manager.loadTriggers();
      const callsAfterFirstLoad = getSpy.mock.calls.length;

      // Without invalidate, cache returns old value without hitting storage again
      await manager.loadTriggers();
      expect(getSpy.mock.calls.length).toBe(callsAfterFirstLoad);

      // After invalidate, reads from storage again
      manager.invalidateCache();
      await manager.loadTriggers();
      expect(getSpy.mock.calls.length).toBeGreaterThan(callsAfterFirstLoad);
    });
  });

  describe('loadTriggers with malformed data', () => {
    it('falls back to defaults on JSON parse error', async () => {
      mockStorage['recording_triggers'] = '{invalid json}';
      manager.invalidateCache();
      const triggers = await manager.loadTriggers();
      expect(triggers.scrollAndTime).toBe(false);
    });

    it('falls back to defaults when storage.get throws', async () => {
      (globalThis as any).chrome.storage.local.get = vi.fn().mockRejectedValue(new Error('Storage error'));
      manager.invalidateCache();
      const triggers = await manager.loadTriggers();
      expect(triggers.scrollAndTime).toBe(false);
    });
  });
});
