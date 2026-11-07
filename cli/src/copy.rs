//! Clipboard copy backend for the Yasumaro CLI.
//!
//! Mirrors the JS reference (`tools/yasumaro-cli/copy.mjs` on branch
//! `feature/yasumaro-cli`):
//!
//! - macOS (`darwin`) uses `pbcopy` with no arguments;
//! - Windows (`win32`) uses `clip` with no arguments;
//! - other platforms try `xclip -selection clipboard` then
//!   `xsel --clipboard --input`;
//! - the text is fed on stdin; a missing helper (`ENOENT`) falls through to
//!   the next candidate, any other spawn failure or a non-zero exit ends the
//!   attempt with that reason; when every candidate is missing the reason is
//!   the last `<cmd> not found` (or `no clipboard command found` when there
//!   are no candidates at all).
//!
//! Only `std::process::Command` is used (no extra clipboard crates). The
//! `runner` parameter of [`copy_with`] is the injection seam that lets tests
//! pass a mock so the suite never touches the real clipboard.

use std::io::Write as _;
use std::process::{Command, Stdio};

/// Platform tags in the JS `process.platform` vocabulary (`darwin`/`win32`/…).
pub const PLATFORM_MACOS: &str = "darwin";
pub const PLATFORM_WINDOWS: &str = "win32";

/// Failure of a single backend command attempt.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AttemptError {
    /// The helper program is not installed (`ENOENT` equivalent).
    NotFound {
        /// Program that could not be launched.
        program: String,
    },
    /// The helper launched but failed (spawn error or non-zero exit).
    Failed(String),
}

/// Candidate `(program, args)` backends for a JS-style platform tag.
fn candidates(platform: &str) -> Vec<(&'static str, Vec<&'static str>)> {
    if platform == PLATFORM_MACOS {
        vec![("pbcopy", Vec::new())]
    } else if platform == PLATFORM_WINDOWS {
        vec![("clip", Vec::new())]
    } else {
        vec![
            ("xclip", vec!["-selection", "clipboard"]),
            ("xsel", vec!["--clipboard", "--input"]),
        ]
    }
}

/// Map `std::env::consts::OS` (`macos`/`windows`/…) to the JS
/// `process.platform` tag consumed by [`copy_with`].
fn current_platform() -> &'static str {
    if std::env::consts::OS == "macos" {
        PLATFORM_MACOS
    } else if std::env::consts::OS == "windows" {
        PLATFORM_WINDOWS
    } else {
        // `std::env::consts::OS` reports e.g. `linux`; the JS tag for the
        // same kernel is also `linux`, so any non-Apple/non-Windows tag
        // takes the xclip/xsel path via the fallthrough in `candidates`.
        "linux"
    }
}

/// Copy `text` using `runner` on `platform` (a JS `process.platform` tag).
///
/// Returns `Ok(())` on the first succeeding backend, else the failure reason
/// as `Err(String)` (the caller writes `copy failed: {reason}` to stderr and
/// exits 3, like the JS `emit` flow). `runner` is generic so tests can pass
/// closures borrowing their capture state.
pub fn copy_with<F>(text: &str, platform: &str, runner: &F) -> Result<(), String>
where
    F: Fn(&str, &[&str], &str) -> Result<(), AttemptError> + ?Sized,
{
    let mut last_reason = "no clipboard command found".to_owned();
    for (program, args) in candidates(platform) {
        match runner(program, &args, text) {
            Ok(()) => return Ok(()),
            Err(AttemptError::NotFound { .. }) => {
                last_reason = format!("{program} not found");
            }
            Err(AttemptError::Failed(reason)) => return Err(reason),
        }
    }
    Err(last_reason)
}

/// Copy `text` to the OS clipboard via the platform backend.
///
/// Never used directly in tests; prefer [`copy_with`] with a mock runner.
pub fn copy_to_clipboard(text: &str) -> Result<(), String> {
    copy_with(text, current_platform(), &real_runner)
}

