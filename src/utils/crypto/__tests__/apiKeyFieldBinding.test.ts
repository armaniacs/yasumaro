/**
 * apiKeyFieldBinding.test.ts (PBI 2026-09-30-03)
 *
 * AAD binding contract for API-key ciphertext: new writes are bound to the
 * storage field they will live under, the binding itself never enters the
 * envelope, and v1 (AAD-less) data keeps reading until it is rewritten.
 *
 * Real WebCrypto, no mocks — the point is the bytes AES-GCM actually
 * authenticates.
 */
import { describe, it, expect } from 'vitest';
import { webcrypto } from 'node:crypto';
import { encrypt, encryptApiKey, decryptApiKey } from '../primitives.js';
import type { EncryptedData } from '../types.js';

const ALGORITHM = { name: 'AES-GCM', length: 256 } as const;
const USAGES = ['encrypt', 'decrypt'] as const;

async function testKey(): Promise<CryptoKey> {
  return (await webcrypto.subtle.generateKey(ALGORITHM, false, [...USAGES])) as CryptoKey;
}

describe('apiKeyFieldBinding', () => {
  describe('encryptApiKey', () => {
    it('marks the envelope v2 and keeps the field identifier out of it', async () => {
      const encrypted = await encryptApiKey('sk-live-openai', await testKey(), 'openai_api_key');

      expect(encrypted).toEqual({
        ciphertext: expect.any(String),
        iv: expect.any(String),
        version: 2,
      });
      // Storing the binding would let an attacker move ciphertext and
      // binding together, which defeats the whole check.
      expect(JSON.stringify(encrypted)).not.toContain('openai_api_key');
    });

    it('rejects an empty field so a binding can never be silently skipped', async () => {
      await expect(encryptApiKey('sk-live', await testKey(), '')).rejects.toThrow('Invalid API key field');
    });
  });

  describe('decryptApiKey', () => {
    it('round-trips a v2 envelope under its own field', async () => {
      const key = await testKey();
      const encrypted = await encryptApiKey('sk-live-openai', key, 'openai_api_key');

      expect(await decryptApiKey(encrypted, key, 'openai_api_key')).toBe('sk-live-openai');
    });

    it('fails to decrypt after the ciphertext is moved to another field', async () => {
      const key = await testKey();
      const openai = await encryptApiKey('sk-live-openai', key, 'openai_api_key');
      const moved = { ...openai };

      await expect(decryptApiKey(moved, key, 'gemini_api_key')).rejects.toThrow('Decryption failed');
    });

    it('fails when a v2 envelope is relabeled as v1 to drop the binding', async () => {
      const key = await testKey();
      const encrypted = await encryptApiKey('sk-live-openai', key, 'openai_api_key');
      const stripped: EncryptedData = { ciphertext: encrypted.ciphertext, iv: encrypted.iv };

      await expect(decryptApiKey(stripped, key, 'openai_api_key')).rejects.toThrow('Decryption failed');
    });

    it('reads a v1 (AAD-less) envelope under any field', async () => {
      const key = await testKey();
      const v1 = await encrypt('sk-legacy-value', key);

      expect(v1.version).toBeUndefined();
      expect(await decryptApiKey(v1, key, 'openai_api_key')).toBe('sk-legacy-value');
    });

    it('refuses a v2 envelope when the caller supplies no field', async () => {
      const key = await testKey();
      const encrypted = await encryptApiKey('sk-live-openai', key, 'openai_api_key');

      await expect(decryptApiKey(encrypted, key, '')).rejects.toThrow(
        'API key field is required to decrypt a v2 envelope',
      );
    });

    it('rejects an unknown envelope version instead of guessing', async () => {
      const key = await testKey();
      const encrypted = await encryptApiKey('sk-live-openai', key, 'openai_api_key');
      const future = { ...encrypted, version: 9 };

      await expect(decryptApiKey(future, key, 'openai_api_key')).rejects.toThrow(
        'Unsupported API key envelope version: 9',
      );
    });

    it('returns plaintext strings unchanged', async () => {
      expect(await decryptApiKey('sk-plaintext', await testKey(), 'openai_api_key')).toBe('sk-plaintext');
    });

    it('rejects a value that is neither string nor envelope', async () => {
      await expect(decryptApiKey({} as EncryptedData, await testKey(), 'openai_api_key')).rejects.toThrow(
        'Invalid API key format',
      );
    });
  });
});
