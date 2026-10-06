/**
 * wireLambdaFactories.ts
 *
 * Shared single-element lambdas for the wire tables (PBI 2026-10-06-17).
 *
 * The sqlite and archive wire tables repeated the same trivial lambdas
 * (`() => null`, `() => ({})`, `(p) => [p.id as number]`, ...) in dozens
 * of rows. Inline copies make "intentionally empty" indistinguishable from
 * "forgotten" during review and become the copy-paste source for new rows.
 * Each name below documents the intent at the use site instead.
 *
 * Neutral placement: same rule as both wire tables — this file must not
 * import from offscreen or background. It imports nothing on purpose.
 *
 * These are functions returning a fresh value per call, not shared
 * constants: callers spread or mutate the results, so a single shared
 * object/array would leak state across ops.
 */

/** Payload shape check that accepts everything (no constraints on this op). */
export function noValidate(): string | null {
  return null;
}

/** Projects deps/worker data into an intentionally empty wire field set. */
export function emptyProject(): Record<string, unknown> {
  return {};
}

/** Wire payload for ops that send no fields (bare message, no params). */
export function emptyPayload(): Record<string, unknown> {
  return {};
}

/** Positional args for ops that take no backend/deps params. */
export function emptyArgs(): unknown[] {
  return [];
}

/** Positional id arg for single-row ops (delete/toggleStar). */
export function idArg(payload: Record<string, unknown>): unknown[] {
  return [payload.id as number];
}

/** Positional staging-name arg for single-session archive ops. */
export function stagingNameArg(payload: Record<string, unknown>): unknown[] {
  return [payload.stagingName as string];
}

/** Decoder for ops whose success carries no public value. */
export function voidDecode(): undefined {
  return undefined;
}

/** Decoder for ops that project a bare success to true (init/healthCheck). */
export function trueDecode(): true {
  return true;
}
