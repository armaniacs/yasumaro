//! PII (personally identifiable information) detection and masking core.
//!
//! Ports all 21 pattern types from `PII_PATTERNS` in `src/utils/piiSanitizer.ts`
//! (TS/regex) to a single-pass byte scanner: the 5 highest-volume ones
//! (email, creditCard, myNumber, phoneJp, bankAccount — see `patterns/core5.rs`)
//! plus the 16 locale-specific ones (driverLicense, jpPassport, ipv4, ipv6,
//! ssn, phoneUs, phoneCn, idCn, rrnKr, phoneKr, iban, deTaxId, frInsee,
//! itCodiceFiscale, esDni, esNie — see `patterns/extended.rs`).
//!
//! Matching semantics mirror the TS original's single combined regex
//! (`new RegExp(typeGroups.join('|'), 'g')`) exactly, not just "each pattern
//! type independently, then resolve overlaps by longest span": at every
//! position, JS's regex engine tries alternatives in *source order* and
//! commits to the first one that matches at that position — it does not try
//! a lower-priority alternative just because a higher-priority one turned
//! out to be Luhn-invalid (Luhn rejection happens after the regex already
//! committed to a creditCard match). Getting this dispatch order and
//! single-attempt-per-position behavior right (see `patterns/dispatch.rs`)
//! is what makes this scanner produce byte-identical output to the TS
//! regex, verified against 218 real inputs captured from piiSanitizer.ts's
//! own test suites (see src/wasm/pii-sanitizer/__tests__/parity.test.ts in
//! the main tree).
//!
//! Design mirrors the TS implementation's ReDoS mitigation: the original
//! bytes are scanned in overlapping chunks (`SCAN_CHUNK_SIZE = 400`,
//! `SCAN_CHUNK_OVERLAP = 200`, step 200 — the same constants as
//! `piiSanitizer.ts`), so scan cost stays linear in input length regardless
//! of adversarial input, while any PII shorter than the overlap is
//! guaranteed to be fully contained in at least one chunk. Cross-chunk
//! duplicates are absorbed before the match-count cap by the same pre-count
//! guards as the TS reference (overlap-containment skip, chunk-edge
//! fragment skip, sticky-probe truncated-prefix skip, and sticky-probe
//! null skip); see `sanitize_core` for the guard-by-guard mapping.

mod patterns;

use serde::Serialize;
use wasm_bindgen::prelude::*;

/// Overlapping-chunk scan constants, mirroring `SCAN_CHUNK_SIZE` /
/// `SCAN_CHUNK_OVERLAP` in `src/utils/piiSanitizer.ts` exactly.
/// OVERLAP = 200 rationale (same as TS): every PII form under 200 bytes is
/// fully contained in some chunk (the longest bounded pattern is ~23 bytes;
/// email is covered up to 200; theoretical email maxima above 200 are an
/// accepted residual risk on both sides). Revisit OVERLAP together with the
/// TS side if a bounded pattern longer than 200 is ever added.
const SCAN_CHUNK_SIZE: usize = 400;
const SCAN_CHUNK_OVERLAP: usize = 200;
/// Match-count cap, mirroring `MAX_MATCH_COUNT = 1000` in `piiSanitizer.ts`.
/// The count is global across chunks (like the TS `matchCount`) and throws
/// past the cap so the hybrid fails closed exactly like the TS pipeline.
const MAX_MATCH_COUNT: usize = 1000;

#[derive(Serialize, Clone)]
pub struct MaskedItem {
    #[serde(rename = "type")]
    pub kind: &'static str,
    pub original: String,
    pub index: usize,
}

#[derive(Serialize)]
pub struct SanitizeResult {
    pub text: String,
    #[serde(rename = "maskedItems")]
    pub masked_items: Vec<MaskedItem>,
}

/// Rounds `idx` down to the nearest `str` char boundary at or below it
/// (clamped to `text.len()`), so chunk slicing never panics on multibyte
/// input. All PII patterns are ASCII, so boundaries only ever shift the
/// chunk grid on non-ASCII text, where no match can start or end anyway.
fn floor_char_boundary(text: &str, idx: usize) -> usize {
    let mut i = idx.min(text.len());
    while !text.is_char_boundary(i) {
        i -= 1;
    }
    i
}

