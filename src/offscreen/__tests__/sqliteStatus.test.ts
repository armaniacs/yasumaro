import { describe, it, expect, vi, beforeEach } from 'vitest';
import { collectMigrationExtras } from '../sqliteStatus.js';
import { StorageKeys } from '../../utils/storage/types.js';
import {
  LEGACY_OPFS_POOL_DIR,
  LEGACY_OPFS_DB_FILENAME,
  LEGACY_IDB_NAME,
} from '../../messaging/sqliteMessages.js';

describe('collectMigrationExtras — field isolation (PBI 2026-09-11-06)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns all extras when storage read and probes succeed', async () => {
    (globalThis as unknown as Record<string, unknown>).chrome = {
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({
            [StorageKeys.OPFS_MIGRATION_V2_DONE]: true,
            [StorageKeys.OPFS_MIGRATION_V2_RECORD_COUNT]: 42,
            [StorageKeys.IDB_MIGRATION_V2_DONE]: true,
          }),
        },
      },
    } as unknown;
    (globalThis.navigator as unknown as Record<string, unknown>).storage = {
      getDirectory: vi.fn().mockResolvedValue({
        getDirectoryHandle: vi.fn().mockResolvedValue({
          getFileHandle: vi.fn().mockResolvedValue({}),
        }),
      }),
    } as never;
    (globalThis as unknown as Record<string, unknown>).indexedDB = {
      databases: vi.fn().mockResolvedValue([{ name: LEGACY_IDB_NAME }]),
    } as never;

    const extras = await collectMigrationExtras();
    expect(extras.opfsMigrationV2Done).toBe(true);
    expect(extras.opfsMigrationV2RecordCount).toBe(42);
    expect(extras.idbMigrationV2Done).toBe(true);
    expect(extras.opfsLegacyDbPath).toBe(`${LEGACY_OPFS_POOL_DIR}/${LEGACY_OPFS_DB_FILENAME}`);
    expect(extras.idbLegacyDbName).toBe(LEGACY_IDB_NAME);
  });

  it('reports confirmed absence when the OPFS probe fails internally, keeping other extras', async () => {
    (globalThis as unknown as Record<string, unknown>).chrome = {
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({ [StorageKeys.IDB_MIGRATION_V2_DONE]: true }),
        },
      },
    } as unknown;
    (globalThis.navigator as unknown as Record<string, unknown>).storage = {
      getDirectory: vi.fn().mockRejectedValue(new Error('storage unavailable')),
    } as never;
    (globalThis as unknown as Record<string, unknown>).indexedDB = {
      databases: vi.fn().mockResolvedValue([]),
    } as never;

    const extras = await collectMigrationExtras();
    // The probe catches its own failure and reports "absent" (false → null).
    expect(extras.opfsLegacyDbPath).toBeNull();
    expect(extras.idbLegacyDbName).toBeNull();
    expect(extras.idbMigrationV2Done).toBe(true);
  });

  it('omits every extra when the storage read rejects but probes still contribute', async () => {
    (globalThis as unknown as Record<string, unknown>).chrome = {
      storage: {
        local: {
          get: vi.fn().mockRejectedValue(new Error('storage unavailable')),
        },
      },
    } as unknown;
    (globalThis.navigator as unknown as Record<string, unknown>).storage = {
      getDirectory: vi.fn().mockResolvedValue({
        getDirectoryHandle: vi.fn().mockResolvedValue({
          getFileHandle: vi.fn().mockResolvedValue({}),
        }),
      }),
    } as never;
    (globalThis as unknown as Record<string, unknown>).indexedDB = {
      databases: vi.fn().mockResolvedValue([]),
    } as never;

    const extras = await collectMigrationExtras();
    expect(extras).not.toHaveProperty('opfsMigrationV2Done');
    expect(extras.opfsLegacyDbPath).toBe(`${LEGACY_OPFS_POOL_DIR}/${LEGACY_OPFS_DB_FILENAME}`);
    expect(extras.idbLegacyDbName).toBeNull();
  });
});

describe('legacy path SSOT drift guard (PBI 2026-09-11-06)', () => {
  it('literal legacy paths are declared only in sqliteMessages.ts', async () => {
    const { readFileSync, readdirSync, statSync } = await import('node:fs');
    const { join, relative } = await import('node:path');

    const root = join(__dirname, '..', '..', '..');
    const offenders: string[] = [];
    // Match value assignments only — doc comments may mention the names.
    const literals = [/=\s*['"]yasumaro-opfs['"]/, /=\s*['"]idb-batch-atomic['"]/];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        if (name === '__tests__' || name === 'node_modules' || name === 'dist') continue;
        const full = join(dir, name);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!name.endsWith('.ts') || name.endsWith('.test.ts')) continue;
        const rel = relative(root, full).replaceAll('\\', '/');
        if (rel === 'src/messaging/sqliteMessages.ts') continue;
        const content = readFileSync(full, 'utf-8');
        for (const lit of literals) {
          if (lit.test(content)) offenders.push(`${rel}: ${lit.source}`);
        }
      }
    };
    walk(join(root, 'src'));

    expect(offenders).toEqual([]);
  });
});
