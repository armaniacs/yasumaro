import { describe, it, expect } from 'vitest';
import { tagFailure, FailureKind, createFailure } from '../failureTaxonomy.js';
import {
  describeHttpFailure,
  describeSummaryRequestFailure,
  isHttpTimeoutFailure,
  mapHttpConnectionFailure,
  mapHttpFetchFailure,
} from '../httpFailureMessages.js';

/**
 * Parity pins for the status→message SSOT refactor (PBI 2026-09-17-09).
 * Every expectation is a byte-identical copy of a pre-refactor call-site
 * string; rewording any of them is a product decision for a separate change.
 */
describe('describeHttpFailure parity', () => {
  it('reproduces the connection-test wording', () => {
    expect(describeHttpFailure(401, 'Gemini')).toBe(
      'Authentication failed (401). Check your Gemini API key.',
    );
    expect(describeHttpFailure(403, 'OpenAI')).toBe(
      'Authentication failed (403). Check your OpenAI API key.',
    );
    expect(describeHttpFailure(404, 'Gemini')).toBe(
      'Endpoint not found (404). Check your Base URL.',
    );
    expect(describeHttpFailure(429, 'Gemini')).toBe(
      'Rate limit exceeded (429). Please try again later.',
    );
    expect(describeHttpFailure(500, 'Gemini')).toBe('Gemini API Error: 500');
    expect(describeHttpFailure(503, 'OpenAI')).toBe('OpenAI API Error: 503');
  });

  it('reproduces obsidianClient.testConnection wording', () => {
    expect(describeHttpFailure(401, 'Obsidian')).toBe(
      'Authentication failed (401). Check your API key.',
    );
    expect(describeHttpFailure(403, 'Obsidian')).toBe(
      'Authentication failed (403). Check your API key.',
    );
    expect(describeHttpFailure(404, 'Obsidian')).toBe(
      'Endpoint not found (404). Is Local REST API plugin enabled?',
    );
  });

  it('reproduces gistSyncTarget.testConnection wording', () => {
    expect(describeHttpFailure(401, 'GitHub')).toBe(
      'Invalid GitHub PAT (unauthorized)',
    );
    expect(describeHttpFailure(404, 'GitHub')).toBe('GitHub API error: 404');
    expect(describeHttpFailure(429, 'GitHub')).toBe('GitHub API error: 429');
    expect(describeHttpFailure(500, 'GitHub')).toBe('GitHub API error: 500');
  });
});

/**
 * The connection envelope the provider base used to build inline. Same
 * expectations, new owner — the wording and the kind travel together, so a
 * sentence can no longer be picked without the classification the breaker
 * branches on.
 */
describe('mapHttpConnectionFailure', () => {
  it('maps a status to the connection wording and its kind', () => {
    const mapped = mapHttpConnectionFailure(401, 'Gemini');

    expect(mapped).toEqual({
      success: false,
      message: 'Authentication failed (401). Check your Gemini API key.',
      debug: { statusCode: 401, failure: { kind: 'auth', status: 401 } },
    });
  });

  it('reports a rate limit as rate_limit, not as a generic http', () => {
    expect(mapHttpConnectionFailure(429, 'OpenAI').debug.failure?.kind).toBe(FailureKind.RATE_LIMIT);
  });

  it('reports a server error as http', () => {
    expect(mapHttpConnectionFailure(500, 'Gemini').debug.failure?.kind).toBe(FailureKind.HTTP);
  });

  it('never carries the response body or key material', () => {
    const serialized = JSON.stringify(mapHttpConnectionFailure(401, 'Gemini'));

    expect(serialized).not.toContain('sk-');
    expect(Object.keys(mapHttpConnectionFailure(401, 'Gemini').debug)).toEqual(['statusCode', 'failure']);
  });
});

