/**
 * validators-e2eProbeState.test.ts
 * Six-key allowlist pin for E2EProbeStateValidator (Blue Team review 2026-10-15).
 *
 * OW_PROBE_STATE is the one content-script-reachable path into
 * chrome.storage.session — the service-worker handler stores the payload
 * verbatim — so the validator's key set decides what may enter extension
 * state at all. Six keys pass (the OWTestState contract, SSOT:
 * src/utils/e2eTestState.ts); every other key is a rejection instead of an
 * unexamined write. The field/typing checks below must keep working behind
 * the allowlist, so they are pinned here too (no other suite covered this
 * validator).
 */
import { describe, it, expect } from 'vitest';
import { E2EProbeStateValidator, ValidationError } from '../validators.js';

const VALID_PAYLOAD = {
  maxScrollPercentage: 80,
  isValidVisitReported: false,
  startTime: 1,
  minVisitDuration: 5,
  minScrollDepth: 50,
  duration: 2,
};

function validatePayload(payload: Record<string, unknown>): unknown {
  return new E2EProbeStateValidator().validate({ type: 'OW_PROBE_STATE', payload });
}

describe('E2EProbeStateValidator', () => {
  describe('validate', () => {
    it('accepts a payload carrying exactly the six OWTestState keys', () => {
      expect(() => validatePayload({ ...VALID_PAYLOAD })).not.toThrow();
    });

    it('rejects a key outside the six-key allowlist and names it', () => {
      for (const key of ['pageContent', 'url', 'extraField']) {
        let caught: unknown;
        try {
          validatePayload({ ...VALID_PAYLOAD, [key]: 'smuggled' });
        } catch (error) {
          caught = error;
        }
        expect(caught).toBeInstanceOf(ValidationError);
        const validationError = caught as ValidationError;
        expect(validationError.field).toBe(key);
        expect(validationError.message).toContain('not a known probe-state key');
      }
    });

    it('still rejects missing or mistyped required fields behind the allowlist', () => {
      expect(() => validatePayload({ maxScrollPercentage: 80 })).toThrow(ValidationError);
      expect(() => validatePayload({ ...VALID_PAYLOAD, duration: '2' })).toThrow(ValidationError);
      expect(() => validatePayload({ ...VALID_PAYLOAD, isValidVisitReported: 'yes' })).toThrow(
        ValidationError,
      );
    });

    it('rejects a non-object payload and a foreign message type', () => {
      const validator = new E2EProbeStateValidator();
      expect(() => validator.validate({ type: 'OW_PROBE_STATE', payload: 'x' })).toThrow(
        ValidationError,
      );
      expect(() => validator.validate({ type: 'OW_PROBE_QUERY' })).toThrow(ValidationError);
    });
  });
});
