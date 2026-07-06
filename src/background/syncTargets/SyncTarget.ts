/**
 * SyncTarget.ts
 * Interface for sync targets (Obsidian, Gist, etc.).
 * Each target implements sync/syncBatch/testConnection for its specific API.
 */

export interface SyncTarget {
  /**
   * Check if this target is configured (has necessary credentials).
   */
  isConfigured(): Promise<boolean>;

  /**
   * Sync a single record to the target.
   * Returns true if synced, false if skipped or failed.
   */
  sync(logId: number, url: string, title: string | null, summary: string | null, markdown?: string): Promise<boolean>;

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
