/**
 * evalCorpus.ts
 *
 * Fixed evaluation corpus (PBI 2026-10-22-03, slice: recall comparison).
 * Frozen so FTS-only vs hybrid runs compare on identical judgments:
 * 12 documents, 4 Japanese queries, per-query relevant id sets.
 * Corpus text mixes Japanese and English so both the FTS trigram MATCH
 * path and the trigram-vector path see in-language overlap. Ids 13-15 are
 * near-miss distractors: they share topic words with a query but answer a
 * different question (judged non-relevant), the standard IR way to separate
 * lexical overlap from topical relevance.
 */

import type { HybridRankDocument } from './hybridRecallRank.js';

export interface EvalQuery {
  id: string;
  text: string;
  relevantIds: number[];
}

export const EVAL_CORPUS: HybridRankDocument[] = [
  { id: 1, title: 'WASM embedding ships in Chrome 140', summary: 'browser ships WebAssembly embedding runtime for pages' },
  { id: 2, title: 'Chrome 140 ships WASM embedding support', summary: 'WebAssembly embedding support arrives in the stable browser release' },
  { id: 3, title: 'WebAssembly ランタイムがブラウザに搭載', summary: 'WASM embedding 実行環境が Chrome 安定版に到達' },
  { id: 4, title: 'カレーの作り方 ジャガイモと玉ねぎ', summary: 'curry recipe with potatoes and onions, weeknight dinner' },
  { id: 5, title: 'Curry recipe with potatoes', summary: 'ジャガイモ入りカレーのレシピと手順' },
  { id: 6, title: 'ポテトカレーの時短レシピ', summary: 'potato curry quick recipe for busy nights' },
  { id: 7, title: '週次レビューの振り返り自動化', summary: 'weekly review digest automation for reading history' },
  { id: 8, title: 'Weekly review digest generation', summary: '週次ダイジェスト生成と振り返りの自動化' },
  { id: 9, title: 'TypeScript の型安全性とテスト戦略', summary: 'type safety and testing strategy for TypeScript projects' },
  { id: 10, title: 'Testing strategy for browser extensions', summary: 'ブラウザ拡張のテスト戦略と E2E 方針' },
  { id: 11, title: '分散ストレージの冪等な再実行', summary: 'idempotent retry for distributed storage writes' },
  { id: 12, title: 'Idempotent batch resume after worker restart', summary: 'ワーカー再起動後のバッチ再開とチェックポイント' },
  { id: 13, title: '月次レビューのまとめ方とダイジェスト作成術', summary: 'how to write a monthly review digest template' },
  { id: 14, title: 'バッチ処理の再試行とチェックポイント設計', summary: 'batch retry and checkpoint design patterns for workers' },
  { id: 15, title: 'Chrome 拡張のリリースノート自動生成', summary: 'auto-generated release notes for browser extension shipping' },
];

export const EVAL_QUERIES: EvalQuery[] = [
  { id: 'q-wasm', text: 'WASM embedding ブラウザ', relevantIds: [1, 2, 3] },
  { id: 'q-curry', text: 'カレー ジャガイモ レシピ', relevantIds: [4, 5, 6] },
  { id: 'q-review', text: '週次レビュー ダイジェスト', relevantIds: [7, 8] },
  { id: 'q-resume', text: '冪等 バッチ 再開', relevantIds: [11, 12] },
];
