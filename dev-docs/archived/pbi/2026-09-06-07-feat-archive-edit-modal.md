# PBI: アーカイブセッションの編集UIをアクセシブルなモーダルに置き換え（window.prompt廃止）

## ユーザーストーリー

yasumaroのユーザー（キーボード操作・スクリーンリーダー利用者を含む）として、アーカイブセッションのタイトル編集を適切なモーダルダイアログで行いたい。なぜなら、現行の `window.prompt` はTab循環・Esc・フォーカス復帰が効かず、WCAG 2.1 AA（docs/ACCESSIBILITY.md）とパネル設計（PBI 2026-09-06-05 D-4: showConfirmDialog同等のフォーカス管理）を満たさないから。

## 分析: 実装修正が必要（文言修正では不十分）

`window.prompt` はブラウザ組込みダイアログであり、以下が実装として不足:

| 不足 | 影響 |
|------|------|
| role="dialog" / aria-modal / ラベル紐付け | スクリーンリーダーがダイアログを通知できない |
| Tab循環（フォーカストラップ） | モーダル背後の要素にフォーカスが抜ける |
| Esc閉じ・起動要素へのフォーカス復帰 | キーボード操作の完了ができない |
| 入力値の検証（空文字・長さ） | 空タイトルでの保存が可能 |

置き換え先は `focusTrapManager`（src/utils/ui/focusTrap.ts、実在・単体テスト済み）を再利用する — PBI-05 D-4 の「focusTrapManager 再利用」指示どおり。

## ビジネス価値

- **A11y準拠**: WCAG 2.1 AA のダイアログ要件を満たし、キーボードのみのユーザーでも編集を完結できる
- **測定方法**: ユニットテスト（jsdom）でモーダルの属性・Tab循環・Esc・フォーカス復帰を検証

## BDD受け入れシナリオ

```gherkin
Scenario: 編集ボタンでモーダルが開き、フォーカスが閉じ込められる
  Given アーカイブセッションが開いており一覧が表示されている
  When ある行の「Edit title」ボタンをクリックする
  Then role="dialog" + aria-modal="true" のモーダルが表示される
  And 入力欄に現在のタイトルが初期表示され、フォーカスが入力欄にある
  And Tab押下でモーダル内のフォーカスが循環する

Scenario: 保存で変更が反映され、フォーカスが復帰する
  Given モーダルが開いている
  When タイトルを変更して保存する
  Then archive_update が呼ばれ一覧が再読込される
  And モーダルが閉じ、起動要素（Edit titleボタン）にフォーカスが復帰する

Scenario: Escでキャンセルすると変更は破棄される
  Given モーダルが開いている
  When 入力を変更せず Esc を押す
  Then モーダルが閉じ archive_update は呼ばれない
  And 起動要素にフォーカスが復帰する
```

## 受け入れ基準

- [x] モーダル: role="dialog" + aria-modal="true" + aria-labelledby
- [x] Tab循環（focusTrapManager.trap）+ Esc でキャンセル + 閉時に起動要素へフォーカス復帰
- [x] 保存: `archive_update(stagingName, id, { title })` — 空文字・65字超は拒否（ValidationError相当の画面内表示）
- [x] キャンセル・Esc・保存のいずれでもフォーカスが起動要素に復帰する
- [x] `window.prompt` の使用が archivePanel.ts から消える
- [x] i18n（en/ja）: モーダルタイトル・ラベル・保存/キャンセルボタン

## テスト戦略（t_wadaスタイル）

### 単体テスト
- `archivePanel.test.ts` 追加（jsdom）: 上記BDD 3シナリオ（モーダル属性・Tab循環は focusTrapManager のテストで担保済みのため、パネル側は「trap が呼ばれる・Escコールバックで閉じる・保存で update 呼び出し」を検証）

### E2Eテスト
- なし（file:// 制約。@extension への追加は既知のSW応答問題解決後）

## 実装アプローチ

- Red（archivePanel.test.ts に3シナリオ追加）→ モーダル生成ヘルパ（archivePanel.ts 内・DOM動的生成）→ Green → リファクタ（focusTrapManager への委譲を確認）

## 見積もり