/// Production runner over `std::process::Command`.
fn real_runner(program: &str, args: &[&str], input: &str) -> Result<(), AttemptError> {
    let mut child = Command::new(program)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|err| {
            if err.kind() == std::io::ErrorKind::NotFound {
                AttemptError::NotFound {
                    program: program.to_owned(),
                }
            } else {
                AttemptError::Failed(err.to_string())
            }
        })?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(input.as_bytes())
            .map_err(|err| AttemptError::Failed(err.to_string()))?;
    }
    // `stdin` is dropped here, closing the pipe before `wait`, like the
    // synchronous `spawnSync({ input })` in the JS reference.
    let status = child
        .wait()
        .map_err(|err| AttemptError::Failed(err.to_string()))?;
    if status.success() {
        Ok(())
    } else {
        match status.code() {
            Some(code) => Err(AttemptError::Failed(format!(
                "{program} exited with {code}"
            ))),
            None => Err(AttemptError::Failed(format!(
                "{program} terminated by signal"
            ))),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    /// Recorded mock invocation (program + args + stdin text).
    #[derive(Debug, Clone, PartialEq, Eq)]
    struct Call {
        program: String,
        args: Vec<String>,
        input: String,
    }

    /// Build a mock runner replaying `results` in order (the last
    /// result repeats when more calls arrive than results).
    fn mock_runner(
        results: Vec<Result<(), AttemptError>>,
        calls: &RefCell<Vec<Call>>,
    ) -> impl Fn(&str, &[&str], &str) -> Result<(), AttemptError> + '_ {
        move |program, args, input| {
            calls.borrow_mut().push(Call {
                program: program.to_owned(),
                args: args.iter().map(|arg| (*arg).to_owned()).collect(),
                input: input.to_owned(),
            });
            let index = calls.borrow().len() - 1;
            results
                .get(index)
                .or_else(|| results.last())
                .cloned()
                .unwrap_or(Ok(()))
        }
    }

    fn not_found(program: &str) -> Result<(), AttemptError> {
        Err(AttemptError::NotFound {
            program: program.to_owned(),
        })
    }

    #[test]
    fn uses_pbcopy_on_darwin() {
        let calls = RefCell::new(Vec::new());
        let runner = mock_runner(vec![Ok(())], &calls);
        assert_eq!(copy_with("hello", "darwin", &runner), Ok(()));
        assert_eq!(
            *calls.borrow(),
            vec![Call {
                program: "pbcopy".to_owned(),
                args: Vec::new(),
                input: "hello".to_owned(),
            }]
        );
    }

    #[test]
    fn tries_xclip_then_xsel_on_linux() {
        let calls = RefCell::new(Vec::new());
        let runner = mock_runner(vec![not_found("xclip"), Ok(())], &calls);
        assert_eq!(copy_with("hello", "linux", &runner), Ok(()));
        let programs: Vec<String> = calls
            .borrow()
            .iter()
            .map(|call| call.program.clone())
            .collect();
        assert_eq!(programs, vec!["xclip".to_owned(), "xsel".to_owned()]);
        assert_eq!(
            calls.borrow()[0].args,
            vec!["-selection".to_owned(), "clipboard".to_owned()]
        );
        assert_eq!(
            calls.borrow()[1].args,
            vec!["--clipboard".to_owned(), "--input".to_owned()]
        );
        // The text reaches stdin of the succeeding backend.
        assert_eq!(calls.borrow()[1].input, "hello".to_owned());
    }

    #[test]
    fn uses_clip_on_win32() {
        let calls = RefCell::new(Vec::new());
        let runner = mock_runner(vec![Ok(())], &calls);
        assert_eq!(copy_with("hello", "win32", &runner), Ok(()));
        assert_eq!(calls.borrow().len(), 1);
        assert_eq!(calls.borrow()[0].program, "clip".to_owned());
        assert!(calls.borrow()[0].args.is_empty());
    }

    #[test]
    fn reports_failure_when_no_command_exists() {
        let calls = RefCell::new(Vec::new());
        let runner = mock_runner(vec![not_found("xclip"), not_found("xsel")], &calls);
        let err = copy_with("hello", "linux", &runner).expect_err("copy must fail");
        assert_eq!(calls.borrow().len(), 2);
        assert!(
            err.contains("xsel not found"),
            "reason must name the last candidate: {err}"
        );
    }

    #[test]
    fn reports_non_enoent_spawn_error_immediately() {
        let calls = RefCell::new(Vec::new());
        let runner = mock_runner(vec![Err(AttemptError::Failed("boom".to_owned()))], &calls);
        assert_eq!(
            copy_with("hello", "darwin", &runner),
            Err("boom".to_owned())
        );
        // No further candidates after a hard failure.
        assert_eq!(calls.borrow().len(), 1);
    }

    #[test]
    fn reports_nonzero_exit_with_program_and_code() {
        let calls = RefCell::new(Vec::new());
        let runner = mock_runner(
            vec![Err(AttemptError::Failed("pbcopy exited with 1".to_owned()))],
            &calls,
        );
        assert_eq!(
            copy_with("hello", "darwin", &runner),
            Err("pbcopy exited with 1".to_owned())
        );
    }
}
