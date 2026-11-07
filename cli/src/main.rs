use std::path::PathBuf;

use clap::{Args, CommandFactory, FromArgMatches, Parser, Subcommand};

/// Task 5 modules: clap wiring + dispatch live here, the interactive shell
/// in [`repl`]. Earlier tasks built `config` (file + resolution), `db`
/// (read-only open + asserts), `queries`, `output` (display/export/emit),
/// `copy` (clipboard backends) and `params` (flag validation); all are wired
/// below, so the interim `dead_code` allowances are gone.
mod config;
mod copy;
mod db;
mod output;
mod params;
mod queries;
mod repl;

/// Process exit codes shared by all tasks.
/// JS map (`tools/yasumaro-cli/cli.mjs` at ref `a4889355` on branch
/// `feature/yasumaro-cli`): `EXIT_OK = 0` (`:7`) <-> [`EXIT_OK`],
/// `EXIT_ERROR = 1` (`:8`) <-> [`EXIT_ERROR`], `EXIT_USAGE = 2` (`:9`)
/// <-> [`EXIT_USAGE`], `EXIT_COPY = 3` (`:10`) <-> [`EXIT_COPY`].
/// Drift procedure: compare against
/// `git show feature/yasumaro-cli:tools/yasumaro-cli/cli.mjs`.
pub const EXIT_OK: i32 = 0;
pub const EXIT_ERROR: i32 = 1;
pub const EXIT_USAGE: i32 = 2;
pub const EXIT_COPY: i32 = 3;

/// Read-only CLI for exported Yasumaro history databases.
///
/// Bare invocation (no subcommand) starts the interactive shell; every
/// subcommand mirrors the JS reference flags (`tools/yasumaro-cli/args.mjs`
/// on branch `feature/yasumaro-cli`). Value flags stay `String` so the
/// [`params`] parsers — not clap's type errors — produce the JS message
/// text (`invalid --limit: …` and friends, exit 2).
#[derive(Debug, Parser)]
#[command(
    name = "yasumaro",
    version,
    about = "Read-only CLI for exported Yasumaro history databases"
)]
pub(crate) struct Cli {
    #[command(subcommand)]
    pub(crate) command: Option<Commands>,
}

/// Subcommands mirroring the JS `COMMANDS` list.
#[derive(Debug, PartialEq, Eq, Subcommand)]
pub(crate) enum Commands {
    /// Search history (requires --query TEXT)
    Search(SearchArgs),
    /// List history with filters
    List(ListArgs),
    /// Show one record by id
    Show(ShowArgs),
    /// Database statistics
    Stats(StatsArgs),
    /// Export records as json/csv/md
    Export(ExportArgs),
    /// Show resolved config paths and defaults
    Config(ConfigArgs),
}

/// Args map vs JS `tools/yasumaro-cli/args.mjs` (ref `a4889355`):
/// `COMMANDS` (`:9`) <-> [`Commands`]; `VALUE_FLAGS`/`BOOL_FLAGS`
/// (`:11-16`, parsed at `:24-55`) <-> the `#[arg(long)]` flags below.
/// `SearchArgs`/`ListArgs`/`ShowArgs`/`StatsArgs`/`ExportArgs` cover the same
/// per-command flags (`query`, `domain`, `tag`, `starred`, `limit`, `offset`,
/// `from`, `to`, `db`, `json`, `copy`, plus `format`/`out`/`id` where the JS
/// allows them). Parser mechanics differ (JS hand-rolled `parseArgs` vs
/// clap), so drift checks compare flag sets and messages, not parser code.
#[derive(Debug, Default, PartialEq, Eq, Args)]
pub(crate) struct SearchArgs {
    /// Full-text query
    #[arg(long)]
    pub(crate) query: Option<String>,
    /// Exact domain match
    #[arg(long)]
    pub(crate) domain: Option<String>,
    /// Tag substring match
    #[arg(long)]
    pub(crate) tag: Option<String>,
    /// Only starred rows
    #[arg(long)]
    pub(crate) starred: bool,
    /// Max rows (positive integer, default from config)
    #[arg(long)]
    pub(crate) limit: Option<String>,
    /// Rows to skip (default 0)
    #[arg(long)]
    pub(crate) offset: Option<String>,
    /// Earliest date (YYYY-MM-DD or ISO-8601)
    #[arg(long)]
    pub(crate) from: Option<String>,
    /// Latest date, end-of-day inclusive
    #[arg(long)]
    pub(crate) to: Option<String>,
    /// Database path (overrides env/config)
    #[arg(long)]
    pub(crate) db: Option<String>,
    /// JSON output
    #[arg(long)]
    pub(crate) json: bool,
    /// Copy the output to the clipboard
    #[arg(long)]
    pub(crate) copy: bool,
}

