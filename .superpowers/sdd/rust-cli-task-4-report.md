# Rust yasumaro CLI - Task 4 report (display + export + copy)

Branch: `fix/code-review-6.9.69-findings`. All changes under `cli/` plus this
report. JS parity refs (read-only via `git show`): `output.mjs`, `commands.mjs`
(export/`emit`/parse helpers), `copy.mjs`, and `__tests__/output.test.ts`,
`copy.test.ts`, `export.test.ts`, `commands.test.ts` on `feature/yasumaro-cli`.

## Deps (all permissive, no GPL)

Added to `cli/Cargo.toml`: `serde_json 1.0.154` (MIT OR Apache-2.0),
`csv 1.4.0` (Unlicense/MIT), `chrono 0.4.45` (MIT OR Apache-2.0).
Transitive newcomers checked in the vendored sources: `csv-core` (Unlicense/MIT),
`itoa` (MIT OR Apache-2.0), `ryu` (Apache-2.0 OR BSL-1.0), `memchr`
(Unlicense OR MIT), `num-traits` + `iana-time-zone` (MIT OR Apache-2.0).
Existing `dirs/rusqlite/serde/thiserror/toml/clap` untouched as deps.

Note: `cargo add` re-resolved the whole `Cargo.lock` (e.g. `toml 0.8 -> 1.2`,
`clap 4.6.x` refresh). Everything still builds and tests green; the lock diff
is bigger than the three added lines for that reason.

## Files

- `cli/src/output.rs` (new): `format_date`, `format_rows`, `format_record`,
  `format_stats`, `to_json`, `export_json`, `export_csv`, `export_md`, `emit`.
- `cli/src/copy.rs` (new): `copy_to_clipboard`, `copy_with` (injectable
  `runner` + JS `process.platform` tag), `CommandRunner` alias documenting the
  seam, `AttemptError::{NotFound,Failed}`, `real_runner` on
  `std::process::Command` (no new heavy deps).
- `cli/src/params.rs` (new): `parse_limit`, `parse_offset`, `parse_id`,
  `parse_date_bound` (+ `END_OF_DAY_INCLUSIVE_MS`). Chose a separate `params`
  module over stuffing parsers into `output`: rendering vs validation stay
  independent and Task 5 can `use crate::params::*` for clap wiring.
- `cli/src/main.rs`: only the `mod` declarations for the three new modules
  (same `#[allow(dead_code)]` pattern as Task 2); Task 1 behavior unchanged.
- `queries::Record` (snake_case, matches JS row keys) and `queries::Stats`
  (camelCase renames) are reused as-is for JSON/export; no changes needed.

### `emit` semantics

`emit(text, copy, stdout, stderr, copy_fn) -> i32`: write text to stdout first,
then on `copy` run the backend; copy failure writes `copy failed: {reason}\n`
to stderr and returns 3 while the written output is kept. Stdout write failure
returns 1 (JS ignores write errors; Rust surfaces them - documented deviation).
Generic over `copy_fn: &F` (`F: Fn(&str) -> ...`) so test closures can borrow
capture state; same generic pattern for `copy_with`'s runner.

### CSV detail

`csv::WriterBuilder` with `Terminator::Any(b'\n')`: the crate default is CRLF,
JS joins with `\n`. Quoting matches the JS `csvCell` regex (`,"` + newline).

## SQL

N/A - no schema or query changes. `export_csv` takes caller-supplied `columns`
(Task 5 will pass `DISPLAY_COLUMNS` filtered by `real_columns`, mirroring the
JS `runExport`).

## Test outputs

`cargo fmt --check`: clean. `cargo clippy --all-targets -- -D warnings`: clean.
`cargo test`: **79 passed, 0 failed** (35 new: 6 copy + 19 output + 10 params;
44 pre-existing config/db/queries/main all still green).
Binary smoke: `--help` exit 0, bare invocation prints usage exit 0 (Task 1
behavior intact). Golden highlights mirroring the JS suites:

- rows: id/date/domain/title line, `*` iff `is_starred != 0`, title
  `(title ?? url)` cut to 60 chars, trailing `\n`, empty input -> `""`;
- record: `id: 1` / `url:` / `title:` lines, `None` fields -> `key: `, missing
  row -> `not found\n`;
- stats: `count: 2`, `range: 2026-01-10 ...`, `  example.com 2`,
  `  2026-01-10 2`, trailing `\n`;
- json: `serde_json::to_string_pretty` + `\n`, round-trips through parse;
- csv: header equals `DISPLAY_COLUMNS.join(",")`, fixture cell
  `world events, "roundup"\nsecond line` encodes as
  `"world events, ""roundup""\nsecond line"`;
- md: `- [TypeScript Guide](https://example.com/guide)` per row, empty -> `""`;
- parse errors (`abc` limit, `1.5` offset, missing id, `not-a-date` from) all
  yield message + exit code 2; `--to 2026-01-15` bound equals UTC midnight +
  86399999 and covers a noon row;
- copy: pbcopy/darwin, xclip->xsel/linux fallback, clip/win32, `xsel not found`
  when both missing, immediate `boom` on spawn error, `pbcopy exited with 1`;
- emit: output present on stdout before a copy failure, exit 3 with
  `copy failed: ...` on stderr; no backend call without the copy flag.

## Self-review

- No `unwrap()` in prod code (grep-verified; only `unwrap_or*` with the same
  precedent as `config.rs`/`queries.rs`, plus `expect` in tests). No `unsafe`.
- New modules carry rustdoc on every public item, including a Deviations list.
- `#[allow(dead_code)]` on the new `mod` lines matches the Task 2 pattern until
  Task 5 wires the subcommands; no warnings with `-D warnings`.
- Date tests are TZ-independent (round trip through `chrono::Local`, plus
  hard UTC-midnight epochs for bounds).

## Concerns (incl. JS-shape deviations)

1. **Sandbox vs `~/.cargo` (environment, affects Task 5/6).** This session
   denies writes outside the workspace, so the stock `CARGO_HOME` is unusable
   (registry writes fail with EPERM) and `csv` was not in the shared cache.
   Workaround used: workspace-local `cli/.cargo-home` (`CARGO_HOME=.../cli/.cargo-home`
   `cargo fetch` re-downloaded everything there). It is **untracked and NOT
   committed**; Task 5/6 must export the same `CARGO_HOME` or every cargo
   command fails. Hardlink-copying `~/.cargo/registry` was also denied.
2. Documented parity deviations (all unreachable with real query results):
   missing `id`/`created_at`/`domain` render as `''` (JS: `undefined`);
   out-of-range millis -> `''` (JS: NaN-date); `format_stats` with `None`
   bounds renders empty range ends (JS: epoch for `null`) - and `runStats`
   short-circuits empty stats to `no records` in both anyway; title cut counts
   Unicode scalar values vs JS UTF-16 units (identical for BMP text);
   digit strings overflowing `i64` are usage errors (JS `parseInt` accepts up
   to 2^53 imprecisely); date parsing accepts only `YYYY-MM-DD` + ISO-8601
   (JS `Date.parse` also takes locale shapes like `Jan 15 2026`), naive
   datetimes read as local time like JS; `f64` via Rust `Display` (same text
   for normal values); `emit` stdout failure -> exit 1; non-ENOENT spawn
   errors surface as the platform error string (same shape, text differs).
3. `copy_with` maps `std::env::consts::OS` (`macos`/`windows`/other) onto the
   JS tags (`darwin`/`win32`/`linux`); any non-Apple non-Windows OS takes the
   xclip/xsel path, exactly like the JS fallthrough.
