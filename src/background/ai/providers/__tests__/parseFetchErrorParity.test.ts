/**
 * parseFetchErrorParity.test.ts
 * PBI 2026-09-17-11 step 1: golden-pin the CURRENT parse-path wording BEFORE
 * migrating the table into describeHttpFailure. Every expectation is a
 * byte-identical copy of AIProviderStrategy.parseAndMapFetchError output.
 * Rewording any of them is a separate product decision — this file must stay
 * green through the delegation refactor.
 */
import { describe, it, expect } from 'vitest';
import type { Settings } from '../../../../utils/storage/types.js';
import {
  AIProviderStrategy,
  type AIProviderConnectionResult,
  type AISummaryResult,
} from '../ProviderStrategy.js';

class ParityProbe extends AIProviderStrategy {
  async generateSummary(): Promise<AISummaryResult> {
    return { success: true, summary: 'probe' };
  }

  async testConnection(): Promise<AIProviderConnectionResult> {
    return { success: true, message: 'probe' };
  }

  getName(): string {
    return 'parity-probe';
  }

  callParse(msg: string, label: string, name?: string): AIProviderConnectionResult {
    return this.parseAndMapFetchError(msg, label, name);
  }
}

function probe(): ParityProbe {
  return new ParityProbe({} as Settings);
}

describe('parseAndMapFetchError parity (pre-migration golden)', () => {
  it('pins the 401/403 wording with the caller-supplied label', () => {
    expect(probe().callParse('HTTP 401: Unauthorized', 'lm-studio').message).toBe(
      'Invalid API key (401). Check your lm-studio API key settings.',
    );
    expect(probe().callParse('HTTP 403: Forbidden', 'lm-studio').message).toBe(
      'Invalid API key (403). Check your lm-studio API key settings.',
    );
  });

  it('pins the 404 wording (no label)', () => {
    expect(probe().callParse('HTTP 404: Not Found', 'lm-studio').message).toBe(
      'Model or endpoint not found (404). Check your Base URL.',
    );
  });

  it('pins the 429 wording (no label)', () => {
    expect(probe().callParse('HTTP 429: Too Many Requests', 'lm-studio').message).toBe(
      'Rate limit exceeded (429). Please try again later.',
    );
  });

  it('pins the 5xx wording with the caller-supplied label', () => {
    expect(probe().callParse('HTTP 500: Internal Server Error', 'lm-studio').message).toBe(
      'lm-studio API server error (500). Please try again later.',
    );
    expect(probe().callParse('HTTP 503: Service Unavailable', 'OpenAI').message).toBe(
      'OpenAI API server error (503). Please try again later.',
    );
  });

  it('pins the Failed to fetch wording (no label)', () => {
    expect(probe().callParse('Failed to fetch', 'lm-studio').message).toBe(
      'Cannot connect. Check your Base URL and network.',
    );
  });

  it('pins the fallback wording', () => {
    expect(probe().callParse('mystery failure', 'lm-studio').message).toBe(
      'Connection error: mystery failure',
    );
  });

  it('pins the timeout wording via message and via AbortError name', () => {
    const golden = 'Connection timed out. Check your network or increase timeout.';
    expect(probe().callParse('Request timed out after 30000ms', 'lm-studio').message).toBe(golden);
    expect(probe().callParse('request timeout exceeded', 'lm-studio').message).toBe(golden);
    expect(probe().callParse('The operation was aborted', 'lm-studio', 'AbortError').message).toBe(
      golden,
    );
  });
});
