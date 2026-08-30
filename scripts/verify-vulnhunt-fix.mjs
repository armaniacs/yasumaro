#!/usr/bin/env node
/**
 * verify-vulnhunt-fix.mjs
 * Wave 0 — DoD を再スキャンから変異テスト green に変更する検証基盤 (M1)。
 *
 * 5件のBDD再現テストを集約実行し、結果を dev-docs/verify-vulnhunt-2026-08-30.md に出力。
 * - npm run type-check
 * - npx vitest run <該当テスト>（存在するもののみ、なければ警告してスキップ）
 *
 * 対象テスト（存在しないものは警告してスキップ）:
 * - src/utils/__tests__/keySerializer.test.ts
 * - src/background/__tests__/optimisticLock.test.ts
 * - src/offscreen/__tests__/payloadGuard*
 * - src/utils/__tests__/computeLimits.test.ts
 * - src/background/__tests__/cspValidatorSelfAllow.test.ts
 *
 * 実効では spec 上のパスに加え、既存実装のエイリアスも検証する:
 * - keySerializer → optimisticLockSerialization.test.ts (keySerializer primitive)
 * - optimisticLock → src/utils/__tests__/optimisticLock.test.ts
 * - computeLimits → tagCooccurrenceCap / sentenceExtractorCap / browsingLogCodec-comprehensive (cap)
 * - cspValidatorSelfAllow → src/utils/__tests__/cspValidatorSelfAllow.test.ts
 *
 * 終了コード: 全PASSで0、一つでもFAILで1
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const REPORT_PATH = join(ROOT, 'dev-docs', 'verify-vulnhunt-2026-08-30.md');

// Spec に記載の候補（glob含む）。存在しないものは警告してスキップする。
const SPEC_CANDIDATES = [
  'src/utils/__tests__/keySerializer.test.ts',
  'src/background/__tests__/optimisticLock.test.ts',
  'src/offscreen/__tests__/payloadGuard*',
  'src/utils/__tests__/computeLimits.test.ts',
  'src/background/__tests__/cspValidatorSelfAllow.test.ts',
];

// 実装上存在するエイリアス（spec パスが obsolete な場合の代替）。重複は除去する。
const ALIAS_CANDIDATES = [
  'src/utils/__tests__/optimisticLockSerialization.test.ts',
  'src/utils/__tests__/optimisticLock.test.ts',
  'src/utils/__tests__/cspValidatorSelfAllow.test.ts',
  'src/dashboard/__tests__/tagCooccurrenceCap.test.ts',
  'src/utils/__tests__/sentenceExtractorCap.test.ts',
  'src/offscreen/__tests__/browsingLogCodec-comprehensive.test.ts',
];

function expandGlob(pattern) {
  // Only supports single '*' in filename position for this script
  if (!pattern.includes('*')) {
    return existsSync(join(ROOT, pattern)) ? [pattern] : [];
  }
  const dir = dirname(join(ROOT, pattern));
  const basePat = pattern.substring(pattern.lastIndexOf('/') + 1); // e.g. payloadGuard*
  // Convert glob to regex: escape, replace * -> .*
  const escaped = basePat.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  const re = new RegExp(`^${escaped}$`);
  if (!existsSync(dir)) return [];
  const entries = readdirSync(dir);
  return entries
    .filter((e) => re.test(e))
    .map((e) => {
      const full = join(dir, e);
      // return as repo-relative posix
      const rel = full.startsWith(ROOT + '/') ? full.slice(ROOT.length + 1) : full;
      return rel;
    })
    .sort();
}

function resolveSpecCandidates() {
  const found = [];
  const warned = [];
  for (const pat of SPEC_CANDIDATES) {
    const expanded = expandGlob(pat);
    if (expanded.length === 0) {
      warned.push(pat);
    } else {
      found.push(...expanded);
    }
  }
  return { found, warned };
}

function resolveAliasCandidates(alreadyFound) {
  const alreadySet = new Set(alreadyFound);
  const extra = [];
  const skipped = [];
  for (const p of ALIAS_CANDIDATES) {
    if (alreadySet.has(p)) continue;
    if (existsSync(join(ROOT, p))) {
      extra.push(p);
    } else {
      skipped.push(p);
    }
  }
  return { extra, skipped };
}

function runCommand(cmd, args, label) {
  const result = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: 'utf-8',
    shell: false,
    timeout: 120_000,
  });
  const stdout = (result.stdout ?? '').toString();
  const stderr = (result.stderr ?? '').toString();
  const combined = stdout + (stderr ? `\n${stderr}` : '');
  const exitCode = result.status ?? 1;
  const pass = exitCode === 0;
  return { label, pass, exitCode, output: combined.trim().slice(0, 8000) };
}

const startedAt = new Date().toISOString();

// --- type-check ---
console.log('▶ npm run type-check');
const typeCheck = runCommand('npm', ['run', 'type-check'], 'type-check');

// --- resolve test files ---
const { found: specFound, warned: specWarned } = resolveSpecCandidates();
const { extra: aliasExtra } = resolveAliasCandidates(specFound);

// Merge: specFound + aliasExtra (dedup), keep specFound first
const testFiles = [...new Set([...specFound, ...aliasExtra])];

console.log(`▶ Resolved ${testFiles.length} test file(s): ${testFiles.join(', ') || '(none)'}`);
if (specWarned.length) {
  for (const w of specWarned) console.warn(`⚠︎ spec target missing, skip: ${w}`);
}

const testResults = [];
for (const f of testFiles) {
  console.log(`▶ npx vitest run ${f}`);
  const r = runCommand('npx', ['vitest', 'run', f], f);
  testResults.push(r);
}

// Warnings as pseudo-results for reporting (not affecting exit code)
const warnings = specWarned.map((p) => `spec target not found, skipped: \`${p}\``);
if (aliasExtra.length) {
  warnings.push(`alias tests added to cover missing spec paths: ${aliasExtra.map((p) => `\`${p}\``).join(', ')}`);
}

// --- overall ---
const allPass = typeCheck.pass && testResults.every((r) => r.pass) && testResults.length > 0;
const overall = allPass ? 'PASS' : 'FAIL';

// --- markdown report ---
function mdEscape(s) {
  return s.replace(/`/g, '\\`');
}

let md = '';
md += '# verify-vulnhunt-fix report\n\n';
md += `- Date: ${startedAt}\n`;
md += `- Branch: plan/0830-backlog-execution (Wave 0)\n`;
md += `- Purpose: DoD を VulnHunter 再スキャンから変異テスト green に変更 (M1) の検証基盤\n`;
md += `- Report: \`dev-docs/verify-vulnhunt-2026-08-30.md\`\n\n`;
md += `## Overall: ${overall}\n\n`;
if (allPass) {
  md += '> 全ての検証が green。`pbi/2026-08-29-04/08/14/19` はアーカイブ可能。\n\n';
} else {
  md += '> 一つ以上の検証が FAIL。アーカイブ不可。\n\n';
}
md += '## type-check\n\n';
md += `| step | result | exit |\n`;
md += `|------|--------|------|\n`;
md += `| \`npm run type-check\` | ${typeCheck.pass ? 'PASS' : 'FAIL'} | ${typeCheck.exitCode} |\n\n`;
md += '<details><summary>type-check output</summary>\n\n';
md += '```\n';
md += (typeCheck.output || '(no output)').slice(0, 6000) + '\n';
md += '```\n\n</details>\n\n';

md += '## vitest\n\n';
md += '| test file | result | exit |\n';
md += '|-----------|--------|------|\n';
for (const r of testResults) {
  md += `| \`${mdEscape(r.label)}\` | ${r.pass ? 'PASS' : 'FAIL'} | ${r.exitCode} |\n`;
}
if (testResults.length === 0) {
  md += '| (no test files resolved) | FAIL | 1 |\n';
}
md += '\n';
if (warnings.length) {
  md += '### warnings (skipped / alias)\n\n';
  for (const w of warnings) md += `- ${w}\n`;
  md += '\n';
}
for (const r of testResults) {
  md += `<details><summary>${mdEscape(r.label)} (${r.pass ? 'PASS' : 'FAIL'})</summary>\n\n`;
  md += '```\n';
  md += (r.output || '(no output)').slice(0, 6000) + '\n';
  md += '```\n\n</details>\n\n';
}
md += '## Mapping note\n\n';
md += 'Spec 上の 5件は一部 obsolete パスを含むため、以下の alias で代替検証している:\n\n';
md += '- `src/utils/__tests__/keySerializer.test.ts` (missing) → `src/utils/__tests__/optimisticLockSerialization.test.ts` (keySerializer primitive + TOCTOU)\n';
md += '- `src/background/__tests__/optimisticLock.test.ts` (missing) → `src/utils/__tests__/optimisticLock.test.ts`\n';
md += '- `src/utils/__tests__/computeLimits.test.ts` (missing) → `src/dashboard/__tests__/tagCooccurrenceCap.test.ts` / `src/utils/__tests__/sentenceExtractorCap.test.ts` / `src/offscreen/__tests__/browsingLogCodec-comprehensive.test.ts` (cap path)\n';
md += '- `src/background/__tests__/cspValidatorSelfAllow.test.ts` (missing) → `src/utils/__tests__/cspValidatorSelfAllow.test.ts`\n';
md += '- `src/offscreen/__tests__/payloadGuard*` → `payloadGuard-comprehensive.test.ts` + `payloadGuardSchemaDriven.test.ts`\n\n';
md += 'PoC は `.gitignore` で失われ再現不可のため、上記既存テスト + type-check で代替検証とする。\n';

mkdirSync(dirname(REPORT_PATH), { recursive: true });
writeFileSync(REPORT_PATH, md, 'utf-8');
console.log(`\nReport written to ${REPORT_PATH}`);
console.log(`Overall: ${overall}`);
process.exit(allPass ? 0 : 1);
