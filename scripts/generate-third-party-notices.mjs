#!/usr/bin/env node

/**
 * THIRD_PARTY_NOTICES.md generator (PBI #36).
 *
 * Collects license information for all installed dependencies
 * (runtime + dev + transitive) and writes a markdown file containing
 * each package's name, version, license, repository, and full license text.
 *
 * Usage: node scripts/generate-third-party-notices.mjs [output-path]
 *   output-path defaults to THIRD_PARTY_NOTICES.md in the repository root.
 */

import checker from 'license-checker';
import { readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import process from 'process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = resolve(__dirname, '..');

const OUTPUT_PATH = process.argv[2]
  ? resolve(process.argv[2])
  : resolve(ROOT_DIR, 'THIRD_PARTY_NOTICES.md');

checker.init({ start: ROOT_DIR }, (err, packages) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }

  const entries = Object.entries(packages)
    .map(([name, info]) => ({ name, ...info }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const lines = [
    '# Third-Party Notices',
    '',
    'This software includes third-party libraries. Their licenses are listed below.',
    '',
    `This file was automatically generated for ${entries.length} package(s).`,
    '',
    '---',
    '',
  ];

  for (const pkg of entries) {
    const license = Array.isArray(pkg.licenses)
      ? pkg.licenses.join(', ')
      : pkg.licenses || 'UNKNOWN';

    lines.push(`## ${pkg.name}`);
    lines.push('');
    lines.push(`- **License:** ${license}`);
    if (pkg.repository) {
      lines.push(`- **Repository:** ${pkg.repository}`);
    }
    if (pkg.publisher) {
      lines.push(`- **Publisher:** ${pkg.publisher}`);
    }

    let licenseText = '';
    if (pkg.licenseFile) {
      try {
        licenseText = readFileSync(pkg.licenseFile, 'utf8').trim();
      } catch {
        // Some packages reference a licenseFile that does not exist.
      }
    }

    if (licenseText) {
      lines.push('');
      lines.push('```');
      lines.push(licenseText);
      lines.push('```');
    }

    lines.push('');
    lines.push('---');
    lines.push('');
  }

  writeFileSync(OUTPUT_PATH, lines.join('\n'));
  console.log(`Generated ${OUTPUT_PATH} with ${entries.length} package(s).`);
});
