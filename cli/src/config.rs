//! Configuration file handling for the Yasumaro CLI.
//!
//! Mirrors the semantics of the JS reference (`tools/yasumaro-cli/config.mjs`
//! on branch `feature/yasumaro-cli`):
//!
//! - config path: `$YASUMARO_CONFIG` > `$XDG_CONFIG_HOME/yasumaro/config.toml`
//!   > `$HOME/.config/yasumaro/config.toml`
//! - DB path: `--db` > `$YASUMARO_DB` > config `db_path` > `./yasumaro.db`
//! - defaults: `limit = 50`, `history_file = "~/.yasumaro_history"`,
//!   `history_max_lines = 500`
//! - unknown keys are ignored; missing file yields defaults;
//!   broken TOML or invalid values are errors (the caller maps them to
//!   exit code 2 via `From<ConfigError> for crate::db::CliError`).

use std::path::{Path, PathBuf};

use serde::Deserialize;
use thiserror::Error;

/// Default row limit for list/search output (JS `DEFAULT_LIMIT`).
pub const DEFAULT_LIMIT: i64 = 50;
/// Default REPL history file (JS `DEFAULT_HISTORY_FILE`).
pub const DEFAULT_HISTORY_FILE: &str = "~/.yasumaro_history";
/// Default cap on REPL history lines (JS `DEFAULT_HISTORY_MAX_LINES`).
pub const DEFAULT_HISTORY_MAX_LINES: i64 = 500;

/// Fallback DB path when neither flag, env, nor config provides one.
const FALLBACK_DB_PATH: &str = "./yasumaro.db";

/// Effective configuration: every field resolved, missing keys are defaults.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppConfig {
    /// Optional `db_path` from the config file (`None` when absent).
    pub db_path: Option<String>,
    /// Row limit; always positive (validated on load).
    pub limit: i64,
    /// REPL history file; empty string disables history.
    pub history_file: String,
    /// Cap on history lines; zero disables trimming bookkeeping.
    pub history_max_lines: i64,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            db_path: None,
            limit: DEFAULT_LIMIT,
            history_file: DEFAULT_HISTORY_FILE.to_owned(),
            history_max_lines: DEFAULT_HISTORY_MAX_LINES,
        }
    }
}

/// Raw deserialized form: every key optional so absent keys fall back to
/// defaults. Unknown keys are ignored by serde's default behavior.
#[derive(Debug, Deserialize)]
struct RawConfig {
    #[serde(default)]
    db_path: Option<String>,
    #[serde(default)]
    limit: Option<i64>,
    #[serde(default)]
    history_file: Option<String>,
    #[serde(default)]
    history_max_lines: Option<i64>,
}

/// Errors from loading or parsing the config file.
#[derive(Debug, Error)]
pub enum ConfigError {
    /// The file exists but is not valid TOML (exit 2 at the call site).
    #[error("broken config TOML: {0}")]
    Parse(String),
    /// A value failed validation, e.g. `limit = 0` (exit 2 at the call site).
    #[error("{0}")]
    Invalid(String),
    /// The file exists but cannot be read (exit 1 at the call site).
    #[error("cannot read config file: {0}")]
    Io(String),
}

/// Resolve the config file path from explicit overrides (test seam).
///
/// Order mirrors the JS `defaultConfigPath`: `YASUMARO_CONFIG` >
/// `XDG_CONFIG_HOME` > `$HOME/.config`. Empty strings fall through like
/// the JS `||` operator.
fn resolve_config_path(
    yasumaro_config: Option<&str>,
    xdg_config_home: Option<&str>,
    home: Option<&Path>,
) -> PathBuf {
    if let Some(custom) = yasumaro_config {
        if !custom.is_empty() {
            return PathBuf::from(custom);
        }
    }
    let base = match xdg_config_home {
        Some(dir) if !dir.is_empty() => PathBuf::from(dir),
        _ => match home {
            Some(dir) => dir.join(".config"),
            // No home directory is known; keep a relative fallback
            // rather than failing, since the missing file still
            // yields defaults downstream.
            None => PathBuf::from(".config"),
        },
    };
    base.join("yasumaro").join("config.toml")
}

/// Best-effort home directory lookup (cross-platform, like `os.homedir()`).
fn home_dir() -> Option<PathBuf> {
    dirs::home_dir()
}

