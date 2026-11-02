/**
 * researchReportGenerator.test.ts
 * PBI 2026-10-23-09 — 調査レポート一発生成 (four-section Markdown).
 * Pins: the four sections (要旨・時系列・引用・未読穴), citations link back to
 * the original records (元記録に飛べる), the empty-selection 縮退 (never a
 * fake success), the Obsidian delivery failure passthrough, and the scope
 * mapping to the records query.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildReportFilename,
  buildResearchReportMarkdown,
  countUnreadHoles,
  createResearchReportGenerator,
  AND_CLAUSE_WINDOW,
  REPORT_MAX_RECORDS,
  type ResearchReportGeneratorDeps,
  type ResearchReportRecord,
} from '../researchReportGenerator.js';
import { MAX_BATCH_READ_RECORDS } from '../../utils/limits.js';

type GeneratorMocks = ResearchReportGeneratorDeps & {
  sqliteClient: { query: ReturnType<typeof vi.fn> };
  obsidian: { appendToDailyNote: ReturnType<typeof vi.fn> };
  downloadMarkdown: ReturnType<typeof vi.fn>;
  repo: { get: ReturnType<typeof vi.fn> };
};

function makeRecord(id: number, overrides: Partial<ResearchReportRecord> = {}): ResearchReportRecord {
  return {
    id,
    title: `Record ${id}`,
    url: `https://example${id}.com/page`,
    createdAt: 1700000000000 + id,
    summary: `Summary ${id}`,
    ...overrides,
  };
}

function makeDeps(overrides: Partial<Record<string, unknown>> = {}): GeneratorMocks {
  return {
    sqliteClient: {
      query: vi.fn().mockResolvedValue({
        success: true,
        data: { rows: [makeRecord(1), makeRecord(2)], total: 2 },
      }),
    },
    obsidian: { appendToDailyNote: vi.fn().mockResolvedValue(undefined) },
    downloadMarkdown: vi.fn().mockResolvedValue(true),
    repo: { get: vi.fn().mockResolvedValue('Yasumaro') },
    ...overrides,
  } as unknown as GeneratorMocks;
}

describe('buildResearchReportMarkdown — BDD (要旨・時系列・引用・未読穴の4節)', () => {
  it('carries all four sections and cites the original records', () => {
    const records = [makeRecord(1), makeRecord(2, { createdAt: 1690000000000 })];
    const markdown = buildResearchReportMarkdown(records, { title: '調査', now: 1700000100000 });
    expect(markdown).not.toBeNull();
    expect(markdown).toContain('# 調査レポート: 調査');
    expect(markdown).toContain('## 要旨');
    expect(markdown).toContain('## 時系列');
    expect(markdown).toContain('## 引用');
    expect(markdown).toContain('## 未読穴');
    // 引用から元記録に飛べる: numbered links to the original URLs.
    expect(markdown).toContain('1. [Record 1](https://example1.com/page)');
    expect(markdown).toContain('2. [Record 2](https://example2.com/page)');
  });

  it('orders the timeline oldest first regardless of input order', () => {
    const records = [makeRecord(2, { createdAt: 1700000000000 }), makeRecord(1, { createdAt: 1690000000000 })];
    const markdown = buildResearchReportMarkdown(records, { title: 't', now: 1 });
    const timeline = markdown?.split('## 時系列')[1]?.split('## 引用')[0] ?? '';
    expect(timeline.indexOf('Record 1')).toBeLessThan(timeline.indexOf('Record 2'));
  });

  it('sanitizes timeline titles like the other sections (no raw HTML passthrough)', () => {
    const records = [makeRecord(1, { title: '<img src=x onerror=alert(1)>', summary: 's' })];
    const markdown = buildResearchReportMarkdown(records, { title: 't', now: 1 });
    const timeline = markdown?.split('## 時系列')[1]?.split('## 引用')[0] ?? '';
    expect(timeline).not.toContain('<img');
    expect(timeline).toContain('&lt;img');
  });

  it('lists summary-less records as unread holes (選択範囲内の穴)', () => {
    const records = [makeRecord(1), makeRecord(2, { summary: '' })];
    const markdown = buildResearchReportMarkdown(records, { title: 't', now: 1 });
    expect(countUnreadHoles(records)).toBe(1);
    expect(markdown).toContain('Record 2');
  });

  it('returns null for an empty selection (縮退の出口: 偽成功にしない)', () => {
    expect(buildResearchReportMarkdown([], { title: 't', now: 1 })).toBeNull();
  });
});

describe('buildReportFilename', () => {
  it('builds a date-timed research filename', () => {
    const name = buildReportFilename(new Date(2026, 9, 23, 9, 5).getTime());
    expect(name).toBe('research-2026-10-23-0905.md');
  });
});

describe('createResearchReportGenerator — BDD (レポートが生成される / 送り先に届く)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches the selection, builds the report and downloads it', async () => {
    const deps = makeDeps();
    const generator = createResearchReportGenerator(deps);
    const outcome = await generator.generate({ scope: { search: 'rust' } });
    // The panel conditions pick the selection rows (text + oldest-first + cap).
    expect(deps.sqliteClient.query).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'rust', orderBy: 'created_at', orderDir: 'ASC', limit: REPORT_MAX_RECORDS }),
    );
    expect(outcome.success).toBe(true);
    expect(outcome).toEqual({ success: true, recordCount: 2, deliveredTo: ['download'] });
    expect(deps.downloadMarkdown).toHaveBeenCalledTimes(1);
    expect(deps.obsidian.appendToDailyNote).not.toHaveBeenCalled();
  });

  it('sends to Obsidian when requested and reports both deliveries', async () => {
    const deps = makeDeps();
    const generator = createResearchReportGenerator(deps);
    const outcome = await generator.generate({ scope: {}, sendToObsidian: true });
    expect(deps.obsidian.appendToDailyNote).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({ success: true, recordCount: 2, deliveredTo: ['download', 'obsidian'] });
  });

  it('fails with a reason instead of a fake success when nothing matches', async () => {
    const deps = makeDeps({
      sqliteClient: { query: vi.fn().mockResolvedValue({ success: true, data: { rows: [], total: 0 } }) },
    });
    const generator = createResearchReportGenerator(deps);
    const outcome = await generator.generate({ scope: {} });
    expect(outcome).toEqual({ success: false, error: 'no_records' });
    expect(deps.downloadMarkdown).not.toHaveBeenCalled();
  });

  it('surfaces a fetch failure instead of generating an empty report', async () => {
    const deps = makeDeps({
      sqliteClient: { query: vi.fn().mockResolvedValue({ success: false, error: { message: 'db locked' } }) },
    });
    const generator = createResearchReportGenerator(deps);
    const outcome = await generator.generate({ scope: {} });
    expect(outcome).toEqual({ success: false, error: 'db locked' });
  });

  it('passes an Obsidian delivery failure through with a reason (再送ができる)', async () => {
    const deps = makeDeps({
      obsidian: { appendToDailyNote: vi.fn().mockRejectedValue(new Error('obsidian down')) },
    });
    const generator = createResearchReportGenerator(deps);
    const outcome = await generator.generate({ scope: {}, sendToObsidian: true });
    expect(outcome).toEqual({ success: false, error: 'obsidian_delivery_failed' });
  });

  it('fails when the download path itself fails', async () => {
    const deps = makeDeps({ downloadMarkdown: vi.fn().mockResolvedValue(false) });
    const generator = createResearchReportGenerator(deps);
    const outcome = await generator.generate({ scope: {} });
    expect(outcome).toEqual({ success: false, error: 'download_failed' });
  });

  it('pins REPORT_MAX_RECORDS to the shared batch-read cap (no magic-number drift)', async () => {
    expect(REPORT_MAX_RECORDS).toBe(MAX_BATCH_READ_RECORDS);
  });

  it('honors the cap on a wide selection instead of failing (大量選択の境界)', async () => {
    const capped = Array.from({ length: REPORT_MAX_RECORDS }, (_, i) => makeRecord(i + 1));
    const deps = makeDeps({
      sqliteClient: {
        query: vi.fn().mockResolvedValue({ success: true, data: { rows: capped, total: capped.length + 50 } }),
      },
    });
    const generator = createResearchReportGenerator(deps);
    const outcome = await generator.generate({ scope: {} });
    expect(deps.sqliteClient.query).toHaveBeenCalledWith(expect.objectContaining({ limit: REPORT_MAX_RECORDS }));
    // The selection wider than the cap is bounded, not rejected (偽成功にしない
    // applies to failures — a capped report is still a complete report).
    expect(outcome).toEqual({ success: true, recordCount: REPORT_MAX_RECORDS, deliveredTo: ['download'] });
  });
});

describe('buildResearchReportMarkdown — V2 annotation (PBI 2026-11-02-04)', () => {
  it('shows the excluded count and the truncation note only when set', () => {
    const records = [makeRecord(1)];
    const plain = buildResearchReportMarkdown(records, { title: 't', now: 1 });
    expect(plain).not.toContain('除外');
    expect(plain).not.toContain('先頭200件');
    const annotated = buildResearchReportMarkdown(records, {
      title: 't',
      now: 1,
      excludedCount: 2,
      truncated: true,
    });
    expect(annotated).toContain('除外: 2');
    expect(annotated).toContain('先頭200件');
  });
});

describe('createResearchReportGenerator — V2 UNION semantics (PBI 2026-11-02-04)', () => {
  function dbRow(id: number): Record<string, unknown> {
    return {
      id,
      title: `Record ${id}`,
      url: `https://example${id}.com/page`,
      created_at: 1700000000000 + id * 1000,
      summary: `Summary ${id}`,
    };
  }

  // Routes clause queries by text and ids queries by id list; id 999 never
  // resolves (stands in for a deleted pin).
  function makeRoutingDeps(clauseRows: Record<string, number[]>): GeneratorMocks {
    return makeDeps({
      sqliteClient: {
        query: vi.fn(async (q: Record<string, unknown>) => {
          if (Array.isArray(q['ids'])) {
            const ids = (q['ids'] as number[]).filter((id) => id !== 999);
            return { success: true, data: { rows: ids.map(dbRow), total: ids.length } };
          }
          const rows = (clauseRows[String(q['text'] ?? '')] ?? []).map(dbRow);
          return { success: true, data: { rows, total: rows.length } };
        }),
      },
    });
  }

  it('unions both OR clause results with dedup (no silent narrowing to the first clause)', async () => {
    const deps = makeRoutingDeps({ alpha: [1, 2], beta: [2, 3] });
    const generator = createResearchReportGenerator(deps);
    const outcome = await generator.generate({
      scope: { op: 'or', clauses: [{ search: 'alpha' }, { search: 'beta' }] },
    });
    expect(outcome).toEqual({ success: true, recordCount: 3, deliveredTo: ['download'] });
    // Fan-out per clause plus the single final rows fetch.
    expect(deps.sqliteClient.query).toHaveBeenCalledTimes(3);
    expect(deps.sqliteClient.query).toHaveBeenLastCalledWith({
      ids: [1, 2, 3],
      orderBy: 'created_at',
      orderDir: 'ASC',
      limit: REPORT_MAX_RECORDS,
    });
  });

  it('intersects AND clause results before the final fetch', async () => {
    const deps = makeRoutingDeps({ alpha: [1, 2], beta: [2, 3] });
    const generator = createResearchReportGenerator(deps);
    const outcome = await generator.generate({
      scope: { op: 'and', clauses: [{ search: 'alpha' }, { search: 'beta' }] },
    });
    expect(outcome).toEqual({ success: true, recordCount: 1, deliveredTo: ['download'] });
    expect(deps.sqliteClient.query).toHaveBeenLastCalledWith({
      ids: [2],
      orderBy: 'created_at',
      orderDir: 'ASC',
      limit: REPORT_MAX_RECORDS,
    });
  });

  it('keeps an AND match at position 250 past the per-clause window (large-AND)', async () => {
    // Clause alpha matches 250 ids; the only intersecting id sits at position
    // 250. A per-clause 200 cap would drop it before the intersect runs and
    // the report would narrow to no_records. The mock honors limit like the
    // real backends (QUERY_CAPS clamp), so this fails without the raised AND
    // window and passes with it.
    const many = Array.from({ length: 250 }, (_, i) => i + 1);
    const query = vi.fn(async (q: Record<string, unknown>) => {
      if (Array.isArray(q['ids'])) {
        const ids = (q['ids'] as number[]).filter((id) => id !== 999);
        return { success: true, data: { rows: ids.map(dbRow), total: ids.length } };
      }
      const all = q['text'] === 'alpha' ? many : q['text'] === 'beta' ? [250] : [];
      const limit = typeof q['limit'] === 'number' ? q['limit'] : all.length;
      const rows = all.slice(0, limit).map(dbRow);
      return { success: true, data: { rows, total: all.length } };
    });
    const deps = makeDeps({ sqliteClient: { query } });
    const generator = createResearchReportGenerator(deps);
    const outcome = await generator.generate({
      scope: { op: 'and', clauses: [{ search: 'alpha' }, { search: 'beta' }] },
    });
    expect(deps.sqliteClient.query).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ text: 'alpha', limit: AND_CLAUSE_WINDOW }),
    );
    expect(outcome).toEqual({ success: true, recordCount: 1, deliveredTo: ['download'] });
    expect(deps.sqliteClient.query).toHaveBeenLastCalledWith({
      ids: [250],
      orderBy: 'created_at',
      orderDir: 'ASC',
      limit: REPORT_MAX_RECORDS,
    });
  });

  it('adds pinned ids to the clause results and excludes deleted pins with a count (never errors on missing)', async () => {
    const deps = makeRoutingDeps({ alpha: [1] });
    const generator = createResearchReportGenerator(deps);
    const outcome = await generator.generate({ scope: { search: 'alpha', ids: [3, 999] } });
    // UNION([1], [3, 999]) resolves to rows 1 and 3; pin 999 is deleted.
    expect(outcome).toEqual({ success: true, recordCount: 2, deliveredTo: ['download'] });
    const content = deps.downloadMarkdown.mock.calls[0]?.[0] as string;
    expect(content).toContain('除外: 1');
  });

  it('caps the union at the first 200 and marks the truncation', async () => {
    const deps = makeRoutingDeps({});
    const generator = createResearchReportGenerator(deps);
    const ids = Array.from({ length: REPORT_MAX_RECORDS + 10 }, (_, i) => i + 1);
    const outcome = await generator.generate({ scope: { ids } });
    expect(outcome).toEqual({ success: true, recordCount: REPORT_MAX_RECORDS, deliveredTo: ['download'] });
    const finalCall = deps.sqliteClient.query.mock.calls[0]?.[0] as Record<string, unknown>;
    expect((finalCall['ids'] as number[])).toHaveLength(REPORT_MAX_RECORDS);
    const content = deps.downloadMarkdown.mock.calls[0]?.[0] as string;
    expect(content).toContain('先頭200件');
  });

  it('returns no_records when clauses match nothing and no pins exist', async () => {
    const deps = makeRoutingDeps({});
    const generator = createResearchReportGenerator(deps);
    const outcome = await generator.generate({
      scope: { op: 'or', clauses: [{ search: 'nothing' }] },
    });
    expect(outcome).toEqual({ success: false, error: 'no_records' });
    expect(deps.downloadMarkdown).not.toHaveBeenCalled();
  });

  it('surfaces a clause fetch failure instead of generating', async () => {
    const deps = makeDeps({
      sqliteClient: { query: vi.fn().mockResolvedValue({ success: false, error: { message: 'db locked' } }) },
    });
    const generator = createResearchReportGenerator(deps);
    const outcome = await generator.generate({
      scope: { op: 'or', clauses: [{ search: 'alpha' }, { search: 'beta' }] },
    });
    expect(outcome).toEqual({ success: false, error: 'db locked' });
    expect(deps.downloadMarkdown).not.toHaveBeenCalled();
  });
});
