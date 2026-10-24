# PBI: 薄い委譲3枚の畳み込み

## ユーザーストーリー

保守担当者として、SQLite二次ストアの委譲3枚を畳みたい。なぜならinterfaceと同大の3行委譲でdepthがなく、deletion testでshallow確定だから。

## 優先度

- 順位: 07 / 全8件
- RICE スコア: 3.2（Reach = 6 / Impact = 1 / Confidence = 0.8 / Effort = 1.5人日）
- 根拠: NN06 の後に実施（dbMaintenanceに触れるため）。Confidence 0.8 はテスト移行コストのため。

## ビジネス価値

呼び側は1つのinterfaceを学べば全操作を使え、委譲先変更が1箇所に集まる。

## BDD受け入れシナリオ

```gherkin
Scenario: 全操作が単一moduleで動く
  Given 各種の保存・照会操作がある
  When 実行する
  Then 変更前と同一に動作する

Scenario: 委譲先変更が1箇所で済む
  Given 委譲先を変えたい
  When 変える
  Then 1箇所で済む
```

## 受け入れ基準

- [x] 3 moduleが単一moduleに畳まれ、必要操作だけ残る
- [x] テストがmoduleのinterface越しに書き直される
- [x] 既存テスト全緑

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- なし

### 統合テスト
- runners経由のテスト維持

### 単体テスト
- 単一moduleのtableテスト

## 実装アプローチ

- **Outside-In**: 単一moduleの失敗テストを先に書き、赤を確認してから畳む

## 見積もり

1.5pt（🟡中）

## 技術的考慮事項

- 依存関係: NN06 の後に実施（dbMaintenanceに触れるため）
- 非機能要件: 操作結果不変。module単位mockの移行に注意

## 変更点の概要

3枚の委譲を単一moduleに畳む。

## 現状と問題（file:line 付き）

- `src/offscreen/recordsRepo.ts:9-115` ― 10操作の委譲
- `src/offscreen/auditLogRepo.ts:10-42` ― 3操作の委譲
- `src/offscreen/dbMaintenance.ts:10-71` ― 5操作の委譲
- runners（`sqliteMessageHandlers.ts:81-122`）が呼び側

## 変更の理由（depth）

deletion testでshallow確定。畳んでdepthを上げる。

## 提案コード（骨子のみ）

```typescript
// 単一SQLite二次ストアmodule。必要操作だけをinterfaceに残す。
```

## 実装者向け注記

### 現状コードの確認

```bash
grep -n "export function\|export const" src/offscreen/recordsRepo.ts src/offscreen/auditLogRepo.ts src/offscreen/dbMaintenance.ts | head -20
```

### 落とし穴

- テストのmodule単位mock移行がコストのため段階化する
- 操作結果を変えない

## Definition of Done

- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] 既存テスト全通過
- [x] コードレビュー完了
- [x] `npm run validate` 通過
- [x] ドキュメント更新済み
