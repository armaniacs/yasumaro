/**
 * browserSupport.ts
 * Feature detection for browser-specific APIs.
 * Ensures graceful fallback when running in non-Chrome Chromium browsers (Edge, Brave, etc.).
 */

/**
 * Check if the browser supports the built-in AI API (window.ai).
 * Currently only available in Chrome Dev/Canary with specific flags.
 */
export function supportsBuiltInAI(): boolean {
  return typeof globalThis !== 'undefined' &&
    'ai' in globalThis &&
    typeof (globalThis as any).ai?.languageModel !== 'undefined';
}

/**
 * Check if the browser supports the side panel API.
 * Available in Chrome 114+ and Edge 114+.
 */
export function supportsSidePanel(): boolean {
  return typeof chrome !== 'undefined' &&
    'sidePanel' in chrome;
}

/**
 * Check if the browser supports the offscreen document API.
 * Available in Chrome 109+ and Edge 109+.
 */
export function supportsOffscreen(): boolean {
  return typeof chrome !== 'undefined' &&
    'offscreen' in chrome;
}

/**
 * Check if the browser supports the favicon API.
 * Available in Chrome 121+ and Edge 121+.
 */
export function supportsFavicon(): boolean {
  return typeof chrome !== 'undefined' &&
    'favicon' in chrome &&
    typeof chrome.runtime !== 'undefined' &&
    typeof chrome.runtime.getURL !== 'undefined';
}

/**
 * Get the current browser name based on user agent.
 */
export function getBrowserName(): string {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  if (ua.includes('Edg/')) return 'edge';
  if (ua.includes('Brave')) return 'brave';
  if (ua.includes('Chrome/')) return 'chrome';
  return 'unknown';
}
