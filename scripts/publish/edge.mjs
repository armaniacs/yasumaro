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
 * Semantics match the shell except for one deliberate re-run guard: a publish
 * blocked by another in-progress submission waits 60 s and retries (up to 3
 * posts), because that is what a re-run after a partially completed release
 * hits. Same URLs, headers, and timeouts otherwise; the same 30 × 10s
 * operation polling (any status other than InProgress fails, and
 * never-finished prints `<label> did not finish in time`);
 * failure → non-zero exit, publish skip → 0. A Chrome Web Store failure must
 * not skip this step — the workflow's `if: always()` gate still owns that.
 */

import { join } from 'node:path';
import {
  StepFailed,
  defaultSleep,
  isCliEntry,
  jqExtractOr,
  parseJson,
  projectStatusFields,
  readFileOrAbort,
  requestOrAbort,
  runCli,
} from './lib.mjs';

const OPERATION_POLL_MAX = 30;
const POLL_INTERVAL_MS = 10_000;
// A previous attempt's submission can still be running server-side when a
// re-run publishes ("Can't publish extension as your extension submission is
// in progress"). The draft package update already went through, so waiting
// and re-submitting is the documented remediation — bounded, like the polls.
const PUBLISH_ATTEMPTS_MAX = 3;
const PUBLISH_RETRY_WAIT_MS = 60_000;

/**
 * The terminal errorCode of an Edge operation body, or null when the body
 * carries none (non-JSON, no errorCode field, non-string value). Exported for
 * tests; the publish loop uses it to recognise a retryable
 * InProgressSubmission without changing the upload path.
 */
export function publishTerminalErrorCode(statusBody) {
  const parsed = parseJson(statusBody);
  if (parsed.ok !== true) return null;
  const root = parsed.value;
  if (root === null || typeof root !== 'object' || Array.isArray(root)) return null;
  return typeof root.errorCode === 'string' ? root.errorCode : null;
}

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
  // Same fail-fast for credentials: an empty ApiKey/ClientID would otherwise
  // travel into the headers and fail far from the cause.
  if ((edgeApiKey ?? '') === '') {
    log('EDGE_API_KEY is missing');
    throw new StepFailed();
  }
  if ((edgeClientId ?? '') === '') {
    log('EDGE_CLIENT_ID is missing');
    throw new StepFailed();
  }
  const api = `https://api.addons.microsoftedge.microsoft.com/v1/products/${productId}`;
  const authHeaders = {
    Authorization: `ApiKey ${edgeApiKey ?? ''}`,
    'X-ClientID': edgeClientId ?? '',
  };

  // Prints "Succeeded" once the operation finishes; any other terminal
  // status (or never finishing within 30 × 10s) fails the step.
  // onTerminalFailure classifies a terminal body: return 'retry' to let the
  // caller drive the next step instead of throwing here. The upload path
  // passes none and keeps the old fail-fast behavior.
  async function waitForOperation(url, label, onTerminalFailure) {
    for (let attempt = 1; attempt <= OPERATION_POLL_MAX; attempt++) {
      const response = await requestOrAbort(fetchFn, url, { headers: authHeaders, timeoutMs: 30_000 }, log);
      const status = jqExtractOr(response.text, ['status'], 'UNKNOWN');
      log(`${label} status check ${attempt}/${OPERATION_POLL_MAX}: ${status}`);
      if (status === 'Succeeded') return;
      if (status !== 'InProgress') {
        if (onTerminalFailure) {
          const decision = onTerminalFailure(response.text);
          if (decision === 'retry') return 'retry';
        }
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
  // A re-run can arrive while the previous attempt's submission is still
  // running server-side (InProgressSubmission). The draft package update
  // already went through, so wait and re-submit rather than failing the
  // release; anything else still fails immediately.
  for (let attempt = 1; ; attempt++) {
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
    const outcome = await waitForOperation(
      `${api}/submissions/operations/${publishOperation}`,
      'Publish',
      // Only earlier attempts may retry: the last one must surface the
      // terminal failure (with its fields) instead of swallowing it.
      attempt < PUBLISH_ATTEMPTS_MAX
        ? (body) => (publishTerminalErrorCode(body) === 'InProgressSubmission' ? 'retry' : undefined)
        : undefined,
    );
    if (outcome !== 'retry') break;
    log(`Publish attempt ${attempt} blocked by an in-progress submission; retrying`);
    await sleep(PUBLISH_RETRY_WAIT_MS);
  }
  log('Publish submitted');
}

if (isCliEntry(import.meta.url)) {
  runCli(() => uploadAndPublishEdge(process.env));
}
