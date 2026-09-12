/**
 * singleFlight.ts — one seam for "collapse concurrent duplicates" (PBI
 * 2026-09-12-30).
 *
 * Five sites used to hand-roll this: notification handlers (join by URL),
 * context menu (drop by tab), RemoteAIService (join by url::tagMode),
 * VisitReporter (boolean drop), archive-create (boolean flag). Each with its
 * own finally-cleanup spelling. `SingleFlight<K>` owns the map + policy;
 * callers become thin adapters.
 *
 * - `'join'`: concurrent same-key callers await the in-flight promise and
 *   share its outcome (notification semantics).
 * - `'drop'`: concurrent same-key callers return immediately (menu/reporter
 *   semantics); after completion a new run may start.
 *
 * Exclusion primitives (Mutex / PerUrlMutexMap / PersistentRetryQueue lock)
 * are a different concern — they serialize, not dedupe — and stay as-is.
 */

export interface SingleFlightEntry {
    promise: Promise<void>;
}

export type SingleFlightPolicy = 'join' | 'drop';

export class SingleFlight<K> {
    private inFlight = new Map<K, Promise<void>>();

    /**
     * Run `fn` under the dedupe policy.
     * - join: if a run for `key` is in flight, await it and share its outcome
     *   (including rejection — the original notification semantics).
     * - drop: if a run for `key` is in flight, return immediately without
     *   running and without awaiting it (failures of the in-flight run are
     *   not propagated to the dropped caller). After the in-flight run
     *   completes, a new call may start.
     */
    run(key: K, fn: () => Promise<void>, policy: SingleFlightPolicy): Promise<void> {
        const existing = this.inFlight.get(key);
        if (existing) {
            return policy === 'join' ? existing : Promise.resolve();
        }

        const promise = (async () => {
            try {
                await fn();
            } finally {
                this.inFlight.delete(key);
            }
        })();
        this.inFlight.set(key, promise);
        // The initiator always gets the raw promise — it owns the run and
        // must observe its own failure (contextMenu's catch logs it).
        return promise;
    }

    /** Whether a run for `key` is in flight (test/diagnostics seam). */
    has(key: K): boolean {
        return this.inFlight.has(key);
    }

    /** Drop all state (test seam). */
    clear(): void {
        this.inFlight.clear();
    }
}
