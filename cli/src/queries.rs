//! Query layer for the Yasumaro CLI.
//!
//! Ports the semantics of the JS reference (`tools/yasumaro-cli/queries.mjs`
//! on branch `feature/yasumaro-cli`) exactly:
//!
//! - [`DISPLAY_COLUMNS`] filtered by the real `browsing_logs` columns; the
//!   `SELECT` list is built dynamically so missing columns simply yield
//!   `None` fields instead of failing.
//! - [`sanitize_fts_term`]: strip `"` characters, trim, truncate to 200 chars.
//! - [`escape_like`]: escape `\`, `%`, `_` for `LIKE ... ESCAPE '\'`.
//! - filters: `is_deleted = 0` always, plus optional `domain`, `starred`,
//!   `tag` (`tags LIKE %tag%`), `from_ms` (`created_at >=`), `to_ms`
//!   (`created_at <=`).
//! - [`search_logs`]: empty term is a usage error (exit 2); FTS `MATCH` with
//!   a `"sanitized"` phrase when the FTS table exists and the sanitized term
//!   is at least [`FTS_MIN_CHARS`] chars, otherwise a `LIKE` fallback over
//!   `url`/`title`/`summary`/`tags`.
//! - [`list_logs`]: filters only, `ORDER BY created_at DESC`.
//! - [`get_by_id`]: single row by id (no `is_deleted` filter, like the JS).
//! - [`get_stats`]: live count, `MIN`/`MAX(created_at)`, top domains
//!   (`LIMIT 10`, `count DESC, domain ASC`, non-null domains only) and
//!   per-day counts (`date(created_at/1000,'unixepoch')`, `LIMIT 30`).
//!
//! Date parsing (`--from`/`--to` strings, `--to` end-of-day inclusive) stays
//! a CLI-layer concern for Task 5: every query here takes resolved
//! `from_ms`/`to_ms: Option<i64>` millisecond bounds.
//!
//! JS correspondence map (drift detector; JS ref commit `a4889355` on branch
//! `feature/yasumaro-cli`, read-only via
//! `git show feature/yasumaro-cli:tools/yasumaro-cli/queries.mjs`):
//!
//! | JS (`queries.mjs`) | Rust (this file) | check |
//! | `:4` `DISPLAY_COLUMNS` (13 cols) | `:36-50` | same names and order |
//! | `:6` `FTS_MIN_CHARS = 3` | `:52` | exact value |
//! | `:7` `SEARCH_MAX_CHARS = 200` | `:55` | exact value |
//! | `:19-21` `sanitizeFtsTerm` | `:145` `sanitize_fts_term` | strip `"`, trim, truncate 200 |
//! | `:23-25` `escapeLike` | `:155` `escape_like` | escape `\`, `%`, `_` |
//! | `:27-38` `filters` | `:179` `build_filters` | `is_deleted = 0` plus domain/starred/tag/from/to |
//! | `:40-60` `searchLogs` | `:317` `search_logs` | empty term is exit 2; FTS `MATCH` when FTS table exists and sanitized term is at least 3 chars, else `LIKE` over url/title/summary/tags |
//! | `:62-70` `listLogs` | `:373` `list_logs` | filters only, `ORDER BY created_at DESC` |
//! | `:72-75` `getById` | `:389` `get_by_id` | no `is_deleted` filter |
//! | `:77-88` `getStats` | `:405` `get_stats` | live count, `MIN`/`MAX(created_at)`, top 10 domains, per-day `LIMIT 30` |
//!
//! Length-unit edge: JS `.slice(0, 200)` and `[...s].length` count UTF-16
//! units / code points, while Rust `.chars()` counts scalar values. They
//! agree on BMP text and may differ on non-BMP input; keep the truncation
//! and FTS-threshold behavior aligned when either side changes.
//! Drift procedure: re-run the `git show` above at a new ref, diff each JS
//! row against its Rust row, and move both sides (or record `TO CHECK`)
//! before changing behavior.

use rusqlite::types::Value;
use rusqlite::{Connection, OptionalExtension, Row};
use serde::Serialize;

use crate::db::CliError;

/// Columns the CLI ever displays, in display order (JS `DISPLAY_COLUMNS`).
/// Only the subset that really exists in the database is selected.
pub const DISPLAY_COLUMNS: &[&str] = &[
    "id",
    "url",
    "title",
    "summary",
    "tags",
    "created_at",
    "domain",
    "visit_duration",
    "scroll_ratio",
    "is_starred",
    "is_deleted",
    "obsidian_synced",
    "gist_synced",
];

