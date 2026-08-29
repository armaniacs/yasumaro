// @vitest-environment jsdom
/**
 * sqliteMessageHandlers-coverage.test.ts
 * Branch coverage gap filler for src/offscreen/sqliteMessageHandlers.ts
 * Target: cover remaining ~67/74 branches (before ~9% with offscreen.test.ts alone).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SqliteMessage } from '../../messaging/sqliteMessages.js';

// ── Hoisted mocks ──────────────────────────────────────────────────────────
const engineMock = vi.hoisted(() => ({
  init: vi.fn().mockResolvedValue(true),
}));

const recordsRepoMock = vi.hoisted(() => ({
  insert: vi.fn().mockResolvedValue({ success: true, id: 1 }),
  insertBatch: vi.fn().mockResolvedValue({ success: true, count: 2 }),
  query: vi.fn().mockResolvedValue({ success: true, rows: [], total: 0 }),
  update: vi.fn().mockResolvedValue({ success: true }),
  hardDelete: vi.fn().mockResolvedValue({ success: true }),
  toggleStar: vi.fn().mockResolvedValue({ success: true, is_starred: 1 }),
  getCount: vi.fn().mockResolvedValue({ success: true, count: 5 }),
  getStatus: vi.fn().mockResolvedValue({ success: true, initialized: true, path: 'test.db', fallback: false, fts5: true }),
  serialize: vi.fn().mockResolvedValue({ success: true, data: new Uint8Array([1, 2, 3]) }),
  clearAll: vi.fn().mockResolvedValue({ success: true }),
}));

const dbMaintenanceMock = vi.hoisted(() => ({
  sqliteHealthCheck: vi.fn().mockResolvedValue(true),
  backupDb: vi.fn().mockResolvedValue({ success: true, data: new Uint8Array([9, 9]) }),
  restoreDb: vi.fn().mockResolvedValue({ success: true }),
  purgeOldRecords: vi.fn().mockResolvedValue({ success: true, purged: 3 }),
  purgeContent: vi.fn().mockResolvedValue({ success: true, purged: 2 }),
}));

const auditLogRepoMock = vi.hoisted(() => ({
  insertAuditLog: vi.fn().mockResolvedValue({ success: true, id: 42 }),
  queryAuditLog: vi.fn().mockResolvedValue({ success: true, rows: [], total: 0 }),
}));

const opfsSpikeMock = vi.hoisted(() => ({
  runOpfsSpikeA: vi.fn().mockResolvedValue({ ok: true, detail: 'spike-report' }),
}));

vi.mock('../sqliteEngineContext.js', () => ({
  engine: engineMock,
}));

vi.mock('../recordsRepo.js', () => ({
  insert: recordsRepoMock.insert,
  insertBatch: recordsRepoMock.insertBatch,
  query: recordsRepoMock.query,
  update: recordsRepoMock.update,
  hardDelete: recordsRepoMock.hardDelete,
  toggleStar: recordsRepoMock.toggleStar,
  getCount: recordsRepoMock.getCount,
  getStatus: recordsRepoMock.getStatus,
  serialize: recordsRepoMock.serialize,
  clearAll: recordsRepoMock.clearAll,
}));

vi.mock('../dbMaintenance.js', () => ({
  sqliteHealthCheck: dbMaintenanceMock.sqliteHealthCheck,
  backupDb: dbMaintenanceMock.backupDb,
  restoreDb: dbMaintenanceMock.restoreDb,
  purgeOldRecords: dbMaintenanceMock.purgeOldRecords,
  purgeContent: dbMaintenanceMock.purgeContent,
}));

vi.mock('../auditLogRepo.js', () => ({
  insertAuditLog: auditLogRepoMock.insertAuditLog,
  queryAuditLog: auditLogRepoMock.queryAuditLog,
}));

vi.mock('../opfsSpike.js', () => opfsSpikeMock);

import { sqliteMessageHandlers } from '../sqliteMessageHandlers.js';
import { StorageKeys } from '../../utils/storage/types.js';

// helper — call handler via Map and collect response
async function callHandler(type: string, payload?: unknown): Promise<unknown> {
  const handler = sqliteMessageHandlers.get(type as never);
  if (!handler) throw new Error(`No handler for ${type}`);
  const msg = { type, payload, traceId: 'trace-1' } as SqliteMessage;
  let response: unknown;
  await handler(msg, (r) => { response = r; });
  return response;
}

describe('sqliteMessageHandlers — registry completeness', () => {
  it('Map contains all 20 SqliteMessageTypes', () => {
    expect(sqliteMessageHandlers.size).toBe(20);
    const expected = [
      'SQLITE_HEALTH_CHECK', 'SQLITE_INIT', 'SQLITE_INSERT', 'SQLITE_INSERT_BATCH',
      'SQLITE_QUERY', 'SQLITE_AUDIT_LOG_INSERT', 'SQLITE_AUDIT_LOG_QUERY',
      'SQLITE_SEARCH', 'SQLITE_UPDATE', 'SQLITE_DELETE', 'SQLITE_TOGGLE_STAR',
      'SQLITE_COUNT', 'SQLITE_STATUS', 'SQLITE_CLEAR_ALL', 'SQLITE_EXPORT',
      'SQLITE_BACKUP', 'SQLITE_RESTORE', 'SQLITE_PURGE', 'CONTENT_PURGE',
      'SQLITE_OPFS_SPIKE',
    ];
    for (const t of expected) {
      expect(sqliteMessageHandlers.has(t as never)).toBe(true);
    }
  });
});

// ── handleHealthCheck / handleInit / handleCount etc (simple) ─────────────
describe('sqliteMessageHandlers — simple handlers', () => {
  beforeEach(() => vi.clearAllMocks());

  it('SQLITE_HEALTH_CHECK returns success true when healthCheck true', async () => {
    dbMaintenanceMock.sqliteHealthCheck.mockResolvedValue(true);
    const res = await callHandler('SQLITE_HEALTH_CHECK') as { success: boolean };
    expect(res.success).toBe(true);
  });

  it('SQLITE_HEALTH_CHECK returns success false when healthCheck false', async () => {
    dbMaintenanceMock.sqliteHealthCheck.mockResolvedValue(false);
    const res = await callHandler('SQLITE_HEALTH_CHECK') as { success: boolean };
    expect(res.success).toBe(false);
  });

  it('SQLITE_INIT returns initialized flag', async () => {
    engineMock.init.mockResolvedValue(true);
    const res = await callHandler('SQLITE_INIT') as { success: boolean; initialized: boolean };
    expect(res.success).toBe(true);
    expect(res.initialized).toBe(true);
  });

  it('SQLITE_INIT returns false when engine init fails', async () => {
    engineMock.init.mockResolvedValue(false);
    const res = await callHandler('SQLITE_INIT') as { success: boolean; initialized: boolean };
    expect(res.success).toBe(false);
    expect(res.initialized).toBe(false);
  });

  it('SQLITE_COUNT forwards getCount', async () => {
    recordsRepoMock.getCount.mockResolvedValue({ success: true, count: 7 });
    const res = await callHandler('SQLITE_COUNT') as { count: number };
    expect((res as { count: number }).count).toBe(7);
  });

  it('SQLITE_CLEAR_ALL forwards clearAll', async () => {
    recordsRepoMock.clearAll.mockResolvedValue({ success: true });
    const res = await callHandler('SQLITE_CLEAR_ALL') as { success: boolean };
    expect(res.success).toBe(true);
  });

  it('SQLITE_EXPORT forwards serialize', async () => {
    const data = new Uint8Array([10, 20]);
    recordsRepoMock.serialize.mockResolvedValue({ success: true, data });
    const res = await callHandler('SQLITE_EXPORT') as { success: boolean; data: Uint8Array };
    expect(res.success).toBe(true);
    expect(res.data).toEqual(data);
  });

  it('SQLITE_DELETE forwards hardDelete with Number(id)', async () => {
    const res = await callHandler('SQLITE_DELETE', { id: '99' });
    expect(recordsRepoMock.hardDelete).toHaveBeenCalledWith(99);
    expect((res as { success: boolean }).success).toBe(true);
  });

  it('SQLITE_TOGGLE_STAR forwards toggleStar with Number(id)', async () => {
    const res = await callHandler('SQLITE_TOGGLE_STAR', { id: 5 });
    expect(recordsRepoMock.toggleStar).toHaveBeenCalledWith(5);
    expect((res as { success: boolean }).success).toBe(true);
  });

  it('SQLITE_OPFS_SPIKE returns report', async () => {
    opfsSpikeMock.runOpfsSpikeA.mockResolvedValue({ spike: 'done' } as never);
    const res = await callHandler('SQLITE_OPFS_SPIKE') as { success: boolean; report: unknown };
    expect(res.success).toBe(true);
    expect(res.report).toEqual({ spike: 'done' });
  });
});

// ── handleInsert ───────────────────────────────────────────────────────────
describe('sqliteMessageHandlers — handleInsert', () => {
  beforeEach(() => vi.clearAllMocks());
  it('builds record from payload and calls insert', async () => {
    const payload = { url: 'https://example.com', title: 't', created_at: 123456 };
    await callHandler('SQLITE_INSERT', payload);
    expect(recordsRepoMock.insert).toHaveBeenCalled();
    const arg = recordsRepoMock.insert.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.url).toBe('https://example.com');
    expect(arg.title).toBe('t');
  });

  it('handles empty payload defaults', async () => {
    await callHandler('SQLITE_INSERT', {});
    const arg = recordsRepoMock.insert.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.url).toBe('');
  });
});

// ── handleInsertBatch — Branch 0: records || [] ───────────────────────────
describe('sqliteMessageHandlers — handleInsertBatch branching', () => {
  beforeEach(() => vi.clearAllMocks());

  it('maps records via buildRecordFromPayload', async () => {
    const records = [{ url: 'https://a.com' }, { url: 'https://b.com', title: 'b' }];
    await callHandler('SQLITE_INSERT_BATCH', { records });
    expect(recordsRepoMock.insertBatch).toHaveBeenCalled();
    const arg = recordsRepoMock.insertBatch.mock.calls[0][0] as unknown[];
    expect(arg).toHaveLength(2);
  });

  it('falls back to [] when records is undefined (payload.records || [])', async () => {
    await callHandler('SQLITE_INSERT_BATCH', {} as never);
    expect(recordsRepoMock.insertBatch).toHaveBeenCalledWith([]);
  });

  it('falls back to [] when payload has no records key', async () => {
    await callHandler('SQLITE_INSERT_BATCH', { records: undefined } as never);
    expect(recordsRepoMock.insertBatch).toHaveBeenCalledWith([]);
  });

  it('handles empty array', async () => {
    await callHandler('SQLITE_INSERT_BATCH', { records: [] });
    expect(recordsRepoMock.insertBatch).toHaveBeenCalledWith([]);
  });
});

// ── handleQuery — branches 1-14 ────────────────────────────────────────────
describe('sqliteMessageHandlers — handleQuery branching', () => {
  beforeEach(() => vi.clearAllMocks());

  it('passes limit/offset/orderBy/orderDir/domain when present', async () => {
    await callHandler('SQLITE_QUERY', {
      limit: '20', offset: '5', orderBy: 'rank', orderDir: 'DESC', domain: 'example.com',
    });
    const opts = recordsRepoMock.query.mock.calls[0][0] as Record<string, unknown>;
    expect(opts.limit).toBe(20);
    expect(opts.offset).toBe(5);
    expect(opts.orderBy).toBe('rank');
    expect(opts.orderDir).toBe('DESC');
    expect(opts.domain).toBe('example.com');
  });

  it('omits limit/offset when null (Number undefined branch)', async () => {
    await callHandler('SQLITE_QUERY', {});
    const opts = recordsRepoMock.query.mock.calls[0][0] as Record<string, unknown>;
    expect(opts).not.toHaveProperty('limit');
    expect(opts).not.toHaveProperty('offset');
  });

  it('covers starred true via Boolean(payload.starred) branch', async () => {
    await callHandler('SQLITE_QUERY', { starred: 1 });
    const opts = recordsRepoMock.query.mock.calls[0][0] as Record<string, unknown>;
    expect(opts.starred).toBe(true);
  });

  it('covers starred via isStarred alias (else branch)', async () => {
    await callHandler('SQLITE_QUERY', { isStarred: 0 });
    const opts = recordsRepoMock.query.mock.calls[0][0] as Record<string, unknown>;
    expect(opts.starred).toBe(false);
  });

  it('covers isStarred 1 truthy branch', async () => {
    await callHandler('SQLITE_QUERY', { isStarred: 1 });
    const opts = recordsRepoMock.query.mock.calls[0][0] as Record<string, unknown>;
    expect(opts.starred).toBe(true);
  });

  it('omits starred when neither starred nor isStarred present (undefined branch)', async () => {
    await callHandler('SQLITE_QUERY', {});
    const opts = recordsRepoMock.query.mock.calls[0][0] as Record<string, unknown>;
    expect(opts).not.toHaveProperty('starred');
  });

  it('covers starred=false via falsy isStarred? ensure Boolean coercion path', async () => {
    // starred is null/undefined but isStarred present as truthy
    await callHandler('SQLITE_QUERY', { starred: null, isStarred: 1 } as never);
    const opts = recordsRepoMock.query.mock.calls[0][0] as Record<string, unknown>;
    // starred != null is false (null), so falls to isStarred branch -> true
    expect(opts.starred).toBe(true);
  });

  it('covers starred = false when starred is 0 (Boolean(0) => false)', async () => {
    await callHandler('SQLITE_QUERY', { starred: 0 });
    const opts = recordsRepoMock.query.mock.calls[0][0] as Record<string, unknown>;
    expect(opts.starred).toBe(false);
  });

  it('covers excludeDeleted boolean branch', async () => {
    await callHandler('SQLITE_QUERY', { excludeDeleted: 1 });
    const opts = recordsRepoMock.query.mock.calls[0][0] as Record<string, unknown>;
    expect(opts.excludeDeleted).toBe(true);
  });

  it('omits excludeDeleted when not present', async () => {
    await callHandler('SQLITE_QUERY', {});
    const opts = recordsRepoMock.query.mock.calls[0][0] as Record<string, unknown>;
    expect(opts).not.toHaveProperty('excludeDeleted');
  });

  it('covers dateFrom via dateFrom present', async () => {
    await callHandler('SQLITE_QUERY', { dateFrom: '1000' });
    const opts = recordsRepoMock.query.mock.calls[0][0] as Record<string, unknown>;
    expect(opts.dateFrom).toBe(1000);
  });

  it('covers dateFrom via since alias', async () => {
    await callHandler('SQLITE_QUERY', { since: '2000' });
    const opts = recordsRepoMock.query.mock.calls[0][0] as Record<string, unknown>;
    expect(opts.dateFrom).toBe(2000);
  });

  it('omits dateFrom when neither present', async () => {
    await callHandler('SQLITE_QUERY', {});
    const opts = recordsRepoMock.query.mock.calls[0][0] as Record<string, unknown>;
    expect(opts).not.toHaveProperty('dateFrom');
  });

  it('covers dateFrom via since when dateFrom is null', async () => {
    await callHandler('SQLITE_QUERY', { dateFrom: null, since: '3000' } as never);
    const opts = recordsRepoMock.query.mock.calls[0][0] as Record<string, unknown>;
    expect(opts.dateFrom).toBe(3000);
  });

  it('covers dateTo via dateTo present', async () => {
    await callHandler('SQLITE_QUERY', { dateTo: '9999' });
    const opts = recordsRepoMock.query.mock.calls[0][0] as Record<string, unknown>;
    expect(opts.dateTo).toBe(9999);
  });

  it('covers dateTo via until alias', async () => {
    await callHandler('SQLITE_QUERY', { until: '8888' });
    const opts = recordsRepoMock.query.mock.calls[0][0] as Record<string, unknown>;
    expect(opts.dateTo).toBe(8888);
  });

  it('covers dateTo via until when dateTo is null', async () => {
    await callHandler('SQLITE_QUERY', { dateTo: null, until: '7777' } as never);
    const opts = recordsRepoMock.query.mock.calls[0][0] as Record<string, unknown>;
    expect(opts.dateTo).toBe(7777);
  });

  it('covers ids array', async () => {
    await callHandler('SQLITE_QUERY', { ids: [1, 2, 3] });
    const opts = recordsRepoMock.query.mock.calls[0][0] as Record<string, unknown>;
    expect(opts.ids).toEqual([1, 2, 3]);
  });

  it('omits ids when not present', async () => {
    await callHandler('SQLITE_QUERY', {});
    const opts = recordsRepoMock.query.mock.calls[0][0] as Record<string, unknown>;
    expect(opts).not.toHaveProperty('ids');
  });

  it('covers tag via tag present', async () => {
    await callHandler('SQLITE_QUERY', { tag: 'hello' });
    const opts = recordsRepoMock.query.mock.calls[0][0] as Record<string, unknown>;
    expect(opts.tag).toBe('hello');
  });

  it('covers tag via tagFilter alias', async () => {
    await callHandler('SQLITE_QUERY', { tagFilter: 'world' });
    const opts = recordsRepoMock.query.mock.calls[0][0] as Record<string, unknown>;
    expect(opts.tag).toBe('world');
  });

  it('covers tag via tagFilter when tag is null', async () => {
    await callHandler('SQLITE_QUERY', { tag: null, tagFilter: 'alias' } as never);
    const opts = recordsRepoMock.query.mock.calls[0][0] as Record<string, unknown>;
    expect(opts.tag).toBe('alias');
  });

  it('omits tag when neither present', async () => {
    await callHandler('SQLITE_QUERY', {});
    const opts = recordsRepoMock.query.mock.calls[0][0] as Record<string, unknown>;
    expect(opts).not.toHaveProperty('tag');
  });

  it('covers gistSynced number', async () => {
    await callHandler('SQLITE_QUERY', { gistSynced: '1' });
    const opts = recordsRepoMock.query.mock.calls[0][0] as Record<string, unknown>;
    expect(opts.gistSynced).toBe(1);
  });

  it('omits gistSynced when null', async () => {
    await callHandler('SQLITE_QUERY', {});
    const opts = recordsRepoMock.query.mock.calls[0][0] as Record<string, unknown>;
    expect(opts).not.toHaveProperty('gistSynced');
  });

  it('covers all aliases together', async () => {
    await callHandler('SQLITE_QUERY', {
      limit: 10, offset: 2, orderBy: 'created_at', orderDir: 'ASC',
      domain: 'x.com', starred: true, excludeDeleted: true,
      dateFrom: 100, dateTo: 200, ids: [9], tag: 't', gistSynced: 0,
    });
    const opts = recordsRepoMock.query.mock.calls[0][0] as Record<string, unknown>;
    expect(opts.limit).toBe(10);
    expect(opts.tag).toBe('t');
  });
});

// ── handleAuditLogInsert — branches 15-17 ──────────────────────────────────
describe('sqliteMessageHandlers — handleAuditLogInsert branching', () => {
  beforeEach(() => vi.clearAllMocks());

  it('converts provider/url/created_at strings', async () => {
    await callHandler('SQLITE_AUDIT_LOG_INSERT', { provider: 'openai', url: 'https://x.com', created_at: 12345 });
    expect(auditLogRepoMock.insertAuditLog).toHaveBeenCalledWith({ provider: 'openai', url: 'https://x.com', created_at: 12345 });
  });

  it('falls back to empty string when provider is falsy (|| branch)', async () => {
    await callHandler('SQLITE_AUDIT_LOG_INSERT', { provider: '', url: 'https://x.com', created_at: 1 });
    const arg = auditLogRepoMock.insertAuditLog.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.provider).toBe('');
  });

  it('falls back when provider missing', async () => {
    await callHandler('SQLITE_AUDIT_LOG_INSERT', { url: 'https://x.com' } as never);
    const arg = auditLogRepoMock.insertAuditLog.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.provider).toBe('');
  });

  it('falls back when url missing', async () => {
    await callHandler('SQLITE_AUDIT_LOG_INSERT', { provider: 'p' } as never);
    const arg = auditLogRepoMock.insertAuditLog.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.url).toBe('');
  });

  it('uses Date.now fallback when created_at falsy (|| branch)', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(999999);
    await callHandler('SQLITE_AUDIT_LOG_INSERT', { provider: 'p', url: 'u', created_at: 0 } as never);
    const arg = auditLogRepoMock.insertAuditLog.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.created_at).toBe(999999);
    nowSpy.mockRestore();
  });

  it('uses numeric created_at when truthy', async () => {
    await callHandler('SQLITE_AUDIT_LOG_INSERT', { provider: 'p', url: 'u', created_at: 555 });
    const arg = auditLogRepoMock.insertAuditLog.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.created_at).toBe(555);
  });
});

// ── handleAuditLogQuery — branches 18-19 ───────────────────────────────────
describe('sqliteMessageHandlers — handleAuditLogQuery branching', () => {
  beforeEach(() => vi.clearAllMocks());

  it('passes limit/offset when defined', async () => {
    await callHandler('SQLITE_AUDIT_LOG_QUERY', { limit: '10', offset: '5' });
    const arg = auditLogRepoMock.queryAuditLog.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.limit).toBe(10);
    expect(arg.offset).toBe(5);
  });

  it('omits limit/offset when null (pickDefined branch)', async () => {
    await callHandler('SQLITE_AUDIT_LOG_QUERY', {});
    const arg = auditLogRepoMock.queryAuditLog.mock.calls[0][0] as Record<string, unknown>;
    expect(arg).not.toHaveProperty('limit');
    expect(arg).not.toHaveProperty('offset');
  });

  it('handles undefined payload', async () => {
    await callHandler('SQLITE_AUDIT_LOG_QUERY', undefined as never);
    const arg = auditLogRepoMock.queryAuditLog.mock.calls[0][0] as Record<string, unknown>;
    expect(arg).not.toHaveProperty('limit');
  });

  it('omits only offset when limit defined but offset null', async () => {
    await callHandler('SQLITE_AUDIT_LOG_QUERY', { limit: 7 });
    const arg = auditLogRepoMock.queryAuditLog.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.limit).toBe(7);
    expect(arg).not.toHaveProperty('offset');
  });
});

// ── handleSearch — branches 20-22 ─────────────────────────────────────────
describe('sqliteMessageHandlers — handleSearch branching', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uses query string and forwards limit/offset/orderBy/orderDir', async () => {
    await callHandler('SQLITE_SEARCH', { query: 'hello', limit: 5, offset: 2, orderBy: 'rank', orderDir: 'ASC' });
    const arg = recordsRepoMock.query.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.text).toBe('hello');
    expect(arg.limit).toBe(5);
    expect(arg.offset).toBe(2);
    expect(arg.orderBy).toBe('rank');
  });

  it('falls back to empty string when query is falsy (|| branch)', async () => {
    await callHandler('SQLITE_SEARCH', { query: '' } as never);
    const arg = recordsRepoMock.query.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.text).toBe('');
  });

  it('falls back to empty when query is undefined (|| branch)', async () => {
    await callHandler('SQLITE_SEARCH', {} as never);
    const arg = recordsRepoMock.query.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.text).toBe('');
  });

  it('omits optional fields when null (pickDefined branches)', async () => {
    await callHandler('SQLITE_SEARCH', { query: 'x' });
    const arg = recordsRepoMock.query.mock.calls[0][0] as Record<string, unknown>;
    expect(arg).not.toHaveProperty('limit');
    expect(arg).not.toHaveProperty('offset');
  });

  it('passes orderBy/orderDir when defined', async () => {
    await callHandler('SQLITE_SEARCH', { query: 'q', orderBy: 'created_at', orderDir: 'DESC' });
    const arg = recordsRepoMock.query.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.orderBy).toBe('created_at');
    expect(arg.orderDir).toBe('DESC');
  });
});

// ── handleUpdate — Branch 23 if (key in payload) ───────────────────────────
describe('sqliteMessageHandlers — handleUpdate branching', () => {
  beforeEach(() => vi.clearAllMocks());

  it('collects only whitelisted keys present in payload', async () => {
    await callHandler('SQLITE_UPDATE', { id: 10, url: 'https://new.com', title: 'new', unknownField: 'ignored' } as never);
    expect(recordsRepoMock.update).toHaveBeenCalledWith(10, { url: 'https://new.com', title: 'new' });
  });

  it('covers false branch for each whitelisted key (key not in payload)', async () => {
    await callHandler('SQLITE_UPDATE', { id: 11 });
    expect(recordsRepoMock.update).toHaveBeenCalledWith(11, {});
  });

  it('covers all whitelisted keys true branch', async () => {
    const payload: Record<string, unknown> = { id: 12 };
    const keys = [
      'url','title','summary','tags','domain','visit_duration','scroll_ratio','is_starred','is_deleted',
      'obsidian_synced','gist_synced','content','masked_count','cleansed_reason','ai_provider','ai_model',
      'ai_duration_ms','obsidian_duration_ms','sent_tokens','received_tokens','original_tokens','cleansed_tokens',
      'page_bytes','candidate_bytes','original_bytes','cleansed_bytes','ai_summary_original_bytes',
      'ai_summary_cleansed_bytes','extracted_sentences_bytes','extracted_sentences_original_bytes','fallback_triggered',
    ];
    for (const k of keys) payload[k] = 'v-' + k;
    await callHandler('SQLITE_UPDATE', payload as never);
    const changes = recordsRepoMock.update.mock.calls[0][1] as Record<string, unknown>;
    expect(Object.keys(changes)).toHaveLength(keys.length);
    expect(recordsRepoMock.update).toHaveBeenCalledWith(12, expect.objectContaining({ url: 'v-url' }));
  });

  it('handles numeric id as string (Number conversion)', async () => {
    await callHandler('SQLITE_UPDATE', { id: '99', title: 't' } as never);
    expect(recordsRepoMock.update).toHaveBeenCalledWith(99, { title: 't' });
  });
});

// ── handleBackup — Branch 33-34 ───────────────────────────────────────────
describe('sqliteMessageHandlers — handleBackup branching', () => {
  beforeEach(() => vi.clearAllMocks());

  it('converts Uint8Array to Array when success and instanceof', async () => {
    const data = new Uint8Array([1, 2, 3]);
    dbMaintenanceMock.backupDb.mockResolvedValue({ success: true, data });
    const res = await callHandler('SQLITE_BACKUP') as { success: boolean; data: number[] };
    expect(res.success).toBe(true);
    expect(res.data).toEqual([1, 2, 3]);
    expect(Array.isArray(res.data)).toBe(true);
  });

  it('passes through failure when success false (short-circuit)', async () => {
    dbMaintenanceMock.backupDb.mockResolvedValue({ success: false, error: 'fail' });
    const res = await callHandler('SQLITE_BACKUP') as { success: boolean; error: string };
    expect(res.success).toBe(false);
    expect(res.error).toBe('fail');
  });

  it('passes through when success true but data not Uint8Array', async () => {
    dbMaintenanceMock.backupDb.mockResolvedValue({ success: true, data: 'not-bytes' } as never);
    const res = await callHandler('SQLITE_BACKUP') as { success: boolean };
    // falls to else branch -> sendResponse(result) unchanged
    expect(res).toEqual({ success: true, data: 'not-bytes' });
  });

  it('passes through when success true but data undefined', async () => {
    dbMaintenanceMock.backupDb.mockResolvedValue({ success: true } as never);
    const res = await callHandler('SQLITE_BACKUP') as { success: boolean };
    expect(res).toEqual({ success: true });
  });
});

// ── handleRestore — Branches 35-36 ─────────────────────────────────────────
describe('sqliteMessageHandlers — handleRestore branching', () => {
  beforeEach(() => vi.clearAllMocks());

  it('converts number[] to Uint8Array and returns success true path', async () => {
    dbMaintenanceMock.restoreDb.mockResolvedValue({ success: true });
    const res = await callHandler('SQLITE_RESTORE', { data: [1, 2, 3] }) as { success: boolean };
    expect(dbMaintenanceMock.restoreDb).toHaveBeenCalledWith(expect.any(Uint8Array));
    expect(res).toEqual({ success: true });
  });

  it('falls back to [] when data missing (|| branch) -> empty Uint8Array', async () => {
    dbMaintenanceMock.restoreDb.mockResolvedValue({ success: true });
    const res = await callHandler('SQLITE_RESTORE', {} as never) as { success: boolean };
    expect(dbMaintenanceMock.restoreDb).toHaveBeenCalledWith(expect.any(Uint8Array));
    const arg = dbMaintenanceMock.restoreDb.mock.calls[0][0] as Uint8Array;
    expect(arg.length).toBe(0);
    expect(res.success).toBe(true);
  });

  it('returns error branch when restore fails', async () => {
    dbMaintenanceMock.restoreDb.mockResolvedValue({ success: false, error: 'bad data' });
    const res = await callHandler('SQLITE_RESTORE', { data: [9] }) as { success: boolean; error: string };
    expect(res.success).toBe(false);
    expect(res.error).toBe('bad data');
  });

  it('handles null data via || []', async () => {
    dbMaintenanceMock.restoreDb.mockResolvedValue({ success: true });
    await callHandler('SQLITE_RESTORE', { data: null } as never);
    const arg = dbMaintenanceMock.restoreDb.mock.calls[0][0] as Uint8Array;
    expect(arg.length).toBe(0);
  });
});

// ── handlePurge / handleContentPurge ───────────────────────────────────────
describe('sqliteMessageHandlers — purge handlers', () => {
  beforeEach(() => vi.clearAllMocks());

  it('SQLITE_PURGE forwards retentionDays/maxRecords when defined', async () => {
    await callHandler('SQLITE_PURGE', { retentionDays: 30, maxRecords: 500 });
    expect(dbMaintenanceMock.purgeOldRecords).toHaveBeenCalledWith(30, 500);
  });

  it('SQLITE_PURGE forwards undefined when payload undefined', async () => {
    await callHandler('SQLITE_PURGE', undefined as never);
    expect(dbMaintenanceMock.purgeOldRecords).toHaveBeenCalledWith(undefined, undefined);
  });

  it('SQLITE_PURGE handles partial payload', async () => {
    await callHandler('SQLITE_PURGE', { retentionDays: 10 });
    expect(dbMaintenanceMock.purgeOldRecords).toHaveBeenCalledWith(10, undefined);
  });

  it('CONTENT_PURGE forwards all three args', async () => {
    await callHandler('CONTENT_PURGE', { retentionDays: 7, maxRecords: 100, includeStarred: true });
    expect(dbMaintenanceMock.purgeContent).toHaveBeenCalledWith(7, 100, true);
  });

  it('CONTENT_PURGE forwards undefined when empty', async () => {
    await callHandler('CONTENT_PURGE', {} as never);
    expect(dbMaintenanceMock.purgeContent).toHaveBeenCalledWith(undefined, undefined, undefined);
  });

  it('CONTENT_PURGE handles includeStarred false', async () => {
    await callHandler('CONTENT_PURGE', { includeStarred: false } as never);
    expect(dbMaintenanceMock.purgeContent).toHaveBeenCalledWith(undefined, undefined, false);
  });
});

// ── handleStatus — branches 25-32 + oldOpfsDbExists / oldIdbDbExists ───────
describe('sqliteMessageHandlers — handleStatus branching', () => {
  let originalNavigatorStorage: unknown;
  let originalIndexedDB: unknown;
  let originalChromeStorageGet: unknown;

  beforeEach(() => {
    vi.clearAllMocks();
    originalNavigatorStorage = (globalThis.navigator as unknown as Record<string, unknown>)?.storage;
    originalIndexedDB = (globalThis as unknown as Record<string, unknown>).indexedDB;
    // default success status
    recordsRepoMock.getStatus.mockResolvedValue({ success: true, initialized: true, path: 'OPFS:test.db', fallback: false } as never);
    // ensure chrome.storage.local.get is mockable (from vitest.setup)
    // reset to resolved value per test
  });

  afterEach(() => {
    vi.clearAllMocks();
    // restore globals
    if (originalNavigatorStorage !== undefined) {
      try { (globalThis.navigator as unknown as Record<string, unknown>).storage = originalNavigatorStorage as never; } catch {}
    }
    if (originalIndexedDB !== undefined) {
      (globalThis as unknown as Record<string, unknown>).indexedDB = originalIndexedDB as never;
    }
  });

  it('returns result directly when getStatus success false (else branch of if result.success)', async () => {
    recordsRepoMock.getStatus.mockResolvedValue({ success: false, error: 'db down' } as never);
    const res = await callHandler('SQLITE_STATUS') as { success: boolean; error: string };
    expect(res.success).toBe(false);
    expect(res.error).toBe('db down');
  });

  it('on success true, returns enriched status with storage values and legacy paths null when no legacy dbs', async () => {
    // storage returns some values
    (chrome.storage.local.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      [StorageKeys.OPFS_MIGRATION_V2_DONE]: true,
      [StorageKeys.OPFS_MIGRATION_V2_LAST_ATTEMPTED_AT]: '2026-01-01',
      [StorageKeys.OPFS_MIGRATION_V2_COMPLETED_AT]: '2026-01-02',
      [StorageKeys.OPFS_MIGRATION_V2_RECORD_COUNT]: 42,
      [StorageKeys.IDB_MIGRATION_V2_DONE]: false,
    });
    // navigator.storage.getDirectory fails -> oldOpfsDbExists false
    (globalThis.navigator as unknown as Record<string, unknown>).storage = {
      getDirectory: vi.fn().mockRejectedValue(new Error('no opfs')),
    } as never;
    (globalThis as unknown as Record<string, unknown>).indexedDB = {
      databases: vi.fn().mockResolvedValue([]),
    } as never;

    const res = await callHandler('SQLITE_STATUS') as Record<string, unknown>;
    expect(res.success).toBe(true);
    expect(res.opfsMigrationV2Done).toBe(true);
    expect(res.opfsLegacyDbPath).toBeNull();
    expect(res.idbLegacyDbName).toBeNull();
    expect(res.idbMigrationV2Done).toBe(false);
  });

  it('covers fallback defaults when storage returns empty (?? branches)', async () => {
    (chrome.storage.local.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (globalThis.navigator as unknown as Record<string, unknown>).storage = {
      getDirectory: vi.fn().mockRejectedValue(new Error('no dir')),
    } as never;
    (globalThis as unknown as Record<string, unknown>).indexedDB = {
      databases: vi.fn().mockResolvedValue([]),
    } as never;

    const res = await callHandler('SQLITE_STATUS') as Record<string, unknown>;
    expect(res.opfsMigrationV2Done).toBe(false); // ?? false
    expect(res.opfsMigrationV2LastAttemptedAt).toBeNull(); // ?? null
    expect(res.opfsMigrationV2CompletedAt).toBeNull();
    expect(res.opfsMigrationV2RecordCount).toBeNull();
    expect(res.idbMigrationV2Done).toBe(false);
  });

  it('covers legacy paths present when old dbs exist (ternary branches)', async () => {
    (chrome.storage.local.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({});
    // mock OPFS exists
    (globalThis.navigator as unknown as Record<string, unknown>).storage = {
      getDirectory: vi.fn().mockResolvedValue({
        getDirectoryHandle: vi.fn().mockResolvedValue({
          getFileHandle: vi.fn().mockResolvedValue({}),
        }),
      }),
    } as never;
    (globalThis as unknown as Record<string, unknown>).indexedDB = {
      databases: vi.fn().mockResolvedValue([{ name: 'idb-batch-atomic' }]),
    } as never;

    const res = await callHandler('SQLITE_STATUS') as Record<string, unknown>;
    expect(res.opfsLegacyDbPath).toBe('yasumaro-opfs/yasumaro.db');
    expect(res.idbLegacyDbName).toBe('idb-batch-atomic');
  });

  it('covers opfsLegacyExists false but idb legacy true split', async () => {
    (chrome.storage.local.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (globalThis.navigator as unknown as Record<string, unknown>).storage = {
      getDirectory: vi.fn().mockRejectedValue(new Error('fail')),
    } as never;
    (globalThis as unknown as Record<string, unknown>).indexedDB = {
      databases: vi.fn().mockResolvedValue([{ name: 'idb-batch-atomic' }, { name: 'other' }]),
    } as never;
    const res = await callHandler('SQLITE_STATUS') as Record<string, unknown>;
    expect(res.opfsLegacyDbPath).toBeNull();
    expect(res.idbLegacyDbName).toBe('idb-batch-atomic');
  });

  it('covers oldIdbDbExists fallback when indexedDB.databases is undefined (?? [] branch) and when it throws', async () => {
    (chrome.storage.local.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (globalThis.navigator as unknown as Record<string, unknown>).storage = {
      getDirectory: vi.fn().mockResolvedValue({
        getDirectoryHandle: vi.fn().mockRejectedValue(new Error('no dir')),
      }),
    } as never;
    // databases undefined -> ?? []
    (globalThis as unknown as Record<string, unknown>).indexedDB = {} as never;
    let res = await callHandler('SQLITE_STATUS') as Record<string, unknown>;
    expect(res.idbLegacyDbName).toBeNull();

    // now make databases throw
    (globalThis as unknown as Record<string, unknown>).indexedDB = {
      databases: vi.fn().mockRejectedValue(new Error('boom')),
    } as never;
    res = await callHandler('SQLITE_STATUS') as Record<string, unknown>;
    expect(res.idbLegacyDbName).toBeNull();
  });

  it('covers oldOpfsDbExists getFileHandle failure -> false', async () => {
    (chrome.storage.local.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (globalThis.navigator as unknown as Record<string, unknown>).storage = {
      getDirectory: vi.fn().mockResolvedValue({
        getDirectoryHandle: vi.fn().mockResolvedValue({
          getFileHandle: vi.fn().mockRejectedValue(new Error('no file')),
        }),
      }),
    } as never;
    (globalThis as unknown as Record<string, unknown>).indexedDB = {
      databases: vi.fn().mockResolvedValue([]),
    } as never;
    const res = await callHandler('SQLITE_STATUS') as Record<string, unknown>;
    expect(res.opfsLegacyDbPath).toBeNull();
  });

  it('covers catch branch when Promise.all rejects (chrome.storage.local.get throws)', async () => {
    recordsRepoMock.getStatus.mockResolvedValue({ success: true, initialized: true } as never);
    (chrome.storage.local.get as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('storage fail'));
    // ensure old checks don't throw before Promise.all? They are parallel so one rejection triggers catch
    (globalThis.navigator as unknown as Record<string, unknown>).storage = {
      getDirectory: vi.fn().mockRejectedValue(new Error('opfs fail')),
    } as never;
    (globalThis as unknown as Record<string, unknown>).indexedDB = {
      databases: vi.fn().mockResolvedValue([]),
    } as never;

    const res = await callHandler('SQLITE_STATUS') as Record<string, unknown>;
    // catch branch sends raw result without enrichment
    expect(res.success).toBe(true);
    expect(res).not.toHaveProperty('opfsMigrationV2Done');
  });

  it('covers oldIdbDbExists databases.some false path', async () => {
    (chrome.storage.local.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (globalThis.navigator as unknown as Record<string, unknown>).storage = {
      getDirectory: vi.fn().mockRejectedValue(new Error('no opfs')),
    } as never;
    (globalThis as unknown as Record<string, unknown>).indexedDB = {
      databases: vi.fn().mockResolvedValue([{ name: 'other-db' }]),
    } as never;
    const res = await callHandler('SQLITE_STATUS') as Record<string, unknown>;
    expect(res.idbLegacyDbName).toBeNull();
  });
});

