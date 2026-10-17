/**
 * publish-stores.test.ts — unit tests for the store-publish scripts moved out
 * of .github/workflows/release.yml (DX Advocate finding: the ~210-line inline
 * shell was outside the repository's test surface, so jq parsing and
 * polling branches only failed at release time).
 *
 * One file for the scripts/publish module group, placed in the group's
 * common parent __tests__/ per dev-docs/TEST_RULE.md (multi-module test).
 * Everything is injected (fetch / sleep / run / mkdtemp / cwd): no test
 * touches the network, spawns a process, or waits on real time (TEST_RULE:
 * 固定時間の待ちは禁止). Message strings are asserted literally because
 * 動作の意味論（出力メッセージ）は移設前後で不変でなければならない。
 */
import { describe, it, expect } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { uploadAndPublishCws } from '../publish/cws.mjs';
import { uploadAndPublishEdge } from '../publish/edge.mjs';
import { prepareAmoSources } from '../publish/amo-prepare-sources.mjs';
import { submitAmo } from '../publish/amo-submit.mjs';
import { StepFailed, defaultRun, jqExtractOr, projectErrorFields, requestOrAbort } from '../publish/lib.mjs';

interface FetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  redirect?: string;
  signal?: AbortSignal;
}

interface Route {
  // Exact URL string (full equality) or a strict predicate (typically an
  // endsWith suffix or anchored regex). Substring includes() is banned here:
  // '/submissions' as a substring also matches '/submissions/draft/package',
  // so routing silently depended on array order (P15).
  match: string | ((url: string) => boolean);
  respond: (call: { url: string; init: FetchInit }) => {
    status?: number;
    body?: string;
    headers?: Record<string, string>;
  };
}

function createFetch(routes: Route[]) {
  const calls: Array<{ url: string; init: FetchInit }> = [];
  const fetchImpl = async (url: string | URL, init: FetchInit = {}) => {
    const urlStr = String(url);
    calls.push({ url: urlStr, init });
    const route = routes.find((candidate) =>
      typeof candidate.match === 'function' ? candidate.match(urlStr) : urlStr === candidate.match
    );
    if (!route) throw new Error(`unrouted request: ${urlStr}`);
    const result = route.respond({ url: urlStr, init });
    const headerMap = Object.fromEntries(
      Object.entries(result.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value])
    );
    return {
      status: result.status ?? 200,
      headers: { get: (name: string) => headerMap[name.toLowerCase()] ?? null },
      text: async () => result.body ?? '',
    };
  };
  return { fetchImpl, calls };
}

function createHarness() {
  const logs: string[] = [];
  const sleepCalls: number[] = [];
  return {
    logs,
    sleepCalls,
    log: (message: unknown) => logs.push(String(message)),
    // Injected sleep: records the pacing and never consumes real time.
    sleep: async (ms: number) => {
      sleepCalls.push(ms);
    },
  };
}

/** Temp working directory holding dist/<artifact> the scripts read. */
function createCwdWithArtifacts(relativePaths: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'publish-stores-'));
  for (const relativePath of relativePaths) {
    const absolutePath = join(dir, relativePath);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, 'zip-payload');
  }
  return dir;
}

const CWS_ENV = {
  CHROME_EXTENSION_ID: 'ext-id',
  CHROME_PUBLISHER_ID: 'pub-id',
  CHROME_CLIENT_ID: 'client-id',
  CHROME_CLIENT_SECRET: 'client-secret',
  CHROME_REFRESH_TOKEN: 'refresh-token',
  CWS_AUTO_PUBLISH: 'true',
  VERSION: '1.2.3',
};

const TOKEN_URL = 'https://oauth2.googleapis.com/token';

const TOKEN_ROUTE: Route = {
  match: TOKEN_URL,
  respond: () => ({ body: '{"access_token":"tok-abc"}' }),
};

// Strict suffix predicates: ':publish' must not match ':upload' etc. via
// substring, so each branch pins its own endpoint (P15).
const endsWith = (suffix: string) => (url: string) => url.endsWith(suffix);

