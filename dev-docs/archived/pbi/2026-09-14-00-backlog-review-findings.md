# バックログ: adversarial-code-review検証済み指摘のPBI化（2026-09-14）

**ステータス: 完了・アーカイブ済み（2026-09-14）。** 順位01〜04のPBI（05/06/07/08）はすべて実装・検証済みで `dev-docs/archived/pbi/` へ移動済み。live な追跡先はなし。

`/adversarial-code-review`でアーキテクチャ深化ラウンド15（PBI 01〜04）を対象にレビューし、裏取りを経て確定した保守担当者視点の指摘4件の優先順位一覧。ハッカー視点の指摘は全て裏取りで却下（既存仕様・攻撃不成立と判定）されたため対象外。

## 優先順位表

| 順位 | 候補 | RICEスコア | Reach | Impact | Confidence | Effort | 依存関係 | ファイル |
|---|---|---|---|---|---|---|---|---|
| 01 | attachTriggerに多重登録防止ガードを追加 | 16.0 | 開発者(月数回) | 2 | 100% | 0.5人日 | なし | [2026-09-14-05-refactor-issue-report-attach-trigger-guard.md](2026-09-14-05-refactor-issue-report-attach-trigger-guard.md) |
| 02 | CONSENT_STATE_CHANGEDのaccept/decline区別不能を解消 | 8.0 | 開発者(将来の購読者) | 1 | 100% | 0.5人日 | なし | [2026-09-14-06-refactor-consent-state-changed-payload.md](2026-09-14-06-refactor-consent-state-changed-payload.md) |
| 03 | 「移行済みかつレガシーDB残存」状態の可視化 | 3.2 | 開発者(月数回) | 0.5 | 80% | 0.5人日 | なし（04の前提） | [2026-09-14-07-test-opfs-done-legacy-path-contradiction.md](2026-09-14-07-test-opfs-done-legacy-path-contradiction.md) |
| 04 | renderMigrationSectionの表示優先順位ロジック再分離 | 1.6 | 開発者(月数回) | 1 | 80% | 1人日 | **03の後** | [2026-09-14-08-refactor-migration-section-display-state.md](2026-09-14-08-refactor-migration-section-display-state.md) |

## 根拠の要約

- **01が最上位**: adversarial-code-reviewで「成立」と裏取りされた指摘のうち、実装コストが最小（WeakSetガード追加のみ）で、放置すると将来UX事故（1クリックで複数タブが開く）に直結する。
- **02が次点**: 実害は現状ゼロだが将来の購読者の罠を防ぐ。**ただし調査の結果、当初案（`consented`フィールド追加）はSSOT（`NO_PAYLOAD_TYPES`）と衝突することが判明**。PBI本文の「案A（契約をコードに明示）」で着手すること。
- **03は当初「矛盾状態」と書いたが実際に起こりうる状態だった**: `opfsMigrationV2Done`（storage由来）と`opfsLegacyDbPath`（ライブprobe由来）は独立した情報源のため、「移行済みだがレガシーファイル削除に失敗」が実発生する。単なるテスト追加ではなく可視化の実装を含むPBIに改訂済み。
- **04は最後**: 視覚的差分ゼロを保つリファクタで実装コストが他候補より高い。

## 依存関係

**03 → 04 は順序依存**。両PBIとも `MigrationOpfsStatus` / `MigrationIdbStatus`（`diagnosticsPanel.ts:244-260`）を変更するため、並行着手するとコンフリクトする。01・02は他と独立しており並行可能。

## 調査で判明した重要事項（実装前に必読）

- **PBI 06**: `CONSENT_STATE_CHANGED` は `NO_PAYLOAD_TYPES`（`messageTypes.ts:249`）に登録済みで、`PayloadForType` が `never` に解決され、`messaging-types-uniformity.test.ts:147-158` が `payload: {}` を明示的に reject している。フィールド追加は3ファイル以上のSSOT改修（工数1.5〜2人日）を要するため、PBI本文の案A（低コスト）を推奨。
- **PBI 07**: 当初「あり得ない組み合わせ」と評価したが、`sqliteStatus.ts:95-119` の調査により実発生することが確定。ディスク二重消費がユーザーに見えない問題として扱う。
- **PBI 05**: 既存の `reentrancy guard` テスト（`issueReportLink.wire.test.ts:145-167`）は名前と実装が乖離しており（controllerを1つしか作っていない）、修正または削除が必要。

## 検証で却下された指摘（参考記録）

- LIKEインジェクション相当（`buildLikePattern`の無エスケープ）— 既存仕様であり今回のリファクタリングが生んだ経路ではないため却下
- `chrome.runtime.onMessage`のsender未検証（popup.ts）— 受信側が常にストレージへ再問い合わせする設計のため状態のなりすましに使えず却下
- `innerHTML`使用箇所（renderCompileOptions）— データ源がSQLite compile optionsのみで攻撃者到達不可のため却下
- `dashboard.ts`のcontroller複数生成によるリスナーリーク — `initDashboard()`が複数回呼ばれる経路が実際には存在しないため却下
- `planQueryMode`の直接テスト欠如 — 実際には`queryDispatchRegression.test.ts`に境界値テストが存在するため却下
- `OpfsWorkerBackend`の`planQueryMode`直接呼び出し vs `spec.mode`経由の非対称性 — 両者とも同一関数を参照しており実害シナリオを提示できないため却下

## 出典
- `/adversarial-code-review`によるアーキテクチャ深化ラウンド15（PBI 01〜04, 2026-09-14実装）のレビュー結果
