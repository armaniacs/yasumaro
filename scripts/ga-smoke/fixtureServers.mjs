#!/usr/bin/env node

/**
 * fixtureServers.mjs — Stage 2 of the GA Release Smoke Runner.
 *
 * Spins up deterministic local servers on permitted loopback ports
 * (LOOPBACK_PORTS: 11434, 27123, 27124, 1234) plus an ephemeral-port test
 * article server so the real production extension (`OW_E2E_PROBE=0`) can be
 * exercised end-to-end across all 3 browsers without external flakiness.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';

/** Mirrors src/utils/loopbackPorts.ts (host_permissions & CSP SSOT). */
export const PERMITTED_LOOPBACK_PORTS = [11434, 27123, 27124, 1234];

/** Probe free ports from the permitted loopback pool in priority order. */
export async function allocatePermittedPorts(count, exclude = new Set(), host = '127.0.0.1') {
  const allocated = [];
  for (const port of PERMITTED_LOOPBACK_PORTS) {
    if (exclude.has(port)) continue;
    const free = await new Promise((resolve) => {
      const probe = http.createServer();
      probe.once('error', () => resolve(false));
      probe.listen(port, host, () => probe.close(() => resolve(true)));
    });
    if (free) {
      allocated.push(port);
      exclude.add(port);
      if (allocated.length === count) return allocated;
    }
  }
  throw new Error(
    `Need ${count} free permitted loopback ports from [${PERMITTED_LOOPBACK_PORTS.join(', ')}], only found [${allocated.join(', ')}]. Stop local Ollama/LM Studio/Obsidian or pass --live.`,
  );
}

function listenServer(server, port, host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const onError = (err) => reject(err);
    server.once('error', onError);
    server.listen(port, host, () => {
      server.removeListener('error', onError);
      const addr = server.address();
      resolve(typeof addr === 'object' && addr ? addr.port : port);
    });
  });
}

