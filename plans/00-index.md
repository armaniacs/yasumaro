# 00-index.md

このファイルは、plans/*.md に書かれたファイルを分類するためのファイルである。

plans/*.md には、今後やりたいこと、今やっていること、完了したことなどが書いてある。

概ね、現在主に作業している内容は、このうちの 1 つのファイルに集約されている。

00-index.md はそれぞれのファイルのステータスを一覧するためのファイルである。

- 更新 2026-05-05 05:13

## ステータス定義

- プランのみ（未着手）
- 進行中
- レビュー待ち / 仕上げ中
- 完了
- アーカイブ推奨

## ファイル

- [完了] 2026-04-19-tobe-ow6.md — v6 ロードマップ 🎉
  - **全9項目完了。v5.1.23 として main にマージ済み（2026-05-05）**
  - #2 カバレッジ: Statements **91.47%** / Lines **92.98%**（目標80%を大幅超過）
  - #8 CI/CD: GitHub Actions 3ワークフロー作成（ci/coverage/release）
  - Phase 5 service-worker: 9ハンドラ抽出 + 27テスト追加（133 tests）
  - 全5433テストパス、0 failures

- [完了] 2026-04-23-coverage80.md — カバレッジ 80% 計画 🎉
  - **Statements 91.47% / Lines 92.98% で目標大幅超過！**
  - バージョン 5.1.22 / 5.1.23 として main にマージ済み

- [完了] 2026-04-24-action.md — カバレッジ 80% 実行計画（並列）

- [完了] 2026-04-24-feature-A-cleansing-fallback.md — AI 要約クレンジングフォールバック改善
  - 閾値緩和（10%→20%）、フォールバック先を body 全体から preAiCleanseText に変更

- [完了] 2026-04-24-feature-C-readabilityscore.md — Readability スコアによる本文保護
  - 14 ステップ完了。UI 制御（ポップアップ/ダッシュボード）も実装済み。

- [完了] 2026-04-26-popup-refactoring.md — popup/*.ts リファクタリング（カバレッジ 0%→70%+）
  - privacy.ts: 96.26%, settingsForm.ts: 100%, aiProvider.ts: 85%, settingsSaver.ts: 53.94%

- [アーカイブ推奨] 2026-04-29-memo-01.md — Phase 4 進捗メモ（内容は完了報告に統合済み）

- [完了] 2026-05-02-0448-review-plus-0429.md — Checking Team レビュー結果
  - 全High/Medium指摘の修正対応完了
  - extractor.ts, manifest.json, contentCleaner.ts, vitest.setup.ts 等 7件

- [アーカイブ推奨] 2026-05-02-memo-02.md — 現状整理メモ（内容は完了報告に統合済み）

- [完了] 2026-05-03-coverage-improvement.md — 低カバレッジ10ファイル改善 🎉
  - 10ファイルのカバレッジを平均26%→99%に改善（+416テスト）
  - バグ修正2件：pendingPasswordAction null化問題

- [完了] service-worker-refactoring.md — service-worker.ts リファクタリング
  - 9ハンドラをエクスポート関数に抽出（handleContentCleansingExecuted 等）
  - 27新規テスト追加、全133 tests
  - service-worker.ts カバレッジ 72.5%→85%+（推定）
