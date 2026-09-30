import { describe, it, expect } from 'vitest';
import { EncryptionLockedError, isEncryptionLockedError, assertApiKeyResolved } from '../encryptionLockedError.js';

describe('encryptionLockedError', () => {
  it('matches both the dedicated class and the session plain-Error prefix', () => {
    expect(isEncryptionLockedError(new EncryptionLockedError())).toBe(true);
    expect(isEncryptionLockedError(new Error('ENCRYPTION_LOCKED: Session is locked'))).toBe(true);
    expect(isEncryptionLockedError(new Error('CORRUPTION: x'))).toBe(false);
    expect(isEncryptionLockedError('ENCRYPTION_LOCKED')).toBe(false);
  });

  it('rejects only non-null objects and accepts strings, undefined, and empty', () => {
    expect(() => assertApiKeyResolved({ iv: 'a', ciphertext: 'b' } as never)).toThrow(EncryptionLockedError);
    expect(() => assertApiKeyResolved('sk-x')).not.toThrow();
    expect(() => assertApiKeyResolved(undefined)).not.toThrow();
    expect(() => assertApiKeyResolved('')).not.toThrow();
  });

  it('never leaks ciphertext material in the thrown message', () => {
    let caught: unknown;
    try {
      assertApiKeyResolved({ iv: 'secret-iv-value', ciphertext: 'secret-cipher-value' } as never);
    } catch (e: unknown) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(EncryptionLockedError);
    const message = (caught as Error).message;
    expect(message).not.toContain('secret-iv-value');
    expect(message).not.toContain('secret-cipher-value');
    expect(message).not.toContain('ciphertext');
    expect(message).not.toContain('iv');
  });
});
