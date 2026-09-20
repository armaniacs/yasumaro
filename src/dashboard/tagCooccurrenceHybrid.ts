/**
 * tagCooccurrenceHybrid.ts
 * Hybrid tag cooccurrence: runs the WASM core (see
 * wasm/tag-cooccur/src/cooccur.rs — an exact port of tagCooccurrence.ts's
 * computeTagCooccurrence + narrowEntriesToTopTags) on the success path and
 * falls back to the TS implementation (src/dashboard/tagCooccurrence.ts)
 * when the WASM module fails to initialize (e.g. CSP blocked the fetch, or
 * an unsupported runtime), when the input routes to TS by size, or when a
 * WASM call throws at runtime.
 *
 * Output parity: the WASM core returns a tag table plus integer edge index
 * pairs; this wrapper maps them back through src/wasm/tag-cooccur/index.ts,
 * which reproduces the TS edge-key decoding (`key.split('|')`) exactly —
 * including the `|`-in-tag corruption quirk. Any WASM failure re-runs the
 * TS path rather than emitting wrong output.
 *
 * Early-return parity with the TS reference:
 * - empty entries → `{ nodes: [], edges: [] }` (the TS loop is a no-op).
 * - narrow with unique-tag count within `limit` → the input array by
 *   reference (the core reports `unchanged`; the fallback TS path returns
 *   the same reference too).
 *
 * Guard rails mirrored from the TS original (defense in depth, the WASM
 * core enforces the same ones internally):
 * - `MAX_TAGS_PER_RECORD` (50) caps the per-record pair scan on both paths.
 * - narrow `limit` must be a non-negative integer: the JS→WASM u32 boundary
 *   silently wraps anything else via ToUint32 (e.g. -1 becomes 2^32-1),
 *   so out-of-domain limits bypass WASM and take the TS path.
 * - a raw tags string containing `\n` trips the core's split-agreement gate
 *   (the `\n`-joined transfer cannot carry it) and falls back to TS.
 */

import {
    computeTagCooccurrence,
    narrowEntriesToTopTags,
} from './tagCooccurrence.js';
import {
    computeCooccurrenceWithWasm,
    narrowEntriesToTopTagsWithWasm,
    initTagCooccurWasm,
} from '../wasm/tag-cooccur/index.js';
import { errorMessage } from '../utils/errorUtils.js';
import { addLog } from '../utils/logger/core.js';
import { LogType } from '../utils/logger/types.js';

let wasmAvailable: boolean | null = null;

/**
 * Probes WASM availability once per context lifetime (mirrors
 * initTagCooccurWasm's own singleton-promise caching) so a permanently
 * broken environment doesn't retry-and-fail on every call.
 */
async function isWasmAvailable(): Promise<boolean> {
    if (wasmAvailable !== null) {
        return wasmAvailable;
    }
    try {
        await initTagCooccurWasm();
        wasmAvailable = true;
    } catch (error: unknown) {
        wasmAvailable = false;
        const message = errorMessage(error);
        console.warn('Tag-cooccur WASM module unavailable, falling back to TS:', message);
        addLog(LogType.WARN, 'Tag-cooccur WASM module unavailable, falling back to TS', {
            error: message,
        });
    }
    return wasmAvailable;
}

/**
 * Below this record count the TS path is competitive or faster on the
 * production wrapper path (src/wasm/tag-cooccur/bench.ts + crossover probe
 * after the `|`-fast-path fix: 5 entries → 0.89x [the only measured loss,
 * sub-0.05ms either way], 10 → 1.10x, 20 → 1.05x, 32 → 1.13x, 64 → 1.20x,
 * 512 → 1.63x, 1024 → 2.02x, 4096 → 3.47x). 32 sits above the measured
 * loss with headroom below the consistent-win region; small inputs finish
 * in sub-milliseconds either way, so routing them to TS is a pure win —
 * same engine, fewer copies.
 */
const MIN_WASM_ENTRIES = 32;

/**
 * Computes tag cooccurrence with the WASM core, falling back to the sync TS
 * computeTagCooccurrence() on any WASM unavailability, size bypass, or
 * runtime error. Async so call sites must await it — the panel caller
 * (tagClusterPanel.load) is already async, so no sync→async migration wave.
 */
export async function computeTagCooccurrenceHybrid(
    entries: Array<{ tags?: string | null }>
): Promise<ReturnType<typeof computeTagCooccurrence>> {
    if (entries.length === 0) {
        return { nodes: [], edges: [] };
    }
    if (entries.length < MIN_WASM_ENTRIES || !(await isWasmAvailable())) {
        return computeTagCooccurrence(entries);
    }
    try {
        return await computeCooccurrenceWithWasm(entries);
    } catch (error: unknown) {
        const message = errorMessage(error);
        console.warn('Tag-cooccur WASM call failed, falling back to TS for this input:', message);
        addLog(LogType.WARN, 'Tag-cooccur WASM call failed, falling back to TS for this input', {
            error: message,
        });
        return computeTagCooccurrence(entries);
    }
}

/**
 * Narrows entries to the top-`limit` tags with the WASM core, falling back
 * to the sync TS narrowEntriesToTopTags() on the same conditions plus
 * out-of-domain limits (non-integer or negative — the u32 boundary would
 * wrap them).
 */
export async function narrowEntriesToTopTagsHybrid<T extends { tags?: string | null }>(
    entries: T[],
    limit: number
): Promise<T[]> {
    if (!Number.isInteger(limit) || limit < 0) {
        return narrowEntriesToTopTags(entries, limit);
    }
    if (entries.length < MIN_WASM_ENTRIES || !(await isWasmAvailable())) {
        return narrowEntriesToTopTags(entries, limit);
    }
    try {
        return await narrowEntriesToTopTagsWithWasm(entries, limit);
    } catch (error: unknown) {
        const message = errorMessage(error);
        console.warn('Tag-cooccur narrow WASM call failed, falling back to TS for this input:', message);
        addLog(LogType.WARN, 'Tag-cooccur narrow WASM call failed, falling back to TS for this input', {
            error: message,
        });
        return narrowEntriesToTopTags(entries, limit);
    }
}
