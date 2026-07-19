/**
 * i18n.ts
 * Chrome Extension i18n API helpers with no DOM dependency.
 *
 * This module is safe to import in contexts where `document` is unavailable
 * (Service Worker, Offscreen Document, etc.). UI-specific helpers such as
 * applyI18n live in src/utils/i18n-dom.ts.
 */

// getUserLocale and isRTL are re-exported from localeUtils
import { getUserLocale, isRTL } from './localeUtils.js';
export { getUserLocale, isRTL };

/**
 * Get the translated message for a key without substitutions.
 */
export function getMessage(key: string): string;

/**
 * Get the translated message for a key with substitutions.
 * The `any` overload preserves compatibility with legacy callers that passed
 * values typed as `any` or unknown-shaped records.
 */
export function getMessage(key: string, substitutions: any): string;

/**
 * Get the translated message for a key.
 * @param key - Translation key
 * @param substitutions - Substitution parameters
 * @returns Translated string
 */
export function getMessage(
  key: string,
  substitutions: string | Array<string | number> | Record<string, string | number> | null = null
): string {
  const message = chrome.i18n.getMessage(key);
  if (!message) return "";

  if (substitutions && typeof substitutions === 'object' && !Array.isArray(substitutions)) {
    // Handle named substitutions (e.g. {count: 5})
    return message.replace(/\{(\w+)\}/g, (match, p1) => {
      return substitutions[p1] !== undefined ? String(substitutions[p1]) : match;
    });
  }

  if (Array.isArray(substitutions)) {
    return chrome.i18n.getMessage(key, substitutions) || "";
  }

  return message;
}
