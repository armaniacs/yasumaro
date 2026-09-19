//! The 16 locale-specific PII patterns beyond the 5 highest-volume ones in
//! `core5.rs`. Ported directly from `PII_PATTERNS` in piiSanitizer.ts,
//! preserving that array's exact source order (see dispatch.rs) since that
//! order is what the combined regex's alternation priority depends on.
//!
//! Word-boundary note: most of these patterns are `\b...\b` (both ends
//! bounded), but phoneUs/phoneCn/phoneKr have **no leading `\b`** in the TS
//! source (they start with an optional `(?:...)?` group, and `\b` can't
//! anchor before an optional literal that might not be present) — only a
//! trailing `\b`. This matters because our dispatch loop otherwise only
//! calls these on positions where the *previous* byte is a non-word byte;
//! for these 3, matching a "1..." or "0..." digit run makes checking a
//! leading `\b` moot anyway (the pattern doesn't require one), so dispatch.rs
//! must try them at digit AND non-digit-lookback positions the other
//! patterns don't (see dispatch.rs's comment on this).

use super::common::*;

/// driverLicense: \b\d{12}\b
pub fn try_driver_license(bytes: &[u8], start: usize) -> Option<Match> {
    let end = take_digits(bytes, start, 12)?;
    is_word_boundary_after(bytes, end).then_some(Match {
        end,
        kind: "driverLicense",
    })
}

/// jpPassport: \b[A-Z]{2}\d{7}\b
pub fn try_jp_passport(bytes: &[u8], start: usize) -> Option<Match> {
    if start + 9 > bytes.len() {
        return None;
    }
    if !bytes[start].is_ascii_uppercase() || !bytes[start + 1].is_ascii_uppercase() {
        return None;
    }
    let end = take_digits(bytes, start + 2, 7)?;
    is_word_boundary_after(bytes, end).then_some(Match {
        end,
        kind: "jpPassport",
    })
}

/// ipv4 (private ranges only): \b(?:10\.oct\.oct\.oct|172\.(?:1[6-9]|2\d|3[01])\.oct\.oct|192\.168\.oct\.oct)\b
/// where oct = 25[0-5]|2[0-4]\d|[01]?\d\d?
fn try_octet(bytes: &[u8], start: usize) -> Option<usize> {
    // 25[0-5] (3 digits, 250-255)
    if start + 3 <= bytes.len() && bytes[start] == b'2' && bytes[start + 1] == b'5' {
        let d2 = bytes[start + 2];
        if (b'0'..=b'5').contains(&d2) {
            return Some(start + 3);
        }
    }
    // 2[0-4]\d (3 digits, 200-249)
    if start + 3 <= bytes.len() && bytes[start] == b'2' {
        let d1 = bytes[start + 1];
        if (b'0'..=b'4').contains(&d1) && bytes[start + 2].is_ascii_digit() {
            return Some(start + 3);
        }
    }
    // [01]?\d\d? — greedy: try 3 digits, then 2, then 1
    for len in [3usize, 2, 1] {
        if let Some(end) = take_digits(bytes, start, len) {
            let first = bytes[start];
            if len == 3 && !(first == b'0' || first == b'1') {
                continue;
            }
            return Some(end);
        }
    }
    None
}

fn expect_literal(bytes: &[u8], start: usize, lit: &[u8]) -> Option<usize> {
    if bytes.len() >= start + lit.len() && &bytes[start..start + lit.len()] == lit {
        Some(start + lit.len())
    } else {
        None
    }
}

pub fn try_ipv4(bytes: &[u8], start: usize) -> Option<Match> {
    fn try_10(bytes: &[u8], start: usize) -> Option<usize> {
        let mut pos = expect_literal(bytes, start, b"10.")?;
        for i in 0..3 {
            pos = try_octet(bytes, pos)?;
            if i < 2 {
                pos = expect_literal(bytes, pos, b".")?;
            }
        }
        Some(pos)
    }
    fn try_172(bytes: &[u8], start: usize) -> Option<usize> {
        let mut pos = expect_literal(bytes, start, b"172.")?;
        // 1[6-9]|2\d|3[01]
        let two = &bytes[pos..(pos + 2).min(bytes.len())];
        if two.len() < 2 {
            return None;
        }
        let ok = (two[0] == b'1' && (b'6'..=b'9').contains(&two[1]))
            || (two[0] == b'2' && two[1].is_ascii_digit())
            || (two[0] == b'3' && (two[1] == b'0' || two[1] == b'1'));
        if !ok {
            return None;
        }
        pos += 2;
        pos = expect_literal(bytes, pos, b".")?;
        pos = try_octet(bytes, pos)?;
        pos = expect_literal(bytes, pos, b".")?;
        pos = try_octet(bytes, pos)?;
        Some(pos)
    }
    fn try_192(bytes: &[u8], start: usize) -> Option<usize> {
        let mut pos = expect_literal(bytes, start, b"192.168.")?;
        pos = try_octet(bytes, pos)?;
        pos = expect_literal(bytes, pos, b".")?;
        pos = try_octet(bytes, pos)?;
        Some(pos)
    }

    for candidate in [
        try_10(bytes, start),
        try_172(bytes, start),
        try_192(bytes, start),
    ] {
        if let Some(end) = candidate {
            if is_word_boundary_after(bytes, end) {
                return Some(Match { end, kind: "ipv4" });
            }
        }
    }
    None
}

