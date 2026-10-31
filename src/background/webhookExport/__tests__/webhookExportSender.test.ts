/**
 * webhookExportSender.test.ts
 * PBI 2026-10-22-05 box (c) ― send path: gates before network, masking
 * before send, private exclusion, idempotent resend, fail-closed blocks.
 *
 * No real timers, no network: every seam (fetch/permission/mask/notify/
 * clock/history) is injected and settles immediately.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  defaultIsWebhookHostPermitted,
  isUrlCoveredByHostPattern,
  sendWebhookExport,
  WEBHOOK_EXPORT_REASONS,
  type WebhookExportNotice,
  type WebhookExportSenderDeps,
  type WebhookExportSendInput,
} from '../webhookExportSender.js';
import { WebhookExportHistory, type WebhookExportHistoryEntry } from '../webhookExportHistory.js';
import type { WebhookExportRecord } from '../webhookExportPayload.js';
import type { WebhookExportSettings } from '../webhookExportSettings.js';
import { buildLocalHostPermissions } from '../../../utils/cspDomains.js';

function makeRecord(overrides: Partial<WebhookExportRecord> = {}): WebhookExportRecord {
  return {
    id: 'r1',
    title: 'Example',
    url: 'https://example.com/p1',
    summary: 'cleansed summary',
    tags: 'obsidian,web',
    ...overrides,
  };
}

function makeSettings(overrides: Partial<WebhookExportSettings> = {}): WebhookExportSettings {
  return { enabled: true, url: 'https://hooks.example.com/hook', condition: {}, ...overrides };
}

interface FetchCall {
  url: string;
  init: { method: string; headers: Record<string, string>; body: string };
}

function makeDeps(overrides: Partial<WebhookExportSenderDeps> = {}): WebhookExportSenderDeps & {
  fetchCalls: FetchCall[];
  notices: WebhookExportNotice[];
} {
  const fetchCalls: FetchCall[] = [];
  const notices: WebhookExportNotice[] = [];
  const store: Record<string, string> = {};
  const deps = {
    fetchCalls,
    notices,
    fetchFn: vi.fn(async (url: string, init: { method: string; headers: Record<string, string>; body: string }) => {
      fetchCalls.push({ url, init });
      return { ok: true, status: 200 };
    }),
    isHostPermitted: vi.fn(async (_url: string) => true),
    maskText: vi.fn(async (text: string) => text),
    notify: vi.fn((event: WebhookExportNotice) => {
      notices.push(event);
    }),
    now: () => 1700000000000,
    history: new WebhookExportHistory({
      get: async (key: string): Promise<string | null> =>
        typeof store[key] === 'string' ? (store[key] as string) : null,
      set: async (key: string, value: string): Promise<void> => {
        store[key] = value;
      },
    }),
    ...overrides,
  };
  return deps;
}

function makeInput(overrides: Partial<WebhookExportSendInput> = {}): WebhookExportSendInput {
  return { record: makeRecord(), settings: makeSettings(), isPrivate: false, ...overrides };
}

describe('pre-send gates (no network before the verdict)', () => {
  it('skips silently when disabled', async () => {
    const deps = makeDeps();
    const result = await sendWebhookExport(makeInput({ settings: makeSettings({ enabled: false }) }), deps);
    expect(result).toEqual({ outcome: 'skipped', reason: WEBHOOK_EXPORT_REASONS.disabled, key: null });
    expect(deps.fetchFn).not.toHaveBeenCalled();
    expect(await deps.history.list()).toEqual([]);
    expect(deps.notices).toEqual([]);
  });

  it('blocks a non-https destination with an attributable history row, still no fetch', async () => {
    const deps = makeDeps();
    const result = await sendWebhookExport(
      makeInput({ settings: makeSettings({ url: 'http://hooks.example.com/hook' }) }),
      deps,
    );
    expect(result.outcome).toBe('blocked');
    expect(result.reason).toBe(WEBHOOK_EXPORT_REASONS.nonHttpsDestination);
    expect(deps.fetchFn).not.toHaveBeenCalled();
    const rows = await deps.history.list();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('blocked');
    expect(rows[0]?.origin).toBe('http://hooks.example.com');
    expect(deps.notices).toHaveLength(1);
    expect(deps.notices[0]?.origin).toBe('http://hooks.example.com');
  });

  it('skips on condition mismatch without history or notice noise', async () => {
    const deps = makeDeps();
    const result = await sendWebhookExport(
      makeInput({ settings: makeSettings({ condition: { tag: 'missing' } }) }),
      deps,
    );
    expect(result).toEqual({ outcome: 'skipped', reason: WEBHOOK_EXPORT_REASONS.conditionMismatch, key: null });
    expect(deps.fetchFn).not.toHaveBeenCalled();
    expect(await deps.history.list()).toEqual([]);
  });

  it('excludes private pages before send (private exclusion)', async () => {
    const deps = makeDeps();
    const result = await sendWebhookExport(makeInput({ isPrivate: true }), deps);
    expect(result).toEqual({ outcome: 'skipped', reason: WEBHOOK_EXPORT_REASONS.privateExcluded, key: null });
    expect(deps.fetchFn).not.toHaveBeenCalled();
    expect(await deps.history.list()).toEqual([]);
  });

  it('blocks the send when the privacy verdict is absent (fail-closed egress)', async () => {
    const deps = makeDeps();
    const result = await sendWebhookExport(makeInput({ isPrivate: undefined }), deps);
    expect(result.outcome).toBe('blocked');
    expect(result.reason).toBe(WEBHOOK_EXPORT_REASONS.privacyVerdictAbsent);
    expect(deps.fetchFn).not.toHaveBeenCalled();
    const rows = await deps.history.list();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('blocked');
    expect(rows[0]?.reason).toBe(WEBHOOK_EXPORT_REASONS.privacyVerdictAbsent);
    expect(deps.notices).toHaveLength(1);
    expect(deps.notices[0]?.reason).toBe(WEBHOOK_EXPORT_REASONS.privacyVerdictAbsent);
  });

  it('blocks an undeclared origin via the permission gate — never fetched', async () => {
    const deps = makeDeps({ isHostPermitted: vi.fn(async (_url: string) => false) });
    const result = await sendWebhookExport(makeInput(), deps);
    expect(result.outcome).toBe('blocked');
    expect(result.reason).toBe(WEBHOOK_EXPORT_REASONS.undeclaredOrigin);
    expect(deps.isHostPermitted).toHaveBeenCalledWith('https://hooks.example.com/hook');
    expect(deps.fetchFn).not.toHaveBeenCalled();
    const rows = await deps.history.list();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('blocked');
    expect(rows[0]?.origin).toBe('https://hooks.example.com');
    expect(rows[0]?.charCount).toBeGreaterThan(0);
    // The notice carries the origin only — the full (possibly token-bearing) URL never hits UI.
    expect(deps.notices).toHaveLength(1);
    expect(JSON.stringify(deps.notices[0])).not.toContain('hooks.example.com/hook');
  });
});

describe('declared loopback destinations (PBI 2026-10-31-10 port fix)', () => {
  /** The real declared-pattern gate: the same shape as defaultIsWebhookHostPermitted. */
  const realLocalGate = (url: string): Promise<boolean> =>
    Promise.resolve(buildLocalHostPermissions().some((pattern) => isUrlCoveredByHostPattern(url, pattern)));

  it('sends to a declared loopback https destination (real matcher injected)', async () => {
    const deps = makeDeps({ isHostPermitted: realLocalGate });
    const result = await sendWebhookExport(
      makeInput({ settings: makeSettings({ url: 'https://127.0.0.1:27123/hook' }) }),
      deps,
    );
    expect(result.outcome).toBe('sent');
    expect(deps.fetchFn).toHaveBeenCalledWith('https://127.0.0.1:27123/hook', expect.anything());
  });

  it('still blocks a plain http loopback destination before the network', async () => {
    const deps = makeDeps({ isHostPermitted: realLocalGate });
    const result = await sendWebhookExport(
      makeInput({ settings: makeSettings({ url: 'http://127.0.0.1:8787/hook' }) }),
      deps,
    );
    expect(result.outcome).toBe('blocked');
    expect(result.reason).toBe(WEBHOOK_EXPORT_REASONS.nonHttpsDestination);
    expect(deps.fetchFn).not.toHaveBeenCalled();
  });

  it('still blocks an undeclared public origin fail-closed before the network', async () => {
    const deps = makeDeps({ isHostPermitted: realLocalGate });
    const result = await sendWebhookExport(
      makeInput({ settings: makeSettings({ url: 'https://example.com/hook' }) }),
      deps,
    );
    expect(result.outcome).toBe('blocked');
    expect(result.reason).toBe(WEBHOOK_EXPORT_REASONS.undeclaredOrigin);
    expect(deps.fetchFn).not.toHaveBeenCalled();
  });
});

