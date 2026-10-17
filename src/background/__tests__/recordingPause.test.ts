// src/background/__tests__/recordingPause.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  isPaused,
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
