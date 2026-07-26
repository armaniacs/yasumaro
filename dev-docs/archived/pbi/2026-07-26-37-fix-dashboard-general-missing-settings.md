# PBI: ダッシュボードのGeneralパネルに不足している設定項目を追加する

**作成日**: 2026-07-26
**優先度**: Medium
**見積もり**: 🟢低（1pt目安）
**副作用**: 🟢軽微（追加のみ。既存UIの削除・変更を伴わない）

---

## 背景

`2026-07-26-27-fix-popup-dashboard-settings-duplication.md`（PBI-27）着手前のフェーズ0調査で、
popup側 `generalPanel`（`entrypoints/popup/index.html`）にある設定項目のうち以下3つが、
dashboard側 `panel-general`（`entrypoints/options/index.html`）に**一切存在しない**ことが判明した。

| 項目 (data-storage-key) | 内容 | popup側 | dashboard側 |
|---|---|---|---|
| `min_visit_duration` | Min Visit Duration（記録対象とする最小滞在秒数） | `entrypoints/popup/index.html:324` | なし |
| `min_scroll_depth` | Min Scroll Depth（記録対象とする最小スクロール率） | `entrypoints/popup/index.html:331` | なし |
| `max_tokens_per_prompt` | Max Tokens Per Prompt（AI要約プロンプトの最大トークン数） | `entrypoints/popup/index.html:340` | なし |

**訂正（実装着手時の追加調査）**: 当初4つ目として挙げていた
`ai_summary_cleansing_body_protection_enabled`（Body Protection）は、追加調査の結果
**機能欠落ではなかった**。`src/popup/aiSummaryCleansingSettingsV2.ts`が
`ai-summary-cleansing-body-protection-enabled`（dashboard側 `panel-ai-summary-cleansing` に
実在するID）と `popup-body-protection-enabled`（popup側にのみ存在するID）の両方に
同じ`bodyProtectionEnabled`/`bodyProtectionThreshold`値を書き込んでいるが、
設定の**読み取り（抽出）は`ai-summary-cleansing-*`のIDからのみ**行われており
（同ファイル388-389行目）、`popup-body-protection-*`は表示専用の重複UIに過ぎない。
つまりBody Protection機能は既にdashboard側の`panel-ai-summary-cleansing`に完全実装済みであり、
本PBIの対象外とする。

PBI-27（popupの設定UIをダッシュボードへの誘導リンクに置き換える）はこの欠落が解消されない限り
着手できない（機能欠落が発生するため）。ユーザーの指示によりPBI-27から本作業を分離した。

## 実装者向け注記: 現状の確認（フェーズ0調査済み・2026-07-26実施）

以下は調査済み。再実行は不要:

```bash
grep -n "min_visit_duration\|min_scroll_depth\|max_tokens_per_prompt" entrypoints/popup/index.html
grep -n "min_visit_duration\|min_scroll_depth\|max_tokens_per_prompt" entrypoints/options/index.html
```

### 確認済み結果

- popup側の入力欄構造は`entrypoints/popup/index.html:322-344`
- ラベルのi18nキー（`minVisitDuration`, `minScrollDepth`, `label_max_tokens`,
  `note_max_tokens_cost_control`）は既存の`_locales/*/messages.json`に定義済み。新規i18nキー追加は不要
- **保存・読み込みの仕組み**: `src/utils/settingsFormBinding.ts`の`loadSettingsToInputs`/
  `extractSettingsFromInputs`が、コンテナ配下の`[data-storage-key]`属性付き要素を
  汎用的に走査して値を読み書きする。dashboard側`src/dashboard/dashboard.ts`も同じ関数を
  `SETTINGS_FORM_SELECTOR = '#panel-general'`（`dashboard.ts:53`）配下に対して呼んでいる
  （184, 329, 416, 484行目）。
  **つまり`panel-general`内に`data-storage-key`属性付きでHTMLを追加するだけで、
  保存・読み込みロジックの追加実装は一切不要**（自動的に配線される）
- Body Protectionは対象外（背景セクション参照。dashboard側に既存実装がある）

## 受け入れ基準（BDD）

