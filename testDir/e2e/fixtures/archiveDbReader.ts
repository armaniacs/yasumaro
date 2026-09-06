/**
 * archiveDbReader.ts — shared E2E/vitest fixture (PBI 2026-09-07-01)
 *
 * Turns the chunked `archive_export` response into an openable SQLite
 * database in the Playwright/vitest Node process:
 *
 *   collectArchiveChunks(fetchChunk)  — browser-side chunk loop
 *   concatChunks(chunks)              — pure byte concatenation
 *   openArchiveDb(bytes)              — better-sqlite3 in-memory open
 *
 * SQLite reader decision (PBI 2026-09-07-01 acceptance): better-sqlite3
 * pinned to 12.11.1 — verbatim prebuilds exist for CI Node 24 (ABI v137)
 * and local Node 26 (ABI v147) on linux-x64 and darwin-arm64, so `npm ci`
 * never falls back to node-gyp (verified against the v12.11.1 release
 * assets on 2026-09-07).
 */
import Database from 'better-sqlite3';

/** One `archive_export` chunk response (fields relevant to the loop). */
export interface ArchiveExportChunk {
  chunk: number[];
  nextOffset: number;
  total: number;
  done: boolean;
}

/**
 * Transport-agnostic chunk collector. The caller supplies the chunk fetcher:
 * E2E specs back it with `page.evaluate` → DASHBOARD_SQLITE `archive_export`;
 * unit tests back it with an in-memory fake.
 */
export async function collectArchiveChunks(
  fetchChunk: (offset: number, length: number) => Promise<ArchiveExportChunk>,
  chunkLength = 8 * 1024 * 1024,
): Promise<Uint8Array> {
  const chunks: number[][] = [];
  let offset = 0;
  // Hard iteration cap: a malformed (never-done) stream must not hang the
  // test — a 200MB archive at the minimum 1-byte chunk size is 2e8 chunks.
  const maxChunks = 100_000;
  for (let i = 0; i < maxChunks; i++) {
    const res = await fetchChunk(offset, chunkLength);
    if (!res || typeof res.done !== 'boolean') {
      throw new Error('archive_export: malformed chunk response');
    }
    chunks.push(res.chunk);
    if (res.done) {
      const bytes = concatChunks(chunks);
      if (res.total > 0 && bytes.length !== res.total) {
        throw new Error(
          `archive_export: assembled ${bytes.length} bytes but total reported ${res.total}`,
        );
      }
      return bytes;
    }
    if (res.nextOffset <= offset) {
      throw new Error(`archive_export: nextOffset did not advance (${res.nextOffset} <= ${offset})`);
    }
    offset = res.nextOffset;
  }
  throw new Error(`archive_export: chunk loop exceeded ${maxChunks} iterations`);
}

/** Pure byte concatenation so the merge logic is unit-testable on its own. */
export function concatChunks(chunks: number[][]): Uint8Array {
  const size = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(size);
  let cursor = 0;
  for (const chunk of chunks) {
    out.set(chunk, cursor);
    cursor += chunk.length;
  }
  return out;
}

/** Row of `yasumaro_archive_meta` (single-row table). */
export interface ArchiveMetaRow {
  archived_at: number;
  cutoff_created_at: number;
  cutoff_date: string;
  record_count: number;
  include_deleted: number;
  max_id_at_archive: number | null;
  archive_format_version: number;
  yasumaro_version: string;
}

export interface SqliteMasterEntry {
  type: string;
  name: string;
}

/** In-memory reader over an exported archive .db (better-sqlite3). */
export class ArchiveDbReader {
  private readonly db: Database.Database;

  constructor(bytes: Uint8Array) {
    this.db = new Database(Buffer.from(bytes));
  }

  static open(bytes: Uint8Array): ArchiveDbReader {
    return new ArchiveDbReader(bytes);
  }

  query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }

  queryValue<T = unknown>(sql: string, params: unknown[] = []): T | undefined {
    const row = this.db.prepare(sql).get(...params) as Record<string, unknown> | undefined;
    return row ? (Object.values(row)[0] as T) : undefined;
  }

  countBrowsingLogs(): number {
    return Number(this.queryValue('SELECT COUNT(*) AS c FROM browsing_logs') ?? 0);
  }

  getMeta(): ArchiveMetaRow {
    const row = this.db
      .prepare(
        'SELECT archived_at, cutoff_created_at, cutoff_date, record_count, include_deleted, ' +
          'max_id_at_archive, archive_format_version, yasumaro_version FROM yasumaro_archive_meta',
      )
      .get() as ArchiveMetaRow | undefined;
    if (!row) throw new Error('yasumaro_archive_meta is empty');
    return row;
  }

  /** sqlite_master entries (tables, indexes, triggers, views). */
  getSchemaObjects(): SqliteMasterEntry[] {
    return this.db
      .prepare("SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'")
      .all() as SqliteMasterEntry[];
  }

  close(): void {
    this.db.close();
  }
}

/** Open exported bytes and return a reader (convenience for one-shot asserts). */
export function openArchiveDb(bytes: Uint8Array): ArchiveDbReader {
  return ArchiveDbReader.open(bytes);
}
