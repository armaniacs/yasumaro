# PBI: コレクション削除の prototype 付け替え退行の修正

## ユーザーストーリー

利用者として、保存したコレクションを失いたくない。なぜなら削除操作の書換えで特殊キーの扱いが退行し、汚染された保存形で項目が消失しうるから。

## 優先度

- 順位: 06 / 全11件
- RICE スコア: 5.3（Reach = 2 / Impact = 1 / Confidence = 0.8 / Effort = 0.3人日）
- 根拠: 到達には汚染された保存形の own キーが必要なため Confidence 0.8。実害の形（項目消失）のため NN08 より先に置く。

## ビジネス価値

保存データの消失は実害。安全な複製に戻して消失経路を塞ぐ。

## BDD受け入れシナリオ

```gherkin
Scenario: 通常削除は変更前と同一
  Given 複数のコレクションがある
  When 1件を削除する
  Then 対象だけが消え、残りは同一に残る

Scenario: 特殊キーの境界
  Given 保存形に特殊キー（`__proto__` など）が混入している
  When 削除操作をする
  Then prototype 付け替えが起きず、安全に処理される
```

## 受け入れ基準

- [x] 削除が安全な複製（own property 化）に戻る
- [x] 特殊キーの境界テストがある
- [x] 既存テスト全緑

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- なし

### 統合テスト
- なし

### 単体テスト
- removeSavedCollection の特殊キー table テスト新規

## 実装アプローチ

- **Outside-In**: 特殊キーの失敗テストを先に書き、赤を確認してから直す

## 見積もり

0.5pt（🟢低）

## 技術的考慮事項

- 依存関係: なし
- 非機能要件: 通常削除の結果はバイト同一が望ましい

## 変更点の概要

手書きループを安全な複製（`Object.fromEntries` の filter 形など、CreateDataProperty 意味）に戻す。

## 現状と問題（file:line 付き）

- `src/utils/storage/savedCollections.ts:75-78` ― round2 で rest-spread から手書きループ `rest[key] = value` に変わり、`__proto__` で setter 経由の付け替えになる。旧 spread は安全だったため局所的な退行
- 到達条件: 保存形に own の特殊キーが必要（通常操作では生じない。到達の留保付き）

## 変更の理由（型安全性・データ保全）

代入と定義は `__proto__` に対して意味が異なる。round2 が導入した退行のため本ラウンドで戻す。

## 提案コード（骨子のみ）

```typescript
// 例: Object.entries(map).filter(([key]) => key !== id) を
// Object.fromEntries で戻す（CreateDataProperty 意味で安全）。
```

## 実装者向け注記

### 現状コードの確認

```bash
grep -n "rest\[key\]" src/utils/storage/savedCollections.ts
```

### 落とし穴

- 通常削除の結果を変えない（既存テストが緑のままであること）
- upsert 側（`:67` の spread 計算キー）は define 意味で安全のため対象外

## Definition of Done

- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] 既存テスト全通過 + 境界テスト新規通過
- [x] コードレビュー完了
- [ ] `npm run validate` 通過
- [x] ドキュメント更新済み