describe('production gate reads the manifest, not the granted set', () => {
  const realGetManifest = (globalThis as { chrome?: { runtime?: { getManifest?: () => unknown } } }).chrome
    ?.runtime?.getManifest;

  afterEach(() => {
    const runtime = (globalThis as { chrome?: { runtime?: Record<string, unknown> } }).chrome?.runtime;
    if (runtime) {
      if (realGetManifest) runtime.getManifest = realGetManifest;
      else delete runtime.getManifest;
    }
  });

  function stubManifest(hostPermissions: string[]): void {
    const runtime = (globalThis as { chrome?: { runtime?: Record<string, unknown> } }).chrome?.runtime;
    if (!runtime) throw new Error('chrome.runtime mock missing');
    runtime.getManifest = () => ({ manifest_version: 3, name: 'test', version: '0', host_permissions: hostPermissions });
  }

  it('matches exact-host, wildcard-scheme, subdomain and <all_urls> patterns', () => {
    expect(isUrlCoveredByHostPattern('https://api.github.com/x', 'https://api.github.com/*')).toBe(true);
    expect(isUrlCoveredByHostPattern('https://api.github.com/x', 'https://api.github.com/webhook')).toBe(false);
    expect(isUrlCoveredByHostPattern('https://example.com/p', '*://example.com/*')).toBe(true);
    expect(isUrlCoveredByHostPattern('http://example.com/p', '*://example.com/*')).toBe(true);
    expect(isUrlCoveredByHostPattern('ftp://example.com/p', '*://example.com/*')).toBe(false);
    expect(isUrlCoveredByHostPattern('https://sub.example.com/p', 'https://*.example.com/*')).toBe(true);
    // Chrome match-pattern semantics: `*.host` also matches the bare host.
    expect(isUrlCoveredByHostPattern('https://example.com/p', 'https://*.example.com/*')).toBe(true);
    expect(isUrlCoveredByHostPattern('https://notexample.com/p', 'https://*.example.com/*')).toBe(false);
    expect(isUrlCoveredByHostPattern('https://anything.test/p', '<all_urls>')).toBe(true);
    // A malformed pattern and an unparseable URL are both non-matches.
    expect(isUrlCoveredByHostPattern('https://example.com/p', 'not-a-pattern')).toBe(false);
    expect(isUrlCoveredByHostPattern('::::', 'https://example.com/*')).toBe(false);
  });

  it('permits only destinations covered by the declared host_permissions', async () => {
    stubManifest(['https://api.github.com/*', 'https://localhost:27123/*']);
    await expect(defaultIsWebhookHostPermitted('https://api.github.com/x')).resolves.toBe(true);
    // An undeclared origin is blocked even though the browser's granted set
    // covers every origin (the content script's <all_urls> match is granted
    // at install time — proven by the E2E permission probe).
    await expect(defaultIsWebhookHostPermitted('https://hooks.example.com/hook')).resolves.toBe(false);
  });

  it('matches a declared loopback pattern by host+port (PBI 2026-10-31-10)', () => {
    // The declared loopback entries carry an explicit port, and the URL side
    // must match that host+port — a portless parsed.hostname never matched a
    // ported declaration, so every declared loopback pattern was dead.
    expect(isUrlCoveredByHostPattern('https://127.0.0.1:27123/hook', 'https://127.0.0.1:27123/*')).toBe(true);
    expect(isUrlCoveredByHostPattern('https://localhost:11434/hook', 'https://localhost:11434/*')).toBe(true);
  });

  it('rejects a URL whose port differs from the declared pattern', () => {
    expect(isUrlCoveredByHostPattern('https://127.0.0.1:9999/hook', 'https://127.0.0.1:27123/*')).toBe(false);
  });

  it('keeps the portless-pattern comparison unchanged (any port matches)', () => {
    // Portless patterns (api.github.com/* etc.) stay on the pre-fix hostname
    // comparison — the port fix must not widen them.
    expect(isUrlCoveredByHostPattern('https://api.github.com:8443/x', 'https://api.github.com/*')).toBe(true);
  });

  it('permits a declared loopback destination through the manifest gate', async () => {
    stubManifest(buildLocalHostPermissions());
    await expect(defaultIsWebhookHostPermitted('https://127.0.0.1:27123/hook')).resolves.toBe(true);
    // An undeclared public origin stays fail-closed with the same declared set.
    await expect(defaultIsWebhookHostPermitted('https://example.com/hook')).resolves.toBe(false);
  });

  it('restricts <all_urls> to the match-pattern schemes after parsing the URL', () => {
    // The URL is parsed before the shortcut: a chrome-internal, data, or
    // unknown scheme never passes an all-urls declaration.
    expect(isUrlCoveredByHostPattern('chrome://extensions', '<all_urls>')).toBe(false);
    expect(isUrlCoveredByHostPattern('about:blank', '<all_urls>')).toBe(false);
    expect(isUrlCoveredByHostPattern('data:text/plain,hi', '<all_urls>')).toBe(false);
    // The Chrome match-pattern schemes pass.
    expect(isUrlCoveredByHostPattern('file:///etc/passwd', '<all_urls>')).toBe(true);
    expect(isUrlCoveredByHostPattern('ws://example.com/x', '<all_urls>')).toBe(true);
    expect(isUrlCoveredByHostPattern('wss://example.com/x', '<all_urls>')).toBe(true);
    expect(isUrlCoveredByHostPattern('ftp://example.com/x', '<all_urls>')).toBe(true);
  });

  it('fails closed when the manifest is unreadable', async () => {
    const runtime = (globalThis as { chrome?: { runtime?: Record<string, unknown> } }).chrome?.runtime;
    if (!runtime) throw new Error('chrome.runtime mock missing');
    runtime.getManifest = () => {
      throw new Error('manifest unavailable');
    };
    await expect(defaultIsWebhookHostPermitted('https://api.github.com/x')).resolves.toBe(false);
  });
});

