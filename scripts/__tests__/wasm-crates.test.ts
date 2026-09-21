/**
 * wasm-crates.test.ts — PBI 2026-09-21-18 manifest loader unit tests.
 *
 * Covers: valid manifest shape (4 crates, STAGED flag), explicit failures on
 * missing/unknown/duplicate fields, publicShip resolution (wxt publicAssets
 * equivalent), buildPlan byte-equivalence with the pre-manifest shell chain,
 * and the glue transform's pure logic.
 */
import { describe, it, expect } from 'vitest';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    loadManifest,
    validateManifest,
    buildPlan,
    publicShipCrates,
    publicCopyOf,
} from '../wasm-crates.mjs';
import { transformGlue } from '../postprocess-wasm-glue.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function validEntry(overrides = {}) {
    return {
        name: 'pii-sanitizer',
        crateLabel: 'pii-sanitizer',
        gluePath: 'wasm/pii-sanitizer/pkg/pii_sanitizer.js',
        outPath: 'src/wasm/pii-sanitizer/piiSanitizerWasm.js',
        dtsName: 'piiSanitizerWasm.d.ts',
        wasmName: 'pii_sanitizer_bg.wasm',
        srcCopy: 'src/wasm/pii-sanitizer/pii_sanitizer_bg.wasm',
        pkgDts: null,
        dtsCopy: null,
        publicShip: true,
        ...overrides,
    };
}

describe('wasm crate manifest', () => {
    it('loads 4 crates in build order with sentence-dedup STAGED', () => {
        const manifest = loadManifest({ root: ROOT });
        expect(manifest.crates.map((c) => c.name)).toEqual([
            'pii-sanitizer',
            'textrank',
            'sentence-dedup',
            'tag-cooccur',
        ]);
        expect(manifest.crates.find((c) => c.name === 'sentence-dedup')?.publicShip).toBe(false);
        for (const c of manifest.crates.filter((c) => c.name !== 'sentence-dedup')) {
            expect(c.publicShip).toBe(true);
        }
    });

    it('fails explicitly on missing field', () => {
        const { publicShip: _publicShip, ...withoutFlag } = validEntry();
        expect(() => validateManifest({ crates: [withoutFlag] }, { root: ROOT })).toThrow(
            /missing required field "publicShip"/
        );
    });

    it('fails explicitly on unknown field', () => {
        expect(() =>
            validateManifest({ crates: [validEntry({ shipIt: true })] }, { root: ROOT })
        ).toThrow(/unknown field "shipIt"/);
    });

    it('fails explicitly on duplicate crate names', () => {
        expect(() =>
            validateManifest({ crates: [validEntry(), validEntry()] }, { root: ROOT })
        ).toThrow(/duplicate crate name/);
    });

    it('fails explicitly on non-boolean publicShip', () => {
        expect(() =>
            validateManifest({ crates: [validEntry({ publicShip: 'STAGED' })] }, { root: ROOT })
        ).toThrow(/"publicShip" must be a boolean/);
    });

    it('fails explicitly on pkgDts/dtsCopy inconsistency', () => {
        expect(() =>
            validateManifest(
                { crates: [validEntry({ pkgDts: 'pii_sanitizer.d.ts', dtsCopy: null })] },
                { root: ROOT }
            )
        ).toThrow(/both be null/);
    });

    it('fails explicitly on unresolvable crate dir', () => {
        expect(() =>
            validateManifest({ crates: [validEntry({ name: 'nope' })] }, { root: ROOT })
        ).toThrow(/crate dir "wasm\/nope" does not exist/);
    });

    it('fails explicitly on unreadable manifest path', () => {
        expect(() =>
            loadManifest({ root: ROOT, manifestPath: join(ROOT, 'wasm', 'does-not-exist.json') })
        ).toThrow(/cannot read manifest/);
    });
});

describe('publicShip resolution (wxt publicAssets equivalent)', () => {
    it('excludes the STAGED crate and ships the other three wasm names', () => {
        const manifest = loadManifest({ root: ROOT });
        const shipped = publicShipCrates(manifest).map((c) => c.wasmName);
        expect(shipped).toEqual([
            'pii_sanitizer_bg.wasm',
            'textrank_bg.wasm',
            'tag_cooccur_bg.wasm',
        ]);
        expect(publicCopyOf(manifest.crates[0])).toBe('public/wasm/pii_sanitizer_bg.wasm');
    });

    it('a 5th crate with publicShip=true is picked up with no consumer change', () => {
        const manifest = loadManifest({ root: ROOT });
        const extended = {
            crates: [
                ...manifest.crates,
                validEntry({
                    name: 'textrank',
                    crateLabel: 'fifth',
                    wasmName: 'fifth_bg.wasm',
                    srcCopy: 'src/wasm/textrank/fifth_bg.wasm',
                    publicShip: true,
                }),
            ],
        };
        expect(publicShipCrates(extended).map((c) => c.wasmName)).toContain('fifth_bg.wasm');
        expect(buildPlan(extended)).toHaveLength(buildPlan(manifest).length + 1);
    });
});

