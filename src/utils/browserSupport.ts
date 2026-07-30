/**
 * browserSupport.ts
 * Feature detection for browser-specific APIs.
 * Ensures graceful fallback when running in non-Chrome Chromium browsers (Edge, Brave, etc.).
 */

/** Browser identified from the user agent string. */
export type BrowserName = 'chrome' | 'edge' | 'brave' | 'unknown';

/** Guidance for enabling the on-device Prompt API flag in a given browser. */
export interface BuiltInAIFlagGuidance {
    /** Browser-internal settings URL for the flag (e.g. chrome://flags/...). */
    url: string;
    /** Human-readable flag name shown alongside the URL. */
    flagName: string;
}

/**
 * Get guidance (flag URL + name) for enabling the on-device Prompt API,
 * or null when no known flag exists for the given browser.
 *
 * URLs reflect the state verified on 2026-07-30 (Chrome stable /
 * Edge 150.0.4078.105 stable) and may need updates as browser flags evolve.
 */
export function getBuiltInAIFlagGuidance(browserName: BrowserName): BuiltInAIFlagGuidance | null {
    switch (browserName) {
        case 'chrome':
            return { url: 'chrome://flags/#prompt-api-for-gemini-nano', flagName: 'Prompt API for Gemini Nano' };
        case 'edge':
            return { url: 'edge://flags/#edge-llm-prompt-api-for-phi-mini', flagName: 'Prompt API for on-device language model' };
        default:
            return null;
    }
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
export function getBrowserName(): BrowserName {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  if (ua.includes('Edg/')) return 'edge';
  if (ua.includes('Brave')) return 'brave';
  if (ua.includes('Chrome/')) return 'chrome';
  return 'unknown';
}
