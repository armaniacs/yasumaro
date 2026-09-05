# PBI: background → popup の層逆転依存を中立層移動で解消

## ユーザーストーリー
拡張機能の保守担当者として、background層がpopup層に依存する逆転構造を解消してほしい、なぜならUI層の変更（popupリファクタ・ファイル移動）がサービス層の起動可否に波及し、循環依存やバンドル肥大の温床になるから

## 優先度
- 順位: 16 / 26
- RICEスコア: 700（Reach=1000 / Impact=1 / Confidence=0.7 / Effort=1.0日）
- 根拠: 依存方向の規律（LAYERS.md）は全開発者に影響するが、現状は動作しているためImpact=1。移動対象は同意状態の2関数に特定できており、範囲は明確。

## BDD受け入れシナリオ
```gherkin
Scenario: background が popup 経路を import しない
  Given リファクタ後のコードベース
  When  src/background 配下で popup への静的 import を検索する
  Then  `from '../popup/`・`from '../../popup/` が0件である

Scenario: 同意状態の取得・移行が従来どおり動作する
  Given プライバシー同意の新旧両状態のユーザー
  When  service worker 起動・バッジ更新・レガシー移行が走る
  Then  同意あり/なしの判定と移行結果が従来と同一である

Scenario: 層規約が機械的に保護される
  Given リファクタ後のコードベース
  When  background から UI 層への import を新たに追加する
  Then  eslint（no-restricted-imports 等）または LAYERS.md の検証手順で検出できる
```

## 受け入れ基準
- [ ] `src/background/` 配下の `../popup/`・`../../popup/` 静的importが0件（テストの `vi.mock` 経路は新パスに更新）
- [ ] `hasPrivacyConsent`・`migrateLegacyPrivacyConsent` の公開契約（戻り値・副作用）が変わらない
- [ ] background・popup関連の既存テストがパスする
- [ ] LAYERS.md に逆方向依存の解消と新配置が注記される

## テスト戦略
- 単体: 移動先モジュールの同意判定・移行テスト（既存 `consentBadge.test.ts`・lifecycle系テストを新パスで継続）
- 静的: `rg "from.*popup/" src/background/` が0件であることの検証（CI化できれば望ましい）
- 回帰: service worker起動・バッジ表示の既存スイート（`service-worker.test.ts`・`backgroundComposition.test.ts`）

## 実装アプローチ
`src/popup/privacyConsent.ts` の同意ロジック（`hasPrivacyConsent`・`migrateLegacyPrivacyConsent`）を中立層（例: `src/utils/storage/` 配下の新モジュール、または `src/utils/consent/`）に移動し、background側4箇所とpopup側の呼び出し元を新パスに向ける。PBI 2026-09-05-01 が `cspValidator/urlWhitelist` の逆辺を `src/utils/storage/providerAllowlist.ts` の中立テーブルに反転した前例にならう。UI固有の処理が混ざっていれば分離し、純粋な同意状態ロジックだけを中立層に置く。

## 見積もり
3ポイント（1.0日相当：1モジュール移動＋呼び出し5箇所以上＋テストmock更新＋層注記が中心）

## 技術的考慮事項
- ADR-adjacency: LAYERS.md は逆方向依存（utils→background）を禁止済み（PBI 2026-09-05-01 で `cspValidator` 逆辺を解消し中立テーブルに反転）。本件は対称形（background→popup の UI 層への上向き依存）であり、同規律の適用として位置づける。背景の循環 ADR（2026-08-20-utils-layer-circular-dependency）とは別件であることを LAYERS.md 注記に明記する
- リリース影響なし（内部配置のみ。ユーザー可視の変更なしのためリリースノート記載は不要）

## 実装者向け注記
- 確認済み現状: background→popup の静的importは同意モジュールの2関数のみに特定。`rg -n "from.*popup" src/background/` の結果:
  - `src/background/service-worker.ts:13`（`hasPrivacyConsent`）
  - `src/background/compositionManifest.ts:38`（`hasPrivacyConsent`）
  - `src/background/consentBadge.ts:9`（`hasPrivacyConsent`）
  - `src/background/handlers/lifecycleHandlers.ts:10`（`migrateLegacyPrivacyConsent`）
- 実体: `rg -n "export (async )?function" src/popup/privacyConsent.ts` — `hasPrivacyConsent:156`・`migrateLegacyPrivacyConsent:176`
- テストのmock更新が必要: `rg -ln "popup/privacyConsent" src/background/` — `__tests__/service-worker.test.ts:477,522`、`__tests__/consentBadge.test.ts:13`、`__tests__/createBackgroundServices.test.ts:51`、`__tests__/backgroundComposition.test.ts:60`、`handlers/__tests__/lifecycleHandlers-ollamaOriginRule.test.ts:52`、`handlers/__tests__/lifecycleHandlers-pendingQueue.test.ts:53` の `vi.mock` パスを新配置に合わせる
- 層規約: `rg -n "逆方向依存" dev-docs/LAYERS.md`（110行目）— utils→background 禁止の前例文言。background→UI層の禁止を同節に追記する
- スコープ補正: 当初「層逆転」と呼ばれたが実態は同意ロジック1モジュールへの4箇所依存であり、UI描画コードへの依存ではない。移動対象を `privacyConsent.ts` の同意状態ロジックに限定する

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み（LAYERS.md の逆方向依存節に解消を注記）
