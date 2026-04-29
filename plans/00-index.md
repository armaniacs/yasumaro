# 00-index.md

このファイルは、plans/*.md に書かれたファイルを分類するためのファイルである。

plans/*.md には、今後やりたいこと、今やっていること、完了したことなどが書いてある。

概ね、現在主に作業している内容は、このうちの 1 つのファイルに集約されている。

00-index.md はそれぞれのファイルのステータスを一覧するためのファイルである。

- 更新 2026-04-29 20:50

## ステータス定義

- プランのみ（未着手）
- 進行中
- レビュー待ち / 仕上げ中
- 完了
- アーカイブ推奨

## ファイル

- [レビュー待ち / 仕上げ中] 2026-04-19-tobe-ow6.md — v6 ロードマップ（一部進行中）
- [完了] 2026-04-23-coverage80.md — カバレッジ 80% 計画 🎉
  - **Line カバレッジ 80.62% で目標達成！**（45.38% → 80.62%, +35.24%）
  - Phase 4: サブエージェント駆動開発で dashboard.ts, exportImport.ts, ublockImport/index.ts を改善
  - バージョン 5.1.22 として main にマージ済み（2026-04-29）
  - 次の目標：Statements カバレッジ 80%（現在 78.74%）
- [完了] 2026-04-24-action.md — カバレッジ 80% 実行計画（並列）
- [完了] service-worker-refactoring.md — 主要成功基準は達成済み（72.5%）。追加作業は任意。

- [完了] 2026-04-26-popup-refactoring.md — popup/*.ts リファクタリング（カバレッジ 0%→70%+）
  - privacy.ts: 96.26%, settingsForm.ts: 100%, aiProvider.ts: 85%, settingsSaver.ts: 53.94%
  - コミット `6a40c8e`, `2550e76`
  - E2E @ui テスト 35 件 全パス

- [完了] 2026-04-24-feature-A-cleansing-fallback.md — AI 要約クレンジングフォールバック改善
  - 閾値緩和（10%→20%）、フォールバック先を body 全体から preAiCleanseText に変更
- [完了] 2026-04-24-feature-C-readabilityscore.md — Readability スコアによる本文保護
  - 14 ステップ完了。UI 制御（ポップアップ/ダッシュボード）も実装済み。
  - 全テスト 4480 件パス。type-check パス。
