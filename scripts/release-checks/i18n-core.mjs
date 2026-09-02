/**
 * i18n-core.mjs — Pure i18n completeness logic for check-i18n.mjs.
 *
 * Extracted so scripts/__tests__/check-i18n.test.ts can exercise the
 * comparison logic without spawning the check as a child process.
 * Keep this module free of process.exit / console side effects; all output
 * goes through the injected reporter.
 *
 * The extra-key comparison must test membership against the en *object*,
 * not against Object.keys(en) — `k in someArray` checks indices/properties,
 * so string keys never match and every key would be reported as extra
 * (see PBI 2026-09-02-01).
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Load messages.json for a locale as a flat {key: message} map.
 * Returns null when the file does not exist.
 */
export function loadMessages(localesDir, locale) {
  const path = join(localesDir, locale, 'messages.json');
  if (!existsSync(path)) {
    return null;
  }
  const content = readFileSync(path, 'utf-8');
  const parsed = JSON.parse(content);
  const keys = {};
  for (const [key, value] of Object.entries(parsed)) {
    keys[key] = (value && typeof value === 'object' && 'message' in value) ? value.message : '';
  }
  return keys;
}

/**
 * List locale directory names under localesDir.
 */
export function getAvailableLocales(localesDir) {
  if (!existsSync(localesDir)) {
    return [];
  }
  return readdirSync(localesDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
}

/**
 * Compare a locale against the en reference.
 * `enMessages` must be the en *object* (not Object.keys of it): the extra-key
 * membership check relies on object property lookup.
 */
export function compareLocaleKeys(enMessages, localeMessages) {
  const refKeys = Object.keys(enMessages);
  const missing = refKeys.filter((k) => !(k in localeMessages));
  const extra = Object.keys(localeMessages).filter((k) => !(k in enMessages));
  return { missing, extra };
}

/**
 * Keys whose value is empty in the locale (checked against en's key set).
 */
export function findEmptyValues(enMessages, localeMessages) {
  return Object.keys(enMessages).filter((k) => localeMessages[k] === '' || localeMessages[k] === undefined);
}

/**
 * Verify every locale (except the en reference) has all en keys.
 * Extra keys are a fail: en is the default_locale, so a ja-only key means
 * the English UI renders the raw key name.
 *
 * @param {string} localesDir - e.g. <root>/public/_locales
 * @param {object} reporter - { header, pass, fail, warn, info }
 * @returns {boolean} true when no fail-level problem was found
 */
export function checkI18nCompleteness(localesDir, reporter) {
  const { header, pass, fail, warn, info } = reporter;
  header('i18n Completeness');

  const locales = getAvailableLocales(localesDir);
  if (locales.length === 0) {
    warn(`No _locales directory found in ${localesDir}`);
    return true;
  }

  info(`Found locales: ${locales.join(', ')}`);

  const messages = {};
  for (const locale of locales) {
    messages[locale] = loadMessages(localesDir, locale);
    if (messages[locale]) {
      info(`  ${locale}: ${Object.keys(messages[locale]).length} keys`);
    }
  }

  const refLocale = 'en';
  if (!messages[refLocale]) {
    warn(`No ${refLocale} locale found — skipping completeness check`);
    return true;
  }

  const enMessages = messages[refLocale];
  const refKeys = Object.keys(enMessages);
  let allPassed = true;

  for (const locale of locales) {
    if (locale === refLocale) continue;
    const localeMessages = messages[locale];
    if (!localeMessages) {
      warn(`Locale ${locale}: messages.json not found`);
      continue;
    }

    const { missing, extra } = compareLocaleKeys(enMessages, localeMessages);

    if (missing.length > 0) {
      fail(`Locale ${locale}: missing ${missing.length} key(s)`);
      for (const k of missing.slice(0, 10)) {
        info(`    missing: ${k}`);
      }
      if (missing.length > 10) {
        info(`    ... and ${missing.length - 10} more`);
      }
      allPassed = false;
    } else {
      pass(`Locale ${locale}: all ${refKeys.length} keys present`);
    }

    if (extra.length > 0) {
      // A ja-only key is missing from en (default_locale): English users
      // would see the raw key name, so this gates the release.
      fail(`Locale ${locale}: ${extra.length} extra key(s) not in ${refLocale}`);
      for (const k of extra.slice(0, 10)) {
        info(`    extra: ${k}`);
      }
      if (extra.length > 10) {
        info(`    ... and ${extra.length - 10} more`);
      }
      allPassed = false;
    }

    const emptyValues = findEmptyValues(enMessages, localeMessages);
    if (emptyValues.length > 0) {
      warn(`Locale ${locale}: ${emptyValues.length} empty translation(s)`);
      for (const k of emptyValues.slice(0, 5)) {
        info(`    empty: ${k}`);
      }
    }
  }

  return allPassed;
}

/**
 * Verify every i18n key referenced from source (data-i18n / __MSG_) exists
 * in en/messages.json.
 *
 * @param {string} srcDir - e.g. <root>/src
 * @param {string} localesDir - e.g. <root>/public/_locales
 * @param {object} reporter - { pass, fail, warn, info }
 * @returns {boolean}
 */
export function checkSourceI18nKeys(srcDir, localesDir, reporter) {
  const { pass, fail, warn, info } = reporter;
  info('Checking source code for i18n key usage...');

  const usedKeys = new Set();

  function scanDir(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        scanDir(fullPath);
      } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.html')) {
        const content = readFileSync(fullPath, 'utf-8');
        if (entry.name.endsWith('.html')) {
          // Match data-i18n="key" and __MSG_key__ in HTML
          const htmlPattern = /(?:data-i18n|__MSG_)\(?["']([^"']+)["']\)?/g;
          let match;
          while ((match = htmlPattern.exec(content)) !== null) {
            usedKeys.add(match[1]);
          }
        } else {
          // Match data-i18n="key" in TS/JS
          const tsPattern = /data-i18n=["']([^"']+)["']/g;
          let match;
          while ((match = tsPattern.exec(content)) !== null) {
            usedKeys.add(match[1]);
          }
        }
      }
    }
  }

  if (existsSync(srcDir)) {
    scanDir(srcDir);
  }

  info(`Found ${usedKeys.size} unique i18n keys in source code`);

  const enMessages = loadMessages(localesDir, 'en');
  if (!enMessages) {
    warn('Could not load en/messages.json');
    return true;
  }

  const missingKeys = [...usedKeys].filter((k) => !(k in enMessages));
  // Filter out template-syntax false positives
  const realMissing = missingKeys.filter((k) => !k.includes('${') && !k.includes('}'));
  if (realMissing.length > 0) {
    fail(`${realMissing.length} i18n key(s) used in source but missing from en/messages.json:`);
    for (const k of realMissing.slice(0, 10)) {
      info(`  missing: ${k}`);
    }
    return false;
  }

  pass('All i18n keys in source code exist in en/messages.json');
  return true;
}
