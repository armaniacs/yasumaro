/**
 * webhookExportStep.test.ts
 * PBI 2026-10-22-05 SW fire wiring: the save-tail sink calls the real sender
 * with the production seams (sanitizeRegex re-mask, declared host_permissions
 * gate, chrome.notifications write point), passes the raw privacy verdict
 * through (an absent verdict fails closed in the sender), and never throws
 * past the recording. The record identity is the page URL — no per-run
 * traceId in the idempotency key.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../../utils/logger/core.js', async () =>
  (await import('../../../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    addLog: 'fn',
    logError: 'fn',
    logInfo: 'fn',
  }),
);
vi.mock('../../../../utils/logger/types.js', async () =>
  (await import('../../../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    LogType: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR', DEBUG: 'DEBUG' },
    ErrorCode: { INTERNAL_ERROR: 'INT_001', UNKNOWN_ERROR: 'UNKN_001' },
  }),
);
vi.mock('../../../../utils/logger/api.js', async () =>
  (await import('../../../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    addLog: 'fn',
    logError: 'fn',
    logInfo: 'fn',
  }),
);

import { addLog } from '../../../../utils/logger/core.js';
import { LogType } from '../../../../utils/logger/types.js';
import { StorageKeys } from '../../../../utils/storage/types.js';
import type { RecordingContext, StepDeps } from '../../types.js';
import type { PrivacyInfo } from '../../../../utils/privacyChecker.js';
import { executeWebhookExport } from '../webhookExportStep.js';
import { WEBHOOK_EXPORT_SETTINGS_KEY } from '../../../webhookExport/webhookExportSettings.js';
import { WEBHOOK_EXPORT_HISTORY_KEY } from '../../../webhookExport/webhookExportHistory.js';

const mockedAddLog = addLog as unknown as ReturnType<typeof vi.fn>;

function makeContext(overrides: Partial<RecordingContext> = {}): RecordingContext {
  return {
    data: {
      title: 'Example',
      url: 'https://example.com/p1',
      content: 'page body',
      scrollRatioPercent: 80,
      visitDurationSeconds: 45,
    },
    settings: { [StorageKeys.LEGACY_DUAL_WRITE_ENABLED]: false },
    force: false,
    traceId: 'trace-1',
    errors: [],
    privacyResult: { summary: 'cleansed summary', tags: ['obsidian', 'web'] },
    ...overrides,
  } as RecordingContext;
}

function makeDeps(privacyReader?: StepDeps['privacyReader']): StepDeps {
  return {
    obsidian: { appendToDailyNote: vi.fn() } as unknown as StepDeps['obsidian'],
    aiService: {} as StepDeps['aiService'],
    privacyReader,
  };
}

async function setWebhookSettings(raw: Record<string, unknown> | null): Promise<void> {
  if (raw === null) {
    await chrome.storage.local.remove(WEBHOOK_EXPORT_SETTINGS_KEY);
    return;
  }
  await chrome.storage.local.set({ [WEBHOOK_EXPORT_SETTINGS_KEY]: JSON.stringify(raw) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedAddLog.mockClear();
});

describe('webhookExportStep — disabled by default (no network)', () => {
  it('returns the context untouched and sends nothing when the opt-in is off', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const context = makeContext();

    const result = await executeWebhookExport(context, makeDeps());

    expect(result).toBe(context);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(chrome.notifications.create).not.toHaveBeenCalled();
    const stored = await chrome.storage.local.get(WEBHOOK_EXPORT_HISTORY_KEY);
    expect(stored[WEBHOOK_EXPORT_HISTORY_KEY]).toBeUndefined();
    fetchSpy.mockRestore();
  });

  it('never throws when the settings read fails', async () => {
    vi.spyOn(chrome.storage.local, 'get').mockRejectedValueOnce(new Error('storage down'));
    const context = makeContext();

    const result = await executeWebhookExport(context, makeDeps());

    expect(result).toBe(context);
    expect(mockedAddLog).toHaveBeenCalledWith(
      LogType.WARN,
      'webhookExportStep: export not sent',
      expect.objectContaining({ url: 'https://example.com/p1' }),
    );
  });
});

describe('webhookExportStep — production seams on an enabled destination', () => {
  const realGetManifest = (globalThis as { chrome?: { runtime?: { getManifest?: () => unknown } } }).chrome
    ?.runtime?.getManifest;

  // The production gate reads the manifest's declared host_permissions
  // (declared semantics — the granted set covers every origin because the
  // content script's <all_urls> match is granted at install time), so the
  // enabled-path tests stub the manifest to declare the destination origin.
  function stubWebhookManifest(): void {
    const runtime = (globalThis as { chrome?: { runtime?: Record<string, unknown> } }).chrome?.runtime;
    if (!runtime) throw new Error('chrome.runtime mock missing');
    runtime.getManifest = () => ({
      manifest_version: 3,
      name: 'test',
      version: '0',
      host_permissions: ['https://hooks.example.com/*'],
    });
  }

  afterEach(() => {
    const runtime = (globalThis as { chrome?: { runtime?: Record<string, unknown> } }).chrome?.runtime;
    if (runtime) {
      if (realGetManifest) runtime.getManifest = realGetManifest;
      else delete runtime.getManifest;
    }
  });

  it('POSTs the minimal payload with the real sanitizer re-mask and notifies', async () => {
    stubWebhookManifest();
    await setWebhookSettings({ enabled: true, url: 'https://hooks.example.com/hook', condition: {} });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }));

    const context = makeContext({
      privacyResult: { summary: 'contact alice@example.com today', tags: ['obsidian'] },
    });
    // A non-private verdict from the real cache-reader seam: the send proceeds.
    const nonPrivate: PrivacyInfo = { isPrivate: false, timestamp: Date.now() };
    const result = await executeWebhookExport(context, makeDeps(async () => nonPrivate));

    expect(result).toBe(context);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe('https://hooks.example.com/hook');
    expect(init?.method).toBe('POST');
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, string>;
    expect(body.content).toBeUndefined();
    expect(body.summary).not.toContain('alice@example.com');
    // The idempotency key derives from the page URL (the stable record
    // identity), never from the per-run traceId.
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers['Idempotency-Key']).toMatch(/^yasumaro-https:\/\/example\.com\/p1-[0-9a-f]{8}$/);
    // The real privacy verdict rides the injected reader.
    expect(chrome.notifications.create).toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('never sends when the privacy verdict is absent and records the reason', async () => {
    stubWebhookManifest();
    await setWebhookSettings({ enabled: true, url: 'https://hooks.example.com/hook', condition: {} });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    // No privacyReader: the verdict is unknown — egress fails closed.
    const context = makeContext();
    const result = await executeWebhookExport(context, makeDeps());

    expect(result).toBe(context);
    expect(fetchSpy).not.toHaveBeenCalled();
    const stored = await chrome.storage.local.get(WEBHOOK_EXPORT_HISTORY_KEY);
    const rows = JSON.parse(String(stored[WEBHOOK_EXPORT_HISTORY_KEY] ?? '[]')) as Array<{
      status: string;
      reason: string;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('blocked');
    expect(rows[0]?.reason).toBe('privacy-verdict-absent');
    fetchSpy.mockRestore();
  });

  it('suppresses a same-content re-record across runs (stable page-URL identity)', async () => {
    stubWebhookManifest();
    await setWebhookSettings({ enabled: true, url: 'https://hooks.example.com/hook', condition: {} });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }));

    const nonPrivate: PrivacyInfo = { isPrivate: false, timestamp: Date.now() };
    const first = await executeWebhookExport(makeContext(), makeDeps(async () => nonPrivate));
    // A force re-record of the same page with identical content keeps the
    // same key (the page URL, not the per-run traceId) — suppressed.
    const second = await executeWebhookExport(
      makeContext({ force: true, traceId: 'trace-2' }),
      makeDeps(async () => nonPrivate),
    );

    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    fetchSpy.mockRestore();
  });

  it('POSTs again when the content changes for the same page', async () => {
    stubWebhookManifest();
    await setWebhookSettings({ enabled: true, url: 'https://hooks.example.com/hook', condition: {} });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }));

    const nonPrivate: PrivacyInfo = { isPrivate: false, timestamp: Date.now() };
    await executeWebhookExport(
      makeContext({ privacyResult: { summary: 'first pass', tags: ['obsidian'] } }),
      makeDeps(async () => nonPrivate),
    );
    await executeWebhookExport(
      makeContext({ privacyResult: { summary: 'second pass', tags: ['obsidian'] } }),
      makeDeps(async () => nonPrivate),
    );

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    fetchSpy.mockRestore();
  });

  it('skips the send when the real privacy verdict marks the page private', async () => {
    setWebhookSettings({ enabled: true, url: 'https://hooks.example.com/hook', condition: {} });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const privateInfo: PrivacyInfo = {
      isPrivate: true,
      reason: 'cache-control',
      timestamp: Date.now(),
    };

    await executeWebhookExport(makeContext(), makeDeps(async () => privateInfo));

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(chrome.notifications.create).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('excludes records that miss the engagement threshold', async () => {
    setWebhookSettings({
      enabled: true,
      url: 'https://hooks.example.com/hook',
      condition: { minScrollDepth: 50, minVisitDuration: 60 },
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await executeWebhookExport(makeContext(), makeDeps());

    // scrollRatioPercent 80 passes the scroll gate; visitDurationSeconds 45
    // misses the 60s gate, so the sender skips without a POST.
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
