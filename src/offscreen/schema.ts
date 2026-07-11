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

// ============================================================================
// PBI-09: Shared INSERT parameter builder
// Single source of truth for the 30-column parameter array so sqlite.ts,
// opfsWorker.ts, and storageFallback.ts don't each hand-write the same
// record -> params mapping (and risk drifting out of sync on schema changes).
// ============================================================================

/**
 * Minimal shape this builder needs from a browsing log record. Callers pass
 * their own `BrowsingLogRecord`-shaped object; this is intentionally a
 * structural subset so schema.ts doesn't need to import from sqlite-types.ts.
 */
export interface InsertableRecord {
  url: string;
  title?: string | null;
  summary?: string | null;
  tags?: string | null;
  created_at: number;
  visit_duration?: number | null;
  scroll_ratio?: number | null;
  is_starred?: number | null;
  is_deleted?: number | null;
  obsidian_synced?: number | null;
  gist_synced?: number | null;
  content?: string | null;
  masked_count?: number | null;
  cleansed_reason?: string | null;
  ai_provider?: string | null;
  ai_model?: string | null;
  ai_duration_ms?: number | null;
  obsidian_duration_ms?: number | null;
  sent_tokens?: number | null;
  received_tokens?: number | null;
  original_tokens?: number | null;
  cleansed_tokens?: number | null;
  page_bytes?: number | null;
  candidate_bytes?: number | null;
  original_bytes?: number | null;
  cleansed_bytes?: number | null;
  ai_summary_original_bytes?: number | null;
  ai_summary_cleansed_bytes?: number | null;
  extracted_sentences_bytes?: number | null;
  extracted_sentences_original_bytes?: number | null;
  fallback_triggered?: number | null;
}

/**
 * Build the parameter array for INSERT_SQL / INSERT_IGNORE_SQL, in the exact
 * order of COLUMN_NAMES. `domain` is taken as a separate argument (rather
 * than read from the record) because each backend resolves it differently
 * (record.domain || extractDomain(record.url), with slightly different
 * extractDomain implementations) — callers compute it once and pass it in.
 */
export function buildInsertParams(
  record: InsertableRecord,
  domain: string | null
): (string | number | null)[] {
  return [
    record.url,
    record.title ?? null,
    record.summary ?? null,
    record.tags ?? null,
    record.created_at,
    domain,
    record.visit_duration ?? null,
    record.scroll_ratio ?? null,
    record.is_starred ?? 0,
    record.is_deleted ?? 0,
    record.obsidian_synced ?? 0,
    record.gist_synced ?? 0,
    record.content ?? null,
    record.masked_count ?? null,
    record.cleansed_reason ?? null,
    record.ai_provider ?? null,
    record.ai_model ?? null,
    record.ai_duration_ms ?? null,
    record.obsidian_duration_ms ?? null,
    record.sent_tokens ?? null,
    record.received_tokens ?? null,
    record.original_tokens ?? null,
    record.cleansed_tokens ?? null,
    record.page_bytes ?? null,
    record.candidate_bytes ?? null,
    record.original_bytes ?? null,
    record.cleansed_bytes ?? null,
    record.ai_summary_original_bytes ?? null,
    record.ai_summary_cleansed_bytes ?? null,
    record.extracted_sentences_bytes ?? null,
    record.extracted_sentences_original_bytes ?? null,
    record.fallback_triggered ?? 0,
  ];
}

/**
 * Field values for every non-PK column, in the same defaulting semantics as
 * buildInsertParams — `url`/`created_at` stay required and non-null (per
 * InsertableRecord), everything else (including `domain`) is nullable.
 */
