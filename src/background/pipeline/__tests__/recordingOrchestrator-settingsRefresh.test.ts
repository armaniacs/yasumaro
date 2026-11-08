/**
 * recordingOrchestrator-settingsRefresh.test.ts — PBI 2026-11-08-07(1).
 *
 * Settings must be read AFTER the per-URL mutex is acquired: a recording
 * that waited behind another run of the same URL executes with the fresh
 * consent snapshot, never the pre-wait one.
 */
import { describe, it, expect, vi } from 'vitest';
import { RecordingOrchestrator } from '../RecordingOrchestrator.js';
import { PerUrlMutexMap } from '../perUrlMutex.js';
import type { RecordingData, RecordingResult } from '../../../messaging/types.js';

const URL = 'https://example.com/same-url';

function recordData(): RecordingData {
  return { title: 'T', url: URL, content: 'body' };
}

function makeOrchestrator(opts: {
  mutexMap: PerUrlMutexMap;
  getSettingsWithCache: () => Promise<{ marker: string }>;
  seenMarkers: string[];
}): RecordingOrchestrator {
  const orch = new RecordingOrchestrator({
    getPrivacyInfoWithCache: async () => null,
    getSettingsWithCache: opts.getSettingsWithCache as never,
    obsidian: {} as never,
    aiService: null,
    sqliteClient: null,
    perUrlMutexMap: opts.mutexMap,
    stepDelay: async () => undefined,
  });
  // The pipeline core is stubbed: this suite pins which settings reach it,
  // not what the steps do with them.
  vi.spyOn(
    orch as unknown as Record<
      string,
      (data: RecordingData, settings: { marker: string }) => Promise<RecordingResult>
    >,
    'executeInternal',
  ).mockImplementation(async (_data, settings) => {
    opts.seenMarkers.push(settings.marker);
    return { success: true };
  });
  return orch;
}

describe('RecordingOrchestrator', () => {
  describe('record settings freshness', () => {
    it('reads settings after acquiring the mutex, not before waiting on it', async () => {
      const mutexMap = new PerUrlMutexMap();
      // Occupy the URL lock so the record below must wait for it.
      const gate = Promise.withResolvers<void>();
      const occupying = mutexMap.runExclusive(URL, () => gate.promise);

      let marker = 'v1-consented';
      const seenMarkers: string[] = [];
      const orch = makeOrchestrator({
        mutexMap,
        getSettingsWithCache: async () => ({ marker }),
        seenMarkers,
      });

      const pending = orch.record(recordData());
      // Consent is withdrawn while the recording waits for the mutex.
      marker = 'v2-withdrawn';
      gate.resolve();
      await occupying;
      const result = await pending;

      expect(result).toEqual({ success: true });
      expect(seenMarkers).toEqual(['v2-withdrawn']);
    });

    it('keeps explicitly passed settings caller-owned without a cache read', async () => {
      const mutexMap = new PerUrlMutexMap();
      let cacheReads = 0;
      const seenMarkers: string[] = [];
      const orch = makeOrchestrator({
        mutexMap,
        getSettingsWithCache: async () => {
          cacheReads += 1;
          return { marker: 'from-cache' };
        },
        seenMarkers,
      });

      const result = await orch.record(recordData(), {
        settings: { marker: 'from-caller' } as never,
      });

      expect(result).toEqual({ success: true });
      expect(seenMarkers).toEqual(['from-caller']);
      expect(cacheReads).toBe(0);
    });

    it('reads preview settings after acquiring the mutex as well', async () => {
      const mutexMap = new PerUrlMutexMap();
      const gate = Promise.withResolvers<void>();
      const occupying = mutexMap.runExclusive(URL, () => gate.promise);

      let marker = 'v1';
      const seenMarkers: string[] = [];
      const orch = makeOrchestrator({
        mutexMap,
        getSettingsWithCache: async () => ({ marker }),
        seenMarkers,
      });

      const pending = orch.preview(recordData());
      marker = 'v2';
      gate.resolve();
      await occupying;
      await pending;

      expect(seenMarkers).toEqual(['v2']);
    });
  });
});
