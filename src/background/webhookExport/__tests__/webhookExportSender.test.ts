/**
 * webhookExportSender.test.ts
 * PBI 2026-10-22-05 box (c) ― send path: gates before network, masking
 * before send, private exclusion, idempotent resend, fail-closed blocks.
 *
 * No real timers, no network: every seam (fetch/permission/mask/notify/
 * clock/history) is injected and settles immediately.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  sendWebhookExport,
  WEBHOOK_EXPORT_REASONS,
  type WebhookExportNotice,
  type WebhookExportSenderDeps,
  type WebhookExportSendInput,
} from '../webhookExportSender.js';
import { WebhookExportHistory, type WebhookExportHistoryEntry } from '../webhookExportHistory.js';
import type { WebhookExportRecord } from '../webhookExportPayload.js';
import type { WebhookExportSettings } from '../webhookExportSettings.js';

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
