/**
 * alarmRegistryRefs.ts (PBI 2026-09-15-15)
 *
 * Module-level refs for alarm jobs that need deps outside AlarmHandlerDeps.
 * The composition root (service-worker.ts) injects these once at startup.
 * Split from alarmRegistry.ts to avoid a circular import (reviewSummary
 * Generator → alarmRegistry → reviewSummaryGenerator).
 */

import type { ReviewSummaryGenerator } from './reviewSummaryGenerator.js';

export let reviewSummaryGeneratorRef: ReviewSummaryGenerator | null = null;
export let sessionTimeoutInstallRef: (() => Promise<void>) | null = null;
export let sessionTimeoutRunRef: (() => Promise<void>) | null = null;

export function setReviewSummaryGeneratorRef(gen: ReviewSummaryGenerator): void {
  reviewSummaryGeneratorRef = gen;
}
export function setSessionTimeoutRefs(install: () => Promise<void>, run: () => Promise<void>): void {
  sessionTimeoutInstallRef = install;
  sessionTimeoutRunRef = run;
}
