/**
 * keywordExtractor.ts
 * Pure keyword extraction for the word-cluster panel (PBI 2026-09-24-07).
 *
 * Splits text into word-like tokens with Intl.Segmenter (granularity 'word'),
 * filters them, dedupes per call, and caps the output. The output is designed
 * to flow through the tag pipeline as "#kw" pseudo-tags, so every keyword is
 * restricted to letters/digits only — no whitespace, '#', '|', or ',' —
 * which keeps parseTagsForDisplay and the cooccurrence edge-key decoding
 * (`key.split('|')`) intact.
 *
 * Segmentation fallback: Chrome always ships Intl.Segmenter, but tests and
 * older Node builds may not (or may lack the JA dictionary). The fallback is
 * a conservative non-letter/digit split — CJK runs stay glued together (no
 * dictionary available), which the max-length guard treats as noise. This
 * keeps behavior deterministic without shipping a morphological dictionary
 * (rejected for MV3 bundle size; see PBI implementation notes).
 *
 * Quality tuning (stopwords, min length) is deliberately modest; the PBI's
 * STEP 0 real-data manual probe against the user's own DB is the intended
 * calibration step.
 */

import { MAX_TAGS_PER_RECORD } from '../utils/computeLimits.js';

export const DEFAULT_MIN_KEYWORD_LENGTH = 2;

/**
 * Tokens longer than this are almost certainly glued CJK runs from the
 * no-dictionary fallback (or garbage); real words across EN/JA stay below it.
 */
export const MAX_KEYWORD_LENGTH = 30;

/**
 * A keyword must be letters/digits only so it survives the "#kw" pseudo-tag
 * round-trip (parseTagsForDisplay splits on whitespace, edge keys split on '|').
 */
const SAFE_KEYWORD_RE = /^[\p{L}\p{N}]+$/u;
const NUMERIC_ONLY_RE = /^\p{N}+$/u;

/**
 * Small built-in stopword list (EN + JA). Intentionally modest: only
 * unambiguous function words, so a content word is never lost when the real
 * corpus (STEP 0 probe) disagrees with the list. Latin entries are lowercase;
 * matching happens after lowercasing. JA entries cover particles/connectives
 * too long to be removed by the min-length filter (1-char particles die there).
 */
const STOPWORDS: ReadonlySet<string> = new Set([
  // EN — articles, conjunctions, prepositions
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'else', 'nor',
  'at', 'by', 'for', 'with', 'about', 'against', 'between', 'into',
  'through', 'during', 'before', 'after', 'above', 'below', 'to',
  'from', 'up', 'down', 'in', 'out', 'on', 'off', 'over', 'under',
  'again', 'further', 'once', 'here', 'there', 'of', 'as', 'so',
  'than', 'too', 'very', 'just', 'also', 'only', 'own', 'same',
  'such', 'now', 'not', 'no', 'yes', 'ok', 'oh',
  // EN — pronouns, auxiliaries, question words
  'i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'you', 'your',
  'yours', 'he', 'him', 'his', 'she', 'her', 'hers', 'it', 'its',
  'they', 'them', 'their', 'theirs', 'what', 'which', 'who', 'whom',
  'this', 'that', 'these', 'those', 'am', 'is', 'are', 'was', 'were',
  'be', 'been', 'being', 'have', 'has', 'had', 'having', 'do', 'does',
  'did', 'doing', 'will', 'would', 'can', 'could', 'should', 'shall',
  'may', 'might', 'must', 'when', 'where', 'why', 'how', 'all', 'any',
  'both', 'each', 'few', 'more', 'most', 'other', 'some', 'dont',
  // JA — demonstratives, pronouns, light nouns
  'これ', 'それ', 'あれ', 'この', 'その', 'あの', 'ここ', 'そこ',
  'こちら', 'これら', 'それら', 'あちら', 'どれ', 'どこ', 'だれ',
  'わたし', 'ぼく', 'あなた', 'じぶん', '自分', 'われわれ', 'みんな',
  'こと', 'もの', 'ため', 'よう', 'とき', 'ところ', 'ほう', 'たち',
  'さん', 'など', 'なんか', 'みたい', 'おかげ', 'せい',
  // JA — copula / light verbs (dictionary-ish forms)
  'する', 'なる', 'ある', 'いる', 'です', 'ます', 'ない', 'ぬ',
  'れる', 'られる', 'せる', 'させる', 'たい', 'たく', 'だっ', 'でし',
  'まし', 'せん', 'もの',
  // JA — conjunctions / connectives (2+ chars; 1-char particles are
  // removed by the min-length filter)
  'また', 'ただ', 'でも', 'けど', 'しかし', 'そして', 'それで',
  'だから', 'だが', 'または', 'および', 'ならび', 'つまり', 'すなわち',
  'について', 'として', 'による', 'にとって', 'に対して', 'に関して',
  'こちら', 'じゃなく',
]);

