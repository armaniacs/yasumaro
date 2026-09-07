/**
 * fakeScheduler.ts
 * Test-support Scheduler — deterministic stand-in for IdleScheduler.
 *
 * Moved verbatim from contentKernel.ts (PBI-14 test-support relocation).
 * Production code must not import this module; tests import it from here.
 */

import type { Scheduler } from '../contentKernel.js';

export class FakeScheduler implements Scheduler {
    private nextId = 1;
    private tasks = new Map<number, { cb: () => void; delayMs: number | undefined }>();
    /** All delays passed to schedule (in order) */
    public delays: Array<number | undefined> = [];
    /** Last delay passed to schedule */
    public lastDelay: number | undefined = undefined;
    schedule(callback: () => void, delayMs?: number): number {
        const id = this.nextId++;
        this.tasks.set(id, { cb: callback, delayMs: delayMs });
        this.delays.push(delayMs);
        this.lastDelay = delayMs;
        return id;
    }
    cancel(id: number): void {
        this.tasks.delete(id);
    }
    flush(): void {
        const pending = [...this.tasks.values()];
        this.tasks.clear();
        for (const { cb } of pending) cb();
    }
    pendingCount(): number {
        return this.tasks.size;
    }
    pendingDelays(): Array<number | undefined> {
        return [...this.tasks.values()].map((v) => v.delayMs);
    }
}