#[derive(Debug, Default, PartialEq, Eq, Args)]
pub(crate) struct ListArgs {
    /// Exact domain match
    #[arg(long)]
    pub(crate) domain: Option<String>,
    /// Tag substring match
    #[arg(long)]
    pub(crate) tag: Option<String>,
    /// Only starred rows
    #[arg(long)]
    pub(crate) starred: bool,
    /// Earliest date (YYYY-MM-DD or ISO-8601)
    #[arg(long)]
    pub(crate) from: Option<String>,
    /// Latest date, end-of-day inclusive
    #[arg(long)]
    pub(crate) to: Option<String>,
    /// Max rows (positive integer, default from config)
    #[arg(long)]
    pub(crate) limit: Option<String>,
    /// Rows to skip (default 0)
    #[arg(long)]
    pub(crate) offset: Option<String>,
    /// Database path (overrides env/config)
    #[arg(long)]
    pub(crate) db: Option<String>,
    /// JSON output
    #[arg(long)]
    pub(crate) json: bool,
    /// Copy the output to the clipboard
    #[arg(long)]
    pub(crate) copy: bool,
}

#[derive(Debug, Default, PartialEq, Eq, Args)]
pub(crate) struct ShowArgs {
    /// Record id
    #[arg(long)]
    pub(crate) id: Option<String>,
    /// Database path (overrides env/config)
    #[arg(long)]
    pub(crate) db: Option<String>,
    /// JSON output
    #[arg(long)]
    pub(crate) json: bool,
    /// Copy the output to the clipboard
    #[arg(long)]
    pub(crate) copy: bool,
}

#[derive(Debug, Default, PartialEq, Eq, Args)]
pub(crate) struct StatsArgs {
    /// Database path (overrides env/config)
    #[arg(long)]
    pub(crate) db: Option<String>,
    /// JSON output
    #[arg(long)]
    pub(crate) json: bool,
    /// Copy the output to the clipboard
    #[arg(long)]
    pub(crate) copy: bool,
}

#[derive(Debug, Default, PartialEq, Eq, Args)]
pub(crate) struct ExportArgs {
    /// Export format: json, csv, or md (default json)
    #[arg(long)]
    pub(crate) format: Option<String>,
    /// Full-text query (empty lists with filters)
    #[arg(long)]
    pub(crate) query: Option<String>,
    /// Exact domain match
    #[arg(long)]
    pub(crate) domain: Option<String>,
    /// Tag substring match
    #[arg(long)]
    pub(crate) tag: Option<String>,
    /// Only starred rows
    #[arg(long)]
    pub(crate) starred: bool,
    /// Earliest date (YYYY-MM-DD or ISO-8601)
    #[arg(long)]
    pub(crate) from: Option<String>,
    /// Latest date, end-of-day inclusive
    #[arg(long)]
    pub(crate) to: Option<String>,
    /// Max rows (positive integer, default from config)
    #[arg(long)]
    pub(crate) limit: Option<String>,
    /// Rows to skip (default 0)
    #[arg(long)]
    pub(crate) offset: Option<String>,
    /// Database path (overrides env/config)
    #[arg(long)]
    pub(crate) db: Option<String>,
    /// Write to FILE instead of stdout (only when explicit)
    #[arg(long)]
    pub(crate) out: Option<String>,
    /// Copy the exported text to the clipboard
    #[arg(long)]
    pub(crate) copy: bool,
}

#[derive(Debug, Default, PartialEq, Eq, Args)]
pub(crate) struct ConfigArgs {
    /// JSON output
    #[arg(long)]
    pub(crate) json: bool,
}

/// Process environment inputs for one dispatch: the resolved config file
/// path plus the `$YASUMARO_DB` value read at startup. Threaded through
/// explicitly (instead of read deep inside `with_db`) so tests can point at
/// fixture files without touching process-global env vars.
#[derive(Debug, Clone)]
pub(crate) struct Env {
    pub(crate) config_path: PathBuf,
    pub(crate) env_db: Option<String>,
}

impl Env {
    pub(crate) fn from_process() -> Self {
        Self {
            config_path: config::default_config_path(),
            env_db: std::env::var("YASUMARO_DB").ok(),
        }
    }
}

/// Usage text equivalent to the HELP string in the JS reference
/// (`tools/yasumaro-cli/cli.mjs:12-26` at ref `a4889355`). It doubles as the
/// top-level `--help` long body (see [`parse_cli`]), so the clap help and
/// the JS HELP stay one text.
/// Sentence map (JS `HELP` line <-> `usage_text()` line, 1:1 at the ref):
/// title (`:12`), `Usage:` (`:14`), `search`/`list`/`show`/`stats`/`export`/
/// `config`/shell lines (`:15-21`), `Common flags:` (`:23`), `Config file:`
/// (`:24`), `Database resolution:` (`:25`). Verified identical at the ref;
/// any added/removed/changed sentence is drift and must be mirrored here.
/// Drift procedure: diff against
/// `git show feature/yasumaro-cli:tools/yasumaro-cli/cli.mjs` `HELP`.
/// Note: JS `help-topic`/`version` commands have no Rust counterpart struct;
/// clap serves `--help`/`--version` instead (see `parse_cli` docs).
fn usage_text() -> &'static str {
    "yasumaro - read-only CLI for exported Yasumaro history databases\n\
     \n\
     Usage:\n\
     \x20 yasumaro search --query \"TEXT\" [--domain D] [--tag T] [--starred] [--limit N] [--db PATH] [--json] [--copy]\n\
     \x20 yasumaro list [--domain D] [--tag T] [--starred] [--from DATE] [--to DATE] [--db PATH] [--json] [--copy]\n\
     \x20 yasumaro show --id N [--db PATH] [--json] [--copy]\n\
     \x20 yasumaro stats [--db PATH] [--json]\n\
     \x20 yasumaro export --format json|csv|md [--query TEXT] [--db PATH] [--out FILE]\n\
     \x20 yasumaro config [--json]\n\
     \x20 yasumaro               interactive shell (Ctrl+R searches history, exit to quit)\n\
     \n\
     Common flags: --db PATH  --json  --copy  --limit N  --offset N  --help  --version\n\
     Config file: ~/.config/yasumaro/config.toml (or $YASUMARO_CONFIG)\n\
     Database resolution: --db > $YASUMARO_DB > config db_path > ./yasumaro.db\n"
}

