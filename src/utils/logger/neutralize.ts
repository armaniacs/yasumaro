/**
 * logger/neutralize.ts
 * Pure neutralization of untrusted text before it is persisted into the log.
 *
 * The persisted log is the primary forensic record. External strings (Obsidian
 * error bodies, forwarded messages) must not be able to break the line
 * structure, inject fake entries, or smuggle terminal escape sequences.
 *
 * Order contract: this runs AFTER the PII mask (sanitizeRegex). The PII mask
 * matches on the original text; neutralization only rewrites control bytes in
 * the already-masked result, so mask coverage is unaffected.
 */

/** Visible replacement for a neutralized line break; keeps the text readable. */
export const LINE_BREAK_REPLACEMENT = ' ⏎ ';

// ANSI CSI sequences: ESC "[" params/intermediates, final byte in 0x40-0x7E.
// Only CSI is targeted so a lone ESC (e.g. a literal "esc key" mention) in
// legitimate prose is handled by the generic control-char pass instead, rather
// than eating the characters that follow it.
const ANSI_CSI = new RegExp('\\u001b\\[[0-?]*[ -/]*[@-~]', 'g');

const LINE_BREAKS = /\r\n|\r|\n/g;

// C0 control chars (U+0000-U+001F) and DEL (U+007F), excluding \n and \r which
// are handled by LINE_BREAKS above.
const OTHER_CONTROLS = new RegExp('[\\u0000-\\u0009\\u000b\\u000c\\u000e-\\u001f\\u007f]', 'g');

/**
 * Neutralize a single string for safe persistence.
 * - CR/LF (any combination) -> a visible separator
 * - ANSI CSI escape sequences -> removed
 * - other C0 control chars + DEL -> removed
 */
export function neutralizeLogText(input: string): string {
  return input
    .replace(ANSI_CSI, '')
    .replace(LINE_BREAKS, LINE_BREAK_REPLACEMENT)
    .replace(OTHER_CONTROLS, '');
}
