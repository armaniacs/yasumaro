// @vitest-environment node
/**
 * archiveSchemaNoFts.test.ts
 * PBI 2026-09-07-01 (R1): the archive schema must contain NO FTS tables and
 * NO triggers. The archive .db is built from SCHEMA_SQL + ARCHIVE_META_SCHEMA_SQL
 * (see handleArchiveCreate) — FTS5_STATEMENTS are applied only to the main DB.
 *
 * The static string asserts guard the constants; the executable assert runs
 * the exact DDL composition through real SQLite so a future FTS/trigger
 * addition to SCHEMA_SQL fails here before it corrupts exported archives.
 * (E2E verifies the actually-generated .db matches these constants —
 * archive-required-verification.spec.ts.)
 */
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import {
  SCHEMA_SQL,
  ARCHIVE_META_SCHEMA_SQL,
  ARCHIVE_INSERT_SQL,
  ARCHIVE_SELECT_COLUMNS,
  buildArchiveInsertParams,
} from '../schema.js';
import { ARCHIVE_FORMAT_VERSION } from '../../utils/archiveGuards.js';

describe('archive schema composition (no FTS)', () => {
  it('ARCHIVE_META_SCHEMA_SQL contains no FTS tables, virtual tables, or triggers', () => {
    expect(ARCHIVE_META_SCHEMA_SQL.toLowerCase()).not.toContain('fts');
    expect(ARCHIVE_META_SCHEMA_SQL.toUpperCase()).not.toContain('TRIGGER');
    expect(ARCHIVE_META_SCHEMA_SQL.toUpperCase()).not.toContain('VIRTUAL TABLE');
  });

  it('SCHEMA_SQL (the browsing_logs DDL the archive reuses) contains no FTS or triggers', () => {
    expect(SCHEMA_SQL.toLowerCase()).not.toContain('fts');
    expect(SCHEMA_SQL.toUpperCase()).not.toContain('CREATE TRIGGER');
    expect(SCHEMA_SQL.toUpperCase()).not.toContain('VIRTUAL TABLE');
  });

  it('ARCHIVE_FORMAT_VERSION matches the value recorded by phase A', () => {
    expect(ARCHIVE_FORMAT_VERSION).toBe(1);
  });
});

describe('archive DDL executed in real SQLite', () => {
  function buildArchiveDb(): Database.Database {
    const db = new Database(':memory:');
    db.exec(SCHEMA_SQL);
    db.exec(ARCHIVE_META_SCHEMA_SQL);
    return db;
  }

  it('creates only browsing_logs + yasumaro_archive_meta (+their indexes)', () => {
    const db = buildArchiveDb();
    const objects = db
      .prepare("SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'")
      .all() as Array<{ type: string; name: string }>;
    const names = objects.map((o) => o.name).sort();
    expect(names).toEqual([
      'browsing_logs',
      'idx_logs_active',
      'idx_logs_created',
      'idx_logs_domain',
      'idx_logs_obsidian',
      'yasumaro_archive_meta',
    ]);
    db.close();
  });

  it('has no *_fts tables and no browsing_logs_a[idu] triggers', () => {
    const db = buildArchiveDb();
    const objects = db
      .prepare("SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'")
      .all() as Array<{ type: string; name: string }>;
    expect(objects.filter((o) => o.name.includes('fts'))).toEqual([]);
    expect(objects.filter((o) => o.type === 'trigger')).toEqual([]);
    // The main-DB FTS trigger names must never appear in the archive schema.
    for (const name of ['browsing_logs_ai', 'browsing_logs_ad', 'browsing_logs_au']) {
      expect(objects.some((o) => o.name === name)).toBe(false);
    }
    db.close();
  });

  it('accepts an id-preserving ARCHIVE_INSERT_SQL row and reads it back via ARCHIVE_SELECT_COLUMNS', () => {
    const db = buildArchiveDb();
    const record = {
      id: 42,
      url: 'https://example.com/1',
      title: 't',
      created_at: 1700000000000,
      is_starred: 1,
      is_deleted: 0,
    };
    db
      .prepare(ARCHIVE_INSERT_SQL)
      .run(...buildArchiveInsertParams(record as never, 'example.com'));
    const row = db
      .prepare(`SELECT ${ARCHIVE_SELECT_COLUMNS} FROM browsing_logs WHERE id = 42`)
      .get() as Record<string, unknown>;
    expect(row).toMatchObject({ id: 42, url: 'https://example.com/1', title: 't', is_starred: 1 });
    db.close();
  });
});
