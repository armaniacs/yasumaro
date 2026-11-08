//! CLI flag validation for the Yasumaro CLI.
//!
//! Ports the JS reference parsers (`parseLimit`/`parseOffset`/`parseId`/
//! `parseDateBound` in `tools/yasumaro-cli/commands.mjs` on branch
//! `feature/yasumaro-cli`):
//!
//! - `parse_limit`: default from config (JS `config.limit ?? DEFAULT_LIMIT`),
//!   otherwise a plain integer `> 0`;
//! - `parse_offset`: default `0`, otherwise a plain integer `>= 0`;
//! - `parse_id`: required, any plain integer (the JS only rejects
//!   non-integers, so negatives pass);
//! - `parse_date_bound`: `Date.parse` semantics restricted to `YYYY-MM-DD`
//!   and full ISO-8601; invalid input is a usage error; `--to` adds
//!   `86400000 - 1` ms so the whole day matches (end-of-day inclusive).
//!
//! Every failure is [`CliError::Usage`] (exit 2) with the JS message text.
//!
//! Deviations from `Date.parse` (documented, unreachable via valid flags):
//! only `YYYY-MM-DD` and ISO-8601 shapes are accepted (JS additionally parses
//! locale shapes like `Jan 15 2026`); huge integers beyond `i64` are rejected
//! (JS `parseInt` would return an imprecise float) — both surface as
//! `invalid …` usage errors.

use chrono::{DateTime, Local, NaiveDate, NaiveDateTime, TimeZone};

use crate::db::CliError;

/// Milliseconds per day; `--to` adds this minus one (JS `86400000 - 1`).
pub const END_OF_DAY_INCLUSIVE_MS: i64 = 86_400_000 - 1;

/// JS `/^-?\d+$/` parity: an optional leading `-` followed by 1+ ASCII digits.
fn is_plain_integer(text: &str) -> bool {
    let digits = text.strip_prefix('-').map_or(text, |rest| rest);
    !digits.is_empty() && digits.bytes().all(|byte| byte.is_ascii_digit())
}

/// Parse a plain integer flag value (JS `parseInt` shape check plus exact
/// `i64` range); failures name the flag, like the JS `invalid …` messages.
fn parse_plain_integer(text: &str, flag: &str) -> Result<i64, CliError> {
    if !is_plain_integer(text) {
        return Err(CliError::Usage(format!("invalid {flag}: {text}")));
    }
    text.parse::<i64>()
        .map_err(|_| CliError::Usage(format!("invalid {flag}: {text}")))
}

fn invalid_limit(value: &str) -> CliError {
    CliError::Usage(format!("invalid --limit: {value}"))
}

/// Parse `--limit`: `None` falls back to `default` (the config limit),
/// otherwise the value must be a plain integer `> 0`.
pub fn parse_limit(value: Option<&str>, default: i64) -> Result<i64, CliError> {
    match value {
        None => Ok(default),
        Some(text) => match parse_plain_integer(text, "--limit")? {
            number if number > 0 => Ok(number),
            _ => Err(invalid_limit(text)),
        },
    }
}

/// Parse `--offset`: `None` means `0`, otherwise a plain integer `>= 0`.
pub fn parse_offset(value: Option<&str>) -> Result<i64, CliError> {
    match value {
        None => Ok(0),
        Some(text) => match parse_plain_integer(text, "--offset")? {
            number if number >= 0 => Ok(number),
            _ => Err(CliError::Usage(format!("invalid --offset: {text}"))),
        },
    }
}

/// Parse `--id` for `show`: required, any plain integer (negatives pass, like
/// the JS which only rejects non-integers).
pub fn parse_id(value: Option<&str>) -> Result<i64, CliError> {
    match value {
        None => Err(CliError::Usage("show requires --id N".to_owned())),
        Some(text) => parse_plain_integer(text, "--id"),
    }
}

/// Parse a `--from`/`--to` date bound to epoch millis.
///
/// Accepts `YYYY-MM-DD` (UTC midnight, like `Date.parse`) and full ISO-8601
/// datetimes (explicit offsets honored; a missing offset means local time,
/// like `Date.parse`). `flag` must be `--from` or `--to`; `--to` bounds are
/// moved to 23:59:59.999 of that day (inclusive). `None` stays `None`.
pub fn parse_date_bound(value: Option<&str>, flag: &str) -> Result<Option<i64>, CliError> {
    value
        .map(|text| {
            let millis = parse_date_millis(text)
                .ok_or_else(|| CliError::Usage(format!("invalid {flag}: {text}")))?;
            Ok(if flag == "--to" {
                millis.saturating_add(END_OF_DAY_INCLUSIVE_MS)
            } else {
                millis
            })
        })
        .transpose()
}

