/**
 * parseFetchErrorParity.test.ts
 * Golden-pin the connection-test fetch-throw wording.
 *
 * Every expectation is a byte-identical copy of the wording the provider base
 * produced before the mapping moved into `src/utils/httpFailureMessages.ts`
 * (PBI 2026-09-29-39). Rewording any of them is a separate product decision —
 * this file must stay green through the move.
 */
import { describe, it, expect } from 'vitest';
import { mapHttpFetchFailure } from '../../../../utils/httpFailureMessages.js';

function parse(msg: string, label: string, name?: string): string {
  return mapHttpFetchFailure(msg, label, name).message;
}

describe('mapHttpFetchFailure parity (golden)', () => {
  it('pins the 401/403 wording with the caller-supplied label', () => {
    expect(parse('HTTP 401: Unauthorized', 'lm-studio')).toBe(
      'Invalid API key (401). Check your lm-studio API key settings.',
    );
    expect(parse('HTTP 403: Forbidden', 'lm-studio')).toBe(
      'Invalid API key (403). Check your lm-studio API key settings.',
    );
  });

  it('pins the 404 wording (no label)', () => {
    expect(parse('HTTP 404: Not Found', 'lm-studio')).toBe(
      'Model or endpoint not found (404). Check your Base URL.',
    );
  });

  it('pins the 429 wording (no label)', () => {
    expect(parse('HTTP 429: Too Many Requests', 'lm-studio')).toBe(
      'Rate limit exceeded (429). Please try again later.',
    );
  });

  it('pins the 5xx wording with the caller-supplied label', () => {
    expect(parse('HTTP 500: Internal Server Error', 'lm-studio')).toBe(
      'lm-studio API server error (500). Please try again later.',
    );
    expect(parse('HTTP 503: Service Unavailable', 'OpenAI')).toBe(
      'OpenAI API server error (503). Please try again later.',
    );
  });

  it('pins the Failed to fetch wording (no label)', () => {
    expect(parse('Failed to fetch', 'lm-studio')).toBe(
      'Cannot connect. Check your Base URL and network.',
    );
  });

  it('pins the fallback wording', () => {
    expect(parse('mystery failure', 'lm-studio')).toBe(
      'Connection error: mystery failure',
    );
  });

  it('pins the timeout wording via message and via AbortError name', () => {
    const golden = 'Connection timed out. Check your network or increase timeout.';
    expect(parse('Request timed out after 30000ms', 'lm-studio')).toBe(golden);
    expect(parse('request timeout exceeded', 'lm-studio')).toBe(golden);
    expect(parse('The operation was aborted', 'lm-studio', 'AbortError')).toBe(
      golden,
    );
  });

  // A status the table does not distinguish (a 4xx that is not 401/403/404/429)
  // used to fall through to the generic sentence, and it must keep doing so:
  // widening the branch set here would change what users read.
  it('pins the generic sentence for an undistinguished 4xx', () => {
    expect(parse('HTTP 400: Bad Request', 'lm-studio')).toBe(
      'Connection error: HTTP 400: Bad Request',
    );
  });

  // The structured kind the caller already resolved is authoritative — a
  // message scan must not overwrite it with a guess.
  it('keeps a caller-supplied kind even when the message reads like a timeout', () => {
    const mapped = mapHttpFetchFailure('HTTP 503: Service Unavailable', 'openai', undefined, {
      kind: 'http',
      status: 503,
    });

    expect(mapped.message).toBe('openai API server error (503). Please try again later.');
    expect(mapped.debug.failure).toEqual({ kind: 'http', status: 503 });
  });
});
