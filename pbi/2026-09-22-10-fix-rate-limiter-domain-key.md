# PBI: レート制限キーの eTLD+1 スコープ化

## ユーザーストーリー
拡張機能を常用する利用者として、サイトのサブドメインを大量に開いても録画のスロットルが無効化されないようにしたい、なぜなら現状は origin 単位のキーでサブドメイン輪番により 5 秒スロットルが実質回避できるから。

## 優先度
- 順位: 05 / 6
- RICEスコア: 7.0（Reach=7 / Impact=0.5 / Confidence=1.0 / Effort=0.5）
- 根拠: 実害は Low だが修正は小さく、録画パイプラインの完全性に寄与する。

## 背景（2026-09-22 時点の現状）
- `getRateLimitKey` は origin 単位でキーを作り、`src/background/visitRateLimiter.ts:90-97` が担う。
- 兄弟サブドメイン（a.example.com と b.example.com…）は別キーになり、各サブドメインが独立のスロットル窓を持つ。TTL スイープ（`:63-66`）と 1000 エントリ上限（`:73-76`）はストア枯渇は防ぐがクォータ増殖は防がない。
- 呼び出しは `src/background/handlers/recordingHandlers.ts:101` の 1 箇所のみ。
- 監査エビデンスは VULN-006（CWE-770、Low、テスト PASS）。PoC は `poc/VULN-006_rate_limiter_origin_key.md`、テストは `exploit_tests/test_vuln_006_rate_limiter_origin_key.test.ts`（5 兄弟サブドメインがそれぞれ初回訪問を許可される）。
- 兄弟 limiter の `src/background/rateLimiter.ts:21-28,67` は sender.url が常に固定の `chrome-extension://<id>` origin である前提で安全だが、その前提はコード上に pin されていない。

## BDDシナリオ
Scenario: 同一 origin の再訪問は従来どおりスロットルされる
  Given 同一 origin のページを訪問済みである
  When  5 秒窓の内側で再訪問する
  Then  訪問はスロットルされる

Scenario: 5 つの兄弟サブドメインの連続訪問は同一窓でスロットルされる
  Given a.example.com を訪問済みである
  When  b/c/d/e.example.com を 5 秒窓の内側で連続訪問する
  Then  2 件目以降は同一の eTLD+1 窓でスロットルされる

Scenario: localhost:27123 と localhost:9999 は別キーとして扱われる
  Given eTLD+1 が定義できない特殊ホストである
  When  ポートの異なる localhost を訪問する
  Then  ポート込み origin のまま別キーとして扱われる

## 受け入れ基準
- [ ] `getRateLimitKey` が eTLD+1 を返す
- [ ] マルチラベル TLD の最小リストがある（co.uk / co.jp / com.au 等、テスト付き）
- [ ] eTLD+1 導出は独立モジュールに置き、`rateLimiter.ts` からも再利用できる形で参照する
- [ ] `rateLimiter.ts` に固定 origin 前提のコメントがある
- [ ] CDN 配下の無関係サブドメインが共有窓になる副作用をテストで明示した
- [ ] 既存の録画回帰テストが緑

## テスト戦略
- 単体: キー導出の境界（サブドメイン、マルチラベル TLD、localhost、IP リテラル）
- 回帰: エクスプロイトテストの 5 兄弟サブドメインが同一窓でスロットルされること
- 統合: `npm run validate`

## 見積もり
2 SP（要チームでの見積もり）

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] type-check / lint / test / build が通る
