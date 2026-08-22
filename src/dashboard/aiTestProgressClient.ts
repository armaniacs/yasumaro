/**
 * aiTestProgressClient.ts
 * Deep module for consuming AI_TEST_PROGRESS broadcasts: listener
 * registration, message-shape guard, and runId correlation live here so
 * that a second UI surface can subscribe without re-implementing them.
 *
 * Extracted out of generalSettings/connectionTests.ts.
 */

import { AI_TEST_PROGRESS_MESSAGE_TYPE, type AiTestProgressMessage } from '../background/aiTestProgressNotifier.js';
import type { AiTestProgress } from '../background/ai/AIService.js';

export interface SubscribeAiTestProgressOptions {
  /** Milliseconds without a fresh progress event before onTimeout fires. Omit to disable. */
  timeoutMs?: number;
  onTimeout?: () => void;
}

/**
 * Runtime shape guard for AI_TEST_PROGRESS: the broadcast reaches every
 * extension context, so a malformed/forged message must not corrupt a
 * consumer's UI.
 */
function isAiTestProgressMessage(message: unknown): message is AiTestProgressMessage {
  if (
    typeof message !== 'object' ||
    message === null ||
    (message as { type?: unknown }).type !== AI_TEST_PROGRESS_MESSAGE_TYPE
  ) {
    return false;
  }
  const progress = (message as AiTestProgressMessage).progress;
  return (
    typeof progress === 'object' &&
    progress !== null &&
    typeof progress.provider === 'string' &&
    Number.isInteger(progress.index) &&
    progress.index >= 0 &&
    Number.isInteger(progress.total) &&
    progress.total >= 0 &&
    (progress.model === undefined || typeof progress.model === 'string')
  );
}

/**
 * Subscribe to AI_TEST_PROGRESS broadcasts for one test run (identified by
 * runId). Progress from other runs (e.g. a concurrent Dashboard tab) and
 * messages from other extensions are discarded. Call the returned function
 * to stop listening and clear the timeout.
 */
export function subscribeAiTestProgress(
  runId: string,
  onProgress: (progress: AiTestProgress) => void,
  options: SubscribeAiTestProgressOptions = {},
): () => void {
  const { timeoutMs, onTimeout } = options;

  const listener = (message: unknown, sender: chrome.runtime.MessageSender): void => {
    // Accept only messages originating from this extension AND from this
    // run (guards against concurrent Dashboard tabs overwriting state).
    if (sender?.id !== chrome.runtime.id) return;
    if (isAiTestProgressMessage(message) && message.progress.runId === runId) {
      onProgress(message.progress);
    }
  };

  chrome.runtime.onMessage.addListener(listener);

  const timer = timeoutMs !== undefined
    ? setTimeout(() => onTimeout?.(), timeoutMs)
    : undefined;

  return () => {
    chrome.runtime.onMessage.removeListener(listener);
    if (timer !== undefined) clearTimeout(timer);
  };
}