export interface InsertRecordFields {
  url: string;
  title: string | null;
  summary: string | null;
  tags: string | null;
  created_at: number;
  domain: string | null;
  visit_duration: number | null;
  scroll_ratio: number | null;
  is_starred: number;
  is_deleted: number;
  obsidian_synced: number;
  gist_synced: number;
  content: string | null;
  masked_count: number | null;
  cleansed_reason: string | null;
  ai_provider: string | null;
  ai_model: string | null;
  ai_duration_ms: number | null;
  obsidian_duration_ms: number | null;
  sent_tokens: number | null;
  received_tokens: number | null;
  original_tokens: number | null;
  cleansed_tokens: number | null;
  page_bytes: number | null;
  candidate_bytes: number | null;
  original_bytes: number | null;
  cleansed_bytes: number | null;
  ai_summary_original_bytes: number | null;
  ai_summary_cleansed_bytes: number | null;
  extracted_sentences_bytes: number | null;
  extracted_sentences_original_bytes: number | null;
  fallback_triggered: number;
}

/**
 * Object-shaped counterpart to `buildInsertParams`, for backends that store
 * plain records instead of executing SQL (storageFallback.ts). Applies the
 * exact same defaulting rules, keyed by column name instead of positional array.
 */
export function buildInsertRecordFields(
  record: InsertableRecord,
  domain: string | null
): InsertRecordFields {
  return {
    url: record.url,
    title: record.title ?? null,
    summary: record.summary ?? null,
    tags: record.tags ?? null,
    created_at: record.created_at,
    domain,
    visit_duration: record.visit_duration ?? null,
    scroll_ratio: record.scroll_ratio ?? null,
    is_starred: record.is_starred ?? 0,
    is_deleted: record.is_deleted ?? 0,
    obsidian_synced: record.obsidian_synced ?? 0,
    gist_synced: record.gist_synced ?? 0,
    content: record.content ?? null,
    masked_count: record.masked_count ?? null,
    cleansed_reason: record.cleansed_reason ?? null,
    ai_provider: record.ai_provider ?? null,
    ai_model: record.ai_model ?? null,
    ai_duration_ms: record.ai_duration_ms ?? null,
    obsidian_duration_ms: record.obsidian_duration_ms ?? null,
    sent_tokens: record.sent_tokens ?? null,
    received_tokens: record.received_tokens ?? null,
    original_tokens: record.original_tokens ?? null,
    cleansed_tokens: record.cleansed_tokens ?? null,
    page_bytes: record.page_bytes ?? null,
    candidate_bytes: record.candidate_bytes ?? null,
    original_bytes: record.original_bytes ?? null,
    cleansed_bytes: record.cleansed_bytes ?? null,
    ai_summary_original_bytes: record.ai_summary_original_bytes ?? null,
    ai_summary_cleansed_bytes: record.ai_summary_cleansed_bytes ?? null,
    extracted_sentences_bytes: record.extracted_sentences_bytes ?? null,
    extracted_sentences_original_bytes: record.extracted_sentences_original_bytes ?? null,
    fallback_triggered: record.fallback_triggered ?? 0,
  };
}

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

// ============================================================================
// Shared query utilities (M16)
// ============================================================================
// sqlite.ts (IDB path) and opfsWorker.ts (OPFS Worker path) had identical
// copies of sanitizeFtsTerm. Full Strategy-pattern unification of the two
// backends' CRUD logic isn't practical — they use different async
// execution models (direct calls vs Worker message passing), and their
// ALLOWED_ORDER_COLUMNS lists differ (sqlite.ts allows more columns) — but
// this backend-agnostic FTS sanitizer is safe to share.

export const FTS_QUERY_MAX_LENGTH = 200;

/**
 * Sanitize user input for FTS5 query syntax.
 * Uses a whitelist approach to prevent SQL injection via FTS5 operators.
 * Returns the sanitized bare term (no surrounding quotes) — used for
 * length-checking before deciding FTS5 vs LIKE.
 */
export function sanitizeFtsTerm(query: string): string {
  if (!query) return '';

  // Limit input length to prevent DoS via extremely long queries
  const truncated = query.slice(0, FTS_QUERY_MAX_LENGTH);

  // Whitelist: only allow alphanumeric, CJK characters, and spaces
  // This prevents FTS5 operator injection (OR, AND, NOT, NEAR, etc.)
  // and special character injection (*, ", ~, ^, :, (, ), +, -)
  return truncated
    .replace(/[^A-Za-z0-9぀-ゟ゠-ヿ一-鿿㐀-䶿\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
