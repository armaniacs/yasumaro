/**
 * askHistoryEvidence.realEngine.test.ts — PBI 2026-10-23-08 積み残し.
 *
 * The handler unit suite (askHistoryHandlers.test.ts) pins the evidence
 * shaping against hand-built rows and the stub suites pin SQL *shape*; the
 * PBI implementation record marks the FTS/LIKE both-path integration on a
 * real sqlite engine as not started. This suite closes that: the ask-history
 * handler is driven end to end with its `search` seam wired to the
 * production offscreen dispatch chain on a real engine (better-sqlite3, the
 * same reader sqliteBackendParity.realEngine.test.ts boots through
 * bootSqliteEngine):
 *
 *   handler op { kind: 'search', text, limit, offset, orderBy, orderDir }
 *     -> sqliteWireFor('search').encodePayload (the gateway fold, PBI 04)
 *     -> planQueryOrSearch  (the offscreen runner route the kind:'search'
 *        marker takes — planSearch owns the search default)
 *     -> handleSearch       (the production FTS/LIKE dispatch)
 *     -> real SQL, rows decoded by the real search row codec
 *
 * Records are seeded through the real insert path so the production FTS
 * sync triggers populate the index. Both search paths are proven with a
 * per-path discriminator: a 3+ char question takes the FTS path (the FTS
 * projection carries the engine rank, the LIKE projection has no rank cell
 * and the codec defaults it to 0), and a < 3 char question takes the LIKE
 * path (the trigram tokenizer cannot match a 2-char term — the FTS MATCH
 * finds nothing, so the returned row can only have come from the LIKE SQL).
 *
 * Never-raw (PBI 2026-10-23-08): the snippet quotes persisted post-cleansing
 * text only. The raw fixture body is stored in `content`, which the search
 * projection structurally excludes, so the snippet derives from the
 * persisted (cleansed + PII-masked) summary and never contains the raw body.
 */
import Database from 'better-sqlite3';
import { describe, it, expect } from 'vitest';
import { bootSqliteEngine } from '../sqliteBoot.js';
import { handleSearch } from '../opfsWorker/searchHandlers.js';
import { handleInsert } from '../opfsWorker/crudHandlers.js';
import type { HandlerContext } from '../opfsWorker/handlers.js';
import { planQueryOrSearch } from '../queryPlanner.js';
import { sqliteWireFor } from '../../messaging/sqliteWireTable.js';
import {
  ASK_EVIDENCE_COUNT,
  ASK_SNIPPET_MAX_CHARS,
  truncateSnippet,
} from '../../background/askEvidence.js';
import {
  createAskHistoryHandler,
  type AskHistoryGenerate,
  type AskHistoryHandlerDeps,
  type AskHistorySearch,
} from '../../background/handlers/askHistoryHandlers.js';
import type { AISummaryResult } from '../../background/ai/AIService.js';
import type { BrowsingLogRecord } from '../../utils/sqlite-types.js';
import type { SqliteEngine, SqliteRow, SqliteValue } from '../sqliteEngine.js';
import { StorageKeys, type Settings } from '../../utils/storage/types.js';
import type { AskHistoryResponse } from '../../messaging/responseCanonical.js';

/** Raw fixture body: unmasked PII plus a marker no snippet may ever carry. */
const RAW_BODY = 'UNMASKED-RAW-BODY: rune stone page text, contact user@example.com for the full transcript.';
/** Persisted post-cleansing summary: PII-masked (user@example.com -> u***@example.com). */
const MASKED_SUMMARY = 'rune stone spec: reviewer u***@example.com confirmed the rune timeline.';
/** Exactly ASK_SNIPPET_MAX_CHARS chars ('rune ' + pad), starting with the search term. */
const AT_BOUNDARY_SUMMARY = `rune ${'x'.repeat(ASK_SNIPPET_MAX_CHARS - 5)}`;
/** One char over the boundary — the cut case. */
const OVER_BOUNDARY_SUMMARY = `rune ${'x'.repeat(ASK_SNIPPET_MAX_CHARS - 4)}`;
/** Fixed epoch-ms so the LIKE path's created_at DESC order is deterministic. */
const BASE_TS = 1_760_000_000_000;

