/**
 * envelopeBackupCap.test.ts (PBI 2026-11-06-02)
 *
 * Generic 10MiB envelope cap vs the backup-specific cap:
 * a legitimate multi-MB backup must pass the pre-decode length gate in the
 * backup context while the generic default stays at 10MiB (VULN-036).
 */
import { describe, it, expect, vi } from 'vitest';
import { Crypto } from '@peculiar/webcrypto';

// Production KDF iterations would dominate this file's runtime; the values
// themselves are pinned in cryptoParamsSSOT.test.ts.
vi.mock('../cryptoParams.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../cryptoParams.js')>();
  return {
    ...actual,
    CRYPTO_PARAMS: {
      ...actual.CRYPTO_PARAMS,
      PBKDF2_ITERATIONS: 1_000,
      LEGACY_PBKDF2_ITERATIONS: 100,
    },
  };
});

import {
  encryptEnvelope,
  decryptEnvelope,
  decryptBackupEnvelope,
} from '../envelope.js';
import {
  MAX_ENVELOPE_BASE64_LENGTH,
  MAX_BACKUP_ENVELOPE_BASE64_LENGTH,
} from '../../limits.js';

Object.defineProperty(globalThis, 'crypto', { value: new Crypto(), configurable: true });

const PASSWORD = 'backup-cap-test-password';

describe('envelope backup cap (PBI 2026-11-06-02)', () => {
  describe('generic default cap', () => {
    it('rejects data over the generic 10MiB cap before decryption', async () => {
      const envelope = await encryptEnvelope('secret', PASSWORD);
      envelope.data = 'A'.repeat(MAX_ENVELOPE_BASE64_LENGTH + 1);

      await expect(decryptEnvelope(envelope, PASSWORD)).rejects.toThrow('exceeds maximum length');
    });

    it('keeps the generic cap at 10MiB and the backup cap above it', () => {
      expect(MAX_ENVELOPE_BASE64_LENGTH).toBe(10 * 1024 * 1024);
      expect(MAX_BACKUP_ENVELOPE_BASE64_LENGTH).toBeGreaterThan(MAX_ENVELOPE_BASE64_LENGTH);
      expect(MAX_BACKUP_ENVELOPE_BASE64_LENGTH).toBe(50 * 1024 * 1024);
    });
  });

  describe('explicit length seam', () => {
    it('accepts data exactly at the configured length', async () => {
      const envelope = await encryptEnvelope('hi', PASSWORD);

      await expect(
        decryptEnvelope(envelope, PASSWORD, { maxBase64Length: envelope.data.length }),
      ).resolves.toBe('hi');
    });

    it('rejects data one char over the configured length with a cause-identifying message', async () => {
      const envelope = await encryptEnvelope('hi', PASSWORD);

      await expect(
        decryptEnvelope(envelope, PASSWORD, { maxBase64Length: envelope.data.length - 1 }),
      ).rejects.toThrow('exceeds maximum length');
    });
  });

  describe('backup context', () => {
    it('round-trips plaintext whose base64 data exceeds the generic 10MiB cap', async () => {
      // 9MB plaintext -> ~12MB base64 data: over generic, under backup cap.
      const plaintext = 'a'.repeat(9_000_000);
      const envelope = await encryptEnvelope(plaintext, PASSWORD);
      expect(envelope.data.length).toBeGreaterThan(MAX_ENVELOPE_BASE64_LENGTH);

      await expect(decryptEnvelope(envelope, PASSWORD)).rejects.toThrow('exceeds maximum length');
      await expect(decryptBackupEnvelope(envelope, PASSWORD)).resolves.toBe(plaintext);
    });

    it('rejects backup data over the backup cap with a backup-identifying message', async () => {
      const envelope = await encryptEnvelope('secret', PASSWORD);
      envelope.data = 'A'.repeat(MAX_BACKUP_ENVELOPE_BASE64_LENGTH + 1);

      const error = await decryptBackupEnvelope(envelope, PASSWORD).then(
        () => null,
        (e: Error) => e,
      );
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain('exceeds maximum length');
      expect((error as Error).message).toContain('backup');
    });

    it('keeps cheap-auth-first order: bad iterations rejected before the length gate', async () => {
      const envelope = await encryptEnvelope('secret', PASSWORD);
      envelope.iterations = 1_000_000_000;
      envelope.data = 'A'.repeat(MAX_BACKUP_ENVELOPE_BASE64_LENGTH + 1);

      await expect(decryptBackupEnvelope(envelope, PASSWORD)).rejects.toThrow(
        'Invalid envelope iterations',
      );
    });

    it('rejects tampered backup ciphertext (AES-GCM auth intact)', async () => {
      const envelope = await encryptEnvelope('backup-secret', PASSWORD);
      const last = envelope.data[envelope.data.length - 1];
      const flipped = last === 'A' ? 'B' : 'A';
      envelope.data = envelope.data.slice(0, -1) + flipped;

      await expect(decryptBackupEnvelope(envelope, PASSWORD)).rejects.toThrow();
      await expect(decryptBackupEnvelope(envelope, PASSWORD)).rejects.not.toThrow(
        'exceeds maximum length',
      );
    });
  });
});
