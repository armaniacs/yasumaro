/**
 * byteFormat.ts — SSOT of the dashboard byte-size display policy (PBI
 * 2026-09-25-07).
 *
 * WHY: the dashboard carried three byte-formatting definitions with two
 * different policies (4 significant digits with a fractional-KB floor, and
 * 1 decimal without a GB tier), so the same byte count rendered differently
 * depending on the screen. One policy, one definition, one import path.
 *
 * Policy: raw integer below 1 KB, fixed 1-decimal fraction from 1 KB up, and
 * a GB tier. Unit literals are fixed B/KB/MB/GB — no i18n, no locale.
 *
 * WHY the unit table is derived from KB instead of re-spelled: the
 * cap-registry drift guard reads a literal 1 MiB assignment as
 * MAX_ERROR_BODY_SIZE, so a display policy written that way would have to
 * borrow the message-size allowlist. A byte formatter must not hold a
 * message-pipeline exemption.
 */

const KB = 1024;
const MB = KB * KB;
const GB = MB * KB;

/** Descending unit table — the SSOT of the printed unit. */
const UNITS = [
  { scale: GB, unit: 'GB' },
  { scale: MB, unit: 'MB' },
  { scale: KB, unit: 'KB' },
] as const;

/**
 * Format a byte count for dashboard display.
 *
 * The unit is the largest one whose 1-decimal-rounded value is still >= 1, so
 * the printed number can never contradict the unit it is printed with
 * (1_048_575 B reads "1.0 MB", not "1024.0 KB"). `UNITS[2]` is the fallback
 * for the unreachable case and is the finest unit regardless.
 *
 * Non-finite and negative inputs are not filtered here: this is a pure
 * formatter and every caller owns its domain check (`describeDelta` rejects a
 * non-positive original, `computeCleansingReduction` rejects a 0 base,
 * `computeCleansingStats` sums integer byte counts).
 */
export function formatBytes(bytes: number): string {
  if (bytes < KB) return `${bytes} B`;

  const tier = UNITS.find(
    ({ scale }) => Math.round((bytes / scale) * 10) / 10 >= 1,
  ) ?? UNITS[2];

  return `${(bytes / tier.scale).toFixed(1)} ${tier.unit}`;
}
