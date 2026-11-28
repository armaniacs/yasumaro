/**
 * backupByteBudget.test.ts
 * PBI 2026-11-27-04 (VULN-002, CWE-400 Low) post-fix contract pin — the
 * repository port of yasumaro_VULNHUNT_RESULTS_2026-11-27-190000/exploit_tests/
 * test_vuln_002_backup_array_amplification.test.ts.
 *
 * Old contract (exploited): the create side had no byte budget, and the
 * offscreen SQLITE_BACKUP handler re-materialized every DB byte as a plain
 * number[] (~8x JSON amplification on the chrome.runtime hop).
 *
 * New contract pinned here:
 *   1. the OPFS create side (opfsWorker/backupHandlers.handleBackup) enforces
 *      MAX_BACKUP_FILE_BYTES BEFORE arrayBuffer() — over-budget fails closed
 *      and the file is never materialized;
 *   2. the boundary is exact: a file at the budget passes, +1 byte rejects;
 *   3. the offscreen SQLITE_BACKUP response carries the bytes as a base64
 *      string — no unbounded number[] exists on the wire hop.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRootFromUrl } from '../../../testDir/repoRoot.js';
import { DB_FILENAME } from '../dbFilename.js';
import { MAX_BACKUP_FILE_BYTES } from '../../utils/limits.js';
import { base64ToBytes } from '../../utils/crypto/index.js';

const REPO_ROOT = repoRootFromUrl(import.meta.url);

// ── OPFS create-side budget (backupHandlers.handleBackup) ──────────────────

interface FakeFile {
  size: number;
  arrayBuffer: () => Promise<ArrayBuffer>;
}

let fakeFile: FakeFile;

type BackupHandlers = typeof import('../opfsWorker/backupHandlers.js');
let backupHandlers: BackupHandlers;

async function loadBackupHandlers(): Promise<void> {
  backupHandlers = await import('../opfsWorker/backupHandlers.js');
}

function stubOpfsRoot(): void {
  const root = {
    getFileHandle: async (_name: string, options?: { create?: boolean }) => {
      if (!options?.create && _name === DB_FILENAME) {
        return { getFile: async () => fakeFile };
      }
      throw new Error(`NotFoundError: ${_name}`);
    },
  };
  Object.defineProperty(globalThis.navigator, 'storage', {
    configurable: true,
    get: () => ({ getDirectory: async () => root }),
  });
}

const CTX = {
  engine: { exec: vi.fn(async (_sql: string) => undefined) },
} as unknown as import('../opfsWorker/handlers.js').HandlerContext;

describe('backup create-side byte budget (VULN-002 fix, backupHandlers.handleBackup)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubOpfsRoot();
  });

  it('rejects an over-budget database before materializing it (fail closed)', async () => {
    await loadBackupHandlers();
    fakeFile = {
      size: MAX_BACKUP_FILE_BYTES + 1,
      // The gate must fire before the read: arrayBuffer never runs.
      arrayBuffer: async () => {
        throw new Error('arrayBuffer must not be called for an over-budget file');
      },
    };
    await expect(backupHandlers.handleBackup(CTX)).rejects.toThrow(/exceeds the backup budget/);
  });

  it('admits a database exactly at the budget (boundary: +1 byte is the first rejection)', async () => {
    await loadBackupHandlers();
    const buffer = new ArrayBuffer(MAX_BACKUP_FILE_BYTES);
    fakeFile = { size: MAX_BACKUP_FILE_BYTES, arrayBuffer: async () => buffer };
    const result = await backupHandlers.handleBackup(CTX);
    expect(result.byteLength).toBe(MAX_BACKUP_FILE_BYTES);
  });
});

// ── Offscreen wire contract (SQLITE_BACKUP response shape) ─────────────────

const engineMock = vi.hoisted(() => ({ init: vi.fn().mockResolvedValue(true) }));
const recordsRepoMock = vi.hoisted(() => ({
  insert: vi.fn(),
  insertBatch: vi.fn(),
  query: vi.fn(),
  update: vi.fn(),
  hardDelete: vi.fn(),
  toggleStar: vi.fn(),
  getCount: vi.fn(),
  getStatus: vi.fn(),
  clearAll: vi.fn(),
}));
const dbMaintenanceMock = vi.hoisted(() => ({
  sqliteHealthCheck: vi.fn(),
  backupDb: vi.fn(),
  restorePrepareIncoming: vi.fn(),
  restoreAppend: vi.fn(),
  restoreCommit: vi.fn(),
  restoreAbort: vi.fn(),
  purgeOldRecords: vi.fn(),
  purgeContent: vi.fn(),
}));
const auditLogRepoMock = vi.hoisted(() => ({
  insertAuditLog: vi.fn(),
  queryAuditLog: vi.fn(),
  purgeAuditLog: vi.fn(),
}));

vi.mock('../sqliteEngineHost.js', () => ({ engine: engineMock }));
vi.mock('../recordsRepo.js', () => recordsRepoMock);
vi.mock('../dbMaintenance.js', () => dbMaintenanceMock);
vi.mock('../auditLogRepo.js', () => auditLogRepoMock);

import { sqliteMessageHandlers } from '../sqliteMessageHandlers.js';
import type { SqliteMessage } from '../../messaging/sqliteMessages.js';

async function callBackupHandler(): Promise<unknown> {
  const handler = sqliteMessageHandlers.get('SQLITE_BACKUP');
  expect(handler).toBeDefined();
  let response: unknown;
  await handler!({ type: 'SQLITE_BACKUP' } as SqliteMessage, (r) => {
    response = r;
  });
  return response;
}

describe('SQLITE_BACKUP response carries base64, not a number[] (VULN-002 fix)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('an in-budget backup arrives as a base64 string that round-trips to the DB bytes', async () => {
    const dbBytes = new Uint8Array([83, 81, 76, 105, 116, 101]); // "SQLite"
    dbMaintenanceMock.backupDb.mockResolvedValue({ success: true, data: dbBytes });
    const r = await callBackupHandler() as { success: boolean; data: unknown };
    expect(r.success).toBe(true);
    // Attacker's goal negated: the old contract produced Array.isArray(data)
    // with one boxed number per DB byte; the new wire value is text.
    expect(Array.isArray(r.data)).toBe(false);
    expect(typeof r.data).toBe('string');
    expect(Array.from(base64ToBytes(r.data as string))).toEqual(Array.from(dbBytes));
  });

  it('a failed backup passes through unchanged (no success shape invented)', async () => {
    dbMaintenanceMock.backupDb.mockResolvedValue({ success: false, error: 'budget' });
    const r = await callBackupHandler() as { success: boolean; error: string };
    expect(r).toEqual({ success: false, error: 'budget' });
  });

  it('static: the handler no longer re-materializes bytes and the budget lives at the OPFS read', () => {
    // Source-scanning gate: always read the real repo tree, even when this
    // test itself runs from inside a Stryker sandbox copy.
    const messageHandlers = readFileSync(join(REPO_ROOT, 'src/offscreen/sqliteMessageHandlers.ts'), 'utf8');
    const handlerStart = messageHandlers.indexOf('async function handleBackup');
    const handlerEnd = messageHandlers.indexOf('\n}', handlerStart);
    const handler = messageHandlers.slice(handlerStart, handlerEnd);
    expect(handler).toContain('bytesToBase64(result.data)');
    expect(handler).not.toContain('Array.from(result.data)');

    const backupHandlersSource = readFileSync(join(REPO_ROOT, 'src/offscreen/opfsWorker/backupHandlers.ts'), 'utf8');
    const createStart = backupHandlersSource.indexOf('export async function handleBackup');
    const createEnd = backupHandlersSource.indexOf('\n}', createStart);
    const createSide = backupHandlersSource.slice(createStart, createEnd);
    // The budget check precedes the materializing read ('.arrayBuffer()'
    // with the dot skips the comment's prose mention).
    expect(createSide.indexOf('MAX_BACKUP_FILE_BYTES')).toBeGreaterThan(-1);
    expect(createSide.indexOf('file.size')).toBeGreaterThan(-1);
    expect(createSide.indexOf('file.size')).toBeLessThan(createSide.indexOf('.arrayBuffer()'));
    expect(createSide).not.toContain('Array.from');
  });
});
