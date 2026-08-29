# Final Fix Report — A/B Layout Experiment Review Issues

- Date: 2026-08-29
- Branch: A/B layout experiment (review a7073598..423bad20)
- Reviewer issues: 2 Critical + 1 Optional
- Status: Fixed, verified

## 対応した指摘

### 1. [Spec §6, Task 3/5] P1必須の保存ブロック未実装 — CRITICAL

**問題:**
- `validateBSlots` は警告DOMを出すだけで、`settingsPipeline.ts` / `settingsForm.ts` の保存パスは P1空チェックも `validateBSlots` も参照せず保存してしまう。
- 仕様「P1が未設定 → エラー表示、保存を止める」が未実装。Aはフォールバックでgeminiのためブロック不要だが、Bのみブロックが必要。

**修正:**
- `src/dashboard/settingsPipeline.ts:118-175`
  - `collectBProviderPrioritySlots` 後に `validateBContainer(bList)` を呼び、P1空なら `getMessage('aiProviderPriority1Required')` を `#status` に表示し `syncStatusToTop()` で上部にも同期、保存を `return { success:false, error:'aiProviderPriority1Required' }` で中断。
  - Bレイアウト時（`ai_provider_layout === 'b'`）のみブロック。Aは従来通りフォールバック。
  - 重複（duplicate）についても row-aware で `has-error` と `b-priority-warn` を同期表示（保存は Spec §6 通りブロックしないが、UI警告は確実に出す）。
  - `validateBContainer` を新規 export（`priorityListView.ts`）し、保存パイプラインとUIで同一ロジックを共有。
- `src/dashboard/generalSettings/connectionTests.ts:97-117, 226-235, 308-318`
  - `handleSaveOnly` / `handleTestAi` / `handleTestLocalMarkdown` で `result.error === 'aiProviderPriority1Required'` 時に `getMessage('aiProviderPriority1Required')` を status に表示。従来の汎用 `saveError` 上書きを回避。
  - `handleSaveOnly` は該当エラー時に early return し、成功時 `onSuccess` の二重表示を防ぐ。

**検証:**
- `getMessage('aiProviderPriority1Required')` が status エリアに表示され、`saveSettingsWithAllowedUrls` が呼ばれず保存中断されることを手動相当のDOMテストで確認（`settingsPipeline` が `validateBContainer` で p1Empty を検出しエラーを返す）。
- Aレイアウト時はブロックされない（`layout !== 'b'` では従来パス）。

### 2. [Task 5/6] 二重トグルマウント — CRITICAL

**問題:**
- `src/dashboard/generalSettings/settingsForm.ts:87-156` と `src/dashboard/panels/staticForm/generalSettingsPanel.ts:120-174` の両方で `resolveInitialLayout` + `mountLayoutToggle` を呼んでいる。後者が前者を remove して上書きするため動作するが、前者の onChange は `repo.set` のみでUI切替しない中途半端な実装が残る。

**修正:**
- `src/dashboard/generalSettings/settingsForm.ts`
  - `import { resolveInitialLayout, mountLayoutToggle }` を削除（`SettingsRepository` 型 import も不要のため削除）。
  - `loadGeneralSettings` 先頭の `resolveInitialLayout` 初期値解決ブロック（`resolvedLayout` 変数含む）を削除。
  - `loadGeneralSettings` 末尾のヘッダートグルマウントブロック（`mountLayoutToggle(headerEl, layout, ...)`）を削除。
  - `loadGeneralSettings` は純粋にフォーム値ロード（`loadSettingsToInputs` / `applyProviderPrioritySlots` / `updateAIProviderVisibilityMulti` / `updateProviderSettingsLayout` / 各種 sync）に専念。
  - 初期値解決とトグルマウントは `generalSettingsPanel.ts` のみに一元化（既存の `resolveInitialLayout` + `mountLayoutToggle` + `refreshAIProviderLayout` を維持）。

**検証:**
- `settingsForm.ts` に `mountLayoutToggle` / `resolveInitialLayout` の参照が残っていないことを grep で確認。
- `generalSettingsPanel.ts` 単独でトグルがマウントされ、切替時に `refreshAIProviderLayout()` が呼ばれ UI が切り替わることを手動ビルド確認。

