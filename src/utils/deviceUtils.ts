/**
 * Device detection utilities.
 *
 * In Service Worker context, use `getPlatformOs()` which prefers
 * `chrome.runtime.getPlatformInfo()` but falls back to `navigator.userAgent`
 * when the API is unavailable or hasn't resolved yet.
 */

let _cachedOs: string | null = null;
let _resolvePromise: Promise<string> | null = null;

/**
 * Return the platform OS string (e.g. 'android', 'ios', 'mac', 'win', 'cros').
 *
 * - First call initiates async fetch via `chrome.runtime.getPlatformInfo()` and
 *   falls back synchronously to `navigator.userAgent` heuristics.
 * - Subsequent calls return the cached value.
 */
export function getPlatformOs(): string {
  if (_cachedOs) return _cachedOs;

  // Try Chrome API first (async — kicks off but may not resolve immediately)
  if (typeof chrome?.runtime?.getPlatformInfo === 'function') {
    if (!_resolvePromise) {
      _resolvePromise = chrome.runtime.getPlatformInfo().then((info) => {
        _cachedOs = info.os;
        return _cachedOs;
      }).catch(() => {
        _cachedOs = 'unknown';
        return _cachedOs;
      });
    }
  }

  // Synchronous fallback using navigator.userAgent
  _cachedOs = detectOsFromUserAgent(navigator.userAgent);
  return _cachedOs;
}

/**
 * Detect platform OS from a User-Agent string.
 */
export function detectOsFromUserAgent(userAgent: string): string {
  if (/Android/i.test(userAgent)) return 'android';
  if (/iPhone|iPad|iPod/i.test(userAgent)) return 'ios';
  if (/Windows|IEMobile|Trident/i.test(userAgent)) return 'win';
  if (/Macintosh|Mac OS X/i.test(userAgent)) return 'mac';
  if (/CrOS|Chromebook/i.test(userAgent)) return 'cros';
  if (/Linux/i.test(userAgent)) return 'linux';
  return 'unknown';
}

/**
 * Detect whether the given User-Agent belongs to a mobile device.
 * Prefer `getPlatformOs()` in Service Worker context.
 */
export function isMobileUserAgent(userAgent: string): boolean {
  return /Android|iPhone|iPad|iPod|Mobile|IEMobile|Opera Mini/i.test(userAgent);
}

/** @internal Reset the cached platform OS (for testing). */
export function resetPlatformOsCache(): void {
  _cachedOs = null;
  _resolvePromise = null;
}