describe('masking before send', () => {
  it('re-masks the summary at send time and never ships raw content', async () => {
    const deps = makeDeps({
      maskText: vi.fn(async (text: string) => text.replace('alice@example.com', '[email]')),
    });
    const result = await sendWebhookExport(
      makeInput({ record: makeRecord({ summary: 'contact alice@example.com today' }) }),
      deps,
    );
    expect(result.outcome).toBe('sent');
    expect(deps.maskText).toHaveBeenCalledWith('contact alice@example.com today');
    expect(deps.fetchCalls).toHaveLength(1);
    const body = deps.fetchCalls[0]?.init.body ?? '';
    expect(body).toContain('[email]');
    expect(body).not.toContain('alice@example.com');
    expect(Object.keys(JSON.parse(body) as Record<string, string>)).not.toContain('content');
  });

  it('masks the page title through the same seam (mail address and name never ship)', async () => {
    const deps = makeDeps({
      maskText: vi.fn(async (text: string) =>
        text.replace('alice@example.com', '[email]').replace('Alice', '[name]'),
      ),
    });
    const result = await sendWebhookExport(
      makeInput({ record: makeRecord({ title: 'Alice <alice@example.com> meeting notes' }) }),
      deps,
    );
    expect(result.outcome).toBe('sent');
    // The title itself is masked before the payload is built.
    expect(deps.maskText).toHaveBeenCalledWith('Alice <alice@example.com> meeting notes');
    expect(deps.fetchCalls).toHaveLength(1);
    const body = JSON.parse(deps.fetchCalls[0]?.init.body ?? '{}') as { title: string; text: string };
    expect(body.title).not.toContain('alice@example.com');
    expect(body.title).not.toContain('Alice');
    expect(body.title).toContain('[email]');
    // The first text line is the masked title too — no unmasked copy remains.
    expect(body.text.split('\n')[0]).not.toContain('alice@example.com');
    expect(body.text.split('\n')[0]).not.toContain('Alice');
    expect(body.text.split('\n')[0]).toContain('[email]');
  });

  it('fails closed when the title mask throws — nothing ships raw', async () => {
    const deps = makeDeps({
      maskText: vi.fn(async (text: string): Promise<string> => {
        if (text === 'Example') throw new Error('sanitizer down');
        return text;
      }),
    });
    const result = await sendWebhookExport(makeInput(), deps);
    expect(result.outcome).toBe('failed');
    expect(result.reason).toBe(WEBHOOK_EXPORT_REASONS.maskError);
    expect(deps.fetchFn).not.toHaveBeenCalled();
    const rows = await deps.history.list();
    expect(rows[0]?.status).toBe('failed');
    expect(rows[0]?.reason).toBe(WEBHOOK_EXPORT_REASONS.maskError);
  });
});

