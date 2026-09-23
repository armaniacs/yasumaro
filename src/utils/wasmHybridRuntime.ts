/**
 * wasmHybridRuntime.ts
 * Shared scaffold for the WASM-first hybrids (piiSanitizeHybrid,
 * sentenceExtractorHybrid, contentDedupHybrid): availability probe, numeric
 * boundary guards, fallback logging, and the index-remap contract live here
 * so a 4th core only wires its call plus its per-core policy.
 *
 * Probe contract (adopted from src/dashboard/tagCooccurrenceHybrid.ts, the
 * 4th hybrid — now migrated onto this runtime): success is cached permanently
 * per probe instance; failure is NOT cached, so the next call re-probes (the
 * lower initExtensionWasm layer already dedupes concurrent inits and resets on
 * failure, so a transient fetch/CSP/startup failure recovers instead of
 * pinning every later call to the TS path); the probe-failure warn + addLog
 * pair is emitted at most once per failure burst, and a success clears the
 * burst flag so a later, separate burst logs again.
 *
 * Per-core policies STAY in each hybrid (PII MAX_INPUT_SIZE/MAX_SKIP_SIZE/
 * MAX_OUTPUT_SIZE handling, textrank topK>=1 quirk, dedup threshold-0/4KB
 * floor/fail-open cap) — this module owns mechanism only, never policy.
 * runHybrid() is the deep interface that fixes the skeleton order
 * (merge → early-return → isSafe → bypass → probe → fallback) so hybrids
 * declare policy data plus callWasm/callTs adapter rows.
 */

import { errorMessage } from './errorUtils.js';
import { addLog } from './logger/core.js';
import { LogType } from './logger/types.js';

/**
 * Max u32 value. Integers in [0, U32_MAX] pass through the JS->wasm u32
 * boundary unchanged (ToUint32 is the identity on that range); anything
 * outside — negatives, fractions, values >= 2^32 — wraps and would make the
 * WASM core see a different option than the TS reference, so it must bypass.
 */
export const U32_MAX = 0xffffffff;

/**
 * True for numbers that cross the JS->wasm u32 boundary unchanged: integers
 * in [0, 2^32 - 1]. Non-finite values, fractions, negatives, and values
 * >= 2^32 are rejected.
 */
export function isWasmSafeU32(value: number): boolean {
    return Number.isInteger(value) && value >= 0 && value <= U32_MAX;
}

/**
 * True for numbers that cross the JS->wasm f64 boundary with their meaning
 * intact: any finite value. NaN would make the core reject (or silently
 * change comparison semantics vs the TS reference), so it must bypass.
 */
export function isWasmSafeF64(value: number): boolean {
    return Number.isFinite(value);
}

export interface HybridProbe {
    /**
     * Probes WASM availability. See the module doc for the caching contract:
     * success cached permanently, failure re-probed on the next call.
     */
    isAvailable(): Promise<boolean>;
}

/**
 * Creates a stateful availability probe around a WASM init function.
 * Each hybrid owns one instance at module scope (fresh per context
 * lifetime, mirroring the init layer's own singleton-promise caching).
 */
export function createHybridProbe(
    initWasm: () => Promise<void>,
    unavailableMessage: string
): HybridProbe {
    let available: boolean | null = null;
    // Burst guard for the probe-failure warning: while the probe keeps
    // failing, the warn + addLog pair is emitted once per burst (first
    // failure only). A success clears it so a later burst logs again.
    let probeFailureLogged = false;

    async function isAvailable(): Promise<boolean> {
        if (available !== null) {
            return available;
        }
        try {
            await initWasm();
            available = true;
            probeFailureLogged = false;
        } catch (error: unknown) {
            // Failure is NOT cached: `available` stays null so the next call
            // re-probes and a transient failure can recover.
            if (!probeFailureLogged) {
                probeFailureLogged = true;
                const message = errorMessage(error);
                // addLog() persists to chrome.storage asynchronously and is
                // not readable from outside the service worker without a
                // dedicated message handler. A plain console.warn is also
                // emitted so the failure is visible in chrome://extensions'
                // "service worker" devtools console during manual debugging.
                console.warn(unavailableMessage, message);
                addLog(LogType.WARN, unavailableMessage, { error: message });
            }
        }
        return available === true;
    }

    return { isAvailable };
}

/**
 * Logs a WASM runtime-call failure (console.warn + persisted addLog, every
 * call — unlike the probe burst guard, each failed input is worth one line)
 * so the fallback to the TS path stays visible.
 */
export function logWasmFallback(fallbackMessage: string, error: unknown): void {
    const message = errorMessage(error);
    console.warn(fallbackMessage, message);
    addLog(LogType.WARN, fallbackMessage, { error: message });
}

/**
 * Runs the WASM path and falls back to the TS reference on ANY throw —
 * including the split-agreement gate below — rather than emitting wrong
 * output. A throwing TS fallback propagates (e.g. PII match-count overflow
 * fails closed instead of shipping partially-masked text).
 */
