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
//! Design mirrors the TS implementation's ReDoS mitigation: any run of
//! non-whitespace bytes longer than `TOKEN_EDGE_KEEP_LEN * 2` has its middle
//! section sampled (window boundaries replaced with `#`) before scanning, so
//! scan cost stays linear in input length regardless of adversarial input.

mod patterns;

use serde::Serialize;
use wasm_bindgen::prelude::*;

const TOKEN_EDGE_KEEP_LEN: usize = 100;

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

/// Replaces the middle of long non-whitespace runs with a byte class no
/// pattern below can match ('#'), keeping the transformed text the same
/// length as the input so indices from scanning line up 1:1 with `text`.
/// Matches `neutralizeLongNonWhitespaceRuns` / `sampleMiddleForScan` in the
/// TS original.
fn neutralize_long_runs(bytes: &[u8]) -> Vec<u8> {
    let mut out = bytes.to_vec();
    let mut i = 0;
    while i < out.len() {
        if out[i].is_ascii_whitespace() {
            i += 1;
            continue;
        }
        let run_start = i;
        while i < out.len() && !out[i].is_ascii_whitespace() {
            i += 1;
        }
        let run_end = i;
        let run_len = run_end - run_start;
        let threshold = TOKEN_EDGE_KEEP_LEN * 2;
        if run_len > threshold {
            let middle_start = run_start + TOKEN_EDGE_KEEP_LEN;
            let middle_end = run_end - TOKEN_EDGE_KEEP_LEN;
            let mut w = middle_start;
            while w < middle_end {
                let window_end = (w + TOKEN_EDGE_KEEP_LEN).min(middle_end);
                if window_end - w == TOKEN_EDGE_KEEP_LEN {
                    out[window_end - 1] = b'#';
                }
                w = window_end;
            }
        }
    }
    out
}

/// Runs the full scan/mask pipeline. `text` must be valid UTF-8; all patterns
/// covered here are ASCII, so byte offsets equal char offsets for matched
/// spans, and non-ASCII runs are simply never matched (safe to skip).
fn sanitize_core(text: &str) -> SanitizeResult {
    let bytes = text.as_bytes();
    let scan_bytes = neutralize_long_runs(bytes);

    let spans = patterns::dispatch::scan(&scan_bytes);

    let mut result_text = String::with_capacity(text.len());
    let mut masked_items = Vec::with_capacity(spans.len());
    let mut cursor = 0usize;
    for (start, end, kind) in spans {
        result_text.push_str(&text[cursor..start]);
        let original = text[start..end].to_string();
        result_text.push_str(&format!("[MASKED:{}]", kind));
        masked_items.push(MaskedItem {
            kind,
            original,
            index: start,
        });
        cursor = end;
    }
    result_text.push_str(&text[cursor..]);

    SanitizeResult {
        text: result_text,
        masked_items,
    }
}

