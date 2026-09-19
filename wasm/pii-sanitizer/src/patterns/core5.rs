//! The 5 highest-volume PII patterns (email, creditCard, myNumber, phoneJp,
//! bankAccount) — see the crate-level doc for why these were ported first
//! and how their matching semantics were verified against the TS regex
//! engine byte-for-byte.

use super::common::*;

/// email: [a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}
/// Regex semantics: greedily consume the local part forward from `start`,
/// require '@', then a greedily-consumed domain ending in '.' + >=2 alpha.
/// If the domain doesn't satisfy that, there's no backtracking into a
/// shorter local part here (the local-part char class doesn't overlap with
/// what would need to shrink) — the single failure point that matters is
/// "local run doesn't end at '@'", so no `@` within reach means no match.
pub fn try_email(bytes: &[u8], start: usize) -> Option<Match> {
    fn is_local(b: u8) -> bool {
        b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'%' | b'+' | b'-')
    }
    fn is_domain(b: u8) -> bool {
        b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-')
    }

    if !is_local(bytes[start]) {
        return None;
    }
    let len = bytes.len();
    let mut local_end = start;
    while local_end < len && is_local(bytes[local_end]) {
        local_end += 1;
    }
    if local_end >= len || bytes[local_end] != b'@' {
        return None;
    }
    let domain_start = local_end + 1;
    let mut domain_end = domain_start;
    while domain_end < len && is_domain(bytes[domain_end]) {
        domain_end += 1;
    }
    let domain = &bytes[domain_start..domain_end];
    let dot_rel = domain.iter().rposition(|&b| b == b'.')?;
    let tld = &domain[dot_rel + 1..];
    if tld.len() >= 2 && tld.iter().all(|b| b.is_ascii_alphabetic()) && dot_rel > 0 {
        Some(Match {
            end: domain_end,
            kind: "email",
        })
    } else {
        None
    }
}

fn try_cc_grouped(bytes: &[u8], start: usize) -> Option<usize> {
    // \d{4}([-\s]\d{4}){3}
    let mut pos = take_digits(bytes, start, 4)?;
    for _ in 0..3 {
        if pos >= bytes.len() || !is_sep(bytes[pos]) {
            return None;
        }
        pos += 1;
        pos = take_digits(bytes, pos, 4)?;
    }
    Some(pos)
}

fn try_cc_16(bytes: &[u8], start: usize) -> Option<usize> {
    take_digits(bytes, start, 16)
}

fn try_cc_15(bytes: &[u8], start: usize) -> Option<usize> {
    // \d{4}[-\s]\d{6}[-\s]\d{5}
    let mut pos = take_digits(bytes, start, 4)?;
    if pos >= bytes.len() || !is_sep(bytes[pos]) {
        return None;
    }
    pos += 1;
    pos = take_digits(bytes, pos, 6)?;
    if pos >= bytes.len() || !is_sep(bytes[pos]) {
        return None;
    }
    pos += 1;
    take_digits(bytes, pos, 5)
}

/// creditCard, tried as 3 sub-patterns in source order (grouped, then 16,
/// then 15) — each is `\b...\b` in the TS source, so a candidate whose span
/// isn't word-bounded is a genuine non-match for that sub-pattern (the
/// regex engine tries the next alternative, same as any failed alternation
/// branch), not a "matched but rejected" case.
///
/// Once a sub-pattern's span IS word-bounded, the regex has committed to it
/// — `match.index`/`lastIndex` are fixed to that span — and Luhn validation
/// runs afterward, in the caller's code, on the already-matched text. A
/// Luhn failure does not un-commit the regex match: it does not fall
/// through to try myNumber or another type at this position, and the next
/// `exec()` call still resumes scanning from this match's end (`lastIndex`
/// only ever advances to the end of whatever the regex matched).
pub enum CreditCardOutcome {
    /// A sub-pattern matched (word-bounded) and passed Luhn.
    Masked(Match),
    /// A sub-pattern matched (word-bounded) but failed Luhn — the position
    /// is still consumed through `end` (scanning resumes there), just
    /// without emitting a mask.
    RejectedNoFallthrough { end: usize },
    /// No sub-pattern produced a word-bounded match at this position.
    NoMatch,
}

