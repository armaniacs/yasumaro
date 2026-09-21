#!/usr/bin/env node
/**
 * build-wasm.mjs — manifest-driven WASM build (`npm run build:wasm`).
 *
 * PBI 2026-09-21-18: replaces the hand-chained per-crate shell enumeration in
 * package.json with a Node script that reads wasm/crates.json and runs
 * wasm-pack + copies per crate, then the glue postprocess. The resolved
 * commands/paths are identical to the old chain (verify without executing:
 * `node scripts/build-wasm.mjs --print-plan`).
 *
 * Usage: node scripts/build-wasm.mjs [--print-plan]
 */

import { copyFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, delimiter } from 'node:path';
import { homedir } from 'node:os';
import { ROOT, loadManifest, buildPlan, formatStep } from './wasm-crates.mjs';

const args = process.argv.slice(2);

const manifest = loadManifest({ root: ROOT });
const plan = buildPlan(manifest);

if (args.includes('--print-plan')) {
    for (const step of plan) console.log(formatStep(step));
    process.exit(0);
}

const env = {
    ...process.env,
    PATH: `${join(homedir(), '.cargo', 'bin')}${delimiter}${process.env.PATH ?? ''}`,
};

for (const step of plan) {
    if (step.postprocess) {
        const result = spawnSync(process.execPath, ['scripts/postprocess-wasm-glue.mjs'], {
            cwd: ROOT,
            env,
            stdio: 'inherit',
        });
        if (result.status !== 0) process.exit(result.status ?? 1);
        continue;
    }
    const [command, ...rest] = step.build;
    const result = spawnSync(command, rest, { cwd: join(ROOT, step.cwd), env, stdio: 'inherit' });
    if (result.status !== 0) {
        console.error(`build-wasm: "${command} ${rest.join(' ')}" failed in ${step.cwd}`);
        process.exit(result.status ?? 1);
    }
    for (const copy of step.copies) {
        copyFileSync(join(ROOT, copy.from), join(ROOT, copy.to));
        console.log(`copied ${copy.from} -> ${copy.to}`);
    }
}