/// Minimum sanitized-term length (in chars) for the FTS path (JS `FTS_MIN_CHARS`).
pub const FTS_MIN_CHARS: usize = 3;
/// Maximum search-term length (in chars, JS `SEARCH_MAX_CHARS`).
pub const SEARCH_MAX_CHARS: usize = 200;

/// One `browsing_logs` row, restricted to [`DISPLAY_COLUMNS`].
///
/// Every field is `Option` so databases that lack some display column still
/// map cleanly: unselected columns stay `None`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Record {
    pub id: Option<i64>,
    pub url: Option<String>,
    pub title: Option<String>,
    pub summary: Option<String>,
    pub tags: Option<String>,
    pub created_at: Option<i64>,
    pub domain: Option<String>,
    pub visit_duration: Option<i64>,
    pub scroll_ratio: Option<f64>,
    pub is_starred: Option<i64>,
    pub is_deleted: Option<i64>,
    pub obsidian_synced: Option<i64>,
    pub gist_synced: Option<i64>,
}

/// Filter set shared by `search_logs` and `list_logs` (JS `q` object).
///
/// `from_ms`/`to_ms` are resolved millisecond bounds; `--to` end-of-day
/// expansion happens in the CLI layer (Task 5).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LogQuery {
    /// Exact `domain = ?` match.
    pub domain: Option<String>,
    /// Substring `tags LIKE %tag%` match (LIKE-escaped).
    pub tag: Option<String>,
    /// When true, require `is_starred = 1`.
    pub starred: bool,
    /// `created_at >= from_ms`.
    pub from_ms: Option<i64>,
    /// `created_at <= to_ms` (already end-of-day expanded by the caller).
    pub to_ms: Option<i64>,
    /// `LIMIT` (JS default 50).
    pub limit: i64,
    /// `OFFSET` (JS default 0).
    pub offset: i64,
}

impl Default for LogQuery {
    fn default() -> Self {
        Self {
            domain: None,
            tag: None,
            starred: false,
            from_ms: None,
            to_ms: None,
            limit: 50,
            offset: 0,
        }
    }
}

/// One top-domain bucket of [`Stats`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DomainCount {
    pub domain: String,
    pub count: i64,
}

/// One per-day bucket of [`Stats`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DayCount {
    pub day: String,
    pub count: i64,
}

/// Database statistics (JS `getStats` shape; serde names use the JS camelCase
/// keys so later `--json` output matches the JS CLI).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Stats {
    pub count: i64,
    #[serde(rename = "minCreatedAt")]
    pub min_created_at: Option<i64>,
    #[serde(rename = "maxCreatedAt")]
    pub max_created_at: Option<i64>,
    #[serde(rename = "topDomains")]
    pub top_domains: Vec<DomainCount>,
    #[serde(rename = "perDay")]
    pub per_day: Vec<DayCount>,
}

/// Strip `"` characters, trim, truncate to 200 chars (JS `sanitizeFtsTerm`).
#[must_use]
pub fn sanitize_fts_term(term: &str) -> String {
    term.replace('"', "")
        .trim()
        .chars()
        .take(SEARCH_MAX_CHARS)
        .collect()
}

