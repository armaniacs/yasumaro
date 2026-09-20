/**
 * TypeScript wrapper around the Rust/WASM tag-cooccurrence core.
 *
 * Ports `computeTagCooccurrence` and `narrowEntriesToTopTags` from
 * src/dashboard/tagCooccurrence.ts (see wasm/tag-cooccur/src/cooccur.rs
 * for the parity contracts, including the JS-whitespace table, the UTF-16
 * sort comparator, and the MAX_TAGS_PER_RECORD fail-safe cap). The intended
 * caller is src/dashboard/tagCooccurrenceHybrid.ts, which falls back to the
 * TS implementation when this module fails to load.
 *
 * Data-transfer shape: the call sends the records' raw `tags` strings once
 * (a single JS→WASM `\n`-joined string copy plus the record count) and
 * receives a small object back — the tag table plus integer edge index
 * arrays. The O(T^2) pair scan runs entirely inside WASM without JS GC
 * pressure; no per-record Set<string> is ever materialized on the JS side.
 *
 * The `|`-in-tag quirk is reproduced HERE, not in Rust: the TS reference
 * merges edges in a Map keyed by the RAW string key (`${a}|${b}`,
 * tagCooccurrence.ts:43-44) and decodes each entry with `key.split('|')`.
 * The core returns index pairs (no string-key merging), so the wrapper
 * re-merges weights by the reconstructed raw key before decoding — a tag
 * like `a|b` then corrupts and merges the edge exactly the way the TS
 * reference does (bit-identical output, verified by the parity suite).
 *
 * Loading follows the shared contract in `../initWasm.ts`: binary at the
 * stable public path `wasm/tag_cooccur_bg.wasm` (fetched via
 * `chrome.runtime.getURL()`). STAGED state: the public copy and the
 * wxt.config.ts publicAssets entry are intentionally deferred until the
 * hybrid is wired into a production call site (see wxt.config.ts
 * publicAssets), so in the current tree ONLY the committed src copy exists
 * — tests and bench read it directly from disk, and a production call to
 * initTagCooccurWasm() would 404 until integration restores the public
 * path. Do NOT switch this to
 * `new URL('./tag_cooccur_bg.wasm', import.meta.url)` — under the
 * single-file IIFE background build Vite inlines that as a CSP-blocked
 * `data:` URI and the module silently fails in every real build (see
 * src/wasm/pii-sanitizer/index.ts's module doc for the full story).
 */

import initWasmModule, {
    computeCooccurrence as computeCooccurrenceWasm,
    narrowToTopTags as narrowToTopTagsWasm,
} from './tagCooccurWasm.js';
import { initExtensionWasm } from '../initWasm.js';
import { errorMessage } from '../../utils/errorUtils.js';
import type { TagNode, TagEdge } from '../../dashboard/tagCooccurrence.js';

/**
 * Initializes the wasm module. Safe to call repeatedly (idempotent) and
 * from multiple call sites — all callers share the same in-flight promise
 * so the binary is fetched/compiled exactly once per worker lifetime,
 * with reset-on-failure so a transient fetch error can be retried.
 */
export function initTagCooccurWasm(): Promise<void> {
    return initExtensionWasm('tag_cooccur_bg.wasm', (url) =>
        initWasmModule({ module_or_path: url })
    );
}

export interface WasmCooccurResult {
    nodes: TagNode[];
    edges: TagEdge[];
}

export interface RawCooccurResult {
    tags: string[];
    counts: number[];
    edgeA: number[];
    edgeB: number[];
    weights: number[];
}

interface RawNarrowResult {
    unchanged: boolean;
    joined: string;
}

/**
 * Joins raw tags strings for the single-copy transfer. `null`/undefined
 * normalize to `""`, which parses to no tags — exactly like the TS
 * reference's `parseTagsForDisplay(entry.tags)`. Exported so the bench
 * harness times the identical production transfer path.
 */
export function joinRawTags(entries: Array<{ tags?: string | null }>): string {
    return entries.map((e) => e.tags ?? '').join('\n');
}

/**
 * Runs the WASM cooccurrence scan. Must call initTagCooccurWasm() first (or
 * await it here) — throws if the module isn't loaded, if the core rejects
 * the input (e.g. a raw tags string containing `\n` trips the
 * split-agreement gate), or if an edge index is out of range; callers treat
 * any throw as "fall back to the TS path".
 */
