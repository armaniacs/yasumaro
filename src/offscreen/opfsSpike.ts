/**
 * opfsSpike.ts
 * OPFS feasibility spike harness (PBI-10).
 *
 * Runs an end-to-end check of strategy 案B (OriginPrivateFileSystemVFS on the
 * offscreen main thread): open DB → create table → insert → select → FTS5 → verify
 * persistence. Intended for manual verification in a real Chrome MV3 offscreen
 * document; the step-orchestration is unit-tested, the wa-sqlite/OPFS run is not.
 */

import { errorMessage } from '../utils/errorUtils.js';
import { detectLiveVfsStrategy, type VfsStrategy } from './opfsCapabilities.js';

export interface SpikeStep {
  name: string;
  /** Runs the step. Return a human-readable detail string, or nothing. Throw to fail. */
  run: () => Promise<string | void>;
}

export interface SpikeStepResult {
  name: string;
  ok: boolean;
  detail: string;
}

export interface OpfsSpikeReport {
  strategy: VfsStrategy;
  steps: SpikeStepResult[];
  passed: boolean;
  durationMs: number;
}

/**
 * Run spike steps sequentially, stopping at the first failure.
 * `passed` is true only when every step ran and succeeded.
 */
export async function runSpikeSteps(steps: SpikeStep[]): Promise<{ steps: SpikeStepResult[]; passed: boolean }> {
  const results: SpikeStepResult[] = [];
  for (const step of steps) {
    try {
      const detail = await step.run();
      results.push({ name: step.name, ok: true, detail: detail ?? '' });
    } catch (err) {
      results.push({ name: step.name, ok: false, detail: errorMessage(err) });
      break;
    }
  }
  const passed = results.length === steps.length && results.every((r) => r.ok);
  return { steps: results, passed };
}

const SPIKE_DB_FILENAME = 'opfs-spike.db';
const SPIKE_VFS_NAME = 'opfs';
const WORKER_SPIKE_TIMEOUT_MS = 15000;

/**
 * Execute the 案A end-to-end OPFS spike: spawn a Worker that runs wa-sqlite with
 * AccessHandlePoolVFS (createSyncAccessHandle is only permitted inside a Worker).
 * Also verifies that WXT/Vite can bundle a Worker for the offscreen document.
 */
export function runOpfsSpikeA(): Promise<OpfsSpikeReport> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./opfsWorker.js', import.meta.url), { type: 'module' });
    } catch (err) {
      reject(new Error(`Worker construction failed: ${errorMessage(err)}`));
      return;
    }
    const timeout = setTimeout(() => {
      worker.terminate();
      reject(new Error(`OPFS worker spike timed out after ${WORKER_SPIKE_TIMEOUT_MS}ms`));
    }, WORKER_SPIKE_TIMEOUT_MS);

    worker.onmessage = (e: MessageEvent) => {
      clearTimeout(timeout);
      worker.terminate();
      resolve(e.data as OpfsSpikeReport);
    };
    worker.onerror = (e: ErrorEvent) => {
      clearTimeout(timeout);
      worker.terminate();
      reject(new Error(`Worker error: ${e.message || 'unknown'}`));
    };
    worker.postMessage('run');
  });
}

