/**
 * opfsWorkerBackend-workerTypeSync.test.ts (PBI 2026-10-20-23)
 *
 * Enumeration sync for the NON-archive half of WORKER_MESSAGE_TYPES: the
 * worker types OpfsWorkerBackend exercises are exactly the non-archive,
 * non-INIT entries of the SSOT array — the mirror of the ARCHIVE_* side that
 * archiveWireTable.test.ts pins.
 *
 * Adding a worker type without a backend method fails here (the expected set
 * grows); a backend method sending an unlisted type fails here too (and at
 * compile time — callWorker takes WorkerMessageType, so a misspelled literal
 * no longer compiles).
 */
import { describe, it, expect, vi } from 'vitest';
import { WORKER_MESSAGE_TYPES } from '../opfsWorker/types.js';
import { OpfsWorkerBackend } from '../OpfsWorkerBackend.js';
import type { BrowsingLogRecord } from '../../utils/sqlite-types.js';

// INIT is engine-host-owned: sqliteEngineContext/opfsWorkerProxy sends it
// during worker bootstrap, so the backend has no init method to exercise it.
// Same shape as the archive test's NON_TABLE_WORKER_TYPES for
// ARCHIVE_DISCARD/ARCHIVE_SWEEP.
const ENGINE_HOST_WORKER_TYPES = new Set(['INIT']);

/** One permissive success answer every non-archive projection accepts. */
const OK_RESULT = {
  id: 1,
  count: 1,
  inserted: 1,
  skipped: 0,
  rows: [] as unknown[],
  total: 0,
  is_starred: 1,
  purged: 1,
  ok: true,
  restored: true,
  dirty: true,
  data: new Uint8Array([1]),
};

const record: BrowsingLogRecord = { url: 'https://example.com/', created_at: 1 };

/** A backend whose worker proxy records the type of every call. */
function makeRecordingBackend(): { backend: OpfsWorkerBackend; types: string[] } {
  const types: string[] = [];
  const tryOpfsProxy = vi.fn(async (type: string) => {
    types.push(type);
    return OK_RESULT;
  });
  return { backend: new OpfsWorkerBackend({ tryOpfsProxy } as never), types };
}

// Every non-archive backend method, with the worker type(s) its dispatch
// reaches. query drives both modes (planQueryMode decides QUERY vs SEARCH).
const backendCalls: Array<[name: string, call: (b: OpfsWorkerBackend) => Promise<unknown>]> = [
  ['insert', (b) => b.insert(record)],
  ['insertBatch', (b) => b.insertBatch([record])],
  ['query (listing)', (b) => b.query({ limit: 10 })],
  ['query (search)', (b) => b.query({ text: 'tok', limit: 10 })],
  ['update', (b) => b.update(1, { title: 'x' })],
  ['delete', (b) => b.delete(1)],
  ['toggleStar', (b) => b.toggleStar(1)],
  ['purgeOldRecords', (b) => b.purgeOldRecords(7, 100)],
  ['purgeContent', (b) => b.purgeContent(7, 100)],
  ['purgeAuditLog', (b) => b.purgeAuditLog(7)],
  ['getFtsIndexSize', (b) => b.getFtsIndexSize()],
  ['backupDb', (b) => b.backupDb()],
  ['restoreDb', (b) => b.restoreDb(new Uint8Array([1]))],
  ['healthCheck', (b) => b.healthCheck()],
  ['getStatus', (b) => b.getStatus()],
  ['insertAuditLog', (b) => b.insertAuditLog({ provider: 'openai', url: 'https://example.com/', created_at: 1 })],
  ['queryAuditLog', (b) => b.queryAuditLog({ limit: 10 })],
  ['serialize', (b) => b.serialize()],
  ['getCount', (b) => b.getCount()],
  ['clearAll', (b) => b.clearAll()],
];

async function collectTypes(): Promise<string[]> {
  const { backend, types } = makeRecordingBackend();
  for (const [, call] of backendCalls) await call(backend);
  return types;
}

describe('OpfsWorkerBackend — non-archive worker type enumeration sync', () => {
  it('exercises exactly the non-archive worker types except INIT', async () => {
    const types = await collectTypes();

    const expected = new Set(
      WORKER_MESSAGE_TYPES.filter(
        (t) => !t.startsWith('ARCHIVE_') && !ENGINE_HOST_WORKER_TYPES.has(t),
      ),
    );
    expect(new Set(types)).toEqual(expected);
  });

  it('sends only worker types listed in WORKER_MESSAGE_TYPES', async () => {
    const types = await collectTypes();

    const listed = new Set<string>(WORKER_MESSAGE_TYPES);
    for (const t of types) expect(listed.has(t)).toBe(true);
  });
});
