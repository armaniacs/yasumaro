# PBI: offline retry の契約テストを整備する

## 種別
test / 既存実装の固定

## ユーザーストーリー

開発者として、`obsidian_sync` retry の既知の挙動を契約テストで固定したい。なぜなら、実装変更を伴わず、現仕様の振る舞いをテストで保証し、将来の refactor で意図せず壊さないようにする必要があるから。

## 調査結果

着手前のコード確認:
- `src/background/offlineQueueProcessor.ts` の `obsidian_sync` retry パスは `retryObsidianWriteOnly()` を呼び、`summary` と `tags` のみから Markdown を再生成する。
- queue payload の `maskedCount` は retry 時に使用されない（`retryObsidianWriteOnly` の引数に含まれない）。
- SQLite step（`sqliteClient` への書き込み）と metadata step（`updateSavedUrlEntry` 等）は再実行されない。
- `src/background/__tests__/offlineQueueProcessor.test.ts` に "drops maskedCount on the obsidian_sync retry path" テストが存在し、`maskedCount` が破棄されることを固定している。

実現可能性: **非常に高**。実装変更は不要。既存テストに以下の2点を明示的に追加する:
1. obsidian_sync retry 時に SQLite step が再実行されないこと。
2. obsidian_sync retry 時に metadata step（`updateSavedUrlEntry` 等）が再実行されないこと。

## 5 Whys

1. なぜ maskedCount が retry で使われないのか。obsidian_sync は AI 要約済みの Markdown を Obsidian へ再書き込みするだけの軽量パスだから。
2. なぜ SQLite step が再実行されないのか。元の記録は既に SQLite へ保存済みで、失敗は Obsidian への送信のみだから。
3. なぜ metadata step が再実行されないのか。`updateSavedUrlEntry` 等は初回記録時に完了しており、retry は Obsidian 送信のみを対象とするから。
4. なぜ契約テストで固定するのか。将来の retry ロジック変更時に「再実行すべき」と誤判断され、重いパイプラインが再実行されるリスクがあるから。
5. なぜ既存テストだけでは不十分なのか。maskedCount の破棄は固定されているが、SQLite step / metadata step の「非再実行」は明示的にテストされていないから。

根本原因: obsidian_sync retry の「非再実行」契約が、暗黙の実装詳細として存在し、テストで明示されていない。

## BDD受け入れシナリオ

```gherkin
Scenario: obsidian_sync retry が Markdown 再生成のみを行い SQLite を再実行しない
  Given キューに obsidian_sync ジョブが存在する
  When offline retry が実行される
  Then retryObsidianWriteOnly が summary/tags で呼び出される
  And sqliteClient の insert/update が呼び出されない

Scenario: obsidian_sync retry が metadata 更新を再実行しない
  Given キューに obsidian_sync ジョブが存在する
  When offline retry が実行される
  Then updateSavedUrlEntry 等の metadata step が呼び出されない
  And maskedCount は retry に使用されない
```

## 受け入れ基準
- [ ] `obsidian_sync` retry 時に SQLite step が再実行されないことがテストで固定される。
- [ ] `obsidian_sync` retry 時に metadata step が再実行されないことがテストで固定される。
- [ ] `maskedCount` が retry に使用されないことがテストで固定される。
- [ ] 既存の "drops maskedCount" テストが維持される。
- [ ] `npm run validate` が成功する。

## テスト戦略（TDD）

### Outside-In手順
1. 既存 `offlineQueueProcessor.test.ts` に SQLite step 非再実行テストを追加する（Red）。
2. metadata step 非再実行テストを追加する（Red）。
3. 実装は変更不要（Green のまま）。

### 単体テスト（`offlineQueueProcessor.test.ts` に追加）
- `obsidian_sync` retry 時に `record()` が呼び出されないこと（既存）。
- `obsidian_sync` retry 時に `retryObsidianWriteOnly()` が `summary`/`tags` のみで呼び出されること（既存）。
- `obsidian_sync` retry 時に `maskedCount` が引数に含まれないこと（既存）。
- **NEW**: `obsidian_sync` retry 時に `sqliteClient` の書き込み操作が呼び出されないこと。
- **NEW**: `obsidian_sync` retry 時に `updateSavedUrlEntry` 等の metadata 更新が呼び出されないこと。

### 統合テスト
- `offlineQueueProcessor` の consumer contract が `offlineNetworkQueue.retryAll` のハンドラ境界で検証される。

## 実装手順

1. `offlineQueueProcessor.test.ts` のモックに `sqliteClient` 書き込み用の mock を追加する（必要に応じて deps を拡張）。
2. `obsidian_sync` retry 時に `record()` 以外の副作用（SQLite/ metadata）が発生しないことを検証するテストを追加する。
3. `npm run validate` を実行する。

## 見積もり
**1ポイント**（🟢低）

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装され、成功する。
- [ ] SQLite step 非再実行がテストで固定されている。
- [ ] metadata step 非再実行がテストで固定されている。
- [ ] `npm run validate` が成功する。
- [ ] 既存の offline retry 挙動が維持される（実装変更なし）。
