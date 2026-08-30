/**
 * llmOutputGuard.ts
 * Pure guard that detects degenerate LLM summaries (token-repetition loops,
 * delimiter-joined keyword spam, non-sentence output) before they are saved
 * to the browsing log or rendered in the dashboard.
 *
 * Layer: utils. No dependencies on other project modules — safe to import from
 * background pipeline and dashboard without creating import cycles.
 */

/** Below this trimmed length the text is too short to judge reliably. */
const MIN_JUDGEABLE_LENGTH = 20;

/** Splits on whitespace plus the delimiters LLMs use for keyword spam. */
const TOKEN_SPLIT_PATTERN = /[\s|、,]+/;

/** Most-frequent-token rate above this => repetition loop. */
const MAX_REPETITION_RATE = 0.3;

/** unique tokens / total tokens below this => degenerate keyword spam. */
const MIN_UNIQUE_RATE = 0.1;

/**
 * Compressibility proxy without adding a compression dependency:
 * chars per distinct token. A real summary carries many distinct tokens, so
 * this stays low; a repeated single token pushes it very high.
 */
const MAX_CHARS_PER_UNIQUE_TOKEN = 50;

/**
 * Rate-based checks need enough tokens to be meaningful. Japanese prose without
 * ASCII whitespace tokenizes into very few large tokens, where a rate like
 * "most-frequent / total" is trivially high and would false-positive on
 * legitimate text. The degenerate cases this guard targets are long keyword
 * spam with hundreds of tokens.
 */
const MIN_TOKENS_FOR_RATE_CHECKS = 10;

/** Japanese predicate / sentence-ending markers used as a supplementary signal. */
const PREDICATE_PATTERN = /です|ます|だ|である|した/;

export interface DegenerateOutputResult {
  isDegenerate: boolean;
  reason?: string;
  metrics?: {
    repetitionRate: number;
    uniqueRate: number;
  };
}

function tokenize(summary: string): string[] {
  return summary.split(TOKEN_SPLIT_PATTERN).filter(Boolean);
}

function mostFrequentTokenRate(tokens: string[]): number {
  const counts = new Map<string, number>();
  let max = 0;
  for (const token of tokens) {
    const next = (counts.get(token) ?? 0) + 1;
    counts.set(token, next);
    if (next > max) max = next;
  }
  return tokens.length === 0 ? 0 : max / tokens.length;
}

function isNotSentence(summary: string): boolean {
  return !summary.includes('。') && !PREDICATE_PATTERN.test(summary);
}

/**
 * Detects degenerate LLM output. Pure function.
 * Empty / null / undefined and too-short inputs are reported as not degenerate;
 * callers handle those cases separately.
 */
export function isDegenerateOutput(summary: string): DegenerateOutputResult {
  if (!summary || summary.trim().length < MIN_JUDGEABLE_LENGTH) {
    return { isDegenerate: false };
  }

  const tokens = tokenize(summary);
  if (tokens.length === 0) {
    return { isDegenerate: false };
  }

  const uniqueCount = new Set(tokens).size;
  const repetitionRate = mostFrequentTokenRate(tokens);
  const uniqueRate = uniqueCount / tokens.length;
  const charsPerUniqueToken = summary.length / uniqueCount;
  const metrics = { repetitionRate, uniqueRate };

  if (tokens.length >= MIN_TOKENS_FOR_RATE_CHECKS) {
    if (repetitionRate > MAX_REPETITION_RATE) {
      return { isDegenerate: true, reason: 'repetition', metrics };
    }
    if (uniqueRate < MIN_UNIQUE_RATE) {
      return { isDegenerate: true, reason: 'lowDiversity', metrics };
    }
    if (charsPerUniqueToken > MAX_CHARS_PER_UNIQUE_TOKEN) {
      return { isDegenerate: true, reason: 'highlyCompressible', metrics };
    }
  }

  // Supplementary signal only: never degenerate on its own. Reported so callers
  // and logs can see it, but isDegenerate stays false.
  if (isNotSentence(summary)) {
    return { isDegenerate: false, reason: 'notSentence', metrics };
  }

  return { isDegenerate: false, metrics };
}