/// Parse stdio args: like `Cli::try_parse` but with the JS-equivalent
/// [`usage_text`] as the `--help` long body. Parse failures print to the
/// right stream and exit with clap's code (0 for help/version, 2 for usage
/// errors — the JS exit-2 parity for unknown commands/flags).
fn parse_cli() -> Cli {
    let command = Cli::command().long_about(usage_text());
    let matches = command
        .try_get_matches_from(std::env::args())
        .unwrap_or_else(|err| err.exit());
    Cli::from_arg_matches(&matches).unwrap_or_else(|err| err.exit())
}

/// Production clipboard backend.
pub(crate) fn real_copy(text: &str) -> Result<(), String> {
    copy::copy_to_clipboard(text)
}

/// Write a [`db::CliError`] to stderr and return its exit code.
fn fail(stderr: &mut dyn std::io::Write, err: &db::CliError) -> i32 {
    let _ = writeln!(stderr, "{err}");
    err.exit_code()
}

/// Open the history database for one command (JS `withDb` parity): load the
/// config file, resolve the DB path (`--db` > `$YASUMARO_DB` > config
/// `db_path` > `./yasumaro.db`), expand `~/`, open read-only, require the
/// `browsing_logs` table, run, then close on drop.
fn with_db<R>(
    cli_db: Option<&str>,
    env: &Env,
    run: impl FnOnce(&rusqlite::Connection, &config::AppConfig) -> Result<R, db::CliError>,
) -> Result<R, db::CliError> {
    let cfg = config::load_config_file(&env.config_path)?;
    let raw = config::resolve_db_path(cli_db, env.env_db.as_deref(), cfg.db_path.as_deref());
    let path = match raw.to_str() {
        Some(text) => config::expand_home(text),
        None => raw,
    };
    let conn = db::open_readonly(&path)?;
    db::assert_browsing_logs(&conn)?;
    run(&conn, &cfg)
}

/// Shared filter flags for search/list/export (one struct so the builder
/// stays under the argument-count lint; JS `parseLimit`/`parseOffset`/
/// `parseDateBound` parity via [`params`], every failure exit 2).
struct FilterFlags<'a> {
    domain: Option<&'a str>,
    tag: Option<&'a str>,
    starred: bool,
    limit: Option<&'a str>,
    offset: Option<&'a str>,
    from: Option<&'a str>,
    to: Option<&'a str>,
}

fn build_query(
    flags: &FilterFlags<'_>,
    default_limit: i64,
) -> Result<queries::LogQuery, db::CliError> {
    Ok(queries::LogQuery {
        domain: flags.domain.map(str::to_owned),
        tag: flags.tag.map(str::to_owned),
        starred: flags.starred,
        from_ms: params::parse_date_bound(flags.from, "--from")?,
        to_ms: params::parse_date_bound(flags.to, "--to")?,
        limit: params::parse_limit(flags.limit, default_limit)?,
        offset: params::parse_offset(flags.offset)?,
    })
}

/// Collect the filter flags out of a search-style args struct.
/// Aggregation point for the search filters (`domain`, `tag`, `starred`,
/// `limit`, `offset`, `from`, `to`), mirroring the JS `filters(q)` field set
/// (`tools/yasumaro-cli/queries.mjs:27-38` at ref `a4889355`); value parsing
/// (`parseLimit`/`parseOffset`/`parseDateBound` parity) lives in [`params`]
/// with usage failures at exit 2.
macro_rules! filter_flags {
    ($args:expr) => {
        FilterFlags {
            domain: $args.domain.as_deref(),
            tag: $args.tag.as_deref(),
            starred: $args.starred,
            limit: $args.limit.as_deref(),
            offset: $args.offset.as_deref(),
            from: $args.from.as_deref(),
            to: $args.to.as_deref(),
        }
    };
}

/// Emit `Ok((text, copy))` through the clipboard-aware [`output::emit`],
/// or report the [`db::CliError`] to stderr with its exit code.
fn emit_or_fail(
    result: Result<(String, bool), db::CliError>,
    stdout: &mut dyn std::io::Write,
    stderr: &mut dyn std::io::Write,
    copy_fn: &dyn Fn(&str) -> Result<(), String>,
) -> i32 {
    match result {
        Ok((text, copy)) => output::emit(&text, copy, stdout, stderr, copy_fn),
        Err(err) => fail(stderr, &err),
    }
}

