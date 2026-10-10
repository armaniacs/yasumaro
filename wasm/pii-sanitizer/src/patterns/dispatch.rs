//! Single-pass scan reproducing the TS combined regex's exact alternation
//! order and "commit to the first alternative that matches at this
//! position" semantics — see the crate-level doc for why this is necessary
//! (independent per-type scanning + longest-span overlap resolution is NOT
//! equivalent, as the parity test suite caught during core5's development).
//!
//! Pattern order here must match `PII_PATTERNS` in piiSanitizer.ts exactly:
//! email, creditCard(×3 sub-patterns), myNumber, phoneJp, bankAccount,
//! driverLicense, jpPassport, ipv4, ipv6, ssn, phoneUs, phoneCn, idCn,
//! rrnKr, phoneKr, iban, deTaxId, frInsee, itCodiceFiscale, esDni, esNie.
//!
//! Word-boundary-before gating: most patterns are `\b...\b` in the TS
//! source, so the regex engine only even attempts them where the preceding
//! byte is a non-word byte — our dispatch loop mirrors this by gating the
//! whole digit/upper-alpha-anchored block behind `is_word_boundary_before`.
//! Three patterns (phoneUs, phoneCn, phoneKr) have **no leading `\b`** — the
//! TS regex can start matching them mid-digit-run. These are tried at every
//! position regardless of word-boundary-before, in their normal source-order
//! slot, matching what the combined alternation actually does.

use super::common::is_word_boundary_before;
use super::core5::{self, CreditCardOutcome};
use super::extended;

const MAX_MATCH_COUNT: usize = 1000;

/// The scan stopped because the match-count cap was reached. Mirrors the TS
/// reference's `Operation exceeded maximum match count` behavior — the
/// hybrid's catch block falls back to `sanitizeRegex`, which throws the same
/// way, so the recording fails closed instead of shipping partially-masked
/// text as a success (the TS reference aborts the pipeline on this input).
#[derive(Debug)]
pub struct MatchLimitExceeded;

/// Returns `Err(MatchLimitExceeded)` once more than `MAX_MATCH_COUNT` matches
/// have been found — the same threshold at which the TS combined-regex scan
/// throws (`matchCount > MAX_MATCH_COUNT`).
pub fn scan(bytes: &[u8]) -> Result<Vec<(usize, usize, &'static str)>, MatchLimitExceeded> {
    let len = bytes.len();
    let mut items = Vec::new();
    let mut i = 0;

    while i < len && items.len() <= MAX_MATCH_COUNT {
        match attempt_at(bytes, i) {
            Attempt::Emit { end, kind } => {
                items.push((i, end, kind));
                i = end;
            }
            Attempt::Consumed { end } => {
                i = end;
            }
            Attempt::NoMatch => {
                i += 1;
            }
        }
    }

    if items.len() > MAX_MATCH_COUNT {
        return Err(MatchLimitExceeded);
    }
    Ok(items)
}

