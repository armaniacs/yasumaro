#!/usr/bin/env node
/**
 * lint-layers-docs.mjs
 *
 * Verifies that the layer file lists in eslint/rules/utils-layer-boundary.mjs
 * (LAYER0_FILES / LAYER1_FILES / LAYER2_MODULES / BARREL_MODULES, the SSOT)
 * agree with the classification tables in dev-docs/LAYERS.md.
 *
 * Four checks run:
 *   1. Every rule entry exists under the matching Layer heading in LAYERS.md.
 *   2. Every docs entry under a Layer heading is either in the matching rule
 *      list or in DOCS_ONLY_ALLOWLIST below (classified-but-unenforced or
 *      intentionally out-of-scope files). Anything else is drift.
 *   3. Every path referenced by the rule lists, the docs classification tables
 *      or the allowlists actually exists on disk (existsSync, same pattern as
 *      scripts/lint-adr-links.mjs). A rule↔docs pair that shares a stale,
 *      deleted-file entry would otherwise pass checks 1-2 forever.
 *   4. Every `// @layer N` declaration at the top of a TypeScript file under
 *      src/utils/ is registered in the SSOT for its declared layer (rule list
 *      or docs classification table). The declaration alone is no longer enough; the
 *      checklist step "register in the SSOT" is now enforced mechanically.
 *      Files that are deliberately unregistered live in
 *      DECLARED_LAYER_ALLOWLIST with a reason.
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

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const UTILS_DIR = join(ROOT, 'src', 'utils');

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

// Files that carry a first-line `// @layer N` declaration but are deliberately
// kept out of both the rule lists and the classification tables. Each needs a
// written reason; registering the file in the SSOT removes the need for the
// row. The declaration check (4) skips these paths.
const DECLARED_LAYER_ALLOWLIST = {
  'src/utils/domainFilter/DomainFilter.ts': {
    declared: 'Layer 1',
    reason:
      'Declares // @layer 1 but reaches Layer 2 via domainUtils; documented as unclassified/out-of-scope in LAYERS.md "未分類・後続対応".',
  },
};

const RULE_TO_DOCS_SECTION = {
  LAYER0_FILES: 'Layer 0',
  LAYER1_FILES: 'Layer 1',
  LAYER2_MODULES: 'Layer 2',
  BARREL_MODULES: 'Barrel',
};

const DOCS_TO_RULE_LIST = Object.fromEntries(
  Object.entries(RULE_TO_DOCS_SECTION).map(([list, section]) => [section, list]),
);

const DECLARED_TO_SECTION = {
  '0': 'Layer 0',
  '1': 'Layer 1',
  '2': 'Layer 2',
  Barrel: 'Barrel',
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

function walkUtilsFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === '__tests__') continue;
      out.push(...walkUtilsFiles(p));
    } else if (name.endsWith('.ts')) {
      out.push(p);
    }
  }
  return out;
}

// True when a file path is covered by a list entry: exact match for a file,
// path prefix for a directory entry (trailing slash).
function pathCoveredByEntries(filePath, entries) {
  return entries.some((e) => {
    if (e.endsWith('/')) return filePath.startsWith(e);
    return filePath === e;
  });
}

const ruleSource = readFileSync(RULE_PATH, 'utf-8');
const docsSource = readFileSync(DOCS_PATH, 'utf-8');
const ruleLists = extractRuleLists(ruleSource);
const docsSections = extractDocsSections(docsSource);

let errors = 0;

// Check 1: every rule entry must sit under the matching docs heading.
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

// Check 2: every docs entry must be in the rule list or allowlisted.
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

// Check 3: every referenced path (rule lists, docs tables, allowlists, declared
// allowlist) must exist on disk. Same existsSync pattern as lint-adr-links.mjs.
const referencedPaths = new Set([
  ...Object.values(ruleLists).flat(),
  ...Object.values(docsSections).flat(),
  ...Object.values(DOCS_ONLY_ALLOWLIST).flat(),
  ...Object.keys(DECLARED_LAYER_ALLOWLIST),
]);
for (const relPath of referencedPaths) {
  if (!existsSync(join(ROOT, relPath))) {
    console.error(`[layers-docs:exists] MISSING FILE: ${relPath} (referenced by the SSOT or LAYERS.md)`);
    errors++;
  }
}

// Check 4: every first-line `// @layer N` declaration in src/utils/** must be
// registered in the rule list or docs table for its declared layer. This makes
// the declaration a gate input: annotating a file no longer exempts it.
const declaredFiles = walkUtilsFiles(UTILS_DIR)
  .map((filePath) => ({
    relPath: relative(ROOT, filePath).split(sep).join('/'),
    firstLine: readFileSync(filePath, 'utf-8').split('\n', 1)[0],
  }))
  .filter((f) => /^\/\/\s*@layer\s+(Barrel|\d+)\b/.test(f.firstLine));
for (const { relPath, firstLine } of declaredFiles) {
  const m = firstLine.match(/^\/\/\s*@layer\s+(Barrel|\d+)\b/);
  const declared = DECLARED_TO_SECTION[m[1]];
  if (!declared) {
    console.error(`[layers-docs:@layer] UNKNOWN DECLARED LAYER: ${relPath} ("${firstLine.trim()}")`);
    errors++;
    continue;
  }
  if (DECLARED_LAYER_ALLOWLIST[relPath]) continue;
  const section = declared;
  const ruleList = DOCS_TO_RULE_LIST[section];
  const registered = pathCoveredByEntries(relPath, ruleLists[ruleList]) ||
    pathCoveredByEntries(relPath, docsSections[section] || []);
  if (!registered) {
    console.error(
      `[layers-docs:@layer] UNREGISTERED DECLARATION: ${relPath} declares ${section} but is in neither ${ruleList} nor LAYERS.md ### ${section}`,
    );
    errors++;
  }
}

if (errors > 0) {
  console.error(`\n${errors} layer list drift(s) found between rule and LAYERS.md.`);
  process.exit(1);
}

const ruleCount = Object.values(ruleLists).reduce((n, l) => n + l.length, 0);
console.log(
  `Checked ${ruleCount} rule entries, ${referencedPaths.size} referenced paths and ${declaredFiles.length} @layer declarations against LAYERS.md — layer lists in sync.`,
);