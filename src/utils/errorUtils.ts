// @layer 0 — Foundation (pure, no dependencies)
/**
 * Extract a string message from any error value.
 * Replaces the `error instanceof Error ? error.message : String(error)` pattern.
 *
 * Retained as-is (PBI-2026-08-12-07): the deletion test confirms value.
 * Removing this function would scatter `error instanceof Error ? error.message
 * : String(error)` across its ~58 call sites — the complexity re-appears, so the
 * function earns its keep (concentrates, does not just move). It is a pure
 * function with no state and no variation, so there is no interface to deepen.
 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Normalize any thrown value into an Error for re-throw.
 * Error instances are returned as-is (stack preserved); every other value is
 * wrapped in a new Error carrying `errorMessage(value)`.
 *
 * Canonical replacement (PBI 2026-10-20-02) for the scattered
 * `error instanceof Error ? error : new Error(String(error))` re-wrap, whose
 * four independent implementations disagreed on stack preservation.
 */
export function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(errorMessage(error));
}
