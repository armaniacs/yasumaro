import { describe, it, expect } from 'vitest';
import { describeHttpFailure } from '../httpFailureMessages.js';

/**
 * Parity pins for the status→message SSOT refactor (PBI 2026-09-17-09).
 * Every expectation is a byte-identical copy of a pre-refactor call-site
 * string; rewording any of them is a product decision for a separate change.
 */
describe('describeHttpFailure parity', () => {
  it('reproduces ProviderStrategy.mapConnectionError wording', () => {
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
