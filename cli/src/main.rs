use std::io::Write as _;

use clap::Parser;

/// Process exit codes shared by all later tasks.
pub const EXIT_OK: i32 = 0;
pub const EXIT_ERROR: i32 = 1;
pub const EXIT_USAGE: i32 = 2;
pub const EXIT_COPY: i32 = 3;

/// Placeholder CLI for the read-only Yasumaro history database tool.
///
/// Full subcommands (`search`/`list`/`show`/`stats`/`export`/`config` + REPL)
/// arrive in later tasks; for now parsing plus `--help`/`--version` work and
/// any other invocation prints the JS-equivalent usage text.
#[derive(Debug, Parser)]
#[command(
    name = "yasumaro",
    version,
    about = "Read-only CLI for exported Yasumaro history databases"
)]
struct Cli {
    /// Placeholder flag kept so the common-flags surface exists early.
    #[arg(long, global = true)]
    json: bool,
}

/// Usage text equivalent to the HELP string in the JS reference
/// (`tools/yasumaro-cli/cli.mjs`). Kept as a single function so later tasks
/// can reuse it for `help` subcommand output and tests.
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

fn main() {
    let _cli = Cli::parse();
    // Placeholder behavior until subcommands land: print usage to stdout.
    // A broken pipe must not panic: the `io::Result` is intentionally dropped.
    let mut stdout = std::io::stdout().lock();
    let _ = write!(stdout, "{}", usage_text());
    std::process::exit(EXIT_OK);
}

#[cfg(test)]
mod tests {
    use super::*;
    use clap::{CommandFactory, Parser};

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
        assert!(!cli.json);
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
}
