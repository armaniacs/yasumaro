# PBI: 同一ドキュメント内に重複 DOM id が生成され、食い違う二系統のバリデーションが走る

## ユーザーストーリー

設定画面の利用者として、記録条件の入力欄とバリデーションを一意にしたい。同一 id の input が文書に 2 つあり、どちらの画面で保存したかで保存可否が変わる再現不能な不整合になるから。

## 優先度

- 順位: 7/32
- RICE: 7.5（R5 / I3 / C1.0 / E2）
- 根拠: 同じ設定キーを 2 経路が保存しつつ許容範囲が違う。NN19 / NN20 の先行（検証 SSOT の前提）
- 依存: なし（NN19・NN20 の先行）

## 背景（file:line 現状）

- `entrypoints/options/index.html:499`（`id="minVisitDuration"`）/ `:506`（`id="minScrollDepth"`）/ `:513`（`id="maxTokensPerPrompt"`）: Initial Setup の `#panel-general` 側
- `src/dashboard/recordingConditionsSettings.ts:114-116` / `:128`: 記録条件パネル側テンプレートが**同一 id を再生成**。マウント先 `#recording-conditions-settings` は `entrypoints/options/index.html:1802-1808`（初回遷移後に重複が発生）
- `src/dashboard/settings/fieldValidation.ts:24, :38, :252`: `document.getElementById(errorId/elementId)` で document 全体解決。ドキュメント順で先に来る `#panel-general` 側が常に解決先になり、記録条件側の `<label for>` は隠れた input にフォーカスを移し、記録条件側 input の `aria-describedby` は隠れた error div を指す
- 許容範囲の食い違い: `src/dashboard/settings/fieldDescriptor.ts:102-104` に「recordingConditionsSettings.ts が `minVisitVal < 1` を inline で mirror している／本 PBI のファイルスコープ外」との自認コメント。`fieldDescriptor.ts:106-109` は `v < 0` 許容、`recordingConditionsSettings.ts:213-232` は `< 1` 拒否・maxTokens は `10..16000` 固定（fieldDescriptor 側は provider 感知）
- 同一キーへの書き込み: `recordingConditionsSettings.ts:265-274` と `src/dashboard/settingsPipeline.ts:111, :137` + `src/utils/settingsSchemas.ts:48-50` + `src/dashboard/panels/staticForm/generalSettingsPanel.ts:70`

## BDD受け入れシナリオ

```gherkin
Scenario: 同一文書内に重複 id が無い
  Given 記録条件パネルを開いた状態
  When document 内の minVisitDuration / minScrollDepth / maxTokensPerPrompt の id 出現数を数える
  Then 各 id は文書内に 1 つだけ存在する

Scenario: 記録条件側のエラーが記録条件側に表示される
  Given 記録条件パネルで minVisitDuration に 0 を入力する
  When バリデーションが走る
  Then 記録条件側の error div に文言が出て aria-invalid が記録条件側 input に付く

Scenario: どちらの画面で保存しても可否が一致する
  Given 境界値（minVisitDuration=0 等）の入力
  When Initial Setup 側と記録条件側のそれぞれで保存する
  Then 両者の保存可否が一致する
```

## 受け入れ基準

- [x] 記録条件テンプレートの id にスコープ接頭辞（例 `rc-`）が付き、`label for` / `aria-describedby` が追随している
- [x] バリデーションが SSOT に 1 本化され（1 未満を弾く方針に統一）、両画面で同一の validator が呼ばれる
- [x] `fieldValidation.setFieldError/clearFieldError/validateAllFields` の document 解決が、descriptor 行の `container?: ParentNode` 経由の `root.querySelector` に変更されている
- [x] 既存の null ガードと `errorFallback` 分岐はそのまま移設されている
- [x] a11y（label / aria-describedby の解決先）が正しいことをテストで pin する
- [x] `npm run validate` が PASS する（最終ゲートで確認）

## テスト戦略

- 単体: id の一意性テスト（テンプレート生成後の文書内 id 重複チェック）
- 単体: バリデーション SSOT の境界値テスト（0 / 1 の両画面一致）
- 実時間待ちは使わない（AGENTS.md / TEST_RULE 準拠）

## 見積もり

2 SP

## Definition of Done

- [x] 上記受け入れ基準をすべて満たす
- [x] `npm run validate` が PASS する
- [ ] コードレビュー完了

## 実装記録

- 変更ファイル: `src/dashboard/settings/fieldDescriptor.ts`（`container` 受け口追加、`validateMinVisitDurationValue` を `v < 1` 拒否に統一）、`src/dashboard/settings/fieldValidation.ts`（scope 解決 + `root` 引数追加。既存呼び出しは互換）、`src/dashboard/recordingConditionsSettings.ts`（テンプレート 3 系統に `rc-` 接頭辞、保存時検証を SSOT 呼び出しに置換、RC 側 error div への書き込み追加）。`entrypoints/options/index.html` は無変更（テンプレート側の prefix のみで重複解消）
- テスト: fieldDescriptor / fieldValidation / recordingConditionsSettings / branches の 4 ファイル 120 tests green
- ゲート: type-check PASS / lint 0 errors
