# PBI: SQLITE_HISTORY_IDS所有の是正

## ユーザーストーリー

保守担当者として、DOM idの正本をregion側に置きたい。なぜなら無関係な1100行viewを跨がないとregionが理解できず、id追加の変更理由が所有者でない側に発生するから。

## 優先度

- 順位: 07 / 全8件
- RICE スコア: 4（Reach = 4 / Impact = 1 / Confidence = 1.0 / Effort = 1.0人日）
- 根拠: NN05 の前に実施（同 view 群に触れるため）。NN06 と同点のため、NN06 のリスク軽減を優先して後に置く。

## ビジネス価値

id変更がregion内で完結し、regionの独立再利用が可能になる。

## BDD受け入れシナリオ

```gherkin
Scenario: id変更がregion内で完結する
  Given regionにid追加がある
  When 追加する
  Then view本体の変更なしに済む

Scenario: 描画は変更前と同一
  Given 全regionがある
  When 描画する
  Then 変更前と同一のDOMになる
```

## 受け入れ基準

- [x] id所有が各regionまたはids専用小moduleに移り、viewが輸入側に回る
- [x] 既存テスト全緑

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- なし

### 統合テスト
- panel経由の描画テスト維持

### 単体テスト
- なし（配置移動のみ）

## 実装アプローチ

- **Outside-In**: 移動前後で描画テストが緑のままであることを確認する

## 見積もり

1pt（🟢低）

## 技術的考慮事項

- 依存関係: NN05 は本 PBI の後に実施（同 view 群）
- 非機能要件: DOM id の文字列不変（所有だけ移す）

## 変更点の概要

id正本をregion側（またはids専用module）に移す。

## 現状と問題（file:line 付き）

- `src/dashboard/panels/asyncData/sqliteHistoryPanelView.ts:337-378` ― 正本の所有
- `askHistoryPanelView.ts:18,76`・`researchReportPanelView.ts:17,58`・`savedCollectionsPanelView.ts:19,92` ― 3 regionの輸入
- messaging逆依存ADRの「単一情報源を正本に置く」判例あり

## 変更の理由（locality）

変更理由の発生側と所有側の不一致。移して完結させる。

## 提案コード（骨子のみ）

```typescript
// 案A: 各region moduleが自idを持つ。案B: ids専用小moduleに分離。
// いずれも文字列不変・viewは輸入側。
```

## 実装者向け注記

### 現状コードの確認

```bash
grep -rn "SQLITE_HISTORY_IDS" src/dashboard/ --include='*.ts' | grep -v __tests__ | head
```

### 落とし穴

- id文字列を1文字も変えない（所有移動のみ）
- 案A/Bは輸入元を数えて少ない方を選ぶ

## Definition of Done

- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] 既存テスト全通過
- [x] コードレビュー完了
- [ ] `npm run validate` 通過
- [x] ドキュメント更新済み