/**
 * The two search paths the FTS/LIKE dispatch serves, keyed by question
 * length: >= 3 chars routes to the trigram MATCH, < 3 chars to the LIKE
 * fallback. `miss` is the same-length term that matches nothing.
 */
const PATHS = [
  { label: 'FTS path', question: 'rune', miss: 'zzz' },
  { label: 'LIKE path', question: 'ru', miss: 'zz' },
] as const;

/** The one record the found/never-raw assertions share across both paths. */
const SEED: BrowsingLogRecord[] = [
  {
    url: 'https://docs.example.com/rune-stone',
    title: 'Rune stone spec',
    summary: MASKED_SUMMARY,
    tags: 'rust, rune',
    created_at: BASE_TS + 1,
    domain: 'docs.example.com',
    content: RAW_BODY,
  },
];
const SEED_URL = 'https://docs.example.com/rune-stone';

/** better-sqlite3 behind the engine interface both backends are written against. */
function openEngine(db: Database.Database): SqliteEngine {
  return {
    async exec(sql, params = []) {
      if (params.length > 0) db.prepare(sql).run(...(params as unknown[]));
      else db.exec(sql);
    },
    async query(sql, params = []) {
      return db.prepare(sql).all(...(params as unknown[])) as SqliteRow[];
    },
    async queryValue(sql, params = []) {
      const row = db.prepare(sql).get(...(params as unknown[])) as SqliteRow | undefined;
      if (!row) return null;
      return (Object.values(row)[0] ?? null) as SqliteValue;
    },
    async close() { db.close(); },
  };
}

interface AskBackend {
  ctx: HandlerContext;
  db: Database.Database;
  fts5Available: boolean;
  close: () => void;
}

/**
 * Boot the production sequence (pragmas -> schema -> migrations -> FTS5
 * statements) on a real engine, then seed through the real insert path so
 * the FTS sync triggers populate the index — the same reader the parity
 * suite boots.
 */
async function makeAskBackend(seed: BrowsingLogRecord[]): Promise<AskBackend> {
  const db = new Database(':memory:');
  const engine = openEngine(db);
  const boot = await bootSqliteEngine(engine);
  const ctx: HandlerContext = { engine };
  for (const record of seed) await handleInsert(ctx, record);
  return { ctx, db, fts5Available: boot.fts5Available, close: () => db.close() };
}

/**
 * The ask-history search seam wired to the production offscreen dispatch
 * chain on the real engine: the gateway fold (sqliteWireFor) -> the offscreen
 * runner route (planQueryOrSearch, kind marker -> planSearch) -> the FTS/LIKE
 * dispatch (handleSearch). Same route as compositionManifest.askEvidenceSearch
 * minus the chrome.runtime transport.
 */
function makeAskEvidenceSearch(backend: AskBackend): AskHistorySearch {
  return async (op) => {
    const row = sqliteWireFor('search');
    if (!row) throw new Error('search op has no wire-table row');
    const planned = planQueryOrSearch(row.encodePayload(op));
    const result = await handleSearch(backend.ctx, planned, backend.fts5Available);
    return { success: true, data: { rows: result.rows, total: result.total } };
  };
}

interface MakeDepsResult {
  deps: AskHistoryHandlerDeps;
  /** The context strings the AI seam received, in call order. */
  contexts: string[];
  /** The mode options the AI seam received, in call order. */
  modes: Array<string | undefined>;
}

function makeDeps(
  search: AskHistorySearch,
  overrides: {
    settings?: Settings;
    loadCollection?: AskHistoryHandlerDeps['loadCollection'];
  } = {},
): MakeDepsResult {
  const contexts: string[] = [];
  const modes: Array<string | undefined> = [];
  const generateAnswer: AskHistoryGenerate = async (content, options) => {
    contexts.push(content);
    modes.push(options?.mode);
    const result: AISummaryResult = { success: true, summary: '記録に基づく答え', providerName: 'built-in-ai' };
    return result;
  };
  return {
    contexts,
    modes,
    deps: {
      admit: async () => ({ settings: overrides.settings ?? {} }),
      search,
      generateAnswer,
      loadCollection: overrides.loadCollection ?? (async () => null),
    },
  };
}