describe('buildPlan equivalence with the pre-manifest shell chain', () => {
    // The old package.json build:wasm chain, crate by crate. Any plan drift
    // fails here before it can desync build outputs.
    const expectedCopies: Record<string, Array<[string, string]>> = {
        'pii-sanitizer': [
            ['wasm/pii-sanitizer/pkg/pii_sanitizer_bg.wasm', 'src/wasm/pii-sanitizer/pii_sanitizer_bg.wasm'],
            ['wasm/pii-sanitizer/pkg/pii_sanitizer_bg.wasm', 'public/wasm/pii_sanitizer_bg.wasm'],
        ],
        textrank: [
            ['wasm/textrank/pkg/textrank_bg.wasm', 'src/wasm/textrank/textrank_bg.wasm'],
            ['wasm/textrank/pkg/textrank_bg.wasm', 'public/wasm/textrank_bg.wasm'],
            ['wasm/textrank/pkg/textrank.d.ts', 'src/wasm/textrank/textrankWasm.d.ts'],
        ],
        'sentence-dedup': [
            ['wasm/sentence-dedup/pkg/sentence_dedup_bg.wasm', 'src/wasm/sentence-dedup/sentence_dedup_bg.wasm'],
            ['wasm/sentence-dedup/pkg/sentence_dedup.d.ts', 'src/wasm/sentence-dedup/sentenceDedupWasm.d.ts'],
        ],
        'tag-cooccur': [
            ['wasm/tag-cooccur/pkg/tag_cooccur_bg.wasm', 'src/wasm/tag-cooccur/tag_cooccur_bg.wasm'],
            ['wasm/tag-cooccur/pkg/tag_cooccur_bg.wasm', 'public/wasm/tag_cooccur_bg.wasm'],
            ['wasm/tag-cooccur/pkg/tag_cooccur.d.ts', 'src/wasm/tag-cooccur/tagCooccurWasm.d.ts'],
        ],
    };

    it('emits wasm-pack + copies per crate in chain order, then postprocess', () => {
        const manifest = loadManifest({ root: ROOT });
        const plan = buildPlan(manifest);
        expect(plan.map((s) => s.crate ?? 'postprocess')).toEqual([
            'pii-sanitizer',
            'textrank',
            'sentence-dedup',
            'tag-cooccur',
            'postprocess',
        ]);
        for (const step of plan) {
            if (step.postprocess) {
                expect(step.postprocess).toBe('node scripts/postprocess-wasm-glue.mjs');
                continue;
            }
            expect(step.cwd).toBe(`wasm/${step.crate}`);
            expect(step.build).toEqual([
                'wasm-pack',
                'build',
                '--target',
                'web',
                '--out-dir',
                'pkg',
                '--release',
            ]);
            expect(step.copies).toEqual(
                expectedCopies[step.crate].map(([from, to]) => ({ from, to }))
            );
        }
    });
});

describe('transformGlue', () => {
    const fixture =
        `import * as x from './textrank.d.ts';\n` +
        `export async function __wbg_init(module_or_path) {\n` +
        `    if (module_or_path === undefined) {\n` +
        `        module_or_path = new URL('textrank_bg.wasm', import.meta.url);\n` +
        `    }\n` +
        `    return module_or_path;\n}\n`;

    it('rewrites the d.ts reference and the default-URL branch', () => {
        const out = transformGlue(fixture, {
            dtsName: 'textrankWasm.d.ts',
            wasmName: 'textrank_bg.wasm',
            crateLabel: 'textrank',
        });
        expect(out).toContain('./textrankWasm.d.ts');
        expect(out).not.toContain('import.meta.url');
        expect(out).toContain('module_or_path is required');
    });

    it('throws when the wasm-bindgen branch format changed', () => {
        expect(() =>
            transformGlue('no branch here', {
                dtsName: 'textrankWasm.d.ts',
                wasmName: 'textrank_bg.wasm',
                crateLabel: 'textrank',
            })
        ).toThrow(/expected default-URL branch not found/);
    });
});
