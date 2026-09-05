# PBI: src/utils/ ダンプと非推奨 barrel storage.ts を整理

## ユーザーストーリー
コードベースを保守する開発者として、`src/utils/` の配置判断と非推奨 barrel の残存参照を整理してほしい、なぜなら 90 件超のフラット配置と test-only の barrel 参照が残るままでは、新規ファイルの置き場所判断と削除可否の見極めに毎回調査コストがかかるから

## 優先度
- 順位: 23 / 26
- RICEスコア: 200（Reach=500 / Impact=1 / Confidence=0.8 / Effort=2.0日）
- 根拠: 影響は開発者体験の中程度だが、barrel 参照がテスト約 30 ファイル超に分散し、utils 分類の実態確認（dead 候補の洗い出し）も含むため Effort は 2.0 日。過去調査の再確認から入る現実的スコープとする。

## BDD受け入れシナリオ
```gherkin
Scenario: 非推奨 barrel への新規 import が検出される
  Given `src/utils/storage.ts` が @deprecated のまま残っている状態
  When  新規コードが barrel 経由で import する
  Then  eslint の no-restricted-imports 警告で検出される

Scenario: テストの barrel 参照が直接 import に移行する
  Given テストが `utils/storage.js` 経由で import している状態
  When  各テストを実体の直接 import に置換する
  Then  全テストが green のままで barrel 参照数が減少する

Scenario: utils 直下の分類が LAYERS 記述と一致する
  Given `src/utils/` 直下のファイル一覧を取得する状態
  When  LAYERS.md の Layer 分類と突き合わせる
  Then  未分類・dead 候補の一覧が文書化され、削除分はテスト green で裏付けられる
```

## 受け入れ基準
- [ ] `src/utils/storage.ts` の参照実態（prod ゼロ・test のみ）が再確認され、移行対象テストの一覧が PBI 内で確定する
- [ ] 移行したテストが直接 import（`storage/types.js`・`storage/SettingsRepository.js` 等）で green を維持する
- [ ] `src/utils/` 直下の未分類・dead 候補が洗い出され、削除するものは consumer ゼロが rg で裏付けられる
- [ ] 参照ゼロになった時点で barrel 削除可否が判断され、削除しない場合は残置理由が `storage.ts` ヘッダに記録される

## テスト戦略
- 移行: barrel 参照テストを数ファイルずつ直接 import に置換し、都度該当スイートを実行して green を確認する（一括置換はしない）
- 検証: `rg` による参照数カウントを移行前後で比較し、減少を定量表明する
- 回帰: `npm run type-check` と影響スイートの green を最終確認する

## 技術的考慮事項
- Wave 3（`dev-docs/LAYERS.md:146`）で production の直接 import 移行は完了済み（PBI 2026-08-21-04）。本 PBI はテスト残存参照の移行と、参照ゼロ到達時の barrel 削除判断が主眼であり、prod コードの再設計は含まない
- `logger.ts` barrel（約 120 参照）は Wave 4 の配線完了・移行未完状態（`LAYERS.md:147`）であり、本 PBI のスコープ外とする。混同して手を付けないこと
- `storage/settingsStore.ts` と trustDb の循環は dynamic import による意図的回避（`LAYERS.md:60-72`）で削除不可。整理作業で「なぜこんな import？」と単純化しないこと
- barrel 削除はテスト全移行が前提のため、本 PBI 内で削除まで到達しない場合は「残参照数＋次回条件」を明記してクローズする

## 実装アプローチ
まず `rg` で barrel 参照テストを全件列挙し、import 対象別（`StorageKeys` 型のみ／`getSettings` 等の関数）に束ねて直接 import 先を割り当てる。型のみ参照は `storage/types.js`、CRUD は `storage/SettingsRepository.js`、その他は各実体モジュールに向ける。並行して `src/utils/` 直下を LAYERS 分類と突き合わせ、consumer ゼロの dead 候補を特定する。barrel 本体の削除は参照ゼロ確認後の最終判断とする。

## 見積もり
5ポイント（2.0日相当：過去調査の再確認＋約 30 ファイル超のテスト移行＋dead 候補洗い出しが中心）

## 実装者向け注記
- barrel 実体: `src/utils/storage.ts:1-136`（`// @layer Barrel — Re-export (deprecated)`、全 export に `@deprecated`）。eslint 抑止: `eslint.config.js:45-57` の no-restricted-imports（warn のみで ban ではない）
- 参照実態（2026-09-05 時点の抜粋、全件は rg で再取得）: `rg -n "from ['\"].*utils/storage\.js['\"]" src tests --glob '*.ts'` で約 30 件超の test ファイルがヒット（例: `src/popup/__tests__/main.test.ts:145`、`src/background/__tests__/integration-robustness.test.ts:4`、`src/dashboard/__tests__/retention-settings.test.ts:79`）。prod 参照は LAYERS.md 上ゼロとされるが、作業開始時に `grep -v __tests__` で再確認すること
- utils 直下は約 90 エントリのフラット配置: `ls src/utils/` で一覧化し、`dev-docs/LAYERS.md:17-98` の Layer 0/1/2 分類にないファイルを未分類候補とする。`storage/`・`trustDb/`・`crypto/`・`logger/` サブディレクトリ配下は分類済みのため対象外
- 調査用 rg: `rg -ln "utils/storage\.js" src tests | sort`、`rg -n "from.*storage" src/utils/errorUtils.ts src/utils/objectUtils.ts src/utils/crypto/primitives.ts`（Layer 0 汚染チェック）、`grep -rn "@layer" src/utils/ | wc -l`（分類コメント網羅率）
- スコープ補正: 本 PBI は research 込みの整理タスクのため、実装 PR はテスト移行と dead 削除の 2 本立てを推奨する。barrel 物理削除は参照ゼロ到達時のみ

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み（LAYERS.md の Wave 3 残作業記述があれば）
