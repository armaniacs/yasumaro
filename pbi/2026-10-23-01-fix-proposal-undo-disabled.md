# PBI: 提案行の取消ボタン永久disabledの修正

## ユーザーストーリー

利用者として、提案の適用・取消を何度でも繰返したい。なぜなら2サイクル目の取消ボタンが押せなくなるから。

## 優先度

- 順位: 01 / 全11件
- RICE スコア: 24（Reach = 4 / Impact = 3 / Confidence = 1.0 / Effort = 0.5人日）
- 根拠: 前提条件なしで再現する実害（Impact 3）。両 panel が共有 seam 経由で発症する。

## ビジネス価値

提案の適用・取消の繰返しが壊れていると、ユーザーは取消のため再描画を強いられる。修正で操作の往復が保たれる。

## BDD受け入れシナリオ

```gherkin
Scenario: 適用・取消を2往復できる
  Given 提案行が1件ある
  When 適用→取消→適用→取消する
  Then 2回目の取消が押せ、状態表示が正しく遷移する

Scenario: 失敗時の復元
  Given 取消が失敗する
  When 取消する
  Then 取消ボタンが復元され、失敗文が表示される
```

## 受け入れ基準

- [ ] undo 成功パスで `undoButton.disabled` が戻る（または disabled を使わない設計に変える）
- [ ] 2往復の pin テストが両 panel にある
- [ ] 既存テスト全緑

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- なし

### 統合テスト
- 両 panel の2往復フロー（既存 pin を拡張）

### 単体テスト
- 共有 seam の2サイクルテスト新規（適用→取消→適用→取消で disabled 遷移を pin）

## 実装アプローチ

- **Outside-In**: 2往復の失敗テストを先に書き、赤を確認してから直す
- **Red-Green-Refactor**: seam の1箇所を直し、両 panel が緑になることを確認する

## 見積もり

0.5pt（🟢低）

## 技術的考慮事項

- 依存関係: なし
- 非機能要件: 単一サイクルの挙動不変

## 変更点の概要

共有 seam の undo 成功パスで `disabled` を戻す（または hidden のみに一本化する）。

## 現状と問題（file:line 付き）

- `src/dashboard/proposalRowWiring.ts:73-80` ― undo 成功時に `hidden = true` と apply 復帰のみで `undoButton.disabled = false` がない。適用成功時（`:58-62`）も undo の disabled を戻さない
- 主スレッドが実読で再現を確認（適用→取消→再適用後の取消が永久 disabled。再描画まで回復しない）

## 変更の理由（エラーハンドリング・状態管理）

`disabled` と `hidden` は独立の状態であり、成功パスが `hidden` だけ操作している。旧コードの同バグを共有 seam に移植した形。

## 提案コード（骨子のみ）

```typescript
// undo 成功パスに undoButton.disabled = false を追加する方向。
// または disabled 運用をやめ hidden のみに一本化する（両 panel のテストで挙動を固定する）。
```

## 実装者向け注記

### 現状コードの確認

```bash
grep -n "disabled" src/dashboard/proposalRowWiring.ts
```

### 落とし穴

- 両 panel（tagsPanel・domainAnalysisPanel）が同 seam を共有するため、片方だけの修正では直らない。seam の1箇所を直す

## Definition of Done

- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] 既存テスト全通過 + 2往復 pin 新規通過
- [ ] コードレビュー完了
- [ ] `npm run validate` 通過
- [ ] ドキュメント更新済み
