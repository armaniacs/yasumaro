#!/usr/bin/env node

/**
 * Static-analysis metric collection for a single git ref (tag or HEAD).
 * Reads file contents via `git show <ref>:<path>` without checking out
 * the working tree, so it is safe to run against arbitrary historical tags.
 */

import { execFileSync } from 'node:child_process';

export function countLines(content) {
  if (content === '') return 0;
  const trimmed = content.endsWith('\n') ? content.slice(0, -1) : content;
  return trimmed.split('\n').length;
}

export function countTestCalls(content) {
  const matches = content.match(/\b(it|test)\s*\(/g);
  return matches ? matches.length : 0;
}

export function countFunctionDefinitions(content) {
  const functionDeclarations = content.match(/\bfunction\s*\*?\s*[\w$]*\s*\(/g) || [];
  const arrowFunctions = content.match(/=\s*(async\s*)?\([^)]*\)\s*=>/g) || [];
  const arrowFunctionsSingleArg = content.match(/=\s*(async\s*)?[\w$]+\s*=>/g) || [];
  return functionDeclarations.length + arrowFunctions.length + arrowFunctionsSingleArg.length;
}

export function countDependencies(packageJsonContent) {
  const parsed = JSON.parse(packageJsonContent);
  const deps = parsed.dependencies ? Object.keys(parsed.dependencies).length : 0;
  const devDeps = parsed.devDependencies ? Object.keys(parsed.devDependencies).length : 0;
  return deps + devDeps;
}

const SOURCE_FILE_PATTERN = /^(src|entrypoints)\/.*\.(ts|tsx|js)$/;
const TEST_FILE_PATTERN = /\.(test|spec)\.(ts|tsx|js)$/;

export function listSourceFiles(allFilePaths) {
  return allFilePaths.filter((path) => SOURCE_FILE_PATTERN.test(path));
}

export function isTestFile(path) {
  return TEST_FILE_PATTERN.test(path);
}

export async function collectMetricsForRef(ref, git) {
  const allFiles = git.listFiles(ref);
  const sourceFiles = listSourceFiles(allFiles);

  let linesOfCode = 0;
  let fileCount = 0;
  let testCount = 0;
  let functionCount = 0;

  for (const path of sourceFiles) {
    const content = git.readFile(ref, path);
    if (content === undefined) continue;

    fileCount += 1;
    linesOfCode += countLines(content);
    functionCount += countFunctionDefinitions(content);
    if (isTestFile(path)) {
      testCount += countTestCalls(content);
    }
  }

  const packageJsonContent = git.readFile(ref, 'package.json');
  if (packageJsonContent === undefined) {
    console.warn(`${ref}: package.json is not readable, skipping`);
    return null;
  }

  let packageJson;
  try {
    packageJson = JSON.parse(packageJsonContent);
  } catch (error) {
    console.warn(`${ref}: package.json is not valid JSON, skipping (${error.message})`);
    return null;
  }

  return {
    version: packageJson.version,
    tag: ref,
    date: git.getTagDate(ref),
    linesOfCode,
    fileCount,
    testCount,
    functionCount,
    dependencyCount: countDependencies(packageJsonContent),
  };
}

export const realGit = {
  listFiles(ref) {
    const output = execFileSync('git', ['ls-tree', '-r', '--name-only', ref], {
      encoding: 'utf-8',
    });
    return output.split('\n').filter(Boolean);
  },
  readFile(ref, path) {
    try {
      return execFileSync('git', ['show', `${ref}:${path}`], { encoding: 'utf-8' });
    } catch {
      return undefined;
    }
  },
  getTagDate(ref) {
    return execFileSync('git', ['log', '-1', '--format=%aI', ref], { encoding: 'utf-8' }).trim();
  },
};

async function main() {
  const ref = process.argv[2];
  if (!ref) {
    console.error('Usage: node scripts/metrics/collect.mjs <git-ref>');
    process.exit(1);
  }
  const metrics = await collectMetricsForRef(ref, realGit);
  console.log(JSON.stringify(metrics, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