interface SegmenterLike {
  segment(input: string): Iterable<{ segment: string; isWordLike?: boolean }>;
}

type SegmentFn = (text: string) => string[];

/**
 * Builds the default segmenter with a fixed 'ja' locale: the JA dictionary
 * segments CJK runs into words, while Latin word boundaries are
 * locale-independent (UAX #29). A fixed locale keeps extraction deterministic
 * across environments instead of following the host default locale.
 */
function createDefaultSegmentFn(): SegmentFn | null {
  const ctor = (Intl as { Segmenter?: new (locale?: string, options?: { granularity?: 'grapheme' | 'word' | 'sentence' }) => SegmenterLike })
    .Segmenter;
  if (typeof ctor !== 'function') return null;
  try {
    const segmenter = new ctor('ja', { granularity: 'word' });
    return (text: string): string[] => {
      const out: string[] = [];
      for (const s of segmenter.segment(text)) {
        // isWordLike === false marks whitespace/punctuation runs; a missing
        // property (no data) defers to the regex filters below.
        if (s.isWordLike === false) continue;
        out.push(s.segment);
      }
      return out;
    };
  } catch {
    return null;
  }
}

/**
 * Conservative no-Segmenter split: one token per letter/digit run. CJK runs
 * stay glued (no dictionary); MAX_KEYWORD_LENGTH drops those as noise.
 * Exported for tests so the fallback path stays deterministic.
 */
export function splitTextWithoutSegmenter(text: string): string[] {
  return text.split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 0);
}

const defaultSegmentFn: SegmentFn | null = createDefaultSegmentFn();

export interface KeywordExtractorOptions {
  /** Minimum code-point length per keyword (default 2 — drops 1-char CJK and particles). */
  minLength?: number;
  /** Maximum unique keywords returned per call (default MAX_TAGS_PER_RECORD = 50). */
  maxKeywords?: number;
  /** Token source override (tests, or engines without Intl.Segmenter). */
  segment?: SegmentFn;
}

/**
 * Extracts unique keywords from one record's text, in first-occurrence order,
 * capped at `maxKeywords`. Deterministic for a given input and environment:
 * lowercasing is locale-independent, the segmenter locale is fixed, and the
 * per-call cap keeps the first N unique candidates in scan order.
 */
export function extractKeywords(text: string, options: KeywordExtractorOptions = {}): string[] {
  if (typeof text !== 'string' || text.length === 0) return [];
  const minLength = options.minLength ?? DEFAULT_MIN_KEYWORD_LENGTH;
  const maxKeywords = options.maxKeywords ?? MAX_TAGS_PER_RECORD;
  const segment = options.segment ?? defaultSegmentFn ?? splitTextWithoutSegmenter;

  const seen = new Set<string>();
  const keywords: string[] = [];
  for (const raw of segment(text)) {
    const token = raw.toLowerCase();
    if (token.length < minLength) continue;
    // Code-point length: a surrogate-pair token (rare CJK ext) must not
    // sneak past the min-length filter by UTF-16 unit count.
    if (Array.from(token).length > MAX_KEYWORD_LENGTH) continue;
    if (STOPWORDS.has(token)) continue;
    if (NUMERIC_ONLY_RE.test(token)) continue;
    if (!SAFE_KEYWORD_RE.test(token)) continue;
    if (seen.has(token)) continue;
    seen.add(token);
    keywords.push(token);
    if (keywords.length >= maxKeywords) break;
  }
  return keywords;
}
