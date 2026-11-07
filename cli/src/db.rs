//! Read-only SQLite access for the Yasumaro CLI.
//!
//! Mirrors the semantics of the JS reference (`tools/yasumaro-cli/db.mjs`
//! on branch `feature/yasumaro-cli`):
//!
//! - the database is opened read-only and never created;
//! - an open failure names the path and points at the Dashboard
//!   Diagnostics/Export flow (caller maps it to exit code 2, like the JS
//!   default `CliError` exit code);
//! - a missing `browsing_logs` table is exit code 1 (JS explicit code).

use std::path::Path;

use rusqlite::{Connection, OpenFlags, OptionalExtension};
use thiserror::Error;

use crate::{EXIT_COPY, EXIT_ERROR, EXIT_USAGE};

/// Process exit codes shared with `main.rs`: Usage -> 2, Db/Internal -> 1,
/// Copy -> 3 (JS `CliError` parity: default 2, missing table 1).
#[derive(Debug, Error)]
pub enum CliError {
    /// Usage or resolution failure (bad flag, unresolvable DB path,
    /// broken TOML): exit 2.
    #[error("{0}")]
    Usage(String),
    /// Database problem (missing `browsing_logs` table, ...): exit 1.
    #[error("{0}")]
    Db(String),
    /// Other internal failure (unexpected query error, ...): exit 1.
    #[error("{0}")]
    Internal(String),
    /// Clipboard copy failure: exit 3.
    #[error("{0}")]
    Copy(String),
}

impl CliError {
    /// Map the error to its process exit code.
    #[must_use]
    pub fn exit_code(&self) -> i32 {
        match self {
            Self::Usage(_) => EXIT_USAGE,
            Self::Db(_) | Self::Internal(_) => EXIT_ERROR,
            Self::Copy(_) => EXIT_COPY,
        }
    }
}

impl From<crate::config::ConfigError> for CliError {
    /// Broken TOML and invalid values are usage errors (exit 2);
    /// an unreadable config file is an internal failure (exit 1).
    fn from(err: crate::config::ConfigError) -> Self {
        match err {
            crate::config::ConfigError::Parse(message)
            | crate::config::ConfigError::Invalid(message) => Self::Usage(message),
            crate::config::ConfigError::Io(message) => Self::Internal(message),
        }
    }
}

/// Open the SQLite database strictly read-only (never creates the file).
///
/// Mirrors the JS `openReadonly` message: the error names `path` and points
/// at the Dashboard Diagnostics/Export flow.
pub fn open_readonly(path: &Path) -> Result<Connection, CliError> {
    Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(|_| {
        CliError::Usage(format!(
            "cannot open database: {}\nExport it first from the Yasumaro dashboard \
             (Diagnostics/Export) or the archive panel, then pass --db PATH.",
            path.display()
        ))
    })
}

/// Whether a table named `name` exists in `sqlite_master`.
fn table_present(conn: &Connection, name: &str) -> Result<bool, CliError> {
    let present: Option<String> = conn
        .query_row(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
            [name],
            |row| row.get(0),
        )
        .optional()
        .map_err(|err| CliError::Internal(format!("cannot inspect database schema: {err}")))?;
    Ok(present.is_some())
}

/// Require the `browsing_logs` table (JS `assertBrowsingLogs` parity).
pub fn assert_browsing_logs(conn: &Connection) -> Result<(), CliError> {
    if table_present(conn, "browsing_logs")? {
        Ok(())
    } else {
        Err(CliError::Db(
            "not a Yasumaro history database: table browsing_logs is missing".to_owned(),
        ))
    }
}

/// Whether the `browsing_logs_fts` table exists (JS `hasFts` parity).
pub fn has_fts(conn: &Connection) -> Result<bool, CliError> {
    table_present(conn, "browsing_logs_fts")
}

