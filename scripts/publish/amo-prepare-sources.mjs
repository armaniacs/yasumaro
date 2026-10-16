#!/usr/bin/env node

/**
 * amo-prepare-sources.mjs — make the AMO sources archive producer explicit.
 *
 * Moved verbatim from the `.github/workflows/release.yml` step "Prepare AMO
 * sources archive" (the inline `run:` shell the DX Advocate review flagged
 * as outside the repository's test surface). The workflow now runs
 * `node scripts/publish/amo-prepare-sources.mjs`.
 *
 * The AMO step below is guarded on dist/yasumaro-*-sources.zip, yet no step
 * named that file: `npx wxt zip -b firefox` (Build for Firefox) writes it as
 * a side effect, because wxt enables zipSources by default for firefox and
 * emits dist/<name>-<packageVersion>-sources.zip (wxt.config.ts
 * zip.excludeSources keeps it uploadable). Making the producer explicit
 * means a wxt default change surfaces as a failed step with a message
 * instead of a silent hashFiles() skip that never submits.
 *
 * The workflow keeps its own gate (`if: vars.AMO_AUTO_SUBMIT == 'true'`),
 * mirroring the step below; inputs arrive via env (VERSION, OW_E2E_PROBE is
 * forwarded to the rebuild child process).
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { StepFailed, defaultRun, isCliEntry, runCli } from './lib.mjs';

export function prepareAmoSources(env, deps = {}) {
  const {
    log = console.log,
    run = defaultRun,
    cwd = process.cwd(),
    exists = existsSync,
  } = deps;

  const version = env.VERSION ?? '';
  const sources = `dist/yasumaro-${version}-sources.zip`;
  const sourcesPath = join(cwd, sources);

  if (!exists(sourcesPath)) {
    log(`${sources} is missing; rebuilding the Firefox bundle to produce it`);
    // OW_E2E_PROBE (step env) must reach the child: same strip flag as the
    // release builds, so a regenerated archive matches them.
    const exitCode = run('npx', ['wxt', 'zip', '-b', 'firefox'], {
      cwd,
      env: { ...process.env, ...env },
      stdio: 'inherit',
    });
    if (exitCode !== 0) throw new StepFailed(exitCode);
  }

  if (!exists(sourcesPath)) {
    log(
      `::error file=.github/workflows/release.yml::AMO sources archive ${sources} was not generated; the Submit to Firefox Add-ons (AMO) step would silently skip`
    );
    throw new StepFailed();
  }

  log(`AMO sources archive ready: ${sources}`);
}

if (isCliEntry(import.meta.url)) {
  runCli(() => prepareAmoSources(process.env));
}
