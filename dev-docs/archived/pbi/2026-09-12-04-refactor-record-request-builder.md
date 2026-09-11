# PBI 2026-09-12-04 — RecordRequestBuilder（記録リクエスト構築の単一化・offline retry 損失修正）

- **種別**: 🔧非機能追加（refactor + fix）
- **優先度**: 4 位 / RICE **12.8**（R20 × I2 × C80% / E2.5人日）
- **出典**: round 9 診断 候補 04・サブエージェント探索 + 直接検証

## 背景（なぜ）

`RecordingData`（約12 optional 診断フィールド）の「どれが一緒に wire を旅するか」という interface 知識が 5 call site で手書きされている:

- `recordingHandlers.ts:167-321` — manual（~95行）と save（~57行）が同意/isSecureUrl/getSettings/record/setUrlContent を copy-paste（70% 重複）。`:181` は `skipAi` を `type==='MANUAL_RECORD'` のときしか読まず PREVIEW_RECORD では黙って捨てる
- `offlineQueueProcessor.ts:55-62` — `{title,url,content,force:false,skipDuplicateCheck:true,recordType:'manual'} as RecordingData` で byte/ai 統計・tags・maskedCount を全欠落でリトライ + 両分岐 `catch{return false}` 無ログ
- `notificationHandlers.ts:79-95` — `content:''` で手組み
- `contextMenuHandlers.ts:56-91` — `slice(0,5000)` magic number（limits.ts 外）+ 手組み envelope

新 field 追加が 5 箇所同期編集で、1 箇所漏れると静かに劣化する（実際に offline で漏れている）。

## スコープ

- `src/background/recordRequestBuilder.ts` 新設: `buildRecordRequest(source, fields)` — canonical field テーブル（現 pickDefined リスト）+ source 別政策行（force / skipDuplicateCheck / alreadyProcessed / content 取得法 / slice cap）
- manual/save ハンドラの重複骨格を builder 経由に統合、offline の `as` cast 解消、contextMenu の 5000 を named constant 化
- offline リトライで統計が保持される回帰テスト新設
- PREVIEW_RECORD の `skipAi` は現契約（payload 型が持たない）を pin する明示的テストを残す（契約拡張は本 PBI のスコープ外）

## 受け入れ基準（BDD）

### シナリオ 1: offline リトライが診断統計を保持する（ハッピーパス）
```gherkin
Given offline queue に byte/ai 統計・tags を伴う記録ジョブがある
When リトライが実行される
Then pipeline.record には元の統計フィールドがすべて渡される
```

### シナリオ 2: source 別の政策差が 1 テーブルで決まる（境界）
```gherkin
Given buildRecordRequest に source を渡す
When manual / save / offline-retry / notification-confirm / context-menu のそれぞれを構築する
Then force・skipDuplicateCheck・alreadyProcessed・content cap が政策テーブルどおりになる
```

## DoD

- [x] builder 新設・5 call site 委譲
- [x] offline 統計保持回帰テスト + builder matrix テスト
- [x] recording 経路テスト green
- [x] type-check / lint green

## 見積もり

🔴高（3pt目安） / 副作用: 🟡軽微（offline リトライ記録の統計値が増える = 診断値の修正）

## 実装メモ（2026-09-12）

- `src/background/recordRequestBuilder.ts` 新設: `buildRecordRequest(source, fields)` — SOURCE_POLICY テーブル（manual / save / offline-retry / notification-confirm / valid-visit）+ canonical diagnostic field テーブル。明示 field が政策を上書き
- offline リトライの統計保持は 2 段構成: `stepExecutor.enqueueOfflineJob` がジョブ payload に byte/ai 統計を同梱するようにし、`offlineQueueProcessor` が builder 経由で復元（旧 `as RecordingData` cast と欠落を解消）
- offline 両分岐の `catch { return false }` を logWarn/logError 付きに（毒ジョブと一時失敗を識別可能に）
- contextMenu の slice(5000) を `CONTEXT_MENU_CONTENT_MAX_CHARS` 定数化（executeScript args 経由）、recordingHandlers の `sites.google.com` を `GOOGLE_SITES_HOST` 定数化
- 手動ハンドラの `skipAi` 契約（MANUAL のみ読み PREVIEW では落とす）は既存 wire 型が規定する現契約のため不変（スコープ外と PBI 記載どおり）
- 検証: builder 5 tests 新設（matrix + offline 統計保持 + 毒ジョブログ）・handlers 21 ファイル 326 tests / pipeline 31 ファイル 307 tests / type-check / lint 0 errors green
