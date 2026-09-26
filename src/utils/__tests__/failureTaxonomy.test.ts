/**
 * Unit: the structured failure taxonomy SSOT.
 *
 * Covers the seven kinds, the per-kind retry contract, HTTP classification,
 * AbortError handling, carrier normalization, and the secret discipline that
 * keeps response bodies / keys / summaries out of the metadata.
 */
import { describe, it, expect } from 'vitest';
import {
  FAILURE_KINDS,
  FAILURE_KEY,
  FailureKind,
  OFFLINE_RECOVERY_KINDS,
  UNSAFE_METHODS,
  allowsImmediateRetry,
  allowsOfflineRecovery,
  allowsOfflineRecoveryFor,
  canResendSameRequest,
  classifyHttpStatus,
  createFailure,
  failureFromHttpStatus,
  isFailureMetadata,
  isTransientHttpStatus,
  readFailure,
  resolveFailure,
  shouldRetryHttpResponse,
  shouldRetryTransportFailure,
  tagFailure,
  withFailure,
  type FailureKindValue,
} from '../failureTaxonomy.js';

describe('failure kinds', () => {
  it('declares exactly the seven kinds, once', () => {
    expect(FAILURE_KINDS).toEqual([
      'network',
      'timeout',
      'http',
      'auth',
      'rate_limit',
      'configuration',
      'csp',
    ]);
    expect(new Set(FAILURE_KINDS).size).toBe(FAILURE_KINDS.length);
  });

  it('marks only network and timeout eligible for offline recovery', () => {
    expect(OFFLINE_RECOVERY_KINDS).toEqual(['network', 'timeout']);
    for (const kind of FAILURE_KINDS) {
      expect(allowsOfflineRecovery(kind)).toBe(kind === 'network' || kind === 'timeout');
    }
  });

  it('excludes auth, rate_limit, configuration and csp from immediate retry', () => {
    for (const kind of ['auth', 'rate_limit', 'configuration', 'csp'] as FailureKindValue[]) {
      expect(allowsImmediateRetry(kind)).toBe(false);
      expect(allowsOfflineRecovery(kind)).toBe(false);
    }
  });

  it('allowsOfflineRecoveryFor tolerates a missing failure', () => {
    expect(allowsOfflineRecoveryFor(null)).toBe(false);
    expect(allowsOfflineRecoveryFor(undefined)).toBe(false);
    expect(allowsOfflineRecoveryFor(failureFromHttpStatus(503))).toBe(false);
    expect(allowsOfflineRecoveryFor(createFailure(FailureKind.TIMEOUT))).toBe(true);
  });
});

describe('classifyHttpStatus', () => {
  it('closes 401 and 403 onto auth', () => {
    expect(classifyHttpStatus(401)).toBe(FailureKind.AUTH);
    expect(classifyHttpStatus(403)).toBe(FailureKind.AUTH);
  });

  it('always closes 429 onto rate_limit, never onto http', () => {
    expect(classifyHttpStatus(429)).toBe(FailureKind.RATE_LIMIT);
    expect(classifyHttpStatus(429)).not.toBe(FailureKind.HTTP);
  });

  it('maps 5xx and other statuses to http', () => {
    for (const status of [400, 404, 422, 500, 502, 503, 504]) {
      expect(classifyHttpStatus(status)).toBe(FailureKind.HTTP);
    }
  });

  it('separates transient from terminal statuses', () => {
    expect(isTransientHttpStatus(503)).toBe(true);
    expect(isTransientHttpStatus(429)).toBe(false);
    expect(isTransientHttpStatus(404)).toBe(false);
    expect(isTransientHttpStatus(600)).toBe(false);
  });
});

describe('failureFromHttpStatus', () => {
  it('keeps status and method, upper-casing the method', () => {
    expect(failureFromHttpStatus(401, 'put')).toEqual({ kind: 'auth', status: 401, method: 'PUT' });
  });

  it('omits method when unknown', () => {
    expect(failureFromHttpStatus(429)).toEqual({ kind: 'rate_limit', status: 429 });
  });
});

describe('createFailure', () => {
  it('keeps only the cause name, never the cause message', () => {
    const cause = new TypeError('Failed to fetch: sk-abcdef123456 body: {"token":"x"}');
    const failure = createFailure(FailureKind.NETWORK, { cause });

    expect(failure).toEqual({ kind: 'network', cause: { name: 'TypeError' } });
    expect(JSON.stringify(failure)).not.toContain('sk-abcdef123456');
    expect(JSON.stringify(failure)).not.toContain('token');
  });

  it('omits cause entirely when the value carries no name', () => {
    expect(createFailure(FailureKind.NETWORK, { cause: 'plain string' })).toEqual({ kind: 'network' });
  });
});

describe('carriers', () => {
  it('tags a thrown Error without touching its message', () => {
    const error = new Error('Error: Request timed out. Please check your Obsidian connection.');
    const returned = tagFailure(error, createFailure(FailureKind.TIMEOUT));

    expect(returned).toBe(error);
    expect(error.message).toBe('Error: Request timed out. Please check your Obsidian connection.');
    expect(readFailure(error)).toEqual({ kind: 'timeout' });
  });

  it('attaches metadata to a plain result summary', () => {
    const result = withFailure({ success: false, summary: 'Error: nope' }, createFailure(FailureKind.AUTH));
    expect(result).toEqual({ success: false, summary: 'Error: nope', failure: { kind: 'auth' } });
    expect(resolveFailure(result)).toEqual({ kind: 'auth' });
  });

  it('reads back the same metadata for both carrier shapes', () => {
    const failure = failureFromHttpStatus(429, 'PUT');
    const thrown = tagFailure(new Error('Error: Failed to write to daily note.'), failure);
    const result = withFailure({ success: false, summary: 'Error: ...' }, failure);

    expect(resolveFailure(thrown)).toEqual(failure);
    expect(resolveFailure(result)).toEqual(failure);
  });

  it('ignores a malformed failure field', () => {
    expect(isFailureMetadata({ kind: 'made-up' })).toBe(false);
    expect(readFailure({ [FAILURE_KEY]: { kind: 'nope' } })).toBeNull();
    expect(resolveFailure({ [FAILURE_KEY]: { kind: 'nope' } })).toBeNull();
  });

  it('returns null for non-carriers', () => {
    expect(readFailure(null)).toBeNull();
    expect(readFailure('Error: boom')).toBeNull();
    expect(resolveFailure(undefined)).toBeNull();
  });
});

