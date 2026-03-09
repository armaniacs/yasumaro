#!/usr/bin/env node

/**
 * Documentation Path Consistency Test
 *
 * Verifies that file references in documentation match actual project structure.
 * This is particularly important after TypeScript migration where .js files
 * should now be .ts files and all source files live under src/.
 */

import fs from 'fs';
import path from 'path';

// Configuration
const PROJECT_ROOT = process.cwd();
const DOCS_TO_CHECK = [
  'AGENTS.md',
  'README.md',
  // Note: CONTRIBUTING.md is checked separately (not in this PR)
];

// Common patterns
const FILE_REFERENCE_PATTERNS = [
  // Path in backticks: `src/background/service-worker.ts`
  /`([a-zA-Z0-9_/.-]+\.(?:js|ts))`/g,
  // Path in parentheses: (src/popup/main.ts)
  /\(([a-zA-Z0-9_/.-]+\.(?:js|ts))\)/g,
];

// Known exceptions (files that legitimately have .js in docs)
const KNOWN_JS_EXCEPTIONS: string[] = [
  // Note: Imports in code examples use .js for TypeScript ESM resolution
  // These are not actual file references but import syntax
];

/**
 * Check if a file exists
 */
function fileExists(filePath: string): boolean {
  const absolutePath = path.join(PROJECT_ROOT, filePath);
  return fs.existsSync(absolutePath);
}

/**
 * Extract file references from markdown content
 */
function extractFileReferences(content: string, docName: string): string[] {
  const references = [];

  for (const pattern of FILE_REFERENCE_PATTERNS) {
    let match;
    const regex = new RegExp(pattern.source, pattern.flags);
    while ((match = regex.exec(content)) !== null) {
      references.push(match[1]);
    }
  }

  return references;
}

/**
 * Check a single reference
 */
function checkReference(reference: string, docName: string): { type: string; message: string }[] {
  const issues: { type: string; message: string }[] = [];

  // Check 1: File should exist
  if (!fileExists(reference)) {
    issues.push({
      type: 'missing_file',
      message: `File does not exist: ${reference}`,
    });
  }

  // Check 2: Should use .ts extension (not .js)
  if (reference.endsWith('.js')) {
    // Check if this is in KNOWN_JS_EXCEPTIONS
    const isException = KNOWN_JS_EXCEPTIONS.some(ex =>
      reference.includes(ex)
    );

    if (!isException) {
      // Check if .ts version exists
      const tsVersion = reference.replace(/\.js$/, '.ts');
      if (fileExists(tsVersion)) {
        issues.push({
          type: 'wrong_extension',
          message: `Uses .js extension but .ts exists: ${reference} (should be ${tsVersion})`,
        });
      }
    }
  }

  // Check 3: Source files should be under src/
  if (reference.startsWith('popup/') ||
      reference.startsWith('background/') ||
      reference.startsWith('content/') ||
      reference.startsWith('utils/') ||
      reference.startsWith('dashboard/') ||
      reference.startsWith('offscreen/')) {

    const srcVersion = `src/${reference}`;
    if (fileExists(srcVersion)) {
      issues.push({
        type: 'missing_src_prefix',
        message: `Missing src/ prefix: ${reference} (should be ${srcVersion})`,
      });
    }
  }

  return issues;
}

/**
 * Process a single documentation file
 */
function processDocumentation(docName: string): { document: string; totalReferences: number; issues: { type: string; message: string; reference: string; document: string }[] } | null {
  const docPath = path.join(PROJECT_ROOT, docName);

  if (!fs.existsSync(docPath)) {
    console.error(`❌ Documentation file not found: ${docPath}`);
    return null;
  }

  const content = fs.readFileSync(docPath, 'utf-8');
  const references = extractFileReferences(content, docName);

  const allIssues: { type: string; message: string; reference: string; document: string }[] = [];
  const uniqueRefs = new Set(references);

  for (const ref of uniqueRefs) {
    const issues = checkReference(ref, docName);
    if (issues.length > 0) {
      issues.forEach(issue => {
        allIssues.push({
          reference: ref,
          ...issue,
          document: docName,
        });
      });
    }
  }

  return {
    document: docName,
    totalReferences: uniqueRefs.size,
    issues: allIssues,
  };
}

/**
 * Main execution
 */
function main() {
  console.log('🔍 Documentation Path Consistency Test');
  console.log(`📁 Project root: ${PROJECT_ROOT}`);
  console.log('');

  const results = [];

  for (const docName of DOCS_TO_CHECK) {
    console.log(`📄 Checking ${docName}...`);
    const result = processDocumentation(docName);
    if (result) {
      results.push(result);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('📊 Summary');
  console.log('='.repeat(60));

  let totalIssues = 0;
  let missingFiles = 0;
  let wrongExtensions = 0;
  let missingSrcPrefix = 0;

  for (const result of results) {
    console.log(`\n📄 ${result.document}:`);
    console.log(`   Total references: ${result.totalReferences}`);

    if (result.issues.length === 0) {
      console.log('   ✅ No issues found');
    } else {
      console.log(`   ❌ ${result.issues.length} issue(s) found:`);
      result.issues.forEach(issue => {
        console.log(`\n   • ${issue.message}`);
        console.log(`     Type: ${issue.type}`);
      });
      totalIssues += result.issues.length;
    }

    // Count by type
    result.issues.forEach(issue => {
      if (issue.type === 'missing_file') missingFiles++;
      if (issue.type === 'wrong_extension') wrongExtensions++;
      if (issue.type === 'missing_src_prefix') missingSrcPrefix++;
    });
  }

  console.log('\n' + '='.repeat(60));
  console.log('📈 Overall Results');
  console.log('='.repeat(60));
  console.log(`Total issues found: ${totalIssues}`);
  console.log(`  - Missing files: ${missingFiles}`);
  console.log(`  - Wrong extensions: ${wrongExtensions}`);
  console.log(`  - Missing src/ prefix: ${missingSrcPrefix}`);

  console.log('');
  if (totalIssues === 0) {
    console.log('✅ All documentation file references are valid!');
    process.exit(0);
  } else {
    console.log(`❌ ${totalIssues} issue(s) found in documentation. Please review and fix.`);
    process.exit(1);
  }
}

// Run the script
main();