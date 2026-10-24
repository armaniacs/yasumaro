# PBI: slotFailures の検証対称化

## ユーザーストーリー

利用者として、失敗詳細にゴミ行を見たくない。なぜなら不正形の要素が無検証で描画に渡り、文字反復や欠落行が出るから。

## 優先度

- 順位: 09 / 全11件
- RICE スコア: 4（Reach = 2 / Impact = 1 / Confidence = 1.0 / Effort = 0.5人日）
- 根拠: attemptedProviders 側は検証済みで slotFailures 側だけ素通しという非対称の解消。

## ビジネス価値

表示ゴミは運用の誤読を招く。対称な検証で表示を保つ。

## BDD受け入れシナリオ

```gherkin
Scenario: 不正な要素は除外される
  Given slotFailures に不正な要素（null・文字列・欠落）が混じる
  When 描画する
  Then 不正要素は除外され、ゴミ行が出ない

Scenario: 正常な要素は変更前と同一
  Given 正常な slotFailures がある
  When 描画する
  Then 変更前と同一に表示される
```

## 受け入れ基準

- [x] slotFailures の要素検証が attemptedProviders 側と対称になる
- [x] 既存テスト全緑

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- なし

### 統合テスト
- なし

### 単体テスト
- 要素検証の table テスト（正常・null・文字列・欠落）

## 実装アプローチ

- **Outside-In**: 不正要素の失敗テストを先に書き、赤を確認してから直す

## 見積もり

0.5pt（🟢低）

## 技術的考慮事項

- 依存関係: なし（NN03 と同 panel に触れるが別箇所のため並列可）
- 非機能要件: 正常要素の表示は不変

## 変更点の概要

slotFailures 側にも attemptedProviders 側と対称の要素検証を足す。

## 現状と問題（file:line 付き）

- `src/dashboard/panels/asyncData/sqliteHistoryPanel.ts:234-235` ― slotFailures は `in` のみで無検証のまま描画に渡る（`:229-232` の attemptedProviders 側は検証済み）

## 変更の理由（エラーハンドリング）

非対称の検証は将来の provider 側 typo を表示ゴミとして出すだけで検出できない。

## 提案コード（骨子のみ）

```typescript
// attemptedProviders 側と同形の要素ガードを slotFailures 側に足す。
```

## 実装者向け注記

### 現状コードの確認

```bash
grep -n "slotFailures\|attemptedProviders" src/dashboard/panels/asyncData/sqliteHistoryPanel.ts | head -20
```

### 落とし穴

- 正常要素の表示を変えない（既存テストが緑のままであること）

## Definition of Done

- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] 既存テスト全通過 + table テスト新規通過
- [x] コードレビュー完了
- [x] `npm run validate` 通過
- [x] ドキュメント更新済み
