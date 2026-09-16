import { sanitizeForObsidian, sanitizeForMarkdownLinkText, sanitizeUrlForMarkdownTarget } from './markdownSanitizer.js';
import { getHostname } from './markdownTemplateUtils.js';
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
  /** Batch append time (formatEntriesToMarkdown path). */
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
const DEFAULT_SUMMARY_FALLBACK = 'Summary not available.';

/** Sanitized fragments shared by every style. This is the single owner of the chain order. */
interface SanitizedEntryParts {
  title: string;
  url: string;
  summary: string;
  /** `#tag` list with trailing space, or '' when there are no tags. */
  tagPrefix: string;
}

function sanitizeTitle(input: BuildEntryMarkdownInput, opts?: BuildEntryMarkdownOptions): string {
  if (opts?.titleFallback === false) {
    return sanitizeForMarkdownLinkText(input.title as string);
  }
  return sanitizeForMarkdownLinkText(
    input.title || input.url || (opts?.titleFallback ?? DEFAULT_TITLE_FALLBACK),
  );
}

function sanitizeUrl(url: string, opts?: BuildEntryMarkdownOptions): string {
  return opts?.urlMode === 'obsidian' ? sanitizeForObsidian(url) : sanitizeUrlForMarkdownTarget(url);
}

function sanitizeSummary(input: BuildEntryMarkdownInput, opts?: BuildEntryMarkdownOptions): string {
  const fallback = opts?.summaryFallback === undefined ? DEFAULT_SUMMARY_FALLBACK : opts.summaryFallback;
  const raw = fallback === null ? (input.summary ?? '') : (input.summary || fallback);
  const normalized =
    opts?.normalizeSummary === false ? raw : raw.replace(/\n+/g, ' ').replace(/  +/g, ' ').trim();
  return sanitizeForObsidian(normalized);
}

function sanitizeTagPrefix(input: BuildEntryMarkdownInput, opts?: BuildEntryMarkdownOptions): string {
  if (!input.tags) return '';
  // WHY: comma strings are split/trimmed/filtered (dashboard/export legacy) while
  // arrays pass through verbatim (pipeline legacy) — reproduce each, not unify.
  const list = Array.isArray(input.tags)
    ? input.tags
    : input.tags.split(',').map(t => t.trim()).filter(Boolean);
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

function resolveTimestamp(input: BuildEntryMarkdownInput, opts?: BuildEntryMarkdownOptions): string {
  if (input.timestamp !== undefined) return input.timestamp;
  const source = input.appendedAt ?? input.createdAt ?? Date.now();
  return new Date(source).toLocaleTimeString(opts?.timestampLocale ?? 'ja-JP', {
    hour: '2-digit',
    minute: '2-digit',
  });
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

export function formatEntryToMarkdown(entry: BrowsingLogEntry): string {
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

export function formatEntriesToGenericMarkdown(entries: BrowsingLogEntry[]): string {
  if (!entries || entries.length === 0) return '';
  return entries.map(formatEntryToMarkdown).join('\n---\n\n');
}

/**
 * Format multiple BrowsingLogEntry records as Obsidian markdown.
 * Each entry becomes a list item, separated by newlines.
 */
export function formatEntriesToMarkdown(entries: BrowsingLogEntry[]): string {
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
