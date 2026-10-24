// src/background/__tests__/recordingPause.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  isPaused,
  validatePauseMinutes,
  remainingPauseMinutes,
  createRecordingPause,
  refreshPauseTick,
  InvalidPauseMinutesError,
  INVALID_PAUSE_MINUTES,
  PAUSE_ALARM_NAME,
  PAUSE_PRESETS_MINUTES,
  PAUSE_TICK_NAME,
  schedulePause,
  clearPause,
  type PauseStorage,
} from '../recordingPause.js';

describe('isPaused', () => {
  it('returns true before the deadline and false at/after it', () => {
    expect(isPaused(1_000, 999)).toBe(true);
    expect(isPaused(1_000, 1_000)).toBe(false);
    expect(isPaused(null, 999)).toBe(false);
  });

  it('owns the alarm name and presets', () => {
    expect(PAUSE_ALARM_NAME).toBe('yasumaro-recording-resume');
    expect(PAUSE_PRESETS_MINUTES).toEqual([30, 60, 90, 120]);
  });
});

describe('schedulePause / clearPause', () => {
  const NOW = 1_760_000_000_000;

  function memoryStorage(initial: number | null = null): PauseStorage & { current: number | null } {
    const box: { current: number | null } = { current: initial };
    return {
      get current() {
        return box.current;
      },
      async getPausedUntil() {
        return box.current;
      },
      async setPausedUntil(value: number) {
        box.current = value;
      },
      async clearPausedUntil() {
        box.current = null;
      },
    };
  }

  beforeEach(() => {
    (globalThis as Record<string, unknown>).chrome = {
      alarms: { create: vi.fn(async () => undefined), clear: vi.fn(async () => true) },
      action: { setBadgeText: vi.fn(async () => undefined), setBadgeBackgroundColor: vi.fn(async () => undefined) },
    };
  });

  it('arms resume + tick alarms and shows the badge countdown', async () => {
    const storage = memoryStorage();
    const until = await schedulePause(30, { storage, now: () => NOW });
    expect(until).toBe(NOW + 30 * 60_000);
    expect(storage.current).toBe(until);
    const chromeMock = globalThis as unknown as {
      chrome: { alarms: { create: ReturnType<typeof vi.fn> } };
    };
    expect(chromeMock.chrome.alarms.create).toHaveBeenCalledWith(PAUSE_ALARM_NAME, { when: until });
    expect(chromeMock.chrome.alarms.create).toHaveBeenCalledWith(PAUSE_TICK_NAME, { periodInMinutes: 1 });
    const actionMock = globalThis as unknown as {
      chrome: { action: { setBadgeText: ReturnType<typeof vi.fn> } };
    };
    expect(actionMock.chrome.action.setBadgeText).toHaveBeenCalledWith({ text: '30' });
  });

  it('clears storage, both alarms, and the badge', async () => {
    const storage = memoryStorage(NOW + 60_000);
    await clearPause({ storage });
    expect(storage.current).toBeNull();
    const chromeMock = globalThis as unknown as {
      chrome: { alarms: { clear: ReturnType<typeof vi.fn> } };
    };
    expect(chromeMock.chrome.alarms.clear).toHaveBeenCalledWith(PAUSE_ALARM_NAME);
    expect(chromeMock.chrome.alarms.clear).toHaveBeenCalledWith(PAUSE_TICK_NAME);
    const actionMock = globalThis as unknown as {
      chrome: { action: { setBadgeText: ReturnType<typeof vi.fn> } };
    };
    expect(actionMock.chrome.action.setBadgeText).toHaveBeenCalledWith({ text: '' });
  });
});

