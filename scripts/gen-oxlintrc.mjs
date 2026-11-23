#!/usr/bin/env node
/**
 * gen-oxlintrc.mjs
 *
 * Generates a complete .oxlintrc.json from the current eslint.config.js (the
 * SSOT during the oxlint migration). Every rule block is translated to its
 * oxlint equivalent so oxlint can run as a full drop-in for `eslint .` and the
 * two can be compared for parity before eslint is removed.
 *
 * Translation map (eslint.config.js id -> oxlint id):
 *   typescript/no-explicit-any                -> typescript/no-explicit-any (+plugin typescript)
 *   @typescript-eslint/no-explicit-any         -> typescript/no-explicit-any (legacy alias)
 *   no-unused-vars                             -> no-unused-vars
 *   no-restricted-imports                       -> no-restricted-imports (allowTypeImports kept)
 *   no-self-compare                             -> no-self-compare
 *   vitest/expect-expect / valid-expect         -> same (+plugin vitest)
 *   no-restricted-syntax (SettingsRepository)   -> local/no-settings-repository-direct
 *   local/*                                      -> local/*
 *
 * `files` and `ignores` (-> excludeFiles) are copied verbatim, so the parity is
 * structural, not hand-copied: a change in eslint.config.js flows through on the
 * next generation.
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

// oxlint-only reconciliations live in eslint.config.js (`oxlintReconciliations`)
// as the SSOT; the generator only reads them. See
// dev-docs/investigation-oxlint-migration.md for why the two engines differ on
// these edges. The shape is validated strictly: a broken SSOT entry must stop
// generation (fail-closed) rather than emit a silently greener config.
function readReconciliations(value) {
  if (!Array.isArray(value)) {
    throw new Error('oxlintReconciliations must be an array');
  }
  return value.map((entry, index) => {
    const where = `oxlintReconciliations[${index}]`;
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`${where} must be an object`);
    }
    const extra = Object.keys(entry).filter((k) => !['files', 'plugins', 'reason', 'rules'].includes(k));
    if (extra.length > 0) {
      throw new Error(`${where} has unknown keys: ${extra.join(', ')}`);
    }
    const { files, plugins, reason, rules } = entry;
    if (!Array.isArray(files) || files.length === 0 || !files.every((f) => typeof f === 'string')) {
      throw new Error(`${where}.files must be a non-empty string array`);
    }
    if (rules === null || typeof rules !== 'object' || Array.isArray(rules) || Object.keys(rules).length === 0) {
      throw new Error(`${where}.rules must be a non-empty object`);
    }
    if (plugins !== undefined && (!Array.isArray(plugins) || !plugins.every((p) => typeof p === 'string'))) {
      throw new Error(`${where}.plugins must be a string array when present`);
    }
    if (typeof reason !== 'string' || reason.length === 0) {
      throw new Error(`${where}.reason must be a non-empty string`);
    }
    // Key order (files, plugins, rules) matches the historical generated
    // output so regeneration is diff-free.
    const override = { files: [...files] };
    if (plugins !== undefined) override.plugins = [...plugins];
    override.rules = rules;
    return override;
  });
}

let reconciliations;
try {
  reconciliations = readReconciliations(configModule.oxlintReconciliations);
} catch (error) {
  process.stderr.write(`gen-oxlintrc: invalid oxlintReconciliations: ${error.message}\n`);
  process.exit(1);
}

const JS_PLUGINS = ['./eslint/oxlint-plugin.mjs'];

// Files oxlint must not lint: the .js fixtures under test-pages carry TS syntax
// in a .js file, which oxlint's JS parser rejects (TS8016); eslint parsed them
// with a TS parser. Excluding them keeps both tools at zero there.
const EXTRA_EXCLUDES = ['testDir/e2e/test-pages/**'];

function severity(level) {
  if (level === 2 || level === 'error') return 'error';
  if (level === 1 || level === 'warn') return 'warn';
  return 'off';
}

function translateRule(id, config) {
  // Returns { id, config, plugin } or null when a rule has no oxlint equivalent
  // and is not the one no-restricted-syntax selector this repo uses.
  if (id === 'typescript/no-explicit-any' || id === '@typescript-eslint/no-explicit-any') {
    return { id: 'typescript/no-explicit-any', config: severity(config), plugin: 'typescript' };
  }
  if (id === '@typescript-eslint/no-unused-vars' || id === 'no-unused-vars') {
    const cfg = Array.isArray(config) ? [severity(config[0]), config[1]] : severity(config);
    return { id: 'no-unused-vars', config: cfg };
  }
  if (id === '@typescript-eslint/no-restricted-imports' || id === 'no-restricted-imports') {
    return { id: 'no-restricted-imports', config };
  }
  if (id === 'no-self-compare') return { id: 'no-self-compare', config: severity(config) };
  if (id === 'vitest/expect-expect' || id === 'vitest/valid-expect') {
    return { id, config, plugin: 'vitest' };
  }
  if (id === 'no-restricted-syntax') {
    // Only the SettingsRepository NewExpression ban is used in this repo.
    const sels = Array.isArray(config) ? config[1]?.selector : undefined;
    if (typeof sels === 'string' && sels.includes('SettingsRepository')) {
      return { id: 'local/no-settings-repository-direct', config: severity(config[0]) };
    }
    return null;
  }
  if (id.startsWith('local/')) return { id, config };
  return null;
}

const ignorePatterns = [];
const overrides = [];
const unmigratable = new Set();

for (const block of flatConfig) {
  // Global ignores (the block with only `ignores`, no rules) feed ignorePatterns.
  if (block.ignores && (!block.rules || Object.keys(block.rules).length === 0)) {
    for (const g of block.ignores) if (!ignorePatterns.includes(g)) ignorePatterns.push(g);
  }
  if (!block.rules) continue;

  const rules = {};
  const plugins = new Set();
  for (const [id, config] of Object.entries(block.rules)) {
    const t = translateRule(id, config);
    if (!t) {
      unmigratable.add(id);
      continue;
    }
    rules[t.id] = t.config;
    if (t.plugin) plugins.add(t.plugin);
  }
  if (Object.keys(rules).length === 0) continue;

  const override = { rules };
  if (block.files && block.files.length > 0) override.files = block.files;
  const excludes = [...(block.ignores || []), ...EXTRA_EXCLUDES];
  if (excludes.length > 0) override.excludeFiles = excludes;
  if (plugins.size > 0) override.plugins = [...plugins];
  overrides.push(override);
}

// oxlint-specific reconciliations come from the eslint.config.js SSOT
// (`oxlintReconciliations`, validated above) so intent lives in one place.
for (const override of reconciliations) overrides.push(override);

for (const g of EXTRA_EXCLUDES) if (!ignorePatterns.includes(g)) ignorePatterns.push(g);

const oxlintrc = {
  $schema: './node_modules/oxlint/configuration_schema.json',
  jsPlugins: JS_PLUGINS,
  categories: { correctness: 'off' },
  env: { builtin: true },
  ignorePatterns,
  overrides,
};

const json = JSON.stringify(oxlintrc, null, 2) + '\n';

if (process.argv.includes('--stdout')) {
  process.stdout.write(json);
} else {
  writeFileSync(join(root, '.oxlintrc.json'), json);
  const ruleCount = overrides.reduce((n, o) => n + Object.keys(o.rules).length, 0);
  process.stderr.write(
    `.oxlintrc.json written: ${overrides.length} override blocks, ${ruleCount} rule entries.\n`,
  );
  if (unmigratable.size > 0) {
    process.stderr.write(`WARNING unmigrated rules: ${[...unmigratable].join(', ')}\n`);
    // Fail closed: a silently dropped rule would leave oxlint greener than the
    // SSOT intent. Intentional exclusions must be handled in translateRule.
    process.exitCode = 1;
  }
}
