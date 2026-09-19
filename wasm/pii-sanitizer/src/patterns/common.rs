//! Shared primitives used by every pattern matcher: byte-class helpers,
//! digit-run consumption, and the `Match` result type. Kept separate from
//! `dispatch.rs` so each pattern file can `use super::common::*` without
//! pulling in the dispatch loop.

pub fn is_word_boundary_before(bytes: &[u8], pos: usize) -> bool {
    pos == 0 || !is_word_byte(bytes[pos - 1])
}

pub fn is_word_boundary_after(bytes: &[u8], pos: usize) -> bool {
    pos >= bytes.len() || !is_word_byte(bytes[pos])
}

pub fn is_word_byte(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_'
}

/// `[-\s]` char class used by several JP/CN/KR patterns. JS `\s` covers the
/// full ASCII whitespace set (`\t\n\v\f\r` + space), so the scanner must
/// too: a phone number or My Number formatted across line breaks in
/// extracted page text is masked by the TS reference and would silently
/// leak if only space/tab were accepted here.
///
/// Known residual gap: the non-ASCII members of JS `\s` (U+00A0, U+3000
/// ideographic space, U+2000-200A, ...) are multi-byte in UTF-8, and every
/// separator call site consumes exactly one byte, so they are NOT accepted
/// here. A width-aware separator helper across all matchers is the
/// follow-up if full-width-separated PII turns out to matter.
pub fn is_sep(b: u8) -> bool {
    matches!(b, b'-' | b'\t' | b'\n' | b'\x0b' | b'\x0c' | b'\r' | b' ')
}

/// `[-.\s]` char class (adds '.') used by rrnKr/phoneKr/phoneUs/phoneCn.
pub fn is_sep_dot(b: u8) -> bool {
    is_sep(b) || b == b'.'
}

pub fn take_digits(bytes: &[u8], start: usize, n: usize) -> Option<usize> {
    if start + n > bytes.len() {
        return None;
    }
    if bytes[start..start + n].iter().all(|b| b.is_ascii_digit()) {
        Some(start + n)
    } else {
        None
    }
}

pub fn luhn_valid(digits: &str) -> bool {
    if digits.len() < 13 || digits.len() > 19 {
        return false;
    }
    let mut sum = 0u32;
    let mut even = false;
    for b in digits.bytes().rev() {
        let mut d = (b - b'0') as u32;
        if even {
            d *= 2;
            if d > 9 {
                d -= 9;
            }
        }
        sum += d;
        even = !even;
    }
    sum % 10 == 0
}

pub struct Match {
    pub end: usize,
    pub kind: &'static str,
}