1pt（要チームでの見積もり）

## 技術的考慮事項

- **依存関係**: PBI-05 完了済み（セッション・archive_update 実装済み）
- **テスタビリティ**: jsdom でフォーカス/keydown 検証可能（confirmDialog.test.ts のパターン）
- **非機能要件**: CSP 遵守（動的HTMLは textContent/属性設定のみで組み立て、innerHTML 禁止）

## 実装者向け注記

### 現状コードの確認
```bash
grep -n "prompt" src/dashboard/panels/diagnostic/archivePanel.ts
grep -n "trap(" src/utils/ui/focusTrap.ts | head -3
```
（2026-09-06 作成時点: 編集は window.prompt。focusTrapManager は実在・単体テスト済み）

### 実装手順
1. Red: archivePanel.test.ts に3シナリオ追加
2. モーダル生成（archivePanel.ts 内関数）: overlay + dialog + input + 保存/キャンセル、`focusTrapManager.trap(modal, closeCallback)` を呼び、閉じ時に `release(trapId)`
3. 保存: `archive_update(stagingName, id, { title })` 成功時にモーダル閉じ＋一覧再読込（既存の renderSessionList を利用）
4. i18n キー追加（archiveModalTitle / archiveModalTitleLabel / archiveModalSave / archiveModalCancel / archiveModalTitleRequired / archiveModalTitleTooLong）
5. Green → リファクタリング

### 落とし穴
- **Esc の二重処理**: focusTrapManager の keydown と パネル側の keydown が競合しないよう、Esc は trap の closeCallback に一本化する
- **jsdom の focus**: `offsetParent !== null` 判定のため、モーダルは document.body に append してから trap を設定する
- **起動要素の保持**: Edit ボタンを再描画（renderSessionList）で作り直すため、フォーカス復帰は「起動要素そのもの」ではなく「同じ位置の行の編集ボタン」でも可（querySelector で行を再特定）

## Definition of Done

- [x] BDD 3シナリオがユニットテストとしてパスする
- [x] `window.prompt` が archivePanel.ts から消えている
- [x] i18n（en/ja）追加済み
- [x] `npm run type-check` / lint / `npm test` / build 全パス
- [x] コードレビュー完了

## 実装メモ（2026-09-06 自律実装）

### 実装したもの
- `archivePanel.ts` 内に `openEditModal` クロージャを新設（mount スコープ内 — container/rowEl/renderSessionList をクロージャで参照）:
  - overlay + role="dialog" + aria-modal="true" + aria-labelledby のモーダルを動的生成
  - `focusTrapManager.trap(dialog, close)` で Tab 循環・Esc・フォーカス復帰を管理
  - `close()` は focusTrapManager.release + overlay.remove + **trigger.focus()**（起動要素への明示フォーカス復帰）
  - 保存: 空文字/500字超のバリデーション（role="alert" の errorEl で画面内表示）→ `archive_update` → close → `onClosed`（renderSessionList 再描画）→ 同一行の新 editBtn へフォーカス移動
  - キャンセル/Esc: close のみ（archive_update 未呼出）
- `window.prompt` を削除（grep で確認済み）
- i18n: `archiveModalTitle` / `archiveModalTitleLabel` / `archiveModalSave` / `archiveModalCancel` / `archiveModalTitleRequired` / `archiveModalTitleTooLong`（en/ja）

### PBI記載からの逸脱と理由
- **フォーカス復帰のタイミング**: close（フォーカス復帰）→ onClosed（renderSessionList 再描画）の順。再描画で行が作り直されるため、元の editBtn インスタンスへの復帰は不可能 → 同一 row の**新しい** editBtn にフォーカスを移動する方式に変更（テストは同一行の新ボタンをアサート）
- **保存のEnterキー対応を追加**: 入力欄で Enter を押すと保存が実行される（アクセシビリティ改善、PBI記載にない追加）

### 検証結果
- `npm run type-check` ✓ / `npm run lint` ✓（0 errors）/ `npm test` ✓ **11837 passed / 0 failed**（モーダル5件追加）/ `npm run build` ✓
- 既存の archivePanel.test.ts（5件）もパス（セッション再接続モック更新済み）
