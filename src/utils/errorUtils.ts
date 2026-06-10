/**
 * Extract a string message from any error value.
 * Replaces the `error instanceof Error ? error.message : String(error)` pattern.
 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