describe('delivery outcomes', () => {
  it('POSTs JSON with the idempotency key and records sent + notifies', async () => {
    const deps = makeDeps();
    const result = await sendWebhookExport(makeInput(), deps);
    expect(result.outcome).toBe('sent');
    expect(result.key).toMatch(/^yasumaro-r1-[0-9a-f]{8}$/);
    expect(deps.fetchCalls).toHaveLength(1);
    expect(deps.fetchCalls[0]?.url).toBe('https://hooks.example.com/hook');
    expect(deps.fetchCalls[0]?.init.method).toBe('POST');
    expect(deps.fetchCalls[0]?.init.headers['Content-Type']).toBe('application/json');
    expect(deps.fetchCalls[0]?.init.headers['Idempotency-Key']).toBe(result.key);
    const rows = await deps.history.list();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('sent');
    expect(rows[0]?.key).toBe(result.key);
    expect(deps.notices).toEqual([{ kind: 'sent', origin: 'https://hooks.example.com', reason: 'delivered' }]);
  });

  it('records failed on HTTP errors without throwing', async () => {
    const deps = makeDeps({
      fetchFn: vi.fn(async (_url: string) => ({ ok: false, status: 500 })),
    });
    const result = await sendWebhookExport(makeInput(), deps);
    expect(result).toEqual({ outcome: 'failed', reason: 'http-500', key: result.key });
    const rows = await deps.history.list();
    expect(rows[0]?.status).toBe('failed');
    expect(deps.notices[0]?.kind).toBe('failed');
  });

  it('records failed on transport errors without throwing', async () => {
    const deps = makeDeps({
      fetchFn: vi.fn(async (_url: string): Promise<{ ok: boolean; status: number }> => {
        throw new Error('down');
      }),
    });
    const result = await sendWebhookExport(makeInput(), deps);
    expect(result.outcome).toBe('failed');
    expect(result.reason).toBe(WEBHOOK_EXPORT_REASONS.transportError);
  });
});

