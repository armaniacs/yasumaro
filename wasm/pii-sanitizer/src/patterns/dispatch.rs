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

pub fn scan(bytes: &[u8]) -> Vec<(usize, usize, &'static str)> {
    let len = bytes.len();
    let mut items = Vec::new();
    let mut i = 0;

    macro_rules! try_match {
        ($m:expr) => {
            if let Some(m) = $m {
                items.push((i, m.end, m.kind));
                i = m.end;
                continue;
            }
        };
    }

    while i < len && items.len() <= MAX_MATCH_COUNT {
        try_match!(core5::try_email(bytes, i));

        let boundary_before = is_word_boundary_before(bytes, i);
        let is_digit = bytes[i].is_ascii_digit();

        if is_digit && boundary_before {
            match core5::try_credit_card(bytes, i) {
                CreditCardOutcome::Masked(m) => {
                    items.push((i, m.end, m.kind));
                    i = m.end;
                    continue;
                }
                CreditCardOutcome::RejectedNoFallthrough { end } => {
                    i = end;
                    continue;
                }
                CreditCardOutcome::NoMatch => {}
            }

            try_match!(core5::try_my_number(bytes, i));

            if bytes[i] == b'0' {
                try_match!(core5::try_phone_jp(bytes, i));
            }

            try_match!(core5::try_bank_account(bytes, i));
            try_match!(extended::try_driver_license(bytes, i));
        }

        if boundary_before && bytes[i].is_ascii_uppercase() {
            try_match!(extended::try_jp_passport(bytes, i));
        }

        if is_digit && boundary_before {
            try_match!(extended::try_ipv4(bytes, i));
            try_match!(extended::try_ipv6(bytes, i));
            try_match!(extended::try_ssn(bytes, i));
        }

        // phoneUs: no leading \b — try regardless of boundary_before, but
        // only at positions that could plausibly start it (digit, '(', or
        // '+') to avoid wasted work on every byte.
        if is_digit || bytes[i] == b'(' || bytes[i] == b'+' {
            try_match!(extended::try_phone_us(bytes, i));
        }

        // phoneCn: no leading \b.
        if is_digit || bytes[i] == b'+' {
            try_match!(extended::try_phone_cn(bytes, i));
        }

        if is_digit && boundary_before {
            try_match!(extended::try_id_cn(bytes, i));
            try_match!(extended::try_rrn_kr(bytes, i));
        }

        // phoneKr: no leading \b.
        if is_digit || bytes[i] == b'+' {
            try_match!(extended::try_phone_kr(bytes, i));
        }

        if boundary_before && bytes[i].is_ascii_uppercase() {
            try_match!(extended::try_iban(bytes, i));
        }

        if is_digit && boundary_before {
            try_match!(extended::try_de_tax_id(bytes, i));
            try_match!(extended::try_fr_insee(bytes, i));
        }

        if boundary_before && bytes[i].is_ascii_uppercase() {
            try_match!(extended::try_it_codice_fiscale(bytes, i));
        }

        if is_digit && boundary_before {
            try_match!(extended::try_es_dni(bytes, i));
        }

        if boundary_before && matches!(bytes[i], b'X' | b'Y' | b'Z') {
            try_match!(extended::try_es_nie(bytes, i));
        }

        i += 1;
    }

    items
}