describe('isHttpTimeoutFailure', () => {
  it('reads the AbortError name, which is environment-independent', () => {
    expect(isHttpTimeoutFailure('AbortError', 'anything at all')).toBe(true);
  });

  it('reads both timeout spellings, so the two AI flows cannot disagree', () => {
    expect(isHttpTimeoutFailure(undefined, 'Request timed out after 30000ms')).toBe(true);
    expect(isHttpTimeoutFailure(undefined, 'request timeout exceeded')).toBe(true);
  });

  it('is not a general "the word failure appears" check', () => {
    expect(isHttpTimeoutFailure('TypeError', 'Failed to fetch')).toBe(false);
    expect(isHttpTimeoutFailure(undefined, 'HTTP 503: Service Unavailable')).toBe(false);
  });
});

describe('describeSummaryRequestFailure', () => {
  it('times out on an AbortError and keeps the structured kind', () => {
    const abort = tagFailure(
      Object.assign(new Error('Request timed out after 30000ms'), { name: 'AbortError' }),
      createFailure(FailureKind.TIMEOUT),
    );

    expect(describeSummaryRequestFailure(abort)).toEqual({
      success: false,
      summary: 'Error: AI request timed out. Please check your connection.',
      error: 'Request timed out after 30000ms',
      failure: { kind: 'timeout' },
    });
  });

  it('falls back to a timeout kind when the carrier carries none', () => {
    const abort = new Error('The operation was aborted');
    abort.name = 'AbortError';

    expect(describeSummaryRequestFailure(abort).failure).toEqual({
      kind: 'timeout',
      cause: { name: 'AbortError' },
    });
  });

  it('keeps the caller-resolved kind for an HTTP failure and never names the status in the summary', () => {
    const http = tagFailure(new Error('HTTP 503: Service Unavailable'), createFailure(FailureKind.HTTP, { status: 503 }));

    const result = describeSummaryRequestFailure(http);

    expect(result.summary).toBe('Error: Failed to generate summary. Please try again or check your settings.');
    expect(result.summary).not.toContain('503');
    expect(result.error).toBe('HTTP 503: Service Unavailable');
    expect(result.failure).toEqual({ kind: 'http', status: 503 });
  });

  it('attaches no kind to a failure it cannot classify', () => {
    const result = describeSummaryRequestFailure(new Error('mystery failure'));

    expect(result.failure).toBeUndefined();
    expect(result.summary).toBe('Error: Failed to generate summary. Please try again or check your settings.');
  });

  // The summary is persisted as page content and the detail is rendered in a
  // diagnostics trail, so a provider echoing a whole body must not ride along
  // in either.
  it('truncates the diagnostic detail', () => {
    const result = describeSummaryRequestFailure(new Error('x'.repeat(5000)));

    expect(result.error).toHaveLength(300);
  });

  // The reason the predicate is shared: the same transport failure used to be
  // classified twice, and the two sites read different words. Whatever the
  // carrier, both flows must now call it a timeout or neither.
  it('the summary flow and the connection test agree on every carrier', () => {
    const carriers: Array<{ name: string; message: string; errorName?: string }> = [
      { name: 'transport timeout', message: 'Request timed out after 30000ms', errorName: 'AbortError' },
      { name: 'bare abort', message: 'The operation was aborted', errorName: 'AbortError' },
      { name: 'message-only timeout', message: 'request timeout exceeded' },
      { name: 'network failure', message: 'Failed to fetch', errorName: 'TypeError' },
      { name: 'http status', message: 'HTTP 503: Service Unavailable' },
      { name: 'unclassified', message: 'mystery failure' },
    ];

    for (const carrier of carriers) {
      const summarySaysTimeout = describeSummaryRequestFailure(
        Object.assign(new Error(carrier.message), { name: carrier.errorName }),
      ).summary.includes('timed out');
      const testSaysTimeout = mapHttpFetchFailure(
        carrier.message,
        'openai',
        carrier.errorName,
      ).message.includes('timed out');

      expect(testSaysTimeout, `connection test disagrees on: ${carrier.name}`).toBe(summarySaysTimeout);
    }
  });
});
