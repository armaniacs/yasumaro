# PBI: Content Visit Pipeline の ContentKernel 統一

## ユーザーストーリー
開発者として、`extractor.ts` (593行) / `loader.ts` / `domainPolicy.ts` / `pageState.ts` の分散したドメインポリシーと抽出オーケストレーションを `ContentKernel` に統一したい、なぜなら `loadSettings` の 77行テーブル駆動マッピングが3箇所で重複し、`loader` と `domainPolicy` でフィルタキャッシュ TTL が二重管理され、`isTrusted` バイパスと E2E の `data-ow-e2e-test` 分岐が再現困難だから。

## 優先度
- 順位: 2 / 3
- RICEスコア: 336（Reach=80 / Impact=3 / Confidence=70% / Effort=0.50）
- 根拠: 全ページロードで実行される最頻パス。`isTrusted` バイパス (PBI-05) と E2E flaky (`data-ow-e2e-test` 2箇所分岐) と `contentDedupEnabled` の欠損が `preparePageContent` を破壊。`Reach` 80 で最優先。

## なぜなぜ分析
- なぜ分散したか: `extractor.loadSettings:119-196` が `StorageKeys -> CleansingConfig` を手動で再構築し、`pageState:DEFAULT_CLEANSING_CONFIG` が3つ目の真実の源。`loader.ts:26-85` が `shouldSkipUrl` + `checkDomainAllowedFromCache` + 3リトライ `sendMessage` を重複実装
- なぜ気づかないか: 各モジュールが独立に開発され、`domainPolicy` の `CACHE_TTL:16` と service-worker の `domainFilter` 権威が分離
- 解: `ContentKernel` (注入 `StoragePort`, `DomainPolicyPort`, `Clock`, `Scheduler`) + `ScrollMonitor` (純粋 `updateMaxScroll`) + `VisitReporter` (単一 `VALID_VISIT` 送信) に深掘り

## BDD受け入れシナリオ
Scenario: ハッピーパス — ページ内容が正しく抽出される
  Given 有効な HTML ページがロードされている
  When `ContentKernel` が `extractor` を呼ぶ
  Then `content` / `title` / `candidateBytes` が正しく取得される

Scenario: エッジケース — ドメインポリシーが一貫する
  Given `domainPolicy` のキャッシュが無効な場合
  When `ContentKernel` が `shouldSkipUrl` を呼ぶ
  Then `loader` と `domainPolicy` で同じ判定が返る

## 受け入れ基準
- [ ] `ContentKernel` が `StoragePort`, `DomainPolicyPort`, `Clock`, `Scheduler` を注入される
- [ ] `loader.ts` の `shouldSkipUrl`/`checkDomainAllowedFromCache` 重複が解消されている
- [ ] `pageState` の `DEFAULT_CLEANSING_CONFIG` が `contentCleaner` の `DEFAULT_KEYWORDS` を SSOT として参照する

## テスト戦略
- 単体: `ContentKernel` の `loadSettings` マッピングのテーブル駆動テスト
- 単体: `ScrollMonitor` の `updateMaxScroll` 純粋テスト
- 統合: `VisitReporter` の `VALID_VISIT` 送信テスト
- E2E: `content-script-recording` で全ページロードパスの検証

## 見積もり
3pt（要チームでの見積もり）

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み
