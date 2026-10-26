/**
 * askHistoryHandlers.test.ts
 * PBI 2026-10-23-08 — 履歴に聞く (evidence + local-only answer with citations).
 * PBI 2026-10-24-04 — dispatch-through-Outcome only: evidence shaping lives in
 * `src/background/askEvidence.ts` (see `__tests__/askEvidence.test.ts`).
 * Pins: answered-with-citations, the fail-closed no-evidence branch,
 * local_only forcing on the AI seam, and the collection scope degradation
 * for an unknown id.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAskHistoryHandler } from '../askHistoryHandlers.js';
import { createMessageRouter, type MessageRouterDeps } from '../MessageRouter.js';
import type { AISummaryResult, AiConnectionTestResult } from '../../ai/AIService.js';
import type { BrowsingLogRecord } from '../../../utils/sqlite-types.js';

function makeRow(id: number, overrides: Partial<BrowsingLogRecord> = {}): BrowsingLogRecord {
  return {
    id,
    url: `https://example${id}.com/page`,
    title: `Example ${id}`,
    created_at: 1700000000000 + id,
    content: `Cleansed body ${id}`,
    ...overrides,
  };
}

function makeDeps(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    admit: vi.fn().mockResolvedValue({ settings: {} }),
    search: vi.fn().mockResolvedValue({ success: true, data: { rows: [], total: 0 } }),
    generateAnswer: vi.fn().mockResolvedValue({ success: true, summary: '答え', providerName: 'built-in-ai' }),
    loadCollection: vi.fn().mockResolvedValue(null),
    resolveDomainPolicy: vi.fn().mockReturnValue('allowed'),
    ...overrides,
  } as unknown as {
    admit: ReturnType<typeof vi.fn>;
    search: ReturnType<typeof vi.fn>;
    generateAnswer: ReturnType<typeof vi.fn>;
    loadCollection: ReturnType<typeof vi.fn>;
    resolveDomainPolicy: ReturnType<typeof vi.fn>;
  };
}

const EXTENSION_SENDER = {
  id: 'test-extension-id',
  url: 'chrome-extension://test-extension-id/options.html',
} as unknown as chrome.runtime.MessageSender;

async function runHandler(deps: unknown, payload: { question: string; collectionId?: string | null }) {
  const handler = createAskHistoryHandler(deps as never);
  const sendResponse = vi.fn();
  await handler({ type: 'ASK_HISTORY', payload } as never, EXTENSION_SENDER, sendResponse);
  return sendResponse.mock.calls[0]?.[0] as Record<string, unknown>;
}

describe('createAskHistoryHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('answers with citations and forces mode local_only on the AI seam', async () => {
    const deps = makeDeps({
      search: vi.fn().mockResolvedValue({
        success: true,
        data: { rows: [makeRow(1), makeRow(2), makeRow(3)], total: 3 },
      }),
    });
    const response = await runHandler(deps, { question: 'WASMの検証結果は？' });
    expect(response.success).toBe(true);
    expect(response.status).toBe('answered');
    expect(response.answer).toBe('答え');
    expect(response.citations).toHaveLength(3);
    // 外部送信なし: mode 'local_only' is forced — never a remote provider.
    expect(deps.generateAnswer).toHaveBeenCalledWith(expect.anything(), { mode: 'local_only' });
  });

  it('refuses to fabricate when no records match', async () => {
    const deps = makeDeps();
    const response = await runHandler(deps, { question: '存在しない話題' });
    expect(response.success).toBe(true);
    expect(response.status).toBe('no_evidence');
    expect(response.suggestion).toContain('検索語を短く');
    // No AI call without evidence — the answer is never fabricated.
    expect(deps.generateAnswer).not.toHaveBeenCalled();
  });

  it('scopes the evidence by the chosen collection and degrades an unknown id', async () => {
    const deps = makeDeps({
      search: vi.fn().mockResolvedValue({
        success: true,
        data: {
          rows: [makeRow(1, { tags: 'rust' }), makeRow(2, { tags: 'wasm' }), makeRow(3, { tags: 'rust, ai' })],
          total: 3,
        },
      }),
      loadCollection: vi.fn().mockResolvedValue({ tag: 'rust' }),
    });
    const response = await runHandler(deps, { question: 'rust', collectionId: 'col-1' });
    expect(deps.loadCollection).toHaveBeenCalledWith('col-1');
    expect(response.status).toBe('answered');
    expect((response.citations as Array<{ id: number }>).map((c) => c.id)).toEqual([1, 3]);
  });

  it('falls back to an unscoped search when the collection id is unknown', async () => {
    const deps = makeDeps({
      search: vi.fn().mockResolvedValue({
        success: true,
        data: { rows: [makeRow(1)], total: 1 },
      }),
      loadCollection: vi.fn().mockResolvedValue(null),
    });
    const response = await runHandler(deps, { question: 'rust', collectionId: 'gone' });
    expect(deps.loadCollection).toHaveBeenCalledWith('gone');
    expect(response.status).toBe('answered');
  });

  it('ignores repeat clicks while a run is executing (in_flight)', async () => {
    // Object holder: a plain `let` narrowed to `never` across the closure.
    const deferred: { release: (value: unknown) => void } = { release: () => undefined };
    const deps = makeDeps({
      search: vi.fn().mockImplementation(
        () => new Promise((resolve) => {
          deferred.release = resolve;
        }),
      ),
    });
    const handler = createAskHistoryHandler(deps as never);
    const sendResponse = vi.fn();
    const first = handler({ type: 'ASK_HISTORY', payload: { question: 'q' } } as never, EXTENSION_SENDER, sendResponse);
    await handler({ type: 'ASK_HISTORY', payload: { question: 'q2' } } as never, EXTENSION_SENDER, sendResponse);
    expect(sendResponse).toHaveBeenCalledWith({ success: false, error: 'in_flight' });
    deferred.release({ success: true, data: { rows: [], total: 0 } });
    await first;
  });

  it('rejects on the admission gate and surfaces the reason as the error', async () => {
    // PBI 2026-10-25-12: the wire contract carries failures in `error`, so
    // the admission `reason` must be mapped — verbatim forwarding loses it in
    // the gateway normalizer and the panel shows a generic sentence.
    const deps = makeDeps({
      admit: vi.fn().mockResolvedValue({ rejected: { success: false, reason: 'privacy_consent_required' } }),
    });
    const response = await runHandler(deps, { question: 'q' });
    expect(response).toEqual({ success: false, error: 'privacy_consent_required' });
  });

  it('surfaces an AI failure instead of answering with an empty summary', async () => {
    const deps = makeDeps({
      search: vi.fn().mockResolvedValue({
        success: true,
        data: { rows: [makeRow(1)], total: 1 },
      }),
      generateAnswer: vi.fn().mockResolvedValue({ success: false, summary: '' }),
    });
    const response = await runHandler(deps, { question: 'q' });
    expect(response.success).toBe(false);
    expect(response.error).toBe('ask_failed');
  });
});

describe('ASK_HISTORY production wiring (PBI 2026-10-23-08)', () => {
  it('answers through createMessageRouter when generateSummary reads this', async () => {
    // FallbackAIService.generateSummary is a prototype method (reads
    // this.config). The router must bind it — a detached pass-through
    // throws on every answered QA and the answer degrades to a TypeError.
    class ThisDependentAiService {
      constructor(private readonly tag: string) {}
      async generateSummary(content: string): Promise<AISummaryResult> {
        return { success: true, summary: `${this.tag}:${content.length}`, providerName: 'built-in-ai' };
      }
      async testConnection(): Promise<AiConnectionTestResult> {
        return { success: true, message: 'ok', providers: [] };
      }
    }
    const deps: MessageRouterDeps = {
      runtimeId: 'test-id',
      recordingPipeline: { record: vi.fn().mockResolvedValue({ success: true }) },
      tabCache: { add: vi.fn(), update: vi.fn() },
      obsidian: { testConnection: vi.fn().mockResolvedValue({ success: true }) },
      aiService: new ThisDependentAiService('wired'),
      askEvidenceSearch: vi.fn().mockResolvedValue({
        success: true,
        data: { rows: [makeRow(1)], total: 1 },
      }) as never,
      recordingAdmission: { admit: vi.fn().mockResolvedValue({ settings: {} }) } as never,
      fetchManualContent: vi.fn(),
      fetchRegenerated: vi.fn().mockResolvedValue({ content: '' }),
      setUrlContent: vi.fn(),
      buildAllowedUrls: vi.fn().mockReturnValue(new Set()),
      getSettings: vi.fn().mockResolvedValue({}),
      isDomainAllowed: vi.fn().mockResolvedValue(true),
      clearSettingsCache: vi.fn(),
      notifyAiTestProgress: vi.fn(),
      getPrivacyCache: vi.fn().mockReturnValue(null),
      updateActivity: vi.fn().mockResolvedValue(undefined),
      lockSession: vi.fn().mockResolvedValue(undefined),
      autoSavedBadgeTabs: { add: vi.fn(), has: vi.fn().mockReturnValue(false) },
      initExportScheduler: vi.fn().mockResolvedValue(undefined),
      updateConsentBadge: vi.fn().mockResolvedValue(undefined),
      generateWeeklySummary: vi.fn().mockResolvedValue(true),
      generateMonthlySummary: vi.fn().mockResolvedValue(true),
      dashboardSqliteHandler: vi.fn(),
    };
    const router = createMessageRouter(deps);
    const sendResponse = vi.fn();
    const sender = { id: 'test-id' } as unknown as chrome.runtime.MessageSender;

    const handled = router.dispatch(
      { type: 'ASK_HISTORY', payload: { question: '配線の検証' }, protocolVersion: 1 },
      sender,
      sendResponse,
    );

    expect(handled).toBe(true);
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, status: 'answered' }),
      );
    });
    const response = sendResponse.mock.calls[0]?.[0] as { answer?: string };
    expect(response.answer).toMatch(/^wired:/);
  });
});
