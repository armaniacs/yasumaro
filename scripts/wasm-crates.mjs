#!/usr/bin/env node
/**
 * wasm-crates.mjs — manifest loader + single owner of the WASM crate list.
 *
 * PBI 2026-09-21-18: `wasm/crates.json` is the SSOT. Every consumer derives
 * from it instead of re-enumerating crates:
 *   - scripts/build-wasm.mjs (`npm run build:wasm`)
 *   - scripts/postprocess-wasm-glue.mjs (glue postprocess table)
 *   - wxt.config.ts `build:publicAssets` (publicShip crates only)
 *   - .github/workflows/ci.yml wasm gate (`stash` / `restore` / `check`)
 *
 * Path resolution is anchored at the repo root derived from this file's
 * location, never at process.cwd() (`build:wasm` used to `cd` per crate).
 *
 * CLI (used by the CI gate so ci.yml holds no per-crate triplets):
 *   node scripts/wasm-crates.mjs stash <dir>    # stash committed src (+public iff publicShip) binaries
 *   node scripts/wasm-crates.mjs restore <dir>  # restore committed src binaries (public untouched)
 *   node scripts/wasm-crates.mjs check <dir>    # cmp public-vs-src + git diff glue/d.ts gates
 */

import { readFileSync, copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, '..');
export const MANIFEST_PATH = join(ROOT, 'wasm', 'crates.json');

const REQUIRED_FIELDS = [
    'name',
    'crateLabel',
    'gluePath',
    'outPath',
    'dtsName',
    'wasmName',
    'srcCopy',
    'pkgDts',
    'dtsCopy',
    'publicShip',
];

/**
 * Validate a parsed manifest object. Throws with an explicit message on the
 * first problem (missing/unknown field, wrong type, duplicate, inconsistency,
 * or unresolvable crate dir). Pure over `data` except for the crate-dir
 * existence check under `root`.
 */
export function validateManifest(data, { root = ROOT } = {}) {
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error('wasm-crates: manifest must be a JSON object with a "crates" array');
    }
    if (!Array.isArray(data.crates) || data.crates.length === 0) {
        throw new Error('wasm-crates: manifest "crates" must be a non-empty array');
    }
    const seen = new Set();
    data.crates.forEach((crate, index) => {
        const where = `wasm-crates: crates[${index}]`;
        if (crate === null || typeof crate !== 'object' || Array.isArray(crate)) {
            throw new Error(`${where} must be an object`);
        }
        for (const field of REQUIRED_FIELDS) {
            if (!(field in crate)) {
                throw new Error(`${where}: missing required field "${field}"`);
            }
        }
        for (const key of Object.keys(crate)) {
            if (!REQUIRED_FIELDS.includes(key)) {
                throw new Error(`${where}: unknown field "${key}"`);
            }
        }
        for (const field of ['name', 'crateLabel', 'gluePath', 'outPath', 'dtsName', 'wasmName', 'srcCopy']) {
            if (typeof crate[field] !== 'string' || crate[field].length === 0) {
                throw new Error(`${where}: "${field}" must be a non-empty string`);
            }
        }
        if (crate.pkgDts !== null && typeof crate.pkgDts !== 'string') {
            throw new Error(`${where}: "pkgDts" must be a string or null`);
        }
        if (crate.dtsCopy !== null && typeof crate.dtsCopy !== 'string') {
            throw new Error(`${where}: "dtsCopy" must be a string or null`);
        }
        if ((crate.pkgDts === null) !== (crate.dtsCopy === null)) {
            throw new Error(
                `${where}: "pkgDts" and "dtsCopy" must both be null (pii-style hand-maintained d.ts) or both be strings`
            );
        }
        if (typeof crate.publicShip !== 'boolean') {
            throw new Error(`${where}: "publicShip" must be a boolean (STAGED crates use false)`);
        }
        if (seen.has(crate.name)) {
            throw new Error(`${where}: duplicate crate name "${crate.name}"`);
        }
        seen.add(crate.name);
        if (!existsSync(join(root, 'wasm', crate.name))) {
            throw new Error(`${where}: crate dir "wasm/${crate.name}" does not exist under ${root}`);
        }
        if (!crate.srcCopy.endsWith(crate.wasmName)) {
            throw new Error(`${where}: "srcCopy" must end with wasmName "${crate.wasmName}"`);
        }
    });
    return data;
}

/** Read + validate the manifest. `root` override exists for unit tests. */
export function loadManifest({ root = ROOT, manifestPath = join(root, 'wasm', 'crates.json') } = {}) {
    let raw;
    try {
        raw = readFileSync(manifestPath, 'utf-8');
    } catch (error) {
        throw new Error(`wasm-crates: cannot read manifest at ${manifestPath}: ${error.message}`);
    }
    let data;
    try {
        data = JSON.parse(raw);
    } catch (error) {
        throw new Error(`wasm-crates: manifest at ${manifestPath} is not valid JSON: ${error.message}`);
    }
    return validateManifest(data, { root });
}

