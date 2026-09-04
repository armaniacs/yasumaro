/**
 * contentDeduplicator.ts
 * 【機能概要】: センテンスレベルの冗長除去（MMR的Redundancy Reduction）
 * 【設計方針】:
 *   - 外部ライブラリ不使用
 *   - Jaccard類似度によるセンテンスペアワイズ比較
 *   - 閾値超のセンテンスを後者から除去
 *   - 日本語・英語両対応（句点・ピリオドで分割）
 */

import { toWordSet } from './text/tokenizer.js';
import { jaccardSimilarity } from './text/similarity.js';

export interface DeduplicateOptions {
  /** 除去判定の類似度閾値 0.0〜1.0（デフォルト: 0.7） */
  threshold?: number;
  /** 最小センテンス長（これ未満は除去対象としない、デフォルト: 10文字） */
  minLength?: number;
}

/**
 * テキストをセンテンス単位に分割する。
 * 日本語（。！？）と英語（. ! ?）の句点で分割し、空文字列を除去する。
 *
 * NOTE: Deliberately local, not the shared text/tokenizer.ts splitSentences —
 * this variant keeps the trailing delimiter attached per sentence so the
 * original text can be reconstructed after dedup removes some sentences.
 */
function splitSentences(text: string): { sentence: string; delimiter: string }[] {
  const result: { sentence: string; delimiter: string }[] = [];
  const regex = /([。！？.!?])\s*/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      result.push({
        sentence: text.slice(lastIndex, match.index + (match[1] ?? '').length),
        delimiter: (match[0] ?? '').slice((match[1] ?? '').length),
      });
    }
    lastIndex = match.index + (match[1] ?? '').length;
  }

  if (lastIndex < text.length) {
    result.push({ sentence: text.slice(lastIndex), delimiter: '' });
  }

  return result;
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