describe('resolveFailure', () => {
  it('maps the AbortError name to timeout', () => {
    const abort = new Error('Request timed out after 15000ms');
    abort.name = 'AbortError';

    expect(resolveFailure(abort)).toEqual({ kind: 'timeout', cause: { name: 'AbortError' } });
  });

  it('maps the NetworkError name to network', () => {
    const network = new Error('The network connection was lost.');
    network.name = 'NetworkError';

    expect(resolveFailure(network)).toEqual({ kind: 'network', cause: { name: 'NetworkError' } });
  });

  it('reads AbortError on a DOMException-shaped carrier', () => {
    const domLike = Object.assign(new Error('aborted'), { name: 'AbortError' });
    expect(resolveFailure(domLike)?.kind).toBe('timeout');
  });

  it('walks the cause chain to the tagged error', () => {
    const inner = tagFailure(new Error('inner'), createFailure(FailureKind.AUTH, { status: 403 }));
    const outer = new Error('outer', { cause: inner });

    expect(resolveFailure(outer)).toEqual({ kind: 'auth', status: 403 });
  });

  it('walks the cause chain to an AbortError', () => {
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    const outer = new Error('outer', { cause: abort });

    expect(resolveFailure(outer)?.kind).toBe('timeout');
  });

  it('stops on a cyclic cause chain', () => {
    const a = new Error('a');
    const b = new Error('b', { cause: a });
    (a as { cause?: unknown }).cause = b;

    expect(resolveFailure(a)).toBeNull();
  });

  it('returns null for a message-only error (no message signal in the contract)', () => {
    expect(resolveFailure(new Error('Failed to connect to Obsidian.'))).toBeNull();
    expect(resolveFailure(new Error('network'))).toBeNull();
  });
});

describe('canResendSameRequest', () => {
  it('refuses every unsafe method for a retryable kind', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'put', 'delete']) {
      expect(canResendSameRequest(FailureKind.HTTP, method)).toBe(false);
    }
  });

  it('allows safe methods and an unknown method', () => {
    for (const method of ['GET', 'HEAD', 'get', '']) {
      expect(canResendSameRequest(FailureKind.HTTP, method)).toBe(true);
    }
    expect(canResendSameRequest(FailureKind.HTTP)).toBe(true);
  });

  it('refuses kinds that are not re-sendable at all', () => {
    expect(canResendSameRequest(FailureKind.RATE_LIMIT, 'GET')).toBe(false);
    expect(canResendSameRequest(FailureKind.AUTH, 'GET')).toBe(false);
  });

  it('names the four unsafe methods of the reliability guideline', () => {
    expect([...UNSAFE_METHODS].sort()).toEqual(['DELETE', 'PATCH', 'POST', 'PUT']);
  });
});

describe('retry predicates', () => {
  it('never retries a 429', () => {
    expect(shouldRetryHttpResponse(429, 'GET')).toBe(false);
    expect(shouldRetryHttpResponse(429, 'POST')).toBe(false);
  });

  it('never retries 401 or 403', () => {
    expect(shouldRetryHttpResponse(401)).toBe(false);
    expect(shouldRetryHttpResponse(403)).toBe(false);
  });

  it('retries a 5xx only on a safe method', () => {
    expect(shouldRetryHttpResponse(503, 'GET')).toBe(true);
    expect(shouldRetryHttpResponse(503, 'PUT')).toBe(false);
    expect(shouldRetryHttpResponse(503, 'PATCH')).toBe(false);
    expect(shouldRetryHttpResponse(503, 'DELETE')).toBe(false);
  });

  it('does not retry a terminal 4xx', () => {
    expect(shouldRetryHttpResponse(404, 'GET')).toBe(false);
    expect(shouldRetryHttpResponse(422, 'POST')).toBe(false);
  });

  it('retries a timeout once and a network error every time', () => {
    const abort = new Error('Request timed out after 15000ms');
    abort.name = 'AbortError';
    const network = tagFailure(new TypeError('Failed to fetch'), createFailure(FailureKind.NETWORK));

    expect(shouldRetryTransportFailure(abort, 1)).toBe(true);
    expect(shouldRetryTransportFailure(abort, 2)).toBe(false);
    expect(shouldRetryTransportFailure(network, 1)).toBe(true);
    expect(shouldRetryTransportFailure(network, 5)).toBe(true);
  });

  it('refuses a thrown HTTP status that carries the http kind', () => {
    const httpFailure = tagFailure(new Error('HTTP 400: Bad Request'), failureFromHttpStatus(400, 'GET'));
    expect(shouldRetryTransportFailure(httpFailure, 1)).toBe(false);
  });

  it('falls back to legacy markers only for untagged inputs', () => {
    expect(shouldRetryTransportFailure(new Error('fetch failed'), 1)).toBe(true);
    expect(shouldRetryTransportFailure(new Error('Request timed out after 30000ms'), 1)).toBe(true);
    expect(shouldRetryTransportFailure(new Error('nope'), 1)).toBe(false);
  });
});
