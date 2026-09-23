import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildRecordRequest, extractOfflinePayload, buildOfflineRetryRequest, pickRecordDiagnostics } from '../recordRequestBuilder.js';
import type { RecordDiagnosticsSource } from '../recordRequestBuilder.js';
import type { ContentResponse } from '../../messaging/types.js';
import type { ManualRecordMessage } from '../messageTypes.js';
import type { AiSummaryCleansedReason } from '../../utils/commonTypes.js';
import type { RecordingContext } from '../pipeline/types.js';

describe('buildRecordRequest (PBI 2026-09-12-04)', () => {
  it('applies the per-source policy table', () => {
    const base = { title: 'T', url: 'https://example.com', content: 'c' };

    expect(buildRecordRequest('manual', base)).toEqual({
      title: 'T', url: 'https://example.com', content: 'c',
      skipDuplicateCheck: true, recordType: 'manual',
    });
    expect(buildRecordRequest('save', base)).toEqual({
      title: 'T', url: 'https://example.com', content: 'c',
      skipDuplicateCheck: true, alreadyProcessed: true, recordType: 'manual',
    });
    expect(buildRecordRequest('offline-retry', base)).toEqual({
      title: 'T', url: 'https://example.com', content: 'c',
      force: false, skipDuplicateCheck: true, recordType: 'manual',
    });
    expect(buildRecordRequest('notification-confirm', base)).toEqual({
      title: 'T', url: 'https://example.com', content: 'c',
      force: true, skipDuplicateCheck: true, recordType: 'auto',
    });
    expect(buildRecordRequest('valid-visit', base)).toEqual({
      title: 'T', url: 'https://example.com', content: 'c',
      skipDuplicateCheck: false, recordType: 'auto',
    });
  });

  it('explicit force overrides the source policy; unset diagnostics are dropped', () => {
    const request = buildRecordRequest('notification-confirm', {
      title: 'T', url: 'https://example.com', content: 'c',
      force: false,
    });
    expect(request.force).toBe(false);

    const minimal = buildRecordRequest('manual', {
      title: 'T', url: 'https://example.com', content: 'c',
    });
    expect('force' in minimal).toBe(false);
    expect('pageBytes' in minimal).toBe(false);
    expect('skipAi' in minimal).toBe(false);
  });

  it('carries the full diagnostic set when provided', () => {
    const request = buildRecordRequest('manual', {
      title: 'T', url: 'https://example.com', content: 'c',
      skipAi: true, previewOnly: true,
      pageBytes: 1, candidateBytes: 2, originalBytes: 3, cleansedBytes: 4,
      aiSummaryOriginalBytes: 5, aiSummaryCleansedBytes: 6,
      aiSummaryCleansedElements: 7, aiSummaryCleansedReason: 'hard',
      aiSummaryCleansedReasons: ['hard'], maskedCount: 8,
    });
    expect(request).toMatchObject({
      skipAi: true, previewOnly: true,
      pageBytes: 1, candidateBytes: 2, originalBytes: 3, cleansedBytes: 4,
      aiSummaryOriginalBytes: 5, aiSummaryCleansedBytes: 6,
      aiSummaryCleansedElements: 7, aiSummaryCleansedReason: 'hard',
      aiSummaryCleansedReasons: ['hard'], maskedCount: 8,
    });
  });
});

