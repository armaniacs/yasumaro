# PBI 18: fetch/ssrf のリトライ・判定共通化

## ユーザーストーリー
メンテナーとして、リトライ判定・待機・ログの同形ブロックが 1 実装になった状態がほしい、なぜなら fetchWithRetry の catch 経路と HTTP ステータス経路が別々の同形ブロックを持つと、片側だけの修正（shouldRetry 条件・バックオフ式）がもう片方に届かないから。

## 変更点の概要
fetchWithRetry 内の 2 同形ブロックを 1 ヘルパーへ共通化し、ssrfGuard 内の同形判定を 1 実装へ集約する。リトライ回数・遅延・失敗応答の契約は不変。

## 現状と問題
- src/utils/fetch.ts:434-450（HTTP ステータス経路）と :455-470（catch 経路）が同形の「リトライ判定 → backoffDelayMs → backoffWait → logWarn → throw」ブロック。差分はメッセージ文言と details の data 形のみ
- 既定タイムアウト 30000 のリテラル ×3（:137 / :240 / :416）は PBI 04 で統一
- src/background/ssrfGuard.ts: localhost 判定 ×3（:52 / :74 / :91）+ IPv4-mapped IPv6 / NAT64 判定の同形複製
- テスト: fetch 系テストがリトライ回数・失敗応答を検証

## 変更の理由
[DRY] 同形ブロックの複製は shouldRetry 条件・バックオフ式の片側修正リスク。ヘルパー化で 1 箇所の修正が両経路へ届く。

## 提案コード（骨子）
async function decideRetryAndBackoff(attempt: number, error: Error, response: Response | null, ...): Promise<void> {
  // shouldRetry → backoffDelayMs → backoffWait → logWarn → throw（メッセージと data をパラメータ化）
}
両経路はこのヘルパーを呼ぶ

## BDD受け入れシナリオ
Scenario: リトライ挙動の不変性
  Given HTTP 429 応答と 3 回の上限
  When fetchWithRetry を通す
  Then リトライ回数・遅延系列・最終失敗応答は変更前と同一である

Scenario: ssrfGuard 判定の等価性
  Given localhost・127.0.0.1・IPv4-mapped IPv6 の各アドレス
  When 共通化後の判定を通す
  Then 拒否判定は変更前と同一である

## 見積もり
2 pt（RICE: 15 = Reach 5 × Impact 3 × Confidence 1.0 ÷ Effort 1.0 人日）

## DoD
- [ ] 2 同形ブロックが 1 ヘルパー経由になり、ssrfGuard の複製が消える
- [ ] 既存テスト全通過
- [ ] npm run validate 通過
