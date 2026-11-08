/**
 * Mutex.test.ts
 * PBI 2026-11-08-11: Mutex ownership validation and timeout contract.
 * Covers (1) explicit-0 rejection, (2) spurious-release detection, and
 * (3) hung-holder watchdog — plus the unchanged normal acquire/release path.
 */

import { Mutex } from '../Mutex.js';
import { useTimerClock } from '../../../testDir/waitPolicy.js';

describe('Mutex', () => {
  describe('constructor option validation', () => {
    it('rejects maxQueueSize 0 instead of silently applying the default', () => {
      expect(() => new Mutex({ maxQueueSize: 0 })).toThrow(RangeError);
    });

    it('rejects timeoutMs 0 instead of silently applying the default', () => {
      expect(() => new Mutex({ timeoutMs: 0 })).toThrow(RangeError);
    });

    it('rejects negative, NaN, and non-integer option values', () => {
      expect(() => new Mutex({ maxQueueSize: -1 })).toThrow(RangeError);
      expect(() => new Mutex({ maxQueueSize: 1.5 })).toThrow(RangeError);
      expect(() => new Mutex({ timeoutMs: Number.NaN })).toThrow(RangeError);
      expect(() => new Mutex({ timeoutMs: -100 })).toThrow(RangeError);
      expect(() => new Mutex({ holderTimeoutMs: 0 })).toThrow(RangeError);
    });

    it('keeps the documented defaults for omitted options', async () => {
      useTimerClock();
      try {
        const mutex = new Mutex();
        expect(mutex.getMaxQueueSize()).toBe(50);

        await mutex.acquire();
        const pending = mutex.acquire();
        vi.advanceTimersByTime(30000);
        await expect(pending).rejects.toThrow(
          'Mutex acquisition timeout after 30000ms',
        );

        expect(mutex.release()).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('release', () => {
    it('returns true for a held lock and preserves the handoff to waiters', async () => {
      const mutex = new Mutex();
      await mutex.acquire();

      let secondAcquired = false;
      const second = mutex.acquire().then(() => {
        secondAcquired = true;
      });

      expect(mutex.release()).toBe(true);
      await second;
      expect(secondAcquired).toBe(true);
      expect(mutex.isLocked()).toBe(true);

      expect(mutex.release()).toBe(true);
      expect(mutex.isLocked()).toBe(false);
      expect(mutex.getSpuriousReleaseCount()).toBe(0);
    });

    it('returns false and counts a release on an unlocked mutex', () => {
      const mutex = new Mutex();

      expect(mutex.release()).toBe(false);
      expect(mutex.getSpuriousReleaseCount()).toBe(1);
      expect(mutex.isLocked()).toBe(false);
    });

    it('returns false and counts a double release without breaking later use', async () => {
      const mutex = new Mutex();
      await mutex.acquire();

      expect(mutex.release()).toBe(true);
      expect(mutex.release()).toBe(false);
      expect(mutex.getSpuriousReleaseCount()).toBe(1);

      await mutex.acquire();
      expect(mutex.isLocked()).toBe(true);
      expect(mutex.release()).toBe(true);
    });
  });

  describe('holder watchdog', () => {
    it('reports a hanging holder through the hook and counter, leaving the lock held', async () => {
      useTimerClock();
      try {
        const seen: Array<{ lockDurationMs: number; thresholdMs: number }> = [];
        const mutex = new Mutex({
          timeoutMs: 1000,
          holderTimeoutMs: 200,
          onHolderTimeout: (info) => {
            seen.push(info);
          },
        });

        await mutex.acquire();
        await vi.advanceTimersByTimeAsync(200);

        expect(seen.length).toBe(1);
        expect(seen[0]).toMatchObject({ thresholdMs: 200 });
        expect(seen[0]?.lockDurationMs).toBeGreaterThanOrEqual(200);
        expect(mutex.getHangDetectedCount()).toBe(1);

        // One-shot per hold: further time does not re-report the same hold.
        await vi.advanceTimersByTimeAsync(1000);
        expect(mutex.getHangDetectedCount()).toBe(1);
        expect(mutex.isLocked()).toBe(true);

        expect(mutex.release()).toBe(true);

        // Disarmed after unlock: no late report.
        await vi.advanceTimersByTimeAsync(5000);
        expect(mutex.getHangDetectedCount()).toBe(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('stays silent when the holder releases before the threshold', async () => {
      useTimerClock();
      try {
        let calls = 0;
        const mutex = new Mutex({
          timeoutMs: 1000,
          holderTimeoutMs: 200,
          onHolderTimeout: () => {
            calls++;
          },
        });

        await mutex.acquire();
        await vi.advanceTimersByTimeAsync(100);
        expect(mutex.release()).toBe(true);

        await vi.advanceTimersByTimeAsync(5000);
        expect(calls).toBe(0);
        expect(mutex.getHangDetectedCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it('defaults the holder threshold to timeoutMs', async () => {
      useTimerClock();
      try {
        let calls = 0;
        const mutex = new Mutex({
          timeoutMs: 500,
          onHolderTimeout: () => {
            calls++;
          },
        });

        await mutex.acquire();
        await vi.advanceTimersByTimeAsync(499);
        expect(calls).toBe(0);

        await vi.advanceTimersByTimeAsync(1);
        expect(calls).toBe(1);
        expect(mutex.getHangDetectedCount()).toBe(1);

        expect(mutex.release()).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it('re-arms the watchdog when the lock transfers to the next holder', async () => {
      useTimerClock();
      try {
        let calls = 0;
        const mutex = new Mutex({
          timeoutMs: 10000,
          holderTimeoutMs: 300,
          onHolderTimeout: () => {
            calls++;
          },
        });

        await mutex.acquire();
        const second = mutex.acquire();

        await vi.advanceTimersByTimeAsync(300);
        expect(calls).toBe(1);

        expect(mutex.release()).toBe(true);
        await second;

        await vi.advanceTimersByTimeAsync(300);
        expect(calls).toBe(2);
        expect(mutex.getHangDetectedCount()).toBe(2);

        expect(mutex.release()).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it('leaves waiter timeout behavior unchanged', async () => {
      useTimerClock();
      try {
        const mutex = new Mutex({ timeoutMs: 400, holderTimeoutMs: 10000 });

        await mutex.acquire();
        const pending = mutex.acquire();
        vi.advanceTimersByTime(400);
        await expect(pending).rejects.toThrow(
          'Mutex acquisition timeout after 400ms',
        );

        expect(mutex.getQueueSize()).toBe(0);
        expect(mutex.isLocked()).toBe(true);
        expect(mutex.release()).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
