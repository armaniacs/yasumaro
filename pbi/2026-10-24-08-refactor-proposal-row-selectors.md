# PBI: proposalRowWiring selectorsの畳み込み

## ユーザーストーリー

保守担当者として、行seamの覚える量を減らしたい。なぜならinterfaceがimplementationと同等以上に複雑で、片側だけが使う知識の対価を全呼び側が払うから。

## 優先度

- 順位: 08 / 全8件
- RICE スコア: 2.4（Reach = 3 / Impact = 1 / Confidence = 0.8 / Effort = 1.0人日）
- 根拠: leverage小幅・主としてlocality改善のため最下位。Confidence 0.8 はseam配置の設計判断残り。

## ビジネス価値

行振る舞いの変更が1箇所に集まり、呼び側が文字列を覚えずに済む。

## BDD受け入れシナリオ

```gherkin
Scenario: 呼び側が文字列を覚えない
  Given 提案行がある
  When 配線する
  Then selector文字列なしに配線できる

Scenario: 振舞いは変更前と同一
  Given 適用・取消がある
  When 操作する
  Then 変更前と同一に遷移する
```

## 受け入れ基準

- [x] selectors引数が畳まれる（または行生成ごと共有化される）
- [x] 既存テスト全緑

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- なし

### 統合テスト
- 両panelの適用・取消フロー維持

### 単体テスト
- 共有seamの既存テスト維持・拡張

## 実装アプローチ

- **Outside-In**: 畳んだ形の失敗テストを先に書き、赤を確認してから寄せる

## 見積もり

1pt（🟢低）

## 技術的考慮事項

- 依存関係: なし
- 非機能要件: 振舞い不変。sqlite deep-dig F（ファイル分割より引数化）の系譜でseam配置を決める

## 変更点の概要

行構造の契約を固定化してselectors引数を畳む（または行生成ごと共有化する）。

## 現状と問題（file:line 付き）

- `src/dashboard/proposalRowWiring.ts:17,28,34,44` ― selector×3＋action×2＋任意整形
- `src/dashboard/tagsPanel.ts:232`・`src/dashboard/panels/asyncData/domainAnalysisPanel.ts:165` ― 呼び側
- `formatApplyError`／`restoreOnSuccess` は片側だけが使う知識

## 変更の理由（depth）

deletion testで複雑さが消えない＝shallow。契約固定で畳む。

## 提案コード（骨子のみ）

```typescript
// 行構造（apply/undo/status配置）の契約を固定し、selectorsを既定化。
// または行生成ごと共有化して呼び側から文字列を消す。
```

## 実装者向け注記

### 現状コードの確認

```bash
grep -n "wireProposalRow\|ProposalRowSelectors" src/dashboard/tagsPanel.ts src/dashboard/panels/asyncData/domainAnalysisPanel.ts | head
```

### 落とし穴

- 振舞いを変えない（既存の2往復pinが緑のままであること）
- 過度な一般化はしない（呼び側は2件のみ）

## Definition of Done

- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] 既存テスト全通過
- [x] コードレビュー完了
- [ ] `npm run validate` 通過
- [x] ドキュメント更新済み
