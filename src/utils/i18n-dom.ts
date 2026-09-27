/**
 * i18n-dom.ts
 * DOM-dependent i18n helpers that must only be used in UI contexts where
 * `document` is available. Separated from src/utils/i18n.ts so Service Worker
 * and Offscreen Document contexts can import the pure i18n helpers without
 * triggering a ReferenceError at module load time.
 */

import { getMessage, getUserLocale, isRTL } from './i18n.js';
import { getPluralKey } from './i18nPlural.js';

/**
 * Parse a raw `data-i18n-args` attribute value into substitution args.
 *
 * WHY fail-safe: the attribute is user-editable HTML, and a throw from
 * `JSON.parse` would escape applyI18n and abort the remaining translation
 * passes, leaving the whole panel untranslated. Non-object JSON (number,
 * string, array, null) is also rejected because `resolvePluralKey` runs
 * `'count' in args`, which throws on primitives.
 *
 * WHY silent: the i18n modules are imported into the popup bundle and stay
 * free of any logger dependency, so a malformed attribute is ignored and the
 * element keeps its untranslated fallback text.
 */
export function parseI18nArgs(raw: string | null | undefined): Record<string, string | number> | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (_e) {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  // Chrome named substitutions only accept string|number values, so an entry
  // of any other type makes the whole attribute invalid rather than partial.
  const entries = Object.entries(parsed);
  if (entries.some(([, value]) => typeof value !== 'string' && typeof value !== 'number')) {
    return null;
  }
  return parsed as Record<string, string | number>;
}

/**
 * Resolves the effective message key for `data-i18n-args`, applying
 * getPluralKey() when a numeric `count` substitution is present so the
 * plural-variant message key (e.g. `ruleCount_one` / `ruleCount_other`) is
 * used instead of the base key.
 */
function resolvePluralKey(key: string, args: Record<string, unknown> | null): string {
  if (!args || !('count' in args)) return key;
  const count = Number(args.count);
  if (Number.isNaN(count)) return key;
  return getPluralKey(key, count);
}

/**
 * Translate <option> elements inside <select> tags.
 */
function translateOptions(element: HTMLElement = document.body): void {
  const selectElements = element.querySelectorAll('select');
  selectElements.forEach(select => {
    select.querySelectorAll('option[data-i18n-opt]').forEach(option => {
      const opt = option as HTMLOptionElement;
      const key = opt.getAttribute('data-i18n-opt');
      if (key) {
        opt.text = getMessage(key);
      }
    });
  });
}

/**
 * Translate button label attributes.
 */
function translateButtonLabels(element: HTMLElement = document.body): void {
  const buttons = element.querySelectorAll('[data-i18n-label]');
  buttons.forEach(button => {
    const key = button.getAttribute('data-i18n-label');
    if (key) {
      button.textContent = getMessage(key);
    }
  });
}

/**
 * Translate help text elements (newlines are preserved via CSS white-space: pre-line).
 */
function translateHelpText(element: HTMLElement = document.body): void {
  const helpTexts = element.querySelectorAll('.help-text[data-i18n]');
  helpTexts.forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (key) {
      el.textContent = getMessage(key);
    }
  });
}

/**
 * Apply translations to elements with i18n data attributes.
 * @param element - Root element to translate (defaults to document)
 */
export function applyI18n(element: HTMLElement | Document = document): void {
  const rootElement = element instanceof Document ? document.body : element as HTMLElement;

  const elements = rootElement.querySelectorAll('[data-i18n]');
  elements.forEach(el => {
    const htmlEl = el as HTMLElement;
    const key = htmlEl.getAttribute('data-i18n');
    if (!key) return;

    const args = parseI18nArgs(htmlEl.getAttribute('data-i18n-args'));

    const translatedText = getMessage(resolvePluralKey(key, args), args);

    // Guard: if translation is missing, keep the original HTML fallback text
    if (!translatedText) return;

    if (htmlEl.tagName === 'INPUT' || htmlEl.tagName === 'TEXTAREA') {
      (htmlEl as HTMLInputElement | HTMLTextAreaElement).placeholder = translatedText;
    } else if (htmlEl.tagName === 'IMG') {
      htmlEl.title = translatedText;
    } else {
      htmlEl.textContent = translatedText;
    }
  });

  const placeholderElements = rootElement.querySelectorAll('[data-i18n-input-placeholder]');
  placeholderElements.forEach(el => {
    const htmlEl = el as HTMLInputElement | HTMLTextAreaElement;
    const key = htmlEl.getAttribute('data-i18n-input-placeholder');
    if (key) {
      const args = parseI18nArgs(htmlEl.getAttribute('data-i18n-args'));
      htmlEl.placeholder = getMessage(resolvePluralKey(key, args), args);
    }
  });

  const ariaLabelElements = rootElement.querySelectorAll('[data-i18n-aria-label]');
  ariaLabelElements.forEach(el => {
    const key = el.getAttribute('data-i18n-aria-label');
    if (key) {
      el.setAttribute('aria-label', getMessage(key));
    }
  });

  translateOptions(rootElement);
  translateButtonLabels(rootElement);
  translateHelpText(rootElement);
}

/**
 * Translate the page title.
 * @param key - Translation key for the title
 */
export function translatePageTitle(key: string): void {
  document.title = getMessage(key);
}

/**
 * Dynamically set the HTML lang and dir attributes based on the user locale.
 */
export function setHtmlLangAndDir(): void {
  const locale = getUserLocale();
  const htmlElement = document.documentElement;
  htmlElement.lang = locale;
  htmlElement.dir = isRTL(locale) ? 'rtl' : 'ltr';
}
