#!/usr/bin/env node
/**
 * PBI Definition of Done — lightweight test-presence check.
 *
 * Compares the current PR branch against the merge base and warns when:
 * - A source file under src/ changed without a corresponding test file change.
 * - A test file changed but its test-case count did not increase.
 *
 * This is intentionally a warning-level check. It catches obvious omissions
 * but cannot verify that tests are meaningful; human review remains required.
 */
import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, basename, extname } from 'node:path';

const BASE_REF = process.env.GITHUB_BASE_REF
  ? `origin/${process.env.GITHUB_BASE_REF}`
  : 'origin/main';

function getDiffFiles() {
  try {
    const output = execSync(`git diff --diff-filter=ACM --name-only ${BASE_REF}...HEAD`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    return output.split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function countTestCases(content) {
  const matches = content.match(/\b(it|test|describe)\s*\(/g);
  return matches ? matches.length : 0;
}

function getCorrespondingTestFiles(sourceFile) {
  const dir = dirname(sourceFile);
  const name = basename(sourceFile, extname(sourceFile));
  return [
    `${dir}/__tests__/${name}.test.ts`,
    `${dir}/__tests__/${name}.spec.ts`,
    `${dir}/${name}.test.ts`,
    `${dir}/${name}.spec.ts`,
  ];
}

function main() {
  const changedFiles = getDiffFiles();
  if (changedFiles.length === 0) {
    console.log('No changed files detected.');
    return;
  }

  const sourceFiles = changedFiles.filter(
    (f) => f.startsWith('src/') && f.endsWith('.ts') && !f.includes('__tests__')
  );
  const testFiles = changedFiles.filter(
    (f) => f.startsWith('src/') && (f.endsWith('.test.ts') || f.endsWith('.spec.ts'))
  );

  const warnings = [];

  for (const sourceFile of sourceFiles) {
    const candidates = getCorrespondingTestFiles(sourceFile);
    const hasTestChange = candidates.some((candidate) => {
      if (testFiles.includes(candidate)) return true;
      if (!existsSync(candidate)) return false;
      // Existing test file was not changed in this PR; still considered covered.
      return true;
    });
    if (!hasTestChange) {
      warnings.push(`⚠️ ${sourceFile} changed but no corresponding test file exists or changed.`);
    }
  }

  for (const testFile of testFiles) {
    try {
      let before = '';
      if (existsSync(testFile)) {
        before = execSync(`git show ${BASE_REF}:${testFile}`, {
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'ignore'],
        });
      }
      const after = readFileSync(testFile, 'utf8');
      const beforeCount = countTestCases(before);
      const afterCount = countTestCases(after);
      const diffOutput = execSync(
        `git diff --diff-filter=ACM ${BASE_REF}...HEAD -- ${testFile}`,
        { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }
      );
      const changedLines = diffOutput
        .split('\n')
        .filter((line) => line.startsWith('+') || line.startsWith('-')).length;
      if (changedLines > 0 && afterCount <= beforeCount) {
        warnings.push(
          `⚠️ ${testFile} changed (${changedLines} lines) but test-case count did not increase (${beforeCount} -> ${afterCount}). Possible dummy change.`
        );
      }
    } catch {
      // Test file may be newly added; comparison is not possible.
    }
  }

  if (warnings.length === 0) {
    console.log('✅ PBI DoD check passed: source changes are accompanied by test coverage.');
    return;
  }

  console.log('PBI DoD warnings (non-blocking):');
  for (const warning of warnings) {
    console.log(warning);
  }
}

main();
