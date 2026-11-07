//! Display formatting, export builders, and the emit flow.
//!
//! Ports the JS reference (`output.mjs` plus the `emit`/export section of
//! `commands.mjs` on branch `feature/yasumaro-cli`):
//!
//! - [`format_date`]: epoch millis as `YYYY-MM-DD HH:MM` in local time,
//!   zero-padded;
//! - [`format_rows`]: `{id} {date}{star} {domain} {title60}` per row, joined
//!   with `\n` plus a trailing `\n` (empty input yields an empty string);
//! - [`format_record`]: `k: v` per entry in [`DISPLAY_COLUMNS`] order,
//!   `None` fields render as `''`; a missing row renders `not found\n`;
//! - [`format_stats`]: `count` / `range` / `top domains` / `per day` lines
//!   with a trailing `\n`;
//! - [`to_json`]: 2-space pretty JSON plus a trailing `\n`;
//! - [`export_json`]/[`export_csv`]/[`export_md`]: the three `--format`
//!   shapes (CSV quotes per RFC 4180, which matches the JS `csvCell`);
//! - [`emit`]: write text to stdout, then optionally copy; a copy failure
//!   writes `copy failed: {reason}` to stderr and returns exit 3 while the
//!   already-written output is kept.
//!
//! Deviations (all unreachable with real query results, documented here):
//! a missing `id`/`created_at`/`domain` renders as `''` (JS would print
//! `undefined`); `format_stats` with `None` bounds renders an empty range end
//! (JS would print the epoch for `null`); title truncation counts Unicode
//! scalar values while JS `slice` counts UTF-16 units (identical for BMP
//! text). `runStats` never calls `format_stats` on empty stats anyway —
//! `count == 0` emits `no records\n` like the JS.
//!
//! [`DISPLAY_COLUMNS`]: crate::queries::DISPLAY_COLUMNS

use chrono::{DateTime, Local};
use serde::Serialize;

use crate::db::CliError;
use crate::queries::{Record, Stats, DISPLAY_COLUMNS};
use crate::{EXIT_COPY, EXIT_ERROR, EXIT_OK};

/// Format epoch millis as `YYYY-MM-DD HH:MM` in local time, zero-padded
/// (JS `formatDate` parity). Out-of-range millis render as `''`.
#[must_use]
pub fn format_date(millis: i64) -> String {
    match DateTime::from_timestamp_millis(millis) {
        Some(moment) => moment
            .with_timezone(&Local)
            .format("%Y-%m-%d %H:%M")
            .to_string(),
        None => String::new(),
    }
}

/// Render one `Option<i64>` field: the number, or `''` for `None`.
fn opt_int(value: Option<i64>) -> String {
    value.map_or_else(String::new, |number| number.to_string())
}

/// Render one `Option<f64>` field: the number, or `''` for `None`.
fn opt_float(value: Option<f64>) -> String {
    value.map_or_else(String::new, |number| number.to_string())
}

/// Render one `Option<String>` field: the text, or `''` for `None`.
fn opt_text(value: Option<&String>) -> String {
    value.map_or_else(String::new, |text| text.clone())
}

/// `(key, rendered value)` pairs in [`DISPLAY_COLUMNS`] order (the JS
/// `Object.entries(row)` order, since the JS selects the same columns in the
/// same order).
fn record_entries(record: &Record) -> Vec<(&'static str, String)> {
    DISPLAY_COLUMNS
        .iter()
        .map(|column| {
            let value = match *column {
                "id" => opt_int(record.id),
                "url" => opt_text(record.url.as_ref()),
                "title" => opt_text(record.title.as_ref()),
                "summary" => opt_text(record.summary.as_ref()),
                "tags" => opt_text(record.tags.as_ref()),
                "created_at" => opt_int(record.created_at),
                "domain" => opt_text(record.domain.as_ref()),
                "visit_duration" => opt_int(record.visit_duration),
                "scroll_ratio" => opt_float(record.scroll_ratio),
                "is_starred" => opt_int(record.is_starred),
                "is_deleted" => opt_int(record.is_deleted),
                "obsidian_synced" => opt_int(record.obsidian_synced),
                "gist_synced" => opt_int(record.gist_synced),
                _ => String::new(),
            };
            (*column, value)
        })
        .collect()
}

