/**
 * redirect-policy-real-behavior.spec.ts — PBI 2026-10-19-04
 *
 * What only a real browser can prove about the no-redirect policy.
 *
 * Every other redirect test in this repo pins the *option* (`init.redirect ===
 * 'error'`) against a plain `fetch` mock. A mock cannot show what the platform
 * does when a 30x actually arrives: whether a second request is issued to the
 * `Location` target, and whether the rejection arrives in the shape the app's
 * retry classifier treats as a transport failure.
 *
 * This spec runs a real server that records every request it receives —
 * including the redirect target — and drives a real Chromium/Firefox fetch from
 * a page served by that same server (same origin, so no CORS masking).
 *
 * The `redirect: 'follow'` case is the **control**: it proves the fixture really
 * does make the browser follow a 30x, so the `error` case cannot pass vacuously.
 *
 * Not covered here (needs the loaded extension, see the unit pins instead): the
 * extension's own read/write/connection-test paths. Their `redirected` guards are
 * pinned by `src/background/__tests__/obsidianClient-secure-fetch.test.ts`, and
 * the policy application by `httpSummaryFlow.test.ts` / `httpTestFlow.test.ts`.
 */
import { test, expect } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { listenHttp, PERMITTED_LOOPBACK_PORTS } from './fixtures/localServers.js';
import { shouldRetryTransportFailure } from '../../src/utils/failureTaxonomy.js';

let server: Server | undefined;
let port = 0;
/** Every request the server received, in order (path + whether Authorization rode along). */
const hits: Array<{ path: string; authorization: boolean }> = [];

function handleRequest(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): void {
  const path = (req.url || '/').split('?')[0] || '/';
  hits.push({ path, authorization: Boolean(req.headers.authorization) });
  if (path === '/plain') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<!doctype html><html><body>ready</body></html>');
    return;
  }
  if (path === '/redirect') {
    // 307 keeps the method and body, which is why this status is the dangerous
    // one for a write: the note body would be re-sent to the Location target.
    // `host` carries the actually-bound port, so the Location is correct without
    // waiting for the bind to finish.
    res.writeHead(307, { Location: `http://${req.headers.host}/target` });
    res.end();
    return;
  }
  if (path === '/target') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('target body');
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('not found');
}

function baseUrl(): string {
  return `http://127.0.0.1:${port}`;
}

test.beforeAll(async () => {
  // The bind IS the free-port test. Probing first (as `pickLoopbackPort` does)
  // opens a window in which two parallel workers both see the same port free and
  // the loser silently shares the winner's server — the request records then
  // cross-talk (observed with `--workers=4`). Trying to listen is atomic: the OS
  // guarantees one binder, so no lock file or fixed wait is needed.
  for (const candidate of PERMITTED_LOOPBACK_PORTS) {
    const candidateServer = createServer(handleRequest);
    try {
      await listenHttp(candidateServer, candidate, '127.0.0.1');
      server = candidateServer;
      port = candidate;
      return;
    } catch {
      candidateServer.close();
    }
  }
  throw new Error(
    `no permitted loopback port is free (tried ${PERMITTED_LOOPBACK_PORTS.join(', ')})`,
  );
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => {
    if (!server) {
      resolve();
      return;
    }
    server.close(() => resolve());
  });
});

test.beforeEach(async ({ page }) => {
  // Same-origin page: `about:blank` would make the request cross-origin and CORS
  // would mask the very thing under test. The navigation itself is a hit, so the
  // recorder is cleared after it.
  await page.goto(`${baseUrl()}/plain`);
  hits.length = 0;
});

test.describe('@redirect redirect policy — real browser behavior', () => {
test('redirect:error issues no request to the Location target and rejects like a transport failure', async ({ page }) => {
  const outcome = await page.evaluate(async (base) => {
    try {
      await fetch(`${base}/redirect`, { redirect: 'error' });
      return { rejected: false, name: '', message: '' };
    } catch (error) {
      return {
        rejected: true,
        name: error instanceof Error ? error.name : '',
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }, baseUrl());

  expect(outcome.rejected).toBe(true);
  // The property a fetch mock cannot show: no second request leaves for the
  // redirect target.
  expect(hits.map((h) => h.path)).toEqual(['/redirect']);
  // The rejection arrives in the shape the app's own retry classifier already
  // treats as a transport failure (so a resend targets the original URL only).
  expect(
    shouldRetryTransportFailure(new Error(outcome.message), 1),
  ).toBe(true);
});

test('redirect:error does not leak the Authorization header to the target', async ({ page }) => {
  await page.evaluate(async (base) => {
    try {
      await fetch(`${base}/redirect`, {
        redirect: 'error',
        headers: { Authorization: 'Bearer e2e-secret-token' },
      });
    } catch {
      // The rejection is the expected path; the assertions below are about what
      // the server saw, not about the error.
    }
  }, baseUrl());

  expect(hits.map((h) => h.path)).toEqual(['/redirect']);
  expect(hits.some((h) => h.authorization)).toBe(true); // it did ride along to the configured URL
  expect(hits.filter((h) => h.path === '/target')).toHaveLength(0);
});

test('control: redirect:follow does reach the target, so the fixture is real', async ({ page }) => {
  const status = await page.evaluate(async (base) => {
    const response = await fetch(`${base}/redirect`, { redirect: 'follow' });
    return response.status;
  }, baseUrl());

  expect(status).toBe(200);
  expect(hits.map((h) => h.path)).toEqual(['/redirect', '/target']);
});
});
