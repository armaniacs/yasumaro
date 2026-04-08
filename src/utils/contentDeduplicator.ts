/**
 * contentDeduplicator.ts
 * 【機能概要】: センテンスレベルの冗長除去（MMR的Redundancy Reduction）
 * 【設計方針】:
 *   - 外部ライブラリ不使用
 *   - Jaccard類似度によるセンテンスペアワイズ比較
 *   - 閾値超のセンテンスを後者から除去
 *   - 日本語・英語両対応（句点・ピリオドで分割）
 */

export interface DeduplicateOptions {
  /** 除去判定の類似度閾値 0.0〜1.0（デフォルト: 0.7） */
  threshold?: number;
  /** 最小センテンス長（これ未満は除去対象としない、デフォルト: 10文字） */
  minLength?: number;
}

/**
 * テキストをセンテンス単位に分割する。
 * 日本語（。！？）と英語（. ! ?）の句点で分割し、空文字列を除去する。
 */
function splitSentences(text: string): { sentence: string; delimiter: string }[] {
  const result: { sentence: string; delimiter: string }[] = [];
  const regex = /([。！？.!?])\s*/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      result.push({
        sentence: text.slice(lastIndex, match.index + match[1].length),
        delimiter: match[0].slice(match[1].length),
      });
    }
    lastIndex = match.index + match[1].length;
  }

  if (lastIndex < text.length) {
    result.push({ sentence: text.slice(lastIndex), delimiter: '' });
  }

  return result;
}

/**
 * Check if text contains Japanese characters
 */
function containsJapanese(text: string): boolean {
  return /[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9fff]/.test(text);
}

/**
 * Get character bigrams from text (useful for Japanese similarity)
 */
function getBigrams(text: string): string[] {
  const bigrams: string[] = [];
  for (let i = 0; i < text.length - 1; i++) {
    bigrams.push(text[i] + text[i + 1]);
  }
  return bigrams;
}

/**
 * センテンスを単語（2文字以上のトークン）の Set に変換する。
 */
function toWordSet(sentence: string): Set<string> {
  const cleaned = sentence.replace(/[。！？.!?]$/, '');
  const words = cleaned
    .toLowerCase()
    .split(/[\s\u3000\u3001\u3002\uff0c\uff0e\uff01\uff1f、。，．！？,.!?\-_:;()\[\]{}""''\u300c\u300d]+/)
    .filter(w => w.length >= 2);

  if (containsJapanese(cleaned)) {
    words.push(...getBigrams(cleaned));
  }

  return new Set(words);
}

/**
 * Jaccard類似度を計算する。
 * J(A, B) = |A ∩ B| / |A ∪ B|
 */
function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const word of a) {
    if (b.has(word)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return intersection / union;
}

export function deduplicateContent(text: string, options: DeduplicateOptions = {}): string {
  const { threshold = 0.7, minLength = 10 } = options;

  if (!text.trim()) return text;

  if (threshold === 0) return text;

  const sentenceParts = splitSentences(text);
  if (sentenceParts.length <= 1) return text;

  const kept: { sentence: string; delimiter: string }[] = [];
  const keptSets: Set<string>[] = [];

  for (const part of sentenceParts) {
    if (part.sentence.length < minLength) {
      kept.push(part);
      keptSets.push(toWordSet(part.sentence));
      continue;
    }

    const wordSet = toWordSet(part.sentence);

    let isDuplicate = false;
    for (const existingSet of keptSets) {
      if (jaccardSimilarity(wordSet, existingSet) >= threshold) {
        isDuplicate = true;
        break;
      }
    }

    if (!isDuplicate) {
      kept.push(part);
      keptSets.push(wordSet);
    }
  }

  return kept.map(k => k.sentence + k.delimiter).join('');
}