describe('review hardening (never throws, fail-closed masking)', () => {
  it('fails closed when masking throws — nothing ships raw', async () => {
    const deps = makeDeps({
      maskText: vi.fn(async (_text: string): Promise<string> => {
        throw new Error('sanitizer down');
      }),
    });
    const result = await sendWebhookExport(
      makeInput({ record: makeRecord({ summary: 'contact alice@example.com' }) }),
      deps,
    );
    expect(result.outcome).toBe('failed');
    expect(result.reason).toBe(WEBHOOK_EXPORT_REASONS.maskError);
    expect(deps.fetchFn).not.toHaveBeenCalled();
    const rows = await deps.history.list();
    expect(rows[0]?.status).toBe('failed');
    expect(rows[0]?.reason).toBe(WEBHOOK_EXPORT_REASONS.maskError);
  });

  it('still returns the verdict when history and notify both throw', async () => {
    const deps = makeDeps({
      notify: vi.fn((_event: WebhookExportNotice) => {
        throw new Error('notification down');
      }),
    });
    deps.history.append = vi.fn(async (): Promise<WebhookExportHistoryEntry[]> => {
      throw new Error('quota exceeded');
    });
    const result = await sendWebhookExport(makeInput(), deps);
    expect(result.outcome).toBe('sent');
    expect(result.key).not.toBeNull();
  });
});

