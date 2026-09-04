/**
 * format.mjs — shared number formatting for the Markdown and HTML renderers.
 * Single source of truth so the two reports never drift apart.
 */

/**
 * Compact number rendering: 0 decimals from 1000 up, 3 decimals from 1 up,
 * 3 significant digits below 1, em-dash for missing values.
 * @param {number} v
 * @param {string} [unit]
 */
export function fmtNum(v, unit = '') {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  const abs = Math.abs(v);
  const s = abs >= 1000 ? v.toFixed(0) : abs >= 1 ? v.toFixed(3) : v.toPrecision(3);
  return unit ? `${s}${unit}` : s;
}

/** Bytes to a KiB string, em-dash for missing values. @param {number} bytes */
export function fmtKB(bytes) {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return '—';
  return fmtNum(bytes / 1024);
}
