# PBI: 信頼境界の一貫性 — ゲート迂回経路の解消（VULN-002/011/018/042）

## ユーザーストーリー
利用者として、任意のウェブページがドメインフィルタを迂回して録画を実行させたり、オフライン再送がプライバシー設定を無視したり、確認トークンが事前流出したりしないようにしたい、なぜなら「特権操作は必ず SW トラストシームを通る」という不変条件が非メッセージ経路で破れているから

## ビジネス価値
- VULN-002: ページが `data-ow-e2e-test` 属性＋コールドキャッシュで content script 注入時にドメイン検証をスキップ（実証済み）
- VULN-011: オフライン再送が `force:true` でドメインフィルタ/プライバシーゲートを素通し（実証: blocked.example が記録される）
- VULN-018: `confirm_token` サブタイプが同一チャネルで破壊的操作のトークンを先読み可能（実証済み）
- VULN-042: コンテンツスクリプト失敗時の 1 クリックで `<all_urls>` を要求（narrow-first を skipped）
- 測定方法: 4 経路すべてが正解経路（SW 検証・パイプラインゲート・ジェスチャ時発行・PermissionManager）を通ること

## 優先度
- 順位: 6 / 14
- RICEスコア: 1260（Reach=700 / Impact=0.4 / Confidence=90% / Effort=0.2人月）
  - Reach 700: 002 は任意ページ（unauth-web）、011/018/042 はリプレイ・ext-page・popup 経路
  - Impact 0.4: ゲート迂回の複合（録画の偽装・プライバシー無視・破壊操作・過剰権限）
  - Confidence 90%: 正解経路が全て既存。ただしリプレイ/トークンのセマンティクス変更を含む
  - Effort 0.2: 4 箇所の修正＋網羅性テスト拡張
- 根拠: 4 迂回の根本原因が共通（RC: trust シームの適用範囲がメッセージ型に限定）。網羅性テストの拡張まで含めて 1 PBI

## BDD受け入れシナリオ

```gherkin
Scenario: e2e 属性があってもコールドキャッシュでは SW 検証を待つ
  Given ページに data-ow-e2e-test 属性が設定され、ドメインフィルタキャッシュが無効である
  When content script が注入判定を行う
  Then 両ブランチとも SW CHECK_DOMAIN の応答を await してから import する

Scenario: オフライン再送は現行ゲートを通る
  Given ドメインフィルタで拒否された URL の記録がオフラインキューに存在する
  When リトライ alarm が再送を実行する
  Then checkDomainFilterStep と checkPrivacyHeadersStep が再評価され、拒否済み URL は記録されない

Scenario: 破壊的操作のトークンは事前取得できない
  Given 拡張ページが confirm_token サブタイプを呼ぶ
  When トークン発行を要求する
  Then 読み取り用サブタイプは存在せず、トークンは破壊的操作のジェスチャ応答でのみ発行される

Scenario: 権限要求は最小スコープから始まる
  Given レコード現在ページでコンテンツスクリプト取得に失敗する
  When 権限フォールバックが走る
  Then activeTab → 現在タブの per-origin の順に試行し、<all_urls> は明示的な設定オプトインでのみ要求される
```

## 受け入れ基準
- [ ] `src/content/loader.ts:41-48`（e2e）と `:52-60`（通常）の両ブランチで、`useCache === false` 時に SW CHECK_DOMAIN を await してから動的 import する
- [ ] `src/background/offlineQueueProcessor.ts:54-62` のリプレイが `force: false`（または明示的な 2 ゲート再評価）になる
- [ ] `src/background/handlers/dashboardSqlite/readOnlyHandler.ts:18-24` の `confirm_token` 読み取りケースが削除され、`confirmTokenManager` がパーアクション・単回使用・短 TTL 発行になる（`dashboardSqliteService.ts:54-80` の消費者を更新）
- [ ] `src/popup/recordCurrentPage/tabContentFetcher.ts:35-38` が activeTab → `PermissionManager.requestPermission`（per-origin）→ 設定オプトインのレベルラダーになる
- [ ] senderTrust 網羅性テストを非メッセージ経路（動的 import・リプレイ・権限）に拡張する
- [ ] `npm run type-check` と `npm run validate` が成功する
- [ ] VulnHunter 再検証: 4 経路の再現テスト（e2e 属性注入・リプレイ・token 読み取り・all_urls 要求）が全て失敗する

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- `data-ow-e2e-test` の e2e スイートが引き続き成功すること（キャッシュ事前投入または await 完了で互換維持）

### 統合テスト
- `loader` × domainPolicyPort × SW CHECK_DOMAIN モック: コールドキャッシュでの注入判定
- `offlineQueueProcessor` × 2 ゲート: 拒否 URL の再評価
- `dashboardSqliteService` × confirmTokenManager: ジェスチャ時発行→単回使用

### 単体テスト
- 更新: `tabContentFetcher` の権限ラダー（activeTab→per-origin→opt-in の順序固定）
- 新規: `senderTrustCoverage` の非メッセージ経路ケース

## 実装アプローチ
- **Outside-In**: 4 経路の RED 再現テスト → 正解経路への配線（GREEN）→ 網羅性テスト拡張
- **Red-Green-Refactor**: トークン発行のセマンティクス変更は最後に実施（消費者の UI フロー確認を含む）

## 見積もり
2pt（要チームでの見積もり — 4 経路修正＋テスト拡張。e2e 互換調整を含む）

## 技術的考慮事項
- 依存関係: Wave 3 推奨（既存動作のセマンティクス変更を含むためレビュー強化）
- テスタビリティ: loader は domainPolicyPort のモックで await 待ちを検証可能
- 非機能要件: e2e テストの実行時間が大幅に増えないこと（SW round-trip 1 回分）
- 注意: confirmToken の UX（確認ダイアログ）を壊さないこと。発行タイミングの変更を UI 側と合わせて検証
- 行番号は監査時点（2026-08-29）のもの。着手時に該当シンボルで再確認すること

## 実装者向け注記

### 現状コードの確認
```bash
sed -n '35,65p' src/content/loader.ts
sed -n '50,65p' src/background/offlineQueueProcessor.ts
sed -n '14,28p' src/background/handlers/dashboardSqlite/readOnlyHandler.ts
sed -n '30,45p' src/popup/recordCurrentPage/tabContentFetcher.ts
sed -n '54,82p' src/dashboard/dashboardSqliteService.ts
```

### 実装手順
1. loader の両ブランチを await 化（e2e テストのキャッシュ投入を確認）
2. リプレイの force 解除＋明示ゲート再評価
3. confirm_token サブタイプ削除＋パーアクション発行（消費者更新）
4. 権限ラダー実装
5. 網羅性テスト拡張、`npm run validate`

### 落とし穴
- loader の await 化で注入タイミングが遅れ、抽出が空になるページが出る可能性 — visitGate のタイミング要件を確認すること
- リプレイの force:false 化で、正規の「再送」も duplicate チェックに引っかかる可能性がある — `skipDuplicateCheck` は force と独立して扱うか、明示ゲート再評価に置換するかをテストで決める
- トークンの単回使用化で、既存の 2 段階 UI（一覧→確認→実行）が壊れないか `dashboardSqliteHandlers` のテストで確認

## Definition of Done
- [ ] 全 BDD シナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす
- [ ] コードレビュー完了
- [ ] リファクタリング完了（グリーン後）
- [ ] VulnHunter 再スキャンで VULN-002/011/018/042 が解消されること
