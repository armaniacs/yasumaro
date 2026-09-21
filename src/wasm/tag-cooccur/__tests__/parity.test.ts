/**
 * Parity check: for every corpus input below, the WASM tag-cooccurrence
 * core mapped back through src/wasm/tag-cooccur/index.ts must reconstruct
 * EXACTLY what the TS reference (src/dashboard/tagCooccurrence.ts)
 * returns. This is the regression gate for the WASM port: any
 * wasm/tag-cooccur change that breaks parity here must not ship (same gate
 * contract as the pii-sanitizer / sentence-dedup parity suites).
 *
 * The corpus covers the verified TS quirks (fixed by the STEP 2 probe,
 * outputs/probes/quirks-result.json): `#`/comma dual formats, the lone-`#`
 * comma-fallback quirk, the `|`-in-tag edge-key corruption, per-record
 * dedup + first-N cap, UTF-16 sort order (incl. astral vs PUA divergence
 * from scalar order), first-seen node/edge order, empty-record skipping,
 * narrow tie-breaks/rebuild/identity, and stable limitToTopNodes ties
 * (TS-only, documented as out of scope for the core).
 */

import { describe, test, expect, beforeAll } from 'vitest';
import {
    computeTagCooccurrence,
    narrowEntriesToTopTags,
} from '../../../dashboard/tagCooccurrence.js';
import {
    computeCooccurrenceWithWasm,
    narrowEntriesToTopTagsWithWasm,
} from '../index.js';
import initWasmModule, {
    computeCooccurrence,
    narrowToTopTags,
} from '../tagCooccurWasm.js';
import { initWasmForNode } from '../../testing/initWasmForNode.js';

type Entry = { tags?: string | null };

const COOCCUR_CORPUS: Entry[][] = [
    [],
    [{ tags: null }, { tags: '' }, {}],
    [{ tags: '#tech' }],
    [{ tags: '#tech #ai' }],
    [{ tags: '#ai #tech' }],
    [{ tags: '#a #b #c' }],
    [{ tags: '#a #a #b' }],
    // `|`-in-tag edge-key corruption quirk (TS drops `c` from the edge).
    [{ tags: '#a|b #c' }],
    [{ tags: '#x|y #x|y' }],
    // `|` collision: index-distinct pairs (`a`,`b|c`) and (`a|b`,`c`) share
    // the raw edge key `a|b|c` — TS merges weights on that string key
    // BEFORE the split-decode, so the wrapper must too (single edge
    // {a, b} weight 2, not two duplicate edges).
    [{ tags: '#a #b|c' }],
    [{ tags: '#a #b|c' }, { tags: '#a|b #c' }],
    [{ tags: '#a|b #c' }, { tags: '#a #b|c' }],
    // Comma form and mixed forms.
    [{ tags: 'b, a' }],
    [{ tags: '  tech ,  ai  ' }],
    [{ tags: '#a,b #c' }],
    // Lone-`#` comma-fallback quirk.
    [{ tags: '# , tech, ai' }],
    [{ tags: '#' }],
    // Unicode incl. astral-plane tags (UTF-16 sort order).
    [{ tags: '#z #あ #ア #Z #🎉 #é' }],
    [{ tags: '#\u{E000} #🎉' }],
    [{ tags: '#あ　#い' }],
    // NOTE: `{ tags: '#a\n#b' }` is intentionally NOT in this exact-parity
    // list: the `\n`-joined transfer cannot carry an embedded newline, so the
    // core rejects at the split-agreement gate and the hybrid falls back to
    // TS (pinned by the fallback test below).
    // First-seen node/edge order across entries.
    [{ tags: '#b #a' }, { tags: '#c #a' }],
    [{ tags: '#x' }, { tags: '#x #y' }],
    [{ tags: '' }, { tags: '#a' }],
    // 60-tag record exercises the first-50 cap (1225 edges).
    [
        {
            tags: Array.from({ length: 60 }, (_, i) => `#t${String(i).padStart(2, '0')}`).join(' '),
        },
    ],
    // Duplicate-heavy records with cap interaction.
    [{ tags: Array.from({ length: 100 }, (_, i) => `#d${i % 10}`).join(' ') }],
];

