#!/usr/bin/env node
/**
 * sync-docs-translations.mjs
 *
 * Keeps docs/index.html in sync with the Chrome extension's _locales messages.
 *
 * - Reads public/_locales/{ja,en}/messages.json
 * - Reads scripts/translation-key-map.json to map messages.json keys to
 *   docs/index.html TRANSLATIONS keys
 * - Replaces the TRANSLATIONS object in docs/index.html with the merged data
 *
 * Usage: node scripts/sync-docs-translations.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const docsPath = path.join(root, 'docs', 'index.html');
const mapPath = path.join(__dirname, 'translation-key-map.json');
const messagesDir = path.join(root, 'public', '_locales');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function loadMessages(locale) {
  return readJson(path.join(messagesDir, locale, 'messages.json'));
}

function loadKeyMap() {
  if (!fs.existsSync(mapPath)) {
    return { ja: {}, en: {} };
  }
  return readJson(mapPath);
}

function extractTranslations(html) {
  const match = html.match(/const TRANSLATIONS = (\{[\s\S]*?\n\});/);
  if (!match) {
    throw new Error('TRANSLATIONS object not found in docs/index.html');
  }
  // The captured literal is valid JavaScript (string values only), so use
  // the Function constructor for a safer parse than eval().
  return {
    text: match[0],
    obj: (new Function('return ' + match[1]))(),
  };
}

function applyMapping(translations, messages, mapping) {
  for (const [messagesKey, docsKey] of Object.entries(mapping)) {
    const entry = messages[messagesKey];
    if (entry && typeof entry.message === 'string' && typeof docsKey === 'string') {
      translations[docsKey] = entry.message;
    }
  }
}

function main() {
  const html = fs.readFileSync(docsPath, 'utf8');
  const { text, obj } = extractTranslations(html);
  const keyMap = loadKeyMap();

  for (const locale of ['ja', 'en']) {
    if (!obj[locale]) {
      obj[locale] = {};
    }
    const messages = loadMessages(locale);
    const mapping = keyMap[locale] || {};
    applyMapping(obj[locale], messages, mapping);
  }

  const replacement = `const TRANSLATIONS = ${JSON.stringify(obj, null, 2)};`;
  const newHtml = html.replace(text, replacement);

  fs.writeFileSync(docsPath, newHtml, 'utf8');
  console.log('docs/index.html translations synced from public/_locales messages.');
}

main();