/// Outcome of the single-position alternation attempt at one byte offset.
/// Extracted from the `scan` loop body so the chunk-scan port in `lib.rs`
/// can reuse the exact same dispatch order as a sticky probe at an absolute
/// position (the Rust equivalent of the TS `probeRegex` with the `y` flag
/// executed against the full text).
enum Attempt {
    /// A pattern matched (Luhn-validated where applicable): emit a span.
    Emit { end: usize, kind: &'static str },
    /// A creditCard sub-pattern matched at the regex level but failed Luhn:
    /// no span is emitted, yet the position is still consumed through `end`
    /// (the regex engine already committed to the match; scanning resumes
    /// there without fallthrough to lower-priority alternatives).
    Consumed { end: usize },
    /// No alternative matched at this position: advance by one byte.
    NoMatch,
}

/// Runs the full alternation in source order at exactly `pos`, mirroring
/// what the TS combined regex attempts at one `lastIndex`. Callers must
/// guarantee `pos < bytes.len()` (all arms index `bytes[pos]`).
fn attempt_at(bytes: &[u8], pos: usize) -> Attempt {
    if let Some(m) = core5::try_email(bytes, pos) {
        return Attempt::Emit { end: m.end, kind: m.kind };
    }

    let boundary_before = is_word_boundary_before(bytes, pos);
    let is_digit = bytes[pos].is_ascii_digit();

    if is_digit && boundary_before {
        match core5::try_credit_card(bytes, pos) {
            CreditCardOutcome::Masked(m) => {
                return Attempt::Emit { end: m.end, kind: m.kind };
            }
            CreditCardOutcome::RejectedNoFallthrough { end } => {
                return Attempt::Consumed { end };
            }
            CreditCardOutcome::NoMatch => {}
        }

        if let Some(m) = core5::try_my_number(bytes, pos) {
            return Attempt::Emit { end: m.end, kind: m.kind };
        }

        if bytes[pos] == b'0' {
            if let Some(m) = core5::try_phone_jp(bytes, pos) {
                return Attempt::Emit { end: m.end, kind: m.kind };
            }
        }

        if let Some(m) = core5::try_bank_account(bytes, pos) {
            return Attempt::Emit { end: m.end, kind: m.kind };
        }
        if let Some(m) = extended::try_driver_license(bytes, pos) {
            return Attempt::Emit { end: m.end, kind: m.kind };
        }
    }

    if boundary_before && bytes[pos].is_ascii_uppercase() {
        if let Some(m) = extended::try_jp_passport(bytes, pos) {
            return Attempt::Emit { end: m.end, kind: m.kind };
        }
    }

    if is_digit && boundary_before {
        if let Some(m) = extended::try_ipv4(bytes, pos) {
            return Attempt::Emit { end: m.end, kind: m.kind };
        }
        if let Some(m) = extended::try_ssn(bytes, pos) {
            return Attempt::Emit { end: m.end, kind: m.kind };
        }
    }

    // ipv6's TS char class starts with [0-9a-fA-F] — full-form addresses
    // like fe80:0000:...:0001 begin with a hex letter, so gating on
    // is_digit alone (as ipv4/ssn correctly can) misses them entirely.
    if bytes[pos].is_ascii_hexdigit() && boundary_before {
        if let Some(m) = extended::try_ipv6(bytes, pos) {
            return Attempt::Emit { end: m.end, kind: m.kind };
        }
    }

    // phoneUs: no leading \b — try regardless of boundary_before, but
    // only at positions that could plausibly start it (digit, '(', or
    // '+') to avoid wasted work on every byte.
    if is_digit || bytes[pos] == b'(' || bytes[pos] == b'+' {
        if let Some(m) = extended::try_phone_us(bytes, pos) {
            return Attempt::Emit { end: m.end, kind: m.kind };
        }
    }

    // phoneCn: no leading \b.
    if is_digit || bytes[pos] == b'+' {
        if let Some(m) = extended::try_phone_cn(bytes, pos) {
            return Attempt::Emit { end: m.end, kind: m.kind };
        }
    }

    if is_digit && boundary_before {
        if let Some(m) = extended::try_id_cn(bytes, pos) {
            return Attempt::Emit { end: m.end, kind: m.kind };
        }
        if let Some(m) = extended::try_rrn_kr(bytes, pos) {
            return Attempt::Emit { end: m.end, kind: m.kind };
        }
    }

    // phoneKr: no leading \b.
    if is_digit || bytes[pos] == b'+' {
        if let Some(m) = extended::try_phone_kr(bytes, pos) {
            return Attempt::Emit { end: m.end, kind: m.kind };
        }
    }

    if boundary_before && bytes[pos].is_ascii_uppercase() {
        if let Some(m) = extended::try_iban(bytes, pos) {
            return Attempt::Emit { end: m.end, kind: m.kind };
        }
    }

    if is_digit && boundary_before {
        if let Some(m) = extended::try_de_tax_id(bytes, pos) {
            return Attempt::Emit { end: m.end, kind: m.kind };
        }
        if let Some(m) = extended::try_fr_insee(bytes, pos) {
            return Attempt::Emit { end: m.end, kind: m.kind };
        }
    }

    if boundary_before && bytes[pos].is_ascii_uppercase() {
        if let Some(m) = extended::try_it_codice_fiscale(bytes, pos) {
            return Attempt::Emit { end: m.end, kind: m.kind };
        }
    }

    if is_digit && boundary_before {
        if let Some(m) = extended::try_es_dni(bytes, pos) {
            return Attempt::Emit { end: m.end, kind: m.kind };
        }
    }

    if boundary_before && matches!(bytes[pos], b'X' | b'Y' | b'Z') {
        if let Some(m) = extended::try_es_nie(bytes, pos) {
            return Attempt::Emit { end: m.end, kind: m.kind };
        }
    }

    Attempt::NoMatch
}

/// Sticky single-position probe: what the combined regex would match at
/// exactly `pos` on these bytes, returned as the match length. This is the
/// Rust equivalent of the TS `probeRegex` (`y`-flagged sticky exec against
/// the full text): the caller passes the FULL input and an absolute start,
/// and gets back the true text-level span length — or `None` when nothing
/// matches there (a pure chunk-edge artifact, e.g. a `\b` that only holds
/// because the chunk was severed).
///
/// Luhn is deliberately ignored here: the TS probe runs before Luhn
/// validation, so a Luhn-rejected creditCard still counts as "something
/// matches at this start" (`Consumed` maps to `Some`, same as `Emit`).
/// Returns `None` for out-of-range positions.
pub fn probe_match_len(bytes: &[u8], pos: usize) -> Option<usize> {
    if pos >= bytes.len() {
        return None;
    }
    match attempt_at(bytes, pos) {
        Attempt::Emit { end, .. } | Attempt::Consumed { end } => Some(end - pos),
        Attempt::NoMatch => None,
    }
}
