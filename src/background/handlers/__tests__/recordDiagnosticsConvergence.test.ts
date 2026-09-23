/**
 * recordDiagnosticsConvergence.test.ts — PBI 2026-09-23-12.
 *
 * Pins scenario 2 at the handler level: the same diagnostics sent through
 * all four record surfaces (VALID_VISIT / MANUAL / SAVE / REGENERATE) must
 * arrive identically, with SAVE alone excluding maskedCount (VULN-007).
 * A future diagnostic field added to the builder table flows through every
 * route with no handler edit; a route that stops spreading the adapter
 * fails here.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createValidVisitHandler,
  createManualRecordHandler,
  createSaveRecordHandler,
  createRegenerateSummaryHandler,
  resetVisitRateLimiter,
} from '../recordingHandlers.js';
import type {
  ValidVisitHandlerDeps,
  ManualRecordHandlerDeps,
  SaveRecordHandlerDeps,
  RegenerateSummaryHandlerDeps,
} from '../recordingHandlers.js';
import type {
  ValidVisitMessage,
  ManualRecordMessage,
  SaveRecordMessage,
  RegenerateSummaryMessage,
} from '../../messageTypes.js';
import type { ContentResponse, RecordingData } from '../../../messaging/types.js';
import type { AiSummaryCleansedReason } from '../../../utils/commonTypes.js';

const DIAG: {
  pageBytes: number;
  candidateBytes: number;
  originalBytes: number;
  cleansedBytes: number;
  aiSummaryOriginalBytes: number;
  aiSummaryCleansedBytes: number;
  aiSummaryCleansedElements: number;
  aiSummaryCleansedReason: AiSummaryCleansedReason;
  aiSummaryCleansedReasons: string[];
  cleansedReason: string;
  fallbackTriggered: boolean;
  fallbackReason: string;
} = {
  pageBytes: 1000,
  candidateBytes: 800,
  originalBytes: 700,
  cleansedBytes: 500,
  aiSummaryOriginalBytes: 400,
  aiSummaryCleansedBytes: 300,
  aiSummaryCleansedElements: 2,
  aiSummaryCleansedReason: 'keyword',
  aiSummaryCleansedReasons: ['keyword'],
  cleansedReason: 'keyword',
  fallbackTriggered: true,
  fallbackReason: 'content_overcut',
};

const DIAG_KEYS = [
  'pageBytes',
  'candidateBytes',
  'originalBytes',
  'cleansedBytes',
  'aiSummaryOriginalBytes',
  'aiSummaryCleansedBytes',
  'aiSummaryCleansedElements',
  'aiSummaryCleansedReason',
  'aiSummaryCleansedReasons',
  'cleansedReason',
  'fallbackTriggered',
  'fallbackReason',
] as const;

function diagOf(data: RecordingData): Record<string, unknown> {
  return Object.fromEntries(DIAG_KEYS.filter((k) => k in data).map((k) => [k, data[k]]));
}

const EXTENSION_SENDER = { id: 'test-extension-id' } as chrome.runtime.MessageSender;

function runValidVisit(url: string, payload: Record<string, unknown>): Promise<RecordingData> {
  const recordVisit = vi.fn<ValidVisitHandlerDeps['recordVisit']>(
    async () => ({ success: true, skipped: false }),
  );
  const handler = createValidVisitHandler({
    isRecordingAllowed: vi.fn().mockResolvedValue(true),
    cacheTab: vi.fn(),
    updateCachedTab: vi.fn(),
    recordVisit,
    addBadgeTab: vi.fn(),
    hasBadgeTab: vi.fn().mockReturnValue(true),
  });
  const message = { type: 'VALID_VISIT', payload } as ValidVisitMessage;
  const sender = { tab: { id: 1, url, title: 'T' } } as chrome.runtime.MessageSender;
  return handler(message, sender, vi.fn()).then(() => recordVisit.mock.calls[0][0]);
}

function runManual(payload: Record<string, unknown>): Promise<RecordingData> {
  const record = vi.fn().mockResolvedValue({ success: true });
  const handler = createManualRecordHandler({
    isRecordingAllowed: vi.fn().mockResolvedValue(true),
    checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
    fetchContent: vi.fn().mockResolvedValue('fetched'),
    recordingPipeline: { record } as ManualRecordHandlerDeps['recordingPipeline'],
    getSettings: vi.fn().mockResolvedValue({}),
    setUrlContent: vi.fn().mockResolvedValue(undefined),
  });
  const message = {
    type: 'MANUAL_RECORD',
    payload: { title: 'T', url: 'https://example.com/m', content: 'body', ...payload },
  } as ManualRecordMessage;
  return handler(message, EXTENSION_SENDER, vi.fn()).then(() => record.mock.calls[0][0]);
}

function runSave(payload: Record<string, unknown>): Promise<RecordingData> {
  const record = vi.fn().mockResolvedValue({ success: true });
  const handler = createSaveRecordHandler({
    isRecordingAllowed: vi.fn().mockResolvedValue(true),
    recordingPipeline: { record } as SaveRecordHandlerDeps['recordingPipeline'],
    getSettings: vi.fn().mockResolvedValue({}),
    setUrlContent: vi.fn().mockResolvedValue(undefined),
  });
  const message = {
    type: 'SAVE_RECORD',
    payload: { title: 'T', url: 'https://example.com/s', content: 'body', ...payload },
  } as SaveRecordMessage;
  return handler(message, EXTENSION_SENDER, vi.fn()).then(() => record.mock.calls[0][0]);
}

function runRegenerate(extracted: ContentResponse): Promise<RecordingData> {
  const record = vi.fn().mockResolvedValue({ success: true });
  const handler = createRegenerateSummaryHandler({
    isRecordingAllowed: vi.fn().mockResolvedValue(true),
    recordingPipeline: { record } as RegenerateSummaryHandlerDeps['recordingPipeline'],
    getSettings: vi.fn().mockResolvedValue({}),
    checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
    fetchExtracted: vi.fn().mockResolvedValue(extracted),
  });
  const message: RegenerateSummaryMessage = {
    type: 'REGENERATE_SUMMARY',
    payload: { id: 7, url: 'https://example.com/r', title: 'T', cleanseMode: 'current' },
  };
  return handler(message, EXTENSION_SENDER, vi.fn()).then(
    () => (record.mock.calls[0] as [RecordingData])[0],
  );
}

describe('record diagnostics convergence (PBI 2026-09-23-12)', () => {
  beforeEach(() => {
    resetVisitRateLimiter();
    vi.stubGlobal('chrome', {
      action: {
        setBadgeText: vi.fn(),
        setBadgeBackgroundColor: vi.fn(),
      },
      i18n: { getMessage: vi.fn((key: string) => key) },
      runtime: { id: 'test-extension-id' },
    } as unknown as typeof chrome);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('forwards identical diagnostics on all four routes', async () => {
    const extracted: ContentResponse = {
      content: 're-extracted body',
      byteStats: {
        pageBytes: DIAG.pageBytes,
        candidateBytes: DIAG.candidateBytes,
        originalBytes: DIAG.originalBytes,
        cleansedBytes: DIAG.cleansedBytes,
      },
      aiSummaryCleansedStats: {
        aiSummaryOriginalBytes: DIAG.aiSummaryOriginalBytes,
        aiSummaryCleansedBytes: DIAG.aiSummaryCleansedBytes,
        aiSummaryCleansedElements: DIAG.aiSummaryCleansedElements,
        aiSummaryCleansedReason: DIAG.aiSummaryCleansedReason,
        aiSummaryCleansedReasons: DIAG.aiSummaryCleansedReasons,
      },
      fallbackTriggered: DIAG.fallbackTriggered,
      fallbackReason: DIAG.fallbackReason,
      cleansedReason: 'keyword',
    };
    const [valid, manual, save, regen] = await Promise.all([
      runValidVisit('https://example.com/conv-valid', { content: 'body', ...DIAG }),
      runManual({ ...DIAG }),
      runSave({ ...DIAG, maskedCount: 999 }),
      runRegenerate(extracted),
    ]);

    expect(diagOf(manual)).toEqual(diagOf(valid));
    expect(diagOf(save)).toEqual(diagOf(valid));
    expect(diagOf(regen)).toEqual(diagOf(valid));
    expect(diagOf(valid)).toEqual({ ...DIAG });
  });

  it('SAVE still excludes maskedCount even when the caller sends one (VULN-007)', async () => {
    const save = await runSave({ ...DIAG, maskedCount: 999 });
    expect(save.maskedCount).toBeUndefined();
    expect('maskedCount' in save).toBe(false);
  });

  it('sparse payloads keep unset keys absent on every route (pickDefined semantics)', async () => {
    const [valid, manual, save] = await Promise.all([
      runValidVisit('https://example.com/conv-sparse', { content: 'body', pageBytes: 10 }),
      runManual({ pageBytes: 10 }),
      runSave({ pageBytes: 10 }),
    ]);
    for (const data of [valid, manual, save]) {
      expect(diagOf(data)).toEqual({ pageBytes: 10 });
      expect('candidateBytes' in data).toBe(false);
      expect('fallbackReason' in data).toBe(false);
    }
  });

  it('caller-explicit keys stay per-caller (force / previewOnly / targetEntryId)', async () => {
    const extracted: ContentResponse = { content: 'body' };
    const [manual, regen] = await Promise.all([
      runManual({ force: true }),
      runRegenerate(extracted),
    ]);
    expect(manual.force).toBe(true);
    expect('force' in regen).toBe(false);
    expect(regen.targetEntryId).toBe(7);
    expect('targetEntryId' in manual).toBe(false);
  });
});
