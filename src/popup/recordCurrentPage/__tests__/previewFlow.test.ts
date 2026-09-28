// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { sendMock, showPreviewMock, settingsMock } = vi.hoisted(() => ({
  sendMock: vi.fn(),
  showPreviewMock: vi.fn(),
  settingsMock: { value: {} as Record<string, unknown> },
}));

vi.mock('../../../messaging/messageTransport.js', () => ({
  messageTransport: {
    // opts is forwarded so the retry contract can be pinned next to the envelope
    send: (message: unknown, opts?: unknown) => sendMock(message, opts),
  },
}));

vi.mock('../../sanitizePreview.js', () => ({
  showPreview: (...args: unknown[]) => showPreviewMock(...args),
  initializeModalEvents: vi.fn(),
}));

vi.mock('../../../utils/storage/SettingsRepository.js', () => {
  // previewFlow consumes the shared singleton (PBI 2026-09-17-06), so the
  // mock must expose it alongside the class-shaped legacy mock.
  const settingsRepository = {
    async getAll(): Promise<Record<string, unknown>> {
      return settingsMock.value;
    },
  };
  return {
    SettingsRepository: class {
      async getAll(): Promise<Record<string, unknown>> {
        return settingsMock.value;
      }
    },
    settingsRepository,
  };
});

vi.mock('../../../utils/logger/types.js', () => ({
  logError: vi.fn(),
  ErrorCode: { CONTENT_EXTRACTION_FAILURE: 'CONTENT_EXTRACTION_FAILURE' },
}));
vi.mock('../../../utils/logger/core.js', () => ({
  logError: vi.fn(),
  ErrorCode: { CONTENT_EXTRACTION_FAILURE: 'CONTENT_EXTRACTION_FAILURE' },
}));
vi.mock('../../../utils/logger/api.js', () => ({
  logError: vi.fn(),
  ErrorCode: { CONTENT_EXTRACTION_FAILURE: 'CONTENT_EXTRACTION_FAILURE' },
}));

vi.mock('../../../utils/i18n.js', () => {
  const getMessage = (key: string) => key;
  const getMessageOr = (key: string, fallback: string, subs?: unknown): string =>
  ((subs === undefined ? (getMessage as (...a: any[]) => unknown)(key) : (getMessage as (...a: any[]) => unknown)(key, subs)) || fallback) as string;
  const getMessageWithSubstitutions = (
  key: string,
  subs: Record<string, string | number>,
  fallback: string,
      ): string =>
      ((getMessage as (...a: any[]) => unknown)(key, subs) ||
  fallback.replace(/\{(\w+)\}/g, (_m: string, n: string) =>
    subs[n] !== undefined ? String(subs[n]) : `{${n}}`)) as string;
  return {
  getMessage: getMessage, getMessageOr, getMessageWithSubstitutions
}; });

import { PreviewFlow, buildRecordPayload } from '../previewFlow.js';
import type { PreviewSaveOptions, RecordPayloadStats } from '../previewFlow.js';
import { SpinnerScope } from '../../spinner.js';
import type { PayloadForType } from '../../../messaging/types.js';

function makeTab(): chrome.tabs.Tab {
  return { id: 1, title: 'T', url: 'https://example.com' } as chrome.tabs.Tab;
}

function mountSpinner(): HTMLElement {
  document.body.innerHTML = '<div id="loadingSpinner" style="display:none"><span class="spinner-text"></span></div>';
  return document.getElementById('loadingSpinner') as HTMLElement;
}

describe('buildRecordPayload (PBI 2026-09-12-14)', () => {
  it('carries the full stat set for all three envelopes', () => {
    const tab = makeTab();
    const stats = {
      byteStats: { pageBytes: 1, candidateBytes: 2, originalBytes: 3, cleansedBytes: 4 },
      aiSummaryCleansedStats: {
        aiSummaryOriginalBytes: 5,
        aiSummaryCleansedBytes: 6,
        aiSummaryCleansedElements: 7,
        aiSummaryCleansedReason: 'hard',
        aiSummaryCleansedReasons: ['hard'],
      },
    } as never;

    for (const content of ['original', 'confirmed']) {
      const payload = buildRecordPayload('SAVE_RECORD', tab, content, true, stats);
      expect(payload).toMatchObject({
        title: 'T',
        url: 'https://example.com',
        content,
        force: true,
        pageBytes: 1,
        candidateBytes: 2,
        originalBytes: 3,
        cleansedBytes: 4,
        aiSummaryOriginalBytes: 5,
        aiSummaryCleansedBytes: 6,
        aiSummaryCleansedElements: 7,
        aiSummaryCleansedReason: 'hard',
        aiSummaryCleansedReasons: ['hard'],
      });
    }
  });

  it('attaches maskedCount only when provided (SAVE envelope)', () => {
    const tab = makeTab();
    expect(buildRecordPayload('SAVE_RECORD', tab, 'c', true, {})).not.toHaveProperty('maskedCount');
    expect(buildRecordPayload('SAVE_RECORD', tab, 'c', true, { maskedCount: 3 })).toMatchObject({ maskedCount: 3 });
  });
});