const EXTENSION_SENDER = {
  id: 'test-extension-id',
  url: 'chrome-extension://test-extension-id/options.html',
} as unknown as chrome.runtime.MessageSender;

async function runHandler(
  deps: AskHistoryHandlerDeps,
  payload: { question: string; collectionId?: string | null },
): Promise<AskHistoryResponse> {
  const handler = createAskHistoryHandler(deps);
  const responses: unknown[] = [];
  await handler({ type: 'ASK_HISTORY', payload }, EXTENSION_SENDER, (response?: unknown) => {
    responses.push(response);
  });
  return responses[0] as AskHistoryResponse;
}

describe('ask-history evidence pipeline on a real engine (PBI 2026-10-23-08)', () => {
  describe('search-path dispatch proof (per-path discriminator)', () => {
    it('a 3+ char question takes the FTS path: the projection carries the engine rank', async () => {
      const backend = await makeAskBackend(SEED);
      try {
        expect(backend.fts5Available).toBe(true);
        const seam = makeAskEvidenceSearch(backend);
        const res = await seam({ kind: 'search', text: 'rune', limit: 30, offset: 0, orderBy: 'rank', orderDir: 'DESC' });
        expect(res.success).toBe(true);
        if (!res.success) return;
        expect(res.data.total).toBe(1);
        // The FTS projection adds the rank pseudo-column; the LIKE projection
        // has no rank cell (the codec defaults it to 0). A non-zero rank
        // proves the FTS statements ran on the real engine.
        expect(res.data.rows[0]!.rank).not.toBe(0);
      } finally {
        backend.close();
      }
    });

    it('a < 3 char question takes the LIKE path: the trigram index matches nothing for it', async () => {
      const backend = await makeAskBackend(SEED);
      try {
        // The trigram tokenizer cannot match a 2-char term: the FTS MATCH
        // finds nothing, so the row the seam returns can only have come from
        // the LIKE SQL (shouldUseFts5 routes < 3 chars off the FTS path).
        const ftsCount = backend.db.prepare(
          "SELECT COUNT(*) AS c FROM browsing_logs_fts WHERE browsing_logs_fts MATCH '\"ru\"'"
        ).get() as { c: number };
        expect(ftsCount.c).toBe(0);

        const seam = makeAskEvidenceSearch(backend);
        const res = await seam({ kind: 'search', text: 'ru', limit: 30, offset: 0, orderBy: 'rank', orderDir: 'DESC' });
        expect(res.success).toBe(true);
        if (!res.success) return;
        expect(res.data.total).toBe(1);
        // The LIKE projection has no rank cell — the codec defaults it to 0.
        expect(res.data.rows[0]!.rank).toBe(0);
      } finally {
        backend.close();
      }
    });
  });

  describe('both paths: found + never-raw + truncation + selection contract', () => {
    it.each(PATHS)('$label: a record with a body is found; the snippet derives from the persisted cleansed text, never the raw body', async ({ question }) => {
      const backend = await makeAskBackend(SEED);
      try {
        const { deps, contexts, modes } = makeDeps(makeAskEvidenceSearch(backend));
        const response = await runHandler(deps, { question });
        expect(response.success).toBe(true);
        if (!response.success || response.status !== 'answered') return;
        expect(response.citations).toHaveLength(1);
        const citation = response.citations[0]!;
        expect(citation.url).toBe(SEED_URL);
        // The snippet is the persisted post-cleansing text the search
        // projection carries, exactly as the pipeline truncates it.
        expect(citation.snippet).toBe(truncateSnippet(MASKED_SUMMARY, ASK_SNIPPET_MAX_CHARS));
        // PII mask applied before persistence: the masked form survives and
        // the raw form never leaks into the snippet (never-raw).
        expect(citation.snippet).toContain('u***@example.com');
        expect(citation.snippet).not.toContain('user@example.com');
        expect(citation.snippet).not.toContain('UNMASKED-RAW-BODY');
        // Not vacuous: the raw body IS stored on the real engine — it just
        // never reaches the snippet.
        const stored = backend.db.prepare('SELECT content FROM browsing_logs WHERE id = ?').get(citation.id) as { content: string | null };
        expect(stored.content).toBe(RAW_BODY);
        // The model context carries the same snippet, and the AI seam is
        // forced to mode local_only (外部送信なし).
        expect(contexts).toHaveLength(1);
        expect(contexts[0]!).toContain(citation.snippet);
        expect(modes).toEqual(['local_only']);
      } finally {
        backend.close();
      }
    });

    it.each(PATHS)('$label: the 500-char truncation boundary applies to the persisted text', async ({ question }) => {
      const backend = await makeAskBackend([
        { url: 'https://docs.example.com/at', title: 'at boundary', summary: AT_BOUNDARY_SUMMARY, tags: 'rune', created_at: BASE_TS + 1 },
        { url: 'https://docs.example.com/over', title: 'over boundary', summary: OVER_BOUNDARY_SUMMARY, tags: 'rune', created_at: BASE_TS + 2 },
      ]);
      try {
        const { deps } = makeDeps(makeAskEvidenceSearch(backend));
        const response = await runHandler(deps, { question });
        expect(response.success).toBe(true);
        if (!response.success || response.status !== 'answered') return;
        expect(response.citations).toHaveLength(2);
        const at = response.citations.find((c) => c.url === 'https://docs.example.com/at')!;
        const over = response.citations.find((c) => c.url === 'https://docs.example.com/over')!;
        // Exactly 500 chars survives whole — no ellipsis.
        expect(at.snippet).toBe(AT_BOUNDARY_SUMMARY);
        expect(at.snippet).toHaveLength(ASK_SNIPPET_MAX_CHARS);
        expect(at.snippet.endsWith('…')).toBe(false);
        // 501 chars is cut at 500 plus the ellipsis — never wrapped.
        expect(over.snippet).toBe(`${OVER_BOUNDARY_SUMMARY.substring(0, ASK_SNIPPET_MAX_CHARS)}…`);
        expect(over.snippet).toHaveLength(ASK_SNIPPET_MAX_CHARS + 1);
      } finally {
        backend.close();
      }
    });

    it.each(PATHS)('$label: only the top 3 evidence rows are quoted from the search result', async ({ question }) => {
      const backend = await makeAskBackend(
        [1, 2, 3, 4, 5].map((n) => ({
          url: `https://docs.example.com/rune-${n}`,
          title: `rune record ${n}`,
          summary: `rune summary ${n}: reviewer u***@example.com`,
          tags: 'rune',
          created_at: BASE_TS + n,
        })),
      );
      try {
        const seam = makeAskEvidenceSearch(backend);
        // The handler searches with limit ASK_EVIDENCE_COUNT * 10, so the
        // seam itself returns all 5 matches — the cap is the pipeline's.
        const seamRes = await seam({ kind: 'search', text: question, limit: 30, offset: 0, orderBy: 'rank', orderDir: 'DESC' });
        expect(seamRes.success).toBe(true);
        if (!seamRes.success) return;
        expect(seamRes.data.total).toBe(5);

        const { deps } = makeDeps(seam);
        const response = await runHandler(deps, { question });
        expect(response.success).toBe(true);
        if (!response.success || response.status !== 'answered') return;
        expect(response.citations).toHaveLength(ASK_EVIDENCE_COUNT);
        const ids = new Set(response.citations.map((c) => c.id));
        expect(ids.size).toBe(ASK_EVIDENCE_COUNT);
        for (const citation of response.citations) {
          expect(citation.snippet.length).toBeGreaterThan(0);
        }
      } finally {
        backend.close();
      }
    });

    it.each(PATHS)('$label: a row with no quotable projection text is skipped, not cited', async ({ question }) => {
      // The bare record matches on its TITLE only: the search finds it, but
      // its projection carries no summary and the search projection
      // structurally excludes content — so there is no cleansed text to
      // quote and the pipeline skips it even though a body is stored.
      const backend = await makeAskBackend([
        { url: 'https://docs.example.com/bare-title', title: 'rune bare', summary: null, tags: 'rune', created_at: BASE_TS + 1, content: RAW_BODY },
        { url: 'https://docs.example.com/quotable', title: 'quotable', summary: 'rune summary with u***@example.com', tags: 'rune', created_at: BASE_TS + 2 },
      ]);
      try {
        const { deps } = makeDeps(makeAskEvidenceSearch(backend));
        const response = await runHandler(deps, { question });
        expect(response.success).toBe(true);
        if (!response.success || response.status !== 'answered') return;
        expect(response.citations).toHaveLength(1);
        expect(response.citations[0]!.url).toBe('https://docs.example.com/quotable');
        // Not vacuous: the skipped record's body IS stored — the skip is the
        // projection/selection contract, not a missing body.
        const bareId = (backend.db.prepare('SELECT id FROM browsing_logs WHERE url = ?').get('https://docs.example.com/bare-title') as { id: number }).id;
        const stored = backend.db.prepare('SELECT content FROM browsing_logs WHERE id = ?').get(bareId) as { content: string | null };
        expect(stored.content).toBe(RAW_BODY);
      } finally {
        backend.close();
      }
    });

    it.each(PATHS)('$label: a no-summary domain is excluded from evidence selection', async ({ question }) => {
      const settings: Settings = {
        [StorageKeys.AI_DOMAIN_POLICY]: { 'secret.example.com': 'no-summary' },
      };
      const backend = await makeAskBackend([
        { url: 'https://secret.example.com/rune-secret', title: 'secret rune', summary: 'rune secret summary', tags: 'rune', created_at: BASE_TS + 1 },
        { url: 'https://docs.example.com/rune-open', title: 'open rune', summary: 'rune open summary with u***@example.com', tags: 'rune', created_at: BASE_TS + 2 },
      ]);
      try {
        const { deps } = makeDeps(makeAskEvidenceSearch(backend), { settings });
        const response = await runHandler(deps, { question });
        expect(response.success).toBe(true);
        if (!response.success || response.status !== 'answered') return;
        // Only the allowed-domain record is cited; the no-summary domain row
        // is excluded at evidence selection (PBI 2026-10-23-01 egress作法).
        expect(response.citations).toHaveLength(1);
        expect(response.citations[0]!.url).toBe('https://docs.example.com/rune-open');
      } finally {
        backend.close();
      }
    });

    it.each(PATHS)('$label: the collection scope narrows the search rows post-hoc (tag membership)', async ({ question }) => {
      const backend = await makeAskBackend([
        { url: 'https://docs.example.com/rune-tagged', title: 'tagged rune', summary: 'rune tagged summary with u***@example.com', tags: 'rust, rune', created_at: BASE_TS + 1 },
        { url: 'https://docs.example.com/rune-other', title: 'other rune', summary: 'rune other summary with u***@example.com', tags: 'wasm', created_at: BASE_TS + 2 },
      ]);
      try {
        const { deps } = makeDeps(makeAskEvidenceSearch(backend), {
          // The saved collection's raw stored query; the handler narrows it
          // to the scope fields it applies (tag membership, local day range).
          loadCollection: async () => ({ tag: 'rune' }),
        });
        const response = await runHandler(deps, { question, collectionId: 'col-1' });
        expect(response.success).toBe(true);
        if (!response.success || response.status !== 'answered') return;
        // The search op takes no tag params, so the scope narrows the real
        // search rows post-hoc: only the tagged record is cited.
        expect(response.citations).toHaveLength(1);
        expect(response.citations[0]!.url).toBe('https://docs.example.com/rune-tagged');
      } finally {
        backend.close();
      }
    });

    it.each(PATHS)('$label: no matching record means no answer and no AI call', async ({ miss }) => {
      const backend = await makeAskBackend(SEED);
      try {
        const { deps, contexts } = makeDeps(makeAskEvidenceSearch(backend));
        const response = await runHandler(deps, { question: miss });
        // BDD: 根拠がないときは作らず分からないと言う — the real engine
        // returns zero rows for the term and the handler answers with the
        // widening suggestion instead of a fabricated answer.
        expect(response.success).toBe(true);
        if (!response.success || response.status !== 'no_evidence') return;
        expect(response.suggestion).toContain('該当する記録がありません');
        // No AI call without evidence.
        expect(contexts).toHaveLength(0);
      } finally {
        backend.close();
      }
    });
  });
});
