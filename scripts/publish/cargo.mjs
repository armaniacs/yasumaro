#!/usr/bin/env node

/**
 * cargo.mjs — crates.io publish of the `yasumaro` CLI for release.yml.
 *
 * The GitHub Release flow (tag push `v*`) publishes the `yasumaro` Rust CLI
 * (`cli/`) to crates.io alongside the extension archives, so
 * `cargo install yasumaro` tracks the tagged version. Every input arrives
 * via env, and the branching is exported for
 * scripts/__tests__/publish-stores.test.ts.
 *
 * Env (all set by the workflow step):
 *   CARGO_REGISTRY_TOKEN — crates.io API token (repository secret; cargo
 *     reads this variable natively, so it is forwarded, never logged)
 *   VERSION              — package version; must equal cli/Cargo.toml or the
 *     step fails before touching the network (version drift guard)
 *
 * Semantics: version-drift check → `cargo publish --dry-run` (packaging
 * gate) → `cargo publish`. A publish that reports "already uploaded" is
 * treated as success so release re-runs stay green; any other failure is
 * non-zero exit. Failure → StepFailed (message already logged).
 */

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { StepFailed, isCliEntry, readFileOrAbort, runCli } from './lib.mjs';

const MANIFEST_RELATIVE = join('cli', 'Cargo.toml');

/** Already-on-crates.io markers (cargo wording across versions). */
const ALREADY_UPLOADED = /already (uploaded|exists)|already taken|already been published/i;

/** Extract the `[package] version` from Cargo.toml text (first match). */
export function crateVersion(manifestText) {
  const match = /^version\s*=\s*"([^"]+)"/m.exec(String(manifestText));
  return match ? match[1] : '';
}

/**
 * Production command runner: pipes output (echoed so CI logs keep cargo's
 * diagnostics), returns `{ code, stderr }` for branch decisions. The token
 * travels only in `options.env`, never in logged text.
 */
export function defaultCargoRun(command, args, options = {}, log = console.log) {
  log(`$ ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.error) {
    log(`${command}: ${result.error.message}`);
    return { code: 127, stderr: result.error.message };
  }
  const stdout = typeof result.stdout === 'string' ? result.stdout : '';
  const stderr = typeof result.stderr === 'string' ? result.stderr : '';
  if (stdout !== '') log(stdout.trimEnd());
  if (stderr !== '') log(stderr.trimEnd());
  return { code: result.status ?? 1, stderr };
}

export async function publishCargo(env, deps = {}) {
  const { run = defaultCargoRun, log = console.log, cwd = process.cwd() } = deps;

  const { CARGO_REGISTRY_TOKEN: token = '', VERSION: version = '' } = env;
  if (token === '') {
    log('CARGO_REGISTRY_TOKEN is missing');
    throw new StepFailed();
  }

  const manifestText = readFileOrAbort(join(cwd, MANIFEST_RELATIVE), log).toString();
  const crate = crateVersion(manifestText);
  if (crate === '') {
    log('Could not read version from cli/Cargo.toml');
    throw new StepFailed();
  }
  if (version !== '' && crate !== version) {
    log(`Version drift: package.json says ${version}, cli/Cargo.toml says ${crate}`);
    throw new StepFailed();
  }

  const manifestArg = ['--manifest-path', join(cwd, MANIFEST_RELATIVE)];
  const dry = await run('cargo', ['publish', '--dry-run', ...manifestArg]);
  if (dry.code !== 0) {
    log('cargo publish --dry-run failed');
    throw new StepFailed(dry.code);
  }

  const published = await run('cargo', ['publish', ...manifestArg], {
    env: { ...process.env, CARGO_REGISTRY_TOKEN: token },
  });
  if (published.code === 0) {
    log(`Published yasumaro v${crate} to crates.io`);
    return;
  }
  if (ALREADY_UPLOADED.test(published.stderr)) {
    log(`yasumaro v${crate} is already on crates.io; treating as success`);
    return;
  }
  log('cargo publish failed');
  throw new StepFailed(published.code);
}

if (isCliEntry(import.meta.url)) {
  runCli(() => publishCargo(process.env));
}
