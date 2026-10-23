# PBI: MessageRouter の collection 取得アクセサの単純化

## ユーザーストーリー

保守担当者として、`getSavedCollectionById` の薄い包みをなくしたい。なぜなら repository seam の上に handler 層がもう1枚 seam を重ねており、読む者が2層を辿る必要があるから。

## 優先度

- 順位: 10 / 全12件
- RICE スコア: 5（Reach = 2 / Impact = 0.5 / Confidence = 1.0 / Effort = 0.2人日）
- 根拠: 呼出し1件の極小整理。NN02 の型整備と同ファイル群に触れるため NN02 の後に実施すると衝突が少ない。

## BDD 受け入れシナリオ

```gherkin
Scenario: collection 解決が変更前と同一
  Given 既知・未知の collection id がある
  When ASK_HISTORY の loadCollection 経由で解決する
  Then 変更前と同一の query・null が返る

Scenario: 境界
  Given 空文字・未知 id がある
  When 解決する
  Then 例外なく null に縮退する（現行の縮退を維持）
```

## 受け入れ基準

- [x] `getSavedCollectionById` がなくなり、`loadCollection` の lambda に一本化される（または残す判断を記録する）
- [x] `askHistoryHandlers.test.ts` が全緑

## テスト戦略（t_wada スタイル）

- E2E: なし
- 統合: 既存 `askHistoryHandlers.test.ts` の deps 注入テストを維持
- 単体: なし（新規ロジックなし）

## 見積もり

0.5pt（🟢低）

## 技術的考慮事項

- 依存関係: NN02 の後が望ましい（同ファイル群）
- 非機能要件: 挙動不変（`?.query` 抽出の意味を保つ）

## 変更点の概要

`MessageRouter.ts:34-37` の `getSavedCollectionById` を `loadCollection: (id) => ...` の呼出し側に inline する。残す方が読みやすいと判断したら残し、その判断を本 PBI に記録して閉じる（無理な削除はしない）。

## 現状と問題（file:line 付き）

- `src/background/handlers/MessageRouter.ts:34-37` ― `getSavedCollections()` + `?.query` 抽出の4行関数
- 呼び出し元実数: 1件（`:252` の `loadCollection` のみ。主スレッドが実読で確認）
- テスト: 同関数の直接テストなし（handler は deps 注入で検証済み）

## 変更の理由（SRP・可読性）

層の重ねすぎ（repository seam → router accessor → handler deps）は読解コストであり、呼出し1件の包みは inline が読みやすい。効果が薄ければ残す判断も許す（価値判断は RICE と実装者に委ねる）。

## 提案コード（骨子のみ）

```typescript
// MessageRouter.ts:252 付近
loadCollection: async (id) => (await getSavedCollections())[id]?.query ?? null,
// getSavedCollectionById は削除（残す判断も可。その場合は理由を記録して本 PBI を閉じる）
```

## 実装者向け注記

```bash
grep -rn "getSavedCollectionById" src/ --include='*.ts' | grep -v __tests__
```

- `?? null` の縮退意味を変えない（空文字・未知 id は null 経由の無 scope fallback が現行仕様）

## Definition of Done

- [x] 全 BDD シナリオが自動テストとして実装されパスする
- [x] 既存テスト全通過
- [ ] `npm run validate` 通過
- [x] ドキュメント更新済み