/// Escape `\`, `%`, `_` for `LIKE ... ESCAPE '\'` (JS `escapeLike`).
#[must_use]
pub fn escape_like(term: &str) -> String {
    term.replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

/// Display columns that really exist, in display order.
fn select_columns(conn: &Connection) -> Result<Vec<String>, CliError> {
    let real = crate::db::real_columns(conn)?;
    Ok(DISPLAY_COLUMNS
        .iter()
        .filter(|column| real.iter().any(|name| name == *column))
        .map(|column| (*column).to_owned())
        .collect())
}

/// WHERE fragment plus bound params for the shared filters.
///
/// `prefix` qualifies column refs (e.g. `"b."` for the FTS join).
struct FilterParts {
    sql: String,
    params: Vec<Value>,
}

fn build_filters(query: &LogQuery, prefix: &str) -> FilterParts {
    let mut conditions = vec![format!("{prefix}is_deleted = 0")];
    let mut params = Vec::new();
    if let Some(domain) = &query.domain {
        conditions.push(format!("{prefix}domain = ?"));
        params.push(Value::Text(domain.clone()));
    }
    if query.starred {
        conditions.push(format!("{prefix}is_starred = 1"));
    }
    if let Some(tag) = &query.tag {
        conditions.push(format!("{prefix}tags LIKE ? ESCAPE '\\'"));
        params.push(Value::Text(format!("%{}%", escape_like(tag))));
    }
    if let Some(from_ms) = query.from_ms {
        conditions.push(format!("{prefix}created_at >= ?"));
        params.push(Value::Integer(from_ms));
    }
    if let Some(to_ms) = query.to_ms {
        conditions.push(format!("{prefix}created_at <= ?"));
        params.push(Value::Integer(to_ms));
    }
    FilterParts {
        sql: conditions.join(" AND "),
        params,
    }
}

fn value_to_string(value: &Value) -> Option<String> {
    match value {
        Value::Text(text) => Some(text.clone()),
        Value::Integer(number) => Some(number.to_string()),
        Value::Real(number) => Some(number.to_string()),
        Value::Null | Value::Blob(_) => None,
    }
}

fn value_to_i64(value: &Value) -> Option<i64> {
    match value {
        Value::Integer(number) => Some(*number),
        Value::Real(number) => Some(*number as i64),
        Value::Text(text) => text.parse::<i64>().ok(),
        Value::Null | Value::Blob(_) => None,
    }
}

fn value_to_f64(value: &Value) -> Option<f64> {
    match value {
        Value::Real(number) => Some(*number),
        Value::Integer(number) => Some(*number as f64),
        Value::Text(text) => text.parse::<f64>().ok(),
        Value::Null | Value::Blob(_) => None,
    }
}

/// Map the current row onto [`Record`] using the selected column names.
///
/// `columns[i]` is the display-column name selected at position `i`, so a
/// missing table column is simply never assigned and stays `None`.
fn record_from_row(row: &Row<'_>, columns: &[String]) -> rusqlite::Result<Record> {
    let mut record = Record {
        id: None,
        url: None,
        title: None,
        summary: None,
        tags: None,
        created_at: None,
        domain: None,
        visit_duration: None,
        scroll_ratio: None,
        is_starred: None,
        is_deleted: None,
        obsidian_synced: None,
        gist_synced: None,
    };
    for (index, column) in columns.iter().enumerate() {
        let value: Value = row.get(index)?;
        match column.as_str() {
            "id" => record.id = value_to_i64(&value),
            "url" => record.url = value_to_string(&value),
            "title" => record.title = value_to_string(&value),
            "summary" => record.summary = value_to_string(&value),
            "tags" => record.tags = value_to_string(&value),
            "created_at" => record.created_at = value_to_i64(&value),
            "domain" => record.domain = value_to_string(&value),
            "visit_duration" => record.visit_duration = value_to_i64(&value),
            "scroll_ratio" => record.scroll_ratio = value_to_f64(&value),
            "is_starred" => record.is_starred = value_to_i64(&value),
            "is_deleted" => record.is_deleted = value_to_i64(&value),
            "obsidian_synced" => record.obsidian_synced = value_to_i64(&value),
            "gist_synced" => record.gist_synced = value_to_i64(&value),
            _ => {}
        }
    }
    Ok(record)
}

fn internal(message: String) -> CliError {
    CliError::Internal(message)
}

/// Prepare a statement, mapping failures to a query error.
fn prepare<'conn>(
    conn: &'conn Connection,
    sql: &str,
) -> Result<rusqlite::Statement<'conn>, CliError> {
    conn.prepare(sql)
        .map_err(|err| internal(format!("query failed: {err}")))
}

/// Run a `SELECT` built by the query functions and map every row.
fn run_select(
    conn: &Connection,
    sql: &str,
    params: Vec<Value>,
    columns: &[String],
) -> Result<Vec<Record>, CliError> {
    let mut statement = prepare(conn, sql)?;
    let rows = statement
        .query_map(rusqlite::params_from_iter(params.iter()), |row| {
            record_from_row(row, columns)
        })
        .map_err(|err| internal(format!("query failed: {err}")))?;
    let mut records = Vec::new();
    for row in rows {
        records.push(row.map_err(|err| internal(format!("cannot read row: {err}")))?);
    }
    Ok(records)
}

fn require_columns(conn: &Connection) -> Result<Vec<String>, CliError> {
    let columns = select_columns(conn)?;
    if columns.is_empty() {
        return Err(internal(
            "browsing_logs table has none of the expected columns".to_owned(),
        ));
    }
    Ok(columns)
}