/// Serialize `value` to pretty JSON (JS `toJson` shape); encoding failures
/// are internal errors (exit 1).
fn json_or_internal<T: serde::Serialize + ?Sized>(value: &T) -> Result<String, db::CliError> {
    output::to_json(value)
        .map_err(|err| db::CliError::Internal(format!("cannot encode JSON: {err}")))
}

/// Render fetched rows as JSON or human-readable text.
fn render_rows(
    rows: &[queries::Record],
    json: bool,
    copy: bool,
) -> Result<(String, bool), db::CliError> {
    let text = if json {
        json_or_internal(rows)?
    } else {
        output::format_rows(rows)
    };
    Ok((text, copy))
}

fn run_search(
    args: &SearchArgs,
    env: &Env,
    stdout: &mut dyn std::io::Write,
    stderr: &mut dyn std::io::Write,
    copy_fn: &dyn Fn(&str) -> Result<(), String>,
) -> i32 {
    let result = with_db(args.db.as_deref(), env, |conn, cfg| {
        let query = build_query(&filter_flags!(args), cfg.limit)?;
        let rows = queries::search_logs(conn, args.query.as_deref().unwrap_or(""), &query)?;
        render_rows(&rows, args.json, args.copy)
    });
    emit_or_fail(result, stdout, stderr, copy_fn)
}

fn run_list(
    args: &ListArgs,
    env: &Env,
    stdout: &mut dyn std::io::Write,
    stderr: &mut dyn std::io::Write,
    copy_fn: &dyn Fn(&str) -> Result<(), String>,
) -> i32 {
    let result = with_db(args.db.as_deref(), env, |conn, cfg| {
        let query = build_query(&filter_flags!(args), cfg.limit)?;
        let rows = queries::list_logs(conn, &query)?;
        render_rows(&rows, args.json, args.copy)
    });
    emit_or_fail(result, stdout, stderr, copy_fn)
}

fn run_show(
    args: &ShowArgs,
    env: &Env,
    stdout: &mut dyn std::io::Write,
    stderr: &mut dyn std::io::Write,
    copy_fn: &dyn Fn(&str) -> Result<(), String>,
) -> i32 {
    let result = with_db(args.db.as_deref(), env, |conn, _cfg| {
        let id = params::parse_id(args.id.as_deref())?;
        let row = queries::get_by_id(conn, id)?;
        // A missing id prints `not found` (or JSON `null`) with exit 0,
        // like the JS `formatRecord`/`toJson(row ?? null)` flow.
        let text = if args.json {
            json_or_internal(&row)?
        } else {
            output::format_record(row.as_ref())
        };
        Ok((text, args.copy))
    });
    emit_or_fail(result, stdout, stderr, copy_fn)
}

fn run_stats(
    args: &StatsArgs,
    env: &Env,
    stdout: &mut dyn std::io::Write,
    stderr: &mut dyn std::io::Write,
    copy_fn: &dyn Fn(&str) -> Result<(), String>,
) -> i32 {
    let result = with_db(args.db.as_deref(), env, |conn, _cfg| {
        let stats = queries::get_stats(conn)?;
        if stats.count == 0 && !args.json {
            return Ok(("no records\n".to_owned(), args.copy));
        }
        let text = if args.json {
            // JS `toJson({ version: 1, command: 'stats', ...stats })` shape.
            let value = serde_json::json!({
                "version": 1,
                "command": "stats",
                "count": stats.count,
                "minCreatedAt": stats.min_created_at,
                "maxCreatedAt": stats.max_created_at,
                "topDomains": stats.top_domains,
                "perDay": stats.per_day,
            });
            json_or_internal(&value)?
        } else {
            output::format_stats(&stats)
        };
        Ok((text, args.copy))
    });
    emit_or_fail(result, stdout, stderr, copy_fn)
}

fn run_export(
    args: &ExportArgs,
    env: &Env,
    stdout: &mut dyn std::io::Write,
    stderr: &mut dyn std::io::Write,
    copy_fn: &dyn Fn(&str) -> Result<(), String>,
) -> i32 {
    // JS `parsed.options.format ?? 'json'` plus the `invalid --format` guard.
    let format_name = args.format.as_deref().unwrap_or("json");
    if !matches!(format_name, "json" | "csv" | "md") {
        let shown = args.format.as_deref().unwrap_or("");
        return fail(
            stderr,
            &db::CliError::Usage(format!("invalid --format: {shown}")),
        );
    }
    let result = with_db(args.db.as_deref(), env, |conn, cfg| {
        let query = build_query(&filter_flags!(args), cfg.limit)?;
        let term = args.query.as_deref().unwrap_or("").trim();
        let rows = if term.is_empty() {
            queries::list_logs(conn, &query)?
        } else {
            queries::search_logs(conn, term, &query)?
        };
        match format_name {
            "csv" => {
                let real = db::real_columns(conn)?;
                let columns: Vec<&str> = queries::DISPLAY_COLUMNS
                    .iter()
                    .copied()
                    .filter(|column| real.iter().any(|name| name == column))
                    .collect();
                output::export_csv(&rows, &columns)
            }
            "md" => Ok(output::export_md(&rows)),
            _ => json_or_internal(&rows),
        }
    });
    let text = match result {
        Ok(text) => text,
        Err(err) => return fail(stderr, &err),
    };
    // `--out FILE` writes the file only when explicit; write failures are
    // exit 1 (JS `cannot write …` parity). With `--copy` the same string
    // goes to the clipboard while stdout stays silent.
    if let Some(out) = args.out.as_deref() {
        if let Err(err) = std::fs::write(out, &text) {
            let _ = writeln!(stderr, "cannot write {out}: {err}");
            return EXIT_ERROR;
        }
        if args.copy {
            return match copy_fn(&text) {
                Ok(()) => EXIT_OK,
                Err(reason) => {
                    let failure = db::CliError::Copy(reason);
                    let _ = writeln!(stderr, "copy failed: {failure}");
                    failure.exit_code()
                }
            };
        }
        return EXIT_OK;
    }
    output::emit(&text, args.copy, stdout, stderr, copy_fn)
}

