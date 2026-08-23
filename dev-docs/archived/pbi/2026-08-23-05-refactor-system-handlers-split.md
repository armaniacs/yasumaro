# PBI-0823a-05: systemHandlers 分割 + VisitRateLimiter 抽出

## ユーザーストーリー

開発者として、`systemHandlers.ts` の11 handlers をドメイン別に分割し、`VisitRateLimiter` を抽出したい。なぜなら systemHandlers は凝集度0の bucket で、新 message 追加時に際限なく膨張し、recordingHandlers の visitRateLimiter は Map 共有だけで同居しているから。

## 優先度

- **順位**: 5 / 8
- **RICE**: 180 (Reach 5 × Impact 1.5 × Conf 80% / Effort 1.3w)
- **根拠**: handler 層の見通し改善。依存なし。
- **依存**: なし

## BDD受け入れシナリオ

```gherkin
Scenario: systemHandlers がドメイン別に分割されている
  Given system message を送る
  When  各 handler が呼ばれる
  Then  対応する分割ファイルの handler が実行される

Scenario: VisitRateLimiter が独立してテスト可能
  Given VisitRateLimiter(TTL=60s) が生成されている
  When  同一URLで2回 VALID_VISIT を送る（60秒以内）
  Then  2回目は rate limited
```

## 受け入れ基準

- [x] `systemHandlers.ts` → `fetchHandlers.ts` / `badgeHandlers.ts` / `lifecycleHandlers.ts` に分割
- [x] `recordingHandlers.ts` から `VisitRateLimiter` を `src/background/visitRateLimiter.ts` に抽出
- [x] 各新ファイルが独立にテスト可能
- [x] `npm run type-check` / `npm test` PASS

## 見積もり

5pt（1.3人週）

## Definition of Done

- [x] 全BDDシナリオ PASS
- [x] systemHandlers.ts が削除または re-export のみ
- [x] コードレビュー完了
