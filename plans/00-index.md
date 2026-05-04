# 00-index.md

このファイルは、plans/*.md に書かれたファイルを分類するためのファイルである。

plans/*.md には、今後やりたいこと、今やっていること、完了したことなどが書いてある。

概ね、現在主に作業している内容は、このうちの 1 つのファイルに集約されている。

00-index.md はそれぞれのファイルのステータスを一覧するためのファイルである。

- 更新 2026-05-04 21:30

## ステータス定義

- プランのみ（未着手）
- 進行中
- レビュー待ち / 仕上げ中
- 完了
- アーカイブ推奨

## ファイル

- [レビュー待ち / 仕上げ中] 2026-04-19-tobe-ow6.md — v6 ロードマップ
  - coverage 目標 **大幅超過**: Statements 91.47%, Lines 92.98%（2026-05-04）
  - 残: #2 テスト品質向上, #8 CI/CD整備, Phase 5 service-worker リファクタリング
- [完了] 2026-04-23-coverage80.md — カバレッジ 80% 計画 🎉
  - **Statements 91.47% / Lines 92.98% で目標大幅超過！**
  - バージョン 5.1.22 として main にマージ済み（2026-04-29）
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

- [完了] 2026-05-02-0448-review-plus-0429.md — Checking Team レビュー結果
  - 全High/Medium指摘の修正対応完了（2026-05-04）
  - extractor.ts：loadSettings新キー追加、parseInt NaNガード、cleanseOptions簡略化、throttle fix
  - manifest.json: z-ai→z.ai typo修正
  - contentCleaner.ts: Array→Set重複排除
  - vitest.setup.ts: vi import追加
  - extractor.test.ts: jest import削除
- [完了] 2026-05-03-coverage-improvement.md — 低カバレッジ8ファイル改善 🎉
  - 10ファイルのカバレッジを平均26%→99%に改善（+416テスト）
  - バグ修正2件：pendingPasswordAction null化問題
  - 全5406テストパス確認済み
