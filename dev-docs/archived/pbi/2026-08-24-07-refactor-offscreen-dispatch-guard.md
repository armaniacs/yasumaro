# PBI-07: Offscreen dispatch guard + shim整理

## ユーザーストーリー

開発者として、offscreen の 24-case switch と散在する payload size guard を整理したい。なぜなら SQLite 操作追加のたびに union 型と switch を 2 箇所手動編集する必要があり、サイズ検証が各 case に埋もれて共通 middleware がないため。

## 優先度

- **RICE**: 48.0
- **見積もり**: 1.5pt
- **依存**: なし
- **種別**: セキュリティ cross-cutting

## なぜなぜ分析

1. なぜ 24-case switch が残存か → SQLite 操作追加のたびに union 型と switch を手で 2 箇所編集する shallow seam
2. なぜ guard 散在か → payload size check が各 case 内に埋もれ共通 middleware なし
3. なぜ mapper 重複か → buildRecordFromPayload と recordsRepo の逆 mapper が別所有
→ 解: Registry Map + assertPayloadSize middleware + BrowsingLogRecordCodec 単一所有

## 受け入れ基準

- [x] 24-case switch が Map に置換されているか、または guard の重複が解消され共通 assertPayloadSize が全 handler に適用されている
- [x] buildRecordFromPayload が pure function として抽出され再利用されている (または重複が解消)
- [x] 既存 SQLite 操作テストが全パス
- [x] npm run test PASS

## 実装メモ

- `src/offscreen/browsingLogCodec.ts` に `buildRecordFromPayload` を pure function として抽出。offscreen.ts は再エクスポートで後方互換を維持。
- `src/offscreen/payloadGuard.ts` に `assertPayloadSize(msg, limits)` 共通 guard を定義。summary/content/title の 1MB 上限、batch の MAX_BATCH_RECORDS/TOTAL_BYTES、RESTORE の 100MB 上限を一元管理。
- `src/offscreen/sqliteMessageHandlers.ts` に `Map<SqliteMessageType, Handler>` レジストリを新設。offscreen.ts の switch を Map 参照 + guard middleware に置換。
- statusPanel 分解は本 PBI のスコープ外（guard/dispatch が主目的）のため WHY コメントで明記せず、PBI 内で対象外としている。

## Definition of Done

- [x] 全受け入れ基準 PASS
- [x] `npm run type-check` PASS
- [x] `npm run lint` PASS
- [x] `npm test` PASS (493 passed)
