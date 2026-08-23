---
name: ハンドラ内 VisitRateLimiter を注入可能な instance に抽出
type: refactor
priority: 3
rice:
  reach: 10
  impact: 1
  confidence: 0.8
  effort: 0.5
  score: 16.0
depends_on: []
---

## 現象
`visitRateLimiter.ts` は削除されたが、ロジックは `src/background/handlers/recordingHandlers.ts:73-120` の module-level `Map`（`visitRateLimiter`）に inline 化された。inject 不可で、`resetVisitRateLimiter()` をテスト分離用に export せねばならず、既存 `RateLimiter`（`src/background/rateLimiter.ts`）と TTL/eviction が乖離している（shallow 重複）。

## なぜなぜ分析
1. なぜ module-level Map になったのか → クラス抽出を省略し互換を保とうとした
2. なぜ test isolation のため reset が必要なのか → グローバル状態が呼び出し側に漏れている（locality 違反）
3. なぜ2つの rate limiter が並ぶのか → 1つの `RateLimiterStore` adapter に統一されていない
→ 解: `VisitRateLimiter` を instance 化し `RateLimiterStore` adapter（in-memory prod + SessionStore 任意）を注入。`PerUrlMutexMap` 同様の instance seam にする。

## 受け入れ基準
- `recordingHandlers.ts` が module-level `Map` を保持しない
- `VisitRateLimiter` が `createValidVisitHandler` に注入される
- `src/background/handlers/__tests__/recordingHandlers.test.ts` が合格

## BDD シナリオ
```gherkin
Scenario: 同一オリジンは短期間で rate limit される
  Given 同一 url を連続リクエスト
  When  isRateLimitedVisit(url) を評価
  Then  2回目以降は true を返す

Scenario: TTL 経過でエントリが退避される
  Given  エントリが VISIT_RATE_LIMIT_TTL_MS より古い
  When  isRateLimitedVisit(url) を評価
  Then  false を返しメモリ増殖しない
```

## DoD
- [x] VisitRateLimiter instance + store adapter を抽出
- [x] recordingHandlers の module-level Map を除去し注入に
- [x] type-check / lint / test が PASS
