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
- [x] Provider追加時の同期漏れを検出するpinテストがある(csp/cap/permissionsの三角形) ― `src/__tests__/providerTrianglePin.test.ts`（cap<->catalog の集合一致・1行追加の伝播・connect-src SSOT・Gist egress 両側宣言）
- [x] wa-sqlite削除手順書がゲート条件付きで更新され、extractDomain re-exportの付け替え手順を含む ― `pbi/2026-09-05-32-refactor-wasqlite-sunset.md` 実装ガイド(2026-09-14再調査)にゲート条件・`fallbackMigration.ts:14` の付け替え手順済み
- [x] IDB去就の計測設計(privacy制約下)が文書化され、測定なしの廃止をしない契約が明記される ― `dev-docs/idb-retirement-measurement-design.md`（ソース値3件数のみ・path/initError非保存・ネットワーク送信なし・fallback件数0でない限りOption B no-go）
- [x] `npm run validate` が緑である（exit 0・16851 tests・2026-10-23）

## 実装記録（2026-10-23・文書+pin確定）
- 三角形pin: 既存資産で充足。`src/__tests__/providerTrianglePin.test.ts` が3隅を担保（cap map と PROVIDER_CATALOG の集合一致、required/optional tier の伝播と境界、connect-src が manifest と同一SSOT、Gist egress の host_permissions + connect-src 両側宣言）。SSOT導出の双方向goldensは `src/utils/storage/__tests__/provider-domain-ssot.derivation.test.ts`
- wa-sqlite手順書: 既存資産で充足。ゲート条件(2026-12-17+診断ゼロ報告)と `extractDomain` re-export の付け替え手順は `pbi/2026-09-05-32` 実装ガイドに記載済み。ゲート前のsunset実行は拒否（既存移行経路は温存、本PBIでは着手しない）
- IDB計測設計: 新規作成。`dev-docs/idb-retirement-measurement-design.md` に測定なし廃止禁止の契約・`compileOptionsSource` 信号・ローカル集計のみの計り方・go/no-go基準を記載
- 残: validate緑化の確認（本PBIのコミット時に実施）、コードレビュー、E2E（Gist egress 3pin の維持）

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
