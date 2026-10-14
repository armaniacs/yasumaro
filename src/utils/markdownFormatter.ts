import { sanitizeForObsidian, sanitizeForMarkdownLinkText, sanitizeUrlForMarkdownTarget } from './markdownSanitizer.js';
import { getHostname } from './markdownTemplateUtils.js';
import { SUMMARY_EMPTY_FALLBACK } from './summaryFallback.js';
import type { BrowsingLogEntry } from './sqlite-types.js';
import type { MarkdownTemplateEntryData } from './types.js';

/**
 * Output style for a single browsing-log entry.
 * - obsidianList: `- HH:MM [title](url)` + `    - tags summary` list item
 * - plainLine: `- [title](url): summary` single line (no timestamp/tags)
 * - heading: `# title` + URL/Date/Tags lines + `## Summary` section
 */
export type EntryMarkdownStyle = 'obsidianList' | 'plainLine' | 'heading';

/** Raw entry fields accepted by the SSOT builders. */
export interface BuildEntryMarkdownInput {
  title?: string | null | undefined;
  url: string;
  summary?: string | null | undefined;
  tags?: string | string[] | null | undefined;
  /** Preformatted timestamp; takes precedence over appendedAt/createdAt. */
  timestamp?: string | undefined;
  /** Batch append time (formatEntriesToObsidianList path). */
  appendedAt?: number;
  /** Entry creation time (markdownExport path). */
  createdAt?: number;
}

/**
 * Per-caller differences absorbed as options (reproduce, not unify).
 * Defaults match the obsidianList callers (formatSingleEntry/formatMarkdownStep).
 */
export interface BuildEntryMarkdownOptions {
  /** Title fallback chain `title || url || fallback`; false keeps the raw title. */
  titleFallback?: string | false;
  /** URL sanitizer: link targets everywhere except the heading `- URL:` line. */
  urlMode?: 'linkTarget' | 'obsidian';
  /** Per-tag chain: markdownExport uses obsidian-only, others wrap linkText around it. */
  tagChain?: 'linkText' | 'obsidian';
  /** Empty-summary fallback; null keeps the caller's already-resolved summary. */
  summaryFallback?: string | null;
  /** Collapse newlines/runs of spaces before sanitizing (gist skips this). */
  normalizeSummary?: boolean;
  /** Locale for formatting appendedAt/createdAt timestamps. */
  timestampLocale?: string;
}

const DEFAULT_TITLE_FALLBACK = 'Untitled';
// SSOT alias, kept as a named default alongside DEFAULT_TITLE_FALLBACK —
// do not re-declare the literal here (see summaryFallback.ts).
const DEFAULT_SUMMARY_FALLBACK = SUMMARY_EMPTY_FALLBACK;

/** Sanitized fragments shared by every style. This is the single owner of the chain order. */
interface SanitizedEntryParts {
  title: string;
  url: string;
  summary: string;
  /** `#tag` list with trailing space, or '' when there are no tags. */
  tagPrefix: string;
}

/**
 * Line terminators that must collapse to a single space so a value stays on one
 * line. `\r`/`\n` are CommonMark's terminators, while U+2028/U+2029 are line
 * breaks for CodeMirror-family editors (Obsidian) and U+0085 is NEL — leaving
 * any of them in a title lets a hostile page forge a Markdown line.
 */
const LINE_TERMINATOR_PATTERN = /[\r\n\u2028\u2029\u0085]+/g;

/**
 * Single owner of the "one line, no run of spaces" normalization shared by title
 * and summary. Non-string values collapse to '' so a caller passing
 * `titleFallback: false` (no fallback chain) cannot turn a missing title into a
 * TypeError that aborts Markdown generation.
 */
function normalizeSingleLine(value: string | null | undefined): string {
  return (value ?? '').replace(LINE_TERMINATOR_PATTERN, ' ').replace(/  +/g, ' ').trim();
}

function sanitizeTitle(input: BuildEntryMarkdownInput, opts?: BuildEntryMarkdownOptions): string {
  const raw = opts?.titleFallback === false
    ? (input.title ?? '')
    : (input.title || input.url || (opts?.titleFallback ?? DEFAULT_TITLE_FALLBACK));
  return sanitizeForMarkdownLinkText(normalizeSingleLine(raw));
}

function sanitizeUrl(url: string, opts?: BuildEntryMarkdownOptions): string {
  return opts?.urlMode === 'obsidian' ? sanitizeForObsidian(url) : sanitizeUrlForMarkdownTarget(url);
}

function sanitizeSummary(input: BuildEntryMarkdownInput, opts?: BuildEntryMarkdownOptions): string {
  const fallback = opts?.summaryFallback === undefined ? DEFAULT_SUMMARY_FALLBACK : opts.summaryFallback;
  const raw = fallback === null ? (input.summary ?? '') : (input.summary || fallback);
  const normalized = opts?.normalizeSummary === false ? raw : normalizeSingleLine(raw);
  return sanitizeForObsidian(normalized);
}

function sanitizeTagPrefix(input: BuildEntryMarkdownInput, opts?: BuildEntryMarkdownOptions): string {
  if (!input.tags) return '';
  // WHY: comma strings are split/trimmed/filtered (dashboard/export legacy) while
  // arrays pass through verbatim (pipeline legacy) — reproduce each, not unify.
  const list = (Array.isArray(input.tags)
    ? input.tags
    : input.tags.split(',').map(t => t.trim()).filter(Boolean)
  )
    // WHY: tags must stay single-line — an AI-supplied `a\n[evil](u)` tag would
    // otherwise split the `#tags` line and inject Markdown rows (VULN-008面).
    // Newlines are never legitimate tag content, so strip them (not unify).
    .map(t => t.replace(/[\r\n]/g, ''))
    .map(t => t.trim())
    .filter(Boolean);
  if (list.length === 0) return '';
  const chain = opts?.tagChain ?? 'linkText';
  return (
    list.map(t => `#${chain === 'obsidian' ? sanitizeForObsidian(t) : sanitizeForMarkdownLinkText(sanitizeForObsidian(t))}`).join(' ') + ' '
  );
}