/// ipv6: \b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b
pub fn try_ipv6(bytes: &[u8], start: usize) -> Option<Match> {
    let mut pos = start;
    for _ in 0..7 {
        let group_end = take_hex_digits(bytes, pos, 1, 4)?;
        pos = group_end;
        if pos >= bytes.len() || bytes[pos] != b':' {
            return None;
        }
        pos += 1;
    }
    let end = take_hex_digits(bytes, pos, 1, 4)?;
    is_word_boundary_after(bytes, end).then_some(Match { end, kind: "ipv6" })
}

fn take_hex_digits(bytes: &[u8], start: usize, min: usize, max: usize) -> Option<usize> {
    let mut end = start;
    while end < bytes.len() && end - start < max && bytes[end].is_ascii_hexdigit() {
        end += 1;
    }
    (end - start >= min).then_some(end)
}

/// ssn: \b\d{3}-\d{2}-\d{4}\b
pub fn try_ssn(bytes: &[u8], start: usize) -> Option<Match> {
    let mut pos = take_digits(bytes, start, 3)?;
    pos = expect_literal(bytes, pos, b"-")?;
    pos = take_digits(bytes, pos, 2)?;
    pos = expect_literal(bytes, pos, b"-")?;
    let end = take_digits(bytes, pos, 4)?;
    is_word_boundary_after(bytes, end).then_some(Match { end, kind: "ssn" })
}

/// phoneUs: (?:\+?1[-.\s])?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b
/// No leading \b — the optional prefix group means a match can start
/// mid-digit-run from the regex engine's perspective, so dispatch tries
/// this at every digit position regardless of word-boundary-before.
pub fn try_phone_us(bytes: &[u8], start: usize) -> Option<Match> {
    let mut pos = start;
    // (?:\+?1[-.\s])?
    if let Some(after_plus) = expect_literal(bytes, pos, b"+") {
        if let Some(after_1) = expect_literal(bytes, after_plus, b"1") {
            if after_1 < bytes.len() && is_sep_dot(bytes[after_1]) {
                pos = after_1 + 1;
            }
        }
    } else if let Some(after_1) = expect_literal(bytes, pos, b"1") {
        if after_1 < bytes.len() && is_sep_dot(bytes[after_1]) {
            pos = after_1 + 1;
        }
    }
    // \(?
    let after_paren = expect_literal(bytes, pos, b"(").unwrap_or(pos);
    // \d{3}
    let after_area = take_digits(bytes, after_paren, 3)?;
    // \)?
    let after_close = expect_literal(bytes, after_area, b")").unwrap_or(after_area);
    // [-.\s]
    if after_close >= bytes.len() || !is_sep_dot(bytes[after_close]) {
        return None;
    }
    let after_sep1 = after_close + 1;
    // \d{3}
    let after_exch = take_digits(bytes, after_sep1, 3)?;
    // [-.\s]
    if after_exch >= bytes.len() || !is_sep_dot(bytes[after_exch]) {
        return None;
    }
    let after_sep2 = after_exch + 1;
    // \d{4}\b
    let end = take_digits(bytes, after_sep2, 4)?;
    is_word_boundary_after(bytes, end).then_some(Match {
        end,
        kind: "phoneUs",
    })
}

