//! Interactive shell (REPL) for the Yasumaro CLI.
//!
//! Ports the JS reference (`tools/yasumaro-cli/repl.mjs` on branch
//! `feature/yasumaro-cli`):
//!
//! - prompt [`REPL_PROMPT`];
//! - [`REPL_HELP`] on `help`, and the `Type 'help' ...` hint after an
//!   unparsable line (written to stdout, like the JS);
//! - `search <words>` shorthand (no `--query`, more than one token): the
//!   remaining tokens are joined with a single space and used as the query,
//!   flags included (JS builds `--query <joined>` the same way, so flags
//!   cannot be combined with the shorthand — use the `--query` form);
//! - `exit`/`.exit`/`quit` and Ctrl+D leave the shell;
//! - history file from config `history_file` (`''` disables), trimmed to
//!   `history_max_lines` on load and on save (`previous ++ new`, like the JS
//!   `trimHistory([...previousLines, ...newLines], maxLines)`).
//!
//! Line editing comes from `rustyline` (MIT): it provides Emacs-style editing
//! and Ctrl+R reverse-i-search natively, which is the JS
//! `node:readline` reverse-i-search parity noted in the plan. The history
//! file itself is managed here (read/trim/add/save) rather than via
//! `rustyline`'s `load_history`/`save_history` so the trim-on-load and
//! empty-line filtering match the JS exactly, including the trailing-newline
//! file layout.

use std::io::Write as _;
use std::path::{Path, PathBuf};

use clap::Parser as _;
use rustyline::error::ReadlineError;

use crate::db::CliError;
use crate::{Commands, Env, SearchArgs};

/// Prompt printed before every REPL line (JS `REPL_PROMPT`).
pub const REPL_PROMPT: &str = "yasumaro> ";

/// Help text printed for the `help` command (JS `REPL_HELP`, verbatim).
pub const REPL_HELP: &str = "Available commands:\n\
                              \x20 search <words> [--domain D] [--tag T] [--starred] [--limit N] [--json]  (or: search --query \"TEXT\" ...)\n\
                              \x20 list [--domain D] [--tag T] [--starred] [--from DATE] [--to DATE] [--json]\n\
                              \x20 show --id N [--json]\n\
                              \x20 stats [--json]\n\
                              \x20 export --format json|csv|md [--query TEXT] [--out FILE]\n\
                              \x20 config [--json]\n\
                              \x20 help            show this help\n\
                              \x20 exit            leave the shell (.exit and quit work too, Ctrl+D also exits)\n\
                              \n\
                              Ctrl+R searches history (native readline reverse-i-search).\n";

/// Hint appended after an unparsable REPL line (JS `UNKNOWN_HINT`).
const UNKNOWN_HINT: &str = "Type 'help' for available commands.";

/// How one REPL line was classified (JS `parseReplLine` result shapes).
#[derive(Debug, PartialEq, Eq)]
pub enum ReplLine {
    /// Blank line: reprompt.
    Empty,
    /// `exit`/`.exit`/`quit`: leave the shell.
    Exit,
    /// `help`: print [`REPL_HELP`].
    Help,
    /// A parsed command, ready for dispatch (boxed: the Args structs are
    /// an order of magnitude larger than the other variants).
    Run(Box<Commands>),
    /// Pre-rendered text to print (subcommand `--help`/`--version`).
    Print(String),
    /// Unparsable line: print `{message}` plus [`UNKNOWN_HINT`].
    Unknown(String),
}

/// Shell-style tokenizing: single/double quotes group words, the quotes are
/// stripped, and an unterminated quote runs to end of line (JS `splitShell`
/// parity; ASCII/Unicode whitespace both split).
#[must_use]
pub fn split_shell(line: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;
    for ch in line.trim().chars() {
        if let Some(mark) = quote {
            if ch == mark {
                quote = None;
            } else {
                current.push(ch);
            }
        } else if ch == '"' || ch == '\'' {
            quote = Some(ch);
        } else if ch.is_whitespace() {
            if !current.is_empty() {
                out.push(std::mem::take(&mut current));
            }
        } else {
            current.push(ch);
        }
    }
    if !current.is_empty() {
        out.push(current);
    }
    out
}

