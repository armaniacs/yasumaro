/**
 * yamlFrontmatter.ts
 * Escaping helper for values interpolated into YAML frontmatter blocks of
 * exported Markdown notes.
 *
 * The exported fields (url, title, tags) are attacker-controllable (page URL,
 * page title, stored tags). Emitted raw, a value containing a newline plus
 * `key: value` injects arbitrary frontmatter keys that a downstream tool then
 * resolves (VULN-030). Structure characters and quotes can also break the
 * surrounding quoting.
 *
 * Policy: every frontmatter scalar is emitted as a double-quoted YAML string
 * with control characters collapsed and `"` / `\` escaped. This is safe for any
 * input and keeps the value on a single line, so no injected key can appear at
 * column 0.
 */

const LAST_CONTROL_CODEPOINT = 0x1f;
const DELETE_CODEPOINT = 0x7f;

function collapseControlChars(input: string): string {
  let out = '';
  for (const ch of input) {
    const code = ch.codePointAt(0) ?? 0;
    out += code <= LAST_CONTROL_CODEPOINT || code === DELETE_CODEPOINT ? ' ' : ch;
  }
  return out;
}

/**
 * Escape a single value for use as a double-quoted YAML scalar.
 * The result INCLUDES the surrounding double quotes.
 */
export function yamlQuote(value: unknown): string {
  const str = value == null ? '' : String(value);
  const escaped = collapseControlChars(
    str.replace(/\\/g, '\\\\').replace(/"/g, '\\"'),
  );
  return `"${escaped}"`;
}

/**
 * Render a YAML flow-sequence of strings (e.g. `["a", "b"]`) with every element
 * escaped via {@link yamlQuote}.
 */
export function yamlQuoteList(values: readonly unknown[]): string {
  return `[${values.map(yamlQuote).join(', ')}]`;
}
