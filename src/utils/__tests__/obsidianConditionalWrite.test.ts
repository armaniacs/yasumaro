import { describe, it, expect } from 'vitest';
import {
  MAX_CONFLICT_REWRITES,
  decideConflictRewrite,
  detectStrongEtag,
  isPreconditionConflict,
  withIfMatch,
} from '../obsidianConditionalWrite.js';
import { FailureKind, createFailure } from '../failureTaxonomy.js';

function headersOf(etag: string | null): Pick<Headers, 'get'> {
  return { get: (name: string) => (name.toLowerCase() === 'etag' ? etag : null) };
}

describe('obsidianConditionalWrite', () => {
  describe('detectStrongEtag', () => {
    it.each([
      ['strong quoted', '"abc123"', '"abc123"'],
      ['strong with surrounding spaces', '  "abc"  ', '"abc"'],
      ['weak validator', 'W/"abc"', null],
      ['weak lowercase prefix', 'w/"abc"', null],
      ['empty string', '', null],
      ['whitespace only', '   ', null],
      ['header absent', null, null],
    ])('%s -> %s', (_label, raw, expected) => {
      expect(detectStrongEtag(headersOf(raw))).toBe(expected);
    });

    it('returns null when the response carries no headers object', () => {
      expect(detectStrongEtag(undefined)).toBeNull();
    });
  });

  describe('withIfMatch', () => {
    it('adds If-Match when an etag was detected', () => {
      const merged = new Headers(withIfMatch({ Authorization: 'Bearer k' }, '"v1"'));
      expect(merged.get('If-Match')).toBe('"v1"');
      expect(merged.get('Authorization')).toBe('Bearer k');
    });

    it('returns the original headers untouched when no etag was detected', () => {
      const original = { Authorization: 'Bearer k' };
      expect(withIfMatch(original, null)).toBe(original);
    });
  });

  describe('isPreconditionConflict', () => {
    it.each([
      ['PUT 412', createFailure(FailureKind.HTTP, { status: 412, method: 'PUT' }), true],
      ['PUT 500', createFailure(FailureKind.HTTP, { status: 500, method: 'PUT' }), false],
      ['GET 412', createFailure(FailureKind.HTTP, { status: 412, method: 'GET' }), false],
      ['no status', createFailure(FailureKind.NETWORK), false],
      ['null', null, false],
    ])('%s -> %s', (_label, failure, expected) => {
      expect(isPreconditionConflict(failure)).toBe(expected);
    });
  });

  describe('decideConflictRewrite', () => {
    const conflict = createFailure(FailureKind.HTTP, { status: 412, method: 'PUT' });
    const other = createFailure(FailureKind.HTTP, { status: 503, method: 'PUT' });

    it.each([
      ['first conflict', conflict, 0, 'rewrite'],
      ['conflict after the single rewrite', conflict, MAX_CONFLICT_REWRITES, 'exhausted'],
      ['conflict beyond the cap', conflict, MAX_CONFLICT_REWRITES + 3, 'exhausted'],
      ['non-conflict failure', other, 0, 'not-conflict'],
      ['missing failure', null, 0, 'not-conflict'],
    ] as const)('%s -> %s', (_label, failure, rewritesDone, expected) => {
      expect(decideConflictRewrite(failure, rewritesDone)).toBe(expected);
    });

    it('caps rewrites at exactly one', () => {
      expect(MAX_CONFLICT_REWRITES).toBe(1);
    });
  });
});
