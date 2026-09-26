/**
 * errorClassification-taxonomy.test.ts
 *
 * The structured failure taxonomy (PBI 2026-09-25-11) introduces `kind` for the
 * RETRY decision. It is deliberately not wired into the popup display path, and
 * these tests pin that separation: attaching a kind must never change the
 * ErrorType, the i18n key, or the sentence a user already saw.
 */
import { describe, it, expect } from 'vitest';
import { ErrorType, classifyError, getUserMessage } from '../errorClassification.js';
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

describe('classifyError — display is independent of the structured kind', () => {
  it.each(ALL_KINDS)(
    'attaching a %s carrier leaves the displayed ErrorType unchanged',
    (kind) => {
      // The taxonomy refactor must be invisible to the user. For any message,
      // classifyError(with kind) has to equal classifyError(without kind).
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
        const bare = classifyError(new Error(message));
        const tagged = classifyError(tagFailure(new Error(message), createFailure(kind)));
        expect(tagged).toBe(bare);
      }
    },
  );

  it('leaves the pre-taxonomy Obsidian 401 display on errorNetwork', () => {
    // Before the taxonomy the network branch ran first, so every Obsidian HTTP
    // failure matched on the word "connection" and displayed errorNetwork; the
    // 401/404/429/5xx branches were unreachable for that message. Correcting the
    // wording is filed as its own change, so it must stay as it was here.
    const message = 'Error: Failed to write to daily note. Please check your Obsidian connection.';
    for (const status of [401, 403, 404, 429, 500, 503]) {
      const error = tagFailure(new Error(message), failureFromHttpStatus(status, 'PUT'));
      expect(classifyError(error)).toBe(ErrorType.NETWORK);
    }
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
    'reads status %i as %s even though the display still says network',
    (status, kind) => {
      const message = 'Error: Failed to write to daily note. Please check your Obsidian connection.';
      const error = tagFailure(new Error(message), failureFromHttpStatus(status, 'PUT'));
      // Display and kind disagree on purpose: that disagreement is the bug the
      // taxonomy exists to fix, and it is what the retry path must read.
      expect(classifyError(error)).toBe(ErrorType.NETWORK);
      expect(resolveFailure(error)?.kind).toBe(kind);
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
