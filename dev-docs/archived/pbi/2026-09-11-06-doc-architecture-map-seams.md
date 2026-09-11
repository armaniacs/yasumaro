# PBI 06: ARCHITECTURE_MAP の component tree 語彙を現行 seam に更新

## ユーザーストーリー

このリポジトリで作業するエージェントとして、ARCHITECTURE_MAP の component tree が現行の seam 名（createBackgroundServices / MessageRouter / AIService ファミリー）を正しく示してほしい。なぜなら旧語彙（service-worker.ts → lifecycle / AIClient multiple implementations / localAiClient）では実在しない構成を辿ってしまうから。

## 優先度

- 順位: 06 / 7
- RICE スコア: 3.0（Reach=2 / Impact=0.5 / Confidence=100% / Effort=0.05 人週）
- 根拠（round 6 未踏領域監査）: `dev-docs/ARCHITECTURE_MAP.md:11-16` の component tree が旧語彙。実 composition root は `src/background/service-worker.ts:62-74`（createBackgroundServices）+ `MessageRouter`（19 handler table・:152-189）。

## 受け入れ基準

- [x] component tree を現行 seam 名に更新（スナップショット運用どおり・履歴は書かない）
- [x] check-docs PASS

## 見積もり

XS（0.05 人週）。種別: doc。

## 実装メモ（2026-09-11 round 7）

- Service Worker component tree を現行 seam 語彙に更新: service-worker.ts = createBackgroundServices() composition root + MessageRouter dispatch（19 handler types）、AIService family（ProviderStrategy + per-provider strategies）、RecordingOrchestrator。check-docs PASS。