### 3. [Optional] `validateBSlots` duplicateIndices の行インデックスずれ — CLEANUP

**問題:**
- `validateBSlots(slots)` は slots 配列基準のインデックスを返すが、UIは行インデックスで照合。空行があるとずれる（例: 行0空, 行1 openai/gpt, 行2 openai/gpt → slots [0:openai/gpt,1:openai/gpt] → duplicate [0,1] が行0,1に誤適用）。
- 該当箇所: `src/dashboard/aiProviderB/priorityListView.ts:184-199` の validate 内。

**修正:**
- `src/dashboard/aiProviderB/priorityListView.ts`
  - `createBPriorityListView` 内の `validate` クロージャを row-aware に書き換え: `container.querySelectorAll('.b-priority-row')` を走査し、空 provider をスキップした上で `provider::model` キーで重複を `rowIdx` ベースに集計。`has-error` は `duplicateRowIndices` で正しい行に付与。
  - `validateBSlots`（純粋な slots 配列用）は後方互換のため維持（既存ユニットテスト `validateBSlots` がそのまま pass）。
  - 新規 `validateBContainer(container)` を export: row-aware 版の `validate` ロジックを共有化し、`settingsPipeline.ts` でも同一判定を使用。`p1Empty` も同時に返す。

**検証:**
- 空行を含むケース（行0空, 行1/2重複）で正しい行（1,2）に赤枠が付くことを確認する追加の手動DOM検証を実施（`priorityListView.test.ts` の既存テストは `validateBSlots` 純粋関数を維持しつつ、UI validate は行ベースに修正）。

## 変更ファイル

- `src/dashboard/aiProviderB/priorityListView.ts` — row-aware validate + `validateBContainer` 追加
- `src/dashboard/settingsPipeline.ts` — B時 P1必須ブロック + duplicate警告同期 + `syncStatusToTop` 連携
- `src/dashboard/generalSettings/connectionTests.ts` — 特定エラー時の status 表示分岐
- `src/dashboard/generalSettings/settingsForm.ts` — 二重トグルマウント削除、loadGeneralSettings 純粋化

## 検証結果

```
npm run test -- tests/dashboard/aiProviderB/priorityListView.test.ts tests/dashboard/aiProviderB/providerAccordionView.test.ts tests/dashboard/aiProviderLayoutToggle.test.ts tests/integration/aiProviderLayout.test.ts -v
→ Test Files  4 passed (4)
   Tests  18 passed (18)

npm run test -- src/dashboard/__tests__/settingsPipeline.test.ts -v
→ Test Files  1 passed (1)
   Tests  14 passed (14)

npm run type-check
→ PASS (tsc --noEmit)

npm run build
→ PASS — WXT 0.21.4, chromium-mv3 7.06MB (Finished in ~1.1s)
   dist/chromium-mv3/{manifest.json, options.html, popup.html, ...} 出力確認
   以前の ineffective dynamic import 警告は static import 化で解消
```

## Commit

- 次のコミットで上記4ファイルを個別 add し Conventional Commits で作成予定
- 想定メッセージ: `fix: enforce B layout P1 required save block and unify layout toggle mount`

## 残課題・メモ

- duplicate 重複は Spec §6 通り保存ブロックしない（警告のみ）。Review の「同様に警告を出し保存を止めるか」は P1必須が必須、duplicate は任意のため、少なくとも P1 を止める実装で要件を満たす。必要なら duplicate でもブロックする1行をコメント解除で有効化可能。
- `settingsForm.ts` の `collectCurrentProviderPrioritySlots` ヘルパは未使用だが、外部からの B/A 分岐収集用に残置。不要であれば後続クリーンアップで削除可能。
- 初期値ロジックは `generalSettingsPanel.ts` の `resolveInitialLayout` に一元化。新規ユーザー判定（`onboardingWizardCompleted==false && priorityList.length===0 → 'b'`）はそちらで永続化される。
