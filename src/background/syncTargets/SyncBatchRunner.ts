/**
 * SyncBatchRunner.ts
 * Shared batch-sync policy for SyncTarget implementations (Gist, Obsidian).
 * Centralizes BATCH_SIZE and the listPending -> sync -> markSynced loop so
 * individual targets only implement their own I/O (fetch pending rows, mark one row synced).
 */

import { addLog, LogType } from '../../utils/logger.js';
import { errorMessage } from '../../utils/errorUtils.js';

/** Minimal row shape the runner needs to drive a sync call. */
export interface PendingSyncRow {
  id: number;
  url: string;
  title: string | null;
  summary: string | null;
}

/**
 * Port for fetching pending rows for one sync target.
 * `limit` is supplied by the runner (BATCH_SIZE policy lives here, not in callers).
 */
export type ListPending = (limit: number) => Promise<PendingSyncRow[]>;

/** Port for syncing (and marking synced) one row for one sync target. */
export type MarkSynced = (row: PendingSyncRow) => Promise<boolean>;

export interface SyncBatchRunnerOptions {
  /** Label used in log messages, e.g. 'GistSync' / 'ObsidianSync'. */
  targetName: string;
  listPending: ListPending;
  markSynced: MarkSynced;
  /** Max rows fetched per iteration. Runner-wide policy (was duplicated per target). */
  batchSize?: number;
  /** Max iterations to guard against unbounded loops when more pending rows keep arriving. */
  maxIterations?: number;
}

const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_MAX_ITERATIONS = 100;

export class SyncBatchRunner {
  private readonly targetName: string;
  private readonly listPending: ListPending;
  private readonly markSynced: MarkSynced;
  private readonly batchSize: number;
  private readonly maxIterations: number;

  constructor(options: SyncBatchRunnerOptions) {
    this.targetName = options.targetName;
    this.listPending = options.listPending;
    this.markSynced = options.markSynced;
    this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    this.maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  }

  /**
   * Runs the batch loop: fetch up to batchSize pending rows, sync each via markSynced,
   * repeat until no rows remain or maxIterations is reached.
   * Returns the total number of rows successfully synced.
   */
  async run(): Promise<number> {
    let totalSynced = 0;

    try {
      for (let iteration = 0; iteration < this.maxIterations; iteration++) {
        const rows = await this.listPending(this.batchSize);
        if (rows.length === 0) {
          break;
        }

        let batchSynced = 0;
        for (const row of rows) {
          const success = await this.markSynced(row);
          if (success) {
            batchSynced++;
          }
        }

        totalSynced += batchSynced;

        // WHY: rows are re-queried each iteration (not paged via offset), so when a target
        // has an unbounded backlog batchSynced === 0 (all attempts failed) must stop the loop
        // -- otherwise the runner would refetch the same unsynced rows forever.
        if (batchSynced === 0) {
          break;
        }
      }

      if (totalSynced > 0) {
        addLog(LogType.INFO, `${this.targetName}: batch completed`, { synced: totalSynced });
      }

      return totalSynced;
    } catch (error) {
      addLog(LogType.WARN, `${this.targetName}: batch failed`, {
        error: errorMessage(error),
      });
      throw error;
    }
  }
}
