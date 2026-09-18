# PBI: confirmToken silent catch の可視化と console 直呼びの統一（fix）

優先度: 台帳 RICE 10.0（Reach 5 / Impact 2 / Confidence 1.0 / Effort 1pt）
backlog: [2026-09-18-00-backlog-holistic-0918.md](2026-09-18-00-backlog-holistic-0918.md)（台帳、候補 C6）
依存: なし（PBI 10 の前提。同一ファイル `src/messaging/dashboardGateway.ts` のため 10 は本 PBI の後に直列）

## ユーザーストーリー

拡張機能を運用する開発者として、confirmToken 系の保存失敗を不可視にせずログに残してほしい、なぜなら現在は失敗が握りつぶされ、token 消失による再発行ループの原因切り分けができないから。

## 背景（現状と課題）

以下の握りつぶし・seam 迂回がある（着手時に行番号を再確認すること）：

1. `src/background/confirmTokenManager.ts` の 133・146・184行目付近 — `saveMap`・`session.remove` の失敗を空 `catch {}` で無視する
2. `src/messaging/dashboardGateway.ts` の 32行目付近（`console.error`）・133行目付近（`console.error`）・143/148行目付近（`console.warn`） — logger seam（`utils/logger.js` の logError/logWarn + `utils/errorUtils.ts` の errorMessage）を迂回している

対応方針: confirmToken 系 catch は logger 経由の可視化に置換する（token 意味論・再発行政策は変えない）。dashboardGateway の console 直呼びも同一 logger seam に寄せる。送信経路・retry 政策の変更は PBI 10 の範囲であり本 PBI では行わない。

## BDD受け入れシナリオ

```gherkin
Scenario: saveMap 失敗が可視化される
  Given saveMap が throw する confirmTokenManager
  When token の保存・削除が失敗する
  Then 失敗は logger 経由で記録され、呼び出し側には従来どおり null・継続が返る

Scenario: dashboard 失敗が logger seam 経由で記録される
  Given 送信・decode が失敗する dashboardGateway
  When callDashboard が失敗応答を返す
  Then 失敗は logger seam 経由で記録され、応答 shape は従来と同一である
```

## 受け入れ基準

- [x] `confirmTokenManager.ts` に空 `catch {}` が残っていない
- [x] `dashboardGateway.ts` に `console.*` 直呼びが残っていない
- [x] 保存・削除の失敗が logger 経由で記録されるテストが pin されている
- [x] token の意味論・再発行・retry 回数に変更がない
- [x] `npm run type-check` が green
- [x] confirmToken・dashboardGateway 関連 vitest が green

## テスト戦略

- 新規テスト: saveMap/remove の throw 時に logger が呼ばれること、dashboardGateway の失敗枝で logger が呼ばれることを検証する
- 既存テストの維持: `dashboardGateway.test.ts`・`dashboardGateway-token-reissue.test.ts`・confirmToken 系テストが無修正または最小追従でパスすること

## 見積もり

1pt（catch 3箇所 + console 4箇所の置換 + 失敗可視化テスト）。

## 実装ガイド

- 着手時点での確認ポイント: `src/background/confirmTokenManager.ts:130-190`、`src/messaging/dashboardGateway.ts:22-45, 116-153`、`src/utils/logger.ts` の公開 seam
- ログ文言は既存の grep 可能性を壊さないこと（`Failed to request dashboard SQLite confirmToken` 等のキーワードを維持）
- フルテストスイートは統合側が行う。担当検証は type-check + 関連 vitest に絞る