fn run_config(
    args: &ConfigArgs,
    env: &Env,
    stdout: &mut dyn std::io::Write,
    stderr: &mut dyn std::io::Write,
) -> i32 {
    let cfg = match config::load_config_file(&env.config_path) {
        Ok(cfg) => cfg,
        Err(err) => {
            let failure: db::CliError = err.into();
            return fail(stderr, &failure);
        }
    };
    // Like the JS `runConfig`, only env + config feed the DB resolution
    // (the `config` subcommand takes no `--db` flag).
    let db_path = config::resolve_db_path(None, env.env_db.as_deref(), cfg.db_path.as_deref());
    if args.json {
        // JS `toJson({ version: 1, command: 'config', config: effective })`.
        let value = serde_json::json!({
            "version": 1,
            "command": "config",
            "config": {
                "configFile": env.config_path.to_string_lossy(),
                "db": db_path.to_string_lossy(),
                "limit": cfg.limit,
                "history_file": cfg.history_file,
                "history_max_lines": cfg.history_max_lines,
            },
        });
        return match output::to_json(&value) {
            Ok(text) => {
                if stdout.write_all(text.as_bytes()).is_err() {
                    EXIT_ERROR
                } else {
                    EXIT_OK
                }
            }
            Err(err) => fail(
                stderr,
                &db::CliError::Internal(format!("cannot encode JSON: {err}")),
            ),
        };
    }
    let text = format!(
        "configFile: {}\ndb: {}\nlimit: {}\nhistory_file: {}\nhistory_max_lines: {}\n",
        env.config_path.display(),
        db_path.display(),
        cfg.limit,
        cfg.history_file,
        cfg.history_max_lines
    );
    if stdout.write_all(text.as_bytes()).is_err() {
        EXIT_ERROR
    } else {
        EXIT_OK
    }
}

/// Dispatch one parsed subcommand (JS `runCommand` parity); shared by
/// [`parse_cli`] and the REPL so both spellings run identical code.
pub(crate) fn dispatch(
    command: &Commands,
    env: &Env,
    stdout: &mut dyn std::io::Write,
    stderr: &mut dyn std::io::Write,
    copy_fn: &dyn Fn(&str) -> Result<(), String>,
) -> i32 {
    match command {
        Commands::Search(args) => run_search(args, env, stdout, stderr, copy_fn),
        Commands::List(args) => run_list(args, env, stdout, stderr, copy_fn),
        Commands::Show(args) => run_show(args, env, stdout, stderr, copy_fn),
        Commands::Stats(args) => run_stats(args, env, stdout, stderr, copy_fn),
        Commands::Export(args) => run_export(args, env, stdout, stderr, copy_fn),
        Commands::Config(args) => run_config(args, env, stdout, stderr),
    }
}

fn real_main() -> i32 {
    let cli = parse_cli();
    match cli.command {
        // Bare invocation starts the interactive shell (JS null-command).
        None => repl::run_repl(),
        Some(command) => {
            let stdout = std::io::stdout();
            let mut out = stdout.lock();
            let stderr = std::io::stderr();
            let mut err_out = stderr.lock();
            let env = Env::from_process();
            dispatch(&command, &env, &mut out, &mut err_out, &real_copy)
        }
    }
}

fn main() {
    std::process::exit(real_main());
}

#[cfg(test)]
mod tests {
    use super::*;
    use clap::Parser;
    use std::path::Path;
    use std::sync::atomic::{AtomicU64, Ordering};

    /// Unique temp path so parallel tests never share a file.
    fn unique_temp_path(tag: &str) -> PathBuf {
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        std::env::temp_dir().join(format!(
            "yasumaro-dispatch-test-{}-{n}-{tag}",
            std::process::id()
        ))
    }

    /// Scratch history DB: two live rows (Jan 10 + Jan 15) and one deleted
    /// row, mirroring the epoch constants used across the suite
    /// (`2026-01-10T00:00:00Z` = `1_768_003_200_000`).
    const BROWSING_LOGS_SCHEMA: &str = "CREATE TABLE browsing_logs (\
         id INTEGER PRIMARY KEY, url TEXT, title TEXT, summary TEXT, tags TEXT, \
         created_at INTEGER, domain TEXT, visit_duration INTEGER, scroll_ratio REAL, \
         is_starred INTEGER, is_deleted INTEGER, obsidian_synced INTEGER, gist_synced INTEGER);";