/** Repo-relative public copy destination, derived (never stored). */
export function publicCopyOf(crate) {
    return `public/wasm/${crate.wasmName}`;
}

/** Crates shipped to the extension bundle (data-driven STAGED skip). */
export function publicShipCrates(manifest) {
    return manifest.crates.filter((crate) => crate.publicShip);
}

/**
 * Ordered build plan mirroring the pre-manifest `build:wasm` shell chain
 * exactly: per crate `wasm-pack build` in `wasm/<name>`, bg-wasm copies to
 * src (+ public iff publicShip), d.ts copy iff dtsCopy, then postprocess.
 * All paths repo-relative; execution resolves them against the root.
 */
export function buildPlan(manifest) {
    const steps = manifest.crates.map((crate) => {
        const copies = [{ from: `wasm/${crate.name}/pkg/${crate.wasmName}`, to: crate.srcCopy }];
        if (crate.publicShip) {
            copies.push({ from: `wasm/${crate.name}/pkg/${crate.wasmName}`, to: publicCopyOf(crate) });
        }
        if (crate.pkgDts !== null && crate.dtsCopy !== null) {
            copies.push({ from: `wasm/${crate.name}/pkg/${crate.pkgDts}`, to: crate.dtsCopy });
        }
        return {
            crate: crate.name,
            cwd: `wasm/${crate.name}`,
            build: ['wasm-pack', 'build', '--target', 'web', '--out-dir', 'pkg', '--release'],
            copies,
        };
    });
    steps.push({ postprocess: 'node scripts/postprocess-wasm-glue.mjs' });
    return steps;
}

/** Shell-style rendering of a plan step (for --print-plan / diffing). */
export function formatStep(step) {
    if (step.postprocess) return step.postprocess;
    const parts = [`cd ${step.cwd} && ${step.build.join(' ')}`];
    for (const copy of step.copies) {
        parts.push(`cp ${copy.from.replace(`wasm/${step.crate}/pkg/`, 'pkg/')} ../../${copy.to}`);
    }
    return parts.join(' && ');
}

function stashPath(dir, crate, kind) {
    return join(dir, `${crate.wasmName}.${kind}.wasm`);
}

/** CI gate: stash committed binaries before the rebuild overwrites them. */
export function stashCommitted(manifest, dir, { root = ROOT } = {}) {
    mkdirSync(dir, { recursive: true });
    for (const crate of manifest.crates) {
        copyFileSync(join(root, crate.srcCopy), stashPath(dir, crate, 'src'));
        if (crate.publicShip) {
            copyFileSync(join(root, publicCopyOf(crate)), stashPath(dir, crate, 'public'));
        }
    }
}

/** CI gate: restore committed src binaries for the committed-binary parity run. */
export function restoreCommitted(manifest, dir, { root = ROOT } = {}) {
    for (const crate of manifest.crates) {
        copyFileSync(stashPath(dir, crate, 'src'), join(root, crate.srcCopy));
    }
}

function fail(message) {
    console.error(message);
    process.exitCode = 1;
}

/**
 * CI gate: committed-src vs committed-public byte comparison (publicShip
 * crates only — the STAGED crate has no public copy) + git diff staleness
 * gates on the fresh build output (glue always, d.ts iff dtsCopy).
 * Semantics match the pre-manifest per-crate triplets, including messages.
 */
export function checkGate(manifest, dir, { root = ROOT } = {}) {
    for (const crate of publicShipCrates(manifest)) {
        const src = readFileSync(stashPath(dir, crate, 'src'));
        const pub = readFileSync(stashPath(dir, crate, 'public'));
        if (!src.equals(pub)) {
            fail(
                `::error::${publicCopyOf(crate)} diverges from ${crate.srcCopy} — run 'npm run build:wasm' and commit the result`
            );
        }
    }
    for (const crate of manifest.crates) {
        const paths = [crate.outPath];
        if (crate.dtsCopy !== null) paths.push(crate.dtsCopy);
        try {
            execFileSync('git', ['diff', '--exit-code', '--', ...paths], { cwd: root, stdio: 'pipe' });
        } catch {
            const label = crate.dtsCopy !== null ? `${crate.name} glue/d.ts` : `${basename(crate.outPath)} glue`;
            fail(`::error::${label} is stale — run 'npm run build:wasm' and commit the result`);
        }
    }
}

const invokedAsScript =
    process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedAsScript) {
    const [command, dir] = process.argv.slice(2);
    const manifest = loadManifest();
    if (command === 'stash' && dir) {
        stashCommitted(manifest, dir);
    } else if (command === 'restore' && dir) {
        restoreCommitted(manifest, dir);
    } else if (command === 'check' && dir) {
        checkGate(manifest, dir);
    } else {
        console.error('usage: node scripts/wasm-crates.mjs (stash|restore|check) <dir>');
        process.exit(1);
    }
}
