# PBI: 再生成エラー変換の集約

## ユーザーストーリー

保守担当者として、応答→表示detail変換を1 moduleに集めたい。なぜならpure抽出と生産経路のinline判定が二重化し、pureのテストが生産経路を守っていないから。

## 優先度

- 順位: 03 / 全8件
- RICE スコア: 6（Reach = 3 / Impact = 2 / Confidence = 1.0 / Effort = 1.0人日）
- 根拠: NN02 の正本の上で組立てるため NN02 の後に実施する。

## ビジネス価値

二重化は片側だけ直る修正を生む。集約で修正が1箇所になり、テストが生産経路を直接守る。

## BDD受け入れシナリオ

```gherkin
Scenario: 変換が1箇所に集まる
  Given gateway応答がある
  When 表示detailに変換する
  Then 集約module経由で変更前と同一に表示される

Scenario: 生産経路が直接守られる
  Given 不正な要素が混じる
  When 変換する
  Then 生産経路のテストで検出される
```

## 受け入れ基準

- [x] inline絞り込みがmodule内に吸収され、panelは呼ぶだけになる
- [x] 生産経路を直接叩くテストがある
- [x] 既存テスト全緑

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- なし

### 統合テスト
- panel経由の表示テスト維持

### 単体テスト
- 集約moduleのtable（既存の行列を移設・拡張）

## 実装アプローチ

- **Outside-In**: 生産経路の失敗テストを先に書き、赤を確認してから集約する

## 見積もり

1pt（🟢低）

## 技術的考慮事項

- 依存関係: NN02 の後に実施（正本の上で組立てるため）
- 非機能要件: 表示結果は不変

## 変更点の概要

ゲートウェイ応答→表示detail変換全体を一つのmoduleに集約する。

## 現状と問題（file:line 付き）

- `src/dashboard/panels/asyncData/sqliteHistoryPanel.ts:58,71,94` ― pure抽出群
- `:243-265` ― 生産経路のinline絞り込み（同等ロジックの二重化）
- `__tests__/sqliteHistoryPanelRegenerate.test.ts:41` ― pure行列のみ固定し生産経路を守らない

## 変更の理由（locality）

呼び側の知識がmodule外に残る。集約で修正点が1箇所になる。

## 提案コード（骨子のみ）

```typescript
// 応答→detail変換の単一interfaceを持つmoduleを新設（または既存pure群を拡張し、
// inline側を委譲に置換する）。
```

## 実装者向け注記

### 現状コードの確認

```bash
grep -n "isSlotFailureRecord\|formatRegenerateErrorDetail\|mapRegenerateError" src/dashboard/panels/asyncData/sqliteHistoryPanel.ts | head
```

### 落とし穴

- 表示結果を変えない（既存テストが緑のまま移設されること）
- NN09（slotFailures対称化）の検証と重複させない

## Definition of Done

- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] 既存テスト全通過
- [x] コードレビュー完了
- [x] `npm run validate` 通過
- [x] ドキュメント更新済み
