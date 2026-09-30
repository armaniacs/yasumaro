import { describe, it, expect } from 'vitest';
import {
  MAX_KDF_ITERATIONS,
  MIN_KDF_ITERATIONS,
  assertValidStoredKdfIterations,
} from '../primitives.js';
import { MAX_KDF_ITERATIONS as NEGOTIATOR_MAX } from '../kdfNegotiator.js';
import { CRYPTO_PARAMS } from '../cryptoParams.js';

describe('kdf iteration bounds', () => {
  describe('constants', () => {
    it('keeps a single ceiling shared by the negotiator', () => {
      expect(NEGOTIATOR_MAX).toBe(MAX_KDF_ITERATIONS);
      expect(MAX_KDF_ITERATIONS).toBe(CRYPTO_PARAMS.PBKDF2_ITERATIONS * 10);
    });

    it('uses the legacy iteration count as the floor', () => {
      expect(MIN_KDF_ITERATIONS).toBe(CRYPTO_PARAMS.LEGACY_PBKDF2_ITERATIONS);
    });
  });

  describe('assertValidStoredKdfIterations', () => {
    it.each([
      ['floor', MIN_KDF_ITERATIONS],
      ['current', CRYPTO_PARAMS.PBKDF2_ITERATIONS],
      ['ceiling', MAX_KDF_ITERATIONS],
    ])('accepts the %s value', (_label, value) => {
      expect(assertValidStoredKdfIterations(value)).toBe(value);
    });

    it('passes undefined through', () => {
      expect(assertValidStoredKdfIterations(undefined)).toBeUndefined();
    });

    it.each([
      ['below floor', MIN_KDF_ITERATIONS - 1],
      ['one', 1],
      ['above ceiling', MAX_KDF_ITERATIONS + 1],
      ['int32 max', 2147483647],
      ['negative', -600000],
      ['zero', 0],
      ['non-integer', CRYPTO_PARAMS.PBKDF2_ITERATIONS + 0.5],
      ['NaN', NaN],
      ['Infinity', Infinity],
      ['numeric string', String(CRYPTO_PARAMS.PBKDF2_ITERATIONS)],
      ['null', null],
      ['object', {}],
    ])('rejects %s', (_label, value) => {
      expect(() => assertValidStoredKdfIterations(value)).toThrow('Master password data corrupted');
    });
  });
});
