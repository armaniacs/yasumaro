#!/usr/bin/env node

/**
 * License compliance checker (PBI #36).
 *
 * Scans all installed dependencies (runtime + dev + transitive) and fails
 * if a forbidden license is present without an accompanying permissive
 * option. Dual-licensed packages such as "(MIT OR GPL-3.0-or-later)" are
 * allowed because the permissive option can be selected.
 *
 * Usage: node scripts/check-licenses.mjs [start-directory]
 *   start-directory defaults to the repository root.
 */

import checker from 'license-checker';
import { dirname, resolve } from 'path';
import process from 'process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = resolve(__dirname, '..');

/**
 * Permissive license identifiers that make a dual-licensed package acceptable
 * even when a forbidden license is also present.
 */
const PERMISSIVE_RE = /\b(MIT|ISC|BSD|Apache-2\.0|Apache|CC0|WTFPL|Unlicense|MPL-2\.0|BlueOak-1\.0\.0|0BSD|Python-2\.0|MIT-0|CC-BY-3\.0|CC-BY-4\.0)\b/i;

/**
 * Copyleft and otherwise problematic licenses that must not be used without
 * a permissive dual-license option.
 */
const FORBIDDEN_RE = /\b(GPL|AGPL|LGPL|SSPL|OSL|EUPL|NPL|Commons-Clause)\b/i;

const startPath = process.argv[2] ? resolve(process.argv[2]) : ROOT_DIR;

checker.init({ start: startPath }, (err, packages) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }

  const violations = [];
  const unknownLicenses = [];

  for (const [name, info] of Object.entries(packages)) {
    const license = Array.isArray(info.licenses)
      ? info.licenses.join('; ')
      : info.licenses || 'UNKNOWN';

    if (license === 'UNKNOWN') {
      unknownLicenses.push(name);
    }

    if (FORBIDDEN_RE.test(license) && !PERMISSIVE_RE.test(license)) {
      violations.push(`${name}: ${license}`);
    }
  }

  if (unknownLicenses.length > 0) {
    console.warn(`\nWarning: ${unknownLicenses.length} package(s) have an unknown license:`);
    for (const name of unknownLicenses) {
      console.warn(`  - ${name}`);
    }
  }

  if (violations.length > 0) {
    console.error(`\nError: ${violations.length} package(s) use a forbidden license:`);
    for (const violation of violations) {
      console.error(`  - ${violation}`);
    }
    process.exit(1);
  }

  console.log(`License check passed for ${Object.keys(packages).length} package(s).`);
});
