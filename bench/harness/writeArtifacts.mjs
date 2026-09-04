/**
 * writeArtifacts.mjs — report artifact set for one bench run.
 *
 * Owns the write policy (stamp, mkdir, .md/.json/.html, trend injection,
 * prune) so cli.mjs main() stays orchestration-only: bench loop -> compare ->
 * writeReportArtifacts -> check/update-baseline.
 *
 * All failures here are advisory: the bench run itself already succeeded, so
 * every stage warns on stderr and never throws.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderMarkdown } from './report.mjs';
import { renderHtml } from './htmlReport.mjs';
import { loadTrendHistory } from './trend.mjs';
import { pruneReports } from './clean.mjs';

/**
 * Write the .md/.json/.html artifact set for one run and prune stale generations.
 * @param {{ results: Awaited<ReturnType<import('./runner.mjs').bench>>[], comparison: ReturnType<import('./report.mjs').compareToBaseline> | undefined, reportsDir: string, now: Date }} args
 * @returns {{ reportPath: string, htmlPath: string, jsonPath: string }}
 */
export function writeReportArtifacts({ results, comparison, reportsDir, now }) {
  const stamp = now.toISOString().slice(0, 10);
  const reportPath = resolve(reportsDir, `micro-${stamp}.md`);
  const htmlPath = resolve(reportsDir, `micro-${stamp}.html`);
  const jsonPath = resolve(reportsDir, `micro-${stamp}.json`);

  try {
    mkdirSync(reportsDir, { recursive: true });
  } catch (err) {
    process.stderr.write(`[bench] WARNING: report directory creation failed: ${err?.message ?? err}\n`);
    return { reportPath, htmlPath, jsonPath };
  }

  try {
    writeFileSync(reportPath, renderMarkdown(results, { comparison }), 'utf8');
  } catch (err) {
    process.stderr.write(`[bench] WARNING: markdown report generation failed: ${err?.message ?? err}\n`);
  }

  // All modes produce the same artifact set (.md/.html/.json); failures here
  // are advisory — the bench run itself already succeeded.
  try {
    const payload = {
      schemaVersion: 1,
      generatedAt: now.toISOString(),
      node: process.version,
      results,
      comparison: comparison ?? null,
    };
    // Write today's json BEFORE loading history so the current run appears as
    // the newest trend generation.
    writeFileSync(jsonPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
    const history = loadTrendHistory(reportsDir);
    writeFileSync(htmlPath, renderHtml(results, { comparison, history }), 'utf8');
    process.stderr.write(`[bench] report -> ${reportPath} (+ .html / .json)\n`);
  } catch (err) {
    process.stderr.write(`[bench] WARNING: html/json report generation failed: ${err?.message ?? err}\n`);
  }

  try {
    const deleted = pruneReports(reportsDir);
    if (deleted.length) process.stderr.write(`[bench] pruned ${deleted.length} old report file(s)\n`);
  } catch (err) {
    process.stderr.write(`[bench] WARNING: report pruning failed: ${err?.message ?? err}\n`);
  }

  return { reportPath, htmlPath, jsonPath };
}
