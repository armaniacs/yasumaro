/**
 * digestBatchAlarm.ts
 *
 * Production wiring for the resumable weekly digest batch (PBI
 * 2026-10-22-03, batch wiring): the alarm table's short-interval tick
 * (yasumaro-review-digest-batch, 5-minute staticSchedule — the same cadence
 * as yasumaro-offline-network-retry) re-invokes runDigestBatch until the
 * week's completion marker exists, so a kill mid-run resumes within minutes
 * instead of waiting for the next weekly firing.
 *
 * 結合時の受入条件 (PBI なぜなぜ分析・運用観点の 5 則):
 * - 他期間の検査点は捨てる: runDigestBatch discards a checkpoint whose
 *   periodKey no longer matches (and the pre-check below drops a dead
 *   checkpoint for an already-completed week).
 * - 発行失敗で標識を書かない: runDigestBatch keeps the checkpoint when
 *   publishDigest returns false, so the next tick retries without a marker.
 * - 停止判定は畳み込み中に見る: isStale() is the run token below — a newer
 *   tick invalidates the previous run, whose fold then stops at the next
 *   entry boundary and checkpoints.
 * - 設定は実行時に再読込: the setting and the privacy consent are re-read
 *   on every tick, so a tick armed while the setting was on must not
 *   continue after a withdrawal. The fold is local-only (joined summaries,
 *   no external send) and the checkpoint holds ids only, so progress is
 *   kept on withdrawal and the eventual publish re-checks consent inside
 *   the weekly generator.
 * - 記録パイプライン不接触: no shared mutex, no shared storage keys — the
 *   checkpoint is a module-owned key and the recording pipeline's keys and
 *   mutex are never touched.
 *
 * 標識統一 (no double publish): the batch's completion marker IS the weekly
 * generator's REVIEW_SUMMARY_LAST_GENERATED_WEEK key. Both paths guard the
 * same single key with the same 'YYYY-Www' value:
 * - The batch publishes first → the generator writes the marker inside
 *   publishDigest → the weekly alarm's later run sees it and skips.
 * - The weekly alarm publishes first → the batch's pre-check below sees the
 *   marker and returns before fetching.
 * so exactly one publisher per week wins and the digest is never published
 * twice.
 *
 * AI fold の完全統合は後続 (PBI に残す): the fold here is a pure local join
 * of the period's summaries (no AI call, no external send — the local_only
 * contract holds), and the publish step delegates to the existing weekly
 * generation, which fetches its own period and makes the single AI call it
 * makes today. The folded digest is therefore not yet consumed; consuming
 * the folded chunks as incremental AI folds is the deferred follow-up and
 * rides this module's publishDigest seam.
 */

import { runDigestBatch, type DigestBatchEntry } from './digestBatchJob.js';
import { buildWeekPeriod } from './reviewSummaryGenerator.js';
import { createProductionDigestBatchCheckpointStore } from './digestBatchCheckpointStore.js';
import type { DigestCheckpointStore } from './digestBatchJob.js';
import { StorageKeys } from '../utils/storage/types.js';
import { LogType } from '../utils/logger/types.js';
import { addLog } from '../utils/logger/core.js';
import { CHROME_STORAGE_PORT } from '../utils/ports.js';
import { MAX_QUERY_ROWS } from '../utils/computeLimits.js';
import type { BrowsingLogRecord } from '../utils/sqlite-types.js';
import type { AlarmHandlerDeps } from './alarmRegistry.js';

/**
 * Entries digested per alarm tick. 下限助言 200 以上: the running digest is
 * refolded from the checkpoint on every tick, so the per-tick cost is
 * O(entries) cheap folds — 200 keeps a capped 10k-entry period at ~50 ticks,
 * not thousands.
 */
export const DIGEST_BATCH_CHUNK_SIZE = 200;

/** Latest run token — a newer tick invalidates the previous run's fold. */
let latestRunToken = 0;