describe('SpinnerScope (PBI 2026-09-12-14)', () => {
  beforeEach(() => {
    mountSpinner();
  });

  it('balances show/show/hide to hidden', () => {
    const spinner = document.getElementById('loadingSpinner') as HTMLElement;
    const scope = new SpinnerScope();
    scope.show('a');
    expect(spinner.style.display).toBe('flex');
    scope.show('b');
    scope.hide();
    expect(spinner.style.display).toBe('none');
  });

  it('hide without show is a no-op', () => {
    const spinner = document.getElementById('loadingSpinner') as HTMLElement;
    const scope = new SpinnerScope();
    expect(() => scope.hide()).not.toThrow();
    expect(spinner.style.display).toBe('none');
  });
});

describe('PreviewFlow.run error normalization (PBI 2026-09-12-14)', () => {
  beforeEach(() => {
    mountSpinner();
    sendMock.mockReset();
    showPreviewMock.mockReset();
    settingsMock.value = { pii_confirmation_ui: true };
  });

  it('returns instead of throwing on no-response, with spinner hidden', async () => {
    sendMock.mockResolvedValue(undefined);
    const flow = new PreviewFlow();
    const result = await flow.run({ tab: makeTab(), content: 'c', force: true });
    expect(result).toEqual({ success: false, error: 'No response from background worker' });
    expect((document.getElementById('loadingSpinner') as HTMLElement).style.display).toBe('none');
  });

  it('returns instead of throwing on background failure, with spinner hidden', async () => {
    sendMock.mockResolvedValue({ success: false, error: 'Processing failed' });
    const flow = new PreviewFlow();
    const result = await flow.run({ tab: makeTab(), content: 'c', force: true });
    expect(result).toEqual({ success: false, error: 'Processing failed' });
    expect((document.getElementById('loadingSpinner') as HTMLElement).style.display).toBe('none');
  });

  it('sends the confirmed content (not the original) on SAVE', async () => {
    sendMock.mockImplementation(async (message: { type: string }) => {
      if (message.type === 'PREVIEW_RECORD') {
        return { success: true, maskedCount: 2, processedContent: 'orig', maskedItems: [] };
      }
      return { success: true };
    });
    showPreviewMock.mockResolvedValue({ confirmed: true, content: 'confirmed-edited' });
    const flow = new PreviewFlow();
    const result = await flow.run({ tab: makeTab(), content: 'orig', force: true });
    expect(result.success).toBe(true);
    const saveCall = sendMock.mock.calls.find(([m]) => (m as { type: string }).type === 'SAVE_RECORD');
    expect(saveCall).toBeDefined();
    expect((saveCall![0] as { payload: Record<string, unknown> }).payload).toMatchObject({ content: 'confirmed-edited' });
  });
});

/**
 * Parity pin for the contract-typed payloads (PBI 2026-09-28-16). The
 * envelopes are now built from the wire contract instead of a hand-written
 * `Record<string, unknown>`, so the observed wire shape is pinned here: same
 * type, same payload key set, same `retries: 5` on every send.
 */