/// Rounds `idx` up to the nearest `str` char boundary at or above it, so a
/// chunk never starts mid-character.
fn ceil_char_boundary(text: &str, idx: usize) -> usize {
    let mut i = idx.min(text.len());
    while !text.is_char_boundary(i) {
        i += 1;
    }
    i
}

/// Runs the full scan/mask pipeline. `text` must be valid UTF-8; all patterns
/// covered here are ASCII, so byte offsets equal char offsets for matched
/// spans, and non-ASCII runs are simply never matched (safe to skip).
///
/// The scan mirrors `sanitizeRegex`'s overlapping-chunk loop in
/// `src/utils/piiSanitizer.ts` exactly: each chunk is a slice of the
/// ORIGINAL bytes (no sampling/masking characters inserted), so chunk-local
/// match positions rebase to absolute positions by adding the chunk offset.
/// Before the global match count is incremented, each chunk-local span
/// passes the same four pre-count guards as the TS reference:
///  1. containment skip — for `offset > 0`, a span fully inside the
///     previous chunk's overlap (`rel_start + len <= OVERLAP`) was already
///     scanned in full by the previous chunk;
///  2. chunk-start fragment skip — for `offset > 0`, a span starting at
///     relative index 0 with length <= OVERLAP is fully contained in the
///     previous chunk (with identical context) and was counted there;
///  3. truncated-prefix skip — the sticky probe
///     (`dispatch::probe_match_len` on the FULL bytes at the absolute
///     start) finds a strictly longer true span within OVERLAP, so the
///     current span is a severed prefix whose complete form is counted in
///     its fully-containing chunk (true spans longer than OVERLAP are
///     counted in truncated form — the accepted residual, same as TS);
///  4. edge-artifact skip — the sticky probe finds nothing at the absolute
///     start, so the span is a pure chunk-edge artifact (e.g. a `\b` that
///     only holds because the chunk was severed) with no text-level
///     counterpart.
///
/// Post-scan, overlapping survivors are resolved longest-first (mirroring
/// the TS `usedRanges` dedupe) and applied back-to-front.
///
/// Note for JS consumers of `maskedItems[].index`: it is a byte offset into
/// the UTF-8 input, while `sanitizeRegex`'s `match.index` is a UTF-16 code
/// unit offset — the two agree only when all preceding text is ASCII.
///
/// Timeout: the TS reference also checks a wall-clock timeout every 5
/// matches; the WASM core has no timeout concept (same as before this
/// port) — the TS wrapper owns time-bounding.
fn sanitize_core(text: &str) -> Result<SanitizeResult, patterns::dispatch::MatchLimitExceeded> {
    let bytes = text.as_bytes();
    let step = SCAN_CHUNK_SIZE - SCAN_CHUNK_OVERLAP;

    // Absolute (start, end, kind) spans that passed the pre-count guards.
    let mut counted: Vec<(usize, usize, &'static str)> = Vec::new();
    let mut match_count = 0usize;

    let mut offset = 0usize;
    while offset < bytes.len() {
        // Char-boundary clamping: the TS `text.slice` operates on UTF-16
        // code units and never panics; byte slicing must not split a
        // multibyte sequence. For ASCII input (the only kind that can
        // match) the grid is identical to the TS one.
        let chunk_start = ceil_char_boundary(text, offset);
        if chunk_start >= bytes.len() {
            break;
        }
        let chunk_end = floor_char_boundary(text, (offset + SCAN_CHUNK_SIZE).min(bytes.len()));
        if chunk_end <= chunk_start {
            break;
        }
        let chunk = &bytes[chunk_start..chunk_end];

        // Fail-closed like the TS throw: a per-chunk cap breach rejects the
        // whole input (in practice unreachable — a 400-byte chunk holds at
        // most a few dozen matches — the global `match_count` below is the
        // operative guard, mirroring the TS `matchCount`).
        let spans = patterns::dispatch::scan(chunk)?;

        for (rel_start, rel_end, kind) in spans {
            let span_len = rel_end - rel_start;
            // Guard 1 (TS: `match.index + match[0].length <= SCAN_CHUNK_OVERLAP`).
            if offset > 0 && rel_start + span_len <= SCAN_CHUNK_OVERLAP {
                continue;
            }
            // Guard 2 (TS: `match.index === 0 && match[0].length <= OVERLAP`).
            if offset > 0 && rel_start == 0 && span_len <= SCAN_CHUNK_OVERLAP {
                continue;
            }
            let abs_start = chunk_start + rel_start;
            // Guards 3-4 via the sticky probe on the full bytes (TS:
            // `probeRegex.exec(text)` at `offset + match.index`).
            match patterns::dispatch::probe_match_len(bytes, abs_start) {
                Some(full_len)
                    if full_len > span_len && full_len <= SCAN_CHUNK_OVERLAP =>
                {
                    continue;
                }
                None => {
                    continue;
                }
                _ => {}
            }
            match_count += 1;
            if match_count > MAX_MATCH_COUNT {
                return Err(patterns::dispatch::MatchLimitExceeded);
            }
            counted.push((abs_start, chunk_start + rel_end, kind));
        }

        if chunk_end == bytes.len() {
            break;
        }
        offset += step;
    }

    // Longest-first overlap resolution (TS `usedRanges`): the guards above
    // already deduplicate every known duplicate class, but a severed-prefix
    // survivor can still overlap the true span recorded from another chunk,
    // so the surviving set is resolved exactly like the TS reference.
    let mut by_len = counted;
    by_len.sort_by(|a, b| (b.1 - b.0).cmp(&(a.1 - a.0)));
    let mut used: Vec<(usize, usize)> = Vec::new();
    let mut resolved: Vec<(usize, usize, &'static str)> = Vec::new();
    for (start, end, kind) in by_len {
        if used.iter().any(|&(s, e)| !(end <= s || start >= e)) {
            continue;
        }
        used.push((start, end));
        resolved.push((start, end, kind));
    }
    resolved.sort_by_key(|&(start, _, _)| start);

    let mut result_text = String::with_capacity(text.len());
    let mut masked_items = Vec::with_capacity(resolved.len());
    let mut cursor = 0usize;
    for (start, end, kind) in resolved {
        result_text.push_str(&text[cursor..start]);
        let original = text[start..end].to_string();
        result_text.push_str("[MASKED:");
        result_text.push_str(kind);
        result_text.push(']');
        masked_items.push(MaskedItem {
            kind,
            original,
            index: start,
        });
        cursor = end;
    }
    result_text.push_str(&text[cursor..]);

    Ok(SanitizeResult {
        text: result_text,
        masked_items,
    })
}

/// Sanitizes `text`, returning a JS object `{ text, maskedItems }` matching
/// the shape of `SanitizeResult` in piiSanitizer.ts (minus `error`, which the
/// TS wrapper layers on for size/timeout handling before calling this).
///
/// Exceeding the match-count cap rejects with the same message the TS scan
/// throws, so the hybrid's fallback lands in `sanitizeRegex` and fails closed
/// exactly like the pre-WASM pipeline did.
#[wasm_bindgen(js_name = sanitizePii)]
pub fn sanitize_pii(text: &str) -> Result<JsValue, JsValue> {
    let result = sanitize_core(text).map_err(|_| {
        JsValue::from_str("Operation exceeded maximum match count of 1000")
    })?;
    serde_wasm_bindgen::to_value(&result).map_err(|e| JsValue::from_str(&e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Test helper: unwraps the match-limit Result so existing assertions
    /// stay one-liners. Tests that exercise the limit call sanitize_core
    /// directly.
    fn core(text: &str) -> SanitizeResult {
        sanitize_core(text).expect("match limit should not be hit")
    }

    #[test]
    fn masks_email() {
        let r = core("contact me at user@example.com please");
        assert_eq!(r.text, "contact me at [MASKED:email] please");
        assert_eq!(r.masked_items.len(), 1);
        assert_eq!(r.masked_items[0].kind, "email");
        assert_eq!(r.masked_items[0].original, "user@example.com");
    }

    #[test]
    fn masks_adjacent_emails_without_local_part_bleed() {
        let r = core("a@example.comb@example.comc@example.com");
        assert!(r.masked_items[0].original.starts_with("a@example.com"));
    }

    #[test]
    fn masks_valid_credit_card_only() {
        let r = core("card 4111-1111-1111-1111 done");
        assert_eq!(r.masked_items.len(), 1);
        assert_eq!(r.masked_items[0].kind, "creditCard");
    }

    #[test]
    fn luhn_invalid_credit_card_consumes_position_without_fallthrough() {
        let r = core("card 1234-5678-9012-3456 done");
        assert!(r.masked_items.is_empty());
    }

    #[test]
    fn masks_my_number() {
        let r = core("my number is 1234-5678-9012 ok");
        assert_eq!(r.masked_items[0].kind, "myNumber");
    }

    #[test]
    fn masks_phone_jp() {
        let r = core("call 03-1234-5678 now");
        assert_eq!(r.masked_items[0].kind, "phoneJp");
    }

    #[test]
    fn phone_jp_backtracks_past_a_trailing_run_of_extra_digits() {
        let r = core("x/090-1234-5678y");
        assert_eq!(r.masked_items.len(), 1);
        assert_eq!(r.masked_items[0].kind, "phoneJp");
        assert_eq!(r.masked_items[0].original, "090-1234");
    }

    #[test]
    fn masks_bank_account() {
        let r = core("account 1234567 ok");
        assert_eq!(r.masked_items[0].kind, "bankAccount");
    }

    #[test]
    fn handles_no_pii() {
        let r = core("nothing sensitive here");
        assert_eq!(r.text, "nothing sensitive here");
        assert!(r.masked_items.is_empty());
    }

    #[test]
    fn long_adversarial_run_completes_without_hanging() {
        // Previously pinned the sampling mitigation; now pins the
        // overlapping-chunk scan's linear cost on the same input shape.
        let long_run = "a".repeat(200_000);
        let r = core(&long_run);
        assert_eq!(r.text.len(), long_run.len());
    }

    // --- Overlapping-chunk scan (PBI-16): long-token середины PII must not
    // be lost at chunk seams. Mirrors the TS straddling repro. ---

    #[test]
    fn masks_email_mid_long_token() {
        // TS repro verbatim: `"a".repeat(190) + "user@example.com" +
        // "b".repeat(200)` — the old sampling core destroyed the address
        // with `#` replacement; the chunk scan must mask it.
        let input = format!("{}user@example.com{}", "a".repeat(190), "b".repeat(200));
        let r = core(&input);
        assert!(!r.text.contains("user@example.com"));
        assert!(r.masked_items.iter().any(|m| m.kind == "email"));
    }

    #[test]
    fn masks_email_straddling_a_chunk_boundary() {
        // The address crosses the end of chunk 0 ([0,400)): its truncated
        // prefix must not double-count, and the full form in chunk 1 must
        // be the one recorded exactly once.
        let input = format!("{}user@example.com", "x".repeat(390));
        let r = core(&input);
        assert!(!r.text.contains("user@example.com"));
        assert_eq!(
            r.masked_items.iter().filter(|m| m.kind == "email").count(),
            1
        );
    }

    #[test]
    fn preserves_indices_across_multiple_matches() {
        let r = core("email a@b.co then account 1234567 end");
        assert_eq!(r.masked_items.len(), 2);
        assert!(r.masked_items[0].index < r.masked_items[1].index);
    }

    // --- Extended (16 locale-specific) pattern tests ---

    #[test]
    fn masks_driver_license() {
        let r = core("license 123456789012 ok");
        assert_eq!(r.masked_items[0].kind, "driverLicense");
    }

    #[test]
    fn masks_jp_passport() {
        let r = core("passport AB1234567 ok");
        assert_eq!(r.masked_items[0].kind, "jpPassport");
    }

    #[test]
    fn masks_ipv4_private_range() {
        let r = core("server at 192.168.1.1 today");
        assert_eq!(r.masked_items[0].kind, "ipv4");
        assert_eq!(r.masked_items[0].original, "192.168.1.1");
    }

    #[test]
    fn masks_ipv4_10_range() {
        let r = core("internal 10.0.0.1 host");
        assert_eq!(r.masked_items[0].kind, "ipv4");
    }

    #[test]
    fn masks_ipv4_172_range() {
        let r = core("internal 172.16.0.1 host");
        assert_eq!(r.masked_items[0].kind, "ipv4");
    }

    #[test]
    fn does_not_mask_public_ipv4() {
        let r = core("public 8.8.8.8 dns");
        assert!(r.masked_items.iter().all(|m| m.kind != "ipv4"));
    }

    #[test]
    fn masks_ipv6() {
        let r = core("addr 2001:0db8:0000:0000:0000:ff00:0042:8329 end");
        assert_eq!(r.masked_items[0].kind, "ipv6");
    }

    #[test]
    fn masks_ssn() {
        let r = core("ssn 123-45-6789 on file");
        assert_eq!(r.masked_items[0].kind, "ssn");
    }

    #[test]
    fn masks_phone_us_with_parens() {
        let r = core("call (555) 123-4567 now");
        assert_eq!(r.masked_items[0].kind, "phoneUs");
    }

    #[test]
    fn masks_phone_us_with_country_code() {
        let r = core("call +1-555-123-4567 now");
        assert_eq!(r.masked_items[0].kind, "phoneUs");
    }

    #[test]
    fn masks_phone_cn() {
        let r = core("call 13812345678 now");
        assert_eq!(r.masked_items[0].kind, "phoneCn");
    }

    #[test]
    fn masks_phone_cn_with_country_code() {
        let r = core("call +86-13812345678 now");
        assert_eq!(r.masked_items[0].kind, "phoneCn");
    }

    #[test]
    fn masks_id_cn() {
        let r = core("id 110101199003076789 ok");
        assert_eq!(r.masked_items[0].kind, "idCn");
    }

    #[test]
    fn masks_id_cn_with_trailing_x() {
        let r = core("id 11010119900307678X ok");
        assert_eq!(r.masked_items[0].kind, "idCn");
    }

    #[test]
    fn masks_rrn_kr() {
        let r = core("rrn 901231-1234567 ok");
        assert_eq!(r.masked_items[0].kind, "rrnKr");
    }

    #[test]
    fn masks_phone_kr() {
        // "010-1234-5678" alone matches phoneJp first (0-prefixed patterns
        // are defined earlier in PII_PATTERNS and phoneJp's pattern matches
        // it too — verified against TS: sanitizeRegex('call 010-1234-5678')
        // returns type "phoneJp", not "phoneKr"). Use the +82 country-code
        // prefix to unambiguously exercise phoneKr's own pattern.
        let r = core("call +82-10-1234-5678 now");
        assert_eq!(r.masked_items[0].kind, "phoneKr");
    }

    #[test]
    fn masks_iban_de() {
        let r = core("iban DE89370400440532013000 ok");
        assert_eq!(r.masked_items[0].kind, "iban");
    }

    #[test]
    fn masks_iban_fr() {
        let r = core("iban FR1420041010050500013M02606 ok");
        assert_eq!(r.masked_items[0].kind, "iban");
    }

    #[test]
    fn masks_de_tax_id() {
        let r = core("tax id 12345678901 ok");
        assert_eq!(r.masked_items[0].kind, "deTaxId");
    }

    #[test]
    fn masks_fr_insee() {
        let r = core("insee 123456789012345 ok");
        assert_eq!(r.masked_items[0].kind, "frInsee");
    }

    #[test]
    fn masks_it_codice_fiscale() {
        let r = core("cf RSSMRA85M01H501Z ok");
        assert_eq!(r.masked_items[0].kind, "itCodiceFiscale");
    }

    #[test]
    fn masks_es_dni() {
        let r = core("dni 12345678Z ok");
        assert_eq!(r.masked_items[0].kind, "esDni");
    }

    #[test]
    fn masks_es_nie() {
        let r = core("nie X1234567L ok");
        assert_eq!(r.masked_items[0].kind, "esNie");
    }

    // --- Separator-class parity (`[-\s]` must accept the full ASCII
    // whitespace set, not just space/tab) and ipv6 hex-leading starts ---

    #[test]
    fn masks_phone_jp_split_across_newlines() {
        let r = core("call 03\n1234\n5678 now");
        assert_eq!(r.masked_items[0].kind, "phoneJp");
        assert_eq!(r.masked_items[0].original, "03\n1234\n5678");
    }

    #[test]
    fn masks_phone_jp_separated_by_ideographic_space() {
        // U+3000 (full-width space) is a JS \s member: the TS reference masks
        // full-width-formatted numbers, so the scanner must consume its 3
        // UTF-8 bytes as one separator.
        let r = core("TEL 03\u{3000}1234\u{3000}5678 です");
        assert_eq!(r.masked_items[0].kind, "phoneJp");
        assert_eq!(r.masked_items[0].original, "03\u{3000}1234\u{3000}5678");
    }

    #[test]
    fn masks_my_number_separated_by_ideographic_space() {
        let r = core("マイナンバー 1234\u{3000}5678\u{3000}9012 確認");
        assert_eq!(r.masked_items[0].kind, "myNumber");
    }

    #[test]
    fn masks_credit_card_separated_by_nbsp() {
        // U+00A0 (2-byte UTF-8) — a different width class than U+3000.
        let r = core("card 4111\u{00a0}1111\u{00a0}1111\u{00a0}1111 done");
        assert_eq!(r.masked_items[0].kind, "creditCard");
    }

    #[test]
    fn masks_phone_jp_separated_by_mixed_ws_widths() {
        // Mixed widths across the two separator slots: U+3000 then U+00A0.
        let r = core("03\u{3000}1234\u{00a0}5678");
        assert_eq!(r.masked_items[0].kind, "phoneJp");
    }

    #[test]
    fn trailing_multibyte_separator_does_not_match_or_panic() {
        // "03　1234　" ends with a complete U+3000: phoneJp needs a third
        // digit group after it, so there is no match — the width-aware
        // separator consumption must not over-read or panic at the end of
        // input.
        let r = core("03\u{3000}1234\u{3000}");
        assert!(r.masked_items.is_empty());
    }

    #[test]
    fn masks_my_number_split_across_newlines() {
        let r = core("my number is 1234\n5678\n9012 ok");
        assert_eq!(r.masked_items[0].kind, "myNumber");
    }

    #[test]
    fn masks_credit_card_split_across_newlines() {
        let r = core("card 4111\n1111\n1111\n1111 done");
        assert_eq!(r.masked_items[0].kind, "creditCard");
    }

    #[test]
    fn does_not_mask_ssn_split_across_newlines() {
        // Parity pin, not a gap: the TS ssn pattern uses literal hyphens
        // (/\b\d{3}-\d{2}-\d{4}\b/), not [-\s], so newline-separated input
        // is unmasked on BOTH sides.
        let r = core("ssn 123\n45\n6789 on file");
        assert!(r.masked_items.is_empty());
    }

    #[test]
    fn masks_ipv6_starting_with_hex_letter() {
        // The TS ipv6 char class is [0-9a-fA-F], so addresses starting with a
        // hex letter must dispatch the same way digit-leading ones do.
        let r = core("addr fe80:0000:0000:0000:0000:0000:0000:0001 end");
        assert_eq!(r.masked_items[0].kind, "ipv6");
        assert_eq!(r.masked_items[0].original, "fe80:0000:0000:0000:0000:0000:0000:0001");
    }

    // --- Match-count cap: must fail closed like the TS reference ---

    #[test]
    fn exactly_1000_matches_still_succeeds() {
        // 1000 bank-account matches (7 digits each) stay under the cap: the
        // TS scan throws only when matchCount exceeds 1000.
        let text = "account 1234567\n".repeat(1000);
        let r = sanitize_core(&text).expect("exactly 1000 matches must not exceed the cap");
        assert_eq!(r.masked_items.len(), 1000);
    }

    #[test]
    fn exceeding_1000_matches_reports_match_limit() {
        let text = "account 1234567\n".repeat(1001);
        assert!(sanitize_core(&text).is_err());
    }
}
