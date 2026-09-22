/**
 * withRuntimeTimeout.ts — shared Promise.race timeout seam for the runtime
 * message gateways (pendingRecordGateway + regenerateSummaryGateway).
 *
 * Owns exactly two things both gateways duplicated by copy-paste:
 * - the race between a chrome.runtime.sendMessage promise and a timer;
 * - cleanup + SAFE rejection semantics — `op` is marked handled up front, so
 *   when the timeout wins the race the late rejection of `op` cannot surface
 *   as an unhandled rejection (Node/Vitest "Unhandled Errors").
 *
 * Envelope construction and response normalization stay at the call sites —
 * they differ per message type.
 */
export async function withRuntimeTimeout<T>(
  op: Promise<T>,
  timeoutMs: number,
  timeoutError: Error,
): Promise<T> {
  // Mark handled immediately; Promise.race still observes the original
  // rejection for its own settlement.
  void op.catch(() => undefined);

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      op,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(timeoutError), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}
