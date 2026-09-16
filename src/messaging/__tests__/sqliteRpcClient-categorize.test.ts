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
      retriable: true,
    });
  });

  it('classifies quota and sqlite errors', () => {
    expect(categorizeError('QuotaExceededError')).toMatchObject({ kind: 'quota' });
    expect(categorizeError('SQLITE_BUSY')).toMatchObject({ kind: 'sqlite_error' });
    expect(categorizeError('disk I/O error')).toMatchObject({ kind: 'sqlite_error' });
  });

  /**
   * Chrome's own wording for a dead offscreen document must be recognized as
   * one. Before this was handled, it fell through to `unknown` and the raw
   * browser prose reached the user with no guidance (PBI 2026-09-16-01).
   */
  it('recognizes Chrome\'s disconnect wording as offscreen_lost', () => {
    const result = categorizeError(CHROME_DISCONNECTED);

    expect(result.kind).toBe('offscreen_lost');
    expect(result.message).not.toContain('Receiving end does not exist');
    // The transport recreates the document on the next call, so a retry has a
    // real chance of succeeding.
    expect(result.retriable).toBe(true);
  });

  it('recognizes a bare "Could not establish connection" as offscreen_lost', () => {
    expect(categorizeError('Could not establish connection.')).toMatchObject({
      kind: 'offscreen_lost',
      retriable: true,
    });
  });

  it('falls back to unknown for genuinely unrecognized failures', () => {
    expect(categorizeError('something nobody predicted')).toMatchObject({
      kind: 'unknown',
      retriable: false,
    });
  });
});
