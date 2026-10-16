# PBI: 未知 subtype を黙って合格させる fail-open の解消

## ユーザーストーリー
拡張機能の利用者として、dashboard–SQLite 系メッセージの subtype 検証が未知値を見逃さないでほしい。なぜなら未知 subtype のペイロードが検証を素通りすると、想定外データの書き込み・表示という実害につながるから。

## 優先度
- 順位: 01 / 11
- RICEスコア: 12.0（Reach=6 / Impact=2 / Confidence=1.0 / Effort=1.0）
- 根拠: バリデータの fail-open は検証層の穴であり、到達経路（archive wire / envelope）が実在する。単一箇所の修正で両経路を塞げる。

## 背景
`src/messaging/validators.ts` の `interpretSubtypeSpec`（および薄ラッパ `evaluateSubtypeSpec`）は、スペック表にない未知 subtype に対して `null`（合格）を返す。レビュー指摘 Low #13（Data Integrity / API & Contract）。Phase 5 の単一化（NN 前提ではなく本 PBI の前提：`interpretSubtypeSpec` が存在すること。存在しない場合は `evaluateSubtypeSpec` と `DashboardSqliteValidator.validate` の両方を直す）。

## BDD受け入れシナリオ
Scenario: 未知 subtype の wire 検証は拒否する
  Given `DASHBOARD_SQLITE_SUBTYPE_SPECS` に存在しない subtype のペイロード
  When `evaluateSubtypeSpec`（または `interpretSubtypeSpec`）で評価する
  Then 拒否（非 null の失敗）を返す

Scenario: 未知 subtype の envelope 検証は例外を投げる
  Given 同上のペイロードを `DashboardSqliteValidator.validate` に渡す
  When 検証する
  Then `ValidationError` が投げられる

Scenario: 既知 subtype の正常系は変わらない
  Given 既知 subtype の正当ペイロード
  When 両経路で評価する
  Then 従来どおり合格する（等価性テストが緑）

## 受け入れ基準
- [x] 未知 subtype が wire / envelope の両経路で拒否される
- [x] `src/messaging/__tests__/subtypeSpec-single-interpreter.test.ts` の unknown-subtype 期待が「拒否」に更新され緑
- [x] `archivePayloadValidation-parity.test.ts` を含む messaging 系テストが全緑

## テスト戦略
- 単体: 未知 subtype の拒否テスト（wire / envelope 各1件以上）
- 既存: `npx vitest run src/messaging/` 全緑
- E2E: 不要（検証層の単体責務）

## 見積もり
1.0 SP

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了（差分点検済み：未知値拒否のみ、既知specless正常系不変）
- [x] ドキュメント更新済み（不要ならその旨を記録）— 不要: docs/・dev-docs/ に対象挙動の記述なし。コード内 doc comment（`interpretSubtypeSpec`）のみ更新済み
