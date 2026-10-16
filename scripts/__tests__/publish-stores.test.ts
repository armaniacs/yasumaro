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
import { StepFailed, jqExtractOr, projectErrorFields } from '../publish/lib.mjs';

interface FetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  redirect?: string;
  signal?: AbortSignal;
}

interface Route {
  match: string;
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
    const route = routes.find((candidate) => urlStr.includes(candidate.match));
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

const TOKEN_ROUTE: Route = {
  match: 'oauth2.googleapis.com/token',
  respond: () => ({ body: '{"access_token":"tok-abc"}' }),
};

describe('cws', () => {
  describe('uploadAndPublishCws', () => {
    it('uploads, polls to SUCCEEDED and publishes with byte-identical log output', async () => {
      const cwd = createCwdWithArtifacts(['dist/yasumaro-1.2.3-chrome.crx']);
      let fetchStatusCalls = 0;
      const { fetchImpl, calls } = createFetch([
        TOKEN_ROUTE,
        { match: ':upload', respond: () => ({ body: '{"uploadState":"IN_PROGRESS"}' }) },
        {
          match: 'fetchStatus',
          respond: () => ({
            body:
              fetchStatusCalls++ === 0
                ? '{"lastAsyncUploadState":"NOT_FOUND"}'
                : '{"lastAsyncUploadState":"SUCCEEDED"}',
          }),
        },
        { match: ':publish', respond: () => ({ body: '{}' }) },
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
      const uploadCall = calls.find((call) => call.url.includes(':upload'));
      expect(uploadCall?.init.body).toEqual(expect.any(Buffer));
      expect(String(uploadCall?.init.body)).toBe('zip-payload');
      expect(uploadCall?.init.headers?.Authorization).toBe('Bearer tok-abc');
      // curl never passed -L: redirects must not be followed.
      expect(uploadCall?.init.redirect).toBe('manual');
      const publishCall = calls.find((call) => call.url.includes(':publish'));
      expect(publishCall?.init.method).toBe('POST');
      expect(publishCall?.init.body).toBe('{"publishType":"DEFAULT_PUBLISH"}');
      expect(publishCall?.init.headers?.['Content-Type']).toBe('application/json');
    });

    it('stops before the upload when the token response carries no access_token', async () => {
      const { fetchImpl, calls } = createFetch([
        { match: 'oauth2.googleapis.com/token', respond: () => ({ body: '{"error":"invalid_grant"}' }) },
        { match: ':upload', respond: () => ({ body: '{"uploadState":"SUCCEEDED"}' }) },
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
        { match: ':upload', respond: () => ({ body: '<html>oops</html>' }) },
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
        { match: ':upload', respond: () => ({ body: '{"uploadState":"FAILED"}' }) },
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
        { match: ':upload', respond: () => ({ body: '{"uploadState":"SUCCEEDED"}' }) },
        { match: ':publish', respond: () => ({ body: '{"error":"must not be called"}' }) },
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
      expect(calls.some((call) => call.url.includes(':publish'))).toBe(false);
    });

    it('prints the HTTP status and jq projection when publish is rejected', async () => {
      const { fetchImpl } = createFetch([
        TOKEN_ROUTE,
        { match: ':upload', respond: () => ({ body: '{"uploadState":"SUCCEEDED"}' }) },
        {
          match: ':publish',
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
        { match: ':upload', respond: () => ({ body: '{"uploadState":"SUCCEEDED"}' }) },
        { match: ':publish', respond: () => ({ body: '{"error":{"message":"item not found"}}' }) },
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
    function edgeRoutes(operationStatuses: string[], uploadResponse?: Partial<{ status: number; body: string; headers: Record<string, string> }>) {
      const statusQueue = [...operationStatuses];
      return [
        {
          match: '/operations/',
          respond: () => ({ body: statusQueue.shift() ?? '{"status":"Succeeded"}' }),
        },
        {
          match: '/draft/package',
          respond: () => ({
            status: 202,
            headers: { location: 'https://api.addons.microsoftedge.microsoft.com/v1/products/product-1/submissions/draft/package/operations/OP-UP-1' },
            ...uploadResponse,
          }),
        },
        {
          match: '/submissions',
          respond: () => ({
            status: 202,
            headers: { location: 'https://api.addons.microsoftedge.microsoft.com/v1/products/product-1/submissions/operations/OP-PUB-1' },
          }),
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
      const uploadCall = calls.find((call) => call.url.includes('/draft/package'));
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

      submitAmo(
        {
          AMO_AUTO_SUBMIT: 'true',
          VERSION: '2.0.0',
          WEB_EXT_API_KEY: 'jwt-issuer',
          WEB_EXT_API_SECRET: 'jwt-secret',
        },
        {
          ...harness,
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
      expect(harness.logs).toEqual([]);
    });

    it('stops the step with web-ext exit code when sign fails', () => {
      const harness = createHarness();

      try {
        submitAmo({ AMO_AUTO_SUBMIT: 'true', VERSION: '2.0.0' }, {
          ...harness,
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
});