/// Full-text / substring search over the history (JS `searchLogs` parity).
///
/// An empty (post-trim, truncated) term is a usage error (exit 2). The FTS
/// path needs the `browsing_logs_fts` table plus at least [`FTS_MIN_CHARS`]
/// sanitized chars; anything shorter falls back to `LIKE`.
pub fn search_logs(
    conn: &Connection,
    term: &str,
    query: &LogQuery,
) -> Result<Vec<Record>, CliError> {
    let clean: String = term.trim().chars().take(SEARCH_MAX_CHARS).collect();
    if clean.is_empty() {
        return Err(CliError::Usage("search requires --query TEXT".to_owned()));
    }
    let columns = require_columns(conn)?;
    let sanitized = sanitize_fts_term(&clean);
    let use_fts = crate::db::has_fts(conn)? && sanitized.chars().count() >= FTS_MIN_CHARS;
    let prefix = if use_fts { "b." } else { "" };
    let filters = build_filters(query, prefix);
    // Each branch supplies its SELECT text plus the head params (the MATCH
    // phrase or the four LIKE patterns); the filter params, paging, and the
    // run itself are shared below.
    let (sql, head): (String, Vec<Value>) = if use_fts {
        let select = columns
            .iter()
            .map(|column| format!("b.{column}"))
            .collect::<Vec<_>>()
            .join(", ");
        let sql = format!(
            "SELECT {select} FROM browsing_logs_fts \
             JOIN browsing_logs b ON browsing_logs_fts.rowid = b.id \
             WHERE browsing_logs_fts MATCH ? AND {} \
             ORDER BY b.created_at DESC LIMIT ? OFFSET ?",
            filters.sql
        );
        (sql, vec![Value::Text(format!("\"{sanitized}\""))])
    } else {
        let select = columns.join(", ");
        let sql = format!(
            "SELECT {select} FROM browsing_logs \
             WHERE (url LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\' \
             OR summary LIKE ? ESCAPE '\\' OR tags LIKE ? ESCAPE '\\') \
             AND {} ORDER BY created_at DESC LIMIT ? OFFSET ?",
            filters.sql
        );
        let like = format!("%{}%", escape_like(&clean));
        let head = vec![like; 4].into_iter().map(Value::Text).collect();
        (sql, head)
    };
    let mut params = head;
    params.extend(filters.params);
    params.push(Value::Integer(query.limit));
    params.push(Value::Integer(query.offset));
    run_select(conn, &sql, params, &columns)
}

/// Filtered history listing, newest first (JS `listLogs` parity).
pub fn list_logs(conn: &Connection, query: &LogQuery) -> Result<Vec<Record>, CliError> {
    let columns = require_columns(conn)?;
    let filters = build_filters(query, "");
    let sql = format!(
        "SELECT {} FROM browsing_logs WHERE {} ORDER BY created_at DESC LIMIT ? OFFSET ?",
        columns.join(", "),
        filters.sql
    );
    let mut params = filters.params;
    params.push(Value::Integer(query.limit));
    params.push(Value::Integer(query.offset));
    run_select(conn, &sql, params, &columns)
}

/// One row by id, or `None` when absent (JS `getById` parity: no
/// `is_deleted` filter, so deleted rows are still returned).
pub fn get_by_id(conn: &Connection, id: i64) -> Result<Option<Record>, CliError> {
    let columns = require_columns(conn)?;
    let sql = format!(
        "SELECT {} FROM browsing_logs WHERE id = ?",
        columns.join(", ")
    );
    let mut statement = prepare(conn, &sql)?;
    statement
        .query_row([id], |row| record_from_row(row, &columns))
        .optional()
        .map_err(|err| internal(format!("query failed: {err}")))
}

