import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  normalizeManifestVersion,
  verifyUnpackedArtifact,
} from '../ga-smoke/buildAndVerifyArtifacts.mjs';
import {
  startArticleServer,
  startMockAiServer,
  startMockObsidianServer,
} from '../ga-smoke/fixtureServers.mjs';
import { parseCliArgs } from '../ga-smoke/index.mjs';
import {
  assertNoSecretLeak,
  formatStatusLabel,
  renderMarkdownReport,
  sanitizeForShiftJisDocs,
  writeSmokeReports,
} from '../ga-smoke/reporter.mjs';

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('GA Smoke Runner — buildAndVerifyArtifacts', () => {
  it('normalizes semver prerelease and build metadata to Chrome manifest version', () => {
    expect(normalizeManifestVersion('6.9.77')).toBe('6.9.77');
    expect(normalizeManifestVersion('7.0.0-rc.1+build.5')).toBe('7.0.0');
  });

  it('passes when manifest matches and no E2E probe markers exist', () => {
    const dir = makeTempDir('ga-smoke-clean-');
    writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ version: '6.9.77' }));
    mkdirSync(path.join(dir, 'chunks'));
    writeFileSync(path.join(dir, 'chunks', 'background.js'), 'console.log("clean production build");');

    const res = verifyUnpackedArtifact(dir, '6.9.77');
    expect(res.ok).toBe(true);
    expect(res.errors).toEqual([]);
    expect(res.scannedFiles).toBe(1);
  });

  it('fails loudly when manifest version drifts or probe markers leak into bundle', () => {
    const dir = makeTempDir('ga-smoke-dirty-');
    writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ version: '6.9.76' }));
    writeFileSync(path.join(dir, 'content.js'), 'const flag = "owE2eProbeEnabled";');

    const res = verifyUnpackedArtifact(dir, '6.9.77');
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => e.includes('version mismatch'))).toBe(true);
    expect(res.errors.some((e) => e.includes('owE2eProbeEnabled'))).toBe(true);
  });
});

