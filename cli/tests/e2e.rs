//! End-to-end tests for the Yasumaro CLI (Task 5).
//!
//! Each test builds a scratch fixture DB + scratch config inside its own
//! temp dir, then drives the real binary (`CARGO_BIN_EXE_yasumaro`) with a
//! hermetic env (`YASUMARO_CONFIG`/`YASUMARO_DB` set or removed explicitly,
//! cwd = temp dir). Nothing touches the real clipboard or writes outside
//! the temp dir. Clipboard-mock coverage lives in the `dispatch` unit
//! tests in `src/main.rs`; these tests cover process behavior: exit codes,
//! stdout shapes, `--out` files, and env handling.

use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};

/// `2026-01-10T00:00:00Z`, `2026-01-15T12:00:00Z`, `2026-01-12T00:00:00Z`.
const DAY_10: i64 = 1_768_003_200_000;
const DAY_15_NOON: i64 = 1_768_478_400_000;
const DAY_12: i64 = 1_768_176_000_000;

fn unique_dir(tag: &str) -> PathBuf {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    let dir = std::env::temp_dir().join(format!("yasumaro-e2e-{}-{n}-{tag}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("temp dir");
    dir
}

fn fixture_db(path: &Path) {
    let conn = rusqlite::Connection::open(path).expect("fixture db");
    conn.execute_batch(
        "CREATE TABLE browsing_logs (\
         id INTEGER PRIMARY KEY, url TEXT, title TEXT, summary TEXT, tags TEXT, \
         created_at INTEGER, domain TEXT, visit_duration INTEGER, scroll_ratio REAL, \
         is_starred INTEGER, is_deleted INTEGER, obsidian_synced INTEGER, gist_synced INTEGER);",
    )
    .expect("schema");
    conn.execute(
        "INSERT INTO browsing_logs VALUES (1, 'https://example.com/guide', \
         'TypeScript Guide', 'a guide', 'docs', ?1, 'example.com', 120, 0.5, 1, 0, 0, 0)",
        [DAY_10],
    )
    .expect("row 1");
    conn.execute(
        "INSERT INTO browsing_logs VALUES (2, 'https://other.org/news', \
         'Daily News', 'news', 'news', ?1, 'other.org', 30, 0.25, 0, 0, 0, 0)",
        [DAY_15_NOON],
    )
    .expect("row 2");
    conn.execute(
        "INSERT INTO browsing_logs VALUES (3, 'https://example.com/old', \
         'Old Post', 'old', 'docs', ?1, 'example.com', 5, 0.1, 0, 1, 0, 0)",
        [DAY_12],
    )
    .expect("deleted row");
}

struct Fixture {
    dir: PathBuf,
    db: PathBuf,
    config: PathBuf,
}

impl Fixture {
    /// Temp dir with a seeded DB and an (empty-by-default) config file.
    fn new(tag: &str, config_text: &str) -> Self {
        let dir = unique_dir(tag);
        let db = dir.join("history.db");
        let config = dir.join("config.toml");
        fixture_db(&db);
        std::fs::write(&config, config_text).expect("config fixture");
        Self { dir, db, config }
    }

    /// Base command: hermetic env, cwd inside the temp dir.
    fn command(&self) -> Command {
        let mut cmd = Command::new(env!("CARGO_BIN_EXE_yasumaro"));
        cmd.current_dir(&self.dir)
            .env_remove("YASUMARO_DB")
            .env_remove("YASUMARO_CONFIG")
            .env("YASUMARO_CONFIG", &self.config)
            .env("TERM", "dumb");
        cmd
    }

    /// Command with the DB passed via env instead of `--db`.
    fn command_env_db(&self) -> Command {
        let mut cmd = self.command();
        cmd.env("YASUMARO_DB", &self.db);
        cmd
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

fn run(cmd: &mut Command) -> (i32, String, String) {
    let output = cmd.output().expect("binary must run");
    (
        output.status.code().unwrap_or(-1),
        String::from_utf8(output.stdout).expect("stdout UTF-8"),
        String::from_utf8(output.stderr).expect("stderr UTF-8"),
    )
}

#[test]
fn version_prints_name_and_version() {
    let fix = Fixture::new("version", "");
    let mut cmd = fix.command();
    cmd.arg("--version");
    let (code, stdout, _) = run(&mut cmd);
    assert_eq!(code, 0);
    assert_eq!(stdout, format!("yasumaro {}\n", env!("CARGO_PKG_VERSION")));
}

#[test]
fn help_lists_commands_and_resolution() {
    let fix = Fixture::new("help", "");
    let mut cmd = fix.command();
    cmd.arg("--help");
    let (code, stdout, _) = run(&mut cmd);
    assert_eq!(code, 0);
    for needle in [
        "yasumaro search",
        "yasumaro list",
        "yasumaro show",
        "yasumaro stats",
        "yasumaro export",
        "yasumaro config",
        "--db > $YASUMARO_DB > config db_path > ./yasumaro.db",
    ] {
        assert!(stdout.contains(needle), "help missing: {needle}");
    }
}

#[test]
fn unknown_command_exits_2() {
    let fix = Fixture::new("bad-cmd", "");
    let mut cmd = fix.command();
    cmd.arg("frobnicate");
    let (code, _, stderr) = run(&mut cmd);
    assert_eq!(code, 2);
    assert!(!stderr.is_empty());
}

#[test]
fn unknown_flag_exits_2() {
    let fix = Fixture::new("bad-flag", "");
    let mut cmd = fix.command();
    cmd.args(["search", "--bogus", "--db"]);
    cmd.arg(&fix.db);
    let (code, _, stderr) = run(&mut cmd);
    assert_eq!(code, 2);
    assert!(!stderr.is_empty());
}

#[test]
fn search_without_query_exits_2() {
    let fix = Fixture::new("no-query", "");
    let mut cmd = fix.command();
    cmd.args(["search", "--db"]);
    cmd.arg(&fix.db);
    let (code, _, stderr) = run(&mut cmd);
    assert_eq!(code, 2);
    assert!(stderr.contains("search requires --query TEXT"), "{stderr}");
}

#[test]
fn search_json_returns_js_shaped_rows() {
    let fix = Fixture::new("search-json", "");
    let mut cmd = fix.command();
    cmd.args(["search", "--query", "Guide", "--json", "--db"]);
    cmd.arg(&fix.db);
    let (code, stdout, _) = run(&mut cmd);
    assert_eq!(code, 0);
    let rows: serde_json::Value = serde_json::from_str(&stdout).expect("JSON array");
    let rows = rows.as_array().expect("array");
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0]["url"], "https://example.com/guide");
    assert_eq!(rows[0]["domain"], "example.com");
    assert_eq!(rows[0]["is_starred"], 1);
    assert_eq!(rows[0]["created_at"], DAY_10);
}

#[test]
fn db_env_var_is_used_without_flag() {
    // `YASUMARO_DB` handling: no `--db` flag, DB still resolves.
    let fix = Fixture::new("env-db", "");
    let mut cmd = fix.command_env_db();
    cmd.args(["search", "--query", "News", "--json"]);
    let (code, stdout, _) = run(&mut cmd);
    assert_eq!(code, 0);
    let rows: serde_json::Value = serde_json::from_str(&stdout).expect("JSON");
    assert_eq!(rows.as_array().expect("array").len(), 1);
}

#[test]
fn list_from_to_filters_rows() {
    let fix = Fixture::new("list-range", "");
    let mut cmd = fix.command();
    cmd.args(["list", "--from", "2026-01-11", "--json", "--db"]);
    cmd.arg(&fix.db);
    let (code, stdout, _) = run(&mut cmd);
    assert_eq!(code, 0);
    let rows: serde_json::Value = serde_json::from_str(&stdout).expect("JSON");
    let rows = rows.as_array().expect("array");
    assert_eq!(rows.len(), 1, "only the Jan 15 row is in range");
    assert_eq!(rows[0]["id"], 2);

    // `--to` is end-of-day inclusive: Jan 15 noon still matches `--to Jan 15`.
    let mut cmd = fix.command();
    cmd.args([
        "list",
        "--from",
        "2026-01-10",
        "--to",
        "2026-01-15",
        "--json",
        "--db",
    ]);
    cmd.arg(&fix.db);
    let (code, stdout, _) = run(&mut cmd);
    assert_eq!(code, 0);
    let rows: serde_json::Value = serde_json::from_str(&stdout).expect("JSON");
    assert_eq!(rows.as_array().expect("array").len(), 2);
}

#[test]
fn show_missing_reports_not_found_with_zero_exit() {
    let fix = Fixture::new("show-missing", "");
    let mut cmd = fix.command();
    cmd.args(["show", "--id", "999", "--db"]);
    cmd.arg(&fix.db);
    let (code, stdout, _) = run(&mut cmd);
    assert_eq!(code, 0);
    assert_eq!(stdout, "not found\n");
}

#[test]
fn stats_text_and_json() {
    let fix = Fixture::new("stats", "");
    let mut cmd = fix.command();
    cmd.args(["stats", "--db"]);
    cmd.arg(&fix.db);
    let (code, stdout, _) = run(&mut cmd);
    assert_eq!(code, 0);
    assert!(stdout.contains("count: 2"), "{stdout}");

    let mut cmd = fix.command();
    cmd.args(["stats", "--json", "--db"]);
    cmd.arg(&fix.db);
    let (code, stdout, _) = run(&mut cmd);
    assert_eq!(code, 0);
    let value: serde_json::Value = serde_json::from_str(&stdout).expect("stats JSON");
    assert_eq!(value["version"], 1);
    assert_eq!(value["command"], "stats");
    assert_eq!(value["count"], 2);
    assert_eq!(value["minCreatedAt"], DAY_10);
}

#[test]
fn export_csv_to_out_file() {
    let fix = Fixture::new("export-csv", "");
    let out = fix.dir.join("out.csv");
    let mut cmd = fix.command();
    cmd.args(["export", "--format", "csv", "--out"]);
    cmd.arg(&out);
    cmd.arg("--db");
    cmd.arg(&fix.db);
    let (code, stdout, _) = run(&mut cmd);
    assert_eq!(code, 0);
    assert!(stdout.is_empty(), "stdout stays silent with --out");
    let text = std::fs::read_to_string(&out).expect("export file");
    let mut lines = text.lines();
    assert_eq!(
        lines.next().expect("header"),
        "id,url,title,summary,tags,created_at,domain,visit_duration,\
         scroll_ratio,is_starred,is_deleted,obsidian_synced,gist_synced"
    );
    assert!(text.contains("https://example.com/guide"));
    // Two live rows; the deleted row is excluded.
    assert_eq!(text.lines().count(), 3);
}

#[test]
fn export_invalid_format_exits_2() {
    let fix = Fixture::new("export-fmt", "");
    let mut cmd = fix.command();
    cmd.args(["export", "--format", "xlsx", "--db"]);
    cmd.arg(&fix.db);
    let (code, _, stderr) = run(&mut cmd);
    assert_eq!(code, 2);
    assert!(stderr.contains("invalid --format: xlsx"), "{stderr}");
}

#[test]
fn export_write_failure_exits_1() {
    let fix = Fixture::new("export-fail", "");
    // The temp dir itself cannot be overwritten as a file.
    let mut cmd = fix.command();
    cmd.args(["export", "--format", "csv", "--out"]);
    cmd.arg(&fix.dir);
    cmd.arg("--db");
    cmd.arg(&fix.db);
    let (code, _, stderr) = run(&mut cmd);
    assert_eq!(code, 1);
    assert!(stderr.contains("cannot write"), "{stderr}");
}

#[test]
fn config_json_reports_resolution() {
    let fix = Fixture::new("config-json", "limit = 7\n");
    let mut cmd = fix.command_env_db();
    cmd.args(["config", "--json"]);
    let (code, stdout, _) = run(&mut cmd);
    assert_eq!(code, 0);
    let value: serde_json::Value = serde_json::from_str(&stdout).expect("config JSON");
    assert_eq!(value["command"], "config");
    assert_eq!(value["config"]["limit"], 7);
    assert_eq!(
        value["config"]["db"],
        serde_json::Value::String(fix.db.to_string_lossy().into_owned())
    );
}

#[test]
fn repl_help_over_pipe_and_history_saved() {
    let dir = unique_dir("repl");
    let db = dir.join("history.db");
    let history = dir.join("hist");
    let config = dir.join("config.toml");
    fixture_db(&db);
    std::fs::write(&config, format!("history_file = '{}'\n", history.display()))
        .expect("config fixture");
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_yasumaro"));
    cmd.current_dir(&dir)
        .env_remove("YASUMARO_DB")
        .env_remove("YASUMARO_CONFIG")
        .env("YASUMARO_CONFIG", &config)
        .env("YASUMARO_DB", &db)
        .env("TERM", "dumb")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = cmd.spawn().expect("repl must spawn");
    child
        .stdin
        .take()
        .expect("piped stdin")
        .write_all(b"help\nsearch Guide\nexit\n")
        .expect("write repl input");
    let output = child.wait_with_output().expect("repl must exit");
    assert_eq!(output.status.code(), Some(0));
    let stdout = String::from_utf8(output.stdout).expect("stdout UTF-8");
    assert!(stdout.contains("Available commands:"), "{stdout}");
    assert!(stdout.contains("TypeScript Guide"), "{stdout}");
    // History lands in the temp file (session lines, including `exit`).
    let saved = std::fs::read_to_string(&history).expect("history file");
    assert_eq!(saved, "help\nsearch Guide\nexit\n");
    let _ = std::fs::remove_dir_all(&dir);
}
