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
function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[。！？.!?])\s*/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

/**
 * センテンスを単語（2文字以上のトークン）の Set に変換する。
 */
function toWordSet(sentence: string): Set<string> {
  const words = sentence
    .toLowerCase()
    .split(/[\s\u3000\u3001\u3002\uff0c\uff0e\uff01\uff1f、。，．！？,.!?\-_:;()\[\]{}""''\u300c\u300d]+/)
    .filter(w => w.length >= 2);
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

/**
 * テキストのセンテンスレベル冗長除去を行う。
 * 既出センテンスとの類似度が threshold 以上のセンテンスを除去する。
 *
 * @param text - 入力テキスト
 * @param options - オプション
 * @returns 冗長除去後のテキスト
 */
export function deduplicateContent(text: string, options: DeduplicateOptions = {}): string {
  const { threshold = 0.7, minLength = 10 } = options;

  if (!text.trim()) return text;

  const sentences = splitSentences(text);
  if (sentences.length <= 1) return text;

  const kept: string[] = [];
  const keptSets: Set<string>[] = [];

  for (const sentence of sentences) {
    // 短すぎるセンテンスは無条件で保持
    if (sentence.length < minLength) {
      kept.push(sentence);
      keptSets.push(toWordSet(sentence));
      continue;
    }

    const wordSet = toWordSet(sentence);

    // 既出センテンスとの類似度を確認
    let isDuplicate = false;
    for (const existingSet of keptSets) {
      if (jaccardSimilarity(wordSet, existingSet) >= threshold) {
        isDuplicate = true;
        break;
      }
    }

    if (!isDuplicate) {
      kept.push(sentence);
      keptSets.push(wordSet);
    }
  }

  return kept.join(' ');
}