/// Sanitizes `text`, returning a JS object `{ text, maskedItems }` matching
/// the shape of `SanitizeResult` in piiSanitizer.ts (minus `error`, which the
/// TS wrapper layers on for size/timeout handling before calling this).
#[wasm_bindgen(js_name = sanitizePii)]
pub fn sanitize_pii(text: &str) -> Result<JsValue, JsValue> {
    let result = sanitize_core(text);
    serde_wasm_bindgen::to_value(&result).map_err(|e| JsValue::from_str(&e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn masks_email() {
        let r = sanitize_core("contact me at user@example.com please");
        assert_eq!(r.text, "contact me at [MASKED:email] please");
        assert_eq!(r.masked_items.len(), 1);
        assert_eq!(r.masked_items[0].kind, "email");
        assert_eq!(r.masked_items[0].original, "user@example.com");
    }

    #[test]
    fn masks_adjacent_emails_without_local_part_bleed() {
        let r = sanitize_core("a@example.comb@example.comc@example.com");
        assert!(r.masked_items[0].original.starts_with("a@example.com"));
    }

    #[test]
    fn masks_valid_credit_card_only() {
        let r = sanitize_core("card 4111-1111-1111-1111 done");
        assert_eq!(r.masked_items.len(), 1);
        assert_eq!(r.masked_items[0].kind, "creditCard");
    }

    #[test]
    fn luhn_invalid_credit_card_consumes_position_without_fallthrough() {
        let r = sanitize_core("card 1234-5678-9012-3456 done");
        assert!(r.masked_items.is_empty());
    }

    #[test]
    fn masks_my_number() {
        let r = sanitize_core("my number is 1234-5678-9012 ok");
        assert_eq!(r.masked_items[0].kind, "myNumber");
    }

    #[test]
    fn masks_phone_jp() {
        let r = sanitize_core("call 03-1234-5678 now");
        assert_eq!(r.masked_items[0].kind, "phoneJp");
    }

    #[test]
    fn phone_jp_backtracks_past_a_trailing_run_of_extra_digits() {
        let r = sanitize_core("x/090-1234-5678y");
        assert_eq!(r.masked_items.len(), 1);
        assert_eq!(r.masked_items[0].kind, "phoneJp");
        assert_eq!(r.masked_items[0].original, "090-1234");
    }

    #[test]
    fn masks_bank_account() {
        let r = sanitize_core("account 1234567 ok");
        assert_eq!(r.masked_items[0].kind, "bankAccount");
    }

    #[test]
    fn handles_no_pii() {
        let r = sanitize_core("nothing sensitive here");
        assert_eq!(r.text, "nothing sensitive here");
        assert!(r.masked_items.is_empty());
    }

    #[test]
    fn neutralizes_long_adversarial_run_without_hanging() {
        let long_run = "a".repeat(200_000);
        let r = sanitize_core(&long_run);
        assert_eq!(r.text.len(), long_run.len());
    }

    #[test]
    fn preserves_indices_across_multiple_matches() {
        let r = sanitize_core("email a@b.co then account 1234567 end");
        assert_eq!(r.masked_items.len(), 2);
        assert!(r.masked_items[0].index < r.masked_items[1].index);
    }

    // --- Extended (16 locale-specific) pattern tests ---

    #[test]
    fn masks_driver_license() {
        let r = sanitize_core("license 123456789012 ok");
        assert_eq!(r.masked_items[0].kind, "driverLicense");
    }

    #[test]
    fn masks_jp_passport() {
        let r = sanitize_core("passport AB1234567 ok");
        assert_eq!(r.masked_items[0].kind, "jpPassport");
    }

    #[test]
    fn masks_ipv4_private_range() {
        let r = sanitize_core("server at 192.168.1.1 today");
        assert_eq!(r.masked_items[0].kind, "ipv4");
        assert_eq!(r.masked_items[0].original, "192.168.1.1");
    }

    #[test]
    fn masks_ipv4_10_range() {
        let r = sanitize_core("internal 10.0.0.1 host");
        assert_eq!(r.masked_items[0].kind, "ipv4");
    }

    #[test]
    fn masks_ipv4_172_range() {
        let r = sanitize_core("internal 172.16.0.1 host");
        assert_eq!(r.masked_items[0].kind, "ipv4");
    }

    #[test]
    fn does_not_mask_public_ipv4() {
        let r = sanitize_core("public 8.8.8.8 dns");
        assert!(r.masked_items.iter().all(|m| m.kind != "ipv4"));
    }

    #[test]
    fn masks_ipv6() {
        let r = sanitize_core("addr 2001:0db8:0000:0000:0000:ff00:0042:8329 end");
        assert_eq!(r.masked_items[0].kind, "ipv6");
    }

    #[test]
    fn masks_ssn() {
        let r = sanitize_core("ssn 123-45-6789 on file");
        assert_eq!(r.masked_items[0].kind, "ssn");
    }

    #[test]
    fn masks_phone_us_with_parens() {
        let r = sanitize_core("call (555) 123-4567 now");
        assert_eq!(r.masked_items[0].kind, "phoneUs");
    }

    #[test]
    fn masks_phone_us_with_country_code() {
        let r = sanitize_core("call +1-555-123-4567 now");
        assert_eq!(r.masked_items[0].kind, "phoneUs");
    }

    #[test]
    fn masks_phone_cn() {
        let r = sanitize_core("call 13812345678 now");
        assert_eq!(r.masked_items[0].kind, "phoneCn");
    }

    #[test]
    fn masks_phone_cn_with_country_code() {
        let r = sanitize_core("call +86-13812345678 now");
        assert_eq!(r.masked_items[0].kind, "phoneCn");
    }

    #[test]
    fn masks_id_cn() {
        let r = sanitize_core("id 110101199003076789 ok");
        assert_eq!(r.masked_items[0].kind, "idCn");
    }

    #[test]
    fn masks_id_cn_with_trailing_x() {
        let r = sanitize_core("id 11010119900307678X ok");
        assert_eq!(r.masked_items[0].kind, "idCn");
    }

    #[test]
    fn masks_rrn_kr() {
        let r = sanitize_core("rrn 901231-1234567 ok");
        assert_eq!(r.masked_items[0].kind, "rrnKr");
    }

    #[test]
    fn masks_phone_kr() {
        // "010-1234-5678" alone matches phoneJp first (0-prefixed patterns
        // are defined earlier in PII_PATTERNS and phoneJp's pattern matches
        // it too — verified against TS: sanitizeRegex('call 010-1234-5678')
        // returns type "phoneJp", not "phoneKr"). Use the +82 country-code
        // prefix to unambiguously exercise phoneKr's own pattern.
        let r = sanitize_core("call +82-10-1234-5678 now");
        assert_eq!(r.masked_items[0].kind, "phoneKr");
    }

    #[test]
    fn masks_iban_de() {
        let r = sanitize_core("iban DE89370400440532013000 ok");
        assert_eq!(r.masked_items[0].kind, "iban");
    }

    #[test]
    fn masks_iban_fr() {
        let r = sanitize_core("iban FR1420041010050500013M02606 ok");
        assert_eq!(r.masked_items[0].kind, "iban");
    }

    #[test]
    fn masks_de_tax_id() {
        let r = sanitize_core("tax id 12345678901 ok");
        assert_eq!(r.masked_items[0].kind, "deTaxId");
    }

    #[test]
    fn masks_fr_insee() {
        let r = sanitize_core("insee 123456789012345 ok");
        assert_eq!(r.masked_items[0].kind, "frInsee");
    }

    #[test]
    fn masks_it_codice_fiscale() {
        let r = sanitize_core("cf RSSMRA85M01H501Z ok");
        assert_eq!(r.masked_items[0].kind, "itCodiceFiscale");
    }

    #[test]
    fn masks_es_dni() {
        let r = sanitize_core("dni 12345678Z ok");
        assert_eq!(r.masked_items[0].kind, "esDni");
    }

    #[test]
    fn masks_es_nie() {
        let r = sanitize_core("nie X1234567L ok");
        assert_eq!(r.masked_items[0].kind, "esNie");
    }
}
