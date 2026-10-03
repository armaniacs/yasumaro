# PBI: fetchWithRetry の HTTP 5xx リトライ経路にバックオフが無い（catch 経路との非対称・JSDoc と乖離）

## ユーザーストーリー

外部 API を利用したい機能開発者として、HTTP 5xx リトライでもネットワークエラーリトライと同じ指数バックオフが働いてほしい。現状は 5xx で即座に連打リトライし、レート制限やサーバ負荷を悪化させる。

## 優先度

- 順位: 01/20
- RICE: 24.0（R6 / I2 / C1.0 / E0.5）
- 根拠: 実検証済みの非対称欠陥 1 件。HTTP リトライ経路（fetch.ts:373-376）は lastError セット + ログのみで遅延ゼロ、catch 経路（:389-395）は指数バックオフ済み。JSDoc（:322-327）は totalBackoff を含む最大待機時間を約束しており実動作と乖離。遅延 1 行 + SleepFn 注入の小変更で対処可能
- 依存: なし（`src/utils/fetch.ts` とそのテストのみ）

## 背景（file:line 現状）

- `src/utils/fetch.ts:373-376`: HTTP エラーで `shouldRetry` が true（5xx は `shouldRetryHttpResponse` :311-315 経由）の場合、`lastError` セットと `logWarn` のみでループ継続 → **遅延なしで次 attempt が即発火**
- `src/utils/fetch.ts:389-395`: catch 経路は `backoffDelayMs` で指数バックオフを計算し `await new Promise(resolve => setTimeout(resolve, delay))` で待機 → 経路間で非対称
- `src/utils/fetch.ts:322-327`: JSDoc が「最大待機時間: `(maxRetryCount + 1) * timeoutMs + totalBackoff`」と totalBackoff を約束（例: 1000+2000+4000）→ HTTP 5xx リトライでは totalBackoff が実質 0 で文書と不一致
- 遅延は直書きの `setTimeout` Promise で注入不可 → AGENTS.md の待機ポリシー（本番コードの意図的待機は injectable に）未遵守

## BDD受け入れシナリオ

```gherkin
Scenario: HTTP 5xx リトライでもバックオフが効く
  Given fetchWithRetry が HTTP 503 を返す
  When maxRetryCount=3 でリトライが発生する
  Then HTTP リトライ経路でも catch 経路と同一の backoffDelayMs 遅延が適用される
  And ログに delay 値が記録される

Scenario: 注入された SleepFn で実時間待ちせずテストできる
  Given 即時解決の SleepFn stub が注入されている
  When HTTP 5xx で 3 回リトライされる
  Then テストは実時間の setTimeout に依存せず backoff 計算と呼び出し回数を pin できる

Scenario: 全リトライ失敗時は従来どおり例外送出
  Given 全 attempt が HTTP 503 を返す
  When maxRetryCount を超える
  Then 最終エラーが throw される（既存挙動を維持）
```

## 受け入れ基準

- [x] `src/utils/fetch.ts` の HTTP リトライ経路（現 :373-376）に、catch 経路（現 :389-395）と同一の `backoffDelayMs` 遅延が追加されている
- [x] 遅延実行は注入可能な SleepFn 経由（既定は `setTimeout` ラッパ）で、catch 経路も同一ヘルパーに統一されている
- [x] JSDoc の totalBackoff 記述（現 :322-327）が実動作と整合する
- [x] HTTP リトライ時の `logWarn` に delay が含まれる
- [x] 追加・既存テストは SleepFn を stub し、実時間待ち・固定 sleep・retry 増加による回避を行わない
- [x] 既存 fetch 関連テストが green

## テスト戦略

- 単体: SleepFn を stub（呼び出し記録 + 即時解決）し、HTTP 5xx リトライでの遅延計算値・順序・回数を pin
- 単体: catch 経路と HTTP 経路で同一 backoffDelayMs が使われることを pin（非対称の再発防止）
- 実時間待ちは一切使わない（AGENTS.md / TEST_RULE 準拠）。既存テスト green 維持 + `npm run validate` 通過

## 見積もり

1.0 SP

## Definition of Done

- [x] 上記受け入れ基準をすべて満たす
- [x] `npm run validate` が PASS する
- [ ] コードレビュー完了

## 実装記録

- 回帰テスト: 修正前に新規 5 件のパリティテストのうち 4 件が FAIL（HTTP 経路が遅延ゼロで連打リトライ）→ 修正後に GREEN。既存 5 件の retry テストには SleepFn stub を注入し、実時間待ちを排除
- 変更ファイル: `src/utils/fetch.ts`（HTTP 5xx リトライ経路に backoffDelayMs 遅延を追加、catch 経路を同一の injectable `sleepFn` に統一、`SleepFn`/`defaultSleep` を export、`RetryOptions.sleep?` 追加、JSDoc の totalBackoff 記述を実動作と整合）、`src/utils/__tests__/fetch.test.ts`（新規 5 件 + 既存 5 件の sleep stub 化）
- ゲート: `npx tsc --noEmit` 0 エラー / `npm run lint` 0 エラー（119 warning は既存） / `npm test` 15529 passed・21 skipped / `npm run validate` PASS
