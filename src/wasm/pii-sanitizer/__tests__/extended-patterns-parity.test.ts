/**
 * Parity check specifically for the 16 extended (locale-specific) patterns
 * — driverLicense, jpPassport, ipv4, ipv6, ssn, phoneUs, phoneCn, idCn,
 * rrnKr, phoneKr, iban, deTaxId, frInsee, itCodiceFiscale, esDni, esNie.
 *
 * captured-inputs.ndjson (from the original 5-pattern WASM development)
 * contains zero inputs exercising these 16 patterns — the existing PII test
 * suites' capture happened before this extension existed. This file is a
 * hand-written corpus targeting each extended pattern individually, plus a
 * handful of adversarial/overlap cases between extended and core5 patterns
 * (the kind of interaction that caused the bankAccount/myNumber
 * boundary-check bugs found during this port — see wasm/pii-sanitizer/src/
 * patterns/core5.rs's `\b` fixes).
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, test, expect, beforeAll } from 'vitest';
import { sanitizeRegex } from '../../../utils/piiSanitizer.js';
import initWasmModule, { sanitizePii as sanitizePiiWasmRaw } from '../piiSanitizerWasm.js';

interface MaskedItem {
    type: string;
    original: string;
}

async function initForNode(): Promise<void> {
    const wasmPath = fileURLToPath(new URL('../pii_sanitizer_bg.wasm', import.meta.url));
    const bytes = await readFile(wasmPath);
    await initWasmModule({ module_or_path: bytes });
}

function sanitizePiiWasm(text: string): { text: string; maskedItems: MaskedItem[] } {
    return sanitizePiiWasmRaw(text) as { text: string; maskedItems: MaskedItem[] };
}

async function expectParity(text: string): Promise<void> {
    const tsResult = await sanitizeRegex(text);
    const wasmResult = sanitizePiiWasm(text);
    expect(wasmResult.text).toBe(tsResult.text);
    expect(wasmResult.maskedItems.map((m) => ({ type: m.type, original: m.original }))).toEqual(
        tsResult.maskedItems.map((m) => ({ type: m.type, original: m.original }))
    );
}

describe('extended pattern parity (16 locale-specific types)', () => {
    beforeAll(async () => {
        await initForNode();
    });

    const perPatternInputs: Record<string, string[]> = {
        driverLicense: [
            'license number 123456789012 on file',
            'no license 12345678901 here (11 digits, too short)',
        ],
        jpPassport: ['passport AB1234567 valid', 'passport ab1234567 invalid (lowercase)'],
        ipv4: [
            'server 192.168.1.1 up',
            'internal 10.20.30.40 host',
            'gateway 172.16.0.1 active',
            'public dns 8.8.8.8 unaffected',
            'edge case 172.32.0.1 not private',
        ],
        ipv6: ['address 2001:0db8:0000:0000:0000:ff00:0042:8329 recorded', '::1 loopback (too short, no match)'],
        ssn: ['ssn 123-45-6789 confidential', 'not an ssn 123456789 plain digits'],
        phoneUs: [
            'call (555) 123-4567 today',
            'call +1-555-123-4567 today',
            'call 555.123.4567 today',
            'call 555-123-4567 today',
        ],
        phoneCn: ['phone 13812345678 mobile', 'phone +86-13812345678 mobile', 'phone +86 138 1234 5678 mobile'],
        idCn: ['id 110101199003076789 valid', 'id 11010119900307678X with letter'],
        rrnKr: ['rrn 901231-1234567 confidential', 'rrn 9012311234567 no separator'],
        phoneKr: ['call +82-10-1234-5678 today', 'call 82-10-1234-5678 today'],
        iban: [
            'iban DE89370400440532013000 payment',
            'iban FR1420041010050500013M02606 payment',
            'iban IT60X0542811101000000123456 payment',
            'iban ES9121000418450200051332 payment',
            'iban NL91ABNA0417164300 payment',
        ],
        deTaxId: ['tax id 12345678901 filed', 'invalid tax id 02345678901 (leading zero)'],
        frInsee: ['insee 123456789012345 registered'],
        itCodiceFiscale: ['codice fiscale RSSMRA85M01H501Z issued', 'invalid rssmra85m01h501z lowercase'],
        esDni: ['dni 12345678Z valid', 'dni 12345678z lowercase invalid'],
        esNie: ['nie X1234567L valid', 'nie Y7654321B valid', 'nie A1234567L invalid prefix'],
    };

    for (const [patternName, inputs] of Object.entries(perPatternInputs)) {
        for (const input of inputs) {
            test(`${patternName}: "${input}"`, async () => {
                await expectParity(input);
            });
        }
    }

    describe('cross-pattern overlap / priority-order regressions', () => {
        test('bankAccount does not preempt driverLicense at a 12-digit run (regression: missing \\b check)', async () => {
            await expectParity('license 123456789012 ok');
        });

        test('myNumber does not falsely match when trailing text breaks the closing \\b (regression: missing \\b check)', async () => {
            await expectParity('MyNumber: 1234-5678-9012Card: more text');
        });

        test('multiple extended patterns in one input, in priority order', async () => {
            await expectParity(
                'ssn 123-45-6789 and iban DE89370400440532013000 and dni 12345678Z together'
            );
        });

        test('core5 and extended patterns mixed', async () => {
            await expectParity(
                'email a@b.co card 4111-1111-1111-1111 ssn 123-45-6789 ipv4 192.168.1.1 done'
            );
        });
    });

    describe('separator-class and ipv6-start parity (regression: is_sep/ipv6 gate)', () => {
        // JS `\s` covers the full ASCII whitespace set. The WASM scanner's
        // is_sep must too — PII formatted across line breaks is common in
        // extracted page text and is masked by the TS reference.
        test('phoneJp split across newlines', async () => {
            await expectParity('call 03\n1234\n5678 now');
        });

        test('myNumber split across newlines', async () => {
            await expectParity('my number is 1234\n5678\n9012 ok');
        });

        test('creditCard split across newlines', async () => {
            await expectParity('card 4111\n1111\n1111\n1111 done');
        });

        test('phoneCn split across newlines', async () => {
            await expectParity('phone 138\n1234\n5678 mobile');
        });

        test('phoneKr split across newlines', async () => {
            await expectParity('call +82-10\n1234\n5678 today');
        });

        // Parity pin, not a gap: the TS ssn pattern uses literal hyphens
        // (/\b\d{3}-\d{2}-\d{4}\b/), so newline-separated input is unmasked
        // on both sides.
        test('ssn with newline separators is unmasked on both sides', async () => {
            await expectParity('ssn 123\n45\n6789 on file');
        });

        // The ipv6 char class is [0-9a-fA-F]: full-form addresses starting
        // with a hex letter must dispatch the same way digit-leading ones do.
        test('ipv6 starting with a hex letter (fe80: full form)', async () => {
            await expectParity('addr fe80:0000:0000:0000:0000:0000:0000:0001 end');
        });
    });
});
