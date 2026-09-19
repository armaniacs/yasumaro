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

/// Width in bytes of the JS `\s` whitespace run starting at `pos`
/// (0 = not whitespace). Covers the FULL JS `\s` set, not just ASCII:
/// the ASCII members (`\t\n\v\f\r` + space) are 1 byte, and the non-ASCII
/// members are 2-3 bytes in UTF-8 — a phone number or My Number formatted
/// with a full-width (U+3000) or non-breaking (U+00A0) space is masked by
/// the TS reference and would silently leak if only ASCII whitespace were
/// accepted here.
pub fn js_ws_len(bytes: &[u8], pos: usize) -> usize {
    if pos >= bytes.len() {
        return 0;
    }
    match bytes[pos] {
        b'\t' | b'\n' | b'\x0b' | b'\x0c' | b'\r' | b' ' => 1,
        // U+00A0 NBSP: C2 A0
        0xC2 if pos + 1 < bytes.len() && bytes[pos + 1] == 0xA0 => 2,
        // U+1680 Ogham space mark: E1 9A 80
        0xE1 if pos + 2 < bytes.len() && bytes[pos + 1] == 0x9A && bytes[pos + 2] == 0x80 => 3,
        // U+2000..U+200A (en quad .. hair space): E2 80 80..8A
        // U+2028 line sep / U+2029 paragraph sep: E2 80 A8 / A9
        // U+202F narrow no-break space: E2 80 AF
        0xE2 if pos + 2 < bytes.len() && bytes[pos + 1] == 0x80 => match bytes[pos + 2] {
            0x80..=0x8A | 0xA8 | 0xA9 | 0xAF => 3,
            _ => 0,
        },
        // U+205F medium mathematical space: E2 81 9F
        0xE2 if pos + 2 < bytes.len() && bytes[pos + 1] == 0x81 && bytes[pos + 2] == 0x9F => 3,
        // U+3000 ideographic space: E3 80 80
        0xE3 if pos + 2 < bytes.len() && bytes[pos + 1] == 0x80 && bytes[pos + 2] == 0x80 => 3,
        // U+FEFF zero-width no-break space (BOM): EF BB BF
        0xEF if pos + 2 < bytes.len() && bytes[pos + 1] == 0xBB && bytes[pos + 2] == 0xBF => 3,
        _ => 0,
    }
}

/// Width in bytes of the `[-\s]` char class at `pos` (0 = not a separator).
/// The width-aware replacement for the old byte-at-a-time `is_sep`: the
/// non-ASCII members of JS `\s` (U+00A0, U+3000 ideographic space,
/// U+2000-200A, ...) occupy 2-3 bytes in UTF-8, and consuming only their
/// lead byte would leave the following continuation byte to be read as a
/// digit (which never matches), so width-aware full-width-separated PII
/// would still be missed.
pub fn sep_len(bytes: &[u8], pos: usize) -> usize {
    if pos < bytes.len() && bytes[pos] == b'-' {
        return 1;
    }
    js_ws_len(bytes, pos)
}

/// Width in bytes of the `[-.\s]` char class (adds '.') at `pos`
/// (0 = not a separator).
pub fn sep_dot_len(bytes: &[u8], pos: usize) -> usize {
    if pos < bytes.len() && bytes[pos] == b'.' {
        return 1;
    }
    sep_len(bytes, pos)
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
