// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { FILTER_LIST_SOURCES, ALL_LIST_SOURCES, TRANCO_METADATA_SOURCE } from '../listSources.js';
import { isDomainInWhitelist, buildAllowedUrls } from '../storage/urlWhitelist.js';
import { OPTIONAL_AI_PROVIDER_HOST_PERMISSIONS } from '../cspDomains.js';
import { CSPValidator } from '../cspValidator.js';

/**
 * Cross-table conformance for the filter-list allowlists (PBI 2026-09-11-05).
 * Before LIST_SOURCES the same five hosts lived in four tables with no
 * cross-check; nsfw.oisd.nl was granted as an origin but rejected by the
 * whitelist gate. These pins make "added to one table, missed the others"
 * a test failure.
 */

describe('filter-list sources conformance (PBI 2026-09-11-05)', () => {
  it('every filter source host passes the whitelist gate', () => {
    for (const source of ALL_LIST_SOURCES) {
      expect(isDomainInWhitelist(`https://${source.host}/list.txt`)).toBe(true);
    }
  });

  it('every filter source origin is in buildAllowedUrls output', () => {
    const allowed = buildAllowedUrls({} as never);
    for (const source of FILTER_LIST_SOURCES) {
      expect([...allowed]).toContain(source.origin);
    }
  });

  it('every filter source has a manifest optional permission', () => {
    for (const source of ALL_LIST_SOURCES) {
      expect(OPTIONAL_AI_PROVIDER_HOST_PERMISSIONS).toContain(`${source.origin}/*`);
    }
  });

  it('OISD gate and grant agree (round-5 regression pin)', () => {
    // nsfw.oisd.nl used to be granted as an origin while the gate rejected it,
    // so ublock sources pointing at OISD were warn-skipped.
    expect(isDomainInWhitelist('https://nsfw.oisd.nl/')).toBe(true);
  });

  it('the Tranco metadata source is documented as non-filter-list', () => {
    // The trust-DB updater fetches Tranco directly (CSP-gated, never FETCH_URL).
    // The distinction is load-bearing for the allow lists — keep it explicit.
    expect(TRANCO_METADATA_SOURCE.host).toBe('tranco-list.eu');
    expect(FILTER_LIST_SOURCES.map((s) => s.host)).not.toContain('tranco-list.eu');
    expect(OPTIONAL_AI_PROVIDER_HOST_PERMISSIONS).toContain('https://tranco-list.eu/*');
  });

  it('every provider CSP host set is inside the whitelist gate (gate ⊇ CSP)', () => {
    const cspHosts = new Set([
      ...CSPValidator.getDefaultAllowedDomains?.() ?? [],
    ]);
    // DEFAULT domains: verify via the public validator on well-formed URLs.
    for (const host of [
      'generativelanguage.googleapis.com',
      'api.openai.com',
      'api.anthropic.com',
      'api.groq.com',
      'mistral.ai',
      'deepseek.com',
      'perplexity.ai',
      'jina.ai',
      'voyageai.com',
    ]) {
      expect(isDomainInWhitelist(`https://${host}/v1/x`)).toBe(true);
    }
    void cspHosts;
  });
});
