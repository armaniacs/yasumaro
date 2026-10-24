# PBI: 応答型の判別 union 化

## ユーザーストーリー

保守担当者として、成功形と失敗形の混入を型で排除したい。なぜなら現行の同居型では失敗形の混入が沈黙し、後段アクセスが誤動作するから。

## 優先度

- 順位: 08 / 全11件
- RICE スコア: 4.3（Reach = 4 / Impact = 2 / Confidence = 0.8 / Effort = 1.5人日）
- 根拠: 混入バグの類型防止。型変更のため NN03 の後に実施する（同 gateway 群）。

## ビジネス価値

型で排除できない混入は将来の表示誤動作になる。判別 union で混入を検出可能にする。

## BDD受け入れシナリオ

```gherkin
Scenario: 成功形と失敗形が判別される
  Given 成功応答と失敗応答がある
  When 型で分岐する
  Then 失敗形の混入がコンパイル時に検出される

Scenario: 実行時は変更前と同一
  Given 正形の応答がある
  When gateway が処理する
  Then 変更前と同一に処理される
```

## 受け入れ基準

- [x] 応答型が判別 union になる（成功・失敗のどちらかに絞れる）
- [x] 呼出し側の分岐が型で守られる
- [x] 既存テスト全緑

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- なし

### 統合テスト
- panel 呼出し側の分岐テスト

### 単体テスト
- 型レベルの pin（既存の型アサート流儀に従う）+ ガードの table

## 実装アプローチ

- **Outside-In**: 型で落ちるケースを先に書き、赤を確認してから直す

## 見積もり

1.5pt（🟡中）

## 技術的考慮事項

- 依存関係: NN03 の後に実施（同 gateway 群の型に触れるため）
- 非機能要件: 実行時挙動不変（型のみの変更が望ましい）

## 変更点の概要

応答型を判別 union にし、ガードと呼出し側をそれに寄せる。

## 現状と問題（file:line 付き）

- `src/messaging/types.ts:81-89` ― `AskHistoryResponse` が `success:boolean` + `error?` 同居型で判別不能
- `src/dashboard/panels/asyncData/sqliteHistoryPanel.ts:592-607` ― 後段アクセスが失敗形混入を型で排除できない

## 変更の理由（型安全性）

弱い型の上に載る呼出し側は将来の混入に沈黙する。判別 union で検出可能にする。

## 提案コード（骨子のみ）

```typescript
// 例: { success: true; ... } | { success: false; error: string } の形に寄せ、
// ガードの戻りと呼出し側の分岐をそれに合わせる。
```

## 実装者向け注記

### 現状コードの確認

```bash
grep -rn "AskHistoryResponse\|ResearchReportResponse" src/messaging/types.ts src/messaging/*.ts | grep -v __tests__ | head -20
```

### 落とし穴

- 実行時挙動を変えない（型変更に留める）。呼出し側の型エラーは分岐追加で解消する
- 他の Response 型への波及範囲を先に数える

## Definition of Done

- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] 既存テスト全通過
- [x] コードレビュー完了
- [x] `npm run validate` 通過
- [x] ドキュメント更新済み
