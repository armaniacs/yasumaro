# PBI: provider allowlist のサブドメワイルドカード規則と表示データを SSOT 派生に寄せる

## ユーザーストーリー

CSP 設定の保守担当者として、「1 行で provider を追加する」契約が cspValidator と dashboard 表示でも守られてほしい。サブドメインワイルドカード規則が allowlist 表外に inline 2 箇所で綴られ、表示用ヒントリストと pinned origin も手写経だから。

## 優先度

- 順位: 16/17
- RICE: 1.6（R3 / I1 / C0.8 / E1.5）
- 根拠: CSP ゲートの正しさに関わる規則が SSOT 外（row 変更時に漂う）。ワイルドカード規則の語義を表に載せる設計判断が残るため C 0.8
- 依存: なし

## 背景（file:line 現状）

- inline 規則: `src/utils/cspValidator.ts:257-260` と `:326-329` — `domain.endsWith('.openai.com')` が 2 箇所。唯一の表外ワイルドカード規則（`api.openai.com` の行は `providerAllowlist.ts:75` が pin）
- 表示用複製: `src/dashboard/settings/fieldValidation.ts:222-226` — majorProviders / sakuraDomains の手書きヒントリスト（ゲート自体は `:220` で isDomainInWhitelist 派生・正）
- 再宣言: `src/background/ai/providers/GeminiProvider.ts:26` — `GEMINI_PINNED_ORIGIN` が行のドメインを scheme 付きで再宣言
- 表の契約: `src/utils/providerAllowlist.ts:195-197`（「adding a provider is one row here」）

## BDD受け入れシナリオ

```gherkin
Scenario: サブドメイン規則が表から派生する
  Given ProviderAllowlistRow に subdomainWildcard が追加されている
  When cspValidator が openai.com サブドメインを判定する
  Then inline endsWith ではなく表の行から派生する

Scenario: 表示ヒントが表から投影される
  Given fieldValidation のヒントリスト
  When allowlist 表の行が変わる
  Then ヒントリストは手書き複製でなく表の投影から更新される
```

## 受け入れ基準

- [x] ProviderAllowlistRow に subdomainWildcard / extraSubdomains を追加し cspValidator の 2 箇所が派生する
- [x] fieldValidation.ts のヒントリストを allowlist の投影（既存 PROVIDER_DISPLAY_METADATA 系）から派生させる
- [x] GeminiProvider の pinned origin を allowlist から派生させる（scheme 付けは派生側で）
- [x] 既存の CSP / provider テストが green のまま（挙動不変）
- [x] `npm run validate` が PASS する（最終ゲートで確認）

## テスト戦略

- unit: `src/utils/__tests__/cspValidator*` と provider 系実在テストに表派生の pin を追加
- fixture 先行: inline 規則の現挙動を pin してから派生に置き換える（挙動不変）
- 配置: `src/**/__tests__/`、実時間待ちは使わない

## 見積もり

1.5 SP

## Definition of Done

- [x] 上記受け入れ基準をすべて満たす
- [x] `npm run validate` が PASS する

## 実装記録

- 変更ファイル: `src/utils/storage/providerAllowlist.ts`（subdomainWildcard / extraSubdomains フィールド）/ `src/utils/cspValidator.ts`（inline 規則 2 箇所を表派生に統一）/ `src/dashboard/settings/fieldValidation.ts` / `src/background/ai/providers/GeminiProvider.ts` / 3 テストファイル
- ゲート: utils+dashboard+background 11727 tests green / type-check PASS / lint PASS / validate PASS
