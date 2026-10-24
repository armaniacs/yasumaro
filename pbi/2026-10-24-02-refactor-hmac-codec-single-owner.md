# PBI: HMAC・codec知識の単一所有化

## ユーザーストーリー

保守担当者として、鍵・payload・iteration知識を1箇所に集めたい。なぜなら3 module分散で、1つ外すと復号不能＝鍵喪失になるから。

## 優先度

- 順位: 02 / 全8件
- RICE スコア: 8（Reach = 5 / Impact = 3 / Confidence = 0.8 / Effort = 1.5人日）
- 根拠: 鍵喪失級リスクの集中（Impact 3）。NN06 は本 PBI の後に実施（settingsExportImportに触れるため）。

## ビジネス価値

KDF・HMAC変更が1箇所に閉じ、復号不能級事故の混入点が減る。

## BDD受け入れシナリオ

```gherkin
Scenario:  export・import・復元が単一interfaceで動く
  Given 設定とpasswordがある
  When export・import・復元する
  Then 変更前と同一に動作する

Scenario: iteration変更が1箇所で済む
  Given iterationを変えたい
  When 正本を変える
  Then 全体に反映される
```

## 受け入れ基準

- [x] payload・iteration・署名検証がcodec単一module背後に集まる
- [x] settings側がpasswordとJSONだけ渡す形になる
- [x] 既存テスト全緑（復号不能の回帰なし）

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- なし

### 統合テスト
- export・import往復テスト維持

### 単体テスト
- codecの往復table（version・iteration境界を含む）

## 実装アプローチ

- **Outside-In**: 往復の失敗テストを先に書き、赤を確認してから集約する

## 見積もり

1.5pt（🟡中）

## 技術的考慮事項

- 依存関係: NN06 は本 PBI の後に実施
- 非機能要件: 暗号バイト・復号互換は不変（既存データを失わないことが最優先）

## 変更点の概要

codec単一module背後に知識を集約する。

## 現状と問題（file:line 付き）

- `src/utils/crypto/hmacKeyStore.ts:33-453` ― KEK候補seam・順序・署名器
- `src/utils/crypto/encryptedExportCodec.ts:27-151` ― version・payload・iteration・verify/dispatch
- `src/utils/settingsExportImport.ts:6-65` ― codec・署名器の輸入と形状
- codec header自身が同期編集の危険を記録済み

## 変更の理由（locality）

分散は復号不能級事故の混入点を増やす。集約で閉じる。

## 提案コード（骨子のみ）

```typescript
// codec単一moduleがpayload・iteration・署名検証を所有。
// settings側は password＋JSON のみ。鍵ストア側も同経由。
```

## 実装者向け注記

### 現状コードの確認

```bash
grep -rn "iterations\|ciphertext:iv" src/utils/crypto/encryptedExportCodec.ts src/utils/settingsExportImport.ts | head
```

### 落とし穴

- 既存の暗号データを復号できることを往復テストで先に固定する
- iteration・payload形を1バイトも変えない

## Definition of Done

- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] 既存テスト全通過 + 往復table新規通過
- [x] コードレビュー完了
- [ ] `npm run validate` 通過
- [x] ドキュメント更新済み