function closeServer(server) {
  return new Promise((resolve) => {
    if (!server) return resolve();
    server.close(() => resolve());
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

/**
 * Prepare a TLS certificate for `127.0.0.1` / `localhost`.
 * Prefers `mkcert` (OS-trusted local CA) when installed and trusted; otherwise
 * falls back to the repo's self-signed dev cert or generates one with openssl.
 */
export function prepareLocalTlsCert(workDir, rootDir) {
  const certDir = path.join(workDir, 'tls');
  mkdirSync(certDir, { recursive: true });
  const certPath = path.join(certDir, 'localhost.pem');
  const keyPath = path.join(certDir, 'localhost-key.pem');

  const mkcertCheck = spawnSync('which', ['mkcert'], { encoding: 'utf-8' });
  if (mkcertCheck.status === 0) {
    const caRootRes = spawnSync('mkcert', ['-CAROOT'], { encoding: 'utf-8' });
    const caRoot = caRootRes.stdout.trim();
    const hasRootCa = caRoot && existsSync(path.join(caRoot, 'rootCA.pem'));
    if (hasRootCa) {
      const gen = spawnSync(
        'mkcert',
        ['-cert-file', certPath, '-key-file', keyPath, '127.0.0.1', 'localhost'],
        { encoding: 'utf-8' },
      );
      if (gen.status === 0 && existsSync(certPath) && existsSync(keyPath)) {
        return {
          cert: readFileSync(certPath),
          key: readFileSync(keyPath),
          tlsMode: 'mkcert-os-trusted',
        };
      }
    }
  }

  const repoCert = path.join(rootDir, 'testDir/e2e/fixtures/dev-server-cert.pem');
  const repoKey = path.join(rootDir, 'testDir/e2e/fixtures/dev-server-key.pem');
  if (existsSync(repoCert) && existsSync(repoKey)) {
    return {
      cert: readFileSync(repoCert),
      key: readFileSync(repoKey),
      tlsMode: 'self-signed-dev-cert',
    };
  }

  const gen = spawnSync(
    'openssl',
    [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', keyPath, '-out', certPath,
      '-days', '2', '-subj', '/CN=127.0.0.1',
      '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost',
    ],
    { encoding: 'utf-8' },
  );
  if (gen.status !== 0) {
    throw new Error(`Failed to generate local TLS certificate: ${gen.stderr}`);
  }
  return {
    cert: readFileSync(certPath),
    key: readFileSync(keyPath),
    tlsMode: 'self-signed-openssl',
  };
}

/**
 * Start Mock Obsidian Local REST API server.
 * Supports strong ETag / If-Match conflict scenarios:
 * - 'normal': every PUT succeeds
 * - 'conflict_once': first PUT returns 412 + simulates concurrent edit; second PUT succeeds
 * - 'conflict_always': every PUT returns 412 (verifies retry cap = 1 + failure notification)
 */
export async function startMockObsidianServer({ port, apiKey = 'smoke-obsidian-key' }) {
  const notes = new Map();
  let versionCounter = 1;
  let mode = 'normal';
  let conflictTriggeredForCurrentMode = false;
  const requests = [];

  const server = http.createServer(async (req, res) => {
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${apiKey}`) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    const urlPath = (req.url || '/').split('?')[0];

    if (req.method === 'GET' && urlPath === '/') {
      requests.push({ method: 'GET', path: urlPath, status: 200 });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ authenticated: true, service: 'Yasumaro Smoke Mock Obsidian' }));
      return;
    }

    if (urlPath.startsWith('/vault/')) {
      if (req.method === 'GET') {
        const entry = notes.get(urlPath);
        if (!entry) {
          requests.push({ method: 'GET', path: urlPath, status: 404 });
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not found');
          return;
        }
        requests.push({ method: 'GET', path: urlPath, status: 200, etag: entry.etag });
        res.writeHead(200, {
          'Content-Type': 'text/markdown; charset=utf-8',
          ETag: entry.etag,
        });
        res.end(entry.content);
        return;
      }

      if (req.method === 'PUT') {
        const body = await readBody(req);
        const ifMatch = req.headers['if-match'] || null;
        const current = notes.get(urlPath);

        const shouldFail412 =
          mode === 'conflict_always' ||
          (mode === 'conflict_once' && !conflictTriggeredForCurrentMode);

        if (shouldFail412) {
          conflictTriggeredForCurrentMode = true;
          versionCounter += 1;
          const bumpedEtag = `"smoke-v${versionCounter}"`;
          const baseContent = current ? current.content : '# Daily Note\n';
          notes.set(urlPath, {
            content: `${baseContent}\n- Concurrent Obsidian Edit v${versionCounter}\n`,
            etag: bumpedEtag,
          });
          requests.push({ method: 'PUT', path: urlPath, status: 412, ifMatch, bodyLength: body.length });
          res.writeHead(412, { 'Content-Type': 'application/json', ETag: bumpedEtag });
          res.end(JSON.stringify({ error: 'Precondition Failed (simulated concurrent edit)' }));
          return;
        }

        if (current && ifMatch && ifMatch !== current.etag) {
          requests.push({ method: 'PUT', path: urlPath, status: 412, ifMatch, expectedEtag: current.etag });
          res.writeHead(412, { 'Content-Type': 'application/json', ETag: current.etag });
          res.end(JSON.stringify({ error: 'ETag mismatch' }));
          return;
        }

        versionCounter += 1;
        const nextEtag = `"smoke-v${versionCounter}"`;
        notes.set(urlPath, { content: body, etag: nextEtag });
        requests.push({ method: 'PUT', path: urlPath, status: 204, ifMatch, bodyLength: body.length });
        res.writeHead(204, { ETag: nextEtag });
        res.end();
        return;
      }
    }

    res.writeHead(404);
    res.end();
  });

  const boundPort = await listenServer(server, port);
  return {
    port: boundPort,
    apiKey,
    baseUrl: `http://127.0.0.1:${boundPort}`,
    setMode(nextMode) {
      mode = nextMode;
      conflictTriggeredForCurrentMode = false;
    },
    seedNote(vaultRelativePath, content) {
      versionCounter += 1;
      const fullPath = vaultRelativePath.startsWith('/vault/')
        ? vaultRelativePath
        : `/vault/${vaultRelativePath}`;
      notes.set(fullPath, { content, etag: `"smoke-v${versionCounter}"` });
    },
    getNotes() {
      return Object.fromEntries(Array.from(notes.entries()).map(([k, v]) => [k, v]));
    },
    getRequests() {
      return [...requests];
    },
    clearRequests() {
      requests.length = 0;
    },
    close: () => closeServer(server),
  };
}

/**
 * Start Mock Local AI Server (Ollama / OpenAI-compatible `/v1/chat/completions`).
 * Records every request body so Flow 5 and Flow 7 (per-domain AI send policy)
 * can assert whether content was sent raw, PII-masked, or not sent at all.
 */
export async function startMockAiServer({ port }) {
  const captured = [];

  const server = http.createServer(async (req, res) => {
    const urlPath = (req.url || '/').split('?')[0];

    if (req.method === 'GET' && (urlPath === '/v1/models' || urlPath === '/api/tags')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          data: [{ id: 'smoke-model', object: 'model' }],
          models: [{ name: 'smoke-model' }],
        }),
      );
      return;
    }

    if (req.method === 'POST' && (urlPath === '/v1/chat/completions' || urlPath === '/api/chat')) {
      const raw = await readBody(req);
      let parsed = null;
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = { raw };
      }
      captured.push({
        timestamp: Date.now(),
        path: urlPath,
        body: parsed,
        raw,
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          id: `smoke-chat-${captured.length}`,
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: parsed?.model || 'smoke-model',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: 'Mock AI summary for GA smoke verification. #smoke-ai #ga-check',
              },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 42, completion_tokens: 18, total_tokens: 60 },
        }),
      );
      return;
    }

    res.writeHead(404);
    res.end();
  });

  const boundPort = await listenServer(server, port);
  return {
    port: boundPort,
    baseUrl: `http://127.0.0.1:${boundPort}/v1`,
    model: 'smoke-model',
    getCaptured() {
      return [...captured];
    },
    clearCaptured() {
      captured.length = 0;
    },
    close: () => closeServer(server),
  };
}

