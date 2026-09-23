/**
 * scheduler.ts
 * Idle scheduling primitive for content scripts. Moved verbatim out of
 * contentKernel.ts (PBI 2026-09-23-08) so the kernel keeps orchestration
 * only. Content-script safe: uses globalThis/window timers, no SW-only
 * chrome APIs.
 */

export interface Scheduler {
    schedule(callback: () => void, delayMs?: number): number;
    cancel(id: number): void;
}

export class IdleScheduler implements Scheduler {
    private readonly timeoutIds = new Set<number>();
    private readonly idleIds = new Set<number>();
    private get win(): Window | undefined {
        return typeof globalThis !== 'undefined' ? (globalThis as unknown as { window?: Window }).window ?? (typeof window !== 'undefined' ? window : undefined) : undefined;
    }
    schedule(callback: () => void, delayMs?: number): number {
        if (delayMs !== undefined) {
            let id!: number;
            const wrapped = () => {
                try {
                    callback();
                } finally {
                    this.timeoutIds.delete(id);
                }
            };
            id = globalThis.setTimeout(wrapped, delayMs) as unknown as number;
            this.timeoutIds.add(id);
            return id;
        }
        const w = this.win as unknown as { requestIdleCallback?: (cb: () => void, opts: { timeout: number }) => number } | undefined;
        if (w?.requestIdleCallback) {
            let id!: number;
            const wrapped = () => {
                try {
                    callback();
                } finally {
                    this.idleIds.delete(id);
                }
            };
            id = w.requestIdleCallback(wrapped, { timeout: 2000 });
            this.idleIds.add(id);
            return id;
        }
        // Fallback: global setTimeout works in Node/jsdom and browsers
        let id!: number;
        const wrapped = () => {
            try {
                callback();
            } finally {
                this.timeoutIds.delete(id);
            }
        };
        id = globalThis.setTimeout(wrapped, 1000) as unknown as number;
        this.timeoutIds.add(id);
        return id;
    }
    cancel(id: number): void {
        if (this.timeoutIds.has(id)) {
            this.timeoutIds.delete(id);
            globalThis.clearTimeout(id as unknown as NodeJS.Timeout);
            return;
        }
        if (this.idleIds.has(id)) {
            this.idleIds.delete(id);
            const w = this.win as unknown as { cancelIdleCallback?: (id: number) => void } | undefined;
            if (w?.cancelIdleCallback) {
                w.cancelIdleCallback(id);
                return;
            }
        }
        // Fallback: try both
        try {
            globalThis.clearTimeout(id as unknown as NodeJS.Timeout);
        } catch {
            /* ignore */
        }
        const w = this.win as unknown as { cancelIdleCallback?: (id: number) => void } | undefined;
        try {
            w?.cancelIdleCallback?.(id);
        } catch {
            /* ignore */
        }
    }
}
