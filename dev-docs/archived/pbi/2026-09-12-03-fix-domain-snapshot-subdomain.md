# PBI 2026-09-12-03 — DomainPolicySnapshot に matchSubdomains を追加（content/SW 判定一致）

- **種別**: 🔧非機能追加（fix・判定不一致の実バグ解消）
- **優先度**: 3 位 / RICE **16.0**（R10 × I2 × C80% / E1.0人日）
- **出典**: round 9 診断 候補 03・直接検証済み

## 背景（なぜ）

「この URL は許可されるか」の実装が 2 つあり interface 引数が異なる。background `isDomainAllowed` は `DOMAIN_SUBDOMAIN_MATCHING` 設定を読み 3-arg `isDomainInListShared(domain, list, matchSubdomains)` を使う（domainUtils.ts:90,103,105）。一方 content 経路は 2-arg（`urlSkipper.ts:59`、`visitAdmission.ts:57,66`）で flag が落ち、`DomainPolicySnapshot`（visitAdmission.ts:25-32）に `matchSubdomains` が存在しない。結果、トグル ON 時に loader cache 判定と SW 判定が不一致になる（片側だけ許可/拒否 → 記録漏れまたは拒否漏れの報告）。

## スコープ

- `DomainPolicySnapshot` に `matchSubdomains: boolean` を追加
- `evaluateDomainPolicy` の whitelist / blacklist 分岐を 3-arg `isDomainInListShared` 呼び出しに統一
- content 側 adapter（domainPolicyPort）と background 側設定 reader が snapshot を写像
- mode × matchSubdomains × whitelist/blacklist の contract test で「loader cache 判定 == SW 判定」を pin

## 受け入れ基準（BDD）

### シナリオ 1: サブドメイン ON で content 経路もサブドメインを許可する（ハッピーパス）
```gherkin
Given DOMAIN_SUBDOMAIN_MATCHING = true かつ whitelist に example.com が含まれる
When content 経路で sub.example.com を評価する
Then 評価結果は allowed = true であり background isDomainAllowed と一致する
```

### シナリオ 2: サブドメイン OFF では完全一致のみ（境界）
```gherkin
Given DOMAIN_SUBDOMAIN_MATCHING = false かつ whitelist に example.com が含まれる
When content 経路で sub.example.com を評価する
Then 評価結果は allowed = false であり background と一致する
```

## DoD

- [x] snapshot 拡張 + 純粋政策統一 + 両 adapter 対応
- [x] 一致 contract test 新設
- [x] domain filter 関連テスト green
- [x] type-check / lint green

## 見積もり

🟡中（2pt目安） / 副作用: 🟡軽微（content 経路の判定が設定通りに変わり、ON ユーザーの記録対象が増える = 仕様どおりの変化）

## 実装メモ（2026-09-12）

- `DomainPolicySnapshot` に `matchSubdomains` を追加し、`evaluateDomainPolicy` を 3-arg `isDomainInListShared` に統一（whitelist / blacklist 両分岐）
- ChromeDomainPolicyPort / InMemoryDomainPolicyPort（test double）が storage → snapshot に flag を写像。Chrome 側は第 1 段 read に `DOMAIN_SUBDOMAIN_MATCHING` を追加（whitelist モードでも必要なため blacklist 限定の第 2 段には入れない）
- 追加: popup `statusChecker.ts` の matched/matchedPattern 表示判定も 2-arg wrapper で flag を落としていたため（`isDomainAllowed` とは別経路）、`domainUtils.isDomainInList` を 3-arg 化（default false で後方互換）して表示判定も本契約に統一
- 一致 contract test: content port 判定 == background `isDomainAllowed` 判定を mode × matchSubdomains の 5 行 matrix で pin（`domainPolicyPort.test.ts`）
- urlSkipper の 2-arg `isDomainInList` wrapper は loader-utils テストが pin するため残置（production caller なし・visitAdmission は共有関数へ直接移行）
