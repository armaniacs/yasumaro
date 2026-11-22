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
 *   @typescript-eslint/no-explicit-any       -> typescript/no-explicit-any  (+plugin typescript)
 *   @typescript-eslint/no-unused-vars        -> no-unused-vars
 *   @typescript-eslint/no-restricted-imports -> no-restricted-imports (allowTypeImports kept)
 *   no-restricted-imports                     -> no-restricted-imports
 *   no-self-compare                           -> no-self-compare
 *   vitest/expect-expect / valid-expect       -> same (+plugin vitest)
 *   no-restricted-syntax (SettingsRepository) -> local/no-settings-repository-direct
 *   local/*                                    -> local/*
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
  if (id === '@typescript-eslint/no-explicit-any') {
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
  let hasJsPluginRule = false;
  for (const [id, config] of Object.entries(block.rules)) {
    const t = translateRule(id, config);
    if (!t) {
      unmigratable.add(id);
      continue;
    }
    rules[t.id] = t.config;
    if (t.plugin) plugins.add(t.plugin);
    if (t.id.startsWith('local/')) hasJsPluginRule = true;
  }
  if (Object.keys(rules).length === 0) continue;

  const override = { rules };
  if (block.files && block.files.length > 0) override.files = block.files;
  const excludes = [...(block.ignores || []), ...EXTRA_EXCLUDES];
  if (excludes.length > 0) override.excludeFiles = excludes;
  if (plugins.size > 0) override.plugins = [...plugins];
  overrides.push(override);
  void hasJsPluginRule;
}

// --- oxlint-specific overrides (intentionally NOT in eslint.config.js) ---
// eslint.config.js is the tool-neutral SSOT for rule *intent*; these reconcile
// oxlint's built-in rule implementations with ESLint's on two edges where the
// two engines differ. They live here so the generator stays the single source
// of .oxlintrc.json. See dev-docs/investigation-oxlint-migration.md.
//
// 1. auditLogGateway.ts uses a deliberate lazy `await import()` of background
//    (see its header): no *static* messaging->background edge, but oxlint's
//    no-restricted-imports flags dynamic imports where ESLint's does not.
overrides.push({
  files: ['src/messaging/auditLogGateway.ts'],
  rules: { 'no-restricted-imports': 'off' },
});

// 2. oxlint's vitest/expect-expect does not count expect() nested inside
//    for/if blocks (eslint-plugin-vitest does). These tests assert inside loops.
overrides.push({
  files: [
    'src/background/ai/__tests__/providerCatalog.test.ts',
    'src/background/ai/__tests__/provider-catalog-derivation.test.ts',
    'src/utils/storage/__tests__/provider-domain-ssot.derivation.test.ts',
    'src/utils/storage/__tests__/providerAllowlist.test.ts',
  ],
  plugins: ['vitest'],
  rules: { 'vitest/expect-expect': 'off' },
});

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
  }
}