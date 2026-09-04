#!/usr/bin/env node

/**
 * check-i18n.mjs — Internationalization completeness verification.
 *
 * Verifies:
 * 1. All translation keys in en/messages.json exist in ja/messages.json
 * 2. All translation keys in ja/messages.json exist in en/messages.json
 *    (extra keys gate the release: en is the default_locale, so a ja-only
 *    key renders as the raw key name for English users)
 * 3. No empty translation values
 *
 * Comparison logic lives in i18n-core.mjs and is covered by
 * scripts/__tests__/check-i18n.test.ts.
 */

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const ROOT_DIR = join(dirname(__filename), '..', '..');
const LOCALES_DIR = join(ROOT_DIR, 'public', '_locales');
const SRC_DIR = join(ROOT_DIR, 'src');

const { header, pass, fail, warn, info, sectionBreak, summary } = await import('./utils/reporter.mjs');
const { checkI18nCompleteness, checkSourceI18nKeys } = await import('./i18n-core.mjs');

// Run only when invoked directly (index.mjs spawns this file); importing it
// for tests must not produce output or exit.
if (process.argv[1] && process.argv[1].endsWith('check-i18n.mjs')) {
  const reporter = { header, pass, fail, warn, info };
  const i18nOk = checkI18nCompleteness(LOCALES_DIR, reporter);
  const sourceOk = checkSourceI18nKeys(SRC_DIR, LOCALES_DIR, reporter);

  sectionBreak();
  const allPassed = summary() && i18nOk && sourceOk;
  process.exit(allPassed ? 0 : 1);
}