describe('idempotent resend', () => {
  it('suppresses an automatic duplicate without touching the network', async () => {
    const deps = makeDeps();
    const first = await sendWebhookExport(makeInput(), deps);
    expect(first.outcome).toBe('sent');
    const second = await sendWebhookExport(makeInput(), deps);
    expect(second).toEqual({
      outcome: 'skipped',
      reason: WEBHOOK_EXPORT_REASONS.duplicateSuppressed,
      key: first.key,
    });
    expect(deps.fetchCalls).toHaveLength(1);
  });

  it('derives the same key across runs for the same record + payload (no per-run identity)', async () => {
    const store: Record<string, string> = {};
    const runDeps = (clock: number): ReturnType<typeof makeDeps> =>
      makeDeps({
        now: () => clock,
        history: new WebhookExportHistory({
          get: async (key: string): Promise<string | null> =>
            typeof store[key] === 'string' ? (store[key] as string) : null,
          set: async (key: string, value: string): Promise<void> => {
            store[key] = value;
          },
        }),
      });
    const first = await sendWebhookExport(makeInput(), runDeps(1000));
    expect(first.outcome).toBe('sent');
    // A second recording run (later clock, fresh deps) with identical content
    // derives the same key — the duplicate suppression stays alive across runs.
    const second = await sendWebhookExport(makeInput(), runDeps(2000));
    expect(second).toEqual({
      outcome: 'skipped',
      reason: WEBHOOK_EXPORT_REASONS.duplicateSuppressed,
      key: first.key,
    });
  });

  it('derives a new key when the content changes for the same page', async () => {
    const deps = makeDeps();
    const first = await sendWebhookExport(makeInput({ record: makeRecord({ summary: 'first pass' }) }), deps);
    const second = await sendWebhookExport(makeInput({ record: makeRecord({ summary: 'second pass' }) }), deps);
    expect(second.outcome).toBe('sent');
    expect(second.key).not.toBe(first.key);
    expect(deps.fetchCalls).toHaveLength(2);
  });

  it('an explicit resend re-POSTs with the SAME key and bumps the counter', async () => {
    const deps = makeDeps();
    const first = await sendWebhookExport(makeInput(), deps);
    const resent = await sendWebhookExport(makeInput(), deps, { force: true });
    expect(resent.outcome).toBe('resent');
    expect(resent.key).toBe(first.key);
    expect(deps.fetchCalls).toHaveLength(2);
    expect(deps.fetchCalls[1]?.init.headers['Idempotency-Key']).toBe(first.key);
    // The destination always comes from saved settings — the resend call takes no URL.
    expect(deps.fetchCalls[1]?.url).toBe('https://hooks.example.com/hook');
    const rows = await deps.history.list();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('resent');
    expect(rows[0]?.resentCount).toBe(1);
  });
});
