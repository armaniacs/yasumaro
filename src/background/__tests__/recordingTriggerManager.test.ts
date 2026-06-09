import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RecordingTriggerManager } from '../recordingTriggerManager.js';

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
    it('returns true for tab_close when trigger is enabled (default)', async () => {
      expect(await manager.shouldRecord({ type: 'tab_close' })).toBe(true);
    });

    it('returns false for tab_close when trigger is disabled', async () => {
      mockStorage['recording_triggers'] = JSON.stringify({ tabClose: false });
      manager.invalidateCache();
      expect(await manager.shouldRecord({ type: 'tab_close' })).toBe(false);
    });

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
        tabClose: true,
        scrollAndTime: false,
        manualSave: false,
        periodicSnapshot: false,
      })).toEqual({ valid: true });
    });

    it('returns invalid when no triggers are enabled', () => {
      const result = manager.validate({
        tabClose: false,
        scrollAndTime: false,
        manualSave: false,
        periodicSnapshot: false,
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('At least one');
    });
  });

  describe('saveTriggers', () => {
    it('saves triggers to storage and updates cache', async () => {
      const triggers = { tabClose: false, scrollAndTime: true, manualSave: false, periodicSnapshot: true };
      const result = await manager.saveTriggers(triggers);
      expect(result).toBe(true);
      expect(mockStorage['recording_triggers']).toBe(JSON.stringify(triggers));

      // Cache should be updated
      manager.invalidateCache(); // invalidate to test from storage
      const loaded = await manager.loadTriggers();
      expect(loaded.scrollAndTime).toBe(true);
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

  describe('saveSnapshotInterval', () => {
    it('saves and clamps to 1-60 range', async () => {
      expect(await manager.saveSnapshotInterval(30)).toBe(true);
      expect(mockStorage['snapshot_interval_minutes']).toBe(30);
    });

    it('clamps values below 1', async () => {
      await manager.saveSnapshotInterval(0);
      expect(mockStorage['snapshot_interval_minutes']).toBe(1);
    });

    it('clamps values above 60', async () => {
      await manager.saveSnapshotInterval(100);
      expect(mockStorage['snapshot_interval_minutes']).toBe(60);
    });
  });

  describe('invalidateCache', () => {
    it('forces reload from storage on next loadTriggers call', async () => {
      await manager.loadTriggers();
      mockStorage['recording_triggers'] = JSON.stringify({ tabClose: false });
      // Without invalidate, cache returns old value
      const cached = await manager.loadTriggers();
      expect(cached.tabClose).toBe(true);
      // After invalidate, reads from storage
      manager.invalidateCache();
      const fresh = await manager.loadTriggers();
      expect(fresh.tabClose).toBe(false);
    });
  });

  describe('loadTriggers with malformed data', () => {
    it('falls back to defaults on JSON parse error', async () => {
      mockStorage['recording_triggers'] = '{invalid json}';
      manager.invalidateCache();
      const triggers = await manager.loadTriggers();
      expect(triggers.tabClose).toBe(true);
      expect(triggers.scrollAndTime).toBe(false);
    });

    it('falls back to defaults when storage.get throws', async () => {
      (globalThis as any).chrome.storage.local.get = vi.fn().mockRejectedValue(new Error('Storage error'));
      manager.invalidateCache();
      const triggers = await manager.loadTriggers();
      expect(triggers.tabClose).toBe(true);
    });
  });
});
