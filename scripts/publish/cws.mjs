#!/usr/bin/env node

/**
 * cws.mjs — Chrome Web Store upload + publish for release.yml.
 *
 * Moved verbatim from the `.github/workflows/release.yml` step "Upload to
 * Chrome Web Store" (the ~70-line inline `run:` shell the DX Advocate review
 * flagged as outside the repository's test surface). The workflow now runs
 * `node scripts/publish/cws.mjs`; every input arrives via env, and the
 * branching is exported for scripts/__tests__/publish-stores.test.ts.
 *
 * Env (all set by the workflow step, unchanged):
 *   CHROME_EXTENSION_ID / CHROME_PUBLISHER_ID / CHROME_CLIENT_ID /
 *   CHROME_CLIENT_SECRET / CHROME_REFRESH_TOKEN — store credentials
 *   CWS_AUTO_PUBLISH — 'true' submits for review; anything else stops after upload
 *   VERSION          — package version (dist/yasumaro-<VERSION>-chrome.crx)
 *
 * Semantics are unchanged from the shell: same URLs, headers, and timeouts;
 * the same 30 × 10s upload-state poll (IN_PROGRESS|NOT_FOUND, NOT_FOUND
 * included because the async upload is not registered yet); the same
 * messages; failure → non-zero exit, publish skip → 0.
 */

import { join } from 'node:path';
import {
  StepFailed,
  defaultSleep,
  isCliEntry,
  jqAlternative,
  jqExtract,
  jqExtractOr,
  jqRawRender,
  projectErrorFields,
  readFileOrAbort,
  requestOrAbort,
  runCli,
} from './lib.mjs';

const UPLOAD_POLL_MAX = 30;
const POLL_INTERVAL_MS = 10_000;

export async function uploadAndPublishCws(env, deps = {}) {
  const {
    fetch: fetchFn = globalThis.fetch,
    sleep = defaultSleep,
    log = console.log,
    cwd = process.cwd(),
  } = deps;

  const {
    CHROME_EXTENSION_ID: chromeExtensionId,
    CHROME_PUBLISHER_ID: chromePublisherId,
    CHROME_CLIENT_ID: chromeClientId,
    CHROME_CLIENT_SECRET: chromeClientSecret,
    CHROME_REFRESH_TOKEN: chromeRefreshToken,
    CWS_AUTO_PUBLISH: cwsAutoPublish,
    VERSION: version,
  } = env;
  const extensionId = chromeExtensionId ?? '';
  const publisherId = chromePublisherId ?? '';
  const itemPath = `publishers/${publisherId}/items/${extensionId}`;

  // --- OAuth token refresh (curl + jq -r '.access_token // empty') ---
  const tokenResponse = await requestOrAbort(
    fetchFn,
    'https://oauth2.googleapis.com/token',
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: chromeClientId ?? '',
        client_secret: chromeClientSecret ?? '',
        refresh_token: chromeRefreshToken ?? '',
        grant_type: 'refresh_token',
      }),
      timeoutMs: 30_000,
    },
    log
  );
  // `.access_token // empty` — null/false/missing yield jq's empty output.
  const token = jqExtract(tokenResponse.text, ['access_token']);
  const accessToken = String(token.ok ? jqAlternative(token.value, '') : '');
  if (accessToken === '') {
    // The shell printed "OAuth token refresh failed" for a missing token and
    // aborted inside jq for a non-JSON body; both stop here before any
    // credential is used, with the message that was already the common case.
    log('OAuth token refresh failed');
    throw new StepFailed();
  }
  // GitHub Actions workflow command: mask the token for the rest of the log.
  log(`::add-mask::${accessToken}`);

  // --- Upload the signed CRX (curl -X POST -T) ---
  const crxPath = `dist/yasumaro-${version ?? ''}-chrome.crx`;
  const crxBytes = readFileOrAbort(join(cwd, crxPath), log);
  const upload = await requestOrAbort(
    fetchFn,
    `https://chromewebstore.googleapis.com/upload/v2/${itemPath}:upload`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'X-Goog-Upload-Protocol': 'raw',
        'X-Goog-Upload-File-Name': 'extension.crx',
      },
      body: crxBytes,
      timeoutMs: 300_000,
    },
    log
  );

  let uploadState = jqExtractOr(upload.text, ['uploadState'], 'UNKNOWN');
  log(`Upload: ${uploadState}`);
  if (uploadState === 'UNKNOWN') {
    log('Upload response (error fields only):');
    log(projectErrorFields(upload.text) ?? `Non-JSON response (${[...upload.text].length} bytes)`);
  }

  // NOT_FOUND is returned until the async upload is registered, so it is polled like IN_PROGRESS.
  for (let attempt = 1; attempt <= UPLOAD_POLL_MAX; attempt++) {
    if (uploadState !== 'IN_PROGRESS' && uploadState !== 'NOT_FOUND') break;
    await sleep(POLL_INTERVAL_MS);
    const status = await requestOrAbort(
      fetchFn,
      `https://chromewebstore.googleapis.com/v2/${itemPath}:fetchStatus`,
      { headers: { Authorization: `Bearer ${accessToken}` }, timeoutMs: 30_000 },
      log
    );
    // No fallback guard in the shell: an unparseable fetchStatus response
    // aborted the step through pipefail (jq's parse error was the message).
    const state = jqExtract(status.text, ['lastAsyncUploadState']);
    if (!state.ok) {
      log('fetchStatus response could not be parsed as JSON (jq parse error before the move)');
      throw new StepFailed();
    }
    uploadState = jqAlternative(state.value, 'UNKNOWN');
    log(`Upload status check ${attempt}/${UPLOAD_POLL_MAX}: ${uploadState}`);
  }

  if (uploadState !== 'SUCCEEDED') {
    log(`Upload failed with state: ${uploadState}`);
    throw new StepFailed();
  }

  if (cwsAutoPublish !== 'true') {
    log("CWS_AUTO_PUBLISH is not 'true'; skipping publish");
    return;
  }

  // Transport failures abort via requestOrAbort (curl exit under set -e); an
  // API-level rejection is a non-200 response. The Edge step uses the same
  // status-code pattern.
  const publish = await requestOrAbort(
    fetchFn,
    `https://chromewebstore.googleapis.com/v2/${itemPath}:publish`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ publishType: 'DEFAULT_PUBLISH' }),
      timeoutMs: 60_000,
    },
    log
  );
  if (publish.status !== 200) {
    log(`Publish failed (HTTP ${publish.status}):`);
    log(projectErrorFields(publish.text) ?? 'Non-JSON response');
    throw new StepFailed();
  }
  // Belt and suspenders: a 200 body that still carries an error object is a
  // failure. jq -r '.error.message // empty' had no fallback guard, so an
  // unparseable body aborted the step (jq's message was the only output).
  const publishError = jqExtract(publish.text, ['error', 'message']);
  if (!publishError.ok) {
    log('Publish response could not be read for .error.message (jq parse error before the move)');
    throw new StepFailed();
  }
  // jq -r renders strings raw and other JSON values as compact JSON.
  const publishErrorValue = jqAlternative(publishError.value, '');
  if (publishErrorValue !== '') {
    log(`Publish failed: ${jqRawRender(publishErrorValue)}`);
    throw new StepFailed();
  }
  log('Publish submitted');
}

if (isCliEntry(import.meta.url)) {
  runCli(() => uploadAndPublishCws(process.env));
}
