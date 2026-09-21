// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IdleScheduler } from '../contentKernel.js';

type SchedulerInternals = {
    timeoutIds: Set<number>;
    idleIds: Set<number>;
};

function internals(s: IdleScheduler): SchedulerInternals {
    return s as unknown as SchedulerInternals;
}

describe('IdleScheduler — schedule/cancel tracking', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
        delete (window as unknown as { requestIdleCallback?: unknown }).requestIdleCallback;
        delete (window as unknown as { cancelIdleCallback?: unknown }).cancelIdleCallback;
    });

    it('schedule with delayMs returns an id tracked in timeoutIds; cancel removes it', () => {
        const s = new IdleScheduler();
        const id = s.schedule(() => {}, 100);
        expect(id).toBeDefined();
        expect(internals(s).timeoutIds.has(id)).toBe(true);
        s.cancel(id);
        expect(internals(s).timeoutIds.has(id)).toBe(false);
    });

    it('fired timeout id is pruned from timeoutIds', () => {
        const s = new IdleScheduler();
        const cb = vi.fn();
        const id = s.schedule(cb, 100);
        expect(internals(s).timeoutIds.has(id)).toBe(true);
        vi.advanceTimersByTime(100);
        expect(cb).toHaveBeenCalledTimes(1);
        expect(internals(s).timeoutIds.has(id)).toBe(false);
    });

    it('fallback (no delayMs, no requestIdleCallback) fires and prunes timeoutIds', () => {
        const s = new IdleScheduler();
        const cb = vi.fn();
        const id = s.schedule(cb);
        expect(internals(s).timeoutIds.has(id)).toBe(true);
        vi.advanceTimersByTime(1000);
        expect(cb).toHaveBeenCalledTimes(1);
        expect(internals(s).timeoutIds.has(id)).toBe(false);
    });

    it('fired idle id is pruned from idleIds (requestIdleCallback path)', () => {
        let nextId = 1;
        const pending = new Map<number, () => void>();
        (window as unknown as { requestIdleCallback: unknown }).requestIdleCallback = vi.fn(
            (cb: () => void) => {
                const id = nextId++;
                pending.set(id, cb);
                return id;
            },
        );
        (window as unknown as { cancelIdleCallback: unknown }).cancelIdleCallback = vi.fn((id: number) => {
            pending.delete(id);
        });
        const s = new IdleScheduler();
        const cb = vi.fn();
        const id = s.schedule(cb);
        expect(internals(s).idleIds.has(id)).toBe(true);
        pending.get(id)!();
        expect(cb).toHaveBeenCalledTimes(1);
        expect(internals(s).idleIds.has(id)).toBe(false);
    });

    it('cancel-then-fire of a pending timeout is a safe no-op (double delete)', () => {
        const s = new IdleScheduler();
        const cb = vi.fn();
        const id = s.schedule(cb, 100);
        s.cancel(id);
        expect(() => vi.advanceTimersByTime(200)).not.toThrow();
        expect(cb).not.toHaveBeenCalled();
        expect(internals(s).timeoutIds.has(id)).toBe(false);
        expect(() => s.cancel(id)).not.toThrow();
    });

    it('cancelling an already-fired id is a safe no-op', () => {
        const s = new IdleScheduler();
        const id = s.schedule(vi.fn(), 50);
        vi.advanceTimersByTime(50);
        expect(internals(s).timeoutIds.has(id)).toBe(false);
        expect(() => s.cancel(id)).not.toThrow();
    });

    it('prunes even when the callback throws', () => {
        const s = new IdleScheduler();
        const id = s.schedule(() => {
            throw new Error('boom');
        }, 10);
        expect(() => vi.advanceTimersByTime(10)).toThrow('boom');
        expect(internals(s).timeoutIds.has(id)).toBe(false);
    });
});
