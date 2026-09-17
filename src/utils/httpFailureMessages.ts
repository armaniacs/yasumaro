// @layer 0 — Foundation: HTTP status → user-facing failure message table
/**
 * Single table mapping an HTTP status to the user-facing failure message.
 *
 * The three connection-test call sites historically diverged in wording for the
 * same status, so the table carries legacy-compat presets keyed by conventional
 * domain labels ('Obsidian', 'GitHub'); every other label uses the generic
 * provider-style template. Callers delegate only the statuses they currently
 * distinguish — unifying the wording itself is a separate product decision and
 * out of scope for the SSOT refactor, so these presets must stay byte-identical.
 *
 * The fetch-throw path (`AIProviderStrategy.parseAndMapFetchError`) historically
 * carried its own copy of this table with different wording (e.g. 401 is
 * `Invalid API key...` here vs `Authentication failed...` on the connection
 * path). That copy now lives behind `variant: 'parse'` so both tables share one
 * definition site without unifying the wording itself — the parse preset must
 * also stay byte-identical to the pre-migration parse wording. The parse preset
 * intentionally ignores the Obsidian/GitHub domain presets: the parse path
 * never branched on them, so every label uses the generic template.
 */
/** Known legacy-compat presets; any other label uses the generic template. */
export type HttpFailureDomain = 'Obsidian' | 'GitHub' | (string & {});

export function describeHttpFailure(
  status: number,
  domainLabel: HttpFailureDomain,
  variant: 'connection' | 'parse' = 'connection',
): string {
  if (variant === 'parse') {
    if (status === 401 || status === 403) {
      return `Invalid API key (${status}). Check your ${domainLabel} API key settings.`;
    }
    if (status === 404) {
      return 'Model or endpoint not found (404). Check your Base URL.';
    }
    if (status === 429) {
      return 'Rate limit exceeded (429). Please try again later.';
    }
    return `${domainLabel} API server error (${status}). Please try again later.`;
  }
  if (status === 401 || status === 403) {
    if (domainLabel === 'Obsidian') {
      return `Authentication failed (${status}). Check your API key.`;
    }
    if (domainLabel === 'GitHub') {
      return 'Invalid GitHub PAT (unauthorized)';
    }
    return `Authentication failed (${status}). Check your ${domainLabel} API key.`;
  }
  if (status === 404) {
    if (domainLabel === 'Obsidian') {
      return 'Endpoint not found (404). Is Local REST API plugin enabled?';
    }
    if (domainLabel === 'GitHub') {
      return 'GitHub API error: 404';
    }
    return 'Endpoint not found (404). Check your Base URL.';
  }
  if (domainLabel === 'GitHub') {
    return `GitHub API error: ${status}`;
  }
  if (status === 429) {
    return 'Rate limit exceeded (429). Please try again later.';
  }
  return `${domainLabel} API Error: ${status}`;
}
