/**
 * i18n-dom.ts
 * DOM-dependent i18n helpers that must only be used in UI contexts where
 * `document` is available. Separated from src/utils/i18n.ts so Service Worker
 * and Offscreen Document contexts can import the pure i18n helpers without
 * triggering a ReferenceError at module load time.
 */

import { getMessage, getUserLocale, isRTL } from './i18n.js';

export { getMessage, getUserLocale, isRTL } from './i18n.js';

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

    const substitutions = htmlEl.getAttribute('data-i18n-args');
    let args = null;
    if (substitutions) {
      try {
        args = JSON.parse(substitutions);
      } catch (_e) {
        // Ignore malformed JSON
      }
    }

    const translatedText = getMessage(key, args);

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
      const substitutions = htmlEl.getAttribute('data-i18n-args');
      const args = substitutions ? JSON.parse(substitutions) : null;
      htmlEl.placeholder = getMessage(key, args);
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