/// Config file path honoring `YASUMARO_CONFIG` > `XDG_CONFIG_HOME` >
/// `$HOME/.config/yasumaro/config.toml`.
pub fn default_config_path() -> PathBuf {
    resolve_config_path(
        std::env::var("YASUMARO_CONFIG").ok().as_deref(),
        std::env::var("XDG_CONFIG_HOME").ok().as_deref(),
        home_dir().as_deref(),
    )
}

/// Expand a leading `~/` to the home directory (JS `expandHome` parity).
///
/// Only the `~/` prefix is expanded; a bare `~` and all other paths are
/// returned unchanged. When the home directory cannot be determined the
/// path is returned unchanged instead of failing.
pub fn expand_home(path: &str) -> PathBuf {
    match path.strip_prefix("~/") {
        Some(rest) => match home_dir() {
            Some(home) => home.join(rest),
            None => PathBuf::from(path),
        },
        None => PathBuf::from(path),
    }
}

/// Resolve the DB path: `--db` > `$YASUMARO_DB` > config `db_path` >
/// `./yasumaro.db` (JS `resolveDbPath` parity, `??` semantics: an empty
/// string still wins over the fallback).
pub fn resolve_db_path(
    cli_db: Option<&str>,
    env_db: Option<&str>,
    config_db: Option<&str>,
) -> PathBuf {
    cli_db
        .or(env_db)
        .or(config_db)
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(FALLBACK_DB_PATH))
}

/// Parse already-read TOML text into an effective config.
///
/// Unknown keys are ignored; absent keys become defaults. Type mismatches
/// (e.g. `limit = "lots"`) surface as [`ConfigError::Parse`]; out-of-range
/// values as [`ConfigError::Invalid`].
pub fn parse_config_str(text: &str) -> Result<AppConfig, ConfigError> {
    let raw: RawConfig = toml::from_str(text).map_err(|err| ConfigError::Parse(err.to_string()))?;
    AppConfig::try_from(raw)
}

impl TryFrom<RawConfig> for AppConfig {
    type Error = ConfigError;

    fn try_from(raw: RawConfig) -> Result<Self, Self::Error> {
        if let Some(limit) = raw.limit {
            if limit <= 0 {
                return Err(ConfigError::Invalid(
                    "invalid config: limit must be a positive integer".to_owned(),
                ));
            }
        }
        if let Some(max_lines) = raw.history_max_lines {
            if max_lines < 0 {
                return Err(ConfigError::Invalid(
                    "invalid config: history_max_lines must be a non-negative integer".to_owned(),
                ));
            }
        }
        Ok(Self {
            db_path: raw.db_path,
            limit: raw.limit.unwrap_or(DEFAULT_LIMIT),
            history_file: raw
                .history_file
                .unwrap_or_else(|| DEFAULT_HISTORY_FILE.to_owned()),
            history_max_lines: raw.history_max_lines.unwrap_or(DEFAULT_HISTORY_MAX_LINES),
        })
    }
}