/// One line per row: `{id} {YYYY-MM-DD HH:MM}{star} {domain} {title60}` where
/// `star` is `*` for starred rows else ` `, and the title is
/// `(title ?? url)` cut to 60 chars. Trailing `\n` when non-empty.
#[must_use]
pub fn format_rows(rows: &[Record]) -> String {
    if rows.is_empty() {
        return String::new();
    }
    let mut out = String::new();
    for row in rows {
        let star = if row.is_starred.is_some_and(|flag| flag != 0) {
            '*'
        } else {
            ' '
        };
        let fallback: &str = row.url.as_deref().unwrap_or("");
        let title: String = row
            .title
            .as_deref()
            .unwrap_or(fallback)
            .chars()
            .take(60)
            .collect();
        let date = row.created_at.map_or_else(String::new, format_date);
        let id = opt_int(row.id);
        let domain: &str = row.domain.as_deref().unwrap_or("");
        out.push_str(&format!("{id} {date}{star} {domain} {title}\n"));
    }
    out
}

/// `k: v` per entry plus a trailing `\n`; `None` means `not found\n`.
#[must_use]
pub fn format_record(row: Option<&Record>) -> String {
    match row {
        None => "not found\n".to_owned(),
        Some(record) => {
            let mut out = String::new();
            for (key, value) in record_entries(record) {
                out.push_str(&format!("{key}: {value}\n"));
            }
            out
        }
    }
}

/// `count` / `range` / `top domains` / `per day` lines plus trailing `\n`.
#[must_use]
pub fn format_stats(stats: &Stats) -> String {
    let mut lines = vec![
        format!("count: {}", stats.count),
        format!(
            "range: {} - {}",
            stats.min_created_at.map_or_else(String::new, format_date),
            stats.max_created_at.map_or_else(String::new, format_date),
        ),
        "top domains:".to_owned(),
    ];
    for bucket in &stats.top_domains {
        lines.push(format!("  {} {}", bucket.domain, bucket.count));
    }
    lines.push("per day:".to_owned());
    for bucket in &stats.per_day {
        lines.push(format!("  {} {}", bucket.day, bucket.count));
    }
    lines.join("\n") + "\n"
}

/// 2-space pretty JSON plus a trailing `\n` (JS `toJson` parity).
pub fn to_json<T: Serialize>(value: &T) -> Result<String, serde_json::Error> {
    serde_json::to_string_pretty(value).map(|mut text| {
        text.push('\n');
        text
    })
}

/// JSON export: a pretty array of records (JS `toJson(rows)` parity).
pub fn export_json(rows: &[Record]) -> Result<String, serde_json::Error> {
    to_json(&rows)
}

/// CSV export with a header row: `columns` joined by commas, then one quoted
/// record per row (JS `formatExportCsv` parity; the `csv` writer quotes exactly
/// when a cell contains `,"` or a line break, like the JS `csvCell`).
pub fn export_csv(rows: &[Record], columns: &[&str]) -> Result<String, CliError> {
    let mut writer = csv::WriterBuilder::new()
        .terminator(csv::Terminator::Any(b'\n'))
        .from_writer(Vec::new());
    writer
        .write_record(columns)
        .map_err(|err| CliError::Internal(format!("cannot encode CSV: {err}")))?;
    for row in rows {
        let cells: Vec<String> = columns
            .iter()
            .map(|column| {
                record_entries(row)
                    .into_iter()
                    .find(|(key, _)| key == column)
                    .map_or_else(String::new, |(_, value)| value)
            })
            .collect();
        writer
            .write_record(&cells)
            .map_err(|err| CliError::Internal(format!("cannot encode CSV: {err}")))?;
    }
    let bytes = writer
        .into_inner()
        .map_err(|err| CliError::Internal(format!("cannot encode CSV: {err}")))?;
    String::from_utf8(bytes).map_err(|err| CliError::Internal(format!("cannot encode CSV: {err}")))
}

