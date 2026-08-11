# PBI: handler registry を composition root へ移設する

## 種別
refactor / 既存実装の改善

## ユーザーストーリー

開発者として、message handler の登録を service-worker.ts から composition root へ移設したい。なぜなら、production とテストの配線を一箇所に集約し、handler 追加・rename 時の登録漏れを静的検査とテストで検出したいから。

## 調査結果

着手前のコード確認:
- `src/background/service-worker.ts` に `registry.register(TYPE, handler, trustLevel)` が **19件** 存在する。
- `src/background/createBackgroundServices.ts` は依存構築（`obsidian`, `sqliteClient`, `recordingPipeline`, `manualRecordDeps`, `saveRecordDeps` 等）を集約済みだが、handler 登録は含んでいない。
- `MessageHandlerRegistry` は `register(type, handler, trust)` を持ち、trust は `'extension-only'` または `'content-script-allowed'` の2種類。
- `senderTrust.test.ts` は trust level の個別テストを持つが、**全19件の trust level 網羅テスト**は未着手。

実現可能性: **高**。createBackgroundServices の戻り値へ handlers を追加するか、`createHandlerRegistry(services)` を新設して service-worker.ts から registry.register の19件を除去できる。

## 5 Whys

1. なぜ registry.register が service-worker.ts に残るのか。依存構築は `createBackgroundServices` へ移ったが、handler 登録は手動で追加されたままだから。
2. なぜ手動のまま放置されたのか。handler 追加時に registry.register を書き忘れても、型エラーもテストエラーも発生しないから。
3. なぜ検出できないのか。19件の trust level を網羅するテストが存在しないから。
4. なぜ網羅テストがないのか。senderTrust.test.ts は個別の境界ケース（external extension、content script、missing trust）を対象にしているが、「全型の trust level が仕様通り」を検証するテストがないから。
5. なぜ仕様通りを検証しないのか。handler 登録の contract が単一の検証単位として存在しないから。

根本原因: handler 登録の contract が composition root に無く、全件網羅テストが無いため、追加・変更時の静的検査不能。

## BDD受け入れシナリオ

```gherkin
Scenario: 全 handler が composition root から登録される
  Given createBackgroundServices または createHandlerRegistry が初期化済みである
  When service-worker.ts が registry を取得する
  Then 19件の handler が registry に登録済みである
  And service-worker.ts に registry.register() の呼び出しが存在しない

Scenario: 未知のメッセージ型が拒否される
  Given registry が全19件を登録済みである
  When 未知の型が送信される
  Then "Unknown message type" エラーが返る

Scenario: 各 trust level が仕様通りに適用される
  Given 全19件の trust level が登録済みである
  When content-script-allowed なハンドラに content script から送信する
  Then 許可される
  When extension-only なハンドラに content script から送信する
  Then 拒否される
```

## 受け入れ基準
- [ ] `service-worker.ts` から `registry.register()` の呼び出しが全件削除される。
- [ ] handler 登録が `createBackgroundServices` または `createHandlerRegistry` に集約される。
- [ ] 全19件の trust level 網羅テストが存在し、仕様通りであることが検証される。
- [ ] `npm run type-check` と関連テストが成功する。

## テスト戦略（TDD）

### Outside-In手順
1. 全19件の trust level を検証する contract テストを Red で追加する。
2. `createBackgroundServices` または `createHandlerRegistry` に handler 登録を移設し Green にする。
3. `service-worker.ts` の registry.register 呼び出しを削除し Green を維持する。

### 単体テスト
- `createBackgroundServices`（または `createHandlerRegistry`）の戻り値に19件の handler が含まれる。
- 各 trust level が 'extension-only' / 'content-script-allowed' のいずれかである。
- DASHBOARD_SQLITE が 'extension-only' である。
- VALID_VISIT, PING, CHECK_DOMAIN, CONTENT_CLEANSING_EXECUTED が 'content-script-allowed' である。

### 統合テスト
- service-worker の `createMessageHandler()` が composition root から取得した registry を利用する。
- 19件の登録漏れがないことを起動時検証する。

## 実装手順

1. `createBackgroundServices` の戻り値型を拡張し、`handlers: Map<string, { handler: MessageHandler; trust: SenderTrustLevel }>` または `registry: MessageHandlerRegistry` を追加する。
2. 19件の `registry.register(...)` を `createBackgroundServices` 内へ移動する。
3. `service-worker.ts` で `services.registry`（または `services.handlers`）を `new MessageHandlerRegistry()` へ代入する。
4. 全19件の trust level を網羅するテストを `backgroundComposition.test.ts` または新規ファイルへ追加する。
5. `service-worker.test.ts` の registry 関連モックを調整する（必要に応じて）。
6. `npm run type-check` と `npm run validate` を実行する。

## 見積もり
**2ポイント**（🟡中）

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装され、成功する。
- [ ] `service-worker.ts` から `registry.register()` が全件削除されている。
- [ ] 全19件の trust level 網羅テストが存在する。
- [ ] `npm run type-check` が成功する。
- [ ] `npm run validate` が成功する。
- [ ] 既存の trust ポリシー（senderTrust.ts）が維持される。