/// `Date.parse` subset: RFC-3339/ISO with offset, `YYYY-MM-DD` (UTC midnight),
/// then naive local datetimes (`YYYY-MM-DDTHH:MM[:SS]` and the space variant).
fn parse_date_millis(text: &str) -> Option<i64> {
    if let Ok(moment) = DateTime::parse_from_rfc3339(text) {
        return Some(moment.timestamp_millis());
    }
    if let Ok(day) = NaiveDate::parse_from_str(text, "%Y-%m-%d") {
        return day
            .and_hms_opt(0, 0, 0)
            .map(|midnight| midnight.and_utc().timestamp_millis());
    }
    for format in ["%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M"] {
        if let Ok(naive) = NaiveDateTime::parse_from_str(text, format) {
            return Local
                .from_local_datetime(&naive)
                .single()
                .map(|moment| moment.timestamp_millis());
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::DEFAULT_LIMIT;

    #[test]
    fn limit_defaults_to_config() {
        assert_eq!(parse_limit(None, 25).expect("default passes through"), 25);
        assert_eq!(
            parse_limit(None, DEFAULT_LIMIT).expect("default passes through"),
            DEFAULT_LIMIT
        );
        assert_eq!(parse_limit(Some("10"), 50).expect("10 is valid"), 10);
    }

    #[test]
    fn limit_rejects_non_positive_and_non_integer() {
        for bad in ["abc", "0", "-3", "1.5", "", " 10", "10 ", "+5", "0x10"] {
            let err = parse_limit(Some(bad), 50).expect_err("limit must fail: {bad}");
            assert_eq!(err.to_string(), format!("invalid --limit: {bad}"));
            assert_eq!(err.exit_code(), 2);
        }
    }

    #[test]
    fn limit_rejects_out_of_range_integers() {
        let huge = "99999999999999999999999";
        let err = parse_limit(Some(huge), 50).expect_err("huge limit must fail");
        assert_eq!(err.to_string(), format!("invalid --limit: {huge}"));
        assert_eq!(err.exit_code(), 2);
    }

    #[test]
    fn offset_defaults_to_zero_and_rejects_bad_values() {
        assert_eq!(parse_offset(None).expect("None means 0"), 0);
        assert_eq!(parse_offset(Some("0")).expect("0 is valid"), 0);
        assert_eq!(parse_offset(Some("20")).expect("20 is valid"), 20);
        for bad in ["abc", "-1", "1.5", ""] {
            let err = parse_offset(Some(bad)).expect_err("offset must fail");
            assert_eq!(err.to_string(), format!("invalid --offset: {bad}"));
            assert_eq!(err.exit_code(), 2);
        }
    }

    #[test]
    fn id_is_required_and_must_be_an_integer() {
        let err = parse_id(None).expect_err("missing id must fail");
        assert_eq!(err.to_string(), "show requires --id N");
        assert_eq!(err.exit_code(), 2);
        assert_eq!(parse_id(Some("42")).expect("42 is valid"), 42);
        // JS parity: only non-integers are rejected, negatives pass.
        assert_eq!(parse_id(Some("-7")).expect("-7 passes"), -7);
        for bad in ["abc", "1.5", ""] {
            let err = parse_id(Some(bad)).expect_err("id must fail");
            assert_eq!(err.to_string(), format!("invalid --id: {bad}"));
            assert_eq!(err.exit_code(), 2);
        }
    }

    #[test]
    fn date_bound_accepts_yyyy_mm_dd_as_utc_midnight() {
        // 2026-01-10T00:00:00Z — same epoch the JS `Date.parse` yields and
        // the value the queries fixtures seed as `DAY_10`.
        assert_eq!(
            parse_date_bound(Some("2026-01-10"), "--from").expect("date parses"),
            Some(1_768_003_200_000)
        );
    }

    #[test]
    fn to_bound_is_end_of_day_inclusive() {
        // Noon of the same day (12h after UTC midnight) still matches a
        // `--to 2026-01-15` filter after the +86399999ms expansion.
        let noon = 1_768_435_200_000 + 12 * 3_600_000;
        let bound = parse_date_bound(Some("2026-01-15"), "--to")
            .expect("--to must parse")
            .expect("bound must be Some");
        assert_eq!(bound, 1_768_435_200_000 + END_OF_DAY_INCLUSIVE_MS);
        assert!(
            noon <= bound,
            "noon row ({noon}) must fall inside --to bound ({bound})"
        );
    }

    #[test]
    fn date_bound_accepts_full_iso_with_offset() {
        // Explicit offset honored: 09:00+09:00 == 00:00Z of the same day.
        assert_eq!(
            parse_date_bound(Some("2026-01-10T09:00:00+09:00"), "--from")
                .expect("offset datetime parses"),
            Some(1_768_003_200_000)
        );
        assert_eq!(
            parse_date_bound(Some("2026-01-10T00:00:00Z"), "--from").expect("UTC parses"),
            Some(1_768_003_200_000)
        );
    }

    #[test]
    fn date_bound_rejects_invalid_input() {
        for bad in ["not-a-date", "", "2026-13-40", "Jan 15 2026"] {
            let err = parse_date_bound(Some(bad), "--from").expect_err("date must fail");
            assert_eq!(err.to_string(), format!("invalid --from: {bad}"));
            assert_eq!(err.exit_code(), 2);
        }
        let err = parse_date_bound(Some("garbage"), "--to").expect_err("must fail");
        assert_eq!(err.to_string(), "invalid --to: garbage");
        assert_eq!(err.exit_code(), 2);
    }

    #[test]
    fn date_bound_none_stays_none() {
        assert!(parse_date_bound(None, "--from")
            .expect("None stays None")
            .is_none());
        assert!(parse_date_bound(None, "--to")
            .expect("None stays None")
            .is_none());
    }
}
