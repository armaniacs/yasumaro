#!/usr/bin/env node

/**
 * Shared reporter for release-checks.
 *
 * Provides consistent pass/fail/summary output across all check scripts.
 */

const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

let passCount = 0;
let failCount = 0;
let warnCount = 0;
const failures = [];

export function header(title) {
  console.log(`\n${CYAN}${BOLD}═══ ${title} ═══${RESET}`);
}

export function pass(message) {
  passCount++;
  console.log(`${GREEN}✅ ${message}${RESET}`);
}

export function fail(message) {
  failCount++;
  console.log(`${RED}❌ ${message}${RESET}`);
  failures.push(message);
}

export function warn(message) {
  warnCount++;
  console.log(`${YELLOW}⚠️  ${message}${RESET}`);
}

export function info(message) {
  console.log(`  ${message}`);
}

export function summary() {
  console.log(`\n${BOLD}═══════════════════════════════════════${RESET}`);
  console.log(`${BOLD}Release Check Summary${RESET}`);
  console.log(`${BOLD}═══════════════════════════════════════${RESET}`);
  console.log(`  ${GREEN}Passed:${RESET} ${passCount}`);
  console.log(`  ${RED}Failed:${RESET} ${failCount}`);
  console.log(`  ${YELLOW}Warnings:${RESET} ${warnCount}`);

  if (failures.length > 0) {
    console.log(`\n${RED}${BOLD}Failures:${RESET}`);
    for (const f of failures) {
      console.log(`  ${RED}• ${f}${RESET}`);
    }
  }

  const allPassed = failCount === 0;
  console.log(
    `\n${allPassed ? GREEN : RED}${BOLD}${allPassed ? '✅ ALL CHECKS PASSED' : '❌ SOME CHECKS FAILED'}${RESET}\n`
  );
  return allPassed;
}

export function sectionBreak() {
  console.log(`\n${CYAN}───────────────────────────────────────${RESET}`);
}