/// Real column names of `browsing_logs` via `PRAGMA table_info`.
pub fn real_columns(conn: &Connection) -> Result<Vec<String>, CliError> {
    let mut stmt = conn
        .prepare("PRAGMA table_info(browsing_logs)")
        .map_err(|err| CliError::Internal(format!("cannot inspect database schema: {err}")))?;
    let names = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|err| CliError::Internal(format!("cannot inspect database schema: {err}")))?;
    names
        .map(|name| {
            name.map_err(|err| CliError::Internal(format!("cannot read column name: {err}")))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};

    /// Unique temp DB path so parallel tests never share a file.
    fn unique_db_path(tag: &str) -> PathBuf {
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        std::env::temp_dir().join(format!(
            "yasumaro-db-test-{}-{n}-{tag}.db",
            std::process::id()
        ))
    }

    /// Create a scratch DB file with `schema`; the connection is closed
    /// (dropped) before the test reopens it read-only.
    fn create_db(path: &Path, schema: &str) {
        let conn = Connection::open(path).expect("test fixture: create db");
        conn.execute_batch(schema)
            .expect("test fixture: apply schema");
    }

    /// Remove a scratch DB file; failures are ignored (best effort).
    fn remove_db(path: &Path) {
        let _ = std::fs::remove_file(path);
    }

    const LOGS_SCHEMA: &str = "CREATE TABLE browsing_logs (\
        id INTEGER PRIMARY KEY, \
        url TEXT NOT NULL, \
        title TEXT, \
        created_at INTEGER NOT NULL\
        );";

    #[test]
    fn exit_codes_match_spec() {
        assert_eq!(CliError::Usage("u".to_owned()).exit_code(), 2);
        assert_eq!(CliError::Db("d".to_owned()).exit_code(), 1);
        assert_eq!(CliError::Internal("i".to_owned()).exit_code(), 1);
        assert_eq!(CliError::Copy("c".to_owned()).exit_code(), 3);
    }

    #[test]
    fn readonly_open_missing_file_fails_without_creating() {
        let path = unique_db_path("missing");
        assert!(!path.exists());
        let err = open_readonly(&path).expect_err("missing db must fail");
        assert!(!path.exists(), "read-only open must not create the file");
        let message = err.to_string();
        assert!(
            message.contains(path.to_string_lossy().as_ref()),
            "error must name the path: {message}"
        );
        assert!(
            message.contains("Diagnostics/Export"),
            "error must point at Dashboard Diagnostics/Export: {message}"
        );
        assert_eq!(err.exit_code(), 2);
    }

    #[test]
    fn readonly_open_rejects_writes() {
        let path = unique_db_path("readonly");
        create_db(&path, LOGS_SCHEMA);
        let conn = open_readonly(&path).expect("fixture db must open");
        let write = conn.execute("CREATE TABLE probe (id INTEGER)", []);
        assert!(write.is_err(), "read-only handle must reject writes");
        remove_db(&path);
    }

    #[test]
    fn assert_browsing_logs_detects_missing_table() {
        let path = unique_db_path("notable");
        create_db(&path, "CREATE TABLE other (id INTEGER);");
        let conn = open_readonly(&path).expect("fixture db must open");
        let err = assert_browsing_logs(&conn).expect_err("missing table must fail");
        assert_eq!(
            err.to_string(),
            "not a Yasumaro history database: table browsing_logs is missing"
        );
        assert_eq!(err.exit_code(), 1);
        remove_db(&path);
    }

    #[test]
    fn assert_browsing_logs_passes_when_present() {
        let path = unique_db_path("logs");
        create_db(&path, LOGS_SCHEMA);
        let conn = open_readonly(&path).expect("fixture db must open");
        assert_browsing_logs(&conn).expect("browsing_logs exists");
        remove_db(&path);
    }

    #[test]
    fn has_fts_reports_presence() {
        let with_fts = unique_db_path("fts-yes");
        create_db(
            &with_fts,
            "CREATE TABLE browsing_logs (id INTEGER); \
             CREATE TABLE browsing_logs_fts (term TEXT);",
        );
        let conn = open_readonly(&with_fts).expect("fixture db must open");
        assert!(has_fts(&conn).expect("has_fts must not fail"));

        let without_fts = unique_db_path("fts-no");
        create_db(&without_fts, "CREATE TABLE browsing_logs (id INTEGER);");
        let conn = open_readonly(&without_fts).expect("fixture db must open");
        assert!(!has_fts(&conn).expect("has_fts must not fail"));

        remove_db(&with_fts);
        remove_db(&without_fts);
    }

    #[test]
    fn real_columns_lists_table_columns() {
        let path = unique_db_path("cols");
        create_db(&path, LOGS_SCHEMA);
        let conn = open_readonly(&path).expect("fixture db must open");
        let columns = real_columns(&conn).expect("PRAGMA must succeed");
        for expected in ["id", "url", "created_at"] {
            assert!(
                columns.iter().any(|c| c == expected),
                "missing column {expected}: {columns:?}"
            );
        }
        remove_db(&path);
    }

    #[test]
    fn config_errors_map_to_exit_codes() {
        let broken: CliError = crate::config::parse_config_str("[[[")
            .expect_err("broken TOML must fail")
            .into();
        assert_eq!(broken.exit_code(), 2);

        let invalid: CliError = crate::config::parse_config_str("limit = 0")
            .expect_err("invalid value must fail")
            .into();
        assert_eq!(invalid.exit_code(), 2);
    }
}
