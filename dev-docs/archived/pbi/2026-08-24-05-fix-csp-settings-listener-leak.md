---
name: cspSettings の listener リークを AbortController で解消
type: fix
priority: 5
rice:
  reach: 5
  impact: 1
  confidence: 0.8
  effort: 0.5
  score: 8.0
depends_on: []
---

## 現象
`src/dashboard/cspSettings.ts:162-197` が `loadCSPSettings` 毎に `addEventListener` を重ね掛けし解除しない。モジュール級 singleton も `mount(container)` の seam を無視し、再マウント時に重複発火・リークする。

## なぜなぜ分析
1. なぜ重ね掛けになるのか → listener を mount 時にまとめて解除していない
2. なぜ seam を無視するのか → パネルが自身で DOM を取りに行っている
3. なぜメモリリークするのか → AbortController 等の一括破棄機構がない
→ 解: `CspSettingsController`（または mount 内）で DOM を注入し、listener は `AbortController` で一括破棄する。`mount` 時に既存 listener を abort してから再設定。

## 受け入れ基須
- `loadCSPSettings` 呼び出し毎に listener が重複しない
- 再マウント時に前回の listener が解除される
- `src/dashboard/__tests__/cspSettings.test.ts` が合格

## BDD シナリオ
```gherkin
Scenario: 再マウントで listener が重複しない
  Given  cspSettings パネルを mount
  When  同じパネルを再度 mount
  Then  addEventListener の登録数が増えない（AbortController で破棄済み）

Scenario: 設定変更で handler が1回発火
  Given  csp 設定を変更
  When  change イベントが発火
  Then  対応する handler がちょうど1回呼ばれる
```

## DoD
- [x] AbortController による listener 一括破棄
- [x] 再マウント時の重複発火解消
- [x] type-check / lint / test が PASS
