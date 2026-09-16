/**
 * sqliteRpcClient-categorize.test.ts
 *
 * categorizeError() maps a raw failure string onto the kind/message/retriable
 * triple the dashboard acts on. This suite pins the mapping, including the
 * gap found while investigating the archive e2e failures (PBI 2026-09-16-01):
 * Chrome words a lost offscreen document as "Could not establish connection.
 * Receiving end does not exist." — which contains neither "offscreen" nor
 * "timed out", so it falls through to `unknown` and the user is shown the raw
 * string instead of the actionable "reload the extension" guidance.
 */
import { describe, it, expect } from 'vitest';
import { categorizeError } from '../sqliteRpcClient.js';

/** The exact wording Chrome produces when the receiving end is gone. */
const CHROME_DISCONNECTED = 'Could not establish connection. Receiving end does not exist.';

describe('categorizeError', () => {
  it('classifies timeouts as retriable', () => {
    expect(categorizeError('Request timed out')).toMatchObject({
      kind: 'timeout',
      retriable: true,
    });
    expect(categorizeError('Timeout after 10000ms')).toMatchObject({
      kind: 'timeout',
      retriable: true,
    });
  });

  it('classifies an explicit offscreen failure as offscreen_lost', () => {
    expect(categorizeError('offscreen document was closed')).toMatchObject({
      kind: 'offscreen_lost',
      retriable: false,
    });
  });

  it('classifies quota and sqlite errors', () => {
    expect(categorizeError('QuotaExceededError')).toMatchObject({ kind: 'quota' });
    expect(categorizeError('SQLITE_BUSY')).toMatchObject({ kind: 'sqlite_error' });
    expect(categorizeError('disk I/O error')).toMatchObject({ kind: 'sqlite_error' });
  });

  /**
   * Documents the gap rather than the desired end state: Chrome's own wording
   * for a dead offscreen document is not recognized as one. Flip this to
   * `offscreen_lost` together with the fix.
   */
  it('does NOT yet recognize Chrome\'s disconnect wording as offscreen_lost', () => {
    const result = categorizeError(CHROME_DISCONNECTED);

    expect(result.kind).toBe('unknown');
    expect(result.message).toContain('Unexpected error');
    // The raw Chrome string reaches the user verbatim, with no guidance.
    expect(result.message).toContain('Receiving end does not exist');
  });

  it('falls back to unknown for genuinely unrecognized failures', () => {
    expect(categorizeError('something nobody predicted')).toMatchObject({
      kind: 'unknown',
      retriable: false,
    });
  });
});