describe('offline retry preserves enqueued diagnostics (PBI 2026-09-12-04)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes the byte/ai stats from the job payload into the retry record', async () => {
    const { createOfflineQueueProcessor } = await import('../offlineQueueProcessor.js');

    const record = vi.fn().mockResolvedValue({ success: true, skipped: false });
    const retryObsidianWrite = vi.fn().mockResolvedValue(true);
    const processor = createOfflineQueueProcessor({
      offlineNetworkQueue: {
        retryAll: async (handler) => {
          await handler({
            id: 'job-1',
            type: 'ai_summary',
            payload: {
              title: 'T',
              url: 'https://example.com',
              content: 'body',
              pageBytes: 100,
              candidateBytes: 90,
              originalBytes: 120,
              cleansedBytes: 80,
              aiSummaryOriginalBytes: 60,
              aiSummaryCleansedBytes: 50,
              aiSummaryCleansedElements: 2,
              aiSummaryCleansedReason: 'keyword',
              aiSummaryCleansedReasons: ['keyword'],
            },
          } as never);
        },
      },
      recordingPipeline: { record, retryObsidianWrite },
    });

    await processor();

    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      title: 'T',
      url: 'https://example.com',
      content: 'body',
      force: false,
      skipDuplicateCheck: true,
      recordType: 'manual',
      pageBytes: 100,
      candidateBytes: 90,
      originalBytes: 120,
      cleansedBytes: 80,
      aiSummaryOriginalBytes: 60,
      aiSummaryCleansedBytes: 50,
      aiSummaryCleansedElements: 2,
      aiSummaryCleansedReason: 'keyword',
      aiSummaryCleansedReasons: ['keyword'],
    }));
  });

  it('round-trips context → payload → request without field loss (PBI 2026-09-12-11)', () => {
    const context = {
      data: {
        title: 'T', url: 'https://example.com', content: 'body',
        pageBytes: 100, candidateBytes: 90, originalBytes: 120, cleansedBytes: 80,
        aiSummaryOriginalBytes: 60, aiSummaryCleansedBytes: 50,
        aiSummaryCleansedElements: 2, aiSummaryCleansedReason: 'keyword',
        aiSummaryCleansedReasons: ['keyword'],
      },
      privacyResult: { summary: 's', maskedCount: 3, tags: ['a'] },
    } as unknown as RecordingContext;

    const payload = extractOfflinePayload(context);
    expect(payload).toMatchObject({
      title: 'T', summary: 's', maskedCount: 3, tags: ['a'], pageBytes: 100,
    });

    const request = buildOfflineRetryRequest(payload);
    expect(request).toMatchObject({
      title: 'T', url: 'https://example.com', content: 'body',
      force: false, skipDuplicateCheck: true, recordType: 'manual',
      maskedCount: 3, pageBytes: 100, candidateBytes: 90,
      aiSummaryCleansedReason: 'keyword',
    });
    // Queue-only fields (summary/tags) do not leak into the record request.
    expect(request).not.toHaveProperty('summary');
    expect(request).not.toHaveProperty('tags');
  });

  it('logs a failed full-pipeline retry instead of swallowing it', async () => {
    const { createOfflineQueueProcessor } = await import('../offlineQueueProcessor.js');
    const logger = await import('../../utils/logger/api.js');
    const logErrorSpy = vi.spyOn(logger, 'logError').mockResolvedValue(undefined);

    const processor = createOfflineQueueProcessor({
      offlineNetworkQueue: {
        retryAll: async (handler) => {
          await handler({
            id: 'job-2',
            type: 'ai_summary',
            payload: { title: 'T', url: 'https://example.com', content: 'body' },
          } as never);
        },
      },
      recordingPipeline: {
        record: vi.fn().mockRejectedValue(new Error('poison job')),
        retryObsidianWrite: vi.fn().mockResolvedValue(true),
      },
    });

    const result = await processor();
    // retryAll swallows the handler result by contract; the requirement is
    // that the failure is logged, not silent.
    expect(result).toBeUndefined();
    expect(logErrorSpy).toHaveBeenCalled();
    logErrorSpy.mockRestore();
  });
});

