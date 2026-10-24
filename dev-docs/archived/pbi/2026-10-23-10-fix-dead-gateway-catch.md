# PBI: 到達不能な gateway catch の整理

## ユーザーストーリー

保守担当者として、誤読を誘う catch とコメントをなくしたい。なぜなら gateway は常に resolve するため catch は発火せず、将来の throw 経路追加時に正常系と混同されるから。

## 優先度

- 順位: 10 / 全11件
- RICE スコア: 3.3（Reach = 2 / Impact = 0.5 / Confidence = 1.0 / Effort = 0.3人日）
- 根拠: 誤読防止の小整理。NN03 と同 panel に触れるが別箇所のため並列可。

## ビジネス価値

誤読を誘うコードは将来の誤変更を招く。整理で混同を防ぐ。

## BDD受け入れシナリオ

```gherkin
Scenario: 正常系は変更前と同一
  Given 正常応答がある
  When 処理する
  Then 変更前と同一に表示される

Scenario: コメントが実態と一致する
  Given gateway の resolve 契約がある
  When コードを読む
  Then throw 経路の説明として誤読されない記述になっている
```

## 受け入れ基準

- [x] 到達不能な catch が整理される（削除または実態に合う記述に）
- [x] 既存テスト全緑

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- なし

### 統合テスト
- なし

### 単体テスト
- 既存テスト維持（新規ロジックなし）

## 実装アプローチ

- **Outside-In**: 整理前後で既存テストが緑のままであることを確認する

## 見積もり

0.5pt（🟢低）

## 技術的考慮事項

- 依存関係: なし
- 非機能要件: 実行時挙動不変

## 変更点の概要

発火しない catch の整理と、sentinel コメントの実態合わせ。

## 現状と問題（file:line 付き）

- `src/dashboard/panels/asyncData/sqliteHistoryPanel.ts:608-611,646-649` ― gateway は内部で catch して resolve するため catch は発火しない（`sendWithPolicy.ts:51-65`）。「gateway timeout maps to its sentinel」のコメントが throw 経路の説明として誤読を誘う

## 変更の理由（可読性）

あるはずのない安全網は、将来の throw 経路追加時に正常系と混同される。

## 提案コード（骨子のみ）

```typescript
// catch を削るか、「gateway は resolve のみ・ここは防御的既定」の旨に書き換える。
```

## 実装者向け注記

### 現状コードの確認

```bash
grep -n "maps to its sentinel" src/dashboard/panels/asyncData/sqliteHistoryPanel.ts
```

### 落とし穴

- 実行時挙動を変えない（整理のみ）。削る場合は防御的既定としての価値を先に判断する

## Definition of Done

- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] 既存テスト全通過
- [x] コードレビュー完了
- [x] `npm run validate` 通過
- [x] ドキュメント更新済み