/// Classify one REPL line (JS `parseReplLine` parity).
#[must_use]
pub fn parse_repl_line(line: &str) -> ReplLine {
    let tokens = split_shell(line);
    if tokens.is_empty() {
        return ReplLine::Empty;
    }
    if matches!(tokens[0].as_str(), "exit" | ".exit" | "quit") {
        return ReplLine::Exit;
    }
    if tokens[0] == "help" {
        return ReplLine::Help;
    }
    if tokens[0] == "search" && !tokens.iter().any(|token| token == "--query") && tokens.len() > 1 {
        return ReplLine::Run(Box::new(Commands::Search(SearchArgs {
            query: Some(tokens[1..].join(" ")),
            ..Default::default()
        })));
    }
    match crate::Cli::try_parse_from(
        std::iter::once("yasumaro").chain(tokens.iter().map(String::as_str)),
    ) {
        Ok(cli) => match cli.command {
            Some(command) => ReplLine::Run(Box::new(command)),
            // Unreachable with the current grammar (any non-empty token list
            // either parses to a subcommand or errors), kept so a future
            // top-level flag cannot trap the shell.
            None => ReplLine::Empty,
        },
        Err(err) => match err.kind() {
            clap::error::ErrorKind::DisplayHelp | clap::error::ErrorKind::DisplayVersion => {
                ReplLine::Print(err.render().to_string())
            }
            _ => ReplLine::Unknown(err.to_string()),
        },
    }
}

/// Keep the last `max_lines` entries (JS `trimHistory` parity; `max_lines`
/// of zero yields an empty vec).
#[must_use]
pub fn trim_history(lines: Vec<String>, max_lines: usize) -> Vec<String> {
    let skip = lines.len().saturating_sub(max_lines);
    lines.into_iter().skip(skip).collect()
}

/// Load history lines from `path`: missing file yields `[]`, a trailing
/// newline is dropped, empty lines are filtered, and the result is trimmed
/// to `max_lines` (JS `readHistoryFile` parity; unreadable files are an
/// internal failure, like the JS rethrow).
pub fn read_history_file(path: &Path, max_lines: usize) -> Result<Vec<String>, CliError> {
    let text = match std::fs::read_to_string(path) {
        Ok(text) => text,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(err) => {
            return Err(CliError::Internal(format!(
                "cannot read history file {}: {err}",
                path.display()
            )));
        }
    };
    let mut lines: Vec<String> = text.split('\n').map(str::to_owned).collect();
    if lines.last().is_some_and(|last| last.is_empty()) {
        lines.pop();
    }
    Ok(trim_history(
        lines.into_iter().filter(|line| !line.is_empty()).collect(),
        max_lines,
    ))
}

/// Persist `lines` to `path`, creating parent directories as needed; an
/// empty history writes an empty file (JS save parity).
pub fn write_history_file(path: &Path, lines: &[String]) -> Result<(), CliError> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent).map_err(|err| {
                CliError::Internal(format!(
                    "cannot create history dir {}: {err}",
                    parent.display()
                ))
            })?;
        }
    }
    let text = if lines.is_empty() {
        String::new()
    } else {
        lines.join("\n") + "\n"
    };
    std::fs::write(path, text).map_err(|err| {
        CliError::Internal(format!(
            "cannot write history file {}: {err}",
            path.display()
        ))
    })
}