describe('GA Smoke Runner — fixtureServers', () => {
  it('simulates Obsidian auth, strong ETag, single 412 conflict, and always-412 conflict', async () => {
    const obsidian = await startMockObsidianServer({ port: 0, apiKey: 'test-obs-key' });
    try {
      const unauth = await fetch(`${obsidian.baseUrl}/`);
      expect(unauth.status).toBe(401);

      const authHeaders = { Authorization: 'Bearer test-obs-key' };
      const okRoot = await fetch(`${obsidian.baseUrl}/`, { headers: authHeaders });
      expect(okRoot.status).toBe(200);

      // Normal PUT + GET with strong ETag
      const put1 = await fetch(`${obsidian.baseUrl}/vault/smoke/today.md`, {
        method: 'PUT',
        headers: authHeaders,
        body: '# Daily\n- Entry 1\n',
      });
      expect(put1.status).toBe(204);

      const get1 = await fetch(`${obsidian.baseUrl}/vault/smoke/today.md`, { headers: authHeaders });
      expect(get1.status).toBe(200);
      const etag1 = get1.headers.get('etag');
      expect(etag1).toMatch(/^"smoke-v\d+"$/);

      // Single 412 conflict mode: 1st PUT -> 412 + concurrent edit, 2nd PUT with new ETag -> 204
      obsidian.setMode('conflict_once');
      const conflictPut = await fetch(`${obsidian.baseUrl}/vault/smoke/today.md`, {
        method: 'PUT',
        headers: { ...authHeaders, 'If-Match': etag1! },
        body: '# Daily\n- Entry 2\n',
      });
      expect(conflictPut.status).toBe(412);

      const reread = await fetch(`${obsidian.baseUrl}/vault/smoke/today.md`, { headers: authHeaders });
      expect(await reread.text()).toContain('Concurrent Obsidian Edit');
      const etag2 = reread.headers.get('etag')!;
      expect(etag2).not.toBe(etag1);

      const retryPut = await fetch(`${obsidian.baseUrl}/vault/smoke/today.md`, {
        method: 'PUT',
        headers: { ...authHeaders, 'If-Match': etag2 },
        body: '# Daily\n- Concurrent Obsidian Edit\n- Entry 2\n',
      });
      expect(retryPut.status).toBe(204);

      // Always 412 mode
      obsidian.setMode('conflict_always');
      const failPut = await fetch(`${obsidian.baseUrl}/vault/smoke/today.md`, {
        method: 'PUT',
        headers: authHeaders,
        body: 'attempt',
      });
      expect(failPut.status).toBe(412);
    } finally {
      await obsidian.close();
    }
  });

  it('captures AI payloads and serves Cache-Control: private + PII test pages', async () => {
    const [ai, article] = await Promise.all([startMockAiServer({ port: 0 }), startArticleServer()]);
    try {
      const aiRes = await fetch(`${ai.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'smoke-model', messages: [{ role: 'user', content: 'hello' }] }),
      });
      expect(aiRes.status).toBe(200);
      const aiJson = (await aiRes.json()) as { choices: Array<{ message: { content: string } }> };
      expect(aiJson.choices[0]?.message.content).toContain('Mock AI summary');
      expect(ai.getCaptured()).toHaveLength(1);

      const privRes = await fetch(`${article.baseUrl}/private-pii.html`);
      expect(privRes.status).toBe(200);
      expect(privRes.headers.get('cache-control')).toContain('private');
      expect(await privRes.text()).toContain('smoke.secret.user@example.com');
    } finally {
      await Promise.all([ai.close(), article.close()]);
    }
  });
});

describe('GA Smoke Runner — CLI & reporter', () => {
  it('parses CLI flags cleanly and rejects unknown browsers', () => {
    const parsed = parseCliArgs(['--browsers=chrome,firefox', '--skip-build', '--live', '--no-assisted'], true);
    expect(parsed.browsers).toEqual(['chrome', 'firefox']);
    expect(parsed.skipBuild).toBe(true);
    expect(parsed.live).toBe(true);
    expect(parsed.assisted).toBe(false);

    expect(() => parseCliArgs(['--browsers=safari'], false)).toThrow(/Unknown browser/);
  });

  it('sanitizes EM DASH for Shift-JIS compliance and blocks secret leaks', () => {
    expect(sanitizeForShiftJisDocs('A — B ≤ C')).toBe('A ― B ≦ C');
    expect(formatStatusLabel('pass')).toBe('合格(自動)');
    expect(() => assertNoSecretLeak('leaked SECRET_KEY_12345 here', ['SECRET_KEY_12345'])).toThrow(
      /Secret leak detected/,
    );

    const reportDir = makeTempDir('ga-smoke-report-');
    const md = renderMarkdownReport({
      metadata: {
        date: '2026-11-25',
        extensionVersion: '6.9.77',
        manifestVersion: '6.9.77',
        gitSha: 'abc1234',
        os: 'macOS 27.2.1',
        browsers: {
          chrome: { version: 'Chrome 158' },
          edge: { version: 'Edge 158' },
          firefox: { version: 'Firefox 159' },
        },
      },
      suitesByBrowser: {
        chrome: {
          browserVersion: '158.0.8127.38',
          results: [{ id: 1, name: '初回起動', status: 'pass', note: 'OK' }],
        },
      },
      localeResults: { ja: { ok: true, hasRawMsg: false }, 'en-US': { ok: true, hasRawMsg: false } },
    });
    expect(md).not.toContain('\u2014');
    expect(md).toContain('| 1 | 合格(自動) | 未 | 未 |');

    const written = writeSmokeReports({
      reportDir,
      metadata: {
        date: '2026-11-25',
        extensionVersion: '6.9.77',
        manifestVersion: '6.9.77',
        gitSha: 'abc1234',
        os: 'macOS 27.2.1',
        browsers: {},
      },
      suitesByBrowser: {},
      localeResults: null,
      secrets: ['SUPER_SECRET_TOKEN_999'],
    });
    expect(written.mdPath).toContain('report.md');
  });
});
