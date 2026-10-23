# PBI: Settings 値型整備と repository の cast 撤去

## ユーザーストーリー

保守担当者として、保存済みコレクションとブラックリストの保存形を Settings 型に載せたい。なぜなら `as unknown as` の迂回が2箇所にあり、将来の形状変更が型検査をすり抜けるから。

## 優先度

- 順位: 02 / 全12件
- RICE スコア: 36（Reach = 12 / Impact = 3 / Confidence = 1.0 / Effort = 1.0人日）
- 根拠: strict 型の迂回は破壊的変更の温床であり Impact 3。blacklist の CAS 化（対象外 O5）は本 PBI の型の後に実施する。

## BDD 受け入れシナリオ

```gherkin
Scenario: 保存・読込が変更前と同一
  Given コレクションとブラックリストの保存値がある
  When upsert/remove/add/remove を実行する
  Then 変更前と同一の保存形・読込結果が返る

Scenario: 不正な保存形の境界
  Given 保存値が想定外の形状（配列でない・null）
  When 読み込む
  Then 例外なく既定（空マップ・空リスト）に縮退する
```

## 受け入れ基準

- [x] `savedCollectionsRepository.ts` と `domainIntelRepository.ts` から `as unknown as` が消える
- [x] `SAVED_COLLECTIONS` の値型が `SavedCollection` を保持する
- [x] 既存テスト全緑（pure table + tagsPanel・domainAnalysisPanel 系）

## テスト戦略（t_wada スタイル）

- E2E: なし
- 統合: repository の保存・読込ラウンドトリップテスト（新規。破損形の縮退を含む）
- 単体: `normalizeSavedCollections`・blacklist 正規化の既存 table を維持

## 見積もり

2pt（🟡中）

## 技術的考慮事項

- 依存関係: なし（NN09 の seam 契約と同ファイルに触れるため、同時実施または本 PBI を先に）
- テスタビリティ: read 正規化は維持し、write 側だけ型で縛る
- 非機能要件: 挙動不変（保存形バイト同一が望ましい。変わる場合は PBI に記録し fix 扱いに切替える）

## 変更点の概要

`Settings` の `SAVED_COLLECTIONS` 値型を `Record<string, Record<string, unknown>>` から `SavedCollection` 保持形に上げ、`BLACKLIST` 側に厳密なリスト型を持たせ、2箇所の cast を撤去する。ついでに `savedCollections.ts:71-77` の未使用変数 `{[id]: _removed, ...rest}` を整理する。

## 現状と問題（file:line 付き）

- `src/utils/storage/savedCollectionsRepository.ts:37-40` ― `map as unknown as Record<string, Record<string, unknown>>`
- `src/utils/storage/domainIntelRepository.ts:36-44` ― `BlacklistValue` 型別名 + `list as unknown as BlacklistValue`
- `src/utils/storage/types.ts:359` ― `[SAVED_COLLECTIONS]: Record<string, Record<string, unknown>>` が `SavedCollection{id,name,query,createdAt,updatedAt}`（`savedCollections.ts:13-19`）を保持しない
- `src/utils/storage/savedCollections.ts:71-77` ― `removeSavedCollection` の未使用変数残存
- 呼び出し元実数: repository 経由の本番 5 件（`sqliteHistoryPanel.ts:541,567`・`MessageRouter.ts:35`・`domainAnalysisPanel.ts:174,188`）+ `defaults.ts:39`
- 前回 PBI 2026-10-20-20（型安全性整備）と同一主題の残差（10-23 新設分）

## 変更の理由（型安全性）

write 側の型が嘘をついているため、将来の形状変更（例: フィールド追加）が保存破壊として実行時まで検出できない。read 側の正規化は残すため縮退の出口は維持される。

## 提案コード（骨子のみ）

```typescript
// src/utils/storage/types.ts
[SAVED_COLLECTIONS]: Record<string, SavedCollection>; // import type は型のみ（循環に注意）
[DOMAIN_BLACKLIST]: string[]; // 現行の厳密な per-key リテラル型を確認のうえ
// 両 repository: settingsRepository.set(key, 値) を cast なしで通す
// savedCollections.ts:71-77: const { [id]: _removed, ...rest } → rest を直接返す形に整理
```

注意: `types.ts` が `SavedCollection` を import すると層の循環有無を確認する。循環する場合は `savedCollections.ts` 側の型を `types.ts` に寄せる方向で検討し、判断を PBI に記録する。

## 実装者向け注記

```bash
grep -rn "as unknown as" src/utils/storage/*.ts | grep -v __tests__
```

- 保存形が1バイトでも変わる場合は挙動変更とみなし、本 PBI を中断して fix 型 PBI に切替える
- `normalizeSavedCollections` の fail-closed 意味は変えない

## Definition of Done

- [x] 全 BDD シナリオが自動テストとして実装されパスする
- [x] 既存テスト全通過 + repository ラウンドトリップテスト新規通過
- [x] `npm run validate` 通過
- [x] ドキュメント更新済み
