/**
 * i18nPlural.ts
 * Selects plural-variant message keys for the current UI locale.
 *
 * Chrome's chrome.i18n API does not support ICU MessageFormat plural rules.
 * This module uses the conventional `_one` / `_other` key suffixes for
 * English and falls back to the base key for locales without a plural
 * distinction (e.g. Japanese).
 */

function getPluralLocale(): string {
    if (typeof chrome !== 'undefined' && chrome.i18n?.getUILanguage) {
        return chrome.i18n.getUILanguage();
    }
    return 'en';
}

function selectPluralSuffix(locale: string, count: number): string | null {
    const lang = locale.split('-')[0].toLowerCase();
    // English-style cardinal plural: one for exactly 1, other otherwise.
    if (lang === 'en') {
        return count === 1 ? 'one' : 'other';
    }
    // Japanese and other locales without a count distinction fall back to the
    // base message key.
    return null;
}

/**
 * Returns the message key to use for a countable message.
 * For English this will be `{key}_one` when count === 1 and `{key}_other`
 * otherwise. For locales without a plural distinction the base key is
 * returned unchanged.
 *
 * Callers can pass the returned key to their existing `getMessage` helper
 * along with the usual substitutions.
 */
export function getPluralKey(key: string, count: number): string {
    const suffix = selectPluralSuffix(getPluralLocale(), count);
    if (!suffix) return key;
    return `${key}_${suffix}`;
}
