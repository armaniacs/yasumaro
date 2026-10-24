/**
 * crypto/encryptedExportCodec.ts (PBI 2026-10-16-06)
 *
 * The encrypted settings-export codec: versions, HMAC payload, signature
 * verification, and KDF decrypt dispatch in one module.
 *
 * WHY: the HMAC payload builder, the v2/v3 branch, and the iteration
 * constants used to live in `settingsExportImport.ts` next to the
 * import/export flow. Any iteration change then needed a synchronized edit
 * there too, and one missed sync means "undecryptable backup = lost API
 * keys" or a reintroduced KDF-cost forgery. The codec owns the numbers so
 * the settings side only passes a password and JSON through.
 *
 * This module calls `kdfNegotiator`/`cryptoParams` but does not change
 * their behavior.
 */

import { CRYPTO_PARAMS } from './cryptoParams.js';
import {
  decryptWithIterationCandidates,
  type KdfNegotiationResult,
} from './kdfNegotiator.js';
import type { HmacSigner } from './hmacSigner.js';
// Barrel import: the crypto tests mock '../crypto/index.js', so importing the
// seal primitives through the barrel keeps those mocks effective — the same
// reason kdfNegotiator imports deriveKey through the barrel.
import { deriveKey, encrypt, generateSalt, bytesToBase64 } from './index.js';

export type { KdfNegotiationResult };

/** Encrypted export format version — v3 signs iterations along with ciphertext:iv:salt. */
export const ENCRYPTED_EXPORT_VERSION = '3';

/** v2 signed only ciphertext:iv:salt; still accepted on import. */
export const LEGACY_ENCRYPTED_EXPORT_VERSION = '2';

/** Parts covered by the encrypted-export HMAC. */
export interface EncryptedExportHmacParts {
  ciphertext: string;
  iv: string;
  salt: string;
  iterations?: number;
}

/**
 * Single builder for the encrypted-export HMAC payload so export and import
 * cannot drift. v2 omits iterations, which lets a signed file carry a forged
 * KDF cost.
 */
export function buildEncryptedHmacPayload(
  data: EncryptedExportHmacParts,
  version: typeof ENCRYPTED_EXPORT_VERSION | typeof LEGACY_ENCRYPTED_EXPORT_VERSION,
): string {
  const base = `${data.ciphertext}:${data.iv}:${data.salt}`;
  return version === ENCRYPTED_EXPORT_VERSION ? `${base}:${data.iterations}` : base;
}

/** Current KDF cost for newly written encrypted exports (SSOT). */
export function currentExportIterations(): number {
  return CRYPTO_PARAMS.PBKDF2_ITERATIONS;
}

/** Codec-level version kinds: v3/v2 carry a ciphertext HMAC, legacy defers to plaintext. */
export type EncryptedExportCodecVersion = 'v3' | 'v2' | 'legacy';

/** Classify a raw `version` stamp without leaking version literals to callers. */
export function classifyEncryptedExportVersion(version: unknown): EncryptedExportCodecVersion {
  const versionText = String(version);
  if (versionText === ENCRYPTED_EXPORT_VERSION) return 'v3';
  if (versionText === LEGACY_ENCRYPTED_EXPORT_VERSION) return 'v2';
  return 'legacy';
}

/** Whether this version authenticates ciphertext before KDF/decrypt. */
export function hasCiphertextHmac(version: unknown): boolean {
  return classifyEncryptedExportVersion(version) !== 'legacy';
}

/** Verifier seam: structural so tests verify the codec without chrome. */
export type CodecHmacVerifier = Pick<HmacSigner, 'verify'>;

/** Signer seam for sealing: structural so tests seal without chrome. */
export type CodecHmacSigner = Pick<HmacSigner, 'sign'>;

/**
 * Envelope fields produced by sealEncryptedExport. The file shape
 * (`encrypted`, `exportedAt`) stays with the settings side; every
 * cryptographic byte lives here.
 */
export interface SealedEncryptedExport {
  version: string;
  ciphertext: string;
  iv: string;
  salt: string;
  iterations: number;
  hmac: string;
}

/**
 * Single owner of the encrypted-export seal: salt, KDF (SSOT iterations),
 * encrypt, and ciphertext HMAC in one place. The settings side passes only
 * the settings JSON and the password (plus its signer). The byte layout is
 * identical to the previous inline call site, so existing backups keep
 * decrypting.
 */
export async function sealEncryptedExport(
  plainJson: string,
  password: string,
  signer: CodecHmacSigner,
): Promise<SealedEncryptedExport> {
  const salt = generateSalt();
  const saltB64 = bytesToBase64(salt);
  const iterations = currentExportIterations();
  const key = await deriveKey(password, salt, iterations);
  const encrypted = await encrypt(plainJson, key);
  const hmac = await signer.sign(
    buildEncryptedHmacPayload(
      {
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        salt: saltB64,
        iterations,
      },
      ENCRYPTED_EXPORT_VERSION,
    ),
  );
  return {
    version: ENCRYPTED_EXPORT_VERSION,
    ciphertext: encrypted.ciphertext,
    iv: encrypted.iv,
    salt: saltB64,
    iterations,
    hmac,
  };
}

