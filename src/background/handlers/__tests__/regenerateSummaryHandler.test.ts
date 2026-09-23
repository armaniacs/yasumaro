/**
 * regenerateSummaryHandler.test.ts — REGENERATE_SUMMARY (PBI 2026-09-22-04).
 *
 * Handler-level with the REAL buildRecordRequest policy; only I/O seams are
 * mocked (pipeline / fetch / rate limit / consent). Pins the binding matrix:
 * force-default-off, needsForce only for force-bypassable gates (and never
 * after an explicit force), in-flight ignore, bucket separation, non-
 * destructive fetch/URL failures.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createRegenerateSummaryHandler,
  type RegenerateSummaryHandlerDeps,
} from '../recordingHandlers.js';
import type { RegenerateSummaryMessage } from '../../messageTypes.js';
import type { ContentResponse, RecordingData } from '../../../messaging/types.js';

const URL = 'https://example.com/article.html';
const sender = {} as chrome.runtime.MessageSender;

function makeMessage(overrides: Partial<RegenerateSummaryMessage['payload']> = {}): RegenerateSummaryMessage {
  return {
    type: 'REGENERATE_SUMMARY',
    payload: { id: 7, url: URL, title: 'Example', cleanseMode: 'current', ...overrides },
  };
}

function makeExtracted(overrides: Partial<ContentResponse> = {}): ContentResponse {
  return {
    content: 're-extracted body text for the entry',
    byteStats: { pageBytes: 1000, candidateBytes: 800, originalBytes: 700, cleansedBytes: 500 },
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
    ...overrides,
  } as ContentResponse;
}

interface Harness {
  deps: RegenerateSummaryHandlerDeps;
  record: ReturnType<typeof vi.fn>;
  responses: unknown[];
  respond: (r?: unknown) => void;
  handler: ReturnType<typeof createRegenerateSummaryHandler>;
}

function makeHarness(): Harness {
  const responses: unknown[] = [];
  const record = vi.fn().mockResolvedValue({ success: true });
  const deps: RegenerateSummaryHandlerDeps = {
    isRecordingAllowed: vi.fn().mockResolvedValue(true),
    recordingPipeline: { record },
    getSettings: vi.fn().mockResolvedValue({}),
    checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
    fetchExtracted: vi.fn().mockResolvedValue(makeExtracted()),
  };
  return {
    deps,
    record,
    responses,
    respond: (r?: unknown) => { responses.push(r); },
    handler: createRegenerateSummaryHandler(deps),
  };
}

describe('createRegenerateSummaryHandler — success path (CRITICAL)', () => {
  let h: Harness;
  beforeEach(() => { h = makeHarness(); });

  it('builds the full RecordingData via the real regenerate policy', async () => {
    await h.handler(makeMessage({ cleanseMode: 'looser' }), sender, h.respond);

    expect(h.deps.fetchExtracted).toHaveBeenCalledWith(URL, 'looser');
    expect(h.record).toHaveBeenCalledTimes(1);
    const [data, opts] = h.record.mock.calls[0] as [RecordingData, { settings: unknown }];
    expect(opts.settings).toEqual({});

    // Real buildRecordRequest('regenerate', …) policy, pinned field by field:
    expect(data.title).toBe('Example');
    expect(data.url).toBe(URL);
    expect(data.content).toBe('re-extracted body text for the entry');
    expect(data.recordType).toBe('manual');
    expect(data.targetEntryId).toBe(7);
    // Binding: force OFF by default — the key must be absent, not false.
    expect('force' in data).toBe(false);
    // Binding: side-effect skips owned by the policy.
    expect(data.skipObsidianAppend).toBe(true);
    expect(data.skipLocalMarkdownExport).toBe(true);
    expect(data.skipDuplicateCheck).toBe(true);
    // Byte / fallback mapping from the ContentResponse reply.
    expect(data.pageBytes).toBe(1000);
    expect(data.candidateBytes).toBe(800);
    expect(data.originalBytes).toBe(700);
    expect(data.cleansedBytes).toBe(500);
    expect(data.aiSummaryOriginalBytes).toBe(400);
    expect(data.aiSummaryCleansedBytes).toBe(300);
    expect(data.aiSummaryCleansedElements).toBe(2);
    expect(data.aiSummaryCleansedReason).toBe('keyword');
    expect(data.aiSummaryCleansedReasons).toEqual(['keyword']);
    expect(data.fallbackTriggered).toBe(true);
    expect(data.fallbackReason).toBe('content_overcut');
    expect(data.cleansedReason).toBe('keyword');

    expect(h.responses).toEqual([{ success: true }]);
  });

  it('passes force:true only when the caller opts in', async () => {
    await h.handler(makeMessage({ force: true }), sender, h.respond);
    const [data] = h.record.mock.calls[0] as [RecordingData, unknown];
    expect(data.force).toBe(true);
  });

  it('runs the rate limit in the separated regenerate bucket (CRITICAL: bucket)', async () => {
    await h.handler(makeMessage(), sender, h.respond);
    expect(h.deps.checkRateLimit).toHaveBeenCalledWith(
      expect.anything(),
      {},
      { bucket: 'regenerate' },
    );
  });

  it('rejects when consent is missing and never touches fetch/pipeline', async () => {
    (h.deps.isRecordingAllowed as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    await h.handler(makeMessage(), sender, h.respond);
    expect(h.responses).toEqual([{ success: false, error: 'privacy_consent_required' }]);
    expect(h.deps.fetchExtracted).not.toHaveBeenCalled();
    expect(h.record).not.toHaveBeenCalled();
  });

  it('surfaces rate limiting with the rate_limited reason', async () => {
    (h.deps.checkRateLimit as ReturnType<typeof vi.fn>).mockResolvedValue({
      allowed: false, error: 'rate limit exceeded',
    });
    await h.handler(makeMessage(), sender, h.respond);
    expect(h.responses).toEqual([
      { success: false, error: 'rate limit exceeded', reason: 'rate_limited' },
    ]);
    expect(h.deps.fetchExtracted).not.toHaveBeenCalled();
  });
});

describe('createRegenerateSummaryHandler — needsForce matrix (CRITICAL: Ask Q1C)', () => {
  // needsForce:true ONLY for force-bypassable gates on the NON-force path.
  // PERMISSION_REQUIRED / INVALID_URL never offer it (force bypasses neither
  // decidePermission nor validateUrl). An explicit force that still fails does
  // NOT re-offer itself (force already ran — re-offering is noise).
  const offerCases = ['DOMAIN_BLOCKED', 'DOMAIN_NOT_TRUSTED', 'PRIVATE_PAGE_DETECTED'];
  const denyCases = ['PERMISSION_REQUIRED', 'INVALID_URL'];

  it.each(offerCases)('%s without force → needsForce:true', async (error) => {
    const h = makeHarness();
    h.record.mockResolvedValue({ success: false, error });
    await h.handler(makeMessage(), sender, h.respond);
    expect(h.responses).toEqual([{ success: false, error, needsForce: true }]);
  });

  it.each(denyCases)('%s → NO needsForce', async (error) => {
    const h = makeHarness();
    h.record.mockResolvedValue({ success: false, error });
    await h.handler(makeMessage(), sender, h.respond);
    expect(h.responses).toEqual([{ success: false, error }]);
  });

  it('an explicit force that still hits a gate does NOT re-offer needsForce', async () => {
    const h = makeHarness();
    h.record.mockResolvedValue({ success: false, error: 'DOMAIN_BLOCKED' });
    await h.handler(makeMessage({ force: true }), sender, h.respond);
    expect(h.responses).toEqual([{ success: false, error: 'DOMAIN_BLOCKED' }]);
    const [data] = h.record.mock.calls[0] as [RecordingData, unknown];
    expect(data.force).toBe(true);
  });

  it('generic errors pass through unchanged', async () => {
    const h = makeHarness();
    h.record.mockResolvedValue({ success: false, error: 'AI_QUOTA' });
    await h.handler(makeMessage(), sender, h.respond);
    expect(h.responses).toEqual([{ success: false, error: 'AI_QUOTA' }]);
  });
});

describe('createRegenerateSummaryHandler — in-flight guard (CRITICAL)', () => {
  it('ignores a repeat click for the same id; the pipeline runs once', async () => {
    const h = makeHarness();
    let release!: (v: ContentResponse) => void;
    const gate = new Promise<ContentResponse>((r) => { release = r; });
    (h.deps.fetchExtracted as ReturnType<typeof vi.fn>).mockReturnValue(gate);

    const msg = makeMessage({ id: 42 });
    const p1 = h.handler(msg, sender, h.respond);
    // Flush microtasks so p1 passes the gates and parks inside fetchExtracted
    // (inFlight.add runs before the fetch await).
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const second: unknown[] = [];
    await h.handler(msg, sender, (r?: unknown) => { second.push(r); });
    expect(second).toEqual([{ success: false, error: 'in_flight' }]);

    release(makeExtracted());
    await p1;
    expect(h.record).toHaveBeenCalledTimes(1);

    // The guard is released after completion — a later retry proceeds.
    await h.handler(msg, sender, h.respond);
    expect(h.record).toHaveBeenCalledTimes(2);
  });

  it('tracks ids independently (different entries do not block each other)', async () => {
    const h = makeHarness();
    await h.handler(makeMessage({ id: 1 }), sender, h.respond);
    await h.handler(makeMessage({ id: 2 }), sender, h.respond);
    expect(h.record).toHaveBeenCalledTimes(2);
  });
});

describe('createRegenerateSummaryHandler — fetch/URL failures (non-destructive)', () => {
  it('maps localhost to invalid_url (blockLocalhost mirrors ManualContentFetcher)', async () => {
    const h = makeHarness();
    await h.handler(makeMessage({ url: 'http://localhost:9/never.html' }), sender, h.respond);
    expect(h.responses).toEqual([{ success: false, error: 'invalid_url' }]);
    expect(h.deps.fetchExtracted).not.toHaveBeenCalled();
    expect(h.record).not.toHaveBeenCalled();
  });

  it('accepts http:// URLs (legacy rows may predate isSecureUrl — regenerate only re-extracts)', async () => {
    const h = makeHarness();
    await h.handler(makeMessage({ url: 'http://legacy.example.com/old-page' }), sender, h.respond);
    expect(h.deps.fetchExtracted).toHaveBeenCalledWith('http://legacy.example.com/old-page', 'current');
  });

  it('maps a non-http(s) URL to invalid_url', async () => {
    const h = makeHarness();
    await h.handler(makeMessage({ url: 'ftp://example.com/file' }), sender, h.respond);
    expect(h.responses).toEqual([{ success: false, error: 'invalid_url' }]);
  });

  it('maps a fetch seam rejection to fetch_failed with the sentinel detail', async () => {
    const h = makeHarness();
    (h.deps.fetchExtracted as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('tab_load_timeout'));
    await h.handler(makeMessage(), sender, h.respond);
    expect(h.responses).toEqual([{ success: false, error: 'fetch_failed: tab_load_timeout' }]);
    expect(h.record).not.toHaveBeenCalled();
  });
});

describe('createRegenerateSummaryHandler — AI-failure gate (PBI 2026-09-22-04 follow-up)', () => {
  it('pipeline-success with aiSucceeded:false maps to ai_failed without touching storage', async () => {
    const h = makeHarness();
    h.record.mockResolvedValue({
      success: true,
      aiSucceeded: false,
      summary: 'Prompt failed: An unknown error occurred: kErrorUnknown',
    });
    await h.handler(makeMessage(), sender, h.respond);
    // The saveSqliteStep UPDATE gate (params.aiSucceeded) is what actually
    // protects the write; the handler contract is the error surface.
    expect(h.responses).toEqual([{ success: false, error: 'ai_failed' }]);
  });

  it('pipeline-success with aiSucceeded:true passes through unchanged', async () => {
    const h = makeHarness();
    h.record.mockResolvedValue({
      success: true,
      aiSucceeded: true,
      summary: 'A real summary.',
    });
    await h.handler(makeMessage(), sender, h.respond);
    expect(h.responses).toEqual([{ success: true, aiSucceeded: true, summary: 'A real summary.' }]);
  });
});

describe('createRegenerateSummaryHandler — providersTried passthrough (PBI 2026-09-22-04 follow-up)', () => {
  it('aiSucceeded:false response carries the tried provider trail', async () => {
    const h = makeHarness();
    h.record.mockResolvedValue({
      success: true,
      aiSucceeded: false,
      attemptedProviders: ['lm-studio', 'gemini'],
      summary: 'Prompt failed: ...',
    });
    await h.handler(makeMessage(), sender, h.respond);
    expect(h.responses).toEqual([{
      success: false,
      error: 'ai_failed',
      providersTried: ['lm-studio', 'gemini'],
    }]);
  });

  it('omits the trail when the pipeline did not report one (legacy shape)', async () => {
    const h = makeHarness();
    h.record.mockResolvedValue({ success: true, aiSucceeded: true, summary: 'ok' });
    await h.handler(makeMessage(), sender, h.respond);
    expect(h.responses[0]).not.toHaveProperty('providersTried');
  });
});

describe('createRegenerateSummaryHandler — slotFailures passthrough (PBI follow-up)', () => {
  it('ai_failed response carries the per-slot failure list', async () => {
    const h = makeHarness();
    h.record.mockResolvedValue({
      success: true,
      aiSucceeded: false,
      attemptedProviders: ['openai', 'built-in-ai'],
      slotFailures: [
        { provider: 'openai', error: 'HTTP 401' },
        { provider: 'built-in-ai', error: 'Prompt failed: kErrorUnknown' },
      ],
    });
    await h.handler(makeMessage(), sender, h.respond);
    expect(h.responses).toEqual([{
      success: false,
      error: 'ai_failed',
      providersTried: ['openai', 'built-in-ai'],
      slotFailures: [
        { provider: 'openai', error: 'HTTP 401' },
        { provider: 'built-in-ai', error: 'Prompt failed: kErrorUnknown' },
      ],
    }]);
  });
});
