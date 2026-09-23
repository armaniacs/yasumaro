# PBI: 防御深度ハードニングの束ね（VulnHunt Code Quality）

## ユーザーストーリー
拡張機能の保守担当者として、監査で「現行経路では悪用不能だが条件が変わると発火する」パターンを1つの束ねPBIで整理したい、なぜなら再検討トリガーの監視対象を1箇所に集め、将来の発火時に素早く直せるから。

## 優先度
- 順位: 6 / 6
- RICEスコア: 1.0（Reach=2 / Impact=1 / Confidence=0.5 / Effort=1）
- 根拠: 4項目すべてが現行経路で悪用不能（監査が Gate/エクスプロイトテストで裏取り済み）のため、即時実装ではなく条件変化の監視対象。
- 再検討トリガー: 各項目の「発火条件」が観測された時（下記に個別記載）。それまでは着手しない。

## 背景（2026-09-22 時点の現状）
監査エビデンスは `obsidian-smart-history_VULNHUNT_RESULTS_2026-09-22-063916/README.md` の Code Quality セクション。これらは脆弱性ではなくハードニング項目である。

1. `src/utils/ssrfGuard.ts:91`（10進/8進 IPv4 表記）と `:199`（末尾ドット付き `localhost.`、`::a.b.c.d`、NAT64 形）のホスト名正規化欠落
   - 現状: 唯一の本番呼び出し元 `systemHandlers.ts:85` が allowedUrls origin 許可リストで多層防御しており悪用不能。`fetchWithRedirectGuard`（`src/utils/fetch.ts:196-202`）は呼び出し元ゼロ。
   - 発火条件: allowedUrls 層なしで ssrfGuard を通る新しい呼び出し元が増えた時
   - 対策: 正規化（末尾ドット除去、数値 IP 形のパース、IPv4-mapped IPv6）を分類前に追加 + エンコード形の単体テスト
   - 関連（依存なし）: `pbi/2026-09-22-03-backlog-local-provider-origin-rule.md` が `ssrfGuard.ts:207` を参照

2. `src/background/handlers/senderTrust.ts:68` の `runtimeId !== undefined` ガード形状
   - 現状: 本番 service worker では `chrome.runtime.id` は常に定義され到達不能。`externally_connectable` も未使用。
   - 発火条件: 本モジュールが Firefox in-page transport 等の runtime.id が未定義になりうる文脈で再利用される時（`dev-docs/archived/pbi/2026-09-14-00-backlog-firefox-support.md` の進行時）
   - 対策: fail-closed 形状（正検証されない限り false）への再構成

3. `src/messaging/archiveWireTable.ts` の `archive_update.validate` が 31 エンジンフィールドを許し、ダッシュボード live-update の 10 フィールド `DASHBOARD_MUTABLE_SUBSET`（`coreCrudHandler.ts:66` 関連）と不一致
   - 現状: 元 VULN-009 は Gate 3 で FALSE POSITIVE（細工 .db 経由で同等の書き込みが既に可能、単一 principal）。セキュリティ欠陥ではなく一貫性の問題。
   - 発火条件: staging エンジンに第2 principal / ロールゲート列が導入される時
   - 対策: `archive_update.validate` に `DASHBOARD_MUTABLE_SUBSET` を適用し、`dashboardMutableSubset.test.ts` を mirror する回帰テストを追加

4. レガシー KDF 100,000 反復パス（`src/utils/crypto/cryptoParams.ts`、`kdfNegotiator.ts` の互換経路）と非セキュリティ用途の `Math.random`
   - 現状: レガシー経路は既存 envelope の互換のみで攻撃者は downgrade させられない。`Math.random` は prompt id / focus-trap id / retry jitter 等の非セキュリティ用途に限られ、セキュリティ用途は `getRandomValues`（`logger/core.ts:108` 等）。
   - 発火条件: 移行期間の終了（レガシー envelope の解消を確認できた時）
   - 対策: レガシー KDF 経路の sunset + `Math.random` を非セキュリティファイルに限定する lint ガード

## BDDシナリオ
Scenario: トリガー観測時に各項目の再評価結果が本 PBI に記録される
  Given 4項目のいずれかの発火条件が観測される
  When  該当モジュールの変更を検知する
  Then  再評価の裁定が本 PBI に記録される

Scenario: 発火条件が観測された項目は個別 PBI に分割される
  Given 発火条件が観測された項目がある
  When  個別 PBI に分割する
  Then  本 PBI は索引として機能し、分割先からリンクされる

## 受け入れ基準
- [x] 4項目の発火条件が明記され、監視対象として機能する
- [ ] 発火した項目は分割 PBI 化され、本 PBI からリンクされる
- [ ] 全項目の発火条件が未発火のまま保守期間を過ぎた場合も、本 PBI の記録だけで済む

## テスト戦略
- 調査: トリガー観測の方法（該当モジュールの変更検知）を記録
- 実装時: 分割 PBI に従う
- 統合: `npm run validate` が通ること

## 見積もり
監視は 0 SP、発火時は分割 PBI で見積もる

## Definition of Done
- [x] 本 PBI 自体はコードを変更しない（索引と監視契約）
- [ ] 分割時は個別 PBI の DoD に従う
- [x] 監査エビデンス（`obsidian-smart-history_VULNHUNT_RESULTS_2026-09-22-063916/README.md` の Code Quality セクション）への参照を維持する
