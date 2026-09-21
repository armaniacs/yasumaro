/**
 * wasm-crates-universe.test.ts — PBI 2026-09-21-26 manifest adoption completion.
 *
 * Covers the crate-universe extension (design A: `libCrates` second array +
 * top-level `paritySuites` map — `crates` entries untouched so build/stash/
 * restore/check/publicShip semantics cannot shift): universe resolution,
 * test/cache/parity derivation, set-equivalence with the pre-manifest
 * enumerations (package.json test:wasm chain, CI cache paths, CI parity
 * lines), and explicit failures (unknown lib field, cross-array duplicates,
 * unknown/missing parity keys, unresolvable lib dir).
 */
import { describe, it, expect } from 'vitest';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    loadManifest,
    validateManifest,
    buildPlan,
    crateUniverse,
    testCrateDirs,
    cacheTargetPaths,
    parityArgs,
} from '../wasm-crates.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Pre-manifest enumerations (the strings this PBI deletes elsewhere).
const OLD_TEST_CHAIN_DIRS = [
    'wasm/js-strings',
    'wasm/pii-sanitizer',
    'wasm/textrank',
    'wasm/sentence-dedup',
    'wasm/tag-cooccur',
];
const OLD_CACHE_PATHS = OLD_TEST_CHAIN_DIRS.map((dir) => `${dir}/target`);
const OLD_PARITY_ARGS = [
    'src/wasm/pii-sanitizer/__tests__/',
    'src/background/pipeline/__tests__/piiSanitizeHybrid.wasm-success.test.ts',
    'src/utils/__tests__/sentenceExtractorHybrid.wasm-success.test.ts',
    'src/wasm/sentence-dedup/__tests__/',
    'src/utils/__tests__/contentDedupHybrid.wasm-success.test.ts',
    'src/wasm/tag-cooccur/__tests__/',
    'src/dashboard/__tests__/tagCooccurrenceHybrid.wasm-success.test.ts',
];

describe('crate universe (PBI 2026-09-21-26)', () => {
    it('resolves 5 universe crates including lib-only js-strings, build crates first', () => {
        const manifest = loadManifest({ root: ROOT });
        expect(crateUniverse(manifest)).toEqual([
            'pii-sanitizer',
            'textrank',
            'sentence-dedup',
            'tag-cooccur',
            'js-strings',
        ]);
    });

    it('test dirs are set-equivalent to the old package.json shell chain', () => {
        const manifest = loadManifest({ root: ROOT });
        expect([...testCrateDirs(manifest)].sort()).toEqual([...OLD_TEST_CHAIN_DIRS].sort());
    });

    it('cache target paths are set-equivalent to the old CI cache enumeration', () => {
        const manifest = loadManifest({ root: ROOT });
        expect([...cacheTargetPaths(manifest)].sort()).toEqual([...OLD_CACHE_PATHS].sort());
    });

    it('parity args equal the old CI 7-path lines in order (fresh == committed by construction)', () => {
        const manifest = loadManifest({ root: ROOT });
        expect(parityArgs(manifest)).toEqual(OLD_PARITY_ARGS);
    });

    it('a manifest-added crate flows into test/cache/parity with no consumer change', () => {
        // Accessors are pure over manifest data: a synthetic manifest with an
        // added lib crate proves the red-green contract (added in manifest ->
        // visible in every derived list, no consumer edit).
        const synthetic = {
            crates: [{ name: 'a' }, { name: 'b' }],
            libCrates: [{ name: 'c' }],
            paritySuites: { a: ['pa/'], b: ['pb1/', 'pb2/'] },
        };
        expect(testCrateDirs(synthetic)).toEqual(['wasm/a', 'wasm/b', 'wasm/c']);
        expect(cacheTargetPaths(synthetic)).toEqual([
            'wasm/a/target',
            'wasm/b/target',
            'wasm/c/target',
        ]);
        expect(parityArgs(synthetic)).toEqual(['pa/', 'pb1/', 'pb2/']);
    });

    it('js-strings never leaks into build/stash/check gates (lib-only)', () => {
        const manifest = loadManifest({ root: ROOT });
        const planCrates = buildPlan(manifest)
            .map((s) => s.crate)
            .filter(Boolean);
        expect(planCrates).not.toContain('js-strings');
        expect(planCrates).toHaveLength(manifest.crates.length);
    });
});

describe('universe validation failures', () => {
    function baseManifest() {
        return loadManifest({ root: ROOT });
    }

    it('fails explicitly on unknown lib field', () => {
        const manifest = { ...baseManifest(), libCrates: [{ name: 'js-strings', kind: 'lib' }] };
        expect(() => validateManifest(manifest, { root: ROOT })).toThrow(/unknown field "kind"/);
    });

    it('fails explicitly on missing lib name', () => {
        const manifest = { ...baseManifest(), libCrates: [{}] };
        expect(() => validateManifest(manifest, { root: ROOT })).toThrow(/missing required field "name"/);
    });

    it('fails explicitly on duplicate names across crates and libCrates', () => {
        const manifest = { ...baseManifest(), libCrates: [{ name: 'textrank' }] };
        expect(() => validateManifest(manifest, { root: ROOT })).toThrow(/duplicate crate name "textrank"/);
    });

    it('fails explicitly on unresolvable lib dir', () => {
        const manifest = { ...baseManifest(), libCrates: [{ name: 'nope' }] };
        expect(() => validateManifest(manifest, { root: ROOT })).toThrow(
            /crate dir "wasm\/nope" does not exist/
        );
    });

    it('fails explicitly on paritySuites key that is not a build crate', () => {
        const manifest = {
            ...baseManifest(),
            paritySuites: { ...baseManifest().paritySuites, 'js-strings': ['some/dir/'] },
        };
        expect(() => validateManifest(manifest, { root: ROOT })).toThrow(
            /paritySuites\["js-strings"\] is not a build crate/
        );
    });

    it('fails explicitly on empty parity dir list', () => {
        const manifest = {
            ...baseManifest(),
            paritySuites: { ...baseManifest().paritySuites, textrank: [] },
        };
        expect(() => validateManifest(manifest, { root: ROOT })).toThrow(/must be a non-empty array/);
    });

    it('fails explicitly when parityArgs lacks a build crate mapping', () => {
        const manifest = loadManifest({ root: ROOT });
        const { textrank: _dropped, ...partial } = manifest.paritySuites;
        expect(() => parityArgs({ ...manifest, paritySuites: partial })).toThrow(
            /missing parity suite mapping for build crate "textrank"/
        );
    });
});