describe('recordingPause deep module', () => {
  const NOW = 1_760_000_000_000;

  function memoryStorage(initial: number | null = null): PauseStorage & { current: number | null } {
    const box: { current: number | null } = { current: initial };
    return {
      get current() {
        return box.current;
      },
      async getPausedUntil() {
        return box.current;
      },
      async setPausedUntil(value: number) {
        box.current = value;
      },
      async clearPausedUntil() {
        box.current = null;
      },
    };
  }

  function failingStorage(): PauseStorage {
    return {
      async getPausedUntil(): Promise<number | null> {
        throw new Error('storage unavailable');
      },
      async setPausedUntil(): Promise<void> {
        throw new Error('storage unavailable');
      },
      async clearPausedUntil(): Promise<void> {
        throw new Error('storage unavailable');
      },
    };
  }

  function chromeSpies() {
    const chromeMock = globalThis as unknown as {
      chrome: {
        alarms: { create: ReturnType<typeof vi.fn>; clear: ReturnType<typeof vi.fn> };
        action: { setBadgeText: ReturnType<typeof vi.fn> };
      };
    };
    return chromeMock.chrome;
  }

  beforeEach(() => {
    (globalThis as Record<string, unknown>).chrome = {
      alarms: { create: vi.fn(async () => undefined), clear: vi.fn(async () => true) },
      action: { setBadgeText: vi.fn(async () => undefined), setBadgeBackgroundColor: vi.fn(async () => undefined) },
    };
  });

  describe('validatePauseMinutes', () => {
    it.each([30, 60, 90, 120])('accepts the preset %i', (minutes) => {
      expect(validatePauseMinutes(minutes)).toBe(true);
    });

    it.each([0, 45, 150, -30, 121, Number.NaN])('rejects the off-preset %s', (minutes) => {
      expect(validatePauseMinutes(minutes)).toBe(false);
    });

    it('rejects non-number wire payloads', () => {
      expect(validatePauseMinutes('90' as never)).toBe(false);
      expect(validatePauseMinutes(undefined as never)).toBe(false);
      expect(validatePauseMinutes(null as never)).toBe(false);
    });
  });

  describe('remainingPauseMinutes', () => {
    it.each([
      [30 * 60_000, 30],
      [29 * 60_000 + 1, 30],
      [60_000, 1],
      [1, 1],
    ])('shows %i ms left as %i minutes', (msLeft, expected) => {
      expect(remainingPauseMinutes(NOW + msLeft, NOW)).toBe(expected);
    });
  });

  describe('createRecordingPause', () => {
    describe('pause', () => {
      it('arms the deadline for a preset press', async () => {
        const storage = memoryStorage();
        const until = await createRecordingPause({ storage, now: () => NOW }).pause(90);
        expect(until).toBe(NOW + 90 * 60_000);
        expect(storage.current).toBe(until);
      });

      it('rejects off-preset requests with the module error and writes nothing', async () => {
        const storage = memoryStorage();
        const pause = createRecordingPause({ storage, now: () => NOW });
        await expect(pause.pause(45)).rejects.toBeInstanceOf(InvalidPauseMinutesError);
        await expect(pause.pause(45)).rejects.toMatchObject({ code: INVALID_PAUSE_MINUTES });
        expect(storage.current).toBeNull();
      });
    });

    describe('isPaused', () => {
      it.each([
        { until: NOW + 1, now: NOW, expected: true },
        { until: NOW, now: NOW, expected: false },
        { until: NOW - 1, now: NOW, expected: false },
        { until: null, now: NOW, expected: false },
      ])('deadline $until at $now pauses=$expected', async ({ until, now, expected }) => {
        const pause = createRecordingPause({ storage: memoryStorage(until), now: () => now });
        await expect(pause.isPaused(now)).resolves.toBe(expected);
      });

      it('fails open when the storage read throws', async () => {
        const pause = createRecordingPause({ storage: failingStorage() });
        await expect(pause.isPaused()).resolves.toBe(false);
        await expect(pause.getPausedUntil()).resolves.toBeNull();
      });
    });

    describe('resume', () => {
      it('clears storage, both alarms, and the badge', async () => {
        const storage = memoryStorage(NOW + 60_000);
        await createRecordingPause({ storage }).resume();
        const chromeStubs = chromeSpies();
        expect(storage.current).toBeNull();
        expect(chromeStubs.alarms.clear).toHaveBeenCalledWith(PAUSE_ALARM_NAME);
        expect(chromeStubs.alarms.clear).toHaveBeenCalledWith(PAUSE_TICK_NAME);
        expect(chromeStubs.action.setBadgeText).toHaveBeenCalledWith({ text: '' });
      });
    });

    describe('refreshTick', () => {
      it('refreshes the badge countdown while paused', async () => {
        const storage = memoryStorage(NOW + 29 * 60_000 + 1);
        await createRecordingPause({ storage, now: () => NOW }).refreshTick();
        const chromeStubs = chromeSpies();
        expect(chromeStubs.action.setBadgeText).toHaveBeenCalledWith({ text: '30' });
        expect(chromeStubs.alarms.clear).not.toHaveBeenCalled();
      });

      it('stands down (badge clear plus tick disarm) once expired', async () => {
        const storage = memoryStorage(NOW - 1_000);
        await createRecordingPause({ storage, now: () => NOW }).refreshTick();
        const chromeStubs = chromeSpies();
        expect(chromeStubs.action.setBadgeText).toHaveBeenCalledWith({ text: '' });
        expect(chromeStubs.alarms.clear).toHaveBeenCalledWith(PAUSE_TICK_NAME);
      });

      it('stands down when the storage read throws', async () => {
        await createRecordingPause({ storage: failingStorage(), now: () => NOW }).refreshTick();
        const chromeStubs = chromeSpies();
        expect(chromeStubs.action.setBadgeText).toHaveBeenCalledWith({ text: '' });
        expect(chromeStubs.alarms.clear).toHaveBeenCalledWith(PAUSE_TICK_NAME);
      });
    });
  });

  describe('refreshPauseTick', () => {
    it('matches the controller tick for the same deadline', async () => {
      const expected = memoryStorage(NOW + 42 * 60_000);
      const actual = memoryStorage(NOW + 42 * 60_000);
      await refreshPauseTick({ storage: actual, now: () => NOW });
      await createRecordingPause({ storage: expected, now: () => NOW }).refreshTick();
      const chromeStubs = chromeSpies();
      expect(chromeStubs.action.setBadgeText).toHaveBeenCalledTimes(2);
      expect(chromeStubs.action.setBadgeText).toHaveBeenNthCalledWith(1, { text: '42' });
      expect(chromeStubs.action.setBadgeText).toHaveBeenNthCalledWith(2, { text: '42' });
    });
  });
});
