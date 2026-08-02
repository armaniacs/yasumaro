#!/usr/bin/env node

/**
 * Static-analysis metric collection for a single git ref (tag or HEAD).
 * Reads file contents via `git show <ref>:<path>` without checking out
 * the working tree, so it is safe to run against arbitrary historical tags.
 */

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