export async function computeCooccurrenceWithWasm(
    entries: Array<{ tags?: string | null }>
): Promise<WasmCooccurResult> {
    await initTagCooccurWasm();
    try {
        if (entries.length === 0) {
            return { nodes: [], edges: [] };
        }
        const raw = computeCooccurrenceWasm(
            joinRawTags(entries),
            entries.length
        ) as RawCooccurResult;
        return decodeCooccurResult(raw);
    } catch (error: unknown) {
        throw error instanceof Error ? error : new Error(errorMessage(error));
    }
}

/**
 * Validates the raw WASM result and reconstructs the TS reference's exact
 * output shape: nodes in first-seen tag order, edge weights merged by the
 * raw string key, then decoded with `key.split('|')`. Exported so the bench
 * harness times the identical production decode path.
 */
export function decodeCooccurResult(raw: RawCooccurResult): WasmCooccurResult {
    if (
        !Array.isArray(raw.tags) ||
        !Array.isArray(raw.counts) ||
        !Array.isArray(raw.edgeA) ||
        !Array.isArray(raw.edgeB) ||
        !Array.isArray(raw.weights) ||
        raw.tags.length !== raw.counts.length ||
        raw.edgeA.length !== raw.edgeB.length ||
        raw.edgeA.length !== raw.weights.length
    ) {
        throw new Error('tag-cooccur wasm returned a malformed result shape');
    }
    const outOfRange = (i: number) =>
        !Number.isInteger(i) || i < 0 || i >= raw.tags.length;
    if (raw.edgeA.some(outOfRange) || raw.edgeB.some(outOfRange)) {
        throw new Error('tag-cooccur wasm returned out-of-range edge indices');
    }
    const nodes: TagNode[] = raw.tags.map((tag, i) => ({
        tag,
        count: raw.counts[i]!,
    }));
    // The TS reference increments weights in a Map keyed by the raw
    // `${a}|${b}` string (tagCooccurrence.ts:43-44) — index-distinct pairs
    // that collide on that key (tags containing `|`) must merge here too,
    // BEFORE the split-decode, or the outputs diverge for such tags.
    // Fast path: with no `|` in any tag the raw string key is a bijection
    // of the index pair, so the merge is a no-op and the split-decode is
    // the identity — skip the per-edge key build entirely.
    let edges: TagEdge[];
    if (raw.tags.some((t) => t.includes('|'))) {
        const edgeWeights = new Map<string, number>();
        for (let k = 0; k < raw.edgeA.length; k++) {
            const key = `${raw.tags[raw.edgeA[k]!]!}|${raw.tags[raw.edgeB[k]!]!}`;
            edgeWeights.set(key, (edgeWeights.get(key) ?? 0) + raw.weights[k]!);
        }
        edges = Array.from(edgeWeights.entries()).map(([key, weight]) => {
            const [source, target] = key.split('|');
            return { source: source ?? '', target: target ?? '', weight };
        });
    } else {
        edges = raw.edgeA.map((a, k) => ({
            source: raw.tags[a]!,
            target: raw.tags[raw.edgeB[k]!]!,
            weight: raw.weights[k]!,
        }));
    }
    return { nodes, edges };
}

/**
 * Runs the WASM top-tags narrowing. Returns the input array by reference
 * when the core reports `unchanged` (mirroring the TS early return).
 * Rejects non-integer/negative limits and values above the u32 range at
 * the boundary — the JS→WASM u32 conversion would silently wrap them via
 * ToUint32, so callers must route those to the TS path before calling
 * this.
 */
export async function narrowEntriesToTopTagsWithWasm<
    T extends { tags?: string | null },
>(entries: T[], limit: number): Promise<T[]> {
    await initTagCooccurWasm();
    try {
        if (!Number.isInteger(limit) || limit < 0 || limit > 0xffffffff) {
            throw new Error(
                `tag-cooccur wasm: limit must be a non-negative integer below 2^32 (got ${limit})`
            );
        }
        const raw = narrowToTopTagsWasm(
            joinRawTags(entries),
            entries.length,
            limit
        ) as RawNarrowResult;
        if (raw.unchanged) {
            return entries;
        }
        if (typeof raw.joined !== 'string') {
            throw new Error('tag-cooccur wasm returned a malformed narrow result');
        }
        const pieces = raw.joined.split('\n');
        if (pieces.length !== entries.length) {
            throw new Error(
                `tag-cooccur wasm narrow split mismatch (wasm ${pieces.length} vs ` +
                    `js ${entries.length} records)`
            );
        }
        return entries.map((entry, i) => ({ ...entry, tags: pieces[i]! }));
    } catch (error: unknown) {
        throw error instanceof Error ? error : new Error(errorMessage(error));
    }
}