/// phoneCn: (?:\+?86[-.\s]?)?1[3-9]\d{9}\b — no leading \b.
pub fn try_phone_cn(bytes: &[u8], start: usize) -> Option<Match> {
    let mut pos = start;
    if let Some(after_plus) = expect_literal(bytes, pos, b"+") {
        pos = expect_literal(bytes, after_plus, b"86").unwrap_or(pos);
        if pos != start {
            if pos < bytes.len() && is_sep_dot(bytes[pos]) {
                pos += 1;
            }
        } else {
            return None; // consumed '+' but not "86" — regex requires 86 if + present
        }
    } else if let Some(after_86) = expect_literal(bytes, pos, b"86") {
        pos = after_86;
        if pos < bytes.len() && is_sep_dot(bytes[pos]) {
            pos += 1;
        }
    }
    if pos >= bytes.len() || bytes[pos] != b'1' {
        return None;
    }
    let second = bytes.get(pos + 1)?;
    if !(b'3'..=b'9').contains(second) {
        return None;
    }
    let end = take_digits(bytes, pos + 2, 9)?;
    is_word_boundary_after(bytes, end).then_some(Match {
        end,
        kind: "phoneCn",
    })
}

/// idCn: \b\d{17}[\dXx]\b
pub fn try_id_cn(bytes: &[u8], start: usize) -> Option<Match> {
    let pos = take_digits(bytes, start, 17)?;
    if pos >= bytes.len() {
        return None;
    }
    let last = bytes[pos];
    if !(last.is_ascii_digit() || last == b'X' || last == b'x') {
        return None;
    }
    let end = pos + 1;
    is_word_boundary_after(bytes, end).then_some(Match { end, kind: "idCn" })
}

/// rrnKr: \b\d{6}[-.\s]?[1-4]\d{6}\b
pub fn try_rrn_kr(bytes: &[u8], start: usize) -> Option<Match> {
    let mut pos = take_digits(bytes, start, 6)?;
    if pos < bytes.len() && is_sep_dot(bytes[pos]) {
        pos += 1;
    }
    if pos >= bytes.len() || !(b'1'..=b'4').contains(&bytes[pos]) {
        return None;
    }
    pos += 1;
    let end = take_digits(bytes, pos, 6)?;
    is_word_boundary_after(bytes, end).then_some(Match { end, kind: "rrnKr" })
}

