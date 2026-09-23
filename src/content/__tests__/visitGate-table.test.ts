// @vitest-environment jsdom
/**
 * visitGate-table.test.ts — PBI 2026-09-23-05 content-side table adapters.
 *
 * The VisitGate engagement matrix stays pinned in
 * visitGate-comprehensive.test.ts (untouched). This file pins only the new
 * shared-table adapters: the domainFilter row evaluation from the locally
 * known cache verdict, and the shared scheme predicate.
 */
import { describe, it, expect } from 'vitest';
import { decideContentDomainAdmission, isContentUrlSchemeRecordable } from '../visitGate.js';

describe('decideContentDomainAdmission', () => {
  it('allows on a cached domain verdict (same row the pipeline step executes)', () => {
    expect(decideContentDomainAdmission(true)).toEqual({ allow: true });
  });

  it('denies with DOMAIN_BLOCKED on a negative cache verdict without force', () => {
    expect(decideContentDomainAdmission(false)).toEqual({ allow: false, error: 'DOMAIN_BLOCKED' });
  });
});

describe('isContentUrlSchemeRecordable', () => {
  it('allows http/https page URLs', () => {
    expect(isContentUrlSchemeRecordable('http://example.com')).toBe(true);
    expect(isContentUrlSchemeRecordable('https://example.com/page')).toBe(true);
  });

  it('rejects extension, browser, and blank URLs plus missing input', () => {
    expect(isContentUrlSchemeRecordable('chrome://extensions')).toBe(false);
    expect(isContentUrlSchemeRecordable('chrome-extension://id/page')).toBe(false);
    expect(isContentUrlSchemeRecordable('about:blank')).toBe(false);
    expect(isContentUrlSchemeRecordable('')).toBe(false);
    expect(isContentUrlSchemeRecordable(null)).toBe(false);
    expect(isContentUrlSchemeRecordable(undefined)).toBe(false);
  });
});
