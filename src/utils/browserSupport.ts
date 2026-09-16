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
 * Free disk space (bytes) Chromium requires before it will initialize the
 * on-device model. Chromium enforces 22 GiB; below it `availability()` reports
 * a bare 'unavailable' with no machine-readable reason, so we re-derive the
 * cause ourselves to avoid telling users to enable a flag they already enabled.
 */
const BUILT_IN_AI_REQUIRED_FREE_BYTES = 22 * 1024 * 1024 * 1024;

/** Free-space reading used to explain an 'unavailable' Built-in AI status. */
export interface BuiltInAIDiskSpace {
    freeBytes: number;
    requiredBytes: number;
    sufficient: boolean;
}

/**
 * Estimate whether the device has enough free space for the on-device model,
 * or null when the browser gives no usable reading.
 *
 * `navigator.storage.estimate()` reports the origin's quota, not the real disk,
 * but Chromium derives that quota from actual free space, so `quota - usage`
 * tracks it closely enough to distinguish "no space" from "flag disabled".
 */
export async function getBuiltInAIDiskSpace(): Promise<BuiltInAIDiskSpace | null> {
    if (typeof navigator === 'undefined' || !navigator.storage?.estimate) {
        return null;
    }
    try {
        const { quota, usage } = await navigator.storage.estimate();
        if (typeof quota !== 'number') {
            return null;
        }
        const freeBytes = Math.max(0, quota - (usage ?? 0));
        return {
            freeBytes,
            requiredBytes: BUILT_IN_AI_REQUIRED_FREE_BYTES,
            sufficient: freeBytes >= BUILT_IN_AI_REQUIRED_FREE_BYTES
        };
    } catch {
        return null;
    }
}

/** Format a byte count as whole gigabytes for user-facing guidance. */
export function formatGigabytes(bytes: number): string {
    return `${Math.round(bytes / (1024 * 1024 * 1024))} GB`;
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
