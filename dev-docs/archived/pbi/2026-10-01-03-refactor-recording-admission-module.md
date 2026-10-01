# PBI: 記録判定前段の RecordingAdmission 単一 module 化

## ユーザーストーリー

保守担当の開発者として、記録の admission 前段（同意 → 設定 → sender 狭め → rate 判定）を 1 module に集めたい、なぜなら 3 handler factory に微差の写しが分散し、順序 bug の修正が 3 箇所の同期編集になるから。

## 優先度

- 順位: 3 / 7（2026-10-01 arch-delivery-loop ラウンド。全体像は [00-backlog-archloop-1001](2026-10-01-00-backlog-1001.md)。S2 と同点だが推奨強度 Strong を優先）
- RICEスコア: 16.0（Reach=10 / Impact=2 / Confidence=0.8 / Effort=1.0）
- 根拠: 全記録経路の前段を 1 行変更で束ねる。依存なし。

## 背景

- `src/background/handlers/recordingHandlers.ts:216-246`（manual admission）・`:313-338`（save 再判定）・`:386-417`（regenerate 再判定）、`src/background/handlers/MessageRouter.ts:143-165`（router 側の部分再取得）、`src/background/compositionManifest.ts:210-244`（3 dep entry の手組立）。

## BDD受け入れシナリオ

```gherkin
Scenario: 正常な記録要求が settings 付きで通る
  Given 同意済み・sender 正常・rate 余裕あり
  When kind と sender で admit する
  Then settings を持つ admitted が返る

Scenario: 拒否理由が handler 間で一貫する
  Given 同意なし または rate 超過
  When kind と sender で admit する
  Then 同一形状の rejected が返り handler は要求組立に入らない
```

## 受け入れ基準

- [x] `RecordingAdmission` module を新設し interface は `admit(kind, sender) → { settings } | { rejected }` のみとする
- [x] bucket 名は kind から導出し、handler 側に bucket 知識を残さない（`KIND_RATE_BUCKET` テーブル: manual=既定 bucket・save=null（カウンタなし）・regenerate=`regenerate`）
- [x] handler は要求組立と固有 gate（fetch・recovery claim・force opt-in・URL validation）のみを持つ
- [x] composition root の entry は 1 件に畳み、router は狭めた adapter を渡す
- [x] `visitRateLimiter` と `RateLimiter` は admission の内部 adapter とし handler の直接 dep にしない

## テスト戦略

- 単体: fake consent・fake limiter（手動 clock）での admission 契約テスト → `src/background/__tests__/recordingAdmission.test.ts`
- 既存: handler テストは要求形状＋pipeline 結果 mapping に縮小し limiter setup を持たない（flood guard テストは admission テストへ移設）
- 統合: `npm run validate` が通ること

## 見積もり

1 SP（要チームでの見積もり）

## 実装記録（2026-10-01）

- 新設: `src/background/recordingAdmission.ts`（`RecordingAdmission` class + `admit(kind, sender)` seam + flood guard adapter `isRateLimitedVisit`/`resetVisitRateLimiter`）
- deps 縮小: `ValidVisitHandlerDeps` / `RecordingHandlerBaseDeps`（manual+save 共通）/ `RegenerateSummaryHandlerDeps` は `admit` + 固有 gate のみ。`isRecordingAllowed` / `getSettings` / `checkRateLimit` は handler dep から削除
- composition: `manualRecordDeps` / `saveRecordDeps` / `regenerateDeps` の 3 entry を `recordingAdmission` 1 件に畳み。router は `(kind, sender) => admission.admit(kind, sender)` の狭めた adapter を各 handler へ渡す
- router: `RecordingHandlerDeps` に `recordingAdmission` / `fetchManualContent` / `fetchRegenerated` / `setUrlContent`。`hasPrivacyConsent` は router dep から削除（admission が composition から直接受ける）
- dashboard: `mapRegenerateError` に `reason === 'privacy_consent_required'` 判定を追加（consent 拒否が `reason` フィールドに統一されるため。`error` ベース判定は後段に残置）
- router pipeline adapter の opts 転送修正: 旧 composition では handler が orchestrator を直接受けていたが、router 経由の adapter `record: (data) => …` が `{ settings }` opts を落としていたため `(data, opts) => …` に修正（service-worker.test.ts の context-menu 経路で検出）
- 挙動の意図的変更（wire 互換の確認済み差分のみ）:
  - consent 拒否の wire 形状を 4 kind で統一: `{ success: false, reason: 'privacy_consent_required' }`（regenerate の旧 `error` フィールドは廃止 → dashboard mapper が reason 先頭判定で吸収）。manual/save/valid-visit は形状不変
  - manual の rate 拒否に `reason: 'rate_limited'` を追加（旧は `error` のみ → 追加のみで popup 表示は不変）
  - manual の secure-url 判定が rate counter の後ろに移動（旧は counter 前）: 不正 URL 要求が counter を 1 消費する。sender origin 単位の counter であり実害なし
  - save の settings 読み取りが secure-url 判定の前に移動（旧は後）: settings 読み取りは副作用なし（1 秒キャッシュ）
  - valid-visit admission が `getSettings()` を 1 回読む（contract が `{ settings }` を返すため。SettingsRepository の 1 秒キャッシュに吸収され、handler は未使用）
- テスト移設: `recordingHandlers.test.ts`（flood guard 5 件）→ `recordingAdmission.test.ts` へ移設・削除。VALID_VISIT flood テスト（messageHandlers.test.ts の 4 件）も admission 契約テストへ移設し、handler テストは要求形状 + badge + 通知に縮小
- 検証: `npm run validate` green（987 ファイル / 15,241 tests passed）

## Definition of Done

- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] type-check / lint / test / build が通る
- [x] コードレビュー完了