/// Live-row statistics (JS `getStats` parity).
pub fn get_stats(conn: &Connection) -> Result<Stats, CliError> {
    const LIVE: &str = "is_deleted = 0";
    let count: i64 = conn
        .query_row(
            &format!("SELECT COUNT(*) FROM browsing_logs WHERE {LIVE}"),
            [],
            |row| row.get(0),
        )
        .map_err(|err| internal(format!("query failed: {err}")))?;
    let (min_created_at, max_created_at): (Option<i64>, Option<i64>) = conn
        .query_row(
            &format!("SELECT MIN(created_at), MAX(created_at) FROM browsing_logs WHERE {LIVE}"),
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|err| internal(format!("query failed: {err}")))?;
    let mut domains = prepare(
        conn,
        &format!(
            "SELECT domain, COUNT(*) FROM browsing_logs \
             WHERE {LIVE} AND domain IS NOT NULL \
             GROUP BY domain ORDER BY COUNT(*) DESC, domain ASC LIMIT 10"
        ),
    )?;
    let top_domains = domains
        .query_map([], |row| {
            Ok(DomainCount {
                domain: row.get(0)?,
                count: row.get(1)?,
            })
        })
        .map_err(|err| internal(format!("query failed: {err}")))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| internal(format!("cannot read row: {err}")))?;
    let mut days = prepare(
        conn,
        &format!(
            "SELECT date(created_at / 1000, 'unixepoch'), COUNT(*) FROM browsing_logs \
             WHERE {LIVE} GROUP BY date(created_at / 1000, 'unixepoch') \
             ORDER BY date(created_at / 1000, 'unixepoch') ASC LIMIT 30"
        ),
    )?;
    let per_day = days
        .query_map([], |row| {
            Ok(DayCount {
                day: row.get(0)?,
                count: row.get(1)?,
            })
        })
        .map_err(|err| internal(format!("query failed: {err}")))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| internal(format!("cannot read row: {err}")))?;
    Ok(Stats {
        count,
        min_created_at,
        max_created_at,
        top_domains,
        per_day,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU64, Ordering};

    const DAY_10: i64 = 1768003200000;
    const DAY_12: i64 = 1768176000000;
    const DAY_15: i64 = 1768435200000;
    const DAY_18: i64 = 1768694400000;

    const FULL_SCHEMA: &str = "CREATE TABLE browsing_logs (\
        id INTEGER PRIMARY KEY AUTOINCREMENT, \
        url TEXT NOT NULL, title TEXT, summary TEXT, tags TEXT, \
        created_at INTEGER NOT NULL, domain TEXT, visit_duration INTEGER, \
        scroll_ratio REAL, is_starred INTEGER DEFAULT 0, is_deleted INTEGER DEFAULT 0, \
        obsidian_synced INTEGER DEFAULT 0, gist_synced INTEGER DEFAULT 0)";

    const SEED_ROWS: &str = "INSERT INTO browsing_logs \
        (url, title, summary, tags, created_at, domain, is_starred, is_deleted) VALUES \
        ('https://example.com/guide', 'TypeScript Guide', 'a practical guide to types', 'docs', 1768003200000, 'example.com', 1, 0), \
        ('https://other.org/news', 'Daily News', 'world events roundup', 'news', 1768435200000, 'other.org', 0, 0), \
        ('https://example.com/old', 'Old Guide', 'outdated guide kept for reference', 'docs', 1768867200000, 'example.com', 0, 1)";

    const FTS_SCHEMA: &str = "CREATE VIRTUAL TABLE browsing_logs_fts \
        USING fts5(url, title, summary, tags, tokenize='trigram')";

    const FTS_SEED: &str = "INSERT INTO browsing_logs_fts(rowid, url, title, summary, tags) \
        SELECT id, url, title, summary, tags FROM browsing_logs";

    /// Unique temp DB path so parallel tests never share a file.
    fn unique_db_path(tag: &str) -> PathBuf {
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        std::env::temp_dir().join(format!(
            "yasumaro-queries-test-{}-{n}-{tag}.db",
            std::process::id()
        ))
    }

    fn remove_db(path: &Path) {
        let _ = std::fs::remove_file(path);
    }

    /// Scratch DB with the full JS-parity schema and seed rows.
    ///
    /// Returns the read-only handle plus whether the FTS table exists (when
    /// `with_fts` is set but FTS5 is unavailable the table creation fails and
    /// the test must skip FTS assertions rather than fail).
    fn fixture_db(with_fts: bool) -> (Connection, PathBuf, bool) {
        let path = unique_db_path(if with_fts { "fts" } else { "plain" });
        assert!(!path.exists(), "fixture path must be fresh");
        let writer = Connection::open(&path).expect("test fixture: create db");
        writer
            .execute_batch(&format!("{FULL_SCHEMA}; {SEED_ROWS};"))
            .expect("test fixture: seed rows");
        let mut fts_present = false;
        if with_fts {
            match writer.execute_batch(&format!("{FTS_SCHEMA}; {FTS_SEED};")) {
                Ok(()) => fts_present = true,
                Err(_) => fts_present = false,
            }
        }
        drop(writer);
        let reader = crate::db::open_readonly(&path).expect("test fixture: reopen read-only");
        (reader, path, fts_present)
    }

    fn titles(records: &[Record]) -> Vec<&str> {
        records
            .iter()
            .map(|record| record.title.as_deref().unwrap_or_default())
            .collect()
    }

    #[test]
    fn sanitize_fts_term_strips_quotes_trims_truncates() {
        assert_eq!(sanitize_fts_term("\"hello\""), "hello");
        assert_eq!(sanitize_fts_term("  spaced  "), "spaced");
        assert_eq!(sanitize_fts_term("a\"b\"c"), "abc");
        let long = "x".repeat(250);
        assert_eq!(sanitize_fts_term(&long).chars().count(), 200);
        assert_eq!(sanitize_fts_term(""), "");
    }

    #[test]
    fn escape_like_escapes_specials() {
        assert_eq!(escape_like("100%"), "100\\%");
        assert_eq!(escape_like("a_b"), "a\\_b");
        assert_eq!(escape_like("a\\b"), "a\\\\b");
        assert_eq!(escape_like("plain"), "plain");
        assert_eq!(escape_like("%_\\"), "\\%\\_\\\\");
    }

    #[test]
    fn search_rejects_empty_term() {
        let (conn, path, _) = fixture_db(false);
        for term in ["", "   "] {
            let err =
                search_logs(&conn, term, &LogQuery::default()).expect_err("empty term must fail");
            assert_eq!(err.to_string(), "search requires --query TEXT");
            assert_eq!(err.exit_code(), 2);
        }
        remove_db(&path);
    }

    #[test]
    fn search_fts_when_available() {
        let (conn, path, fts_present) = fixture_db(true);
        if !fts_present {
            remove_db(&path);
            return;
        }
        let rows = search_logs(&conn, "Guide", &LogQuery::default()).expect("FTS search");
        assert_eq!(titles(&rows), ["TypeScript Guide"]);
        // Quoted input is sanitized to the same phrase query.
        let rows = search_logs(&conn, "\"Guide\"", &LogQuery::default()).expect("quoted FTS");
        assert_eq!(titles(&rows), ["TypeScript Guide"]);
        remove_db(&path);
    }

    #[test]
    fn search_like_fallback_without_fts() {
        let (conn, path, _) = fixture_db(false);
        let rows = search_logs(&conn, "Guide", &LogQuery::default()).expect("LIKE search");
        assert_eq!(titles(&rows), ["TypeScript Guide"]);
        remove_db(&path);
    }

    #[test]
    fn short_term_uses_like_even_with_fts() {
        // "Ne" is 2 chars: LIKE even when the FTS table exists.
        let (conn, path, _) = fixture_db(true);
        let rows = search_logs(&conn, "Ne", &LogQuery::default()).expect("short-term search");
        assert_eq!(titles(&rows), ["Daily News"]);
        remove_db(&path);
    }

    #[test]
    fn search_excludes_deleted_rows() {
        for with_fts in [true, false] {
            let (conn, path, fts_present) = fixture_db(with_fts);
            if with_fts && !fts_present {
                remove_db(&path);
                continue;
            }
            let rows =
                search_logs(&conn, "Old Guide", &LogQuery::default()).expect("deleted search");
            assert!(rows.is_empty(), "deleted rows must be excluded");
            remove_db(&path);
        }
    }

    #[test]
    fn search_escapes_like_wildcards() {
        // No seed row contains a literal % or _; unescaped wildcards would
        // match everything, so empty results prove escaping.
        let (conn, path, _) = fixture_db(false);
        for term in ["%", "_"] {
            let rows = search_logs(&conn, term, &LogQuery::default()).expect("wildcard search");
            assert!(rows.is_empty(), "wildcard {term} must be escaped");
        }
        remove_db(&path);
    }

    #[test]
    fn search_honours_domain_and_starred_filters() {
        let (conn, path, fts_present) = fixture_db(true);
        if !fts_present {
            remove_db(&path);
            return;
        }
        let query = LogQuery {
            domain: Some("other.org".to_owned()),
            ..LogQuery::default()
        };
        let rows = search_logs(&conn, "News", &query).expect("domain match");
        assert_eq!(titles(&rows), ["Daily News"]);
        let query = LogQuery {
            domain: Some("example.com".to_owned()),
            ..LogQuery::default()
        };
        let rows = search_logs(&conn, "News", &query).expect("domain mismatch");
        assert!(rows.is_empty());
        let query = LogQuery {
            starred: true,
            ..LogQuery::default()
        };
        let rows = search_logs(&conn, "Guide", &query).expect("starred match");
        assert_eq!(titles(&rows), ["TypeScript Guide"]);
        let rows = search_logs(&conn, "News", &query).expect("starred mismatch");
        assert!(rows.is_empty());
        remove_db(&path);
    }

    #[test]
    fn search_and_list_honour_tag_filter() {
        let (conn, path, _) = fixture_db(false);
        let query = LogQuery {
            tag: Some("docs".to_owned()),
            ..LogQuery::default()
        };
        let rows = list_logs(&conn, &query).expect("tag list");
        assert_eq!(titles(&rows), ["TypeScript Guide"]);
        let query = LogQuery {
            tag: Some("news".to_owned()),
            ..LogQuery::default()
        };
        let rows = search_logs(&conn, "Guide", &query).expect("tag mismatch");
        assert!(rows.is_empty());
        remove_db(&path);
    }

    #[test]
    fn list_filters_by_date_range() {
        let (conn, path, _) = fixture_db(false);
        let query = LogQuery {
            from_ms: Some(DAY_12),
            to_ms: Some(DAY_18),
            ..LogQuery::default()
        };
        assert_eq!(
            titles(&list_logs(&conn, &query).expect("range list")),
            ["Daily News"]
        );
        let query = LogQuery {
            from_ms: Some(DAY_12),
            ..LogQuery::default()
        };
        assert_eq!(
            titles(&list_logs(&conn, &query).expect("from list")),
            ["Daily News"]
        );
        let query = LogQuery {
            to_ms: Some(DAY_12),
            ..LogQuery::default()
        };
        assert_eq!(
            titles(&list_logs(&conn, &query).expect("to list")),
            ["TypeScript Guide"]
        );
        remove_db(&path);
    }

    #[test]
    fn search_honours_date_filters() {
        let (conn, path, _) = fixture_db(false);
        let query = LogQuery {
            to_ms: Some(DAY_12),
            ..LogQuery::default()
        };
        assert_eq!(
            titles(&search_logs(&conn, "Guide", &query).expect("dated search")),
            ["TypeScript Guide"]
        );
        let query = LogQuery {
            from_ms: Some(DAY_18),
            ..LogQuery::default()
        };
        assert!(search_logs(&conn, "Guide", &query)
            .expect("dated search")
            .is_empty());
        remove_db(&path);
    }

    #[test]
    fn list_orders_newest_first_and_paginates() {
        let (conn, path, _) = fixture_db(false);
        let all = list_logs(&conn, &LogQuery::default()).expect("list all");
        assert_eq!(titles(&all), ["Daily News", "TypeScript Guide"]);
        let first = list_logs(
            &conn,
            &LogQuery {
                limit: 1,
                offset: 0,
                ..LogQuery::default()
            },
        )
        .expect("page 0");
        assert_eq!(titles(&first), ["Daily News"]);
        let second = list_logs(
            &conn,
            &LogQuery {
                limit: 1,
                offset: 1,
                ..LogQuery::default()
            },
        )
        .expect("page 1");
        assert_eq!(titles(&second), ["TypeScript Guide"]);
        remove_db(&path);
    }

    #[test]
    fn list_starred_and_domain_filters() {
        let (conn, path, _) = fixture_db(false);
        let starred = list_logs(
            &conn,
            &LogQuery {
                starred: true,
                ..LogQuery::default()
            },
        )
        .expect("starred list");
        assert_eq!(titles(&starred), ["TypeScript Guide"]);
        let domain = list_logs(
            &conn,
            &LogQuery {
                domain: Some("other.org".to_owned()),
                ..LogQuery::default()
            },
        )
        .expect("domain list");
        assert_eq!(titles(&domain), ["Daily News"]);
        remove_db(&path);
    }

    #[test]
    fn get_by_id_returns_row_or_none() {
        let (conn, path, _) = fixture_db(false);
        let second = list_logs(
            &conn,
            &LogQuery {
                limit: 1,
                offset: 1,
                ..LogQuery::default()
            },
        )
        .expect("seeded list");
        assert_eq!(second.len(), 1);
        let id = second[0].id.expect("seeded row has an id");
        let row = get_by_id(&conn, id)
            .expect("get_by_id")
            .expect("row must exist");
        assert_eq!(row.url.as_deref(), Some("https://example.com/guide"));
        assert_eq!(get_by_id(&conn, 999_999).expect("missing id"), None);
        remove_db(&path);
    }

    #[test]
    fn get_stats_counts_bounds_domains_per_day() {
        let (conn, path, _) = fixture_db(false);
        let stats = get_stats(&conn).expect("stats");
        assert_eq!(stats.count, 2);
        assert_eq!(stats.min_created_at, Some(DAY_10));
        assert_eq!(stats.max_created_at, Some(DAY_15));
        assert!(stats.top_domains.contains(&DomainCount {
            domain: "example.com".to_owned(),
            count: 1
        }));
        assert!(stats.top_domains.contains(&DomainCount {
            domain: "other.org".to_owned(),
            count: 1
        }));
        assert!(stats.per_day.contains(&DayCount {
            day: "2026-01-10".to_owned(),
            count: 1
        }));
        assert!(stats.per_day.contains(&DayCount {
            day: "2026-01-15".to_owned(),
            count: 1
        }));
        remove_db(&path);
    }

    #[test]
    fn get_stats_empty_table() {
        let path = unique_db_path("empty");
        let writer = Connection::open(&path).expect("test fixture: create db");
        writer
            .execute_batch(FULL_SCHEMA)
            .expect("test fixture: schema only");
        drop(writer);
        let conn = crate::db::open_readonly(&path).expect("test fixture: reopen");
        let stats = get_stats(&conn).expect("empty stats");
        assert_eq!(stats.count, 0);
        assert_eq!(stats.min_created_at, None);
        assert_eq!(stats.max_created_at, None);
        assert!(stats.top_domains.is_empty());
        assert!(stats.per_day.is_empty());
        remove_db(&path);
    }

    #[test]
    fn record_tolerates_missing_columns() {
        let path = unique_db_path("minimal");
        let writer = Connection::open(&path).expect("test fixture: create db");
        // NOTE: `is_deleted` is kept because the shared list/search filters
        // reference it (JS parity: the JS fails the same way without it).
        // All other display columns are omitted to prove SELECT tolerance.
        writer
            .execute_batch(
                "CREATE TABLE browsing_logs (\
                 id INTEGER PRIMARY KEY, url TEXT NOT NULL, created_at INTEGER NOT NULL, \
                 is_deleted INTEGER DEFAULT 0); \
                 INSERT INTO browsing_logs (url, created_at, is_deleted) VALUES \
                 ('https://example.com/only', 1768003200000, 0);",
            )
            .expect("test fixture: minimal schema");
        drop(writer);
        let conn = crate::db::open_readonly(&path).expect("test fixture: reopen");
        let rows = list_logs(&conn, &LogQuery::default()).expect("minimal list");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].url.as_deref(), Some("https://example.com/only"));
        assert_eq!(rows[0].created_at, Some(DAY_10));
        assert_eq!(rows[0].is_deleted, Some(0));
        assert_eq!(rows[0].title, None);
        assert_eq!(rows[0].domain, None);
        let id = rows[0].id.expect("minimal row has an id");
        let row = get_by_id(&conn, id)
            .expect("minimal get")
            .expect("row must exist");
        assert_eq!(row.url.as_deref(), Some("https://example.com/only"));
        remove_db(&path);
    }

    #[test]
    fn stats_serialize_with_js_keys() {
        // `serde_json` is a main dependency since the export work landed, so
        // the key names are read straight off the serialized value.
        let stats = Stats {
            count: 2,
            min_created_at: Some(DAY_10),
            max_created_at: Some(DAY_15),
            top_domains: Vec::new(),
            per_day: Vec::new(),
        };
        let value = serde_json::to_value(&stats).expect("stats must serialize to JSON");
        let fields: Vec<&str> = value
            .as_object()
            .expect("stats serializes as an object")
            .keys()
            .map(String::as_str)
            .collect();
        for key in [
            "count",
            "minCreatedAt",
            "maxCreatedAt",
            "topDomains",
            "perDay",
        ] {
            assert!(
                fields.contains(&key),
                "stats keys missing {key}: {fields:?}"
            );
        }
    }
}
