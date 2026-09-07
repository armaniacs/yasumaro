// @vitest-environment node
/**
 * archiveDbReader.test.ts
 * Unit tests for the archiveDbReader E2E fixture (PBI 2026-09-07-01):
 * chunk-collection loop boundaries, byte merge, and the better-sqlite3
 * in-memory open (R1 helper).
 */
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import {
  collectArchiveChunks,
  concatChunks,
  openArchiveDb,
  type ArchiveExportChunk,
} from '../e2e/fixtures/archiveDbReader.js';

/** Build a fetcher that slices `source` with the same semantics as the
 * worker's handleArchiveExport (offset/end clamped to file size). */
function makeSlicingFetcher(source: Uint8Array, chunkLen: number) {
  let calls = 0;
  return {
    calls: () => calls,
    fetch: async (offset: number, length: number): Promise<ArchiveExportChunk> => {
      calls++;
      const end = Math.min(offset + Math.max(1, Math.floor(length)), source.length);
      const slice = Array.from(source.slice(offset, end));
      return { chunk: slice, nextOffset: end, total: source.length, done: end >= source.length };
    },
    expectedChunkLen: chunkLen,
  };
}

describe('collectArchiveChunks', () => {
  it('merges multiple chunks across boundaries', async () => {
    // 10 bytes, 4-byte chunks → 3 calls (4/4/2)
    const source = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const f = makeSlicingFetcher(source, 4);
    const bytes = await collectArchiveChunks(f.fetch, 4);
    expect(Array.from(bytes)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(f.calls()).toBe(3);
  });

  it('returns an empty array for an empty file (done on first call)', async () => {
    const f = makeSlicingFetcher(new Uint8Array(0), 8);
    const bytes = await collectArchiveChunks(f.fetch, 4);
    expect(bytes.length).toBe(0);
    expect(f.calls()).toBe(1);
  });

  it('handles a chunk that ends exactly on the boundary', async () => {
    const source = Uint8Array.from([9, 9, 9, 9]);
    const f = makeSlicingFetcher(source, 4);
    const bytes = await collectArchiveChunks(f.fetch, 4);
    expect(Array.from(bytes)).toEqual([9, 9, 9, 9]);
    expect(f.calls()).toBe(1);
  });

  it('rejects a stream whose nextOffset does not advance', async () => {
    const stuck: ArchiveExportChunk = { chunk: [1], nextOffset: 0, total: 10, done: false };
    await expect(collectArchiveChunks(async () => stuck)).rejects.toThrow(/nextOffset did not advance/);
  });

  it('rejects a stream whose assembled size disagrees with total', async () => {
    const res: ArchiveExportChunk = { chunk: [1, 2], nextOffset: 2, total: 10, done: true };
    await expect(collectArchiveChunks(async () => res)).rejects.toThrow(/total/);
  });

  it('uses the caller-provided chunk length for every fetch', async () => {
    const source = Uint8Array.from({ length: 12 }, (_, i) => i);
    const lengths: number[] = [];
    const bytes = await collectArchiveChunks(async (offset, length) => {
      lengths.push(length);
      const end = Math.min(offset + length, source.length);
      return {
        chunk: Array.from(source.slice(offset, end)),
        nextOffset: end,
        total: source.length,
        done: end >= source.length,
      };
    }, 5);
    expect(lengths).toEqual([5, 5, 5]);
    expect(bytes.length).toBe(12);
  });
});

describe('concatChunks', () => {
  it('concatenates empty and non-empty chunks in order', () => {
    const out = concatChunks([[1, 2], [], [3], []]);
    expect(Array.from(out)).toEqual([1, 2, 3]);
  });

  it('returns an empty Uint8Array for no chunks', () => {
    const out = concatChunks([]);
    expect(out).toBeInstanceOf(Uint8Array);
    expect(out.length).toBe(0);
  });
});

describe('openArchiveDb (better-sqlite3)', () => {
  it('opens a real SQLite database image and reads it back', () => {
    // Build a stand-in archive db in memory, export its bytes, re-open via
    // the reader — proves the bytes→better-sqlite3 path end to end.
    const src = new Database(':memory:');
    src.exec(`
      CREATE TABLE browsing_logs (id INTEGER PRIMARY KEY, url TEXT, title TEXT);
      CREATE TABLE yasumaro_archive_meta (
        archived_at INTEGER, cutoff_created_at INTEGER, cutoff_date TEXT,
        record_count INTEGER, include_deleted INTEGER, max_id_at_archive INTEGER,
        archive_format_version INTEGER, yasumaro_version TEXT
      );
      INSERT INTO browsing_logs VALUES (1, 'https://a.test/1', 'one'), (2, 'https://a.test/2', 'two');
      INSERT INTO yasumaro_archive_meta VALUES (1, 100, '2026-01-01', 2, 0, 2, 1, '6.7.114');
    `);
    const bytes = new Uint8Array(src.serialize());

    const reader = openArchiveDb(bytes);
    expect(reader.countBrowsingLogs()).toBe(2);
    expect(reader.getMeta()).toMatchObject({ record_count: 2, archive_format_version: 1, yasumaro_version: '6.7.114' });
    const rows = reader.query<{ id: number; title: string }>(
      'SELECT id, title FROM browsing_logs ORDER BY id',
    );
    expect(rows.map((r) => r.title)).toEqual(['one', 'two']);
    reader.close();
    src.close();
  });

  it('throws when yasumaro_archive_meta is missing', () => {
    const src = new Database(':memory:');
    src.exec('CREATE TABLE browsing_logs (id INTEGER)');
    const bytes = new Uint8Array(src.serialize());
    src.close();
    const reader = openArchiveDb(bytes);
    expect(() => reader.getMeta()).toThrow(/yasumaro_archive_meta/);
    reader.close();
  });

  it('getSchemaObjects lists tables and excludes sqlite internals', () => {
    const src = new Database(':memory:');
    src.exec('CREATE TABLE browsing_logs (id INTEGER); CREATE INDEX idx ON browsing_logs(id);');
    const bytes = new Uint8Array(src.serialize());
    src.close();
    const reader = openArchiveDb(bytes);
    const objects = reader.getSchemaObjects();
    expect(objects).toEqual(
      expect.arrayContaining([
        { type: 'table', name: 'browsing_logs' },
        { type: 'index', name: 'idx' },
      ]),
    );
    expect(objects.some((o) => o.name.startsWith('sqlite_'))).toBe(false);
    reader.close();
  });
});
