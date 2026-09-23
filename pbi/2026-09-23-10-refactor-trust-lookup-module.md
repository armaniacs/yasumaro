# PBI 2026-09-23-10 — TrustLookup Module（lookup 二重経路＋sync 双子の統一）

**優先度**: 順位 10 / RICE 6.0（Reach 6 × Impact 2 × Confidence 50% ÷ Effort 1.0 人週）
**根拠**: `checkDomain`（TrustDecision 経由＋fallback）と `getTrustLevelDisplay`（admin+policy 直呼び）の 2 経路が乖離しうる。単一 async interface に統一し、lookup×alert 行列を storage mock なしの約 12 テストに畳む。Confidence 50% は sync 呼び出し側の移行コストのため。
**種別**: refactor（非機能追加）

## 背景

`TrustChecker.checkDomain`（trustChecker.ts:161-186）は dynamic `TrustDecision.isTrusted()`＋nested try/catch fallback（`getTrustDbAdmin()`＋`getTrustPolicy().isDomainTrusted()`）で解決する一方、`getTrustLevelDisplay`（:279-303）は `TrustDecision` を bypass して admin+policy を直呼びする。permissionManager/host-permission leg は片方の経路でのみ走る。interface には sync/async 双子（`getAlertConfig` :134 vs `getAlertConfigSync` :145、`shouldSaveAbortedPages` :347 vs `…Sync` :355）と SafetyMode↔TrancoTier 結合（:316-332）が混入し、`TrustDecision` コンストラクタ（:40-80）は 2 つの legacy-compat 分岐を抱える。

## 実装戦略

1. `TrustLookup` Module を新設し、単一 async interface `lookup(url) → { level, source, category, display{color,icon,label} }`＋`decideAlert(lookup, alertConfig) → { showAlert, canProceed, reason? }` を公開する。
2. `checkDomain` と `getTrustLevelDisplay` を両方その Adapter にする。display  mapping は表に寄せ、inline リテラル（:288-293）を廃する。
3. sync 双子は async のみに畳む（先に sync 呼び出し側の数を数え、2-3 箇所なら移行する）。SafetyMode→tier 結合は settings 所有側に移す。legacy コンストラクタ分岐は test-only Adapter factory に押し出す。
4. `senderTrust` tiers（parked）・`TrustPolicy` 語義・`locked` 常時 block（:243-246）・badge 非 block（:241-252）は不変。

## 受け入れ基準（BDD）

### シナリオ 1: 2 経路の判定が一致する
- **Given** 同一 URL に対する `checkDomain` と `getTrustLevelDisplay` の判定
- **When** 両方を呼ぶ
- **Then** trust level が一致し、permissionManager leg の有無による乖離がない

### シナリオ 2: alert 行列が単一表で pin される
- **Given** 4 trust level × 3 alert flag の組み合わせ
- **When** `decideAlert` を呼ぶ
- **Then** storage mock なしの約 12 テストで全分岐が pin され、`checkDomain` の alert 分岐が表に委譲されている

### シナリオ 3: sync 双子が消える
- **Given** `getAlertConfigSync` / `shouldSaveAbortedPagesSync` の呼び出し側
- **When** async のみに畳む
- **Then** sync 版への参照が 0 件であり、全テストが緑である

## DoD（Definition of Done）

- [ ] `lookup` / `decideAlert` が唯一 Seam になり、2 経路・display リテラル・sync 双子が消える
- [ ] legacy コンストラクタ分岐が test-only factory に移動する
- [ ] 既存の trust テストが無修正で緑（語義不変の証明）
- [ ] `npm run type-check` / `npm run lint` / `npm test` が緑
