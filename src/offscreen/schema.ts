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
    gist_synced INTEGER DEFAULT 0,
    content TEXT,
    masked_count INTEGER,
    cleansed_reason TEXT,
    ai_provider TEXT,
    ai_model TEXT,
    ai_duration_ms INTEGER,
    obsidian_duration_ms INTEGER,
    sent_tokens INTEGER,
    received_tokens INTEGER,
    original_tokens INTEGER,
    cleansed_tokens INTEGER,
    page_bytes INTEGER,
    candidate_bytes INTEGER,
    original_bytes INTEGER,
    cleansed_bytes INTEGER,
    ai_summary_original_bytes INTEGER,
    ai_summary_cleansed_bytes INTEGER,
    extracted_sentences_bytes INTEGER,
    extracted_sentences_original_bytes INTEGER,
    fallback_triggered INTEGER DEFAULT 0,
    UNIQUE(url, created_at)
  );

  CREATE INDEX IF NOT EXISTS idx_logs_created ON browsing_logs(created_at);
  CREATE INDEX IF NOT EXISTS idx_logs_domain ON browsing_logs(domain);
  CREATE INDEX IF NOT EXISTS idx_logs_active ON browsing_logs(is_deleted, created_at);
  CREATE INDEX IF NOT EXISTS idx_logs_obsidian ON browsing_logs(obsidian_synced);
`;

/**
 * Index on gist_synced must be created AFTER the ALTER TABLE migration that
 * adds the column, not as part of SCHEMA_SQL — on an existing DB predating
 * this column, CREATE TABLE IF NOT EXISTS is a no-op, so bundling this index
 * into SCHEMA_SQL would fail with "no such column: gist_synced" before the
 * migration ever runs.
 */
export const GIST_SYNCED_INDEX_SQL =
  'CREATE INDEX IF NOT EXISTS idx_logs_gist ON browsing_logs(gist_synced)';

// ============================================================================
// Shared INSERT column definitions
// Order must match SCHEMA_SQL CREATE TABLE (excluding id which is AUTOINCREMENT)
// and BrowsingLogRecord interface.
// ============================================================================

/** Non-PK columns in insert order — single source of truth. */
export const COLUMN_NAMES = [
  'url',
  'title',
  'summary',
  'tags',
  'created_at',
  'domain',
  'visit_duration',
  'scroll_ratio',
  'is_starred',
  'is_deleted',
  'obsidian_synced',
  'gist_synced',
  'content',
  'masked_count',
  'cleansed_reason',
  'ai_provider',
  'ai_model',
  'ai_duration_ms',
  'obsidian_duration_ms',
  'sent_tokens',
  'received_tokens',
  'original_tokens',
  'cleansed_tokens',
  'page_bytes',
  'candidate_bytes',
  'original_bytes',
  'cleansed_bytes',
  'ai_summary_original_bytes',
  'ai_summary_cleansed_bytes',
  'extracted_sentences_bytes',
  'extracted_sentences_original_bytes',
  'fallback_triggered',
] as const;

export const INSERT_COLS = COLUMN_NAMES.join(', ');
export const INSERT_PLACEHOLDERS = COLUMN_NAMES.map(() => '?').join(', ');

/** INSERT without conflict handling (for insert()). */
export const INSERT_SQL = `INSERT INTO browsing_logs (${INSERT_COLS}) VALUES (${INSERT_PLACEHOLDERS})`;

/**
 * Fields allowed in UPDATE SET clauses across all backends.
 * Must be kept in sync with the INSERT columns — any field that can be
 * inserted should also be updatable. OPFS Worker uses a dynamic iteration
 * of the change payload so it doesn't use this list, but the IDB-VFS and
 * FallbackStorage paths both apply this whitelist to prevent arbitrary field updates.
 */
export const UPDATABLE_FIELDS = [
  'url', 'title', 'summary', 'tags', 'domain',
  'visit_duration', 'scroll_ratio', 'is_starred', 'is_deleted',
  'obsidian_synced', 'gist_synced',
  'content', 'masked_count', 'cleansed_reason',
  'ai_provider', 'ai_model', 'ai_duration_ms', 'obsidian_duration_ms',
  'sent_tokens', 'received_tokens', 'original_tokens', 'cleansed_tokens',
  'page_bytes', 'candidate_bytes', 'original_bytes', 'cleansed_bytes',
  'ai_summary_original_bytes', 'ai_summary_cleansed_bytes',
  'extracted_sentences_bytes', 'extracted_sentences_original_bytes',
  'fallback_triggered',
];

/** INSERT OR IGNORE (for insertBatch() and migration). */
export const INSERT_IGNORE_SQL = `INSERT OR IGNORE INTO browsing_logs (${INSERT_COLS}) VALUES (${INSERT_PLACEHOLDERS})`;

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

/**
 * Audit log for cloud AI provider send events.
 * Records provider name, target URL, and timestamp only — never content or PII.
 */
export const AUDIT_LOG_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL,
    url TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at);
`;
