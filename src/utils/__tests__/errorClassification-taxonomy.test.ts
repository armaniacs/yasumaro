/**
 * errorClassification-taxonomy.test.ts
 *
 * The structured failure taxonomy (PBI 2026-09-25-11) introduces `kind` for the
 * RETRY decision. PBI 2026-09-25-32 wired the kind into the display vocabulary
 * through FAILURE_KIND_TO_ERROR_TYPE: a carrier with a structured kind is
 * classified by its kind, so an Obsidian 401/403 displays errorAuth, a 429
 * errorRateLimit, and a 404 or 5xx errorServer. Carriers without a kind keep
 * the message-based classification they had before the taxonomy.
 */
import { describe, it, expect } from 'vitest';
import {
  ErrorType,
  FAILURE_KIND_TO_ERROR_TYPE,
  classifyError,
  getErrorI18nKey,
  getUserMessage,
} from '../errorClassification.js';
import {
  createFailure,
  failureFromHttpStatus,
  resolveFailure,
  tagFailure,
  type FailureKindValue,
} from '../failureTaxonomy.js';

const ALL_KINDS: FailureKindValue[] = [
  'network',
  'timeout',
  'http',
  'auth',
  'rate_limit',
  'configuration',
  'csp',
];

describe('classifyError — a structured kind routes the display vocabulary', () => {
  it.each(ALL_KINDS)(
    'attaching a %s carrier classifies the display by the kind table',
    (kind) => {
      // The kind is the sanitized, message-independent signal: whatever the
      // message says, a tagged carrier must classify through the declared
      // kind→ErrorType table (PBI 2026-09-25-32).
      const messages = [
        'Error: Failed to write to daily note. Please check your Obsidian connection.',
        'network error',
        'invalid api key',
        '429 rate limit',
        '500 internal server error',
        'mystery',
        '',
      ];
      for (const message of messages) {
        const tagged = classifyError(tagFailure(new Error(message), createFailure(kind)));
        expect(tagged).toBe(FAILURE_KIND_TO_ERROR_TYPE[kind]);
      }
    },
  );

  it('classifies the pre-taxonomy Obsidian statuses into the right display keys', async () => {
    // Before PBI 2026-09-25-32 the network branch ran first, so every Obsidian
    // HTTP failure matched on the word "connection" and displayed errorNetwork.
    // The kind now routes the display: 401/403 → auth, 429 → rate limit,
    // 404 and 5xx → server. All four keys predate the fix; no new key is added.
    const expected: Array<[number, string, string]> = [
      [401, ErrorType.AUTH, 'errorAuth'],
      [403, ErrorType.AUTH, 'errorAuth'],
      [429, ErrorType.RATE_LIMIT, 'errorRateLimit'],
      [404, ErrorType.SERVER, 'errorServer'],
      [500, ErrorType.SERVER, 'errorServer'],
      [503, ErrorType.SERVER, 'errorServer'],
    ];
    const message = 'Error: Failed to write to daily note. Please check your Obsidian connection.';
    for (const [status, errorType, i18nKey] of expected) {
      const error = tagFailure(new Error(message), failureFromHttpStatus(status, 'PUT'));
      expect(classifyError(error)).toBe(errorType);
      expect(getErrorI18nKey(classifyError(error))).toBe(i18nKey);
    }
  });

  it('keeps transport failures on errorNetwork so they are never misread as auth', () => {
    const error = tagFailure(new Error('Failed to fetch'), createFailure('network'));
    expect(classifyError(error)).toBe(ErrorType.NETWORK);
    expect(getErrorI18nKey(ErrorType.NETWORK)).toBe('errorNetwork');
  });

  it('still classifies a 401 that names the status, as it did before', () => {
    expect(classifyError(new Error('401 unauthorized'))).toBe(ErrorType.AUTH);
  });

  it('keeps the source-based popup branch', () => {
    expect(classifyError({ source: 'network' })).toBe(ErrorType.NETWORK);
    expect(classifyError({ source: 'obsidian' })).toBe(ErrorType.SERVER);
  });

  it('leaves the message fallback for carriers with no structured kind', () => {
    expect(classifyError(new Error('network error'))).toBe(ErrorType.NETWORK);
    expect(classifyError(new Error('401 unauthorized'))).toBe(ErrorType.AUTH);
    expect(classifyError(new Error('429 rate limit'))).toBe(ErrorType.RATE_LIMIT);
    expect(classifyError(new Error('mystery'))).toBe(ErrorType.UNKNOWN);
  });
});

describe('the kind stays correct for the retry decision', () => {
  it.each([
    [401, 'auth'],
    [403, 'auth'],
    [429, 'rate_limit'],
    [404, 'http'],
    [500, 'http'],
    [503, 'http'],
  ] as Array<[number, FailureKindValue]>)(
    'reads status %i as %s and the display now agrees with the kind',
    (status, kind) => {
      const message = 'Error: Failed to write to daily note. Please check your Obsidian connection.';
      const error = tagFailure(new Error(message), failureFromHttpStatus(status, 'PUT'));
      expect(resolveFailure(error)?.kind).toBe(kind);
      expect(classifyError(error)).toBe(FAILURE_KIND_TO_ERROR_TYPE[kind]);
    },
  );
});

describe('classifyError — user message parity', () => {
  it('keeps the fallback sentences of the legacy vocabulary', () => {
    expect(getUserMessage(new Error('network error'))).toBe('A network error occurred.');
    expect(getUserMessage(new Error('invalid api key'))).toBe('An authentication error occurred.');
    expect(getUserMessage(new Error('429 rate limit'))).toBe('Request limit reached.');
    expect(getUserMessage(new Error('500 internal server error'))).toBe('A server error occurred.');
    expect(getUserMessage(new Error('mystery'))).toBe('An error occurred.');
  });

  it('a csp rejection keeps the generic sentence it has always produced', () => {
    const error = tagFailure(new Error('URL blocked by CSP policy: https://x'), createFailure('csp'));
    expect(getUserMessage(error)).toBe('An error occurred.');
  });
});

describe('failure metadata — secret discipline', () => {
  it('never stores an API key, a response body, or a summary body', () => {
    const apiKey = 'sk-live-DO-NOT-LEAK-0001';
    const body = '{"error":"invalid key","token":"abc"}';
    const summary = 'Error: Failed to generate summary. Please try again or check your settings.';

    const failure = failureFromHttpStatus(401, 'PUT');
    const error = tagFailure(new Error(`${summary} ${body} ${apiKey}`), failure);

    const serialized = JSON.stringify(failure);
    expect(serialized).not.toContain(apiKey);
    expect(serialized).not.toContain(body);
    expect(serialized).not.toContain(summary);
    expect(serialized).toBe(JSON.stringify({ kind: 'auth', status: 401, method: 'PUT' }));
    // The Error still carries its own message (display path) — the metadata
    // channel is the one that must stay clean.
    expect(error.message).toContain(apiKey);
  });

  it('reduces a cause to its name', () => {
    const failure = createFailure('network', {
      cause: new TypeError('fetch failed with sk-live-CAUSE-0002'),
    });
    expect(failure).toEqual({ kind: 'network', cause: { name: 'TypeError' } });
    expect(JSON.stringify(failure)).not.toContain('sk-live-CAUSE-0002');
  });
});
