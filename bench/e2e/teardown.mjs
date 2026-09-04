/**
 * teardown.mjs — prune bench/reports/ after the e2e bench suite, applying the
 * same retention policy as the micro harness (rolling 5 + weekly anchors).
 * Failures are advisory: a cleanup problem must not fail a finished bench run.
 */
import { pruneReports } from '../harness/clean.mjs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export default function globalTeardown() {
  try {
    const reportsDir = resolve(dirname(fileURLToPath(import.meta.url)), '../reports');
    const deleted = pruneReports(reportsDir);
    if (deleted.length) process.stderr.write(`[bench:e2e] pruned ${deleted.length} old report file(s)\n`);
  } catch (err) {
    process.stderr.write(`[bench:e2e] WARNING: report pruning failed: ${err?.message ?? err}\n`);
  }
}
