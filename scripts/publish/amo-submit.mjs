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

import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { StepFailed, defaultRun, isCliEntry, runCli } from './lib.mjs';

export function submitAmo(env, deps = {}) {
  const {
    log = console.log,
    run = defaultRun,
    cwd = process.cwd(),
    mkdtemp = () => mkdtempSync(join(tmpdir(), 'amo-artifacts-')),
  } = deps;

  if (env.AMO_AUTO_SUBMIT !== 'true') {
    log("AMO_AUTO_SUBMIT is not 'true'; skipping AMO submission");
    return;
  }

  // ARTIFACTS_DIR="$(mktemp -d)" — kept as a real directory: web-ext writes
  // the signed xpi and the uploaded source archive copy there.
  const artifactsDir = mkdtemp();
  const version = env.VERSION ?? '';
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
      `dist/yasumaro-${version}-sources.zip`,
      '--approval-timeout',
      '0',
      '--no-input',
    ],
    { cwd, env: { ...process.env, ...env }, stdio: 'inherit' }
  );
  if (exitCode !== 0) throw new StepFailed(exitCode);
}

if (isCliEntry(import.meta.url)) {
  runCli(() => submitAmo(process.env));
}
