/**
 * SyncTarget.ts
 * EXPERIMENTAL interface for sync targets (currently: Gist only).
 * Each target implements sync/syncBatch/testConnection for its specific API.
 *
 * Status (PBI 2026-10-14-05): experimental — the only active implementation
 * is GistSyncTarget (N=1). Do NOT put Obsidian on this interface without a
 * separate onboarding decision: Obsidian writes are owned by the pipeline's
 * saveToObsidianStep → ObsidianClient.appendToDailyNote, a different route
 * with an incompatible shape (see the signature note on `sync` below).
 * Whether Obsidian can/should adopt SyncTarget is a future decision kept
 * apart from this file; behavior is unchanged by that question.
 */

export interface SyncTarget {
  /**
   * Check if this target is configured (has necessary credentials).
   */
  isConfigured(): Promise<boolean>;

  /**
   * Sync a single record to the target.
   * Returns success status and optional error message.
   *
   * Future Obsidian-onboarding note (comment only, no code change):
   * this record-oriented signature
   * `sync(logId, url, title, summary, markdown?) → { success, error? }`
   * does NOT match `ObsidianClient.appendToDailyNote(content, traceId = '',
   * options = {}) → Promise<void>` (markdown-oriented, void/throw).
   * Bridging them needs an adapter decision (argument mapping plus
   * error-shape conversion), intentionally left open here as input for
   * the eventual Obsidian-onboarding verdict.
   */
  sync(logId: number, url: string, title: string | null, summary: string | null, markdown?: string): Promise<{ success: boolean; error?: string }>;

  /**
   * Process a batch of pending records and sync them.
   * Returns the number of records successfully synced.
   */
  syncBatch(): Promise<number>;

  /**
   * Test the connection to the target.
   */
  testConnection(): Promise<{ success: boolean; message: string }>;
}