/// Run the interactive shell against stdio; returns the process exit code.
///
/// Ctrl+D (EOF) and Ctrl+C leave the shell after saving history; a bare
/// `Ctrl+C` therefore exits 0 instead of killing the process, so the history
/// file is never lost to an interrupt.
pub fn run_repl() -> i32 {
    let env = Env::from_process();
    let config = match crate::config::load_config_file(&env.config_path) {
        Ok(config) => config,
        Err(err) => {
            let failure: CliError = err.into();
            eprintln!("{failure}");
            return failure.exit_code();
        }
    };
    let history_path: Option<PathBuf> = if config.history_file.is_empty() {
        None
    } else {
        Some(crate::config::expand_home(&config.history_file))
    };
    let max_lines: usize = config.history_max_lines.max(0).try_into().unwrap_or(0);
    let previous: Vec<String> = match &history_path {
        None => Vec::new(),
        Some(path) => match read_history_file(path, max_lines) {
            Ok(lines) => lines,
            Err(err) => {
                eprintln!("{err}");
                return err.exit_code();
            }
        },
    };

    let mut editor = match rustyline::DefaultEditor::new() {
        Ok(editor) => editor,
        Err(err) => {
            eprintln!("cannot start interactive shell: {err}");
            return crate::EXIT_ERROR;
        }
    };
    for line in &previous {
        let _ = editor.add_history_entry(line.as_str());
    }

    let stdout = std::io::stdout();
    let mut out = stdout.lock();
    let stderr = std::io::stderr();
    let mut err_out = stderr.lock();
    let mut new_lines: Vec<String> = Vec::new();
    loop {
        match editor.readline(REPL_PROMPT) {
            Err(ReadlineError::Eof) | Err(ReadlineError::Interrupted) => break,
            Err(err) => {
                let _ = writeln!(err_out, "readline error: {err}");
                break;
            }
            Ok(line) => {
                if !line.trim().is_empty() {
                    new_lines.push(line.clone());
                }
                match parse_repl_line(&line) {
                    ReplLine::Empty => {}
                    ReplLine::Exit => break,
                    ReplLine::Help => {
                        let _ = write!(out, "{REPL_HELP}");
                    }
                    ReplLine::Print(text) => {
                        let _ = write!(out, "{text}");
                    }
                    ReplLine::Unknown(message) => {
                        let _ = writeln!(out, "{message}\n{UNKNOWN_HINT}");
                    }
                    ReplLine::Run(command) => {
                        let _ = crate::dispatch(
                            &command,
                            &env,
                            &mut out,
                            &mut err_out,
                            &crate::real_copy,
                        );
                    }
                }
            }
        }
    }

    if let Some(path) = &history_path {
        let mut combined = previous;
        combined.extend(new_lines);
        let combined = trim_history(combined, max_lines);
        if let Err(err) = write_history_file(path, &combined) {
            eprintln!("{err}");
            return crate::EXIT_ERROR;
        }
    }
    crate::EXIT_OK
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_shell_splits_on_whitespace() {
        assert_eq!(split_shell("  show   --id  3 "), vec!["show", "--id", "3"]);
    }

    #[test]
    fn split_shell_honors_single_and_double_quotes() {
        assert_eq!(
            split_shell("search \"foo bar\" 'baz qux'"),
            vec!["search", "foo bar", "baz qux"]
        );
    }

    #[test]
    fn split_shell_keeps_quoted_flags_together() {
        assert_eq!(
            split_shell("search --query \"Daily News\""),
            vec!["search", "--query", "Daily News"]
        );
    }

    #[test]
    fn split_shell_unterminated_quote_runs_to_end() {
        assert_eq!(split_shell("search \"foo bar"), vec!["search", "foo bar"]);
    }

    #[test]
    fn split_shell_empty_line_yields_no_tokens() {
        assert!(split_shell("").is_empty());
        assert!(split_shell("   ").is_empty());
    }

    #[test]
    fn parse_empty_line_reprompts() {
        assert_eq!(parse_repl_line(""), ReplLine::Empty);
        assert_eq!(parse_repl_line("   "), ReplLine::Empty);
    }

    #[test]
    fn parse_exit_variants() {
        for word in ["exit", ".exit", "quit"] {
            assert_eq!(parse_repl_line(word), ReplLine::Exit, "{word} must exit");
        }
    }

    #[test]
    fn parse_help() {
        assert_eq!(parse_repl_line("help"), ReplLine::Help);
    }

    /// The `--query` of a `search` line, for shape assertions.
    fn search_query(line: &ReplLine) -> Option<&str> {
        match line {
            ReplLine::Run(command) => match command.as_ref() {
                Commands::Search(args) => args.query.as_deref(),
                other => panic!("expected search, got {other:?}"),
            },
            other => panic!("expected a dispatched command, got {other:?}"),
        }
    }

    #[test]
    fn parse_search_shorthand_joins_words_as_query() {
        assert_eq!(
            search_query(&parse_repl_line("search foo bar")),
            Some("foo bar")
        );
    }

    #[test]
    fn parse_search_shorthand_strips_quotes() {
        assert_eq!(
            search_query(&parse_repl_line("search \"foo bar\"")),
            Some("foo bar")
        );
    }

    #[test]
    fn parse_search_with_query_flag_skips_shorthand() {
        assert_eq!(
            search_query(&parse_repl_line("search --query \"Daily News\"")),
            Some("Daily News")
        );
    }

    #[test]
    fn parse_bare_search_parses_without_query() {
        // A lone `search` falls through to the full parser; the missing
        // query surfaces later as exit-2 `search requires --query TEXT`.
        assert_eq!(search_query(&parse_repl_line("search")), None);
    }

    /// Name of the dispatched subcommand, for shape assertions.
    fn dispatched_name(line: &ReplLine) -> Option<&'static str> {
        match line {
            ReplLine::Run(command) => Some(match command.as_ref() {
                Commands::Search(_) => "search",
                Commands::List(_) => "list",
                Commands::Show(_) => "show",
                Commands::Stats(_) => "stats",
                Commands::Export(_) => "export",
                Commands::Config(_) => "config",
            }),
            _ => None,
        }
    }

    #[test]
    fn parse_full_command_forms() {
        assert_eq!(
            dispatched_name(&parse_repl_line("show --id 3")),
            Some("show")
        );
        assert_eq!(
            dispatched_name(&parse_repl_line("stats --json")),
            Some("stats")
        );
        assert_eq!(
            dispatched_name(&parse_repl_line("list --domain example.com")),
            Some("list")
        );
    }

    #[test]
    fn parse_unknown_command_suggests_help() {
        match parse_repl_line("frobnicate") {
            ReplLine::Unknown(message) => assert!(!message.is_empty()),
            other => panic!("unknown command must be Unknown, got {other:?}"),
        }
    }

    #[test]
    fn parse_subcommand_help_renders_text() {
        match parse_repl_line("show --help") {
            ReplLine::Print(text) => assert!(text.contains("show")),
            other => panic!("--help must render, got {other:?}"),
        }
    }

    #[test]
    fn trim_history_keeps_the_tail() {
        let lines: Vec<String> = ["a", "b", "c", "d"]
            .iter()
            .map(|s| (*s).to_owned())
            .collect();
        assert_eq!(trim_history(lines, 2), vec!["c".to_owned(), "d".to_owned()]);
    }

    #[test]
    fn trim_history_zero_clears() {
        let lines = vec!["a".to_owned()];
        assert!(trim_history(lines, 0).is_empty());
    }

    #[test]
    fn trim_history_short_input_is_unchanged() {
        let lines = vec!["a".to_owned()];
        assert_eq!(trim_history(lines.clone(), 500), lines);
    }

    #[test]
    fn history_roundtrip_trims_on_load_and_save() {
        let dir =
            std::env::temp_dir().join(format!("yasumaro-repl-test-{}-history", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("history");
        let _ = std::fs::remove_file(&path);
        // Load trims to the cap and drops blank lines.
        std::fs::write(&path, "one\n\ntwo\nthree\n").expect("fixture history");
        let loaded = read_history_file(&path, 2).expect("history must load");
        assert_eq!(loaded, vec!["two".to_owned(), "three".to_owned()]);
        // Save joins with a trailing newline; empty history writes empty.
        write_history_file(&path, &loaded).expect("history must save");
        let saved = std::fs::read_to_string(&path).expect("history file must exist");
        assert_eq!(saved, "two\nthree\n");
        write_history_file(&path, &[]).expect("empty save must work");
        assert_eq!(std::fs::read_to_string(&path).expect("file"), "");
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_dir(&dir);
    }

    #[test]
    fn history_missing_file_loads_empty() {
        let path = std::env::temp_dir().join(format!(
            "yasumaro-repl-test-{}-missing-history",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&path);
        let loaded = read_history_file(&path, 500).expect("missing file yields []");
        assert!(loaded.is_empty());
    }
}
