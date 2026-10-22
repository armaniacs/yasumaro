# PBI: 基盤決着 ― wa-sqlite sunset・IDB去就・Provider catalog SSOT

## ユーザーストーリー
拡張機能を保守する開発者として、ストレージ3層とProvider設定の分散を単一SSOTに畳みたい、なぜなら移行リセット・egress遮断・cap不整合の再発を止めないと新機能のたびに事故が起きるから

## 優先度
- 順位: 01 / 6候補
- RICEスコア: 800 (Reach=1000 / Impact=2 / Confidence=0.8 / Effort=2.0人週)
- 根拠: 全利用者に影響する土台。Aのembedding基盤・Dのegress追加はこの上でないとdriftする。依存はスコアより優先し先頭に置く
- 依存: 他候補(A/D)がこのPBIに依存。ゲート付き部分(wa-sqlite削除は2026-12-17以降+診断ゼロ報告)は先行着手禁止

## 背景・制約
- `pbi/2026-09-05-32-refactor-wasqlite-sunset.md` のゲート(ADR-014)を尊重する
- IDB中間層廃止は未測定のまま決定禁止。fallback-only到達率のprivacy温存計測設計が先(スパイクPBI-B前提)
- Provider乖離の実証: `aiLimits` のslot id不一致でcapが一部のみ有効、`cspDomains`/`cspValidator.PROVIDER_TO_DOMAIN`/`host_permissions` の3点同期が必要。6.9.51のmeta CSP事故の再発防止を含む
- `pbi/2026-09-05-00-backlog-future.md` のトリガー管理(Provider追加時にcatalog吸収)を本PBIで前倒し解消する

## BDD受け入れシナリオ
Scenario: Provider追加がSSOT1箇所で完結する
  Given PROVIDER_REGISTRYに新規エントリを追加した
  When ビルドとvalidateを実行した
  Then host_permissions・extension_pages CSP・cap・StorageKeys/defaultsのいずれも手動同期なしで一致する

Scenario: ゲート前のsunset実行を拒否する
  Given 2026-12-17未到達または診断に未完了報告がある
  When sunset手順を実行しようとした
  Then 実行せずゲート未成立を理由に停止し、既存移行経路は温存される

## 受け入れ基準
- [ ] Provider追加時の同期漏れを検出するpinテストがある(csp/cap/permissionsの三角形)
- [ ] wa-sqlite削除手順書がゲート条件付きで更新され、extractDomain re-exportの付け替え手順を含む
- [ ] IDB去就の計測設計(privacy制約下)が文書化され、測定なしの廃止をしない契約が明記される
- [ ] `npm run validate` が緑である

## テスト戦略
- E2E: Gist egressの3pin(有効PAT/401/未宣言origin遮断)の維持。6.9.52のpinを壊さない
- 統合: 新規Provider追加シミュレーションで権限・CSP・capが一致すること
- 単体: allowlist SSOT不変テスト、cap解決テーブルテスト、ゲート判定テスト

## 見積もり
2.0人週相当(ゲート待ちを除く)。チームで再見積もりすること

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み(ARCHITECTURE_MAPのSSOT表・PERMISSIONS・SECURITYのegress章)
