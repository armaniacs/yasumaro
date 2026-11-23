// Pure helpers for optimistic concurrency on the daily note PUT.
import type { FailureMetadata } from './failureTaxonomy.js';

/** The rewrite after a conflict happens at most once; a second 412 stays a conflict. */
export const MAX_CONFLICT_REWRITES = 1;

const PRECONDITION_FAILED = 412;

/**
 * Runtime detection: a usable validator is a non-empty strong ETag on the GET
 * response. A weak validator (`W/"..."`) never matches under If-Match's strong
 * comparison, so sending it would turn every save into a false conflict; it is
 * treated the same as "no ETag" and the write stays unconditional.
 */
export function detectStrongEtag(headers: Pick<Headers, 'get'> | undefined | null): string | null {
  const raw = headers?.get('ETag');
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (value.length === 0 || /^w\//i.test(value)) return null;
  return value;
}

export function withIfMatch(headers: HeadersInit, etag: string | null): HeadersInit {
  if (etag === null) return headers;
  const merged = new Headers(headers);
  merged.set('If-Match', etag);
  return merged;
}

export function isPreconditionConflict(failure: FailureMetadata | null | undefined): boolean {
  return failure?.status === PRECONDITION_FAILED && failure.method === 'PUT';
}

export type ConflictRewriteDecision = 'rewrite' | 'exhausted' | 'not-conflict';

export function decideConflictRewrite(
  failure: FailureMetadata | null | undefined,
  rewritesDone: number,
): ConflictRewriteDecision {
  if (!isPreconditionConflict(failure)) return 'not-conflict';
  return rewritesDone < MAX_CONFLICT_REWRITES ? 'rewrite' : 'exhausted';
}