/// phoneKr: (?:\+?82[-.\s]?)?0?\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}\b — no leading \b.
/// Full backtracking over every optional element in source order (longest
/// first) mirrors the regex engine, same approach as try_phone_jp in
/// core5.rs.
pub fn try_phone_kr(bytes: &[u8], start: usize) -> Option<Match> {
    let len = bytes.len();

    // (?:\+?82[-.\s]?)? — try "present" before "absent" (greedy optional).
    let mut prefix_starts = vec![start];
    if let Some(after_82) = expect_literal(bytes, start, b"82") {
        let mut p = after_82;
        if p < len && is_sep_dot(bytes[p]) {
            p += 1;
        }
        prefix_starts.insert(0, p);
        // separator optional within the +82 group too — also try without consuming it
        prefix_starts.insert(1, after_82);
    }
    if let Some(after_plus) = expect_literal(bytes, start, b"+") {
        if let Some(after_82) = expect_literal(bytes, after_plus, b"82") {
            let mut p = after_82;
            if p < len && is_sep_dot(bytes[p]) {
                p += 1;
            }
            prefix_starts.insert(0, p);
            prefix_starts.insert(1, after_82);
        }
    }

    for &prefix_end in &prefix_starts {
        // 0? — greedy optional
        for zero_variant in [true, false] {
            let after_zero = if zero_variant {
                match expect_literal(bytes, prefix_end, b"0") {
                    Some(p) => p,
                    None => continue,
                }
            } else {
                prefix_end
            };

            for g1 in (1..=2).rev() {
                let after_g1 = match take_digits(bytes, after_zero, g1) {
                    Some(p) => p,
                    None => continue,
                };
                let sep1_variants: &[usize] = if after_g1 < len && is_sep_dot(bytes[after_g1]) {
                    &[1, 0]
                } else {
                    &[0]
                };
                for &s1 in sep1_variants {
                    let after_sep1 = after_g1 + s1;
                    for g2 in (3..=4).rev() {
                        let after_g2 = match take_digits(bytes, after_sep1, g2) {
                            Some(p) => p,
                            None => continue,
                        };
                        let sep2_variants: &[usize] =
                            if after_g2 < len && is_sep_dot(bytes[after_g2]) {
                                &[1, 0]
                            } else {
                                &[0]
                            };
                        for &s2 in sep2_variants {
                            let after_sep2 = after_g2 + s2;
                            if let Some(end) = take_digits(bytes, after_sep2, 4) {
                                if is_word_boundary_after(bytes, end) {
                                    return Some(Match {
                                        end,
                                        kind: "phoneKr",
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    None
}

/// iban: \b(?:DE\d{20}|FR\d{2}[A-Z0-9]{23}|IT\d{2}[A-Z0-9]{23}|ES\d{2}[A-Z0-9]{20}|NL\d{2}[A-Z0-9]{14})\b
pub fn try_iban(bytes: &[u8], start: usize) -> Option<Match> {
    fn alnum_upper(b: u8) -> bool {
        b.is_ascii_uppercase() || b.is_ascii_digit()
    }
    fn take_alnum(bytes: &[u8], start: usize, n: usize) -> Option<usize> {
        if start + n > bytes.len() {
            return None;
        }
        bytes[start..start + n]
            .iter()
            .all(|&b| alnum_upper(b))
            .then_some(start + n)
    }

    let candidates: [(&[u8], usize); 5] = [
        (b"DE", 20),
        (b"FR", 23),
        (b"IT", 23),
        (b"ES", 20),
        (b"NL", 14),
    ];
    for (prefix, digit_or_alnum_len) in candidates {
        if let Some(after_prefix) = expect_literal(bytes, start, prefix) {
            let after_check = take_digits(bytes, after_prefix, 2);
            let Some(after_check) = after_check else {
                continue;
            };
            let body_len = if prefix == b"DE" {
                digit_or_alnum_len - 2
            } else {
                digit_or_alnum_len
            };
            let end = if prefix == b"DE" {
                take_digits(bytes, after_check, body_len)
            } else {
                take_alnum(bytes, after_check, body_len)
            };
            if let Some(end) = end {
                if is_word_boundary_after(bytes, end) {
                    return Some(Match { end, kind: "iban" });
                }
            }
        }
    }
    None
}

/// deTaxId: \b[1-9]\d{10}\b
pub fn try_de_tax_id(bytes: &[u8], start: usize) -> Option<Match> {
    if !(b'1'..=b'9').contains(&bytes[start]) {
        return None;
    }
    let end = take_digits(bytes, start + 1, 10)?;
    is_word_boundary_after(bytes, end).then_some(Match {
        end,
        kind: "deTaxId",
    })
}

/// frInsee: \b\d{15}\b
pub fn try_fr_insee(bytes: &[u8], start: usize) -> Option<Match> {
    let end = take_digits(bytes, start, 15)?;
    is_word_boundary_after(bytes, end).then_some(Match {
        end,
        kind: "frInsee",
    })
}

/// itCodiceFiscale: \b[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]\b
pub fn try_it_codice_fiscale(bytes: &[u8], start: usize) -> Option<Match> {
    let mut pos = start;
    for _ in 0..6 {
        if pos >= bytes.len() || !bytes[pos].is_ascii_uppercase() {
            return None;
        }
        pos += 1;
    }
    pos = take_digits(bytes, pos, 2)?;
    if pos >= bytes.len() || !bytes[pos].is_ascii_uppercase() {
        return None;
    }
    pos += 1;
    pos = take_digits(bytes, pos, 2)?;
    if pos >= bytes.len() || !bytes[pos].is_ascii_uppercase() {
        return None;
    }
    pos += 1;
    pos = take_digits(bytes, pos, 3)?;
    if pos >= bytes.len() || !bytes[pos].is_ascii_uppercase() {
        return None;
    }
    let end = pos + 1;
    is_word_boundary_after(bytes, end).then_some(Match {
        end,
        kind: "itCodiceFiscale",
    })
}

/// esDni: \b\d{8}[A-Z]\b
pub fn try_es_dni(bytes: &[u8], start: usize) -> Option<Match> {
    let pos = take_digits(bytes, start, 8)?;
    if pos >= bytes.len() || !bytes[pos].is_ascii_uppercase() {
        return None;
    }
    let end = pos + 1;
    is_word_boundary_after(bytes, end).then_some(Match { end, kind: "esDni" })
}

/// esNie: \b[XYZ]\d{7}[A-Z]\b
pub fn try_es_nie(bytes: &[u8], start: usize) -> Option<Match> {
    if !matches!(bytes[start], b'X' | b'Y' | b'Z') {
        return None;
    }
    let pos = take_digits(bytes, start + 1, 7)?;
    if pos >= bytes.len() || !bytes[pos].is_ascii_uppercase() {
        return None;
    }
    let end = pos + 1;
    is_word_boundary_after(bytes, end).then_some(Match { end, kind: "esNie" })
}
