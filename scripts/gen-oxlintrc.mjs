#!/usr/bin/env node
/**
 * gen-oxlintrc.mjs
 *
 * Generates .oxlintrc.json from the current eslint.config.js (the SSOT during
 * the oxlint migration). Only the `local/*` rule blocks are translated: each
 * flat-config block's `files` scope and per-rule options (allow lists) are
 * copied verbatim, because oxlint's JS plugin API passes `context.options`
 * through unchanged.
 *
 * Keeping eslint.config.js as the source and generating the oxlint config means
 * parity is structural, not hand-copied: an allow entry added to the ESLint
 * config flows into the oxlint run on the next generation.
 *
 * Usage:
 *   node scripts/gen-oxlintrc.mjs            # write .oxlintrc.json
 *   node scripts/gen-oxlintrc.mjs --stdout   # print instead of write
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const configModule = await import(join(root, 'eslint.config.js'));
const flatConfig = configModule.default;

const jsPlugins = ['./eslint/oxlint-plugin.mjs'];

// Collect every block that enables local/* rules, preserving file scope.
const overrides = [];
for (const block of flatConfig) {
  if (!block.rules) continue;
  const localRules = {};
  for (const [id, cfg] of Object.entries(block.rules)) {
    if (id.startsWith('local/')) localRules[id] = cfg;
  }
  if (Object.keys(localRules).length === 0) continue;
  const override = { rules: localRules };
  if (block.files && block.files.length > 0) override.files = block.files;
  // Per-block ignores (e.g. src/**/__tests__/** for the seam rules) must carry
  // over, or oxlint flags the test files ESLint deliberately exempts. oxlint's
  // override field is `excludeFiles` (ESLint flat config calls it `ignores`).
  if (block.ignores && block.ignores.length > 0) override.excludeFiles = block.ignores;
  overrides.push(override);
}

const oxlintrc = {
  $schema: './node_modules/oxlint/configuration_schema.json',
  jsPlugins,
  // Local rules are the migration target. Core rules are added on top of this
  // (see the static core block in .oxlintrc.json after generation); this
  // generator only emits the local/* portion so the parity run isolates them.
  categories: { correctness: 'off' },
  env: { builtin: true },
  ignorePatterns: [
    'node_modules/',
    'dist/',
    'coverage/',
    '.vulnhunter-fix/',
    'graphify-out/',
    'obsidian-smart-history_VULNHUNT_RESULTS*/',
    '.kilo/',
    '.claude/',
    '.worktrees/',
    '.stryker-tmp/',
  ],
  overrides,
};

const json = JSON.stringify(oxlintrc, null, 2) + '\n';

if (process.argv.includes('--stdout')) {
  process.stdout.write(json);
} else {
  writeFileSync(join(root, '.oxlintrc.json'), json);
  process.stderr.write(
    `.oxlintrc.json written: ${overrides.length} override blocks, ` +
      `${overrides.reduce((n, o) => n + Object.keys(o.rules).length, 0)} local rule entries.\n`,
  );
}