```gherkin
Scenario: ダッシュボードのGeneralパネルで記録条件設定が可能になる
  Given ダッシュボードのGeneralパネルを開く
  When Min Visit DurationとMin Scroll Depthの入力欄を確認する
  Then 両方の入力欄が存在し、既存設定値が読み込まれ、変更・保存ができる

Scenario: ダッシュボードのGeneralパネルでMax Tokens Per Promptが設定可能になる
  Given ダッシュボードのGeneralパネルを開く
  When Max Tokens Per Promptの入力欄を確認する
  Then 入力欄が存在し、既存設定値が読み込まれ、変更・保存ができる
```

## 受け入れ基準
- [ ] `entrypoints/options/index.html` の `panel-general` に3項目（min_visit_duration, min_scroll_depth, max_tokens_per_prompt）を追加する
- [ ] 追加した項目が既存の`loadSettingsToInputs`/`extractSettingsFromInputs`の汎用処理で正しく動作する（追加の保存・読み込みロジック実装は不要）
- [ ] 既存のi18nキーを流用し、新規キー追加は行わない
- [ ] `npm run build` と既存テストスイートが全てパスする
- [ ] 追加項目に対する単体テストが `src/dashboard/__tests__/` に追加されている

## テスト戦略

### 統合テスト
- `npm run build` 後、実ブラウザでダッシュボードを開き3項目が表示・保存・復元されることを確認（手動）

### 単体テスト
- `loadGeneralSettings`/保存処理に対する既存テストパターンに倣い、3項目の読み込み・保存をテスト

## 実装アプローチ

1. popup側の該当HTML（322-344行）とdashboard側`panel-general`の構造差分を確認
2. dashboard側`panel-general`末尾（AIプロバイダー設定の後）に3項目のHTML（`data-storage-key`属性付き）を追加
3. `loadSettingsToInputs`/`extractSettingsFromInputs`の汎用処理で自動的に保存・読み込みされることを確認（追加ロジック実装は不要な想定）
4. テスト追加、ビルド・既存テストで回帰がないことを確認

## 見積もり

1pt

## 技術的考慮事項
- 依存関係: なし（追加のみ）
- テスタビリティ: 既存の`dashboard-obsidian-enabled.test.ts`等のパターンを踏襲
- 非機能要件: 保守性（PBI-27の前提条件を解消する）

## Definition of Done
- [ ] 3項目がダッシュボードのGeneralパネルに追加されている
- [ ] 保存・読み込みが正しく動作する
- [ ] テストが追加されパスする
- [ ] `npm run build` と既存テストスイートが全てパスする
- [ ] `pbi/00-INDEX.md` が更新されている

## 関連
- 派生元PBI: `pbi/2026-07-26-27-fix-popup-dashboard-settings-duplication.md`（PBI-27の前提条件）
- 対象コード: `entrypoints/options/index.html`, `src/dashboard/dashboard.ts`

## 実装メモ（2026-07-26完了）

- `entrypoints/options/index.html` の `panel-general` に3項目（min_visit_duration, min_scroll_depth,
  max_tokens_per_prompt）を追加。「AIプロバイダー設定」と「閲覧履歴 保持ポリシー」の間に
  「記録条件・AI設定」セクションとして配置
- 想定通り `loadSettingsToInputs`/`extractSettingsFromInputs` の汎用処理（`data-storage-key`属性走査）
  だけで保存・読み込みが配線された。追加の保存/読み込みロジック実装は不要だった
- `src/dashboard/dashboard.ts` の `handleSaveOnly()` に、3項目の `ErrorPair` 登録と
  `validateAllFields()` への引数追加のみ実施（既存の`protocolInput`/`portInput`と同じパターン）
- `src/dashboard/__tests__/dashboard-obsidian-enabled.test.ts` に読み込み・抽出のテスト2件を追加
- `npm run validate`（型チェック+全7267テスト）・`npm run build` とも成功
- 当初4項目目として想定していた `ai_summary_cleansing_body_protection_enabled`（Body Protection）は
  調査の結果、既にdashboard側 `panel-ai-summary-cleansing` に完全実装済みと判明し対象外とした
  （詳細は背景セクション参照）
