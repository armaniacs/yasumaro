# バックログ: adversarial-code-review検証済み指摘のPBI化（2026-09-14）

`/adversarial-code-review`でアーキテクチャ深化ラウンド15（PBI 01〜04）を対象にレビューし、裏取りを経て確定した保守担当者視点の指摘4件の優先順位一覧。ハッカー視点の指摘は全て裏取りで却下（既存仕様・攻撃不成立と判定）されたため対象外。

## 優先順位表

| 順位 | 候補 | RICEスコア | Reach | Impact | Confidence | Effort | 依存関係 | ファイル |
|---|---|---|---|---|---|---|---|---|
| 01 | attachTriggerに多重登録防止ガードを追加 | 16.0 | 開発者(月数回) | 2 | 100% | 0.5人日 | なし | [2026-09-14-05-refactor-issue-report-attach-trigger-guard.md](2026-09-14-05-refactor-issue-report-attach-trigger-guard.md) |
| 02 | CONSENT_STATE_CHANGEDにconsented値を含める | 8.0 | 開発者(将来の購読者) | 1 | 100% | 0.5人日 | なし | [2026-09-14-06-refactor-consent-state-changed-payload.md](2026-09-14-06-refactor-consent-state-changed-payload.md) |
| 03 | opfsDone矛盾入力のテスト追加 | 3.2 | 開発者(月数回) | 0.5 | 80% | 0.5人日 | なし | [2026-09-14-07-test-opfs-done-legacy-path-contradiction.md](2026-09-14-07-test-opfs-done-legacy-path-contradiction.md) |
| 04 | renderMigrationSectionの表示優先順位ロジック再分離 | 1.6 | 開発者(月数回) | 1 | 80% | 1人日 | なし | [2026-09-14-08-refactor-migration-section-display-state.md](2026-09-14-08-refactor-migration-section-display-state.md) |

## 根拠の要約

- **01が最上位**: adversarial-code-reviewで唯一「成立」と裏取りされた保守担当者視点の指摘のうち、実装コストが最小（WeakSetガード追加のみ）で、放置すると将来UX事故（1クリックで複数タブが開く）に直結する。
- **02が次点**: 型システムで区別を強制する改修で後方互換を保ちながら安全性を高められる。実害は現状ゼロだが将来の購読者の罠を防ぐ。
- **03は望ましい仕様の判断が先に必要**: テスト追加自体は小さいが、矛盾状態の「あるべき表示」をチームで決める必要がありConfidenceがやや低い。
- **04は最後**: 視覚的差分ゼロを保つリファクタで実装コストが他候補より高く、他3件より緊急性が低い。

依存関係は4候補間で一切なし。

## 検証で却下された指摘（参考記録）

- LIKEインジェクション相当（`buildLikePattern`の無エスケープ）— 既存仕様であり今回のリファクタリングが生んだ経路ではないため却下
- `chrome.runtime.onMessage`のsender未検証（popup.ts）— 受信側が常にストレージへ再問い合わせする設計のため状態のなりすましに使えず却下
- `innerHTML`使用箇所（renderCompileOptions）— データ源がSQLite compile optionsのみで攻撃者到達不可のため却下
- `dashboard.ts`のcontroller複数生成によるリスナーリーク — `initDashboard()`が複数回呼ばれる経路が実際には存在しないため却下
- `planQueryMode`の直接テスト欠如 — 実際には`queryDispatchRegression.test.ts`に境界値テストが存在するため却下
- `OpfsWorkerBackend`の`planQueryMode`直接呼び出し vs `spec.mode`経由の非対称性 — 両者とも同一関数を参照しており実害シナリオを提示できないため却下

## 出典
- `/adversarial-code-review`によるアーキテクチャ深化ラウンド15（PBI 01〜04, 2026-09-14実装）のレビュー結果
