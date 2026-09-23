// @vitest-environment jsdom
/**
 * scheduler.test.ts (PBI 2026-09-23-08)
 * Pins the IdleScheduler move: the implementation lives in scheduler.js
 * and contentKernel.js keeps only a compat re-export. Behavioral depth is
 * covered by contentKernel.idleScheduler.test.ts (unchanged).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { IdleScheduler as FromScheduler } from '../scheduler.js';
import { IdleScheduler as FromKernel } from '../contentKernel.js';

describe('scheduler module move', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('kernel re-exports the same IdleScheduler class', () => {
        expect(FromKernel).toBe(FromScheduler);
    });

    it('schedules and cancels through the module import', () => {
        vi.useFakeTimers();
        const s = new FromScheduler();
        const cb = vi.fn();
        const id = s.schedule(cb, 100);
        s.cancel(id);
        vi.advanceTimersByTime(200);
        expect(cb).not.toHaveBeenCalled();
    });
});
