# PBI: sqliteHistoryPanel配線集中の緩和

## ユーザーストーリー

保守担当者として、region配線をpanelから分散させたい。なぜならregion追加のたびに768行のpanelが膨らみ、1概念の理解に5層横断が必要だから。

## 優先度

- 順位: 05 / 全8件
- RICE スコア: 4（Reach = 5 / Impact = 3 / Confidence = 0.8 / Effort = 3.0人日）
- 根拠: NN07（id所有是正）の後に実施（同panel・view群に触れるため）。同点のNN06より実施順を先に置く（region成長が進行中の作業のため時間的緊急性が高い）。

## ビジネス価値

region追加がpanel無編集で済み、不具合・検証がregion内に集中する。

## BDD受け入れシナリオ

```gherkin
Scenario: region追加がpanel無編集で済む
  Given 新しいregionがある
  When 追加する
  Then panel本体の変更なしに mount/load できる

Scenario: 既存regionは変更前と同一
  Given 既存の全regionがある
  When 描画・取得する
  Then 変更前と同一に動作する
```

## 受け入れ基準

- [ ] ask/generate/saveの所有が各region moduleに移る
- [ ] panelがmount/load配線のみに薄化する
- [ ] 既存テスト全緑

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- なし

### 統合テスト
- panel経由の全region描画テスト維持

### 単体テスト
- regionごとの小さい束ねのテスト

## 実装アプローチ

- **Outside-In**: region単位の失敗テストを先に書き、赤を確認してから移す

## 見積もり

3pt（🔴高）

## 技術的考慮事項

- 依存関係: NN07 の後に実施（同 view 群）。NN02 の正本の上で組立てることが望ましい
- 非機能要件: 描画・取得の振舞い不変

## 変更点の概要

`createCallbacks` の一括束ねをregionごとの小さい束ねに分割し、所有を移す。

## 現状と問題（file:line 付き）

- `src/dashboard/panels/asyncData/sqliteHistoryPanel.ts:127,443,503,549,607,637,697` ― model生成・20超handle束・各load
- region views（ask・research・saved）＋ `sqliteHistoryModel.ts:1`
- ADR panel-lifecycle-wave1 は lifecycle 直実装のみで配線集中は未解決

## 変更の理由（depth・locality）

768行への追加集中。分割で追加コストと修正集中を得る。

## 提案コード（骨子のみ）

```typescript
// 各region moduleが自前の callbacks 束ねを持つ。
// panel は mount/load の配線のみに薄化する。
```

## 実装者向け注記

### 現状コードの確認

```bash
grep -n "createCallbacks\|renderSaved\|loadPending" src/dashboard/panels/asyncData/sqliteHistoryPanel.ts | head
```

### 落とし穴

- 3pt のため分割実施を検討する（region 単位で段階化し、各段階で緑を保つ）
- NN07 と同ファイルを触るため必ず後に実施する

## Definition of Done

- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] 既存テスト全通過
- [ ] コードレビュー完了
- [ ] `npm run validate` 通過
- [ ] ドキュメント更新済み
