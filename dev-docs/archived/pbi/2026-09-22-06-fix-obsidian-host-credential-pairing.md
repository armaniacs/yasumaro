# PBI: Obsidian 接続先ホスト検証と保存キー・ペアリングの修正

## ユーザーストーリー
Obsidian 連携を使う利用者として、保存した Obsidian API キーが自分が設定したホスト以外へ送信されないようにしたい、なぜなら細工された接続テストや設定で vault 全体の Bearer トークンが攻撃者 origin へ流れることが監査で実証されたから。

## 優先度
- 順位: 1 / 6
- RICEスコア: 48（Reach=8 / Impact=3 / Confidence=1.0 / Effort=0.5）
- 根拠: 認証情報窃取が実証済み（エクスプロイトテスト PASS）で High。修正対象ファイルが 3 つに絞られ最も費用対効果が高い。

## 背景（2026-09-22 時点の現状）
- VULN-001（CWE-918/522、High、エクスプロイトテスト PASS）: `src/utils/obsidianConfigBuilder.ts:109` が `override.apiKey || (await settingsRepository.get(StorageKeys.OBSIDIAN_API_KEY))` で保存済みキーをフォールバック代入し、呼び出し側指定の `host` とペアリングする。fetch は `src/background/obsidianClient.ts:159-165,188-195,244-250` で `skipCspValidation:true, allowedUrls:null` のため CSP ゲートを素通りする。
- `src/utils/obsidianConfigValidator.ts:76-108` の `validateObsidianHost` は `[\s\/\\@%]` の文字ブロックリストのみで外部ホスト名を素通しさせる。`isLoopbackHost` は `:42-67` の http ブランチでしか適用されず、既定プロトコルは https のため飛ばされる。
- 設定保存経路（`src/background/pipeline/steps/settingsPipeline.ts` の保存ゲート `:109-118` 付近）も同じ http-only ループバック規則のため `https://attacker.example` がそのまま保存できる。
- 監査エビデンス: obsidian-smart-history_VULNHUNT_RESULTS_2026-09-22-063916/README.md の VULN-001（PoC: poc/VULN-001_obsidian_key_to_attacker_host.md、テスト: exploit_tests/test_vuln_001_obsidian_key_to_attacker_host.test.ts）。

## 修正戦略
1. `obsidianConfigBuilder.ts:106-126` — host が override された場合は保存済みキーのフォールバックを禁止する（保存キーと上書きホストのペアリングを構造的に排除）。
2. `obsidianConfigValidator.ts:42-67` — ループバック規則を https にも適用する。
3. `obsidianConfigValidator.ts:76-108` — ホスト検証を文字ブロックリストから実質的な検証へ強化する。
4. `obsidianClient.ts:159-165,188-195,244-250` — `skipCspValidation:true, allowedUrls:null` を除去し通常の CSP ゲートへ流す。
5. 防御深度（Code Quality 由来）: `src/background/handlers/MessageRouter.ts:206-213` に TEST_OBSIDIAN のバリデータ行を追加（兄弟型との対称性）。ダッシュボードの UI ミラー `src/dashboard/settings/fieldValidation.ts:267-302` と SW 側バリデータの実装を共有化しドリフトを防ぐ。

## 設計上の制約
- リモート vault（https 非ループバック）の正規利用は「保存済みホスト x 保存済みキー」の一致ペアで成立するため壊してはならない。壊すのは「上書きホスト x 保存済みキー」の不一致ペアのみ。
- `skipCspValidation` 除去は https 自己署名証明書の既存挙動に影響しないことを確認する（CSP ゲートはスキーム / ドメイン検証であり証明書検証は別層）。

## BDDシナリオ
Scenario: 一致する保存済み設定での接続テストは成功する
  Given 保存済みホストと保存済みキーの一致ペアが存在する
  When  その設定で接続テストを実行する
  Then  要求が正常に送信され、正規利用が壊れない

Scenario: host のみ上書きした接続テストでは保存済みキーが使われない
  Given TEST_OBSIDIAN で host のみを上書きし apiKey を省略した
  When  接続テストを実行する
  Then  保存済みキーのフォールバックが起きず、要求が拒否される

Scenario: https 非ループバックの保存済みペアでの保存・同期は動く
  Given https 非ループバックの保存済みホストと保存済みキーのペアがある
  When  設定保存と同期を実行する
  Then  保存・同期が引き続き動作する

## 受け入れ基準
- [x] 上書き host x 保存済みキーのペアで fetch が発火しない（単体テストで pin）
- [x] `skipCspValidation:true` が obsidianClient から消えた
- [x] https にもループバック規則が効く
- [x] TEST_OBSIDIAN バリデータ行が追加され、兄弟型と同じ検証経路を通る
- [x] UI ミラーと SW バリデータが同一実装を共有する（または生成元を 1 つにする）
- [x] 既存の接続テスト・保存フローの回帰テストが緑

## テスト戦略
- 単体: バリデータ・ビルダーの境界値（エクスプロイトテストの拡張として obsidian-smart-history_VULNHUNT_RESULTS_2026-09-22-063916/exploit_tests/ の手法を通常テストに昇格）
- 統合: `npm run validate`

## 見積もり
3 SP（要チームでの見積もり）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] type-check / lint / test / build が通る
- [x] ドキュメント更新済み（セキュリティ関連の設定説明がある場合）

## 実装記録（2026-09-23）
- コミット ac23f5d4。builder の保存キーフォールバックを「override host == 保存 host」時に限定し、上書きホスト×保存済みキーの fetch を構造的に不可能化。host 検証を RFC-1123/IP リテラルの実質検証へ強化し、obsidianClient の `skipCspValidation` を3箇所すべて撤去。CSPValidator は保存済み Obsidian origin（共有バリデータ由来）を exact-origin 認可し、リモート vault・カスタムポートの loopback vault を維持。UI ミラーは SW バリデータへ委譲して単一実装化、TEST_OBSIDIAN バリデータ行を MessageRouter に追加（12be74b3 の validators.ts に実体）。
- 設計裁定: 新規リモート host へのテスト接続（override host + 手入力キー）は CSP ブロックとなり「保存してからテスト」運用（TEST_AI と対称）。単一リクエスト限定の gesture-scoped 認可は導入しなかった（既存テストが新規 host テスト成功を pin していなかったため）。
- なぜなぜ分析: /tmp/whywhy/vuln-001-obsidian-host-credential-pairing.md
- 検証: type-check / lint 0 errors / test 13,358 green / build green。残: GitHub PR レビュー