const NARROW_CORPUS: Array<{ entries: Entry[]; limit: number }> = [
    { entries: [{ tags: '#a' }], limit: 50 },
    { entries: [{ tags: '#b' }, { tags: '#a' }, { tags: '#c' }], limit: 2 },
    { entries: [{ tags: 'b, a' }, { tags: 'a, c' }], limit: 2 },
    { entries: [{ tags: '#a #a #b' }], limit: 50 },
    { entries: [{ tags: '#a #a #b' }, { tags: '#c' }], limit: 2 },
    { entries: [{ tags: '#z #あ' }, { tags: '#ア #Z' }, { tags: '#🎉 #é' }], limit: 3 },
    { entries: [{ tags: '#a|b #c' }, { tags: '#c #d' }], limit: 2 },
    { entries: [{ tags: null }, { tags: '#a' }], limit: 1 },
    { entries: [], limit: 10 },
    { entries: [{ tags: '#a' }, { tags: '#b' }], limit: 0 },
];

async function initForNode(): Promise<void> {
    await initWasmForNode(initWasmModule, new URL('../tag_cooccur_bg.wasm', import.meta.url));
}

function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const WEIRD_TAGS = ['a|b', 'x,y', 'あ', '🎉', '#', 'a b', 'é', '\u{E000}', 't'];

function randomEntries(n: number, maxTags: number, seed: number): Entry[] {
    const rand = mulberry32(seed);
    const pool = Array.from({ length: 60 }, (_, i) => `tag${i}`).concat(WEIRD_TAGS);
    const out: Entry[] = [];
    for (let i = 0; i < n; i++) {
        const k = Math.floor(rand() * (maxTags + 1));
        const tags: string[] = [];
        for (let j = 0; j < k; j++) {
            const t = pool[Math.floor(rand() * pool.length)]!;
            tags.push(t.includes(' ') || t.includes(',') || t === '#' ? t : `#${t}`);
        }
        const r = rand();
        out.push(r < 0.05 ? { tags: null } : r < 0.1 ? {} : { tags: tags.join(r < 0.5 ? ' ' : ', ') });
    }
    return out;
}

describe('WASM vs TS tag-cooccurrence parity', () => {
    beforeAll(async () => {
        await initForNode();
    });

    test.each(COOCCUR_CORPUS.map((entries) => [entries]))(
        'cooccur corpus %# matches TS output exactly',
        async (entries) => {
            const ts = computeTagCooccurrence(entries!);
            const wasm = await computeCooccurrenceWithWasm(entries!);
            expect(wasm).toEqual(ts);
        }
    );

    test.each(NARROW_CORPUS)('narrow corpus %# matches TS output exactly', async ({ entries, limit }) => {
        const ts = narrowEntriesToTopTags(entries, limit);
        const wasm = await narrowEntriesToTopTagsWithWasm(entries, limit);
        expect(wasm).toEqual(ts);
    });

    test('narrow identity case returns the same reference', async () => {
        const entries: Entry[] = [{ tags: '#a' }];
        expect(await narrowEntriesToTopTagsWithWasm(entries, 50)).toBe(entries);
    });

    test('randomized differential: cooccur matches TS on 3 seeds', async () => {
        for (const seed of [1, 7, 42]) {
            const entries = randomEntries(200, 12, seed);
            expect(await computeCooccurrenceWithWasm(entries)).toEqual(
                computeTagCooccurrence(entries)
            );
        }
    });

    test('randomized differential: narrow matches TS on 3 seeds', async () => {
        for (const seed of [3, 11, 99]) {
            const entries = randomEntries(200, 12, seed);
            for (const limit of [5, 20]) {
                expect(await narrowEntriesToTopTagsWithWasm(entries, limit)).toEqual(
                    narrowEntriesToTopTags(entries, limit)
                );
            }
        }
    });

    test('embedded newline in raw tags rejects at the gate (TS fallback owns it)', async () => {
        // A raw tags string containing `\n` shifts the record split, so the
        // core must reject rather than emit shifted output (sync throw from
        // the wasm-bindgen Result binding).
        expect(() => computeCooccurrence('a\nb', 1)).toThrow();
        expect(() => narrowToTopTags('a\nb', 1, 10)).toThrow();
    });

    test('non-integer/negative narrow limits are rejected at the wrapper boundary', async () => {
        await expect(narrowEntriesToTopTagsWithWasm([{ tags: '#a' }], -1)).rejects.toThrow();
        await expect(narrowEntriesToTopTagsWithWasm([{ tags: '#a' }], 2.5)).rejects.toThrow();
        // The 2^32 upper bound is owned by the hybrid bypass (`isWasmSafeU32`
        // in tagCooccurrenceHybrid.ts), which routes it to TS before the
        // wrapper is reached — pinned in tagCooccurrenceHybrid.test.ts, not
        // here.
    });
});
