/**
 * RecordingValidator
 * URL validation (SSRF protection) and content truncation.
 *
 * Extracted from recordingLogic.ts (PBI-2026-08-08-01).
 * Pure functions with no state — safe to import from any context.
 */

import { isPrivateIpAddress } from '../utils/fetch.js';

/**
 * Maximum content size for recording (64KB).
 * PII beyond this limit is not sent to AI APIs.
 * Performance: prevents large pages from hanging the pipeline.
 * Cost: limits data volume sent to AI APIs.
 */
export const MAX_RECORD_SIZE = 64 * 1024;

/**
 * Truncate content to maximum size (UTF-8 safe).
 * Uses TextEncoder/TextDecoder to handle multi-byte characters correctly.
 *
 * @param content - Content to truncate
 * @param maxSize - Maximum size in bytes (default: MAX_RECORD_SIZE)
 * @returns Truncated content (original if within limit)
 */
export function truncateContentSize(content: string, maxSize: number = MAX_RECORD_SIZE): string {
  const encoder = new TextEncoder();
  const encoded = encoder.encode(content);

  if (encoded.length <= maxSize) {
    return content;
  }

  const truncated = encoded.slice(0, maxSize);
  const decoder = new TextDecoder('utf-8', { fatal: false });
  return decoder.decode(truncated);
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

    // Reject localhost and loopback addresses
    const hostname = parsed.hostname.toLowerCase();
    if (hostname === 'localhost' || isPrivateIpAddress(hostname)) {
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