    fn fixture_db(path: &Path) {
        let conn = rusqlite::Connection::open(path).expect("fixture: create db");
        conn.execute_batch(BROWSING_LOGS_SCHEMA)
            .expect("fixture: create table");
        conn.execute_batch(
            "INSERT INTO browsing_logs VALUES \
             (1, 'https://example.com/guide', 'TypeScript Guide', 'a guide', 'docs', \
              1768003200000, 'example.com', 120, 0.5, 1, 0, 0, 0), \
             (2, 'https://other.org/news', 'Daily News', 'news', 'news', \
              1768478400000, 'other.org', 30, 0.25, 0, 0, 0, 0), \
             (3, 'https://example.com/old', 'Old Post', 'old', 'docs', \
              1768176000000, 'example.com', 5, 0.1, 0, 1, 0, 0);",
        )
        .expect("fixture: seed rows");
    }

    /// `Env` pointing at a temp config file; `db_path` inside the config is
    /// left empty so tests pass the DB explicitly (or via `env_db`).
    fn fixture_env(config_text: &str) -> (Env, PathBuf) {
        let config_path = unique_temp_path("config.toml");
        std::fs::write(&config_path, config_text).expect("fixture: write config");
        (
            Env {
                config_path: config_path.clone(),
                env_db: None,
            },
            config_path,
        )
    }

    /// Dispatch with `db_path` pointing at `db`, capturing stdout/stderr and
    /// using `copy_result` as the injected clipboard backend (no real
    /// clipboard in tests). Returns `(code, stdout, stderr, copied)`.
    fn run_with(
        command: &Commands,
        db: &Path,
        copy_result: Result<(), String>,
    ) -> (i32, String, String, Vec<String>) {
        let (env, config_path) = fixture_env("");
        let env = Env {
            env_db: Some(db.to_string_lossy().into_owned()),
            ..env
        };
        let mut stdout = Vec::new();
        let mut stderr = Vec::new();
        let copied = std::cell::RefCell::new(Vec::new());
        let code = dispatch(command, &env, &mut stdout, &mut stderr, &|text: &str| {
            copied.borrow_mut().push(text.to_owned());
            copy_result.clone()
        });
        let _ = std::fs::remove_file(&config_path);
        let copied_text: Vec<String> = copied.borrow().clone();
        (
            code,
            String::from_utf8(stdout).expect("stdout UTF-8"),
            String::from_utf8(stderr).expect("stderr UTF-8"),
            copied_text,
        )
    }

    fn search_command(query: &str, json: bool) -> Commands {
        Commands::Search(SearchArgs {
            query: Some(query.to_owned()),
            json,
            ..Default::default()
        })
    }

    #[test]
    fn exit_codes_match_spec() {
        assert_eq!(EXIT_OK, 0);
        assert_eq!(EXIT_ERROR, 1);
        assert_eq!(EXIT_USAGE, 2);
        assert_eq!(EXIT_COPY, 3);
    }

    #[test]
    fn help_flag_exits_zero_equivalent() {
        let err =
            Cli::try_parse_from(["yasumaro", "--help"]).expect_err("--help must short-circuit");
        assert_eq!(err.kind(), clap::error::ErrorKind::DisplayHelp);
    }

    #[test]
    fn version_flag_exits_zero_equivalent() {
        let err = Cli::try_parse_from(["yasumaro", "--version"])
            .expect_err("--version must short-circuit");
        assert_eq!(err.kind(), clap::error::ErrorKind::DisplayVersion);
    }

    #[test]
    fn bare_invocation_parses() {
        let cli = Cli::try_parse_from(["yasumaro"]).expect("bare invocation must parse");
        assert_eq!(cli.command, None);
    }

    #[test]
    fn clap_version_matches_package_version() {
        let cmd = Cli::command();
        let version = cmd.get_version().unwrap_or_default();
        assert_eq!(version, env!("CARGO_PKG_VERSION"));
    }

    #[test]
    fn usage_text_covers_commands_and_resolution() {
        let text = usage_text();
        for needle in [
            "yasumaro search",
            "yasumaro list",
            "yasumaro show",
            "yasumaro stats",
            "yasumaro export",
            "yasumaro config",
            "--db > $YASUMARO_DB > config db_path > ./yasumaro.db",
        ] {
            assert!(text.contains(needle), "usage text missing: {needle}");
        }
    }

    #[test]
    fn unknown_command_is_a_parse_error() {
        let err =
            Cli::try_parse_from(["yasumaro", "frobnicate"]).expect_err("unknown command must fail");
        assert_ne!(err.kind(), clap::error::ErrorKind::DisplayHelp);
    }

    #[test]
    fn unknown_flag_is_a_parse_error() {
        let err = Cli::try_parse_from(["yasumaro", "search", "--bogus"])
            .expect_err("unknown flag must fail");
        assert_ne!(err.kind(), clap::error::ErrorKind::DisplayHelp);
    }

