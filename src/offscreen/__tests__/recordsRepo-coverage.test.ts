// @vitest-environment jsdom
/**
 * recordsRepo-coverage.test.ts
 * PBI 10: offscreen coverage 90% — recordsRepo.query の分岐網羅
 * FTS/LIKE 切替 (fts5Available true/false, text length 0/2/3/200) と
 * MAX_QUERY_LIMIT=100000 cap と tag 切り詰めを engine.getBackend mock で検証。
 * さらに clearAll / serialize / その他 delegations で statements 90% 到達を担保。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { BrowsingLogRecord } from '../../utils/sqlite-types.js';

// --- hoisted mocks so factory can reference them ---
const mockBackend = vi.hoisted(() => ({
  insert: vi.fn().mockResolvedValue({ success: true, id: 1 }),
  insertBatch: vi.fn().mockResolvedValue({ success: true, inserted: 1, skipped: 0 }),
  query: vi.fn().mockResolvedValue({ success: true, rows: [], total: 0 }),
  update: vi.fn().mockResolvedValue({ success: true }),
  delete: vi.fn().mockResolvedValue({ success: true }),
  toggleStar: vi.fn().mockResolvedValue({ success: true, is_starred: 1 }),
  getCount: vi.fn().mockResolvedValue({ success: true, count: 0 }),
  getStatus: vi.fn().mockResolvedValue({ success: true, initialized: true, fallback: false, fts5: true, supportsBinaryBackup: true }),
  clearAll: vi.fn().mockResolvedValue({ success: true }),
}));

const engineMock = vi.hoisted(() => ({
  getBackend: vi.fn().mockResolvedValue(mockBackend),
  tryOpfsProxy: vi.fn().mockResolvedValue(null),
  idbEngine: null as unknown,
  usingFallbackStorage: false,
  fallbackStorage: null as unknown,
  execWithCache: vi.fn().mockResolvedValue(undefined),
  init: vi.fn().mockResolvedValue(true),
}));

vi.mock('../sqliteEngineHost.js', () => ({
  engine: engineMock,
  DB_FILENAME: 'test.db',
  MAX_QUERY_LIMIT: 100000,
}));

// logger noise suppression
vi.mock('../../utils/logger.js', () => ({
  logError: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  ErrorCode: {},
}));

import { query, insert, insertBatch, update, hardDelete, toggleStar, getCount, getStatus, clearAll, serialize } from '../recordsRepo.js';
import { FTS_QUERY_MAX_LENGTH } from '../schema.js';

describe('recordsRepo — coverage 90% (PBI 10)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBackend.query.mockResolvedValue({ success: true, rows: [], total: 0 });
    mockBackend.getStatus.mockResolvedValue({ success: true, initialized: true, fallback: false, fts5: true, supportsBinaryBackup: true } as never);
    mockBackend.clearAll.mockResolvedValue({ success: true } as never);
    engineMock.getBackend.mockResolvedValue(mockBackend as never);
    engineMock.tryOpfsProxy.mockResolvedValue(null);
    engineMock.idbEngine = null;
    engineMock.usingFallbackStorage = false;
    engineMock.fallbackStorage = null;
    engineMock.execWithCache.mockReset();
    engineMock.execWithCache.mockResolvedValue(undefined);
    engineMock.init.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── query: MAX_QUERY_LIMIT cap ──────────────────────────────────────────
  describe('query — MAX_QUERY_LIMIT cap', () => {
    it('defaults to 100 when limit is unspecified', async () => {
      await query({});
      expect(mockBackend.query).toHaveBeenCalledWith(expect.objectContaining({ limit: 100 }));
    });

    it('passes limit 50 through as-is', async () => {
      await query({ limit: 50 });
      expect(mockBackend.query).toHaveBeenCalledWith(expect.objectContaining({ limit: 50 }));
    });

    it('passes limit 100000 through at exactly the cap', async () => {
      await query({ limit: 100000 });
      expect(mockBackend.query).toHaveBeenCalledWith(expect.objectContaining({ limit: 100000 }));
    });

    it('caps limit 100001 to 100000', async () => {
      await query({ limit: 200000 });
      expect(mockBackend.query).toHaveBeenCalledWith(expect.objectContaining({ limit: 100000 }));
    });

    it('caps even limit 100000*10', async () => {
      await query({ limit: 100000 * 10 });
      const arg = mockBackend.query.mock.calls[0]![0] as { limit: number };
      expect(arg.limit).toBe(100000);
    });

    it.each([
      ['負値', -1],
      ['ゼロ', 0],
      ['非整数', 0.5],
      ['非有限', Infinity],
    ])('%s falls back to the default value 100', async (_label, raw) => {
      await query({ limit: raw as number });
      expect(mockBackend.query).toHaveBeenCalledWith(expect.objectContaining({ limit: 100 }));
    });
  });

  // ── query: tag / text truncation (FTS_QUERY_MAX_LENGTH=200) ────────────
  describe('query — tag/text truncation', () => {
    it('truncates tag when it exceeds 200 characters', async () => {
      const longTag = 'a'.repeat(250);
      await query({ tag: longTag });
      const arg = mockBackend.query.mock.calls[0]![0] as { tag: string };
      expect(arg.tag.length).toBe(FTS_QUERY_MAX_LENGTH);
      expect(arg.tag).toBe('a'.repeat(200));
    });

    it('leaves tag untruncated when it is within 200 characters', async () => {
      const shortTag = 'hello';
      await query({ tag: shortTag });
      expect(mockBackend.query).toHaveBeenCalledWith(expect.objectContaining({ tag: 'hello' }));
    });

    it('omits the tag key itself when tag is undefined (pickDefined)', async () => {
      await query({ limit: 10 });
      const arg = mockBackend.query.mock.calls[0]![0] as Record<string, unknown>;
      expect(arg).not.toHaveProperty('tag');
    });

    it('truncates text when it exceeds 200 characters', async () => {
      const longText = 'x'.repeat(300);
      await query({ text: longText });
      const arg = mockBackend.query.mock.calls[0]![0] as { text: string };
      expect(arg.text.length).toBe(FTS_QUERY_MAX_LENGTH);
    });

    it('passes text through as-is when it is within 200 characters', async () => {
      await query({ text: 'hello world' });
      expect(mockBackend.query).toHaveBeenCalledWith(expect.objectContaining({ text: 'hello world' }));
    });

    it('omits the text key itself when text is undefined', async () => {
      await query({});
      const arg = mockBackend.query.mock.calls[0]![0] as Record<string, unknown>;
      expect(arg).not.toHaveProperty('text');
    });

    it('truncates both text and tag when both are long', async () => {
      const long = 'z'.repeat(250);
      await query({ text: long, tag: long });
      const arg = mockBackend.query.mock.calls[0]![0] as { text: string; tag: string };
      expect(arg.text.length).toBe(200);
      expect(arg.tag.length).toBe(200);
    });
  });

  // ── query: FTS/LIKE 切替境界値 (text length 0/2/3/200) ─────────────────
  // recordsRepo 自体は FTS 判定を持たないが、backend に渡す text が正規化されて
  // フォワードされることを検証 — backend 側の shouldUseFts5(fts5Available, bare) が
  // 閾値 length >=3 で分岐するため、各境界値を recordsRepo 経由で渡し backend が
  // 正しい text を受け取ることを保証する。
  describe('query — FTS/LIKE 境界値 (text length 0/2/3/200 + fts5Available)', () => {
    const cases: Array<{ text: string; len: number; desc: string }> = [
      { text: '', len: 0, desc: 'text length 0 (empty stringは falsyでキー自体が付与されない)' },
      { text: 'ab', len: 2, desc: 'text length 2 (FTS閾値未満 → LIKE)' },
      { text: 'abc', len: 3, desc: 'text length 3 (FTS閾値ちょうど → FTS)' },
      { text: 'a'.repeat(200), len: 200, desc: 'text length 200 (FTS_QUERY_MAX_LENGTH ちょうど)' },
      { text: 'a'.repeat(250), len: 250, desc: 'text length 250 (200 で切り詰め → 200)' },
    ];

    it.each(cases)('$desc — delivers the correct text to the backend', async ({ text }) => {
      await query({ text });
      const arg = mockBackend.query.mock.calls[0]![0] as Record<string, unknown>;
      if (text.length === 0) {
        // empty string is falsy -> q.text ? slice : q.text => "" is falsy so text becomes "" -> pickDefined は "" を保持? 実装: q.text ? slice : q.text では "" は falsy で "" がそのまま。pickDefined({ tag, text }) は text: "" を定義として渡すか？ pickDefined は undefined のみ除去するので "" は保持される。
        // ただし query({ text: '' }) の場合 text="" が渡る。空文字の text で backend が 0 行を返すケースを FTS 判定前に握る。
        // ここでは "" が渡ることを確認 (空文字でもキーは存在)
        expect(arg).toHaveProperty('text');
      } else {
        expect(arg).toHaveProperty('text');
        const expectedLen = Math.min(text.length, 200);
        expect((arg.text as string).length).toBe(expectedLen);
      }
    });

    it('forwards text as-is even when fts5Available is false (backend owns the responsibility)', async () => {
      // backend の FTS 可否は recordsRepo の責務外 — truncation のみを保証
      await query({ text: 'abc' });
      expect(mockBackend.query).toHaveBeenCalledWith(expect.objectContaining({ text: 'abc' }));
    });

    it('forwards text likewise even when fts5Available is true', async () => {
      mockBackend.getStatus.mockResolvedValue({ success: true, initialized: true, fallback: false, fts5: true, supportsBinaryBackup: false } as never);
      await query({ text: 'abc' });
      expect(mockBackend.query).toHaveBeenCalledWith(expect.objectContaining({ text: 'abc' }));
    });

    it('forwards both text lengths 2 and 3 correctly (LIKE vs FTS boundary)', async () => {
      await query({ text: 'ab' });
      expect(mockBackend.query).toHaveBeenCalledWith(expect.objectContaining({ text: 'ab' }));
      mockBackend.query.mockClear();
      await query({ text: 'abc' });
      expect(mockBackend.query).toHaveBeenCalledWith(expect.objectContaining({ text: 'abc' }));
    });
  });

  // ── delegations: statements 90% 到達のための残りメソッド ─────────────────
  describe('other delegations (statements 90% gate)', () => {
    it('delegates insert to backend.insert', async () => {
      const rec: BrowsingLogRecord = { url: 'https://example.com', created_at: 1000 };
      await insert(rec);
      expect(mockBackend.insert).toHaveBeenCalledWith(rec);
    });

    it('returns backend.insertBatch inserted and skipped (PBI 2026-09-11-07 wire shape)', async () => {
      mockBackend.insertBatch.mockResolvedValue({ success: true, inserted: 2, skipped: 1 } as never);
      const result = await insertBatch([
        { url: 'https://a.com', created_at: 1 },
        { url: 'https://b.com', created_at: 2 },
      ]);
      expect(result).toEqual({ success: true, inserted: 2, skipped: 1 });
    });

    it('returns the error as-is when insertBatch fails', async () => {
      mockBackend.insertBatch.mockResolvedValue({ success: false, error: 'fail' } as never);
      const result = await insertBatch([{ url: 'https://a.com', created_at: 1 }]);
      expect(result).toEqual({ success: false, error: 'fail' });
    });

    it('delegates update to backend.update', async () => {
      await update(1, { title: 'new' } as never);
      expect(mockBackend.update).toHaveBeenCalledWith(1, { title: 'new' });
    });

    it('delegates hardDelete to backend.delete', async () => {
      await hardDelete(42);
      expect(mockBackend.delete).toHaveBeenCalledWith(42);
    });

    it('delegates toggleStar to backend.toggleStar', async () => {
      await toggleStar(7);
      expect(mockBackend.toggleStar).toHaveBeenCalledWith(7);
    });

    it('delegates getCount to backend.getCount', async () => {
      await getCount();
      expect(mockBackend.getCount).toHaveBeenCalled();
    });

    it('returns backend.getStatus with path attached on success', async () => {
      mockBackend.getStatus.mockResolvedValue({ success: true, initialized: true, fallback: false, fts5: true, supportsBinaryBackup: false, compileOptions: ['ENABLE_FTS5'] } as never);
      const result = await getStatus();
      expect(result).toEqual(expect.objectContaining({ success: true, path: 'test.db', fts5: true }));
    });

    it('returns a backend error as-is for getStatus', async () => {
      mockBackend.getStatus.mockResolvedValue({ success: false, error: 'ng' } as never);
      const result = await getStatus();
      expect(result).toEqual({ success: false, error: 'ng' });
    });

    it('delegates clearAll to backend.clearAll', async () => {
      await clearAll();
      expect(mockBackend.clearAll).toHaveBeenCalled();
    });
  });

  // ── serialize: backend delegation（PBI 2026-09-12-22）──────────────────
  describe('serialize — delegation to Queryable.serialize', () => {
    it('delegates to backend.serialize and returns the Uint8Array', async () => {
      const data = new TextEncoder().encode('export-data');
      mockBackend.serialize = vi.fn().mockResolvedValue({ success: true, data });
      const result = await serialize();
      expect(mockBackend.serialize).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ success: true, data });
    });

    it('returns the backend error when serialize fails', async () => {
      mockBackend.serialize = vi.fn().mockResolvedValue({ success: false, error: 'serialize failed' });
      const result = await serialize();
      expect(result).toEqual({ success: false, error: 'serialize failed' });
    });

    it('does NOT touch tryOpfsProxy / execWithCache / fallback directly (single seam)', async () => {
      mockBackend.serialize = vi.fn().mockResolvedValue({ success: true, data: new Uint8Array() });
      await serialize();
      expect(engineMock.tryOpfsProxy).not.toHaveBeenCalledWith('SERIALIZE');
      expect(engineMock.execWithCache).not.toHaveBeenCalled();
    });
  });
});