describe('record envelope parity (PBI 2026-09-28-16)', () => {
  const STAT_KEYS = [
    'aiSummaryCleansedBytes',
    'aiSummaryCleansedElements',
    'aiSummaryCleansedReason',
    'aiSummaryCleansedReasons',
    'aiSummaryOriginalBytes',
    'candidateBytes',
    'cleansedBytes',
    'content',
    'force',
    'originalBytes',
    'pageBytes',
    'title',
    'url',
  ];

  interface Envelope {
    type: string;
    payload: Record<string, unknown>;
  }

  function sentEnvelopes(): Envelope[] {
    return sendMock.mock.calls.map(([message]) => message as Envelope);
  }

  function retryOptions(): unknown[] {
    return sendMock.mock.calls.map(([, opts]) => opts);
  }

  function runWith(piiConfirmationUi: boolean): Promise<unknown> {
    settingsMock.value = { pii_confirmation_ui: piiConfirmationUi };
    sendMock.mockImplementation(async (message: Envelope) => {
      if (message.type === 'PREVIEW_RECORD') {
        return { success: true, maskedCount: 2, processedContent: 'orig', maskedItems: [] };
      }
      return { success: true };
    });
    showPreviewMock.mockResolvedValue({ confirmed: true, content: 'confirmed-edited' });
    const options: PreviewSaveOptions = {
      tab: makeTab(),
      content: 'orig',
      force: true,
      byteStats: { pageBytes: 1, candidateBytes: 2, originalBytes: 3, cleansedBytes: 4 },
      aiSummaryCleansedStats: {
        aiSummaryOriginalBytes: 5,
        aiSummaryCleansedBytes: 6,
        aiSummaryCleansedElements: 7,
        aiSummaryCleansedReason: 'fixed',
      },
    };
    return new PreviewFlow().run(options);
  }

  beforeEach(() => {
    mountSpinner();
    sendMock.mockReset();
    showPreviewMock.mockReset();
    settingsMock.value = { pii_confirmation_ui: true };
  });

  it('pins the PREVIEW → SAVE envelopes, payload keys and retry option', async () => {
    await runWith(true);

    const envelopes = sentEnvelopes();
    expect(envelopes.map((e) => e.type)).toEqual(['PREVIEW_RECORD', 'SAVE_RECORD']);
    expect(Object.keys(envelopes[0]!.payload).sort()).toEqual(STAT_KEYS);
    expect(Object.keys(envelopes[1]!.payload).sort()).toEqual([...STAT_KEYS, 'maskedCount'].sort());
    expect(envelopes[0]!.payload).toMatchObject({
      title: 'T',
      url: 'https://example.com',
      content: 'orig',
      force: true,
      pageBytes: 1,
      aiSummaryOriginalBytes: 5,
    });
    expect(envelopes[1]!.payload).toMatchObject({ content: 'confirmed-edited', maskedCount: 2 });
    expect(retryOptions()).toEqual([{ retries: 5 }, { retries: 5 }]);
  });

  it('pins the MANUAL_RECORD envelope, which carries no maskedCount', async () => {
    await runWith(false);

    const envelopes = sentEnvelopes();
    expect(envelopes.map((e) => e.type)).toEqual(['MANUAL_RECORD']);
    expect(Object.keys(envelopes[0]!.payload).sort()).toEqual(STAT_KEYS);
    expect(retryOptions()).toEqual([{ retries: 5 }]);
  });

  it('keeps maskedCount exclusive to the SAVE_RECORD contract', () => {
    // Compile-time: the wire contract owns the op split, not this module.
    const saveOwnsMaskedCount: 'maskedCount' extends keyof PayloadForType<'SAVE_RECORD'> ? true : false = true;
    const manualLacksMaskedCount: 'maskedCount' extends keyof PayloadForType<'MANUAL_RECORD'> ? false : true = true;
    const previewLacksMaskedCount: 'maskedCount' extends keyof PayloadForType<'PREVIEW_RECORD'> ? false : true = true;
    expect([saveOwnsMaskedCount, manualLacksMaskedCount, previewLacksMaskedCount]).toEqual([true, true, true]);

    // The narrowed stat bundle rejects the field as a literal and as a value,
    // and the envelope gate still drops it once the call is past the checker.
    // @ts-expect-error maskedCount is not part of the MANUAL_RECORD payload
    const rejectedLiteral = buildRecordPayload('MANUAL_RECORD', makeTab(), 'c', true, { maskedCount: 1 });
    const smuggled = { maskedCount: 1 };
    // @ts-expect-error maskedCount is not part of the PREVIEW_RECORD payload
    const rejectedValue = buildRecordPayload('PREVIEW_RECORD', makeTab(), 'c', true, smuggled);
    expect(rejectedLiteral).not.toHaveProperty('maskedCount');
    expect(rejectedValue).not.toHaveProperty('maskedCount');

    // A stats bundle that does satisfy the narrowed type (it shares the byte
    // fields) reaches the builder, so the field is gated on the envelope it is
    // sent with rather than on the input shape alone.
    const wideStats = { maskedCount: 1, byteStats: undefined } as RecordPayloadStats;
    expect(buildRecordPayload('SAVE_RECORD', makeTab(), 'c', true, wideStats)).toHaveProperty('maskedCount', 1);
  });
});