describe('cws', () => {
  describe('uploadAndPublishCws', () => {
    it('uploads, polls to SUCCEEDED and publishes with byte-identical log output', async () => {
      const cwd = createCwdWithArtifacts(['dist/yasumaro-1.2.3-chrome.crx']);
      let fetchStatusCalls = 0;
      const { fetchImpl, calls } = createFetch([
        TOKEN_ROUTE,
        { match: endsWith(':upload'), respond: () => ({ body: '{"uploadState":"IN_PROGRESS"}' }) },
        {
          match: endsWith(':fetchStatus'),
          respond: () => ({
            body:
              fetchStatusCalls++ === 0
                ? '{"lastAsyncUploadState":"NOT_FOUND"}'
                : '{"lastAsyncUploadState":"SUCCEEDED"}',
          }),
        },
        { match: endsWith(':publish'), respond: () => ({ body: '{}' }) },
      ]);
      const harness = createHarness();

      await uploadAndPublishCws(CWS_ENV, { fetch: fetchImpl, ...harness, cwd });

      expect(harness.logs).toEqual([
        '::add-mask::tok-abc',
        'Upload: IN_PROGRESS',
        'Upload status check 1/30: NOT_FOUND',
        'Upload status check 2/30: SUCCEEDED',
        'Publish submitted',
      ]);
      // 30 × 10s pacing, sleep injected (never real time).
      expect(harness.sleepCalls).toEqual([10_000, 10_000]);
      const uploadCall = calls.find((call) => call.url.endsWith(':upload'));
      expect(uploadCall?.init.body).toEqual(expect.any(Buffer));
      expect(String(uploadCall?.init.body)).toBe('zip-payload');
      expect(uploadCall?.init.headers?.Authorization).toBe('Bearer tok-abc');
      // curl never passed -L: redirects must not be followed.
      expect(uploadCall?.init.redirect).toBe('manual');
      const publishCall = calls.find((call) => call.url.endsWith(':publish'));
      expect(publishCall?.init.method).toBe('POST');
      expect(publishCall?.init.body).toBe('{"publishType":"DEFAULT_PUBLISH"}');
      expect(publishCall?.init.headers?.['Content-Type']).toBe('application/json');
    });

    it('stops before the upload when the token response carries no access_token', async () => {
      const { fetchImpl, calls } = createFetch([
        { match: TOKEN_URL, respond: () => ({ body: '{"error":"invalid_grant"}' }) },
        { match: endsWith(':upload'), respond: () => ({ body: '{"uploadState":"SUCCEEDED"}' }) },
      ]);
      const harness = createHarness();

      await expect(
        uploadAndPublishCws(CWS_ENV, { fetch: fetchImpl, ...harness, cwd: tmpdir() })
      ).rejects.toBeInstanceOf(StepFailed);

      expect(harness.logs).toEqual(['OAuth token refresh failed']);
      expect(calls).toHaveLength(1);
    });

    it('projects error fields for a non-JSON upload response, then fails the state check', async () => {
      const { fetchImpl } = createFetch([
        TOKEN_ROUTE,
        { match: endsWith(':upload'), respond: () => ({ body: '<html>oops</html>' }) },
      ]);
      const cwd = createCwdWithArtifacts(['dist/yasumaro-1.2.3-chrome.crx']);
      const harness = createHarness();

      await expect(
        uploadAndPublishCws(CWS_ENV, { fetch: fetchImpl, ...harness, cwd })
      ).rejects.toBeInstanceOf(StepFailed);

      expect(harness.logs).toEqual([
        '::add-mask::tok-abc',
        'Upload: UNKNOWN',
        'Upload response (error fields only):',
        'Non-JSON response (17 bytes)',
        'Upload failed with state: UNKNOWN',
      ]);
      expect(harness.sleepCalls).toEqual([]);
    });

    it('fails with the terminal state when the upload never reaches SUCCEEDED', async () => {
      const { fetchImpl } = createFetch([
        TOKEN_ROUTE,
        { match: endsWith(':upload'), respond: () => ({ body: '{"uploadState":"FAILED"}' }) },
      ]);
      const cwd = createCwdWithArtifacts(['dist/yasumaro-1.2.3-chrome.crx']);
      const harness = createHarness();

      await expect(
        uploadAndPublishCws(CWS_ENV, { fetch: fetchImpl, ...harness, cwd })
      ).rejects.toBeInstanceOf(StepFailed);

      expect(harness.logs).toEqual([
        '::add-mask::tok-abc',
        'Upload: FAILED',
        'Upload failed with state: FAILED',
      ]);
    });

    it('skips publish and exits zero when CWS_AUTO_PUBLISH is not true', async () => {
      const { fetchImpl, calls } = createFetch([
        TOKEN_ROUTE,
        { match: endsWith(':upload'), respond: () => ({ body: '{"uploadState":"SUCCEEDED"}' }) },
        { match: endsWith(':publish'), respond: () => ({ body: '{"error":"must not be called"}' }) },
      ]);
      const cwd = createCwdWithArtifacts(['dist/yasumaro-1.2.3-chrome.crx']);
      const harness = createHarness();

      await uploadAndPublishCws(
        { ...CWS_ENV, CWS_AUTO_PUBLISH: 'false' },
        { fetch: fetchImpl, ...harness, cwd }
      );

      expect(harness.logs).toEqual([
        '::add-mask::tok-abc',
        'Upload: SUCCEEDED',
        "CWS_AUTO_PUBLISH is not 'true'; skipping publish",
      ]);
      expect(calls.some((call) => call.url.endsWith(':publish'))).toBe(false);
    });

    it('prints the HTTP status and jq projection when publish is rejected', async () => {
      const { fetchImpl } = createFetch([
        TOKEN_ROUTE,
        { match: endsWith(':upload'), respond: () => ({ body: '{"uploadState":"SUCCEEDED"}' }) },
        {
          match: endsWith(':publish'),
          respond: () => ({ status: 500, body: '{"error":{"message":"quota"},"status":"FAILED"}' }),
        },
      ]);
      const cwd = createCwdWithArtifacts(['dist/yasumaro-1.2.3-chrome.crx']);
      const harness = createHarness();

      await expect(
        uploadAndPublishCws(CWS_ENV, { fetch: fetchImpl, ...harness, cwd })
      ).rejects.toBeInstanceOf(StepFailed);

      expect(harness.logs).toEqual([
        '::add-mask::tok-abc',
        'Upload: SUCCEEDED',
        'Publish failed (HTTP 500):',
        '{"error":{"message":"quota"},"status":"FAILED","message":null}',
      ]);
    });

    it('fails a 200 publish response that still carries error.message', async () => {
      const { fetchImpl } = createFetch([
        TOKEN_ROUTE,
        { match: endsWith(':upload'), respond: () => ({ body: '{"uploadState":"SUCCEEDED"}' }) },
        { match: endsWith(':publish'), respond: () => ({ body: '{"error":{"message":"item not found"}}' }) },
      ]);
      const cwd = createCwdWithArtifacts(['dist/yasumaro-1.2.3-chrome.crx']);
      const harness = createHarness();

      await expect(
        uploadAndPublishCws(CWS_ENV, { fetch: fetchImpl, ...harness, cwd })
      ).rejects.toBeInstanceOf(StepFailed);

      expect(harness.logs).toEqual([
        '::add-mask::tok-abc',
        'Upload: SUCCEEDED',
        'Publish failed: item not found',
      ]);
    });

    it('fails fast before any request when CHROME_EXTENSION_ID is missing (P5)', async () => {
      const { fetchImpl, calls } = createFetch([TOKEN_ROUTE]);
      const harness = createHarness();

      await expect(
        uploadAndPublishCws({ ...CWS_ENV, CHROME_EXTENSION_ID: '' }, { fetch: fetchImpl, ...harness, cwd: tmpdir() })
      ).rejects.toBeInstanceOf(StepFailed);

      expect(harness.logs).toEqual(['CHROME_EXTENSION_ID is missing']);
      expect(calls).toHaveLength(0);
    });

    it('fails fast before any request when CHROME_PUBLISHER_ID is missing (P5)', async () => {
      const { fetchImpl, calls } = createFetch([TOKEN_ROUTE]);
      const harness = createHarness();

      await expect(
        uploadAndPublishCws({ ...CWS_ENV, CHROME_PUBLISHER_ID: '' }, { fetch: fetchImpl, ...harness, cwd: tmpdir() })
      ).rejects.toBeInstanceOf(StepFailed);

      expect(harness.logs).toEqual(['CHROME_PUBLISHER_ID is missing']);
      expect(calls).toHaveLength(0);
    });

    it('counts bytes not characters for a non-JSON upload response (P3)', async () => {
      const { fetchImpl } = createFetch([
        TOKEN_ROUTE,
        // '<html>あ</html>': 14 characters but 16 UTF-8 bytes.
        { match: endsWith(':upload'), respond: () => ({ body: '<html>あ</html>' }) },
      ]);
      const cwd = createCwdWithArtifacts(['dist/yasumaro-1.2.3-chrome.crx']);
      const harness = createHarness();

      await expect(
        uploadAndPublishCws(CWS_ENV, { fetch: fetchImpl, ...harness, cwd })
      ).rejects.toBeInstanceOf(StepFailed);

      expect(harness.logs).toEqual([
        '::add-mask::tok-abc',
        'Upload: UNKNOWN',
        'Upload response (error fields only):',
        'Non-JSON response (16 bytes)',
        'Upload failed with state: UNKNOWN',
      ]);
    });

    it('says the upload did not finish in time when polling is exhausted (P4 Edge parity)', async () => {
      let fetchStatusCalls = 0;
      const { fetchImpl } = createFetch([
        TOKEN_ROUTE,
        { match: endsWith(':upload'), respond: () => ({ body: '{"uploadState":"IN_PROGRESS"}' }) },
        {
          match: endsWith(':fetchStatus'),
          respond: () => {
            fetchStatusCalls += 1;
            return { body: '{"lastAsyncUploadState":"IN_PROGRESS"}' };
          },
        },
      ]);
      const cwd = createCwdWithArtifacts(['dist/yasumaro-1.2.3-chrome.crx']);
      const harness = createHarness();

      await expect(
        uploadAndPublishCws(CWS_ENV, { fetch: fetchImpl, ...harness, cwd })
      ).rejects.toBeInstanceOf(StepFailed);

      expect(fetchStatusCalls).toBe(30);
      expect(harness.logs[0]).toBe('::add-mask::tok-abc');
      expect(harness.logs[1]).toBe('Upload: IN_PROGRESS');
      expect(harness.logs[harness.logs.length - 1]).toBe('Upload did not finish in time');
      expect(harness.sleepCalls).toHaveLength(30);
    });

    it('fails when the fetchStatus response cannot be parsed as JSON (P13)', async () => {
      const { fetchImpl } = createFetch([
        TOKEN_ROUTE,
        { match: endsWith(':upload'), respond: () => ({ body: '{"uploadState":"IN_PROGRESS"}' }) },
        { match: endsWith(':fetchStatus'), respond: () => ({ body: '<html>oops</html>' }) },
      ]);
      const cwd = createCwdWithArtifacts(['dist/yasumaro-1.2.3-chrome.crx']);
      const harness = createHarness();

      await expect(
        uploadAndPublishCws(CWS_ENV, { fetch: fetchImpl, ...harness, cwd })
      ).rejects.toBeInstanceOf(StepFailed);

      expect(harness.logs).toEqual([
        '::add-mask::tok-abc',
        'Upload: IN_PROGRESS',
        'fetchStatus response could not be parsed as JSON (jq parse error before the move)',
      ]);
      expect(harness.sleepCalls).toEqual([10_000]);
    });

    it('fails when the publish response cannot be read for .error.message (P13)', async () => {
      const { fetchImpl } = createFetch([
        TOKEN_ROUTE,
        { match: endsWith(':upload'), respond: () => ({ body: '{"uploadState":"SUCCEEDED"}' }) },
        { match: endsWith(':publish'), respond: () => ({ body: '<html>oops</html>' }) },
      ]);
      const cwd = createCwdWithArtifacts(['dist/yasumaro-1.2.3-chrome.crx']);
      const harness = createHarness();

      await expect(
        uploadAndPublishCws(CWS_ENV, { fetch: fetchImpl, ...harness, cwd })
      ).rejects.toBeInstanceOf(StepFailed);

      expect(harness.logs).toEqual([
        '::add-mask::tok-abc',
        'Upload: SUCCEEDED',
        'Publish response could not be read for .error.message (jq parse error before the move)',
      ]);
    });

    it('fails with the transport message when the token request fails (P14)', async () => {
      const harness = createHarness();
      const failingFetch = async () => {
        throw new Error('socket hang up');
      };

      await expect(
        uploadAndPublishCws(CWS_ENV, { fetch: failingFetch, ...harness, cwd: tmpdir() })
      ).rejects.toBeInstanceOf(StepFailed);

      expect(harness.logs).toEqual([
        `Request failed (${TOKEN_URL}): socket hang up`,
      ]);
    });
  });
});

