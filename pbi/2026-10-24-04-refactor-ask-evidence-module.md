# PBI: ask証拠pure群の独立module化

## ユーザーストーリー

保守担当者として、証拠整形をhandler私物から独立させたい。なぜなら試験がinterfaceを跨がず内部関数を直呼びし、置き場所の誤りが固定化しているから。

## 優先度

- 順位: 04 / 全8件
- RICE スコア: 4.3（Reach = 4 / Impact = 2 / Confidence = 0.8 / Effort = 1.5人日）
- 根拠: NN02 の正本の上で組立てるため NN02 の後に実施する。Confidence 0.8 は切り出し粒度の設計判断残り。

## ビジネス価値

将来の報告種別が小さなinterfaceだけ学べば再利用でき、引用不具合の修正点が1 moduleに集まる。

## BDD受け入れシナリオ

```gherkin
Scenario: 証拠整形が独立moduleで動く
  Given 行集合がある
  When 証拠集合に変換する
  Then 変更前と同一の証拠が返る

Scenario: handler試験がdispatch経由になる
  Given 問い合わせがある
  When handlerを実行する
  Then Outcomeだけが固定され、内部直呼びテストが消える
```

## 受け入れ基準

- [ ] 証拠選択・切詰・文脈組立・scope照合が独立pure moduleになる（単一interface: 行集合→証拠集合）
- [ ] handler試験がdispatch経由Outcomeのみになる
- [ ] 既存テスト全緑

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- なし

### 統合テスト
- dispatch経由のOutcomeテスト維持

### 単体テスト
- 独立moduleのtable（既存の直呼びテストを移設）

## 実装アプローチ

- **Outside-In**: 独立moduleの失敗テストを先に書き、赤を確認してから切り出す

## 見積もり

1.5pt（🟡中）

## 技術的考慮事項

- 依存関係: NN02 の後に実施（正本の上で組立てるため）
- 非機能要件: 証拠内容は不変

## 変更点の概要

handler私物のpure群を独立moduleに切り出し、試験をdispatch経由に寄せる。

## 現状と問題（file:line 付き）

- `src/background/handlers/askHistoryHandlers.ts:76-197` ― pure助走群の本体
- `src/background/handlers/__tests__/askHistoryHandlers.test.ts:63-157` ― 内部関数の直呼び
- `src/messaging/__tests__/subtypeSpec-single-interpreter.test.ts:373-388` ― 実装原文の固定（振舞い対照に書換え対象）

## 変更の理由（depth・locality）

interfaceが試験面である原則に反している。切り出しで再利用と修正集中を得る。

## 提案コード（骨子のみ）

```typescript
// 行集合→証拠集合の単一interfaceを持つpure moduleを新設。
// handlerは委譲に縮小。原文検査テストは振舞い対照に書換え。
```

## 実装者向け注記

### 現状コードの確認

```bash
grep -n "pickEvidenceRows\|truncateSnippet\|buildEvidenceContext\|normalizeCollectionScope\|matchesCollectionScope" src/background/handlers/askHistoryHandlers.ts | head
```

### 落とし穴

- 証拠内容を変えない（移設前後で同一テストが緑であること）
- 原文検査テストの書換えは振舞いを保つ

## Definition of Done

- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] 既存テスト全通過
- [ ] コードレビュー完了
- [ ] `npm run validate` 通過
- [ ] ドキュメント更新済み