    #[test]
    fn subcommands_parse_their_flags() {
        let cli = Cli::try_parse_from([
            "yasumaro",
            "search",
            "--query",
            "Guide",
            "--domain",
            "example.com",
            "--json",
            "--copy",
        ])
        .expect("search flags must parse");
        match cli.command {
            Some(Commands::Search(args)) => {
                assert_eq!(args.query.as_deref(), Some("Guide"));
                assert_eq!(args.domain.as_deref(), Some("example.com"));
                assert!(args.json && args.copy);
            }
            other => panic!("expected search, got {other:?}"),
        }
        let cli = Cli::try_parse_from(["yasumaro", "export", "--format", "csv", "--out", "f"])
            .expect("export flags must parse");
        assert!(matches!(cli.command, Some(Commands::Export(_))));
    }

    #[test]
    fn short_aliases_parse() {
        assert_eq!(
            Cli::try_parse_from(["yasumaro", "-h"])
                .expect_err("-h must short-circuit")
                .kind(),
            clap::error::ErrorKind::DisplayHelp
        );
        assert_eq!(
            Cli::try_parse_from(["yasumaro", "-V"])
                .expect_err("-V must short-circuit")
                .kind(),
            clap::error::ErrorKind::DisplayVersion
        );
    }

    #[test]
    fn search_json_returns_js_shaped_rows() {
        let db = unique_temp_path("search.db");
        fixture_db(&db);
        let (code, stdout, _, _) = run_with(&search_command("Guide", true), &db, Ok(()));
        assert_eq!(code, 0);
        let rows: serde_json::Value =
            serde_json::from_str(&stdout).expect("search --json must be JSON");
        let rows = rows.as_array().expect("search --json is an array");
        assert_eq!(rows.len(), 1, "deleted + off-topic rows must not match");
        assert_eq!(rows[0]["url"], "https://example.com/guide");
        assert_eq!(rows[0]["domain"], "example.com");
        assert_eq!(rows[0]["is_starred"], 1);
        let _ = std::fs::remove_file(&db);
    }

    #[test]
    fn search_text_marks_starred_domain() {
        let db = unique_temp_path("search-text.db");
        fixture_db(&db);
        let (code, stdout, _, _) = run_with(&search_command("Guide", false), &db, Ok(()));
        assert_eq!(code, 0);
        assert!(stdout.contains("example.com"));
        assert!(stdout.contains('*'));
        let _ = std::fs::remove_file(&db);
    }

    #[test]
    fn search_without_query_is_usage_error() {
        let db = unique_temp_path("noquery.db");
        fixture_db(&db);
        let command = Commands::Search(SearchArgs::default());
        let (code, _, stderr, _) = run_with(&command, &db, Ok(()));
        assert_eq!(code, 2);
        assert!(stderr.contains("search requires --query TEXT"), "{stderr}");
        let _ = std::fs::remove_file(&db);
    }

