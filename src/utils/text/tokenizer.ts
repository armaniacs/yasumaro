/**
 * tokenizer.ts
 * Shared sentence/word tokenization for Japanese and English text.
 * Extracted from contentDeduplicator.ts's near-duplicate helpers. Note that
 * sentenceExtractor.ts keeps its own local toWordSet — its trailing-
 * punctuation handling differs from this one, so unifying it would silently
 * change TextRank's Japanese bigram similarity (see sentenceExtractor.ts).
 */

/**
 * Split text into sentences.
 * Supports Japanese (。！？) and English (.!?) delimiters.
 */
export function splitSentences(text: string): string[] {
  if (!text || !text.trim()) {
    return [];
  }

  const result: string[] = [];
  const regex = /([。！？.!?])\s*/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const sentence = text.slice(lastIndex, match.index + match[1]!.length).trim();
      if (sentence) {
        result.push(sentence);
      }
    }
    lastIndex = match.index + match[1]!.length;
  }

  if (lastIndex < text.length) {
    const remaining = text.slice(lastIndex).trim();
    if (remaining) {
      result.push(remaining);
    }
  }

  return result;
}

/**
 * Check if text contains Japanese characters
 */
export function containsJapanese(text: string): boolean {
  return /[぀-ゟ゠-ヿ一-鿿]/.test(text);
}

/**
 * Get character bigrams from text (useful for Japanese similarity)
 */
export function getBigrams(text: string): string[] {
  const bigrams: string[] = [];
  for (let i = 0; i < text.length - 1; i++) {
    bigrams.push(text.charAt(i) + text.charAt(i + 1));
  }
  return bigrams;
}

/**
 * Convert a sentence to a word set for similarity calculation.
 * Trailing sentence-ending punctuation is stripped so it does not pollute
 * the token set, then English/whitespace-delimited words (>=2 chars) are
 * kept as-is; Japanese bigrams are added additionally when the sentence
 * contains Japanese, since Japanese text has no reliable word boundaries.
 */
export function toWordSet(sentence: string): Set<string> {
  const cleaned = sentence.replace(/[。！？.!?]$/, '');
  const words = cleaned
    .toLowerCase()
    .split(/[\s　、。，．！？、。，．！？,.!?\-_:;()\[\]{}""''「」]+/)
    .filter(w => w.length >= 2);

  if (containsJapanese(cleaned)) {
    words.push(...getBigrams(cleaned));
  }

  return new Set(words);
}