pub fn try_credit_card(bytes: &[u8], start: usize) -> CreditCardOutcome {
    if !bytes[start].is_ascii_digit() {
        return CreditCardOutcome::NoMatch;
    }
    for candidate_end in [
        try_cc_grouped(bytes, start),
        try_cc_16(bytes, start),
        try_cc_15(bytes, start),
    ] {
        let Some(end) = candidate_end else { continue };
        if !is_word_boundary_after(bytes, end) {
            // This sub-pattern's `\b` failed — try the next alternative,
            // same as the regex engine would.
            continue;
        }
        let digits: String = bytes[start..end]
            .iter()
            .filter(|b| b.is_ascii_digit())
            .map(|&b| b as char)
            .collect();
        return if luhn_valid(&digits) {
            CreditCardOutcome::Masked(Match {
                end,
                kind: "creditCard",
            })
        } else {
            CreditCardOutcome::RejectedNoFallthrough { end }
        };
    }
    CreditCardOutcome::NoMatch
}

/// myNumber: \b\d{4}[-\s]\d{4}[-\s]\d{4}\b
pub fn try_my_number(bytes: &[u8], start: usize) -> Option<Match> {
    let len = bytes.len();
    let mut pos = take_digits(bytes, start, 4)?;
    if pos >= len || !is_sep(bytes[pos]) {
        return None;
    }
    pos += 1;
    pos = take_digits(bytes, pos, 4)?;
    if pos >= len || !is_sep(bytes[pos]) {
        return None;
    }
    pos += 1;
    let end = take_digits(bytes, pos, 4)?;
    is_word_boundary_after(bytes, end).then_some(Match {
        end,
        kind: "myNumber",
    })
}

/// phoneJp: 0\d{1,4}[-\s]?\d{1,4}[-\s]?\d{4}
/// Regex greediness: each `\d{1,4}` group prefers the longest match first,
/// backtracking to shorter only if the rest of the pattern then fails.
pub fn try_phone_jp(bytes: &[u8], start: usize) -> Option<Match> {
    let len = bytes.len();
    if bytes[start] != b'0' {
        return None;
    }
    // Backtracking order must match the regex engine's: for each `\d{1,4}`,
    // try longest first; for each `[-\s]?`, try "consumed" before "not
    // consumed" (a `?` quantifier is greedy by default). The first fully
    // successful combination — including the trailing `\b` — is the one
    // the regex engine would return, so try combinations in that exact
    // order and return on first success rather than always consuming an
    // optional separator when present (which forecloses the "well-formed
    // match ignoring a run of extra digits after a separator" case, e.g.
    // "090-1234-5678" matching as "090-1234" with sep1 consumed but sep2
    // *not* consumed and g2 falling back to a shorter run).
    for g1 in (1..=4).rev() {
        let pos = match take_digits(bytes, start + 1, g1) {
            Some(p) => p,
            None => continue,
        };
        let sep1_variants: &[usize] = if pos < len && is_sep(bytes[pos]) {
            &[1, 0]
        } else {
            &[0]
        };
        for &sep1 in sep1_variants {
            let pos_after_sep1 = pos + sep1;
            for g2 in (1..=4).rev() {
                let p2 = match take_digits(bytes, pos_after_sep1, g2) {
                    Some(p) => p,
                    None => continue,
                };
                let sep2_variants: &[usize] = if p2 < len && is_sep(bytes[p2]) {
                    &[1, 0]
                } else {
                    &[0]
                };
                for &sep2 in sep2_variants {
                    let p2_after_sep = p2 + sep2;
                    if let Some(end) = take_digits(bytes, p2_after_sep, 4) {
                        if is_word_boundary_after(bytes, end) {
                            return Some(Match {
                                end,
                                kind: "phoneJp",
                            });
                        }
                    }
                }
            }
        }
    }
    None
}

/// bankAccount: \b\d{7}\b
pub fn try_bank_account(bytes: &[u8], start: usize) -> Option<Match> {
    let end = take_digits(bytes, start, 7)?;
    is_word_boundary_after(bytes, end).then_some(Match {
        end,
        kind: "bankAccount",
    })
}