/**
 * One alarm tick of the weekly digest batch. All gates are re-read at
 * execution time (tick-armed-under-old-settings protection); the work is a
 * single runDigestBatch chunk with the production checkpoint store.
 */
export async function runReviewDigestBatch(deps: AlarmHandlerDeps): Promise<void> {
  const token = ++latestRunToken;
  const isStale = (): boolean => token !== latestRunToken;

  // 設定は実行時に再読込 (受入条件 5): the tick fires unconditionally (the
  // offline-retry precedent), so the gate lives here, re-read per firing.
  const settings = await deps.settingsReader.getAll();
  if (!settings[StorageKeys.REVIEW_SUMMARY_ENABLED]) return;
  if (!(await deps.isConsentGranted())) return;

  const store: DigestCheckpointStore = createProductionDigestBatchCheckpointStore(
    deps.settingsReader,
    deps.settingsWriter,
    deps.digestBatchStorage ?? CHROME_STORAGE_PORT.local,
  );

  // The same period as the existing weekly path: buildWeekPeriod is the
  // single owner of the 'YYYY-Www' key + window, so the batch and the
  // weekly alarm guard the same marker value.
  const period = buildWeekPeriod(new Date());

  // Shared-marker pre-check: a completed week must never re-publish (the
  // weekly alarm won, or this batch already finished). The checkpoint for a
  // completed week is dead progress — drop it so storage stays clean.
  if ((await store.loadCompletedPeriod()) === period.storageKey) {
    await store.clearCheckpoint();
    return;
  }

  // Same fetch route as generatePeriodSummary (dateFrom/dateTo over the
  // week window, the plain 10000-row cap): no new SQLite query.
  const queryRes = await deps.sqliteClient.query({
    dateFrom: period.start,
    dateTo: period.end,
    limit: MAX_QUERY_ROWS,
  });
  if (!queryRes.success) {
    // Transient: the next tick re-reads. WARN (not ERROR) — the tick is a
    // 5-minute retry loop, and a persistent failure stays visible per tick
    // without escalating the log.
    addLog(LogType.WARN, 'Review digest batch skipped: period query failed', {
      weekKey: period.storageKey,
      error: queryRes.error.message,
    });
    return;
  }

  // Same entry rule as the weekly generator (summaries only), oldest first
  // so a resumed fold is deterministic across kills.
  const entries: DigestBatchEntry[] = queryRes.data.rows
    .filter((row): row is BrowsingLogRecord & { id: number } =>
      typeof row.id === 'number' && Boolean(row.summary))
    .sort((a, b) => a.created_at - b.created_at || a.id - b.id)
    .map((row) => ({ id: row.id, summary: row.summary ?? '' }));

  // Nothing to digest: the weekly generator skips empty periods the same
  // way and leaves the marker untouched, so an empty week must not pin the
  // batch into a publish loop.
  if (entries.length === 0) return;

  await runDigestBatch({
    store,
    entries,
    periodKey: period.storageKey,
    chunkSize: DIGEST_BATCH_CHUNK_SIZE,
    // Pure local fold (joined summaries): no AI call, no external send.
    foldEntry: (digest, entry) => (digest === '' ? entry.summary : `${digest}\n\n${entry.summary}`),
    publishDigest: async (periodKey) => {
      // The week flipped between the fold and this publish: the folded
      // digest belongs to a period that already ended and the current week
      // has its own flow — refuse to publish a stale period (他期間の検査点は
      // 捨てる). runDigestBatch keeps the checkpoint; the next tick computes
      // the new periodKey and discards it.
      if (buildWeekPeriod(new Date()).storageKey !== periodKey) return false;
      // The existing weekly generation stays the only publisher: it
      // re-checks the setting/consent/marker, generates the digest, and
      // writes REVIEW_SUMMARY_LAST_GENERATED_WEEK through the
      // blob-authoritative repo.set seam on success.
      return deps.reviewSummaryGenerator.generateWeeklySummary();
    },
    isStale,
  });
}