function sanitizeParts(input: BuildEntryMarkdownInput, opts?: BuildEntryMarkdownOptions): SanitizedEntryParts {
  return {
    title: sanitizeTitle(input, opts),
    url: sanitizeUrl(input.url, opts),
    summary: sanitizeSummary(input, opts),
    tagPrefix: sanitizeTagPrefix(input, opts),
  };
}

/**
 * Minute-bucket cache for resolveTimestamp below. The display resolution is
 * minutes, so every timestamp in the same minute formats identically — one ICU
 * call per distinct minute instead of one per row (PBI 2026-10-15-02: ~80% of
 * the 10k-row export render cost). The key space is naturally bounded (at most
 * 1440 distinct HH:MM values), so no TTL or eviction is needed. Keyed by
 * minute + locale so timestampLocale callers never cross-contaminate.
 */
const timestampByMinute = new Map<string, string>();

function resolveTimestamp(input: BuildEntryMarkdownInput, opts?: BuildEntryMarkdownOptions): string {
  if (input.timestamp !== undefined) return input.timestamp;
  const source = input.appendedAt ?? input.createdAt ?? Date.now();
  const locale = opts?.timestampLocale ?? 'ja-JP';
  const key = `${locale}@${Math.floor(source / 60_000)}`;
  const cached = timestampByMinute.get(key);
  if (cached !== undefined) return cached;
  const formatted = new Date(source).toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
  });
  timestampByMinute.set(key, formatted);
  return formatted;
}

/**
 * Build template entry data (timestamp/title/url/summary/tags/domain) through
 * the SSOT sanitize chain. Shared by markdownExport and the pipeline step's
 * markdownEntryData so both stay byte-identical to their legacy outputs.
 */
export function buildTemplateEntryData(
  input: BuildEntryMarkdownInput,
  opts?: BuildEntryMarkdownOptions,
): MarkdownTemplateEntryData {
  const parts = sanitizeParts(input, opts);
  return {
    timestamp: resolveTimestamp(input, opts),
    title: parts.title,
    url: parts.url,
    summary: parts.summary,
    tags: parts.tagPrefix,
    domain: getHostname(parts.url),
  };
}

/**
 * Build one entry's Markdown through the SSOT sanitize chain.
 * The sanitize order (link-text -> URL-target -> obsidian) lives only here;
 * callers differ solely via style + opts.
 */
export function buildEntryMarkdown(
  input: BuildEntryMarkdownInput,
  style: EntryMarkdownStyle,
  opts?: BuildEntryMarkdownOptions,
): string {
  if (style === 'plainLine') {
    const sanitizedParts = sanitizeParts(input, opts);
    return `- [${sanitizedParts.title}](${sanitizedParts.url})${sanitizedParts.summary ? `: ${sanitizedParts.summary}` : ''}`;
  }
  if (style === 'heading') {
    const sanitizedParts = sanitizeParts(input, opts);
    const date = new Date(input.createdAt ?? Date.now()).toLocaleString();
    const tagsLine = sanitizedParts.tagPrefix ? `- Tags: ${sanitizedParts.tagPrefix.trim()}` : '';
    return [
      `# ${sanitizedParts.title}`,
      ``,
      `- URL: ${sanitizedParts.url}`,
      `- Date: ${date}`,
      tagsLine,
      ``,
      `## Summary`,
      ``,
      sanitizedParts.summary,
      '',
    ].filter(Boolean).join('\n');
  }
  const sanitizedData = buildTemplateEntryData(input, opts);
  return `- ${sanitizedData.timestamp} [${sanitizedData.title}](${sanitizedData.url})\n    - ${sanitizedData.tags}${sanitizedData.summary}`;
}

export function formatEntryToHeadingMarkdown(entry: BrowsingLogEntry): string {
  return buildEntryMarkdown(
    {
      title: entry.title,
      url: entry.url,
      summary: entry.summary,
      tags: entry.tags,
      createdAt: entry.created_at,
    },
    'heading',
    { urlMode: 'obsidian' },
  );
}

/**
 * Format multiple BrowsingLogEntry records as Obsidian markdown.
 * Each entry becomes a list item, separated by newlines.
 */
export function formatEntriesToObsidianList(entries: BrowsingLogEntry[]): string {
  if (!entries || entries.length === 0) {
    return '';
  }
  const appendedAt = Date.now();
  return entries.map(entry =>
    buildEntryMarkdown(
      { title: entry.title, url: entry.url, summary: entry.summary, appendedAt },
      'obsidianList',
    ),
  ).join('\n');
}

/**
 * @deprecated Use formatEntryToHeadingMarkdown instead. Migration bridge for
 * callers outside the PBI-13 scope; scheduled for removal once they switch.
 */
export const formatEntryToMarkdown = formatEntryToHeadingMarkdown;

/**
 * @deprecated Use formatEntriesToObsidianList instead. Migration bridge for
 * callers outside the PBI-13 scope; scheduled for removal once they switch.
 */
export const formatEntriesToMarkdown = formatEntriesToObsidianList;
