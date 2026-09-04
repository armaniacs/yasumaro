/**
 * contentDeduplicator.ts
 * 【機能概要】: センテンスレベルの冗長除去（MMR的Redundancy Reduction）
 * 【設計方針】:
 *   - 外部ライブラリ不使用
 *   - Jaccard類似度によるセンテンスペアワイズ比較
 *   - 閾値超のセンテンスを後者から除去
 *   - 日本語・英語両対応（句点・ピリオドで分割）
 *   - 方式 B（事前フィルタ）: 結果完全一致を保ちつつ Jaccard 呼び出し回数を削減
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

// ---------------------------------------------------------------------------
// Reference implementation (test-only, O(N^2)全ペア比較)
// ---------------------------------------------------------------------------

/**
 * 参照実装: 現行 O(N^2) ロジックをそのまま保持。
 * テスト専用 — 新実装との結果一致検証に用いる。
 * @internal
 */
export function deduplicateContentReference(text: string, options: DeduplicateOptions = {}): string {
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

// ---------------------------------------------------------------------------
// Optimized implementation — 方式 B（事前フィルタ）+ inverted index
// 結果は参照実装と完全一致（conservative filterのみでスキップ）
// ---------------------------------------------------------------------------

let _jaccardCallCount = 0;

/** テスト用: 新実装の jaccardSimilarity 呼び出し回数を取得 */
export function getJaccardCallCount(): number {
  return _jaccardCallCount;
}

/** テスト用: カウンタをリセット */
export function resetJaccardCallCount(): void {
  _jaccardCallCount = 0;
}

/** 互換エイリアス */
export function _getJaccardCallCount(): number {
  return _jaccardCallCount;
}
export function _resetJaccardCallCount(): void {
  _jaccardCallCount = 0;
}

function getFirstNgramSet(wordSet: Set<string>): Set<string> {
  const result = new Set<string>();
  let count = 0;
  for (const w of wordSet) {
    result.add(w);
    count++;
    if (count >= 3) break;
  }
  return result;
}

function isDisjoint(a: Set<string>, b: Set<string>): boolean {
  const [small, large] = a.size < b.size ? [a, b] : [b, a];
  for (const v of small) {
    if (large.has(v)) return false;
  }
  return true;
}

export function deduplicateContent(text: string, options: DeduplicateOptions = {}): string {
  const { threshold = 0.7, minLength = 10 } = options;

  if (!text.trim()) return text;

  if (threshold === 0) return text;

  const sentenceParts = splitSentences(text);
  if (sentenceParts.length <= 1) return text;

  const kept: { sentence: string; delimiter: string }[] = [];
  // keptMeta は kept と 1:1 対応。wordSet は toWordSet を再利用し再トークナイズしない
  const keptMeta: {
    wordSet: Set<string>;
    charLen: number;
    ngramSet: Set<string>;
    size: number;
  }[] = [];

  // inverted index: word -> kept indices containing that word
  const wordIndex = new Map<string, number[]>();
  // 空集合の kept のインデックス（Jaccard が 1 になり得るため別管理）
  const emptyIndices: number[] = [];

  for (const part of sentenceParts) {
    if (part.sentence.length < minLength) {
      const ws = toWordSet(part.sentence);
      const meta = {
        wordSet: ws,
        charLen: part.sentence.length,
        ngramSet: getFirstNgramSet(ws),
        size: ws.size,
      };
      const idx = kept.length;
      kept.push(part);
      keptMeta.push(meta);
      if (ws.size === 0) {
        emptyIndices.push(idx);
      } else {
        for (const w of ws) {
          let arr = wordIndex.get(w);
          if (!arr) {
            arr = [];
            wordIndex.set(w, arr);
          }
          arr.push(idx);
        }
      }
      continue;
    }

    const wordSet = toWordSet(part.sentence);
    const charLen = part.sentence.length;
    const ngramSet = getFirstNgramSet(wordSet);
    const size = wordSet.size;

    let isDuplicate = false;

    if (size === 0) {
      // 空集合は空集合のみと J=1 で重複判定。非空とは J=0 なので比較不要
      for (const idx of emptyIndices) {
        const meta = keptMeta[idx]!;
        // size ratio は 1/1=1 なのでスキップされない
        _jaccardCallCount++;
        if (jaccardSimilarity(wordSet, meta.wordSet) >= threshold) {
          isDuplicate = true;
          break;
        }
      }
    } else {
      // 候補集合: 少なくとも1語を共有する kept のみが J>0 になり得る
      const candidateSet = new Set<number>();
      for (const w of wordSet) {
        const list = wordIndex.get(w);
        if (list) {
          for (const idx of list) candidateSet.add(idx);
        }
      }
      // 候補が空 => 全 kept と J=0 => 重複なし（threshold>0 のため）
      // 候補が存在する場合のみ Jaccard を評価、ただし conservative フィルタで事前スキップ

      if (candidateSet.size > 0) {
        for (const idx of candidateSet) {
          const meta = keptMeta[idx]!;

          // --- フィルタ1: wordSet サイズ比による上限 ---
          // J(A,B) <= min(a,b)/max(a,b) なので、これが threshold 未満なら J は閾値に届かない
          const minSize = Math.min(size, meta.size);
          const maxSize = Math.max(size, meta.size);
          if (maxSize > 0 && minSize / maxSize < threshold) {
            continue;
          }

          // --- フィルタ2: 文字数比（conservative） ---
          // 文字数比が [0.6, 1.67] 外なら Jaccard が閾値に届かないという経験則を、
          // 閾値>=0.6 の場合のみ適用。閾値<0.6 では文字数比だけでスキップすると
          // 取りこぼしがあり得るため無効化（正確性優先）
          if (threshold >= 0.6) {
            const minChar = Math.min(charLen, meta.charLen);
            const maxChar = Math.max(charLen, meta.charLen);
            if (maxChar > 0 && minChar / maxChar < 0.6) {
              // さらにサイズ比でも届かないことを確認してからスキップ（二重保守）
              // 既にサイズ比フィルタを通過している場合はスキップしない方が安全だが、
              // 文字数比が極端に小さい場合は語彙が大きく異なり J が低い確度が高い。
              // ただし厳密な証明にはならないため、ここでは文字数比のみではスキップせず
              // サイズ比と組み合わせた場合のみスキップするポリシーにする:
              // → 実際にはこのブロックではスキップしない（conservative: ambiguous は通す）
              //    下記は文書上のフィルタ存在を示すが、実装はスキップしない。
              //    真にスキップするのはサイズ比のみとする。
              //    （文字数フィルタを有効化したい場合は threshold>=0.7 かつ ratio<0.4 の極端な場合のみ）
              if (minChar / maxChar < 0.4) {
                // 極端な文字数差は語彙差を強く示唆するが、厳密証明のため
                // ここでもスキップは行わず、Jaccard までフォールスルーする。
                // 将来ベンチで安全と確認できれば有効化可能。
              }
            }
          }
          // 注: 文字数フィルタは現在 conservative のためスキップしない。
          // 有効化するなら上記 threshold>=0.6 かつ ratio<0.6 で continue する。

          // --- フィルタ3: 小 n-gram（先頭3語）disjoint + 語数考慮の上限 ---
          // ngramSet は wordSet の先頭3要素のサブセット
          // disjoint でも全集合の J が閾値を超える可能性はあるため、
          // 上限 Jmax を計算して閾値未満の場合のみスキップ
          if (ngramSet.size > 0 && meta.ngramSet.size > 0 && isDisjoint(ngramSet, meta.ngramSet)) {
            const ka = ngramSet.size;
            const kb = meta.ngramSet.size;
            const a = size;
            const b = meta.size;
            // 上限 i の計算（過大見積もりだが安全側）
            // i <= min(ka, b-kb) + min(a-ka, kb) + min(a-ka, b-kb)
            let upper = 0;
            upper += Math.min(ka, Math.max(0, b - kb));
            upper += Math.min(Math.max(0, a - ka), kb);
            upper += Math.min(Math.max(0, a - ka), Math.max(0, b - kb));
            if (upper > Math.min(a, b)) upper = Math.min(a, b);
            const denom = a + b - upper;
            const jMax = denom > 0 ? upper / denom : 0;
            if (jMax < threshold) {
              continue;
            }
            // jMax >= threshold なら ambiguous なので Jaccard へフォールスルー
          }

          _jaccardCallCount++;
          if (jaccardSimilarity(wordSet, meta.wordSet) >= threshold) {
            isDuplicate = true;
            break;
          }
        }
      }
      // candidateSet が空の場合は isDuplicate=false のまま（全て J=0）
      // 空集合の kept は J=0 のため比較不要
    }

    if (!isDuplicate) {
      const idx = kept.length;
      kept.push(part);
      keptMeta.push({ wordSet, charLen, ngramSet, size });
      if (size === 0) {
        emptyIndices.push(idx);
      } else {
        for (const w of wordSet) {
          let arr = wordIndex.get(w);
          if (!arr) {
            arr = [];
            wordIndex.set(w, arr);
          }
          arr.push(idx);
        }
      }
    }
  }

  return kept.map(k => k.sentence + k.delimiter).join('');
}
