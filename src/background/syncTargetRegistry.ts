/**
 * syncTargetRegistry.ts
 * Manages all SyncTarget implementations and provides parallel sync execution.
 * Uses Promise.allSettled to isolate failures between targets.
 */

import type { SyncTarget } from './syncTargets/SyncTarget.js';

export class SyncTargetRegistry {
  private targets: Map<string, SyncTarget> = new Map();

  /**
   * Register a sync target with a unique key.
   */
  register(key: string, target: SyncTarget): void {
    this.targets.set(key, target);
  }

  /**
   * Unregister a sync target.
   */
  unregister(key: string): void {
    this.targets.delete(key);
  }

  /**
   * Get all registered targets.
   */
  getAll(): Map<string, SyncTarget> {
    return new Map(this.targets);
  }

  /**
   * Sync a single record to all configured targets in parallel.
   * Returns results keyed by target name.
   */
  async syncAll(
    logId: number,
    url: string,
    title: string | null,
    summary: string | null,
    markdown?: string,
  ): Promise<Record<string, { success: boolean; error?: string }>> {
    const results: Record<string, { success: boolean; error?: string }> = {};

    const tasks = Array.from(this.targets.entries()).map(async ([key, target]) => {
      const configured = await target.isConfigured();
      if (!configured) {
        results[key] = { success: true, error: undefined };
        return;
      }
      return { key, target };
    });

    const configuredTargets = (await Promise.all(tasks)).filter(Boolean) as Array<{ key: string; target: SyncTarget }>;

    const syncPromises = configuredTargets.map(async ({ key, target }) => {
      try {
        results[key] = await target.sync(logId, url, title, summary, markdown);
      } catch (error) {
        results[key] = { success: false, error: String(error) };
      }
    });

    await Promise.allSettled(syncPromises);
    return results;
  }

  /**
   * Process a batch of pending records for all configured targets.
   */
  async syncBatchAll(): Promise<Record<string, number>> {
    const results: Record<string, number> = {};

    const tasks = Array.from(this.targets.entries()).map(async ([key, target]) => {
      const configured = await target.isConfigured();
      if (!configured) {
        results[key] = 0;
        return;
      }

      try {
        const count = await target.syncBatch();
        results[key] = count;
      } catch {
        results[key] = 0;
      }
    });

    await Promise.allSettled(tasks);
    return results;
  }

  /**
   * Test connections for all configured targets.
   */
  async testAllConnections(): Promise<Record<string, { success: boolean; message: string }>> {
    const results: Record<string, { success: boolean; message: string }> = {};

    const tasks = Array.from(this.targets.entries()).map(async ([key, target]) => {
      results[key] = await target.testConnection();
    });

    await Promise.allSettled(tasks);
    return results;
  }
}
