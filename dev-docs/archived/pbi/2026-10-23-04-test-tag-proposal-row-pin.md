# PBI: タグ提案の複数行テスト追加

## ユーザーストーリー

保守担当者として、tag 側の複数行配線にも錠をかけたい。なぜなら現行 pin は単一提案専用で、旧形への回帰を検出できないから。

## 優先度

- 順位: 04 / 全11件
- RICE スコア: 6.7（Reach = 2 / Impact = 1 / Confidence = 1.0 / Effort = 0.3人日）
- 根拠: NN02 と対のテスト gap。NN01 と同 panel に触れるが別テストファイルのため並列可。

## ビジネス価値

tag 側が旧形（コンテナ渡し・先頭行だけに N 重 listener）に戻っても検出できない。複数行テストで回帰を防ぐ。

## BDD受け入れシナリオ

```gherkin
Scenario: 各行が独立に発火する
  Given タグ提案が2件ある
  When 2行目の適用を押す
  Then 対応タグで1回だけ書換えが呼ばれ、1行目は無変化のままになる

Scenario: index 対応が崩れない
  Given タグ提案が2件ある
  When 各行の適用を押す
  Then それぞれ対応するタグで呼ばれる
```

## 受け入れ基準

- [x] 複数行の独立配線テストがある（発火回数 + 非干渉）
- [x] 既存テスト全緑

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- なし

### 統合テスト
- tagsPanel の複数行テストを既存 pin ファイルに拡張する

### 単体テスト
- なし（統合で覆う）

## 実装アプローチ

- **Outside-In**: assert を先に足して現行コードで緑になることを確認する

## 見積もり

0.5pt（🟢低）

## 技術的考慮事項

- 依存関係: なし
- 非機能要件: 本番コードの変更なし（テストのみ）

## 変更点の概要

tag 側 pin に複数行の独立テストを足す。

## 現状と問題（file:line 付き）

- `src/dashboard/__tests__/tagsPanel-proposalPin.test.ts:61-67` ― 単一行のみ（`toHaveLength(1)`）。`tagsPanel.ts:289-293` の index 対応が崩れても検出できない

## 変更の理由（テスト容易性）

NN02 と対をなす gap。錠のない配線は回帰に無防備。

## 提案コード（骨子のみ）

```typescript
// 2提案を描画し、2行目の適用で対応タグが1回だけ呼ばれること、
// 1行目が無変化であることを assert する。
```

## 実装者向け注記

### 現状コードの確認

```bash
grep -n "toHaveLength(1)\|toHaveBeenCalledTimes" src/dashboard/__tests__/tagsPanel-proposalPin.test.ts
```

### 落とし穴

- 本番コードを変えない。赤になる場合は本番の回帰であり別途 fix として扱う

## Definition of Done

- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] 既存テスト全通過
- [x] コードレビュー完了
- [x] `npm run validate` 通過
- [x] ドキュメント更新済み
