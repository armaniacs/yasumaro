# PBI: ドメイン判定が content のキャッシュ版と SW 版で食い違う（whitelist + simple-off で決定的に逆転）

## ユーザーストーリー

記録対象の利用者として、content 側の注入判定と SW 側のドメイン判定を一致させたい。simple-off の whitelist モードでは content が全ページで注入を止める一方 popup は「記録可」を表示し、自動保存が無言で無効になるから。

## 優先度

- 順位: 2/32
- RICE: 10.5（R7 / I3 / C1.0 / E2）
- 根拠: 全記録経路に関わる実害。分岐差とテストの固定値を実測で確認済み
- 依存: なし

## 背景（file:line 現状）

- SW の SSOT `src/utils/domainUtils.ts:99-113`: whitelist 分岐は `if (simpleEnabled)` の内側にあり、simple-off なら `simpleResult = true` のまま許可側に倒れる
- content `src/content/visitAdmission.ts` の whitelist 分岐（`mode === 'whitelist'` を返す箇所）: `snapshot.cachedWhitelist` のリスト判定だけを見て simpleEnabled / ublockEnabled を無視。blacklist 分岐のみ `snapshot.ublockEnabled` と `snapshot.simpleEnabled` を読む
- `src/content/domainPolicyPort.ts:61-74`: simpleEnabled / ublockEnabled は `mode === 'blacklist'` のときしか storage から読まず、whitelist では既定値 `true` / `false` のまま渡す
- `src/utils/domainFilter/DomainFilter.ts` の `buildCacheDomains`: simple-off なら `[]` を返す。同じファイルの `cache()` は `cachedDomains` が `[]` でも `cachedAt: now` を書くため、キャッシュは「有効・空」になる
- 結果: simple-off + whitelist で content は全 URL を `allowed:false, useCache:true` で返し loader が注入を止める一方、`src/popup/statusChecker.ts:146-150` の表示と `src/background/handlers/MessageRouter.ts:201` の CHECK_DOMAIN（どちらも `isDomainAllowed`）は「記録可」を返す
- parity テスト `src/content/__tests__/domainPolicyPort.test.ts:216-250` の matrix 5 行すべてが `SIMPLE_FORMAT_ENABLED: true` / `UBLOCK_FORMAT_ENABLED: false` 固定のため、この 2 次元は契約上テストされていない

## BDD受け入れシナリオ

```gherkin
Scenario: simple-off の whitelist で content と SW が一致する
  Given SIMPLE_FORMAT_ENABLED=false かつ mode=whitelist の設定
  When content の evaluateDomainPolicy と SW の isDomainAllowed に同一 URL を与える
  Then 両者の allowed が一致する（content が SW 判定に委ねる）

Scenario: ublock 有効時の whitelist も逆転しない
  Given UBLOCK_FORMAT_ENABLED=true かつ mode=whitelist の設定
  When content の判定を行う
  Then useCache=false で必ず SW 判定を通し、リスト判定のみでの逆転が起きない

Scenario: 既存の 5 行 parity は維持される
  Given 既存 matrix の 5 行
  When テストを実行する
  Then 5 行すべてが引き続き green で、新規 2 行も green になる
```

## 受け入れ基準

- [x] content の whitelist 分岐が simple-off の場合にリスト判定をせず `useCache:false` で SW に委ねる（結果が `isDomainAllowed` と一致する）
- [x] ublock 有効時も同様に `useCache:false` で必ず SW 判定を通す
- [x] parity matrix に `SIMPLE=false` と `UBLOCK=true × whitelist` の 2 行が追加され、既存 5 行は維持されている
- [x] `domainPolicyPort` の storage 読み出し（`:47-74`）は変更しない（読み出しパターンを変えない）
- [x] 新規分岐に try/catch を増やさない（純関数のまま）
- [x] 関連テストが green で `npm run validate` が PASS する（対象テスト green、最終ゲートで確認）

## テスト戦略

- 単体: `domainPolicyPort.test.ts` の matrix 拡張（SIMPLE=false / UBLOCK=true × whitelist）。既存 5 行は維持
- 単体: `evaluateDomainPolicy` の分岐テスト（simple-off whitelist → `useCache:false`、ublock whitelist → `useCache:false`）
- 実時間待ちは使わない（AGENTS.md / TEST_RULE 準拠）

## 見積もり

2 SP

## Definition of Done

- [x] 上記受け入れ基準をすべて満たす
- [x] `npm run validate` が PASS する
- [ ] コードレビュー完了

## 実装記録

- 変更ファイル: `src/content/visitAdmission.ts`（whitelist 分岐に SW 委譲ガード）、`src/content/domainPolicyPort.ts`（第 2 段階読みの条件を blacklist or whitelist に 1 行拡張。whitelist 時は既定値のままでは修正が dead code になるため最小限の拡張）、`src/content/__tests__/domainPolicyPort.test.ts`（matrix 5 行→7 行。既存 5 行は維持）
- ゲート: 対象 22 tests green / type-check PASS / lint 0 errors
