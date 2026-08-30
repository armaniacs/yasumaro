/**
 * crypto/cryptoParams.ts
 * SSOT for cryptographic parameters and password policy.
 *
 * - 3 KDF paths (envelope, settings export, password change) reference this module.
 * - Validation logic unifies the weak `masterPassword.ts:78-86` length check and
 *   the strict `storage/encryptionSession.ts:262-274` strength check.
 */

export const CRYPTO_PARAMS = {
  PBKDF2_ITERATIONS: 600_000,
  LEGACY_PBKDF2_ITERATIONS: 100_000,
  ENVELOPE_VERSION: 2,
} as const;

/**
 * Internal strength scoring — mirrors masterPassword.ts:calculatePasswordStrength
 * so this module remains dependency-free (avoids circular imports).
 */
function scorePassword(password: string): { score: number; level: string } {
  let score = 0;
  if (password.length >= 8) score += 20;
  if (password.length >= 12) score += 10;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 20;
  if (/\d/.test(password)) score += 20;
  if (/[^a-zA-Z0-9]/.test(password)) score += 30;
  score = Math.min(score, 100);
  let level: string;
  if (score < 40) level = 'Weak';
  else if (score < 80) level = 'Medium';
  else level = 'Strong';
  return { score, level };
}

/**
 * Unified password policy — stricter side of both legacy checks.
 *
 * Requirements:
 * - required, non-empty
 * - length >= 12
 * - at least 3 of 4 char types: upper / lower / digit / symbol
 * - strength score >= 40 (mirrors encryptionSession.ts strict path)
 *
 * Returns `{ ok: true }` when valid, otherwise `{ ok: false, reason }`.
 */
export function validatePasswordPolicy(password: string): { ok: boolean; reason?: string } {
  if (!password) {
    return { ok: false, reason: 'Password is required' };
  }
  if (password.length < 12) {
    return { ok: false, reason: 'Password must be at least 12 characters long' };
  }
  let types = 0;
  if (/[a-z]/.test(password)) types++;
  if (/[A-Z]/.test(password)) types++;
  if (/\d/.test(password)) types++;
  if (/[^a-zA-Z0-9]/.test(password)) types++;
  if (types < 3) {
    return {
      ok: false,
      reason:
        'Password must contain at least 3 of the following: uppercase letters, lowercase letters, numbers, symbols',
    };
  }
  const { score, level } = scorePassword(password);
  if (score < 40) {
    return {
      ok: false,
      reason: `Password is too weak (score: ${score}, level: ${level}). Please include a mix of uppercase, lowercase, numbers, and special characters.`,
    };
  }
  return { ok: true };
}
