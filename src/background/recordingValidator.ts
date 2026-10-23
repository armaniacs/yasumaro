/**
 * RecordingValidator
 * URL validation (SSRF protection) and content truncation.
 *
 * Pure functions with no state — safe to import from any context.
 */

import { isPrivateIpAddress } from '../utils/fetch.js';
import { normalizeHostname } from '../utils/ssrfGuard.js';

/**
 * Maximum content size for recording (64KB).
 * PII beyond this limit is not sent to AI APIs.
 * Performance: prevents large pages from hanging the pipeline.
 * Cost: limits data volume sent to AI APIs.
 */
import { MAX_RECORD_SIZE } from '../utils/limits.js';

/**
 * Outcome of a single-owner truncation pass.
 */
export interface TruncateForRecordingResult {
  readonly content: string;
  readonly truncated: boolean;
  readonly originalBytes: number;
}

/**
 * Single owner of byte truncation: check and cut in one pass.
 * Encodes exactly once, slices at maxSize bytes, and decodes with
 * fatal:false so a trailing partial UTF-8 sequence is replaced,
 * never mojibake.
 *
 * @param content - Content to truncate
 * @param maxSize - Maximum size in bytes (default: MAX_RECORD_SIZE)
 * @returns Truncated content plus truncation metadata
 */
export function truncateForRecording(
  content: string,
  maxSize: number = MAX_RECORD_SIZE
): TruncateForRecordingResult {
  const encoded = new TextEncoder().encode(content);

  if (encoded.length <= maxSize) {
    return { content, truncated: false, originalBytes: encoded.length };
  }

  const truncated = encoded.slice(0, maxSize);
  const decoded = new TextDecoder('utf-8', { fatal: false }).decode(truncated);
  return { content: decoded, truncated: true, originalBytes: encoded.length };
}

/**
 * Truncate content to maximum size (UTF-8 safe).
 * Delegates to the single owner truncateForRecording.
 *
 * @param content - Content to truncate
 * @param maxSize - Maximum size in bytes (default: MAX_RECORD_SIZE)
 * @returns Truncated content (original if within limit)
 */
export function truncateContentSize(content: string, maxSize: number = MAX_RECORD_SIZE): string {
  return truncateForRecording(content, maxSize).content;
}

/**
 * SSRF protection: validate that a URL is safe for fetching.
 * Rejects non-HTTP(S) protocols, localhost, private IPs, and special domains.
 *
 * @param url - URL to validate
 * @returns true if the URL is safe to fetch
 */
export function isValidFetchUrl(url: string): boolean {
  try {
    const parsed = new URL(url);

    // Reject non-HTTP(S) protocols
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }

    // Reject localhost and loopback addresses. normalizeHostname strips the DNS
    // root trailing dot, so `localhost.` cannot slip past the equality check.
    const hostname = normalizeHostname(parsed.hostname);
    if (hostname === 'localhost' || hostname.endsWith('.localhost') || isPrivateIpAddress(hostname)) {
      return false;
    }

    // Reject .internal, .local, and other special domains
    if (hostname.endsWith('.local') || hostname.endsWith('.internal')) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}
