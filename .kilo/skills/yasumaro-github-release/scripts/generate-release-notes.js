#!/usr/bin/env node
/**
 * Generate a GitHub release body from the top entry in CHANGELOG.md.
 * Usage: node generate-release-notes.js [version]
 * If version is omitted, uses package.json version.
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ROOT = resolve(__dirname, '../../..');
const CHANGELOG_PATH = resolve(ROOT, 'CHANGELOG.md');
const PACKAGE_PATH = resolve(ROOT, 'package.json');

function extractEntry(changelog, version) {
  const headerPattern = new RegExp(`^## \\[${version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]`, 'm');
  const match = changelog.match(headerPattern);
  if (!match) {
    throw new Error(`Version ${version} not found in CHANGELOG.md`);
  }

  const start = match.index + match[0].length;
  const nextHeaderMatch = changelog.match(/^## \[/gm);
  let end = changelog.length;
  for (const nm of nextHeaderMatch || []) {
    if (changelog.indexOf(nm) > start) {
      end = changelog.indexOf(nm);
      break;
    }
  }

  return changelog.slice(start, end).trim();
}

function main() {
  const version = process.argv[2] || JSON.parse(readFileSync(PACKAGE_PATH, 'utf-8')).version;
  const changelog = readFileSync(CHANGELOG_PATH, 'utf-8');
  const entryBody = extractEntry(changelog, version);

  const body = `## Yasumaro v${version}

See [CHANGELOG.md](https://github.com/armaniacs/Yasumaro/blob/main/CHANGELOG.md) for details.

${entryBody}`;

  console.log(body);
}

main();
