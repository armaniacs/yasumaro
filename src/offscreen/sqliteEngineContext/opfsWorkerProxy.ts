/**
 * opfsWorkerProxy.ts
 * Extracted from sqliteEngineContext.ts (PBI-01).
 * Handles OPFS Worker lifecycle: creation, message routing, pending request
 * management, and timeout enforcement.
 */

import { errorMessage } from '../../utils/errorUtils.js';
import { logError, logInfo, logWarn, ErrorCode } from '../../utils/logger.js';
import type { WorkerLogMessage } from '../opfsWorker.js';

function isWorkerLogMessage(
  data: { id: number; success: boolean; result?: unknown; error?: string } | WorkerLogMessage
): data is WorkerLogMessage {
  return '__log' in data && data.__log === true;
}

export interface OpfsProxyState {
  opfsWorker: Worker | null;
  opfsRequestId: number;
  opfsPending: Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>;
}

export function isOpfsAvailable(): boolean {
  try {
    return typeof navigator?.storage?.getDirectory === 'function';
  } catch {
    return false;
  }
}

export function canCreateWorker(): boolean {
  try {
    return 'Worker' in globalThis;
  } catch {
    return false;
  }
}

export function createOpfsWorker(state: OpfsProxyState): Worker | null {
  try {
    const worker = new Worker(
      new URL('../opfsWorker.js', import.meta.url),
      { type: 'module' }
    );

    worker.onmessage = (e: MessageEvent<{ id: number; success: boolean; result?: unknown; error?: string } | WorkerLogMessage>) => {
      const data = e.data;
      if (isWorkerLogMessage(data)) {
        const { level, message, details } = data;
        if (level === 'error') {
          logError(message, details ?? {}, ErrorCode.INTERNAL_ERROR, 'sqlite');
        } else if (level === 'warn') {
          logWarn(message, details ?? {}, undefined, 'sqlite');
        } else {
          logInfo(message, details ?? {}, 'sqlite');
        }
        return;
      }

      const { id, success, result, error } = data;
      const pending = state.opfsPending.get(id);
      if (pending) {
        state.opfsPending.delete(id);
        if (success) {
          pending.resolve(result);
        } else {
          pending.reject(new Error(error || 'OPFS Worker error'));
        }
      }
    };

    worker.onerror = (e: ErrorEvent) => {
      logError('OPFS Worker error', { error: e.message }, ErrorCode.INTERNAL_ERROR, 'sqlite');
      // Reject all pending requests
      for (const [id, pending] of state.opfsPending) {
        pending.reject(new Error(`OPFS Worker error: ${e.message}`));
        state.opfsPending.delete(id);
      }
    };

    return worker;
  } catch (err) {
    logWarn('Failed to create OPFS Worker', { error: errorMessage(err) }, undefined, 'sqlite');
    return null;
  }
}

export function sendToOpfsWorker(state: OpfsProxyState, type: string, payload?: unknown): Promise<unknown> {
  if (!state.opfsWorker) {
    return Promise.reject(new Error('OPFS Worker not available'));
  }

  const id = ++state.opfsRequestId;
  return new Promise((resolve, reject) => {
    state.opfsPending.set(id, { resolve, reject });

    // Timeout after 15 seconds
    const timeout = setTimeout(() => {
      state.opfsPending.delete(id);
      reject(new Error(`OPFS Worker timeout: ${type}`));
    }, 15000);

    const originalResolve = resolve;
    const originalReject = reject;

    state.opfsPending.set(id, {
      resolve: (v) => { clearTimeout(timeout); originalResolve(v); },
      reject: (e) => { clearTimeout(timeout); originalReject(e); },
    });

    state.opfsWorker!.postMessage({ id, type, payload });
  });
}

export async function tryOpfsProxy<T>(state: OpfsProxyState, type: string, payload?: unknown): Promise<T | null> {
  if (!state.opfsWorker) return null;
  try {
    return await sendToOpfsWorker(state, type, payload) as T;
  } catch (err) {
    logWarn(`OPFS Worker call failed (${type}), falling back`, { error: errorMessage(err) }, undefined, 'sqlite');
    return null;
  }
}

export async function initOpfsWorker(state: OpfsProxyState): Promise<boolean> {
  try {
    if (!isOpfsAvailable()) {
      return false;
    }

    if (!canCreateWorker()) {
      return false;
    }

    state.opfsWorker = createOpfsWorker(state);
    if (!state.opfsWorker) {
      return false;
    }

    // Send INIT to the worker
    const result = await sendToOpfsWorker(state, 'INIT') as { initialized: boolean } | undefined;
    if (result?.initialized) {
      return true;
    }

    logWarn('OPFS: Worker INIT returned unexpected result', { result }, undefined, 'sqlite');
    return false;
  } catch (err) {
    logWarn('OPFS: Worker init failed', { error: errorMessage(err) }, undefined, 'sqlite');
    return false;
  }
}

export function terminateOpfsWorker(state: OpfsProxyState): void {
  if (state.opfsWorker) {
    state.opfsWorker.terminate();
    state.opfsWorker = null;
    for (const [, pending] of state.opfsPending) {
      pending.reject(new Error('OPFS Worker terminated'));
    }
    state.opfsPending.clear();
  }
}
