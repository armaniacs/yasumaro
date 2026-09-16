/**
 * base64Codec.test.ts
 *
 * The base64 seam in primitives.ts (PBI 2026-09-15-16). These tests pin the
 * two properties that let the direct `atob` / `btoa` calls scattered across
 * src/ be replaced by it:
 *
 *   - byte fidelity, including the chunk boundary the encoder now works in
 *   - a separate text codec, because `btoa` rejects code points above U+00FF
 *     and callers were open-coding `btoa(unescape(encodeURIComponent(s)))`
 */
import { describe, it, expect } from 'vitest';
import {
  bytesToBase64,
  base64ToBytes,
  textToBase64,
  base64ToText,
  bytesToBase64Url,
  textToBase64Url,
  base64UrlToBytes,
  base64UrlToText,
} from '../primitives.js';

/** Encoder chunk size; boundary behaviour is the interesting case. */
const CHUNK = 0x8000;

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

describe('base64 byte codec', () => {
  it('round-trips an empty array', () => {
    expect(bytesToBase64(bytes())).toBe('');
    expect(base64ToBytes('')).toEqual(bytes());
  });

  it('round-trips every byte value', () => {
    const all = new Uint8Array(256);
    for (let i = 0; i < 256; i++) all[i] = i;

    expect(base64ToBytes(bytesToBase64(all))).toEqual(all);
  });

  it('matches the reference encoding for a known input', () => {
    // "Hi" — guards against an encoder that round-trips with itself but
    // produces something other than standard base64.
    expect(bytesToBase64(bytes(72, 105))).toBe('SGk=');
    expect(base64ToBytes('SGk=')).toEqual(bytes(72, 105));
  });

  it.each([
    ['one byte below a chunk', CHUNK - 1],
    ['exactly one chunk', CHUNK],
    ['one byte above a chunk', CHUNK + 1],
    ['several chunks plus a remainder', CHUNK * 3 + 17],
  ])('round-trips %s', (_label, size) => {
    const input = new Uint8Array(size);
    for (let i = 0; i < size; i++) input[i] = i % 256;

    const decoded = base64ToBytes(bytesToBase64(input));

    expect(decoded.length).toBe(size);
    expect(decoded).toEqual(input);
  });

  it('encodes a multi-megabyte array without overflowing the argument stack', () => {
    // The chunking exists for this case: passing every byte to
    // String.fromCharCode.apply in one call throws RangeError.
    const big = new Uint8Array(2 * 1024 * 1024);
    for (let i = 0; i < big.length; i++) big[i] = i % 256;

    expect(() => bytesToBase64(big)).not.toThrow();
    expect(base64ToBytes(bytesToBase64(big)).length).toBe(big.length);
  });
});

describe('base64 text codec', () => {
  it('round-trips ASCII', () => {
    expect(base64ToText(textToBase64('hello'))).toBe('hello');
  });

  it('round-trips text btoa alone cannot encode', () => {
    // Every one of these is above U+00FF, so btoa(text) throws InvalidCharacterError.
    for (const text of ['日本語のテキスト', 'emoji 🎌 mixed', 'Ünïcödé']) {
      expect(base64ToText(textToBase64(text))).toBe(text);
    }
  });

  it('agrees with the legacy unescape/encodeURIComponent spelling', () => {
    // The call sites being replaced used this form; the new seam must produce
    // byte-identical output so existing encoded data stays readable.
    const text = 'Markdown — 日本語 🎌';
    const legacy = btoa(unescape(encodeURIComponent(text)));

    expect(textToBase64(text)).toBe(legacy);
  });

  it('round-trips an empty string', () => {
    expect(base64ToText(textToBase64(''))).toBe('');
  });
});

describe('base64url codec', () => {
  /** The three substitutions the call sites used to repeat inline. */
  function legacyUrlEncode(bytes: Uint8Array): string {
    const chars = Array.from(bytes, (b) => String.fromCharCode(b)).join('');
    return btoa(chars).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  it('produces no characters that need escaping in a URL', () => {
    // 0xFB 0xFF encodes to "+/8=" in standard base64 — all three offenders.
    const encoded = bytesToBase64Url(bytes(0xfb, 0xff, 0xbf));

    expect(encoded).not.toMatch(/[+/=]/);
  });

  it('matches the inline spelling it replaced', () => {
    // Existing notification URLs were signed with the old code; a different
    // encoding here would silently invalidate every one of them.
    for (let len = 0; len < 40; len++) {
      const input = new Uint8Array(len);
      for (let i = 0; i < len; i++) input[i] = (i * 37 + len) % 256;

      expect(bytesToBase64Url(input)).toBe(legacyUrlEncode(input));
    }
  });

  it.each([0, 1, 2, 3, 4, 5, 31, 32, 33])(
    'round-trips %i bytes across every padding case',
    (len) => {
      const input = new Uint8Array(len);
      for (let i = 0; i < len; i++) input[i] = (i * 53) % 256;

      expect(base64UrlToBytes(bytesToBase64Url(input))).toEqual(input);
    },
  );

  it('round-trips text, including code points btoa alone rejects', () => {
    for (const text of ['https://example.com/a?b=c&d=e', '日本語 🎌', '']) {
      expect(base64UrlToText(textToBase64Url(text))).toBe(text);
    }
  });

  it('also decodes standard base64, since only two characters differ', () => {
    const input = bytes(0xfb, 0xff, 0xbf);

    expect(base64UrlToBytes(bytesToBase64(input))).toEqual(input);
  });
});