describe('pickRecordDiagnostics (PBI 2026-09-23-12)', () => {
  const FLAT_DIAG: {
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

  it('pins the owned field table: exactly these 12 keys travel together', () => {
    expect(Object.keys(pickRecordDiagnostics({ ...FLAT_DIAG })).sort()).toEqual(
      [
        'aiSummaryCleansedBytes',
        'aiSummaryCleansedElements',
        'aiSummaryCleansedReason',
        'aiSummaryCleansedReasons',
        'aiSummaryOriginalBytes',
        'candidateBytes',
        'cleansedBytes',
        'cleansedReason',
        'fallbackReason',
        'fallbackTriggered',
        'originalBytes',
        'pageBytes',
      ].sort(),
    );
  });

  it('drops unset fields (pickDefined semantics: keys absent, not undefined)', () => {
    const out = pickRecordDiagnostics({ pageBytes: 10 });
    expect(out).toEqual({ pageBytes: 10 });
    expect('candidateBytes' in out).toBe(false);
    expect('fallbackReason' in out).toBe(false);
  });

  it('never forwards maskedCount even when the payload carries one (VULN-007)', () => {
    const out = pickRecordDiagnostics({ ...FLAT_DIAG, maskedCount: 999 });
    expect('maskedCount' in out).toBe(false);
    const req = buildRecordRequest('save', {
      title: 'T', url: 'https://example.com', content: 'c', ...out,
    });
    expect('maskedCount' in req).toBe(false);
  });

  it('flattens the nested ContentResponse spelling (regenerate)', () => {
    const extracted: ContentResponse = {
      content: 're-extracted body',
      byteStats: {
        pageBytes: 1000, candidateBytes: 800, originalBytes: 700, cleansedBytes: 500,
      },
      aiSummaryCleansedStats: {
        aiSummaryOriginalBytes: 400,
        aiSummaryCleansedBytes: 300,
        aiSummaryCleansedElements: 2,
        aiSummaryCleansedReason: 'keyword',
        aiSummaryCleansedReasons: ['keyword'],
      },
      fallbackTriggered: true,
      fallbackReason: 'content_overcut',
      cleansedReason: 'keyword',
    };
    expect(pickRecordDiagnostics(extracted)).toEqual(FLAT_DIAG);
  });

  it('prefers flat fields over nested ones and returns {} for nullish payloads', () => {
    const mixed: RecordDiagnosticsSource = {
      pageBytes: 1,
      byteStats: { pageBytes: 2, candidateBytes: 3, originalBytes: 4, cleansedBytes: 5 },
    };
    expect(pickRecordDiagnostics(mixed)).toMatchObject({ pageBytes: 1, candidateBytes: 3 });
    expect(pickRecordDiagnostics(undefined)).toEqual({});
    expect(pickRecordDiagnostics(null)).toEqual({});
  });

  it('does not leak caller-explicit keys present on real message payloads', () => {
    const payload: ManualRecordMessage['payload'] = {
      title: 'T', url: 'https://example.com', content: 'c',
      force: true, skipAi: true, ...FLAT_DIAG,
    };
    const out = pickRecordDiagnostics(payload);
    expect('force' in out).toBe(false);
    expect('skipAi' in out).toBe(false);
    expect('previewOnly' in out).toBe(false);
    expect('targetEntryId' in out).toBe(false);
    expect(out).toMatchObject(FLAT_DIAG);
  });
});

describe('buildRecordRequest regenerate source policy (PBI 2026-09-22-04)', () => {
  it('is SQLite-only, manual-typed, and force-default-off (CRITICAL)', () => {
    const req = buildRecordRequest('regenerate', {
      title: 'T', url: 'https://example.com', content: 'c', targetEntryId: 7,
    });
    expect(req).toMatchObject({
      recordType: 'manual',
      skipDuplicateCheck: true,
      skipObsidianAppend: true,
      skipLocalMarkdownExport: true,
      targetEntryId: 7,
    });
    expect(req).not.toHaveProperty('force');
  });

  it('carries caller-explicit force and regenerate diagnostics', () => {
    const req = buildRecordRequest('regenerate', {
      title: 'T', url: 'https://example.com', content: 'c',
      force: true, targetEntryId: 7, fallbackReason: 'over_cleansed',
      pageBytes: 100, candidateBytes: 90,
    });
    expect(req.force).toBe(true);
    expect(req).toMatchObject({
      targetEntryId: 7,
      fallbackReason: 'over_cleansed',
      pageBytes: 100,
      candidateBytes: 90,
    });
  });
});