    #[test]
    fn list_from_to_filters_by_day() {
        let db = unique_temp_path("list.db");
        fixture_db(&db);
        let command = Commands::List(ListArgs {
            from: Some("2026-01-11".to_owned()),
            json: true,
            ..Default::default()
        });
        let (code, stdout, _, _) = run_with(&command, &db, Ok(()));
        assert_eq!(code, 0);
        let rows: serde_json::Value = serde_json::from_str(&stdout).expect("list JSON");
        let rows = rows.as_array().expect("array");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["id"], 2);
        let _ = std::fs::remove_file(&db);
    }

    #[test]
    fn show_missing_reports_not_found_with_zero_exit() {
        let db = unique_temp_path("show-missing.db");
        fixture_db(&db);
        let command = Commands::Show(ShowArgs {
            id: Some("999".to_owned()),
            ..Default::default()
        });
        let (code, stdout, _, _) = run_with(&command, &db, Ok(()));
        assert_eq!(code, 0);
        assert_eq!(stdout, "not found\n");
        let _ = std::fs::remove_file(&db);
    }

    #[test]
    fn show_json_missing_is_null() {
        let db = unique_temp_path("show-null.db");
        fixture_db(&db);
        let command = Commands::Show(ShowArgs {
            id: Some("999".to_owned()),
            json: true,
            ..Default::default()
        });
        let (code, stdout, _, _) = run_with(&command, &db, Ok(()));
        assert_eq!(code, 0);
        assert_eq!(stdout.trim_end(), "null");
        let _ = std::fs::remove_file(&db);
    }

    #[test]
    fn stats_empty_reports_no_records() {
        let db = unique_temp_path("stats-empty.db");
        let conn = rusqlite::Connection::open(&db).expect("fixture db");
        // Full column set but zero rows: the stats filters (`is_deleted`,
        // `domain`) need the real columns to exist.
        conn.execute_batch(BROWSING_LOGS_SCHEMA).expect("schema");
        drop(conn);
        let command = Commands::Stats(StatsArgs::default());
        let (code, stdout, _, _) = run_with(&command, &db, Ok(()));
        assert_eq!(code, 0);
        assert_eq!(stdout, "no records\n");
        let _ = std::fs::remove_file(&db);
    }

    #[test]
    fn stats_json_has_envelope() {
        let db = unique_temp_path("stats-json.db");
        fixture_db(&db);
        let command = Commands::Stats(StatsArgs {
            json: true,
            ..Default::default()
        });
        let (code, stdout, _, _) = run_with(&command, &db, Ok(()));
        assert_eq!(code, 0);
        let value: serde_json::Value = serde_json::from_str(&stdout).expect("stats JSON");
        assert_eq!(value["version"], 1);
        assert_eq!(value["command"], "stats");
        assert_eq!(value["count"], 2);
        let _ = std::fs::remove_file(&db);
    }

    #[test]
    fn export_out_writes_file_and_copies_same_string() {
        let db = unique_temp_path("export.db");
        fixture_db(&db);
        let out = unique_temp_path("export.csv");
        let command = Commands::Export(ExportArgs {
            format: Some("csv".to_owned()),
            out: Some(out.to_string_lossy().into_owned()),
            copy: true,
            ..Default::default()
        });
        let (code, stdout, _, copied) = run_with(&command, &db, Ok(()));
        assert_eq!(code, 0);
        assert!(stdout.is_empty(), "stdout stays silent with --out");
        let file_text = std::fs::read_to_string(&out).expect("export file");
        assert_eq!(copied, vec![file_text.clone()]);
        assert!(file_text.starts_with("id,url,title"));
        assert!(file_text.contains("https://example.com/guide"));
        let _ = std::fs::remove_file(&db);
        let _ = std::fs::remove_file(&out);
    }

    #[test]
    fn export_write_failure_exits_1() {
        let db = unique_temp_path("export-fail.db");
        fixture_db(&db);
        // The temp dir itself is not writable as a file: no outside writes.
        let dir = unique_temp_path("export-dir");
        let _ = std::fs::create_dir_all(&dir);
        let command = Commands::Export(ExportArgs {
            format: Some("csv".to_owned()),
            out: Some(dir.to_string_lossy().into_owned()),
            ..Default::default()
        });
        let (code, _, stderr, _) = run_with(&command, &db, Ok(()));
        assert_eq!(code, 1);
        assert!(stderr.contains("cannot write"), "{stderr}");
        let _ = std::fs::remove_file(&db);
        let _ = std::fs::remove_dir(&dir);
    }

    #[test]
    fn export_invalid_format_is_usage_error() {
        let db = unique_temp_path("export-fmt.db");
        fixture_db(&db);
        let command = Commands::Export(ExportArgs {
            format: Some("xlsx".to_owned()),
            ..Default::default()
        });
        let (code, _, stderr, _) = run_with(&command, &db, Ok(()));
        assert_eq!(code, 2);
        assert!(stderr.contains("invalid --format: xlsx"), "{stderr}");
        let _ = std::fs::remove_file(&db);
    }

    #[test]
    fn copy_failure_keeps_output_and_exits_3() {
        let db = unique_temp_path("copy-fail.db");
        fixture_db(&db);
        let command = Commands::Search(SearchArgs {
            query: Some("Guide".to_owned()),
            copy: true,
            ..Default::default()
        });
        let (code, stdout, stderr, _) = run_with(&command, &db, Err("xsel not found".to_owned()));
        assert_eq!(code, 3);
        assert!(stdout.contains("example.com"), "output is kept");
        assert!(stderr.contains("copy failed: xsel not found"), "{stderr}");
        let _ = std::fs::remove_file(&db);
    }

    #[test]
    fn config_text_shows_resolution() {
        let db = unique_temp_path("config.db");
        fixture_db(&db);
        let (env, config_path) = fixture_env("limit = 7\n");
        let env = Env {
            env_db: Some(db.to_string_lossy().into_owned()),
            ..env
        };
        let mut stdout = Vec::new();
        let mut stderr = Vec::new();
        let code = run_config(&ConfigArgs::default(), &env, &mut stdout, &mut stderr);
        assert_eq!(code, 0);
        let text = String::from_utf8(stdout).expect("UTF-8");
        assert!(text.contains("limit: 7"), "{text}");
        assert!(text.contains(&db.to_string_lossy().into_owned()), "{text}");
        assert!(text.contains("history_file: "), "{text}");
        let _ = std::fs::remove_file(&config_path);
        let _ = std::fs::remove_file(&db);
    }

    #[test]
    fn config_json_has_envelope() {
        let db = unique_temp_path("config-json.db");
        fixture_db(&db);
        let (env, config_path) = fixture_env("");
        let env = Env {
            env_db: Some(db.to_string_lossy().into_owned()),
            ..env
        };
        let mut stdout = Vec::new();
        let mut stderr = Vec::new();
        let code = run_config(&ConfigArgs { json: true }, &env, &mut stdout, &mut stderr);
        assert_eq!(code, 0);
        let value: serde_json::Value =
            serde_json::from_str(&String::from_utf8(stdout).expect("UTF-8")).expect("config JSON");
        assert_eq!(value["command"], "config");
        assert_eq!(value["config"]["limit"], 50);
        assert_eq!(
            value["config"]["db"],
            serde_json::Value::String(db.to_string_lossy().into_owned())
        );
        let _ = std::fs::remove_file(&config_path);
        let _ = std::fs::remove_file(&db);
    }

    #[test]
    fn broken_config_is_usage_error() {
        let (env, config_path) = fixture_env("[[[not toml");
        let mut stdout = Vec::new();
        let mut stderr = Vec::new();
        let code = run_config(&ConfigArgs::default(), &env, &mut stdout, &mut stderr);
        assert_eq!(code, 2);
        let _ = std::fs::remove_file(&config_path);
    }
}
