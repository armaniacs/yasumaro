# prompt-item 行 HTML ビルダーの 4 重複と locale 判定散在の統合（refactor）

## 1. タイトル + 種別

- **タイトル**: `.prompt-item` 行（badge + actions）の HTML 組立が 4 箇所で並行している状態を単一ビルダーに統合し、散在する locale 判定を 1 ヘルパーに集約する
- **種別**: refactor（生成 HTML は byte 同一・挙動不変）
- **見積もり**: 2 SP

## 2. 優先度

- **優先度**: 順位 19
- **RICE**: R3 / I1 / C1.0 / E2 → **1.5**
- **根拠**:
  - prompt-item 構造（badge・class・escape）の契約が 4 箇所で手維持され、変更が 4 か所に飛び火する。locale 判定も同一ファイル内に散在
  - Impact は中（重複削減）、Effort は 2（4 関数の統合 + locale 集約）で RICE は下位。実行順は最後尾近く
- **依存**: **なし**

## 3. ユーザーストーリー

**settings UI の保守担当者として**、prompt-item 行の HTML が単一ビルダーから生成され、locale 判定も 1 か所に集約されていてほしい。なぜなら、4 箇所に散った契約を手維持すると、badge や class の変更が 1 箇所だけ適用されて表示が崩れるから。

## 4. 背景

`.prompt-item` 行（badge + actions）の HTML 組立が 4 ファイル箇所で並行し、badge・class・escape の契約が 4 か所で手維持される。`navigator.language.startsWith('ja') ? 'ja' : 'en'` の locale 判定も同一ファイル内に散在。

該当箇所（全 file:line 検証済み）:

- `src/dashboard/settings/customPromptManager.ts:191-216`（`createPresetPromptItem`）、`:222-244`（`createDefaultPromptItem`）、`:251-272`（`createPromptListItem`）
- `src/dashboard/markdownTemplateManager.ts:157-185`（`createTemplateListItem` — 同一の prompt-item 構造）
- locale 判定の重複: `src/dashboard/settings/customPromptManager.ts:128`、`:227`、`:450`、`:498`

改善案: prompt-item 行の共通ビルダー 1 つに統合する（id prefix / provider label / edit-delete の有無を引数化）。`escapeHtml` の適用位置・`data-i18n` 属性・badge の条件は現行どおりで、生成される文字列は同一。locale 判定は 1 か所のヘルパーにする。render 後の `applyI18n` 呼び出しは現位置保持。挙動不変（生成 HTML 文字列は byte 同一）。

## 5. BDD シナリオ

### シナリオ 1: prompt-item 行が単一ビルダーから生成される

```gherkin
Given prompt-item 行の共通ビルダーが存在する
When preset / default / list / template の各行を生成する
Then すべてが同一ビルダーを呼び、差分（id prefix / provider label / edit-delete の有無）のみが引数で切り替わること
```

### シナリオ 2: 生成 HTML が現行と byte 同一である

```gherkin
Given 同一の入力（id・label・badge 条件）を与える
When 統合前後の prompt-item 行 HTML を比較する
Then escapeHtml の適用位置・data-i18n 属性・class が同一で、生成文字列が byte 同一であること
```

### シナリオ 3: locale 判定が単一ヘルパーになる

```gherkin
Given 統合後のファイルを確認する
When locale 判定を検索する
Then navigator.language.startsWith('ja') ? 'ja' : 'en' の重複が残っていないこと
And 単一ヘルパーが参照されていること
```

## 6. 受け入れ基準

- [ ] prompt-item 行の HTML 組立が単一ビルダーに統合され、4 箇所の重複が解消されている
- [ ] 生成される HTML 文字列が現行と byte 同一である（escapeHtml 適用位置・`data-i18n` 属性・badge 条件・class）
- [ ] locale 判定が 1 か所のヘルパーに集約され、4 箇所の重複が解消されている
- [ ] render 後の `applyI18n` 呼び出しが現位置に保持されている
- [ ] 既存の customPromptManager / markdownTemplateManager のテストが無変更で green である

## 7. テスト戦略

1. **生成 HTML の golden pin 先行**: 統合前に 4 種の prompt-item 行の生成 HTML を pin し、統合後も byte 同一であることを担保する
2. **既存テストの green 維持**: customPromptManager / markdownTemplateManager の既存テストを無変更で通過させる
3. **validate green**: `npm run validate`（type-check + test）で全体通過を確認する

## 8. 見積もり

**2 SP** — 4 関数の統合 + locale 判定の集約 + golden pin の確認。影響範囲は customPromptManager / markdownTemplateManager の 2 ファイル。

## 9. DoD

- [ ] 受け入れ基準 5 件すべて充足
- [ ] 生成 HTML の golden pin が green（byte 同一）
- [ ] locale 判定の重複が解消
- [ ] 既存テストが無変更で green
- [ ] `npm run validate`（type-check + test）が green

## 10. 出所

- holistic-1009 ラウンド（[台帳](2026-10-09-00-backlog-holistic-1009.md)）
- RICE 順位 19（R3 / I1 / C1.0 / E2 → 1.5）
- 依存: なし