/** Outcome of opening an encrypted export: decrypted JSON or a fail-closed reason. */
export type OpenEncryptedExportResult =
  | { status: 'decrypted'; decryptedJson: string; needsRehash: boolean; legacyUnsigned: boolean }
  | { status: 'rejected'; reason: 'hmac-mismatch' | 'decrypt-failed' };

/**
 * Single owner of the encrypted-export open: ciphertext HMAC check, KDF
 * dispatch, then the legacy plaintext check. The settings side passes only
 * the password and the file envelope (plus its verifier) and maps the
 * outcome to logs. A verifier that throws propagates, so the caller keeps
 * its fail-closed path; a decrypt failure collapses to 'decrypt-failed'.
 */
export async function openEncryptedExport(
  password: string,
  input: CiphertextHmacCheckInput,
  verifier: CodecHmacVerifier,
  decryptFn: typeof decryptWithIterationCandidates = decryptWithIterationCandidates,
): Promise<OpenEncryptedExportResult> {
  const ciphertextCheck = await verifyEncryptedExportHmac(input, verifier);
  if (ciphertextCheck === 'mismatch') {
    return { status: 'rejected', reason: 'hmac-mismatch' };
  }
  let decrypted: KdfNegotiationResult;
  try {
    decrypted = await decryptExportCiphertext(password, input, decryptFn);
  } catch {
    return { status: 'rejected', reason: 'decrypt-failed' };
  }
  if (ciphertextCheck === 'legacy-deferred') {
    const legacyCheck = await verifyLegacyPlaintextHmac(decrypted.text, input.hmac, verifier);
    if (legacyCheck === 'mismatch') {
      return { status: 'rejected', reason: 'hmac-mismatch' };
    }
    return {
      status: 'decrypted',
      decryptedJson: decrypted.text,
      needsRehash: decrypted.needsRehash,
      legacyUnsigned: legacyCheck === 'unsigned',
    };
  }
  return {
    status: 'decrypted',
    decryptedJson: decrypted.text,
    needsRehash: decrypted.needsRehash,
    legacyUnsigned: false,
  };
}

/** Ciphertext-stage HMAC input: envelope fields plus the raw version stamp. */
export interface CiphertextHmacCheckInput extends EncryptedExportHmacParts {
  hmac: string;
  version: unknown;
}

/** Outcome of the ciphertext-stage check. */
export type CiphertextHmacOutcome = 'verified' | 'legacy-deferred' | 'mismatch';

/**
 * Verify the ciphertext HMAC before KDF/decrypt (cheap auth, then amplify).
 * Legacy versions carry no ciphertext HMAC and defer to the plaintext check;
 * the verifier is not called for them.
 */
export async function verifyEncryptedExportHmac(
  input: CiphertextHmacCheckInput,
  verifier: CodecHmacVerifier,
): Promise<CiphertextHmacOutcome> {
  const kind = classifyEncryptedExportVersion(input.version);
  if (kind === 'legacy') {
    return 'legacy-deferred';
  }
  const payload = buildEncryptedHmacPayload(
    input,
    kind === 'v3' ? ENCRYPTED_EXPORT_VERSION : LEGACY_ENCRYPTED_EXPORT_VERSION,
  );
  return (await verifier.verify(payload, input.hmac)) ? 'verified' : 'mismatch';
}

/** Outcome of the legacy v1 plaintext check. */
export type LegacyPlaintextOutcome = 'verified' | 'unsigned' | 'mismatch';

/**
 * Legacy v1 check: HMAC was over plaintext_json. Pre-signing exports carry
 * no hmac and stay importable so existing backups are not orphaned.
 */
export async function verifyLegacyPlaintextHmac(
  decryptedJson: string,
  hmac: string | undefined,
  verifier: CodecHmacVerifier,
): Promise<LegacyPlaintextOutcome> {
  if (!hmac) {
    return 'unsigned';
  }
  return (await verifier.verify(decryptedJson, hmac)) ? 'verified' : 'mismatch';
}

/** Ciphertext input for the decrypt dispatch. */
export interface ExportDecryptInput {
  salt: string;
  ciphertext: string;
  iv: string;
  iterations?: unknown;
}

/**
 * Decrypt dispatch: the stored→SSOT→legacy iteration candidate loop lives in
 * `kdfNegotiator`; the codec only normalizes the self-described iteration
 * field and forwards it. A non-number field is treated as absent (same as
 * the pre-codec call site). The decryptor is injectable so the dispatch is
 * testable without chrome or webcrypto.
 */
export async function decryptExportCiphertext(
  password: string,
  input: ExportDecryptInput,
  decryptFn: typeof decryptWithIterationCandidates = decryptWithIterationCandidates,
): Promise<KdfNegotiationResult> {
  return decryptFn(
    password,
    input.salt,
    input.ciphertext,
    input.iv,
    typeof input.iterations === 'number' ? input.iterations : undefined,
  );
}