/**
 * Start HTTPS Webhook Receiver on a permitted loopback port.
 * Captures POST payloads and `Idempotency-Key` headers for Flow 10.
 */
export async function startMockWebhookServer({ port, workDir, rootDir }) {
  const { cert, key, tlsMode } = prepareLocalTlsCert(workDir, rootDir);
  const received = [];

  const server = https.createServer({ cert, key }, async (req, res) => {
    const raw = await readBody(req);
    let json = null;
    try {
      json = JSON.parse(raw);
    } catch {
      json = null;
    }
    received.push({
      timestamp: Date.now(),
      method: req.method,
      url: req.url,
      idempotencyKey: req.headers['idempotency-key'] || null,
      contentType: req.headers['content-type'] || null,
      body: json,
      raw,
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, count: received.length }));
  });

  const boundPort = await listenServer(server, port);
  return {
    port: boundPort,
    tlsMode,
    origin: `https://127.0.0.1:${boundPort}`,
    getReceived() {
      return [...received];
    },
    clearReceived() {
      received.length = 0;
    },
    close: () => closeServer(server),
  };
}

/**
 * Start Test Article & Privacy Server on an ephemeral port.
 * Serves deterministic public, short, private (`Cache-Control: private`), and
 * PII-bearing pages without depending on external internet availability.
 */
export async function startArticleServer({ port = 0 } = {}) {
  const fillerParagraphs = Array.from(
    { length: 45 },
    (_, i) =>
      `<p>Paragraph ${i + 1}: Yasumaro GA smoke test article content verifying real content script scroll tracking, dwell duration measurement, and full SQLite FTS5 indexing across browsers.</p>`,
  ).join('\n');

  const server = http.createServer((req, res) => {
    const reqUrl = new URL(req.url || '/', 'http://127.0.0.1');
    const pathname = reqUrl.pathname;
    const tag = reqUrl.searchParams.get('tag') || 'default';

    if (pathname === '/long-article.html') {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=60',
      });
      res.end(`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>GA Smoke Long Article (${tag})</title></head>
<body style="min-height: 4500px; font-family: sans-serif; padding: 24px;">
  <main>
    <h1>GA Smoke Long Article (${tag})</h1>
    <p>Unique search token: YASUMARO_SMOKE_TOKEN_${tag}</p>
    ${fillerParagraphs}
  </main>
</body>
</html>`);
      return;
    }

    if (pathname === '/short-article.html') {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=60',
      });
      res.end(`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>GA Smoke Short Unsatisfied (${tag})</title></head>
<body style="min-height: 4500px; font-family: sans-serif; padding: 24px;">
  <main>
    <h1>GA Smoke Short Unsatisfied (${tag})</h1>
    <p>This page is intentionally left un-scrolled to verify auto-recording gating.</p>
    ${fillerParagraphs}
  </main>
</body>
</html>`);
      return;
    }

    if (pathname === '/private-pii.html') {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'private, no-store',
      });
      res.end(`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>GA Smoke Private PII Page (${tag})</title></head>
<body style="min-height: 3000px; font-family: sans-serif; padding: 24px;">
  <main>
    <h1>Confidential Account Overview</h1>
    <p>Contact email: smoke.secret.user@example.com</p>
    <p>Card number: 4111-1111-1111-1111</p>
    <p>My Number: 1234-5678-9012</p>
    ${fillerParagraphs}
  </main>
</body>
</html>`);
      return;
    }

    if (pathname === '/public-pii.html') {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=60',
      });
      res.end(`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>GA Smoke Public PII Page (${tag})</title></head>
<body style="min-height: 3500px; font-family: sans-serif; padding: 24px;">
  <main>
    <h1>Public Support Thread (${tag})</h1>
    <p>Please reach out to smoke.masked.target@example.com for details.</p>
    <p>Reference card 4111-1111-1111-1111 and ID 1234-5678-9012.</p>
    ${fillerParagraphs}
  </main>
</body>
</html>`);
      return;
    }

    res.writeHead(404);
    res.end('Not Found');
  });

  const boundPort = await listenServer(server, port);
  return {
    port: boundPort,
    baseUrl: `http://127.0.0.1:${boundPort}`,
    close: () => closeServer(server),
  };
}

