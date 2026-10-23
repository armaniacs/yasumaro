# PBI: extractor外部seamの単一化

## ユーザーストーリー

保守担当者として、抽出の外部seamを1つに固定したい。なぜなら3 entryの使い分け知識が呼び側に残り、document依存の前提がinterface外に漏れるから。

## 優先度

- 順位: 07 / 全8件
- RICE スコア: 4.3（Reach = 4 / Impact = 2 / Confidence = 0.8 / Effort = 1.5人日）
- 根拠: fallback/clone変更の集中。Confidence 0.8 は固定するentry選択の設計判断残り。

## ビジネス価値

呼び側はconfigのみ学べばよくなり、fallback・clone変更が1箇所になる。

## BDD受け入れシナリオ

```gherkin
Scenario: 抽出が単一seamで動く
  Given ページがある
  When 抽出する
  Then 変更前と同一の本文が返る

Scenario: DOM前提がinterfaceに載る
  Given 前提が変わる
  When 読む
  Then interface記述で分かる
```

## 受け入れ基準

- [ ] 外部seamが1つに固定され、残りが内部seamになる
- [ ] DOM前提がinterface記述に格上げされる
- [ ] 既存テスト全緑

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- なし

### 統合テスト
- 抽出経路のテスト維持

### 単体テスト
- 単一seamのtableテスト

## 実装アプローチ

- **Outside-In**: 単一seamの失敗テストを先に書き、赤を確認してから固定する

## 見積もり

1.5pt（🟡中）

## 技術的考慮事項

- 依存関係: なし
- 非機能要件: 抽出結果不変（bench専用entryの扱いを先に決める）

## 変更点の概要

外部seamを1つに固定し、残りを内部化する。

## 現状と問題（file:line 付き）

- `src/content/extractor.ts:54` ― 純粋注記＋kernel委譲
- `src/utils/pageContentPipeline.ts:54` ― 真の外部seam
- `src/utils/contentExtractor/index.ts:84,100,118` ― 3 entry＋bench専用
- `src/utils/contentExtractor/extractPipeline.ts:314` ― 単一所有済み

## 変更の理由（depth）

使い分け知識の呼び側残留。固定してdepthを上げる。

## 提案コード（骨子のみ）

```typescript
// preparePageContent 1つを外部seamに固定。残りは内部seam化。
```

## 実装者向け注記

### 現状コードの確認

```bash
grep -n "export function\|export const" src/utils/contentExtractor/index.ts | head; grep -rn "pageContentPipeline\|extractPipeline" src/content/extractor.ts | head
```

### 落とし穴

- bench専用entryの扱いを先に決める（残すか内部化するか）
- 抽出結果を変えない

## Definition of Done

- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] 既存テスト全通過
- [ ] コードレビュー完了
- [ ] `npm run validate` 通過
- [ ] ドキュメント更新済み
