/**
 * Codec table test for the encrypted-export codec (PBI 2026-10-16-06).
 *
 * Chrome-free: no chrome.* APIs and no storage/logger mocks. The HMAC
 * verifier and the KDF decryptor are injected fakes, so v2 acceptance,
 * v3 forgery, and legacy rehash inputs get a true/false verdict from the
 * codec alone.
 */
import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import {
  ENCRYPTED_EXPORT_VERSION,
  LEGACY_ENCRYPTED_EXPORT_VERSION,
  buildEncryptedHmacPayload,
  classifyEncryptedExportVersion,
  hasCiphertextHmac,
  verifyEncryptedExportHmac,
  verifyLegacyPlaintextHmac,
  decryptExportCiphertext,
  currentExportIterations,
} from '../encryptedExportCodec.js';
import { CRYPTO_PARAMS } from '../cryptoParams.js';

/** Fake signer: `sign` mints `sig:<payload>`, `verify` checks it. */
function makeSigner() {
  return {
    sign: async (payload: string) => `sig:${payload}`,
    verify: async (payload: string, signature: string) => `sig:${payload}` === signature,
  };
}

describe('encryptedExportCodec', () => {
  it('keeps v3 and legacy versions distinct', () => {
    expect(ENCRYPTED_EXPORT_VERSION).not.toBe(LEGACY_ENCRYPTED_EXPORT_VERSION);
  });

  it('reads the current iteration count from the SSOT', () => {
    expect(currentExportIterations()).toBe(CRYPTO_PARAMS.PBKDF2_ITERATIONS);
  });

  describe('buildEncryptedHmacPayload', () => {
    it.each([
      {
        name: 'v3 signs iterations together with ciphertext:iv:salt',
        version: ENCRYPTED_EXPORT_VERSION,
        expected: 'c:i:s:600000',
      },
      {
        name: 'v2 omits iterations even when the field is present',
        version: LEGACY_ENCRYPTED_EXPORT_VERSION,
        expected: 'c:i:s',
      },
    ])('$name', ({ version, expected }) => {
      expect(
        buildEncryptedHmacPayload(
          { ciphertext: 'c', iv: 'i', salt: 's', iterations: 600000 },
          version as typeof ENCRYPTED_EXPORT_VERSION,
        ),
      ).toBe(expected);
    });
  });

  describe('classifyEncryptedExportVersion', () => {
    it.each([
      [ENCRYPTED_EXPORT_VERSION, 'v3'],
      [LEGACY_ENCRYPTED_EXPORT_VERSION, 'v2'],
      ['1', 'legacy'],
      ['9', 'legacy'],
      [undefined, 'legacy'],
      [3, 'v3'],
      ['', 'legacy'],
    ])('classifies %s as %s', (version, expected) => {
      expect(classifyEncryptedExportVersion(version)).toBe(expected);
    });
  });

  describe('hasCiphertextHmac', () => {
    it.each([
      [ENCRYPTED_EXPORT_VERSION, true],
      [LEGACY_ENCRYPTED_EXPORT_VERSION, true],
      ['1', false],
      [undefined, false],
    ])('version %s -> %s', (version, expected) => {
      expect(hasCiphertextHmac(version)).toBe(expected);
    });
  });

  describe('verifyEncryptedExportHmac', () => {
    const base = { ciphertext: 'c', iv: 'i', salt: 's', iterations: 600000 };

    it('accepts an intact v3 file', async () => {
      const signer = makeSigner();
      const hmac = await signer.sign(`c:i:s:600000`);

      await expect(
        verifyEncryptedExportHmac({ ...base, hmac, version: ENCRYPTED_EXPORT_VERSION }, signer),
      ).resolves.toBe('verified');
    });

    it('rejects a v3 file whose iterations were forged', async () => {
      const signer = makeSigner();
      const hmac = await signer.sign(`c:i:s:600000`);

      await expect(
        verifyEncryptedExportHmac(
          { ...base, iterations: 2147483647, hmac, version: ENCRYPTED_EXPORT_VERSION },
          signer,
        ),
      ).resolves.toBe('mismatch');
    });

    it('rejects a v3 signature downgraded to v2', async () => {
      const signer = makeSigner();
      const hmac = await signer.sign(`c:i:s:600000`);

      await expect(
        verifyEncryptedExportHmac(
          { ...base, hmac, version: LEGACY_ENCRYPTED_EXPORT_VERSION },
          signer,
        ),
      ).resolves.toBe('mismatch');
    });

    it('accepts a v2 file signed over ciphertext:iv:salt', async () => {
      const signer = makeSigner();
      const hmac = await signer.sign(`c:i:s`);

      await expect(
        verifyEncryptedExportHmac(
          { ...base, hmac, version: LEGACY_ENCRYPTED_EXPORT_VERSION },
          signer,
        ),
      ).resolves.toBe('verified');
    });

    it('accepts a v2 file with hostile iterations by ignoring the field', async () => {
      const signer = makeSigner();
      const hmac = await signer.sign(`c:i:s`);

      await expect(
        verifyEncryptedExportHmac(
          { ...base, iterations: 2147483647, hmac, version: LEGACY_ENCRYPTED_EXPORT_VERSION },
          signer,
        ),
      ).resolves.toBe('verified');
    });

    it('rejects a v2 file with tampered ciphertext', async () => {
      const signer = makeSigner();
      const hmac = await signer.sign(`c:i:s`);

      await expect(
        verifyEncryptedExportHmac(
          { ...base, ciphertext: 'evil', hmac, version: LEGACY_ENCRYPTED_EXPORT_VERSION },
          signer,
        ),
      ).resolves.toBe('mismatch');
    });

    it('defers legacy versions to the plaintext check without calling the verifier', async () => {
      let calls = 0;
      const counting = {
        verify: async () => {
          calls += 1;
          return true;
        },
      };

      await expect(
        verifyEncryptedExportHmac({ ...base, hmac: 'whatever', version: '1' }, counting),
      ).resolves.toBe('legacy-deferred');
      expect(calls).toBe(0);
    });
  });

  describe('verifyLegacyPlaintextHmac', () => {
    it('accepts a matching plaintext hmac', async () => {
      const signer = makeSigner();
      const hmac = await signer.sign('plain-json');

      await expect(verifyLegacyPlaintextHmac('plain-json', hmac, signer)).resolves.toBe(
        'verified',
      );
    });

    it('rejects a wrong plaintext hmac', async () => {
      const signer = makeSigner();

      await expect(
        verifyLegacyPlaintextHmac('plain-json', 'sig:something-else', signer),
      ).resolves.toBe('mismatch');
    });

    it('reports a missing hmac as unsigned', async () => {
      const signer = makeSigner();

      await expect(verifyLegacyPlaintextHmac('plain-json', undefined, signer)).resolves.toBe(
        'unsigned',
      );
    });
  });

  describe('decryptExportCiphertext', () => {
    it('passes the stored iterations through and returns the plaintext', async () => {
      const seen: unknown[] = [];
      const fakeDecrypt = async (
        _password: string,
        _salt: string,
        _ciphertext: string,
        _iv: string,
        stored?: number,
      ) => {
        seen.push(stored);
        return { text: '{"ok":true}', usedIterations: 600000, needsRehash: false };
      };

      const result = await decryptExportCiphertext(
        'password',
        { salt: 's', ciphertext: 'c', iv: 'i', iterations: 600000 },
        fakeDecrypt,
      );

      expect(result).toEqual({ text: '{"ok":true}', usedIterations: 600000, needsRehash: false });
      expect(seen).toEqual([600000]);
    });

    it('normalizes a non-number iterations field to undefined', async () => {
      const seen: unknown[] = [];
      const fakeDecrypt = async (
        _password: string,
        _salt: string,
        _ciphertext: string,
        _iv: string,
        stored?: number,
      ) => {
        seen.push(stored);
        return { text: '{"ok":true}', usedIterations: 100000, needsRehash: true };
      };

      const result = await decryptExportCiphertext(
        'password',
        { salt: 's', ciphertext: 'c', iv: 'i', iterations: '600000' },
        fakeDecrypt,
      );

      expect(result.needsRehash).toBe(true);
      expect(seen).toEqual([undefined]);
    });

    it('propagates the legacy rehash signal', async () => {
      const fakeDecrypt = async () => ({
        text: '{"ok":true}',
        usedIterations: 100000,
        needsRehash: true,
      });

      const result = await decryptExportCiphertext(
        'password',
        { salt: 's', ciphertext: 'c', iv: 'i' },
        fakeDecrypt,
      );

      expect(result.needsRehash).toBe(true);
    });
  });

  describe('settings side stays a thin pass-through', () => {
    it('holds no version literals, payload builder, or iteration numbers', async () => {
      const settingsPath = new URL('../../settingsExportImport.ts', import.meta.url);
      const source = await readFile(settingsPath, 'utf8');

      expect(source).not.toContain('function buildEncryptedHmacPayload');
      expect(source).not.toContain('ENCRYPTED_EXPORT_VERSION =');
      expect(source).not.toContain('LEGACY_ENCRYPTED_EXPORT_VERSION =');
      expect(source).not.toContain('CRYPTO_PARAMS');
    });
  });
});
