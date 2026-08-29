#!/usr/bin/env node

/**
 * check-i18n.mjs — Internationalization completeness verification.
 *
 * Verifies:
 * 1. All translation keys in en/messages.json exist in ja/messages.json
 * 2. All translation keys in ja/messages.json exist in en/messages.json
 * 3. No empty translation values
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..', '..');
const LOCALES_DIR = join(ROOT_DIR, 'public', '_locales');

const { header, pass, fail, warn, info, sectionBreak, summary } = await import('./utils/reporter.mjs');

function loadMessages(locale) {
  const path = join(LOCALES_DIR, locale, 'messages.json');
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

function getAvailableLocales() {
  if (!existsSync(LOCALES_DIR)) {
    return [];
  }
  return readdirSync(LOCALES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
}

function checkI18nCompleteness() {
  header('i18n Completeness');

  const locales = getAvailableLocales();
  if (locales.length === 0) {
    warn('No _locales directory found in dist — run build first');
    return true;
  }

  info(`Found locales: ${locales.join(', ')}`);

  const messages = {};
  for (const locale of locales) {
    messages[locale] = loadMessages(locale);
    if (messages[locale]) {
      info(`  ${locale}: ${Object.keys(messages[locale]).length} keys`);
    }
  }

  // Check English as reference
  const refLocale = 'en';
  if (!messages[refLocale]) {
    warn(`No ${refLocale} locale found — skipping completeness check`);
    return true;
  }

  const refKeys = Object.keys(messages[refLocale]);
  let allPassed = true;

  for (const locale of locales) {
    if (locale === refLocale) continue;
    const localeMessages = messages[locale];
    if (!localeMessages) {
      warn(`Locale ${locale}: messages.json not found`);
      continue;
    }

    const missingInLocale = refKeys.filter((k) => !(k in localeMessages));
    const extraInLocale = Object.keys(localeMessages).filter((k) => !(k in refKeys));

    if (missingInLocale.length > 0) {
      fail(`Locale ${locale}: missing ${missingInLocale.length} key(s)`);
      for (const k of missingInLocale.slice(0, 10)) {
        info(`    missing: ${k}`);
      }
      if (missingInLocale.length > 10) {
        info(`    ... and ${missingInLocale.length - 10} more`);
      }
      allPassed = false;
    } else {
      pass(`Locale ${locale}: all ${refKeys.length} keys present`);
    }

    if (extraInLocale.length > 0) {
      warn(`Locale ${locale}: ${extraInLocale.length} extra key(s) not in ${refLocale}`);
      for (const k of extraInLocale.slice(0, 5)) {
        info(`    extra: ${k}`);
      }
    }

    // Check for empty values
    const emptyValues = refKeys.filter((k) => localeMessages[k] === '' || localeMessages[k] === undefined);
    if (emptyValues.length > 0) {
      warn(`Locale ${locale}: ${emptyValues.length} empty translation(s)`);
      for (const k of emptyValues.slice(0, 5)) {
        info(`    empty: ${k}`);
      }
    }
  }

  return allPassed;
}

function checkSourceI18nKeys() {
  sectionBreak();
  info('Checking source code for i18n key usage...');

  const srcDir = join(ROOT_DIR, 'src');
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

  const messages = loadMessages('en');
  if (!messages) {
    warn('Could not load en/messages.json');
    return true;
  }

  const missingKeys = [...usedKeys].filter((k) => !(k in messages));
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

function main() {
  const results = [];

  results.push({ name: 'i18n Completeness', ok: checkI18nCompleteness() });
  results.push({ name: 'Source i18n Keys', ok: checkSourceI18nKeys() });

  sectionBreak();
  const allPassed = summary();
  process.exit(allPassed ? 0 : 1);
}

main();
