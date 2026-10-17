// src/background/__tests__/recordingPause.test.ts
import { describe, expect, it, vi } from 'vitest';
import { isPaused, PAUSE_ALARM_NAME, PAUSE_PRESETS_MINUTES } from '../recordingPause.js';

describe('isPaused', () => {
  it('returns true before the deadline and false at/after it', () => {
    expect(isPaused(1_000, 999)).toBe(true);
    expect(isPaused(1_000, 1_000)).toBe(false);
    expect(isPaused(null, 999)).toBe(false);
  });

  it('owns the alarm name and presets', () => {
    expect(PAUSE_ALARM_NAME).toBe('yasumaro-recording-resume');
    expect(PAUSE_PRESETS_MINUTES).toEqual([30, 60, 180]);
  });
});
