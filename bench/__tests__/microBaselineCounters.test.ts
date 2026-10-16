/**
 * Provenance pin for the micro-benchmark baseline (Ops/Performance review
 * 2026-10-15: "bench ベースライン再導出が CI ゲート対象カウンタを説明なしに再設定している").
 *
 * bench/harness/report.mjs gates every `*.counter_*` metric (except
 * `counter_callback_ms`): for identical code these are identical integers run
 * to run, so the committed value IS the regression contract. A silent
 * re-baseline can absorb a real regression into a lowered counter with no
 * review trail — commit ac1c43a8 moved `c1.*.counter_encode` 8→2,
 * `c5.*.counter_schedule_calls` 121→1, `c6.*.counter_query_calls` 56→4 in a
 * commit described as "treeWalker metrics only".
 *
 * This test pins the current gated values. Any re-baseline that moves a
 * counter fails here, forcing the movement into a reviewed diff: update this
 * snapshot in the same commit and explain each moved counter in the commit
 * body (the same discipline test-perf.budget.json already demands with
 * "Raising a gate requires an ADR note").
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const baseline = JSON.parse(
    readFileSync(new URL('../baselines/micro.json', import.meta.url), 'utf-8'),
) as Record<string, number>;

/** Same predicate as gatesRegression() in bench/harness/report.mjs. */
function isGatedCounter(metricKey: string): boolean {
    if (metricKey.endsWith('.counter_callback_ms')) return false;
    return metricKey.includes('.counter_');
}

/** Snapshot of every CI-gated counter in bench/baselines/micro.json (2026-10-15). */
const GATED_COUNTER_SNAPSHOT: Record<string, number> = {
    'c1.L.counter_encode': 2,
    'c1.L.counter_qsa': 1996,
    'c1.L.counter_reflow': 0,
    'c1.L.counter_treeWalker': 385,
    'c1.M.counter_encode': 2,
    'c1.M.counter_qsa': 556,
    'c1.M.counter_reflow': 0,
    'c1.M.counter_treeWalker': 97,
    'c1.S.counter_encode': 2,
    'c1.S.counter_qsa': 196,
    'c1.S.counter_reflow': 0,
    'c1.S.counter_treeWalker': 25,
    'c2.L.counter_qsa': 2,
    'c2.L.counter_reflow': 0,
    'c2.L.counter_treeWalker': 2768,
    'c2.M.counter_qsa': 2,
    'c2.M.counter_reflow': 0,
    'c2.M.counter_treeWalker': 692,
    'c2.S.counter_qsa': 2,
    'c2.S.counter_reflow': 0,
    'c2.S.counter_treeWalker': 173,
    'c3-shadow.L.counter_qsa': 33,
    'c3-shadow.L.counter_reflow': 0,
    'c3-shadow.L.counter_treeWalker': 589,
    'c3-shadow.M.counter_qsa': 9,
    'c3-shadow.M.counter_reflow': 0,
    'c3-shadow.M.counter_treeWalker': 149,
    'c3-shadow.S.counter_qsa': 3,
    'c3-shadow.S.counter_reflow': 0,
    'c3-shadow.S.counter_treeWalker': 39,
    'c3.L.counter_qsa': 1,
    'c3.L.counter_reflow': 0,
    'c3.L.counter_treeWalker': 944,
    'c3.M.counter_qsa': 1,
    'c3.M.counter_reflow': 0,
    'c3.M.counter_treeWalker': 240,
    'c3.S.counter_qsa': 1,
    'c3.S.counter_reflow': 0,
    'c3.S.counter_treeWalker': 64,
    'c4.L.counter_clone': 1,
    'c4.L.counter_qsa': 1996,
    'c4.L.counter_treeWalker': 385,
    'c4.M.counter_clone': 1,
    'c4.M.counter_qsa': 556,
    'c4.M.counter_treeWalker': 97,
    'c4.S.counter_clone': 1,
    'c4.S.counter_qsa': 196,
    'c4.S.counter_treeWalker': 25,
    'c5.L.counter_schedule_calls': 1,
    'c5.M.counter_schedule_calls': 1,
    'c5.S.counter_schedule_calls': 1,
    'c6.L.counter_query_calls': 4,
    'c6.L.counter_storage_get': 0,
    'c6.L.counter_storage_set': 0,
    'c6.M.counter_query_calls': 4,
    'c6.M.counter_storage_get': 0,
    'c6.M.counter_storage_set': 0,
    'c6.S.counter_query_calls': 4,
    'c6.S.counter_storage_get': 0,
    'c6.S.counter_storage_set': 0,
    'cleansing.L.counter_qsa': 1907,
    'cleansing.L.counter_treeWalker': 0,
    'cleansing.M.counter_qsa': 986,
    'cleansing.M.counter_treeWalker': 0,
    'cleansing.S.counter_qsa': 257,
    'cleansing.S.counter_treeWalker': 0,
};

describe('bench micro baseline gated counters', () => {
    it('matches the committed snapshot (a re-baseline must update this table in the same commit)', () => {
        const gated = Object.fromEntries(
            Object.entries(baseline).filter(([key]) => isGatedCounter(key)),
        );
        expect(gated).toEqual(GATED_COUNTER_SNAPSHOT);
    });

    it('keeps every gated counter a finite number (NaN/null silently un-gates the metric)', () => {
        for (const [key, value] of Object.entries(baseline)) {
            if (!isGatedCounter(key)) continue;
            expect(Number.isFinite(value), `${key}=${String(value)}`).toBe(true);
        }
    });
});