/// Load the config file at `path`.
///
/// A missing file yields defaults (JS `ENOENT` parity). Any other read
/// error becomes [`ConfigError::Io`]; content problems become
/// [`ConfigError::Parse`] / [`ConfigError::Invalid`].
pub fn load_config_file(path: &Path) -> Result<AppConfig, ConfigError> {
    match std::fs::read_to_string(path) {
        Ok(text) => parse_config_str(&text),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(AppConfig::default()),
        Err(err) => Err(ConfigError::Io(format!("{}: {err}", path.display()))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    /// Unique temp path so parallel tests never share a file.
    fn unique_temp_path(tag: &str) -> PathBuf {
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        std::env::temp_dir().join(format!(
            "yasumaro-config-test-{}-{n}-{tag}.toml",
            std::process::id()
        ))
    }

    #[test]
    fn resolve_db_path_prefers_cli_over_env_over_config_over_fallback() {
        assert_eq!(
            resolve_db_path(Some("cli.db"), Some("env.db"), Some("cfg.db")),
            PathBuf::from("cli.db")
        );
        assert_eq!(
            resolve_db_path(None, Some("env.db"), Some("cfg.db")),
            PathBuf::from("env.db")
        );
        assert_eq!(
            resolve_db_path(None, None, Some("cfg.db")),
            PathBuf::from("cfg.db")
        );
        assert_eq!(
            resolve_db_path(None, None, None),
            PathBuf::from("./yasumaro.db")
        );
    }

    #[test]
    fn default_config_path_resolution_order() {
        // $YASUMARO_CONFIG wins over everything.
        assert_eq!(
            resolve_config_path(
                Some("/custom/conf.toml"),
                Some("/xdg"),
                Some(Path::new("/home/u"))
            ),
            PathBuf::from("/custom/conf.toml")
        );
        // Then $XDG_CONFIG_HOME.
        assert_eq!(
            resolve_config_path(None, Some("/xdg"), Some(Path::new("/home/u"))),
            PathBuf::from("/xdg/yasumaro/config.toml")
        );
        // Then $HOME/.config.
        assert_eq!(
            resolve_config_path(None, None, Some(Path::new("/home/u"))),
            PathBuf::from("/home/u/.config/yasumaro/config.toml")
        );
        // An empty XDG value falls back, like the JS `||` operator.
        assert_eq!(
            resolve_config_path(None, Some(""), Some(Path::new("/home/u"))),
            PathBuf::from("/home/u/.config/yasumaro/config.toml")
        );
    }

    #[test]
    fn missing_config_file_returns_defaults() {
        let path = unique_temp_path("missing");
        assert!(!path.exists());
        let cfg = load_config_file(&path).expect("missing file must yield defaults");
        assert_eq!(cfg, AppConfig::default());
        assert_eq!(cfg.limit, DEFAULT_LIMIT);
        assert_eq!(cfg.history_file, DEFAULT_HISTORY_FILE);
        assert_eq!(cfg.history_max_lines, DEFAULT_HISTORY_MAX_LINES);
        assert_eq!(cfg.db_path, None);
    }

    #[test]
    fn unknown_keys_are_ignored() {
        let cfg =
            parse_config_str("unknown_key = \"nope\"\nlimit = 10\n").expect("unknown keys ignored");
        assert_eq!(cfg.limit, 10);
        assert_eq!(cfg.history_file, DEFAULT_HISTORY_FILE);
    }

    #[test]
    fn empty_file_yields_defaults() {
        let cfg = parse_config_str("").expect("empty file is valid TOML");
        assert_eq!(cfg, AppConfig::default());
    }

    #[test]
    fn broken_toml_errors() {
        assert!(parse_config_str("[[[not toml").is_err());
        assert!(parse_config_str("limit = \"lots\"").is_err());
        assert!(parse_config_str("limit = 1.5").is_err());
    }

    #[test]
    fn limit_must_be_positive() {
        assert!(parse_config_str("limit = 0").is_err());
        assert!(parse_config_str("limit = -3").is_err());
        let cfg = parse_config_str("limit = 25").expect("positive limit is fine");
        assert_eq!(cfg.limit, 25);
    }

    #[test]
    fn history_max_lines_must_not_be_negative() {
        assert!(parse_config_str("history_max_lines = -1").is_err());
        let cfg = parse_config_str("history_max_lines = 0").expect("zero is fine");
        assert_eq!(cfg.history_max_lines, 0);
    }

    #[test]
    fn validation_messages_mirror_js_reference() {
        let err = parse_config_str("limit = 0").expect_err("limit 0 must fail");
        assert_eq!(
            err.to_string(),
            "invalid config: limit must be a positive integer"
        );
        let err = parse_config_str("history_max_lines = -1").expect_err("negative must fail");
        assert_eq!(
            err.to_string(),
            "invalid config: history_max_lines must be a non-negative integer"
        );
    }

    #[test]
    fn expand_home_expands_tilde_slash_only() {
        let home = home_dir().expect("test environment has a home directory");
        assert_eq!(
            expand_home("~/notes/history.db"),
            home.join("notes/history.db")
        );
        assert_eq!(expand_home("/abs/path"), PathBuf::from("/abs/path"));
        assert_eq!(expand_home("relative/path"), PathBuf::from("relative/path"));
        // JS parity: a bare `~` is left untouched.
        assert_eq!(expand_home("~"), PathBuf::from("~"));
    }

    #[test]
    fn config_file_values_load() {
        let path = unique_temp_path("values");
        std::fs::write(
            &path,
            "db_path = \"/tmp/h.db\"\nlimit = 7\nhistory_file = \"\"\nhistory_max_lines = 0\n",
        )
        .expect("write test fixture");
        let cfg = load_config_file(&path).expect("valid file loads");
        assert_eq!(cfg.db_path.as_deref(), Some("/tmp/h.db"));
        assert_eq!(cfg.limit, 7);
        assert_eq!(cfg.history_file, "");
        assert_eq!(cfg.history_max_lines, 0);
        let _ = std::fs::remove_file(&path);
    }
}
