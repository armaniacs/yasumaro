#!/usr/bin/env node

/**
 * amo-submit.mjs — submit the Firefox build to AMO (listed channel) for release.yml.
 *
 * Moved verbatim from the `.github/workflows/release.yml` step "Submit to
 * Firefox Add-ons (AMO)" (the inline `run:` shell the DX Advocate review
 * flagged as outside the repository's test surface). The workflow now runs
 * `node scripts/publish/amo-submit.mjs`; inputs arrive via env
 * (WEB_EXT_API_KEY / WEB_EXT_API_SECRET / AMO_AUTO_SUBMIT / VERSION).
 *
 * AMO has no draft state: a listed-channel upload is a submission for
 * review, so the workflow gates the whole step on hashFiles() and this
 * script repeats the AMO_AUTO_SUBMIT gate with the shell's skip message.
 * The reviewer rebuilds from the sources archive, so it must travel with
 * the bundle. --approval-timeout 0: review is manual and takes days; do not
 * hold the runner. web-ext comes from devDependencies (npm ci /
 * package-lock.json), so the tool is not fetched at runtime alongside the
 * store credentials in this environment.
 */

import { existsSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { StepFailed, defaultRun, isCliEntry, runCli } from './lib.mjs';

export function submitAmo(env, deps = {}) {
  const {
    log = console.log,
    run = defaultRun,
    cwd = process.cwd(),
    mkdtemp = () => mkdtempSync(join(tmpdir(), 'amo-artifacts-')),
    exists = existsSync,
  } = deps;

  if (env.AMO_AUTO_SUBMIT !== 'true') {
    log("AMO_AUTO_SUBMIT is not 'true'; skipping AMO submission");
    return;
  }

  // The Prepare step owns producing this archive; submitting without it
  // would hand web-ext a missing --upload-source-code file (P17).
  const version = env.VERSION ?? '';
  const sourcesZip = `dist/yasumaro-${version}-sources.zip`;
  if (!exists(join(cwd, sourcesZip))) {
    log(`AMO sources archive ${sourcesZip} is missing; run the Prepare AMO sources archive step first`);
    throw new StepFailed();
  }

  // ARTIFACTS_DIR="$(mktemp -d)" — kept as a real directory: web-ext writes
  // the signed xpi and the uploaded source archive copy there.
  const artifactsDir = mkdtemp();
  const exitCode = run(
    'npx',
    [
      'web-ext',
      'sign',
      '--channel',
      'listed',
      '--source-dir',
      'dist/firefox-mv3',
      '--artifacts-dir',
      artifactsDir,
      '--upload-source-code',
      sourcesZip,
      '--approval-timeout',
      '0',
      '--no-input',
    ],
    { cwd, env: { ...process.env, ...env }, stdio: 'inherit' }
  );
  if (exitCode !== 0) throw new StepFailed(exitCode);
  log(`AMO submission submitted: ${sourcesZip}`);
}

if (isCliEntry(import.meta.url)) {
  runCli(() => submitAmo(process.env));
}
