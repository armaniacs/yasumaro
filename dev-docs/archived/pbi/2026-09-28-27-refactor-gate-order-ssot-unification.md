# PBI: gate 順序 SSOT の一本化（ADR 裁定 + 実装）

種別: refactor
状態: 実装済み（2026-09-28）

上流: 大局的コードレビュー 2026-09-28 テーマ3。順序の正本がコメントと実装で二重化している。

## ユーザーストーリー

記録許可ゲートの順序を変える開発者として、1箇所の変更で pipeline とテストの両方に反映され、どちらが正本か迷わない状態を目指す。

## 優先度

- 順位: 4 / 7
- RICE スコア: 6.4（Reach=4 / Impact=2 / Confidence=80% / Effort=1.0）
- 根拠: 順序変更が片方にしか届かないと記録可否の判定が静かに変わる。ADR 裁定が必要なため Confidence は 80%

## 現状と問題（file:line 証拠付き）

- `src/background/pipeline/RecordingOrchestrator.ts:91` のコメントは「order SSOT is recordingGateTable.ts」と宣言しながら、`:92-102` で 9 段の `preSaveSteps` を手書き列挙している
- `src/background/pipeline/steps/index.ts:34-61` は `RECORDING_GATE_TABLE` から `ADMISSION_GATE_ORDER` を導出し、`createAdmissionGateSteps` で table 順の adapter を提供するが、本番からの参照はゼロ（参照は `steps/__tests__/admissionGateSteps.test.ts` のみ）
- table 更新が pipeline に届かない状態であり、テストだけが通る

## BDD 受け入れシナリオ

```gherkin
Scenario: table の順序変更が pipeline に反映される
  Given RECORDING_GATE_TABLE の順序を変える
  When pipeline を実行する
  Then 実行順序が table 順になる（または ADR で手書き正本と裁定した旨が記録される）

Scenario: 正本が1つである
  Given レビュー完了後
  When `rg 'preSaveSteps|ADMISSION_GATE_ORDER|createAdmissionGateSteps'` を実行する
  Then 手書き配列と導出配列の両方が本番に残っていない
```

## 受け入れ基準

- [x] ADR で方向を裁定する（orchestrator の table 駆動化 / 手書き正本の承認の二択）
- [x] 裁定に従い、未使用側（手書き配列または導出関数群）を削除または本番接続する
- [x] `privacyHeaders` adapter の二重定義（`steps/index.ts:56-57` と `RecordingOrchestrator.ts:111-114`）を解消する

## テスト戦略

- 単体: gate 順序の pin テスト（table 順と実行順の一致）。既存 `admissionGateSteps.test.ts` を正本に合わせて更新または削除する
- E2E 変更なし（順序の意味論は変えない）

## 見積もり

1.0 SP

## Definition of Done

- [x] ADR が起票され、裁定が記録される
- [x] BDD シナリオに対応するテストがパスする
- [x] `npm run validate` が通る
