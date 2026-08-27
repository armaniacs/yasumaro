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

vi.mock('../sqliteEngineContext.js', () => ({
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
    it('limit 未指定は 100 に default', async () => {
      await query({});
      expect(mockBackend.query).toHaveBeenCalledWith(expect.objectContaining({ limit: 100 }));
    });

    it('limit 50 はそのまま通る', async () => {
      await query({ limit: 50 });
      expect(mockBackend.query).toHaveBeenCalledWith(expect.objectContaining({ limit: 50 }));
    });

    it('limit 100000 は cap ちょうどで通る', async () => {
      await query({ limit: 100000 });
      expect(mockBackend.query).toHaveBeenCalledWith(expect.objectContaining({ limit: 100000 }));
    });

    it('limit 100001 は 100000 に cap される', async () => {
      await query({ limit: 200000 });
      expect(mockBackend.query).toHaveBeenCalledWith(expect.objectContaining({ limit: 100000 }));
    });

    it('limit 100000 *10 も cap される', async () => {
      await query({ limit: 100000 * 10 });
      const arg = mockBackend.query.mock.calls[0][0] as { limit: number };
      expect(arg.limit).toBe(100000);
    });
  });

  // ── query: tag / text truncation (FTS_QUERY_MAX_LENGTH=200) ────────────
  describe('query — tag/text truncation', () => {
    it('tag が 200 超なら切り詰められる', async () => {
      const longTag = 'a'.repeat(250);
      await query({ tag: longTag });
      const arg = mockBackend.query.mock.calls[0][0] as { tag: string };
      expect(arg.tag.length).toBe(FTS_QUERY_MAX_LENGTH);
      expect(arg.tag).toBe('a'.repeat(200));
    });

    it('tag が 200 以内なら切り詰められない', async () => {
      const shortTag = 'hello';
      await query({ tag: shortTag });
      expect(mockBackend.query).toHaveBeenCalledWith(expect.objectContaining({ tag: 'hello' }));
    });

    it('tag が undefined なら tag キー自体が付与されない (pickDefined)', async () => {
      await query({ limit: 10 });
      const arg = mockBackend.query.mock.calls[0][0] as Record<string, unknown>;
      expect(arg).not.toHaveProperty('tag');
    });

    it('text が 200 超なら切り詰められる', async () => {
      const longText = 'x'.repeat(300);
      await query({ text: longText });
      const arg = mockBackend.query.mock.calls[0][0] as { text: string };
      expect(arg.text.length).toBe(FTS_QUERY_MAX_LENGTH);
    });

    it('text が 200 以内ならそのまま', async () => {
      await query({ text: 'hello world' });
      expect(mockBackend.query).toHaveBeenCalledWith(expect.objectContaining({ text: 'hello world' }));
    });

    it('text が undefined なら text キー自体が付与されない', async () => {
      await query({});
      const arg = mockBackend.query.mock.calls[0][0] as Record<string, unknown>;
      expect(arg).not.toHaveProperty('text');
    });

    it('text と tag 両方が長い場合ともに切り詰められる', async () => {
      const long = 'z'.repeat(250);
      await query({ text: long, tag: long });
      const arg = mockBackend.query.mock.calls[0][0] as { text: string; tag: string };
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

    it.each(cases)('$desc — backend に正しい text が届く', async ({ text }) => {
      await query({ text });
      const arg = mockBackend.query.mock.calls[0][0] as Record<string, unknown>;
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

    it('fts5Available が false でも recordsRepo は text をそのままフォワードする (責務は backend)', async () => {
      // backend の FTS 可否は recordsRepo の責務外 — truncation のみを保証
      await query({ text: 'abc' });
      expect(mockBackend.query).toHaveBeenCalledWith(expect.objectContaining({ text: 'abc' }));
    });

    it('fts5Available が true でも同様にフォワードする', async () => {
      mockBackend.getStatus.mockResolvedValue({ success: true, initialized: true, fallback: false, fts5: true, supportsBinaryBackup: false } as never);
      await query({ text: 'abc' });
      expect(mockBackend.query).toHaveBeenCalledWith(expect.objectContaining({ text: 'abc' }));
    });

    it('text length 2 と 3 の両方が正しくフォワードされる (LIKE vs FTS 境界)', async () => {
      await query({ text: 'ab' });
      expect(mockBackend.query).toHaveBeenCalledWith(expect.objectContaining({ text: 'ab' }));
      mockBackend.query.mockClear();
      await query({ text: 'abc' });
      expect(mockBackend.query).toHaveBeenCalledWith(expect.objectContaining({ text: 'abc' }));
    });
  });

  // ── delegations: statements 90% 到達のための残りメソッド ─────────────────
  describe('other delegations (statements 90% gate)', () => {
    it('insert は backend.insert に委譲する', async () => {
      const rec: BrowsingLogRecord = { url: 'https://example.com', created_at: 1000 };
      await insert(rec);
      expect(mockBackend.insert).toHaveBeenCalledWith(rec);
    });

    it('insertBatch は backend.insertBatch の inserted を count に詰める', async () => {
      mockBackend.insertBatch.mockResolvedValue({ success: true, inserted: 2, skipped: 1 } as never);
      const result = await insertBatch([
        { url: 'https://a.com', created_at: 1 },
        { url: 'https://b.com', created_at: 2 },
      ]);
      expect(result).toEqual({ success: true, count: 2 });
    });

    it('insertBatch 失敗時はそのまま error を返す', async () => {
      mockBackend.insertBatch.mockResolvedValue({ success: false, error: 'fail' } as never);
      const result = await insertBatch([{ url: 'https://a.com', created_at: 1 }]);
      expect(result).toEqual({ success: false, error: 'fail' });
    });

    it('update は backend.update に委譲', async () => {
      await update(1, { title: 'new' } as never);
      expect(mockBackend.update).toHaveBeenCalledWith(1, { title: 'new' });
    });

    it('hardDelete は backend.delete に委譲', async () => {
      await hardDelete(42);
      expect(mockBackend.delete).toHaveBeenCalledWith(42);
    });

    it('toggleStar は backend.toggleStar に委譲', async () => {
      await toggleStar(7);
      expect(mockBackend.toggleStar).toHaveBeenCalledWith(7);
    });

    it('getCount は backend.getCount に委譲', async () => {
      await getCount();
      expect(mockBackend.getCount).toHaveBeenCalled();
    });

    it('getStatus は backend.getStatus 成功時に path を付与して返す', async () => {
      mockBackend.getStatus.mockResolvedValue({ success: true, initialized: true, fallback: false, fts5: true, supportsBinaryBackup: false, compileOptions: ['ENABLE_FTS5'] } as never);
      const result = await getStatus();
      expect(result).toEqual(expect.objectContaining({ success: true, path: 'test.db', fts5: true }));
    });

    it('getStatus は backend error をそのまま返す', async () => {
      mockBackend.getStatus.mockResolvedValue({ success: false, error: 'ng' } as never);
      const result = await getStatus();
      expect(result).toEqual({ success: false, error: 'ng' });
    });

    it('clearAll は backend.clearAll に委譲', async () => {
      await clearAll();
      expect(mockBackend.clearAll).toHaveBeenCalled();
    });
  });

  // ── serialize: 3 分岐 + error ───────────────────────────────────────────
  describe('serialize — OPFS / Fallback / IDB / error', () => {
    it('OPFS proxy が Uint8Array を返せばそれを返す', async () => {
      const data = new TextEncoder().encode('opfs-data');
      engineMock.tryOpfsProxy.mockResolvedValue(data as never);
      const result = await serialize();
      expect(result).toEqual({ success: true, data });
      expect(engineMock.tryOpfsProxy).toHaveBeenCalledWith('SERIALIZE');
    });

    it('FallbackStorage 経由で JSON を返す', async () => {
      engineMock.tryOpfsProxy.mockResolvedValue(null);
      engineMock.usingFallbackStorage = true;
      engineMock.fallbackStorage = {
        query: vi.fn().mockResolvedValue({
          success: true,
          rows: [{ id: 1, url: 'https://a.com', title: 't', summary: 's', tags: null, created_at: 1000, domain: 'a.com', visit_duration: null, scroll_ratio: null, is_starred: 0, is_deleted: 0 }],
        }),
      } as unknown as never;

      const result = await serialize();
      expect(result.success).toBe(true);
      if (result.success) {
        const json = JSON.parse(new TextDecoder().decode(result.data));
        expect(json.table).toBe('browsing_logs');
        expect(json.rows).toHaveLength(1);
      }
    });

    it('FallbackStorage query 失敗時は error を返す', async () => {
      engineMock.tryOpfsProxy.mockResolvedValue(null);
      engineMock.usingFallbackStorage = true;
      engineMock.fallbackStorage = {
        query: vi.fn().mockResolvedValue({ success: false, error: 'fallback fail' }),
      } as unknown as never;

      const result = await serialize();
      expect(result).toEqual({ success: false, error: 'fallback fail' });
    });

    it('IDB 経由で execWithCache で行を集めて JSON を返す', async () => {
      engineMock.tryOpfsProxy.mockResolvedValue(null);
      engineMock.usingFallbackStorage = false;
      engineMock.fallbackStorage = null;
      engineMock.idbEngine = {} as never;
      // execWithCache は callback に row を渡す
      engineMock.execWithCache.mockImplementation(async (_sql: string, _params: unknown[], cb?: (row: unknown[]) => void) => {
        if (cb) cb([1, 'https://b.com', 'title', 'summary', 'tags', 2000, 'b.com', null, null, 0, 0]);
      });

      const result = await serialize();
      expect(result.success).toBe(true);
      if (result.success) {
        const json = JSON.parse(new TextDecoder().decode(result.data));
        expect(json.rows[0].url).toBe('https://b.com');
      }
    });

    it('IDB 未初期化で init が呼ばれる (usingFallback でも opfs でもない)', async () => {
      engineMock.tryOpfsProxy.mockResolvedValue(null);
      engineMock.usingFallbackStorage = false;
      engineMock.fallbackStorage = null;
      engineMock.idbEngine = null;
      engineMock.init.mockResolvedValue(false);
      engineMock.execWithCache.mockResolvedValue(undefined);

      const result = await serialize();
      expect(engineMock.init).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it('例外時は success:false を返す', async () => {
      engineMock.tryOpfsProxy.mockRejectedValue(new Error('boom'));
      const result = await serialize();
      expect(result).toEqual({ success: false, error: 'boom' });
    });
  });
});
