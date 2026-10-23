/**
 * askHistoryHandlers.test.ts
 * PBI 2026-10-23-08 — 履歴に聞く (evidence + local-only answer with citations).
 * Pins: top-3 evidence selection with the 'no-summary' exclusion, the
 * never-raw snippet rule (cleansed content only), snippet truncation, the
 * fail-closed no-evidence branch (作らず分からない), local_only forcing on
 * the AI seam, and the collection scope degradation for an unknown id.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ASK_EVIDENCE_COUNT,
  ASK_SNIPPET_MAX_CHARS,
  buildEvidenceContext,
  buildWidenSuggestion,
  createAskHistoryHandler,
  matchesCollectionScope,
  normalizeCollectionScope,
  pickEvidenceRows,
  truncateSnippet,
} from '../askHistoryHandlers.js';
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

describe('pickEvidenceRows — table test (引用整形・打ち切り・安全性判定)', () => {
  it.each([
    ['cleansed content is quoted', { content: 'Cleansed body', summary: 'AI summary' }, 'Cleansed body'],
    ['AI summary is the fallback', { content: null, summary: 'AI summary' }, 'AI summary'],
    ['no quotable text is skipped', { content: null, summary: null }, null],
  ])('%s', (_name, overrides, expected) => {
    const { evidence } = pickEvidenceRows([makeRow(1, overrides)], () => 'allowed');
    if (expected === null) {
      expect(evidence).toEqual([]);
    } else {
      expect(evidence).toHaveLength(1);
      expect(evidence[0]?.snippet).toBe(expected);
    }
  });

  it('takes at most the evidence count and keeps the search order', () => {
    const rows = [1, 2, 3, 4, 5].map((id) => makeRow(id));
    const { evidence } = pickEvidenceRows(rows, () => 'allowed');
    expect(ASK_EVIDENCE_COUNT).toBe(3);
    expect(evidence.map((e) => e.id)).toEqual([1, 2, 3]);
  });

  it('skips rows whose domain the user opted out of AI processing', () => {
    const rows = [makeRow(1), makeRow(2), makeRow(3)];
    const { evidence, excludedNoSummary } = pickEvidenceRows(rows, (url) =>
      url.includes('example2.com') ? 'no-summary' : 'allowed',
    );
    expect(excludedNoSummary).toBe(1);
    expect(evidence.map((e) => e.id)).toEqual([1, 3]);
  });

  it('truncates long cleansed text at the snippet cap', () => {
    const long = 'あ'.repeat(ASK_SNIPPET_MAX_CHARS + 10);
    const { evidence } = pickEvidenceRows([makeRow(1, { content: long })], () => 'allowed');
    expect(evidence[0]?.snippet?.length).toBe(ASK_SNIPPET_MAX_CHARS + 1);
    expect(evidence[0]?.snippet?.endsWith('…')).toBe(true);
  });
});

describe('truncateSnippet (打ち切り)', () => {
  it('returns null for empty or whitespace-only text', () => {
    expect(truncateSnippet('', 100)).toBeNull();
    expect(truncateSnippet('   ', 100)).toBeNull();
    expect(truncateSnippet(null, 100)).toBeNull();
  });

  it('returns the trimmed text when it fits', () => {
    expect(truncateSnippet('  body  ', 100)).toBe('body');
  });
});

describe('buildEvidenceContext', () => {
  it('carries the question and numbered excerpts with URLs', () => {
    const context = buildEvidenceContext('この件について教えて', [
      { id: 1, title: 'A', url: 'https://a.example', snippet: '引用1' },
      { id: 2, title: 'B', url: 'https://b.example', snippet: '引用2' },
    ]);
    expect(context).toContain('質問: この件について教えて');
    expect(context).toContain('[1] A');
    expect(context).toContain('https://a.example');
    expect(context).toContain('[2] B');
    // The fail-closed instruction is in the prompt head.
    expect(context).toContain('分かりません');
  });
});

describe('buildWidenSuggestion (対象の広げ方を提案する)', () => {
  it('names the widen action for each no-evidence reason', () => {
    expect(buildWidenSuggestion('no_matches')).toContain('検索語を短く');
    expect(buildWidenSuggestion('no_quotable')).toContain('要約');
    expect(buildWidenSuggestion('domain_excluded')).toContain('対象外');
  });
});

describe('normalizeCollectionScope + matchesCollectionScope', () => {
  it('degrades unknown shapes to an unscoped search', () => {
    expect(normalizeCollectionScope(null)).toEqual({ tag: null, date: null });
    expect(normalizeCollectionScope({ tag: 42, date: true })).toEqual({ tag: null, date: null });
    expect(normalizeCollectionScope({ tag: ' rust ', date: ' 2026-10-23 ' })).toEqual({
      tag: 'rust',
      date: '2026-10-23',
    });
  });

  it('filters rows by tag membership and the local day range', () => {
    const scope = { tag: 'rust', date: null };
    expect(matchesCollectionScope(makeRow(1, { tags: 'rust, wasm' }), scope, null)).toBe(true);
    expect(matchesCollectionScope(makeRow(1, { tags: 'wasm' }), scope, null)).toBe(false);
  });

  it('drops rows outside the saved day range', () => {
    const scope = { tag: null, date: '2026-10-23' };
    const dayRange = { since: 1794380400000, until: 1794466740999 };
    expect(matchesCollectionScope(makeRow(1, { created_at: 1794400000000 }), scope, dayRange)).toBe(true);
    expect(matchesCollectionScope(makeRow(1, { created_at: 1700000000000 }), scope, dayRange)).toBe(false);
  });
});

describe('createAskHistoryHandler — BDD (質問に引用付きで答える / 作らず分からないと言う)', () => {
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

  it('refuses to fabricate when no records match (作らず分からないと言う)', async () => {
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

  it('rejects on the admission gate and forwards the rejection', async () => {
    const deps = makeDeps({
      admit: vi.fn().mockResolvedValue({ rejected: { success: false, reason: 'privacy_consent_required' } }),
    });
    const response = await runHandler(deps, { question: 'q' });
    expect(response).toEqual({ success: false, reason: 'privacy_consent_required' });
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
