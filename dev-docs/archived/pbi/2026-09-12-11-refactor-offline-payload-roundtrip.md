# PBI 2026-09-12-11 — Offline payload の enqueue/retry round-trip 統合

- **種別**: 🔧非機能追加（refactor）
- **優先度**: 3 位 / RICE **16.0**（R10 × I2 × C80% / E1.0人日）
- **出典**: round 10 診断 候補 03・サブエージェント探索（PBI 2026-09-12-04 のフォローアップ）

## 背景（なぜ）

PBI 2026-09-12-04 が request 側を統合したが queue payload 側は残存: 約13 diagnostic field が `stepExecutor.enqueueOfflineJob`（stepExecutor.ts:67-85）の pack と `offlineQueueProcessor`（:30-46,72-86）の unpack で 2 回綴られ、processor 内 inline payload 型が 3 つ目の綴り。field 追加が再び 2 箇所同期編集になる（04 で直した事故の再発面）。

## スコープ

- `recordRequestBuilder` module に `extractOfflinePayload(context)` / `buildOfflineRetryRequest(payload)` を追加し、enqueue と retry が同一 field table を共有
- processor の inline payload 型を `ReturnType<typeof extractOfflinePayload>` に置換
- backoff 式（stepExecutor.ts:38）は対象外。振る舞い不変

## 受け入れ基準（BDD）

### シナリオ 1: round-trip で全 field が保存される（ハッピーパス）
```gherkin
Given 全 diagnostic field を持つ RecordingContext
When extractOfflinePayload → buildOfflineRetryRequest を通す
Then 全 field が欠落なく復元される
```

### シナリオ 2: 新 field は table 1 行で両経路に乗る（境界）
```gherkin
Given field table に新 field を 1 行追加
When enqueue と retry を実行する
Then 両経路で新 field が運ばれる（2 箇所編集が不要）
```

## DoD

- [x] extractor/builder 追加・両 call site 委譲・inline 型置換
- [x] round-trip テスト新設（04 の両面カバレッジを置換）
- [x] background pipeline/offline 関連テスト green
- [x] type-check / lint green

## 実装メモ（2026-09-12）

- `OfflineJobPayload` 型 + `extractOfflinePayload` / `buildOfflineRetryRequest` を recordRequestBuilder module に追加。processor の inline 型（3 つ目の綴り）を削除し `OfflineJobPayload` に置換
- builder への `pipeline/types.ts` import は type-only（実行時循環なし）
- 検証: round-trip テスト新設・builder/processor 18 tests green・pipeline 302 tests green・type-check green・lint 0 errors

## 見積もり

🟡中（2pt目安） / 副作用: 🟢なし（振る舞い不変）