/// Markdown export: one `- [title](url)` bullet per record (JS
/// `formatExportMd` parity); empty input yields an empty string.
#[must_use]
pub fn export_md(rows: &[Record]) -> String {
    if rows.is_empty() {
        return String::new();
    }
    rows.iter()
        .map(|row| {
            let url: &str = row.url.as_deref().unwrap_or("");
            let label: &str = row.title.as_deref().unwrap_or(url);
            format!("- [{label}]({url})")
        })
        .collect::<Vec<_>>()
        .join("\n")
        + "\n"
}

/// Write `text` to stdout, then optionally copy it.
///
/// Returns the process exit code: `0` on success; `1` when stdout fails;
/// `3` when the copy backend fails (the `copy failed: {reason}` warning goes
/// to stderr and the already-written output is kept, like the JS `emit`).
/// `copy_fn` is the injectable backend (see [`crate::copy`]); it is generic
/// so tests can pass closures borrowing their capture state.
pub fn emit<F>(
    text: &str,
    copy: bool,
    stdout: &mut dyn std::io::Write,
    stderr: &mut dyn std::io::Write,
    copy_fn: &F,
) -> i32
where
    F: Fn(&str) -> Result<(), String> + ?Sized,
{
    if stdout.write_all(text.as_bytes()).is_err() {
        return EXIT_ERROR;
    }
    if copy {
        if let Err(reason) = copy_fn(text) {
            let _ = writeln!(stderr, "copy failed: {reason}");
            return EXIT_COPY;
        }
    }
    EXIT_OK
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::queries::{DayCount, DomainCount};
    use chrono::TimeZone as _;

    /// Epoch millis for a local wall-clock time (mirrors the JS tests'
    /// `new Date('2026-01-10T09:05:00').getTime()`, which is also local).
    fn local_millis(year: i32, month: u32, day: u32, hour: u32, minute: u32) -> i64 {
        Local
            .with_ymd_and_hms(year, month, day, hour, minute, 0)
            .single()
            .expect("test datetime must resolve in local zone")
            .timestamp_millis()
    }

    fn sample_record() -> Record {
        Record {
            id: Some(1),
            url: Some("https://example.com/guide".to_owned()),
            title: Some("TypeScript Guide".to_owned()),
            summary: Some("a practical guide to types".to_owned()),
            tags: Some("docs".to_owned()),
            created_at: Some(local_millis(2026, 1, 10, 9, 5)),
            domain: Some("example.com".to_owned()),
            visit_duration: Some(120),
            scroll_ratio: Some(0.5),
            is_starred: Some(1),
            is_deleted: Some(0),
            obsidian_synced: Some(0),
            gist_synced: Some(0),
        }
    }

    fn sample_stats() -> Stats {
        Stats {
            count: 2,
            min_created_at: Some(local_millis(2026, 1, 10, 0, 0)),
            max_created_at: Some(local_millis(2026, 1, 20, 0, 0)),
            top_domains: vec![DomainCount {
                domain: "example.com".to_owned(),
                count: 2,
            }],
            per_day: vec![DayCount {
                day: "2026-01-10".to_owned(),
                count: 2,
            }],
        }
    }

    #[test]
    fn date_is_zero_padded_local_yyyy_mm_dd_hh_mm() {
        // Round trip through the local zone: whatever the zone, the wall
        // components survive, so padding and layout are pinned exactly.
        let millis = local_millis(2026, 1, 5, 9, 7);
        assert_eq!(format_date(millis), "2026-01-05 09:07");
    }

    #[test]
    fn date_has_fixed_shape() {
        let text = format_date(local_millis(2026, 12, 31, 23, 59));
        assert_eq!(text.len(), 16);
        let bytes = text.as_bytes();
        assert_eq!(bytes[4], b'-');
        assert_eq!(bytes[7], b'-');
        assert_eq!(bytes[10], b' ');
        assert_eq!(bytes[13], b':');
    }

    #[test]
    fn rows_render_id_date_domain_and_title() {
        let mut second = sample_record();
        second.id = Some(2);
        second.created_at = Some(local_millis(2026, 1, 11, 10, 0));
        second.domain = Some("other.org".to_owned());
        second.title = Some("World".to_owned());
        second.is_starred = Some(0);
        let out = format_rows(&[sample_record(), second]);
        let lines: Vec<&str> = out.trim_end().split('\n').collect();
        assert_eq!(lines.len(), 2);
        assert!(lines[0].contains('1'));
        assert!(lines[0].contains("2026-01-10"));
        assert!(lines[0].contains("example.com"));
        assert!(lines[0].contains("TypeScript Guide"));
        assert!(lines[1].contains("other.org"));
        assert!(out.ends_with('\n'));
    }

    #[test]
    fn rows_mark_starred() {
        let starred = format_rows(&[sample_record()]);
        let mut plain_record = sample_record();
        plain_record.is_starred = Some(0);
        let plain = format_rows(&[plain_record]);
        assert!(starred.contains('*'));
        assert!(!plain.contains('*'));
    }

    #[test]
    fn rows_truncate_title_to_60_chars_and_fall_back_to_url() {
        let mut record = sample_record();
        record.title = Some("x".repeat(100));
        let out = format_rows(&[record]);
        let title_part = out.trim_end().rsplit(' ').next().expect("line has a title");
        assert_eq!(title_part.len(), 60);

        let mut fallback = sample_record();
        fallback.title = None;
        let out = format_rows(&[fallback]);
        assert!(out.contains("https://example.com/guide"));
    }

    #[test]
    fn rows_empty_yields_empty_string() {
        assert_eq!(format_rows(&[]), "");
    }

    #[test]
    fn record_renders_key_value_lines() {
        let out = format_record(Some(&sample_record()));
        assert!(out.contains("id: 1"));
        assert!(out.contains("url: https://example.com/guide"));
        assert!(out.contains("title: TypeScript Guide"));
        assert!(out.ends_with('\n'));
    }

    #[test]
    fn record_renders_none_fields_as_empty() {
        let mut record = sample_record();
        record.summary = None;
        let out = format_record(Some(&record));
        assert!(out.contains("summary: \n"));
    }

    #[test]
    fn record_missing_row_reports_not_found() {
        assert_eq!(format_record(None), "not found\n");
    }

    #[test]
    fn stats_show_count_range_domains_and_days() {
        let out = format_stats(&sample_stats());
        assert!(out.contains("count: 2"));
        assert!(out.contains("range: 2026-01-10"));
        assert!(out.contains("top domains:"));
        assert!(out.contains("  example.com 2"));
        assert!(out.contains("per day:"));
        assert!(out.contains("  2026-01-10 2"));
        assert!(out.ends_with('\n'));
    }

    #[test]
    fn json_has_two_space_pretty_print_and_trailing_newline() {
        let rows = vec![sample_record()];
        let text = to_json(&rows).expect("records must serialize");
        assert!(text.ends_with('\n'));
        assert!(!text.ends_with("\n\n"));
        let parsed: serde_json::Value =
            serde_json::from_str(&text).expect("output must be valid JSON");
        assert!(parsed.is_array());
        assert_eq!(parsed[0]["url"], "https://example.com/guide");
    }

    #[test]
    fn csv_has_header_and_quotes_special_cells() {
        let mut tricky = sample_record();
        tricky.summary = Some("world events, \"roundup\"\nsecond line".to_owned());
        let text =
            export_csv(&[sample_record(), tricky], DISPLAY_COLUMNS).expect("CSV must encode");
        let mut lines = text.lines();
        assert_eq!(
            lines.next().expect("header line"),
            DISPLAY_COLUMNS.join(",")
        );
        assert!(text.contains("https://example.com/guide"));
        // Comma forces quoting, quotes double, the newline stays inside.
        assert!(text.contains("\"world events, \"\"roundup\"\"\nsecond line\""));
        assert!(text.ends_with('\n'));
    }

    #[test]
    fn csv_quotes_cells_containing_carriage_return() {
        let mut record = sample_record();
        record.summary = Some("first\rsecond".to_owned());
        let text = export_csv(&[record], &["id", "summary"]).expect("CSV must encode");
        assert_eq!(text, "id,summary\n1,\"first\rsecond\"\n");
    }

    #[test]
    fn csv_renders_none_cells_as_empty() {
        let mut record = sample_record();
        record.summary = None;
        let text = export_csv(&[record], &["id", "summary"]).expect("CSV must encode");
        assert_eq!(text, "id,summary\n1,\n");
    }

    #[test]
    fn md_has_one_bullet_per_record() {
        let mut second = sample_record();
        second.title = Some("Daily News".to_owned());
        second.url = Some("https://other.org/news".to_owned());
        let out = export_md(&[sample_record(), second]);
        let bullets: Vec<&str> = out.lines().filter(|line| line.starts_with("- ")).collect();
        assert_eq!(bullets.len(), 2);
        assert!(out.contains("- [TypeScript Guide](https://example.com/guide)"));
        assert!(out.contains("- [Daily News](https://other.org/news)"));
        assert!(out.ends_with('\n'));
    }

    #[test]
    fn md_empty_yields_empty_string() {
        assert_eq!(export_md(&[]), "");
    }

    #[test]
    fn emit_writes_output_and_returns_zero_without_copy() {
        use std::cell::Cell;
        let mut stdout = Vec::new();
        let mut stderr = Vec::new();
        let called = Cell::new(false);
        let code = emit("hello\n", false, &mut stdout, &mut stderr, &|_| {
            called.set(true);
            Ok(())
        });
        assert_eq!(code, 0);
        assert_eq!(stdout, b"hello\n");
        assert!(stderr.is_empty());
        assert!(!called.get(), "copy backend must not run without --copy");
    }

    #[test]
    fn emit_copies_and_returns_zero_on_success() {
        use std::cell::RefCell;
        let mut stdout = Vec::new();
        let mut stderr = Vec::new();
        let copied = RefCell::new(String::new());
        let code = emit("hello\n", true, &mut stdout, &mut stderr, &|text| {
            copied.borrow_mut().push_str(text);
            Ok(())
        });
        assert_eq!(code, 0);
        assert_eq!(copied.borrow().as_str(), "hello\n");
        assert!(stderr.is_empty());
    }

    #[test]
    fn emit_keeps_output_and_reports_copy_failure_on_stderr() {
        let mut stdout = Vec::new();
        let mut stderr = Vec::new();
        let code = emit("hello\n", true, &mut stdout, &mut stderr, &|_| {
            Err("xsel not found".to_owned())
        });
        // Exit 3, output already written, reason on stderr.
        assert_eq!(code, 3);
        assert_eq!(stdout, b"hello\n");
        let warning = String::from_utf8(stderr).expect("stderr must be UTF-8");
        assert!(warning.contains("copy failed: xsel not found"));
    }

    /// A [`std::io::Write`] that always fails, for the stdout-error path.
    struct FailWriter;

    impl std::io::Write for FailWriter {
        fn write(&mut self, _buf: &[u8]) -> std::io::Result<usize> {
            Err(std::io::Error::other("broken pipe"))
        }

        fn flush(&mut self) -> std::io::Result<()> {
            Err(std::io::Error::other("broken pipe"))
        }
    }

    #[test]
    fn emit_returns_error_when_stdout_fails() {
        let mut stdout = FailWriter;
        let mut stderr = Vec::new();
        let code = emit("hello\n", false, &mut stdout, &mut stderr, &|_| Ok(()));
        assert_eq!(code, 1);
    }
}
