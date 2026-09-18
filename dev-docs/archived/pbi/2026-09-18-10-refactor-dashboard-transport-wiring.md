# PBI: dashboardGateway 送信の Transport 配線（refactor）

優先度: 台帳 RICE 1.6（Reach 4 / Impact 1 / Confidence 0.8 / Effort 2pt）
backlog: [2026-09-18-00-backlog-holistic-0918.md](2026-09-18-00-backlog-holistic-0918.md)（台帳、候補 C5）
依存: PBI 06 の後に直列（同一ファイル `src/messaging/dashboardGateway.ts` のため。logging 変更は 06 の成果を前提とする）

## ユーザーストーリー

メッセージ送信を保守する開発者として、dashboard 送信を Transport seam に配線してほしい、なぜなら現在は dashboard 経路だけが直 send と自前 retry を持ち、retry 政策が2箇所に分かれてテストも chrome mock 直結になっているから。

## 背景（現状と課題）

送信の単一 seam（`src/messaging/messageTransport.ts` の MessageTransport L51-85行目付近：protocol version 付与・retryable 分類・backoff）があるのに、dashboard 経路だけが外側に残っている（着手時に行番号を再確認すること）：

1. `src/messaging/dashboardGateway.ts` の 36-41行目付近 — `sendDashboardRaw` が `chrome.runtime.sendMessage` 直呼び + 自前10秒 race（`DASHBOARD_SQLITE_TIMEOUT`）
2. 116-153行目付近 — `callDashboard` の自前 retry loop（`backoffDelayMs` multiplier 1）。Transport 側は multiplier 2 で別政策

対応方針: `sendDashboardRaw` を注入可能な TransportPort 経由にし、既定 port が現行の timeout 付き send を保つ。timeout 値（10s）・confirmToken 意味論・retry 回数・応答 shape は不変。`MessageTransport` 自体は変えない。logging は PBI 06 の範囲であり触らない。

## BDD受け入れシナリオ

```gherkin
Scenario: 応答なしの送信が従来どおり timeout する
  Given 解決しない port を注入した gateway
  When DASHBOARD_SQLITE を呼ぶ
  Then 10秒 race と同一の timeout 失敗になり、応答 shape は従来と同一である

Scenario: retry 対象の失敗が従来どおり再試行される
  Given 1回目に retriable 失敗・2回目に成功する port
  When retry 付きで callDashboard を呼ぶ
  Then 2回目で成功し、試行回数・待機の観測挙動は従来と同一である
```

## 受け入れ基準

- [x] TransportPort 注入点が存在する（既定は現行 timeout 付き send）
- [x] timeout 値・token 意味論・retry 回数・応答 shape が従来と同一
- [x] gateway 経路に `chrome.runtime.sendMessage` 直呼びが残っていない（既定 port 内を除く）
- [x] 関連テストが注入 port ベースに置き換わっている
- [x] `npm run type-check` が green
- [x] messaging 配下の関連 vitest が green

## テスト戦略

- 新規テスト: hanging port の timeout・retriable 再試行の観測挙動を pin する
- 既存テストの維持: `dashboardGateway.test.ts`・`dashboardGateway-token-reissue.test.ts`・`messageTransport` 系テストが追従後にパスすること

## 見積もり

2pt（注入点設計 + テスト置換。同一ファイルの 06 とは直列実施）。

## 実装ガイド

- 着手時点での確認ポイント: `dashboardGateway.ts:36-41, 116-153`、`messageTransport.ts:12-30, 51-85`（TransportPort 形）
- PBI 06 の logging 成果物を壊さないこと。競合したら 06 を正とする
- フルテストスイートは統合側が行う。担当検証は type-check + messaging 関連 vitest に絞る
