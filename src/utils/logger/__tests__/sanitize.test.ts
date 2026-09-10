// Transient RED→GREEN scaffold for VULN-003.
// Final committed name: src/utils/logger/__tests__/sanitize.test.ts
import { describe, expect, it } from 'vitest';
import { sanitizeLogDetails, sanitizeArray } from '../sanitize.js';

// The scan's exact PoC payload: JSON.parse yields an OWN `__proto__` property
// that the keyed assignment inside sanitizeLogDetails would re-point.
function attackDetails(): Record<string, unknown> {
  return JSON.parse('{"__proto__": {"polluted": "pwned"}}');
}

describe('VULN-003: log-details sanitizer must not honor __proto__ keys', () => {
  it('never re-points the prototype of the sanitized entry', async () => {
    const out = await sanitizeLogDetails(attackDetails());
    const proto = Object.getPrototypeOf(out);
    expect(proto === Object.prototype || proto === null).toBe(true);
    expect((out as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('preserves the __proto__ data as a harmless own property', async () => {
    const out = await sanitizeLogDetails(attackDetails()) as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(out, '__proto__')).toBe(true);
  });

  it('is safe for nested object recursion', async () => {
    const details = JSON.parse('{"outer": {"__proto__": {"deep": true}}}');
    const out = (await sanitizeLogDetails(details)) as Record<string, unknown>;
    const nested = out.outer as Record<string, unknown>;
    expect(Object.getPrototypeOf(nested) === Object.prototype || Object.getPrototypeOf(nested) === null).toBe(true);
    expect(nested.deep).toBeUndefined();
  });

  it('is safe for the array variant path', async () => {
    const arr = await sanitizeArray([JSON.parse('{"__proto__": {"viaArray": 1}}')]);
    const first = arr[0] as Record<string, unknown>;
    expect(Object.getPrototypeOf(first) === Object.prototype || Object.getPrototypeOf(first) === null).toBe(true);
    expect(first.viaArray).toBeUndefined();
  });

  it('still sanitizes ordinary details', async () => {
    const out = await sanitizeLogDetails({ user: 'bob', count: 3 });
    expect(out.user).toBe('bob');
    expect(out.count).toBe(3);
  });
});
