# PBI: AI プロバイダの跨リクエスト circuit breaker 実装

種別: fix（依存 investigate 完了済み: `dev-docs/archived/plans/2026-09-27-pbi15-ai-provider-circuit-breaker-policy.md`）

## ユーザーストーリー

障害した AI プロバイダへ無駄な課金リクエストを送り続けるユーザーとして、provider × model 単位の circuit breaker で cooldown 中のスロットを要約の試行対象から外してほしい。policy（failure class matrix・threshold・cooldown・half-open）は調査報告書で確定済みであり、実装の推測余地はない。

## 優先度

- 順位: 後続（PBI 15 完了直後）
- RICEスコア: 1.5（Reach=9 / Impact=1 / Confidence=90% / Effort=3 SP）— policy 確定済みのため Confidence 50% → 90%
- 見積もり: 3 SP

## BDD受け入れシナリオ

```gherkin
Scenario: 連続失敗したスロットを後続の要約生成から除外する
  Given 同一の provider と model の組合せが threshold 3 回だけ breaker failure を記録している
  And その状態が chrome.storage.session の 'sw:aiProviderBreaker' に保存されている
  When ユーザーが次の要約を生成する
  Then cooldown 中は当該スロットを試行せずに次の候補へ進む
  And 他の provider と model の試行には影響しない
  And 既存の最大10スロット、優先順位、fallback、in-flight dedupe、single-flight は維持される

Scenario: cooldown 終了後に half-open policy で再試行する
  Given ある provider と model の openUntil が現在時刻より前である
  When 新しい要約が別リクエストとしてその組合せを候補とする
  Then 保存済み timestamp と現在時刻の比較だけで lazy に試行可否を判定する
  And cooldown 経過後は最初の 1 リクエストのみ試行し（probe）、成功で reset・失敗で cooldown 再開する
  And Service Worker の setTimeout や module-global timer に依存しない

Scenario: 利用者が明示した接続試験は breaker によって省略しない
  Given ある provider と model の breaker が cooldown 中である
  When ユーザーが testConnection を明示的に実行する
  Then 選択したスロットは省略されず試行される
  And 試験結果は breaker state に反映されない（bypass only）
  And 次の要約リクエストが lazy half-open probe を自然に実行する

Scenario: failure taxonomy を単一の判定根拠にする
  Given C28 の structured failure taxonomy（FailureMetadata.kind）が利用できる
  When 429、5xx、timeout、network error、auth failure、success が発生する
  Then 調査報告書 §3 の matrix に従い加算・無視・reset を判定する
  And failure name、message、debug.statusCode の文字列照合に依存しない
  And provider 単体 retry（POST timeout 1回、network 最大3回）が終了した後の論理的な失敗だけを breaker 判定へ入力する

Scenario: 同時に到着した失敗と成功を競合なく反映する
  Given 複数のリクエストが同一の provider と model の breaker state を同時に読み書きする
  When failure count の増加、success による reset、cooldown 判定が競合する
  Then state update は per-key の直列化で実行され取りこぼしがない
  And state update に失敗した場合も要約 fallback 全体は停止しない（fail-open）
```

## 受け入れ基準

