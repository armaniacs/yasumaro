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
  REPORT_MAX_RECORDS,
  type ResearchReportGeneratorDeps,
  type ResearchReportRecord,
} from '../researchReportGenerator.js';

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
});