export async function withWasmFallback<T>(
    fallbackMessage: string,
    runWasm: () => Promise<T>,
    runTs: () => Promise<T> | T
): Promise<T> {
    try {
        return await runWasm();
    } catch (error: unknown) {
        logWasmFallback(fallbackMessage, error);
        return await runTs();
    }
}

export interface RunHybridPolicy<Merged, Result> {
    /** Availability probe owned by the calling hybrid (module scope). */
    probe: HybridProbe;
    /** console.warn + addLog message when the WASM call throws (TS fallback). */
    fallbackMessage: string;
    /**
     * Merges caller options with the TS reference defaults. Pure: must not
     * probe or log, since earlyReturn may discard the result. The merged
     * value threads through every later step; adapters capture the raw
     * inputs in closures and pass the ORIGINAL options object to callTs so
     * the fallback sees byte-identical arguments to the pre-refactor path.
     */
    mergeDefaults: () => Merged;
    /**
     * Reference-parity short-circuit on merged options (empty input,
     * threshold-0, zero entries). Returning non-undefined skips everything
     * else, including the probe — mirroring the TS reference, which returns
     * before any WASM contact on these inputs.
     */
    earlyReturn?: (merged: Merged) => Result | undefined;
    /**
     * Numeric-domain gate (isWasmSafeU32/isWasmSafeF64 plus per-core quirks
     * like textrank topK>=1). False routes to TS WITHOUT probing, so
     * out-of-domain options never initialize WASM.
     */
    isSafe?: (merged: Merged) => boolean;
    /**
     * Size/perf routing (bench-backed MIN_* floors). True routes to TS
     * WITHOUT probing: small inputs are faster on TS and cannot reach the
     * WASM caps, so skipping the probe is a pure win.
     */
    bypassWasm?: (merged: Merged) => boolean;
    /**
     * WASM path including per-core split/join shaping via remapWasmIndices.
     * Any throw — including the remap gate — falls back to callTs.
     */
    callWasm: (merged: Merged) => Promise<Result>;
    /** TS reference fallback. A throw propagates (PII fail-closed). */
    callTs: (merged: Merged) => Promise<Result> | Result;
}

/**
 * Deep interface for the WASM-first hybrids: defaults merge → early-return
 * → numeric gate → size bypass → probe → WASM with TS fallback, in that
 * order. Mechanism (probe contract, burst logging, remap gate, fallback
 * order) is fixed here; policies (defaults, early-return conditions, MIN_*
 * thresholds, split/join shaping) are declared per adapter in the policy
 * argument. Callers keep their existing signatures.
 */
export async function runHybrid<Merged, Result>(
    policy: RunHybridPolicy<Merged, Result>
): Promise<Result> {
    const merged = policy.mergeDefaults();
    if (policy.earlyReturn) {
        const early = policy.earlyReturn(merged);
        if (early !== undefined) {
            return early;
        }
    }
    if (policy.isSafe && !policy.isSafe(merged)) {
        return await policy.callTs(merged);
    }
    if (policy.bypassWasm && policy.bypassWasm(merged)) {
        return await policy.callTs(merged);
    }
    if (!(await policy.probe.isAvailable())) {
        return await policy.callTs(merged);
    }
    return withWasmFallback(
        policy.fallbackMessage,
        () => policy.callWasm(merged),
        () => policy.callTs(merged)
    );
}

export interface WasmIndexResult {
    /** Selected/kept indices into the core's own split, in order. */
    indices: number[] | readonly number[];
    /** Total parts the core's own split produced for the input. */
    sentenceCount: number;
}

/**
 * Split-agreement gate + index remap for cores that return indices into
 * their own sentence split (textrank, sentence-dedup).
 *
 * The caller passes the ALREADY-split parts from its per-core splitter —
 * splitter injection that absorbs the per-core difference (textrank's
 * trimmed `splitSentences` vs dedup's delimiter-bearing
 * `splitSentencesKeepDelimiters`): the runtime only verifies the two splits
 * agree (same part count; out-of-range indices rejected as belt-and-braces)
 * and returns the validated indices. The caller maps them to strings with
 * its own join (`sentences[i]` vs `parts[i].sentence + parts[i].delimiter`).
 *
 * Throws on any disagreement — the caller routes that through
 * withWasmFallback so a disagreeing split re-runs the TS path rather than
 * silently mapping to the wrong sentence.
 */
export function remapWasmIndices<TPart>(
    result: WasmIndexResult,
    parts: readonly TPart[],
    coreName: string,
    unitName: string
): number[] {
    if (result.sentenceCount !== parts.length) {
        throw new Error(
            `${coreName} wasm split mismatch (wasm ${result.sentenceCount} vs ` +
                `js ${parts.length} ${unitName})`
        );
    }
    if (result.indices.some((i) => i < 0 || i >= parts.length)) {
        throw new Error(
            `${coreName} wasm returned out-of-range indices (got ${result.indices.length} ` +
                `indices, ${parts.length} ${unitName})`
        );
    }
    return [...result.indices];
}

