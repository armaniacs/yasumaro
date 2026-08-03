#!/usr/bin/env node

/**
 * Appends (or overwrites, by tag) a single metrics record into
 * dev-docs/metrics/history.json, keeping the array sorted by date ascending.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectMetricsForRef, realGit } from './collect.mjs';

export function mergeRecord(existingRecords, newRecord) {
  const withoutDuplicate = existingRecords.filter((r) => r.tag !== newRecord.tag);
  const merged = [...withoutDuplicate, newRecord];
  merged.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  return merged;
}

export function readHistoryFile(content) {
  if (content === undefined) return [];
  return JSON.parse(content).records;
}

export function formatHistoryFile(records) {
  return `${JSON.stringify({ records }, null, 2)}\n`;
}

export function shouldSkipRecord(record) {
  return record === null;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, '..', '..');
export const HISTORY_FILE_PATH = join(ROOT_DIR, 'dev-docs', 'metrics', 'history.json');

async function main() {
  const ref = process.argv[2];
  if (!ref) {
    console.error('Usage: node scripts/metrics/updateHistory.mjs <git-ref>');
    process.exit(1);
  }

  const newRecord = await collectMetricsForRef(ref, realGit);

  if (shouldSkipRecord(newRecord)) {
    console.error(`Skipping ${ref}: unable to collect metrics (see warning above).`);
    process.exit(1);
  }

  const existingContent = existsSync(HISTORY_FILE_PATH)
    ? readFileSync(HISTORY_FILE_PATH, 'utf-8')
    : undefined;
  const existingRecords = readHistoryFile(existingContent);
  const merged = mergeRecord(existingRecords, newRecord);

  mkdirSync(dirname(HISTORY_FILE_PATH), { recursive: true });
  writeFileSync(HISTORY_FILE_PATH, formatHistoryFile(merged));

  console.log(`Recorded metrics for ${ref} -> ${HISTORY_FILE_PATH}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
