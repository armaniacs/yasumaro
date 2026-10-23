# PBI: truncate切り詰めの単一所有化

## ユーザーストーリー

保守担当者として、byte切り詰めを1 moduleに畳みたい。なぜなら二重encode・UTF-8境界扱いの分散・MAXの3 hop転送で、修正が複数箇所に要るから。

## 優先度

- 順位: 01 / 全8件
- RICE スコア: 16（Reach = 4 / Impact = 2 / Confidence = 1.0 / Effort = 0.5人日）
- 根拠: deletion testで消えるpass-throughが確定。Effort最小のため最初の一手。

## ビジネス価値

切り詰め不具合（文字化け・上限 drift）の修正点が1箇所になり、将来の上限変更が安全になる。

## BDD受け入れシナリオ

```gherkin
Scenario: 切り詰めが単一所有で動く
  Given 上限超えの本文がある
  When 切り詰める
  Then 変更前と同一のbyte数・同一のUTF-8境界で切れる

Scenario: 上限変更が1箇所で済む
  Given 上限を変えたい
  When 正本を変える
  Then 全経路に反映される
```

## 受け入れ基準

- [x] byte切り詰めがvalidator module内に畳まれ、stepが薄いadapterになる
- [x] encodeが1回になる（UTF-8境界扱いを含む）
- [x] MAXの再export鎖が消える（limits正本の直接参照に）
- [x] 既存テスト全緑

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- なし

### 統合テスト
- pipeline経由の切詰めテスト維持

### 単体テスト
- 境界table（マルチバイト境界・上限ちょうど・空）

## 実装アプローチ

- **Outside-In**: 境界の失敗テストを先に書き、赤を確認してから畳む

## 見積もり

0.5pt（🟢低）

## 技術的考慮事項

- 依存関係: なし
- 非機能要件: 切断結果バイト同一（既存テストで固定）

## 変更点の概要

`truncateContentSize` を正本にし、step・再exportを寄せる。

## 現状と問題（file:line 付き）

- `src/background/recordingValidator.ts:29` ― truncateContentSize
- `src/background/pipeline/steps/truncateContentStep.ts:27-32` ― 二重encode
- `src/background/pipeline/types.ts:17` ― MAX_RECORD_SIZE再export
- `src/utils/limits.ts:81` ― 正本 64*1024

## 変更の理由（depth・locality）

interfaceがimplementationと同等に複雑なshallowさ。畳んでdepthを上げる。

## 提案コード（骨子のみ）

```typescript
// validator moduleが truncate(content) の単一interfaceを持つ。
// stepは委譲のみ。呼び側は limits 正本を直接参照する。
```

## 実装者向け注記

### 現状コードの確認

```bash
grep -rn "truncateContentSize\|MAX_RECORD_SIZE" src/background/ src/utils/limits.ts --include='*.ts' | grep -v __tests__
```

### 落とし穴

- UTF-8境界の切断意味を変えない（既存テストが緑のままであること）
- 二重encodeの除去前後でバイト同一を確認する

## Definition of Done

- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] 既存テスト全通過 + 境界table新規通過
- [x] コードレビュー完了
- [x] `npm run validate` 通過
- [x] ドキュメント更新済み