describe('edge', () => {
  const EDGE_ENV = {
    EDGE_PRODUCT_ID: 'product-1',
    EDGE_CLIENT_ID: 'edge-client',
    EDGE_API_KEY: 'edge-key',
    EDGE_AUTO_PUBLISH: 'true',
    VERSION: '1.2.3',
  };

  describe('uploadAndPublishEdge', () => {
    // Strict predicates (P15): the operation-poll URL contains both
    // '/submissions' and '/draft/package' as substrings, so substring
    // matching made routing order-dependent. endsWith + anchored regex keep
    // the three endpoints disjoint no matter the array order — operations is
    // deliberately listed last to prove it.
    function edgeRoutes(operationStatuses: string[], uploadResponse?: Partial<{ status: number; body: string; headers: Record<string, string> }>) {
      const statusQueue = [...operationStatuses];
      return [
        {
          match: endsWith('/draft/package'),
          respond: () => ({
            status: 202,
            headers: { location: 'https://api.addons.microsoftedge.microsoft.com/v1/products/product-1/submissions/draft/package/operations/OP-UP-1' },
            ...uploadResponse,
          }),
        },
        {
          match: endsWith('/submissions'),
          respond: () => ({
            status: 202,
            headers: { location: 'https://api.addons.microsoftedge.microsoft.com/v1/products/product-1/submissions/operations/OP-PUB-1' },
          }),
        },
        {
          match: (url: string) => /\/operations\/[^/?#]+(?:[?#].*)?$/.test(url),
          respond: () => ({ body: statusQueue.shift() ?? '{"status":"Succeeded"}' }),
        },
      ] satisfies Route[];
    }

    it('uploads, waits for both operations and publishes', async () => {
      const cwd = createCwdWithArtifacts(['dist/yasumaro-1.2.3-edge.zip']);
      const { fetchImpl, calls } = createFetch(
        edgeRoutes(['{"status":"InProgress"}', '{"status":"Succeeded"}', '{"status":"Succeeded"}'])
      );
      const harness = createHarness();

      await uploadAndPublishEdge(EDGE_ENV, { fetch: fetchImpl, ...harness, cwd });

      expect(harness.logs).toEqual([
        'Upload: HTTP 202',
        'Upload status check 1/30: InProgress',
        'Upload status check 2/30: Succeeded',
        'Publish: HTTP 202',
        'Publish status check 1/30: Succeeded',
        'Publish submitted',
      ]);
      expect(harness.sleepCalls).toEqual([10_000]);
      const uploadCall = calls.find((call) => call.url.endsWith('/draft/package'));
      expect(uploadCall?.init.headers?.Authorization).toBe('ApiKey edge-key');
      expect(uploadCall?.init.headers?.['X-ClientID']).toBe('edge-client');
      expect(uploadCall?.init.headers?.['Content-Type']).toBe('application/zip');
      const publishCall = calls.find((call) => call.url.endsWith('/submissions'));
      expect(publishCall?.init.body).toBe('{"notes":"Automated release v1.2.3"}');
    });

    it('rejects the upload when the API answers 200 instead of 202', async () => {
      const cwd = createCwdWithArtifacts(['dist/yasumaro-1.2.3-edge.zip']);
      const { fetchImpl } = createFetch(edgeRoutes([], { status: 200, headers: {} }));
      const harness = createHarness();

      await expect(
        uploadAndPublishEdge(EDGE_ENV, { fetch: fetchImpl, ...harness, cwd })
      ).rejects.toBeInstanceOf(StepFailed);

      expect(harness.logs).toEqual(['Upload: HTTP 200', 'Edge upload was not accepted']);
    });

    it('fails when the upload response has no Location header', async () => {
      const cwd = createCwdWithArtifacts(['dist/yasumaro-1.2.3-edge.zip']);
      const { fetchImpl } = createFetch(edgeRoutes([], { headers: {} }));
      const harness = createHarness();

      await expect(
        uploadAndPublishEdge(EDGE_ENV, { fetch: fetchImpl, ...harness, cwd })
      ).rejects.toBeInstanceOf(StepFailed);

      expect(harness.logs).toEqual(['Upload: HTTP 202', 'No operation id in Location header']);
    });

    it('fails the wait loop with the failed-operation projection', async () => {
      const cwd = createCwdWithArtifacts(['dist/yasumaro-1.2.3-edge.zip']);
      const { fetchImpl } = createFetch(
        edgeRoutes(['{"status":"Failed","errorCode":"E_TIMEOUT","message":"processing failed"}'])
      );
      const harness = createHarness();

      await expect(
        uploadAndPublishEdge(EDGE_ENV, { fetch: fetchImpl, ...harness, cwd })
      ).rejects.toBeInstanceOf(StepFailed);

      expect(harness.logs).toEqual([
        'Upload: HTTP 202',
        'Upload status check 1/30: Failed',
        'Upload failed:',
        '{"status":"Failed","errorCode":"E_TIMEOUT","message":"processing failed"}',
      ]);
      expect(harness.sleepCalls).toEqual([]);
    });

    it('gives up after 30 polls when the operation never leaves InProgress', async () => {
      const cwd = createCwdWithArtifacts(['dist/yasumaro-1.2.3-edge.zip']);
      const { fetchImpl } = createFetch(edgeRoutes(Array(30).fill('{"status":"InProgress"}')));
      const harness = createHarness();

      await expect(
        uploadAndPublishEdge(EDGE_ENV, { fetch: fetchImpl, ...harness, cwd })
      ).rejects.toBeInstanceOf(StepFailed);

      expect(harness.logs).toHaveLength(32);
      expect(harness.logs[0]).toBe('Upload: HTTP 202');
      expect(harness.logs[31]).toBe('Upload did not finish in time');
      expect(harness.logs[1]).toBe('Upload status check 1/30: InProgress');
      expect(harness.logs[30]).toBe('Upload status check 30/30: InProgress');
      // Poll bound is pinned at 30 × 10s, injected (no real waiting).
      expect(harness.sleepCalls).toHaveLength(30);
      expect(new Set(harness.sleepCalls)).toEqual(new Set([10_000]));
    });

    it('skips publish when EDGE_AUTO_PUBLISH is not true', async () => {
      const cwd = createCwdWithArtifacts(['dist/yasumaro-1.2.3-edge.zip']);
      const { fetchImpl, calls } = createFetch(edgeRoutes(['{"status":"Succeeded"}']));
      const harness = createHarness();

      await uploadAndPublishEdge(
        { ...EDGE_ENV, EDGE_AUTO_PUBLISH: 'false' },
        { fetch: fetchImpl, ...harness, cwd }
      );

      expect(harness.logs).toEqual([
        'Upload: HTTP 202',
        'Upload status check 1/30: Succeeded',
        "EDGE_AUTO_PUBLISH is not 'true'; skipping publish",
      ]);
      expect(calls.some((call) => call.url.endsWith('/submissions'))).toBe(false);
    });

    it('fails fast before any request when EDGE_PRODUCT_ID is missing (P5)', async () => {
      const { fetchImpl, calls } = createFetch(edgeRoutes(['{"status":"Succeeded"}']));
      const harness = createHarness();

      await expect(
        uploadAndPublishEdge({ ...EDGE_ENV, EDGE_PRODUCT_ID: '' }, { fetch: fetchImpl, ...harness, cwd: tmpdir() })
      ).rejects.toBeInstanceOf(StepFailed);

      expect(harness.logs).toEqual(['EDGE_PRODUCT_ID is missing']);
      expect(calls).toHaveLength(0);
    });

    it('fails fast before any request when EDGE_API_KEY or EDGE_CLIENT_ID is missing', async () => {
      for (const [key, message] of [
        ['EDGE_API_KEY', 'EDGE_API_KEY is missing'],
        ['EDGE_CLIENT_ID', 'EDGE_CLIENT_ID is missing'],
      ] as const) {
        const { fetchImpl, calls } = createFetch(edgeRoutes(['{"status":"Succeeded"}']));
        const harness = createHarness();

        await expect(
          uploadAndPublishEdge({ ...EDGE_ENV, [key]: '' }, { fetch: fetchImpl, ...harness, cwd: tmpdir() })
        ).rejects.toBeInstanceOf(StepFailed);

        expect(harness.logs).toEqual([message]);
        expect(calls).toHaveLength(0);
      }
    });

    it('extracts the operation id despite query strings and trailing slashes (P8)', async () => {
      const cwd = createCwdWithArtifacts(['dist/yasumaro-1.2.3-edge.zip']);
      const { fetchImpl, calls } = createFetch([
        {
          match: endsWith('/draft/package'),
          respond: () => ({
            status: 202,
            headers: { location: 'https://api.addons.microsoftedge.microsoft.com/v1/products/product-1/submissions/draft/package/operations/OP-UP-9/?poll=true' },
          }),
        },
        {
          match: endsWith('/submissions'),
          respond: () => ({
            status: 202,
            headers: { location: 'https://api.addons.microsoftedge.microsoft.com/v1/products/product-1/submissions/operations/OP-PUB-9?poll=true/' },
          }),
        },
        {
          match: (url: string) => /\/operations\/[^/?#]+(?:[?#].*)?$/.test(url),
          respond: () => ({ body: '{"status":"Succeeded"}' }),
        },
      ]);
      const harness = createHarness();

      await uploadAndPublishEdge(EDGE_ENV, { fetch: fetchImpl, ...harness, cwd });

      expect(harness.logs).toEqual([
        'Upload: HTTP 202',
        'Upload status check 1/30: Succeeded',
        'Publish: HTTP 202',
        'Publish status check 1/30: Succeeded',
        'Publish submitted',
      ]);
      const polled = calls.map((call) => call.url);
      expect(polled).toContain(
        'https://api.addons.microsoftedge.microsoft.com/v1/products/product-1/submissions/draft/package/operations/OP-UP-9'
      );
      expect(polled).toContain(
        'https://api.addons.microsoftedge.microsoft.com/v1/products/product-1/submissions/operations/OP-PUB-9'
      );
    });
  });
});

describe('amo-prepare-sources', () => {
  describe('prepareAmoSources', () => {
    const ENV = { VERSION: '1.0.0', OW_E2E_PROBE: '0' };
    const RELATIVE = 'dist/yasumaro-1.0.0-sources.zip';

    it('accepts an already-built archive without spawning a rebuild', () => {
      const cwd = createCwdWithArtifacts([RELATIVE]);
      const runCalls: Array<{ command: string; args: string[] }> = [];
      const harness = createHarness();

      prepareAmoSources(ENV, {
        ...harness,
        cwd,
        run: (command: string, args: string[]) => {
          runCalls.push({ command, args });
          return 0;
        },
      });

      expect(harness.logs).toEqual([`AMO sources archive ready: ${RELATIVE}`]);
      expect(runCalls).toEqual([]);
    });

    it('rebuilds the Firefox bundle when the archive is missing', () => {
      const cwd = createCwdWithArtifacts([]);
      const runCalls: Array<{ command: string; args: string[]; options: { env?: Record<string, string> } }> = [];
      const harness = createHarness();

      prepareAmoSources(ENV, {
        ...harness,
        cwd,
        run: (command: string, args: string[], options: { env?: Record<string, string> }) => {
          runCalls.push({ command, args, options });
          // The rebuild produces the archive, like `npx wxt zip -b firefox` does.
          mkdirSync(dirname(join(cwd, RELATIVE)), { recursive: true });
          writeFileSync(join(cwd, RELATIVE), 'zip-payload');
          return 0;
        },
      });

      expect(runCalls).toHaveLength(1);
      expect(runCalls[0].command).toBe('npx');
      expect(runCalls[0].args).toEqual(['wxt', 'zip', '-b', 'firefox']);
      // OW_E2E_PROBE (step env) must reach the child so the rebuild strips the probe.
      expect(runCalls[0].options.env?.OW_E2E_PROBE).toBe('0');
      expect(harness.logs).toEqual([
        `${RELATIVE} is missing; rebuilding the Firefox bundle to produce it`,
        `AMO sources archive ready: ${RELATIVE}`,
      ]);
    });

    it('fails with the ::error annotation when the rebuild does not produce the archive', () => {
      const cwd = createCwdWithArtifacts([]);
      const harness = createHarness();

      expect(() =>
        prepareAmoSources(ENV, { ...harness, cwd, run: () => 0 })
      ).toThrow(StepFailed);

      expect(harness.logs).toEqual([
        `${RELATIVE} is missing; rebuilding the Firefox bundle to produce it`,
        `::error file=.github/workflows/release.yml::AMO sources archive ${RELATIVE} was not generated; the Submit to Firefox Add-ons (AMO) step would silently skip`,
      ]);
      expect(existsSync(join(cwd, RELATIVE))).toBe(false);
    });

    it('propagates the rebuild exit code instead of continuing', () => {
      const cwd = createCwdWithArtifacts([]);
      const harness = createHarness();

      try {
        prepareAmoSources(ENV, { ...harness, cwd, run: () => 3 });
        expect.unreachable('prepareAmoSources should have thrown StepFailed');
      } catch (error) {
        expect(error).toBeInstanceOf(StepFailed);
        expect((error as InstanceType<typeof StepFailed>).code).toBe(3);
      }
    });
  });
});

describe('amo-submit', () => {
  describe('submitAmo', () => {
    it('skips submission when AMO_AUTO_SUBMIT is not true', () => {
      const runCalls: unknown[][] = [];
      const mkdtempCalls: string[] = [];
      const harness = createHarness();

      submitAmo({ AMO_AUTO_SUBMIT: 'false', VERSION: '2.0.0' }, {
        ...harness,
        run: (...args: unknown[]) => {
          runCalls.push(args);
          return 0;
        },
        mkdtemp: () => {
          mkdtempCalls.push('called');
          return '/tmp/unused';
        },
      });

      expect(harness.logs).toEqual(["AMO_AUTO_SUBMIT is not 'true'; skipping AMO submission"]);
      expect(runCalls).toEqual([]);
      expect(mkdtempCalls).toEqual([]);
    });

    it('invokes web-ext sign with the pinned arguments and env credentials', () => {
      const runCalls: Array<{ command: string; args: string[]; options: Record<string, unknown> }> = [];
      const harness = createHarness();
      const cwd = createCwdWithArtifacts(['dist/yasumaro-2.0.0-sources.zip']);

      submitAmo(
        {
          AMO_AUTO_SUBMIT: 'true',
          VERSION: '2.0.0',
          WEB_EXT_API_KEY: 'jwt-issuer',
          WEB_EXT_API_SECRET: 'jwt-secret',
        },
        {
          ...harness,
          cwd,
          mkdtemp: () => '/tmp/amo-artifacts-fake',
          run: (command: string, args: string[], options: Record<string, unknown>) => {
            runCalls.push({ command, args, options });
            return 0;
          },
        }
      );

      expect(runCalls).toHaveLength(1);
      expect(runCalls[0].command).toBe('npx');
      expect(runCalls[0].args).toEqual([
        'web-ext',
        'sign',
        '--channel',
        'listed',
        '--source-dir',
        'dist/firefox-mv3',
        '--artifacts-dir',
        '/tmp/amo-artifacts-fake',
        '--upload-source-code',
        'dist/yasumaro-2.0.0-sources.zip',
        '--approval-timeout',
        '0',
        '--no-input',
      ]);
      const childEnv = runCalls[0].options.env as Record<string, string | undefined>;
      expect(childEnv.WEB_EXT_API_KEY).toBe('jwt-issuer');
      expect(childEnv.WEB_EXT_API_SECRET).toBe('jwt-secret');
      expect(childEnv.AMO_AUTO_SUBMIT).toBe('true');
      expect(runCalls[0].options.stdio).toBe('inherit');
      expect(harness.logs).toEqual(['AMO submission submitted: dist/yasumaro-2.0.0-sources.zip']);
    });

    it('fails before spawning web-ext when the sources archive is missing (P17)', () => {
      const runCalls: unknown[][] = [];
      const cwd = createCwdWithArtifacts([]);
      const harness = createHarness();

      expect(() =>
        submitAmo({ AMO_AUTO_SUBMIT: 'true', VERSION: '2.0.0' }, {
          ...harness,
          cwd,
          mkdtemp: () => '/tmp/amo-artifacts-fake',
          run: (...args: unknown[]) => {
            runCalls.push(args);
            return 0;
          },
        })
      ).toThrow(StepFailed);

      expect(harness.logs).toEqual([
        'AMO sources archive dist/yasumaro-2.0.0-sources.zip is missing; run the Prepare AMO sources archive step first',
      ]);
      expect(runCalls).toEqual([]);
    });

    it('stops the step with web-ext exit code when sign fails', () => {
      const harness = createHarness();
      const cwd = createCwdWithArtifacts(['dist/yasumaro-2.0.0-sources.zip']);

      try {
        submitAmo({ AMO_AUTO_SUBMIT: 'true', VERSION: '2.0.0' }, {
          ...harness,
          cwd,
          mkdtemp: () => '/tmp/amo-artifacts-fake',
          run: () => 2,
        });
        expect.unreachable('submitAmo should have thrown StepFailed');
      } catch (error) {
        expect(error).toBeInstanceOf(StepFailed);
        expect((error as InstanceType<typeof StepFailed>).code).toBe(2);
      }
    });
  });
});

describe('lib', () => {
  describe('jqExtractOr', () => {
    it('mirrors jq extraction and falls back to the alternative where jq would fail', () => {
      expect(jqExtractOr('{"status":"InProgress"}', ['status'], 'UNKNOWN')).toBe('InProgress');
      // Non-JSON, a scalar, and null all match the shell's guarded fallback.
      expect(jqExtractOr('<html></html>', ['status'], 'UNKNOWN')).toBe('UNKNOWN');
      expect(jqExtractOr('5', ['status'], 'UNKNOWN')).toBe('UNKNOWN');
      expect(jqExtractOr('null', ['status'], 'UNKNOWN')).toBe('UNKNOWN');
      // Missing key reads as null in jq → the // alternative applies.
      expect(jqExtractOr('{"other":1}', ['status'], 'UNKNOWN')).toBe('UNKNOWN');
    });
  });

  describe('projectErrorFields', () => {
    it('reproduces the jq projection shape, including false-as-null', () => {
      expect(projectErrorFields('{"error":{"message":"m"},"status":"S"}')).toBe(
        '{"error":{"message":"m"},"status":"S","message":null}'
      );
      expect(projectErrorFields('{"error":false}')).toBe(
        '{"error":null,"status":null,"message":null}'
      );
      // jq fails on junk → the shell printed its Non-JSON fallback instead.
      expect(projectErrorFields('not json')).toBeNull();
      expect(projectErrorFields('42')).toBeNull();
    });
  });

  describe('requestOrAbort', () => {
    it('logs the transport error and fails the step without touching the network (P14)', async () => {
      const logs: string[] = [];
      const log = (message: unknown) => logs.push(String(message));
      const failingFetch = async () => {
        throw new Error('socket hang up');
      };

      await expect(
        requestOrAbort(failingFetch, 'https://example.invalid/upload', { timeoutMs: 1000 }, log)
      ).rejects.toBeInstanceOf(StepFailed);

      expect(logs).toEqual(['Request failed (https://example.invalid/upload): socket hang up']);
    });
  });

  describe('defaultRun', () => {
    it('reports a spawn failure through the injected log instead of console.error (P12)', () => {
      const logs: string[] = [];
      const log = (message: unknown) => logs.push(String(message));

      const exitCode = defaultRun('__definitely_missing_publish_cmd__', [], {}, log);

      expect(exitCode).toBe(1);
      expect(logs).toHaveLength(1);
      expect(logs[0]).toContain('__definitely_missing_publish_cmd__');
    });
  });
});