- [x] 新規 module `src/background/ai/providerBreaker.ts` が policy 裁定（調査報告書 §3 matrix・§4 parameter table）を SSOT として実装している。threshold 3・cooldown 5 分（auth 15 分・rate_limit 10 分）・probe 1・success reset はテーブルの値を定数化し、テーブルと同時にしか変更できない
- [x] breaker state は `SESSION_KEYS.AI_PROVIDER_BREAKER = 'sw:aiProviderBreaker'` で chrome.storage.session（`SessionStorePort` 経由、書き込みは `flushImmediately: true`）に保存し、module-global Map を SSOT にしない
- [x] state key は `${provider}::${model}`（model 未設定時 `${provider}::default`）で API key を含まない
- [x] 欠落 state は failures 0 扱い、malformed state は当該エントリ削除 + failures 0 扱い（fail-open）
- [x] cooldown は保存済み `openUntil` と現在時刻の lazy 比較のみで判定し、setTimeout・alarm を生成しない
- [x] concurrent read-modify-write は per-key promise chain で直列化し、update 失敗は握りつぶして要約 fallback を継続する
- [x] `generateSummary` の fallback loop で試行前に skip 判定、結果後に state update（成功 reset / matrix 判定による加算）を行う。MAX_PROVIDERS の SSOT（`RemoteAIService.ts:55`）は変更しない
- [x] testConnection loop（`RemoteAIService.ts:211-246`、MessageRouter adapter 2 件）は cooldown による skip を受けず、結果を state に反映しない
- [x] `compositionManifest.ts` に providerBreaker module を登録する（test からの直接 import 成功だけでは完了としない）
- [x] `in-flight dedupe` と `single-flight` の既存挙動を維持し、breaker state update を dedupe に代用しない
- [x] rateLimiter（origin policy）・aiUsageTracker（全体 quota）・pendingSqliteQueue（AI 再実行なし）に一切触れない
- [x] 新しい Chrome permission・`Promise.then` chain・拡張子なし ESM import を追加しない
- [x] `RemoteAIService.test.ts`（10 スロット・優先順位・fallback・dedupe・single-flight の既存契約）と `RemoteAIServiceSlotLog.test.ts` を green 維持する
- [x] 単体テスト: matrix の各 kind（加算/無視/reset）・threshold 直前/ちょうど/超過・cooldown 直前/境界/経過後（fake clock）・half-open・malformed state・API key 非包含を網羅する
- [x] 統合テスト: 2 consumers（privacyPipeline・reviewSummaryGenerator）経由の一貫適用、同時 update の直列化、taxonomy → breaker 変換が message 依存なしで動作することを確認する

## 技術的考慮事項

- policy の正（SSOT）は調査報告書 `dev-docs/archived/plans/2026-09-27-pbi15-ai-provider-circuit-breaker-policy.md` §3〜§5。数値変更はテーブルと一緒に行う
- breaker が試行を「省略する」機能である以上、省略判定の失敗は既存動作（全スロット試行）へフォールバックする
- `debug.statusCode` を保持する既存 provider を壊さない（breaker 判定は structured failure class を入力に受け取る）

## Definition of Done

- [x] 上記受け入れ基準をすべて満たす
- [x] `npm run validate` が PASS する（type-check 0 / lint 0 errors / test 932 files・14,451 passed。既存契約 `RemoteAIService.test.ts`・`RemoteAIServiceSlotLog.test.ts` green 維持）
- [x] 調査報告書 §9 の compositionManifest 登録と test seam が実装されている（`aiProviderBreaker` 登録 + `compositionManifest-breaker.test.ts` で manifest 経由の解決を証明）

## 実績（2026-09-27）

- 新規 module `src/background/ai/providerBreaker.ts`: policy §3 matrix・§4 parameter table を SSOT として実装（threshold 3・cooldown 5 分 / auth 15 分 / rate_limit 10 分・probe は lazy half-open のみ）
- state は `SESSION_KEYS.AI_PROVIDER_BREAKER = 'sw:aiProviderBreaker'` で `SessionStorePort` 経由（書き込みは `flushImmediately: true`）。key は `${provider}::${model}` のみ
- `RemoteAIService` は `config.breaker` 注入（既定は disabled — 既存テストは無変更で green）。loop は試行前 skip + 結果後 update（成功 reset / taxonomy 付き失敗のみ加算）。testConnection は無変更（bypass only）
- 新規テスト 37 件（unit 30・integration 6・wiring 1）。Red/Green 検証済み（module 未作成で import 失敗を確認後に Green）
- 副作用: 既存 composition テスト 2 件の sessionStore mock が `SESSION_KEYS` を落としていたため `importOriginal` spread に修正（production 変更なし）
