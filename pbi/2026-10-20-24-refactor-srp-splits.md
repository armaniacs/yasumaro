# PBI 24: SRP 分割（複数責務を持つ 3 単位）

## ユーザーストーリー
メンテナーとして、複数責務を持つ単位が分割された状態がほしい、なぜなら 4 責務を 1 関数に持つ sanitizeRegex は WASM parity の TS リファレンスでもあり、分割なしの変更は WASM 側との整合を壊すから。

## 変更点の概要
複数責務を持つ 3 単位を分割する。出力は不変（parity テストで担保）。

## 現状と問題
- src/utils/piiSanitizer.ts の sanitizeRegex（195 行・4 責務: 検出・置換・検証・レポート、呼び出し元 7+ 箇所、テスト 4 スイート、WASM parity の TS リファレンス）
- src/dashboard/models-dev-dialog.ts（1 クラス 507 行・UI とデータ取得の複数責務）
- src/popup/recordCurrentPage/recordSession.ts:70-107（loadCurrentTab がタブ取得・検証・フォールバックの複数責務）
- テスト: piiSanitizer 系 4 スイートが検出・置換の境界を検証

## 変更の理由
[SRP] 分割はリスクが高く影響面が広いため、RICE 下位。WASM parity テスト（src/wasm/pii-sanitizer/parity.test.ts）が存在するため出力不変を担保できる。

## 提案コード（骨子）
- sanitizeRegex を detect / replace / validate / report の 4 関数へ分割（sanitizeRegex は 4 関数を呼ぶファサードを維持し、呼び出し側のシグネチャは不変）
- ModelsDevDialog を UI・データ取得の 2 クラスへ分割
- loadCurrentTab をタブ取得と検証へ分割

## BDD受け入れシナリオ
Scenario: 分割後も出力は不変
  Given PII を含むテキスト
  When 分割後の sanitizeRegex を通す
  Then 検出・置換結果は変更前と同一である（parity テストが通過）

Scenario: 呼び出し側のシグネチャ不変
  Given sanitizeRegex の 7+ 呼び出し元
  When ファサードを維持する
  Then 呼び出し側は変更されない

## 見積もり
3 pt（RICE: 8 = Reach 3 × Impact 3 × Confidence 0.5 ÷ Effort 2.0 人日）

## DoD
- [ ] 分割後も parity テスト・既存 4 スイート全通過
- [ ] 呼び出し側のシグネチャが不変であること
- [ ] npm run validate 通過