/**
 * Start the full smoke fixture server suite in one call and return a unified
 * handle with `.closeAll()`.
 *
 * Multiplexes the Article/Privacy, Mock Obsidian, and Mock AI endpoints onto a
 * SINGLE permitted loopback HTTP port (their URL paths are completely disjoint),
 * and binds the HTTPS Webhook receiver onto a second permitted loopback port.
 * That requires only 2 free ports out of LOOPBACK_PORTS (11434, 27123, 27124,
 * 1234) — so even when real Obsidian (27124) and real Ollama (11434) are both
 * running simultaneously, every fixture STILL sits inside `host_permissions`
 * (required for MV3 `webRequest.onHeadersReceived` privacy header verdicts).
 */
export async function startFixtureSuite({ workDir, rootDir, reservedPorts = new Set() }) {
  const [httpPort, webhookPort] = await allocatePermittedPorts(2, new Set(reservedPorts));

  // Spin up individual handlers on ephemeral internal ports or route directly:
  // using an HTTP reverse-multiplexer on `httpPort` keeps every standalone
  // server helper cleanly testable while exposing all three on one permitted port.
  const [articleBack, obsidianBack, aiBack, webhook] = await Promise.all([
    startArticleServer({ port: 0 }),
    startMockObsidianServer({ port: 0 }),
    startMockAiServer({ port: 0 }),
    startMockWebhookServer({ port: webhookPort, workDir, rootDir }),
  ]);

  const muxServer = http.createServer((req, res) => {
    const pathname = (req.url || '/').split('?')[0];
    let targetPort = articleBack.port;
    if (pathname === '/' || pathname.startsWith('/vault/')) {
      targetPort = obsidianBack.port;
    } else if (pathname.startsWith('/v1/') || pathname.startsWith('/api/')) {
      targetPort = aiBack.port;
    }

    const proxyReq = http.request(
      {
        hostname: '127.0.0.1',
        port: targetPort,
        path: req.url,
        method: req.method,
        headers: req.headers,
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
        proxyRes.pipe(res);
      },
    );
    proxyReq.on('error', (err) => {
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'text/plain' });
      }
      res.end(`Smoke fixture mux error: ${err.message}`);
    });
    req.pipe(proxyReq);
  });

  const boundHttpPort = await listenServer(muxServer, httpPort);

  return {
    article: {
      ...articleBack,
      port: boundHttpPort,
      baseUrl: `http://127.0.0.1:${boundHttpPort}`,
    },
    obsidian: {
      ...obsidianBack,
      port: boundHttpPort,
      baseUrl: `http://127.0.0.1:${boundHttpPort}`,
    },
    ai: {
      ...aiBack,
      port: boundHttpPort,
      baseUrl: `http://127.0.0.1:${boundHttpPort}/v1`,
    },
    webhook,
    async closeAll() {
      await Promise.all([
        closeServer(muxServer),
        articleBack.close(),
        obsidianBack.close(),
        aiBack.close(),
        webhook.close(),
      ]);
    },
  };
}
