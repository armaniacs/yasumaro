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
import { Crypto } from '@peculiar/webcrypto';
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
  sealEncryptedExport,
  openEncryptedExport,
} from '../encryptedExportCodec.js';
import { CRYPTO_PARAMS } from '../cryptoParams.js';

Object.defineProperty(globalThis, 'crypto', { value: new Crypto(), configurable: true });

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

  describe('seal/open single-owner round trip', () => {
    const base = { ciphertext: 'c', iv: 'i', salt: 's', iterations: 600000 };

    function fakeDecrypt(seen: unknown[], text = '{"ok":true}') {
      return async (
        _password: string,
        _salt: string,
        _ciphertext: string,
        _iv: string,
        stored?: number,
      ) => {
        seen.push(stored);
        return { text, usedIterations: 600000, needsRehash: false };
      };
    }

    describe('openEncryptedExport dispatch table', () => {
      it.each([
        {
          name: 'v3 intact decrypts without rehash',
          version: ENCRYPTED_EXPORT_VERSION,
          iterations: 600000,
          signPayload: 'c:i:s:600000',
          expected: 'decrypted',
        },
        {
          name: 'v3 with forged iterations rejects before KDF',
          version: ENCRYPTED_EXPORT_VERSION,
          iterations: 2147483647,
          signPayload: 'c:i:s:600000',
          expected: 'hmac-mismatch',
        },
        {
          name: 'v3 signature downgraded to the v2 label rejects',
          version: LEGACY_ENCRYPTED_EXPORT_VERSION,
          iterations: 600000,
          signPayload: 'c:i:s:600000',
          expected: 'hmac-mismatch',
        },
        {
          name: 'v3 with the iterations field dropped rejects',
          version: ENCRYPTED_EXPORT_VERSION,
          iterations: undefined,
          signPayload: 'c:i:s:600000',
          expected: 'hmac-mismatch',
        },
        {
          name: 'v2 intact decrypts while ignoring a hostile field',
          version: LEGACY_ENCRYPTED_EXPORT_VERSION,
          iterations: 2147483647,
          signPayload: 'c:i:s',
          expected: 'decrypted',
        },
        {
          name: 'v2 intact decrypts at the legacy boundary',
          version: LEGACY_ENCRYPTED_EXPORT_VERSION,
          iterations: 100000,
          signPayload: 'c:i:s',
          expected: 'decrypted',
        },
      ])('$name', async ({ version, iterations, signPayload, expected }) => {
        const signer = makeSigner();
        const seen: unknown[] = [];
        const hmac = await signer.sign(signPayload);
        // A dropped field omits the key (exactOptionalPropertyTypes): the
        // forged envelope carries no iterations member at all.
        const input =
          iterations === undefined
            ? { ciphertext: 'c', iv: 'i', salt: 's', hmac, version }
            : { ...base, iterations, hmac, version };

        const result = await openEncryptedExport('password', input, signer, fakeDecrypt(seen));

        if (expected === 'decrypted') {
          expect(result).toEqual({
            status: 'decrypted',
            decryptedJson: '{"ok":true}',
            needsRehash: false,
            legacyUnsigned: false,
          });
        } else {
          expect(result).toEqual({ status: 'rejected', reason: expected });
          expect(seen).toEqual([]);
        }
      });

      it('forwards a stored v3 iteration count to the KDF dispatch', async () => {
        const signer = makeSigner();
        const seen: unknown[] = [];
        const hmac = await signer.sign('c:i:s:600000');

        const result = await openEncryptedExport(
          'password',
          { ...base, hmac, version: ENCRYPTED_EXPORT_VERSION },
          signer,
          fakeDecrypt(seen),
        );

        expect(result.status).toBe('decrypted');
        expect(seen).toEqual([600000]);
      });

      it('normalizes a non-number iterations field to absent before KDF', async () => {
        const signer = makeSigner();
        const seen: unknown[] = [];
        const hmac = await signer.sign('c:i:s:600000');

        const result = await openEncryptedExport(
          'password',
          {
            ...base,
            iterations: '600000' as unknown as number,
            hmac,
            version: ENCRYPTED_EXPORT_VERSION,
          },
          signer,
          fakeDecrypt(seen),
        );

        expect(result.status).toBe('decrypted');
        expect(seen).toEqual([undefined]);
      });

      it('opens an unsigned legacy file as legacyUnsigned instead of rejecting', async () => {
        const signer = makeSigner();
        const seen: unknown[] = [];

        const result = await openEncryptedExport(
          'password',
          {
            ciphertext: 'c',
            iv: 'i',
            salt: 's',
            hmac: undefined as unknown as string,
            version: '1',
          },
          signer,
          fakeDecrypt(seen, '{"legacy":true}'),
        );

        expect(result).toEqual({
          status: 'decrypted',
          decryptedJson: '{"legacy":true}',
          needsRehash: false,
          legacyUnsigned: true,
        });
      });

      it('rejects a legacy file whose plaintext hmac is wrong', async () => {
        const signer = makeSigner();
        const seen: unknown[] = [];

        const result = await openEncryptedExport(
          'password',
          { ciphertext: 'c', iv: 'i', salt: 's', hmac: 'sig:nope', version: '1' },
          signer,
          fakeDecrypt(seen, '{"legacy":true}'),
        );

        expect(result).toEqual({ status: 'rejected', reason: 'hmac-mismatch' });
        // Legacy carries no ciphertext HMAC, so KDF/decrypt runs first and the
        // plaintext check rejects after: the dispatch order is unchanged.
        expect(seen).toEqual([undefined]);
      });

      it('accepts a legacy file with a matching plaintext hmac', async () => {
        const signer = makeSigner();
        const seen: unknown[] = [];
        const hmac = await signer.sign('{"legacy":true}');

        const result = await openEncryptedExport(
          'password',
          { ciphertext: 'c', iv: 'i', salt: 's', hmac, version: '1' },
          signer,
          fakeDecrypt(seen, '{"legacy":true}'),
        );

        expect(result).toEqual({
          status: 'decrypted',
          decryptedJson: '{"legacy":true}',
          needsRehash: false,
          legacyUnsigned: false,
        });
      });

      it('collapses a decrypt failure to decrypt-failed', async () => {
        const signer = makeSigner();
        const hmac = await signer.sign('c:i:s:600000');
        const failing = async () => {
          throw new Error('kdf down');
        };

        const result = await openEncryptedExport(
          'password',
          { ...base, hmac, version: ENCRYPTED_EXPORT_VERSION },
          signer,
          failing,
        );

        expect(result).toEqual({ status: 'rejected', reason: 'decrypt-failed' });
      });
    });

    describe('sealEncryptedExport pins the crypto bytes', () => {
      it('stamps the SSOT version and iterations and signs the v3 payload', async () => {
        const signer = makeSigner();

        const sealed = await sealEncryptedExport('{"a":1}', 'password', signer);

        expect(sealed.version).toBe(ENCRYPTED_EXPORT_VERSION);
        expect(sealed.iterations).toBe(CRYPTO_PARAMS.PBKDF2_ITERATIONS);
        expect(sealed.hmac).toBe(
          `sig:${sealed.ciphertext}:${sealed.iv}:${sealed.salt}:${sealed.iterations}`,
        );
      });

      it('round-trips seal to open with real KDF and real cipher', async () => {
        const signer = makeSigner();
        const plainJson = '{"round":"trip"}';

        const sealed = await sealEncryptedExport(plainJson, 'password', signer);
        const opened = await openEncryptedExport('password', sealed, signer);

        expect(opened).toEqual({
          status: 'decrypted',
          decryptedJson: plainJson,
          needsRehash: false,
          legacyUnsigned: false,
        });
      });

      it('sealed envelopes carry no legacy version stamp', async () => {
        const signer = makeSigner();

        const sealed = await sealEncryptedExport('{"a":1}', 'password', signer);

        expect(sealed.version).not.toBe(LEGACY_ENCRYPTED_EXPORT_VERSION);
        expect(classifyEncryptedExportVersion(sealed.version)).toBe('v3');
      });
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

    it('owns no crypto primitives and delegates seal and open to the codec', async () => {
      const settingsPath = new URL('../../settingsExportImport.ts', import.meta.url);
      const source = await readFile(settingsPath, 'utf8');

      expect(source).not.toContain('buildEncryptedHmacPayload');
      expect(source).not.toContain('currentExportIterations');
      expect(source).not.toContain('decryptExportCiphertext');
      expect(source).not.toContain('verifyEncryptedExportHmac');
      expect(source).not.toContain('verifyLegacyPlaintextHmac');
      expect(source).not.toContain('deriveKey');
      expect(source).not.toContain('generateSalt');
      expect(source).not.toContain('bytesToBase64');
      expect(source).toContain('sealEncryptedExport');
      expect(source).toContain('openEncryptedExport');
    });
  });
});
