/**
 * schema.ts
 * Shared SQLite schema definitions for browsing_logs.
 * Single source of truth — imported by both sqlite.ts (IDB path) and
 * opfsWorker.ts (OPFS Worker path).
 */

export const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS browsing_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT NOT NULL,
    title TEXT,
    summary TEXT,
    tags TEXT,
    created_at INTEGER NOT NULL,
    domain TEXT,
    visit_duration INTEGER CHECK(visit_duration IS NULL OR visit_duration >= 0),
    scroll_ratio REAL CHECK(scroll_ratio IS NULL OR (scroll_ratio >= 0 AND scroll_ratio <= 1)),
    is_starred INTEGER DEFAULT 0 CHECK(is_starred IN (0, 1)),
    is_deleted INTEGER DEFAULT 0 CHECK(is_deleted IN (0, 1)),
    obsidian_synced INTEGER DEFAULT 0,
    UNIQUE(url, created_at)
  );

  CREATE INDEX IF NOT EXISTS idx_logs_created ON browsing_logs(created_at);
  CREATE INDEX IF NOT EXISTS idx_logs_domain ON browsing_logs(domain);
  CREATE INDEX IF NOT EXISTS idx_logs_active ON browsing_logs(is_deleted, created_at);
  CREATE INDEX IF NOT EXISTS idx_logs_obsidian ON browsing_logs(obsidian_synced);
`;

/**
 * FTS5 DDL as a single string — used by sqlite.ts (IDB path) via one-shot exec().
 */
export const FTS5_SQL = `
  CREATE VIRTUAL TABLE IF NOT EXISTS browsing_logs_fts USING fts5(
    url, title, summary, tags,
    content='browsing_logs',
    content_rowid='id',
    tokenize='trigram'
  );

  CREATE TRIGGER IF NOT EXISTS browsing_logs_ai AFTER INSERT ON browsing_logs BEGIN
    INSERT INTO browsing_logs_fts(rowid, url, title, summary, tags)
    VALUES (new.id, new.url, new.title, new.summary, new.tags);
  END;

  CREATE TRIGGER IF NOT EXISTS browsing_logs_ad AFTER DELETE ON browsing_logs BEGIN
    INSERT INTO browsing_logs_fts(browsing_logs_fts, rowid, url, title, summary, tags)
    VALUES ('delete', old.id, old.url, old.title, old.summary, old.tags);
  END;

  CREATE TRIGGER IF NOT EXISTS browsing_logs_au AFTER UPDATE ON browsing_logs BEGIN
    INSERT INTO browsing_logs_fts(browsing_logs_fts, rowid, url, title, summary, tags)
    VALUES ('delete', old.id, old.url, old.title, old.summary, old.tags);
    INSERT INTO browsing_logs_fts(rowid, url, title, summary, tags)
    VALUES (new.id, new.url, new.title, new.summary, new.tags);
  END;
`;

/**
 * FTS5 DDL as individual statements — used by opfsWorker.ts (OPFS Worker path)
 * for explicit per-statement error isolation.
 */
export const FTS5_STATEMENTS: string[] = [
  `CREATE VIRTUAL TABLE IF NOT EXISTS browsing_logs_fts USING fts5(
    url, title, summary, tags,
    content='browsing_logs',
    content_rowid='id',
    tokenize='trigram'
  )`,
  `CREATE TRIGGER IF NOT EXISTS browsing_logs_ai AFTER INSERT ON browsing_logs BEGIN
    INSERT INTO browsing_logs_fts(rowid, url, title, summary, tags)
    VALUES (new.id, new.url, new.title, new.summary, new.tags);
  END`,
  `CREATE TRIGGER IF NOT EXISTS browsing_logs_ad AFTER DELETE ON browsing_logs BEGIN
    INSERT INTO browsing_logs_fts(browsing_logs_fts, rowid, url, title, summary, tags)
    VALUES ('delete', old.id, old.url, old.title, old.summary, old.tags);
  END`,
  `CREATE TRIGGER IF NOT EXISTS browsing_logs_au AFTER UPDATE ON browsing_logs BEGIN
    INSERT INTO browsing_logs_fts(browsing_logs_fts, rowid, url, title, summary, tags)
    VALUES ('delete', old.id, old.url, old.title, old.summary, old.tags);
    INSERT INTO browsing_logs_fts(rowid, url, title, summary, tags)
    VALUES (new.id, new.url, new.title, new.summary, new.tags);
  END`,
];
