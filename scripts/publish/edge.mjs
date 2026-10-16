#!/usr/bin/env node

/**
 * edge.mjs — Microsoft Edge Add-ons upload + publish for release.yml.
 *
 * Moved verbatim from the `.github/workflows/release.yml` step "Upload to
 * Edge Add-ons" (the ~60-line inline `run:` shell the DX Advocate review
 * flagged as outside the repository's test surface). The workflow now runs
 * `node scripts/publish/edge.mjs`; inputs arrive via env, and the operation
 * polling is exported for scripts/__tests__/publish-stores.test.ts.
 *
 * Env (all set by the workflow step, unchanged):
 *   EDGE_PRODUCT_ID / EDGE_CLIENT_ID / EDGE_API_KEY — store credentials
 *   EDGE_AUTO_PUBLISH — 'true' submits for certification; anything else stops after upload
 *   VERSION           — package version (dist/yasumaro-<VERSION>-edge.zip)
 *
 * Semantics are unchanged from the shell: same URLs, headers, and timeouts;
 * the same 30 × 10s operation polling (any status other than InProgress
 * fails, and never-finished prints `<label> did not finish in time`);
 * failure → non-zero exit, publish skip → 0. A Chrome Web Store failure must
 * not skip this step — the workflow's `if: always()` gate still owns that.
 */

import { join } from 'node:path';
import {
  StepFailed,
  defaultSleep,
  isCliEntry,
  jqExtractOr,
  projectStatusFields,
  readFileOrAbort,
  requestOrAbort,
  runCli,
} from './lib.mjs';

const OPERATION_POLL_MAX = 30;
const POLL_INTERVAL_MS = 10_000;

export async function uploadAndPublishEdge(env, deps = {}) {
  const {
    fetch: fetchFn = globalThis.fetch,
    sleep = defaultSleep,
    log = console.log,
    cwd = process.cwd(),
  } = deps;

  const {
    EDGE_PRODUCT_ID: edgeProductId,
    EDGE_CLIENT_ID: edgeClientId,
    EDGE_API_KEY: edgeApiKey,
    EDGE_AUTO_PUBLISH: edgeAutoPublish,
    VERSION: version,
  } = env;
  const productId = edgeProductId ?? '';
  // Fail fast like the CWS ID guards: an empty product ID would otherwise
  // travel into the URL and fail far from the cause (P5).
  if (productId === '') {
    log('EDGE_PRODUCT_ID is missing');
    throw new StepFailed();
  }
  const api = `https://api.addons.microsoftedge.microsoft.com/v1/products/${productId}`;
  const authHeaders = {
    Authorization: `ApiKey ${edgeApiKey ?? ''}`,
    'X-ClientID': edgeClientId ?? '',
  };

  // Prints "Succeeded" once the operation finishes; any other terminal
  // status (or never finishing within 30 × 10s) fails the step.
  async function waitForOperation(url, label) {
    for (let attempt = 1; attempt <= OPERATION_POLL_MAX; attempt++) {
      const response = await requestOrAbort(fetchFn, url, { headers: authHeaders, timeoutMs: 30_000 }, log);
      const status = jqExtractOr(response.text, ['status'], 'UNKNOWN');
      log(`${label} status check ${attempt}/${OPERATION_POLL_MAX}: ${status}`);
      if (status === 'Succeeded') return;
      if (status !== 'InProgress') {
        log(`${label} failed:`);
        log(projectStatusFields(response.text) ?? 'Non-JSON response');
        throw new StepFailed();
      }
      await sleep(POLL_INTERVAL_MS);
    }
    log(`${label} did not finish in time`);
    throw new StepFailed();
  }

  // The Location header carries the operation URL, not a bare id — the old
  // shell took the last '/'-separated token, which breaks on a trailing
  // slash ('.../OP-1/' → '') or a query string ('.../OP-1?poll=true' →
  // 'OP-1?poll=true'). Parse the path and take its last non-empty segment
  // instead (P8).
  function operationId(response) {
    const location = response.headers.get('location');
    if (!location) return '';
    const firstToken = location.trim().split(/\s+/)[0] ?? '';
    if (!firstToken) return '';
    let path = firstToken;
    try {
      path = new URL(firstToken).pathname;
    } catch {
      // Relative Location or unparseable URL: strip query/fragment manually.
      path = firstToken.split(/[?#]/)[0] ?? '';
    }
    const segments = path.split('/').filter((segment) => segment !== '');
    return segments[segments.length - 1] ?? '';
  }

  // --- Upload the Edge zip (curl -X POST -T with the operation in Location) ---
  const edgeZipPath = `dist/yasumaro-${version ?? ''}-edge.zip`;
  const zipBytes = readFileOrAbort(join(cwd, edgeZipPath), log);
  const upload = await requestOrAbort(
    fetchFn,
    `${api}/submissions/draft/package`,
    {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/zip' },
      body: zipBytes,
      timeoutMs: 300_000,
    },
    log
  );
  log(`Upload: HTTP ${upload.status}`);
  if (upload.status !== 202) {
    log('Edge upload was not accepted');
    throw new StepFailed();
  }
  const uploadOperation = operationId(upload);
  if (!uploadOperation) {
    log('No operation id in Location header');
    throw new StepFailed();
  }
  await waitForOperation(`${api}/submissions/draft/package/operations/${uploadOperation}`, 'Upload');

  if (edgeAutoPublish !== 'true') {
    log("EDGE_AUTO_PUBLISH is not 'true'; skipping publish");
    return;
  }

  // --- Submit the submission for certification ---
  const publish = await requestOrAbort(
    fetchFn,
    `${api}/submissions`,
    {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: `Automated release v${version ?? ''}` }),
      timeoutMs: 60_000,
    },
    log
  );
  log(`Publish: HTTP ${publish.status}`);
  if (publish.status !== 202) {
    log('Edge publish was not accepted');
    throw new StepFailed();
  }
  const publishOperation = operationId(publish);
  if (!publishOperation) {
    log('No operation id in Location header');
    throw new StepFailed();
  }
  await waitForOperation(`${api}/submissions/operations/${publishOperation}`, 'Publish');
  log('Publish submitted');
}

if (isCliEntry(import.meta.url)) {
  runCli(() => uploadAndPublishEdge(process.env));
}
