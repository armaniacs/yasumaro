#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8'));
const out = JSON.stringify({ version: pkg.version }, null, 2) + '\n';
writeFileSync(new URL('../docs/version.json', import.meta.url), out);
console.log(`synced docs/version.json -> ${pkg.version}`);
