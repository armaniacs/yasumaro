#!/usr/bin/env node
/**
 * lint-layers-docs.mjs
 *
 * Verifies that the layer file lists in eslint/rules/utils-layer-boundary.mjs
 * (LAYER0_FILES / LAYER1_FILES / LAYER2_MODULES / BARREL_MODULES, the SSOT)
 * agree with the classification tables in dev-docs/LAYERS.md.
 *
 * Two directions are checked:
 *   1. Every rule entry exists under the matching Layer heading in LAYERS.md.
 *   2. Every docs entry under a Layer heading is either in the matching rule
 *      list or in DOCS_ONLY_ALLOWLIST below (classified-but-unenforced or
 *      intentionally out-of-scope files). Anything else is drift.
 *
 * Only fenced code blocks under the Layer headings are inspected, so prose
 * mentions (annotations, history, the unclassified follow-up list) never
 * cause false positives.
 *
 * Usage:
 *   node scripts/lint-layers-docs.mjs [--rule <path>] [--docs <path>]
 *
 * Exits with 1 and reports counts on stderr when drift is found, 0 with a
 * success message otherwise.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const args = process.argv.slice(2);
function argValue(flag, fallback) {
  const i = args.indexOf(flag);
  return i >= 0 && i + 1 < args.length ? resolve(args[i + 1]) : fallback;
}
const RULE_PATH = argValue('--rule', resolve(ROOT, 'eslint/rules/utils-layer-boundary.mjs'));
const DOCS_PATH = argValue('--docs', resolve(ROOT, 'dev-docs/LAYERS.md'));

// Docs entries legitimately absent from the rule lists (PBI 2026-09-17-05 v1
// scope). Each entry needs a reason; adding a file to LAYERS.md without
// either a rule-list entry or an allowlist row fails this check by design.
const DOCS_ONLY_ALLOWLIST = {
  'Layer 0': [],
  'Layer 1': [
    // Classified in LAYERS.md but not yet enforced by the rule.
    'src/utils/storage/SettingsRepository.ts',
    'src/utils/storage/storageTransaction.ts',
    'src/utils/masterPassword.ts',
    'src/utils/i18nPlural.ts',
  ],
  'Layer 2': [
    // Classified or discussed in LAYERS.md but not yet enforced by the rule.
    'src/utils/markdownFormatter.ts',
    'src/utils/domainUtils.ts',
    // Directory shorthand for the Layer 1-循環 exception files, which are
    // intentionally outside the rule (dynamic-import protection instead).
    'src/utils/trustDb/',
  ],
  Barrel: [],
};

const RULE_TO_DOCS_SECTION = {
  LAYER0_FILES: 'Layer 0',
  LAYER1_FILES: 'Layer 1',
  LAYER2_MODULES: 'Layer 2',
  BARREL_MODULES: 'Barrel',
};

function extractRuleLists(source) {
  const lists = {};
  for (const name of Object.keys(RULE_TO_DOCS_SECTION)) {
    const m = source.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`));
    if (!m) {
      console.error(`[layers-docs] RULE LIST NOT FOUND: ${name}`);
      process.exit(1);
    }
    lists[name] = [...m[1].matchAll(/'([^']+)'/g)].map((e) => e[1]);
  }
  return lists;
}

function extractDocsSections(source) {
  // Split LAYERS.md at its Layer headings; the Layer 1-循環 section is
  // intentionally skipped (rule-exempt by design).
  const sections = {};
  const headingRe = /^### (Layer 1-循環|Layer 0|Layer 1|Layer 2|Barrel)(?![-\w]).*$/gm;
  const headings = [...source.matchAll(headingRe)];
  for (let i = 0; i < headings.length; i++) {
    const name = headings[i][1] === 'Layer 1-循環' ? null : headings[i][1];
    const start = headings[i].index + headings[i][0].length;
    const end = i + 1 < headings.length ? headings[i + 1].index : source.length;
    if (name === null) continue;
    const body = source.slice(start, end);
    const entries = [];
    for (const block of body.matchAll(/```\n([\s\S]*?)```/g)) {
      for (const line of block[1].split('\n')) {
        // First token is the path; trailing `— ...` annotations are prose.
        const token = line.trim().split(/\s+/)[0];
        if (token && token.startsWith('src/utils/')) entries.push(token);
      }
    }
    sections[name] = entries;
  }
  return sections;
}

const ruleSource = readFileSync(RULE_PATH, 'utf-8');
const docsSource = readFileSync(DOCS_PATH, 'utf-8');
const ruleLists = extractRuleLists(ruleSource);
const docsSections = extractDocsSections(docsSource);

let errors = 0;

// Direction 1: every rule entry must sit under the matching docs heading.
for (const [listName, section] of Object.entries(RULE_TO_DOCS_SECTION)) {
  const docsEntries = docsSections[section];
  if (!docsEntries) {
    console.error(`[layers-docs] DOCS SECTION NOT FOUND: ### ${section}`);
    errors++;
    continue;
  }
  for (const entry of ruleLists[listName]) {
    if (!docsEntries.includes(entry)) {
      console.error(`[layers-docs:${section}] RULE WITHOUT DOCS: ${entry} (in ${listName}, missing under ### ${section})`);
      errors++;
    }
  }
}

// Direction 2: every docs entry must be in the rule list or allowlisted.
for (const [listName, section] of Object.entries(RULE_TO_DOCS_SECTION)) {
  const docsEntries = docsSections[section] || [];
  const allowed = new Set([...ruleLists[listName], ...DOCS_ONLY_ALLOWLIST[section]]);
  for (const entry of docsEntries) {
    if (!allowed.has(entry)) {
      console.error(`[layers-docs:${section}] DOCS WITHOUT RULE: ${entry} (add to ${listName} or DOCS_ONLY_ALLOWLIST)`);
      errors++;
    }
  }
}

if (errors > 0) {
  console.error(`\n${errors} layer list drift(s) found between rule and LAYERS.md.`);
  process.exit(1);
}

const ruleCount = Object.values(ruleLists).reduce((n, l) => n + l.length, 0);
console.log(`Checked ${ruleCount} rule entries against LAYERS.md — layer lists in sync.`);
