# PBI: 進行中ステータスの型を追加し、focusTrap の disabled 除外と confirmDialog の初期フォーカスを直す

- 種別: fix
- RICE: 5.3（R4 × I2 × C1.0 / E1.5）
- 依存: なし（`src/dashboard/generalSettings/connectionTests.ts` を触る唯一の PBI。他 PBI とファイル非重複で並列可）
- バッチ: checking-team-1010
- 台帳: `pbi/2026-10-11-00-backlog-checking-team-1010.md`
- 出所: checking-team レビュー（`dev-docs/archived/plans/2026-10-10-2320-review-1007z.md`）UI Expert Medium 1件 + Accessibility Medium 1件 + Low 1件

## ユーザーストーリー

キーボードとスクリーンリーダーを使うユーザーとして、モーダルを開いている間はフォーカスがモーダル内に留まってほしい。また全ユーザーとして、処理中メッセージが成功として表示されてほしくない。なぜなら現状は保存中に disabled になったボタンがフォーカス循環の終端になりモーダル外へ抜け、接続テスト中は緑の成功ボックス（開始時は空の緑ボックス）が出るから。

## 背景（現状・証拠）

### 進行中メッセージが success 型

- `src/dashboard/generalSettings/connectionTests.ts:270`, `:298`, `:441` — 本ブランチの status 契約統一で `showStatus(statusDiv, '接続テスト中...', 'success', { autoClear: false })` になり、(1)「テスト中」が成功色（緑背景＋緑枠）で表示され、(2) `showStatus(statusDiv, '', 'success', ...)` は空文字でも `.status-message.success` の padding 10px/12px + border + 背景が付くため、保存処理の間だけ高さ約 42px の**空の緑ボックス**が点滅する。
- `status-message` は `min-height: 20px` を持つ（`entrypoints/options/dashboard.css:886-895`）ため `:empty` でも消えない。
- CSS には未使用の `.status-message.updating` が既に存在する（`entrypoints/options/dashboard.css:951`）。
- `src/dashboard/panels/diagnostic/exportLogsPanel.ts:28,38,48,58` の `onStart` も同じ誤用をしている。
- `main` では開始時に `statusDiv.className = ''` としていたため、進行中表示は素のテキストだった（退行）。

### focusTrap が disabled 要素を除外しない

- `src/utils/ui/focusTrap.ts:12` — `FOCUSABLE_SELECTOR` が `button` / `input` 等を `:not([disabled])` なしで列挙。
- `:19-23` — `getFocusableElements` の絞り込みは `.hidden, [hidden]` のみ。
- `:121-123` / `:147-149` — trap 時に first/last を固定取得。`:56` — 折り返し条件が `document.activeElement === last`。
- disabled 要素は focus を持てないため、DOM 順で最後のフォーカス可能要素が disabled だと折り返し条件が永遠に真にならず、Tab が `preventDefault()` されない＝`aria-modal="true"` のモーダルから背後の設定画面へフォーカスが抜ける（WCAG 2.1 AA の 2.4.3 / 2.1.1 に抵触）。
- 実経路: `src/dashboard/masterPassword.ts:318` は保存中に `submitBtn.disabled = true` にするため、保存中に Tab を押すとモーダル外へ抜ける。first が disabled の場合は `:148` の `firstFocusable.focus()` が no-op となり初期フォーカスも移らない。
- `confirmDialog`（`src/utils/ui/confirmDialog.ts:31-38`）は `button:not([disabled])` を使い除外済み。本ブランチは逆にこの差異をテストで pin している（`src/utils/ui/__tests__/focusTrap.test.ts:200-217` 「keeps disabled controls in the focusable set」）。

### confirmDialog の初期フォーカスが破壊的ボタン

- `src/utils/ui/confirmDialog.ts:125` — 初期フォーカスが最後のボタン＝破壊的操作の確認ボタンで、誤 Enter による削除が起きやすい（本ブランチの変更行ではないが、同ファイルを触る今回が直し時）。

## BDD 受け入れシナリオ

```gherkin
Scenario: 保存中に Tab を押してもモーダル外へ抜けない
  Given master password モーダルが開いている
  And 保存中のため submit ボタンが disabled である
  When Tab を繰り返し押す
  Then フォーカスはモーダル内のフォーカス可能要素を循環し、背後の設定画面へ移動しない

Scenario: 進行中メッセージが成功として表示されない
  Given 接続テストを開始する
  When 処理中である
  Then ステータスは updating 型で表示され、success の緑ボックスにならない
  And 空メッセージのときに success の枠が描画されない

Scenario: 破壊的確認の初期フォーカスが破壊的ボタンに置かれない
  Given 破壊的操作の confirmDialog が開く
  When 初期フォーカスが設定される
  Then キャンセル側（または非破壊的なボタン）にフォーカスが置かれる
```

## 受け入れ基準

- [ ] `StatusType`（`src/utils/ui/settingsUiHelper.ts:8`）に `'updating'` を追加する
- [ ] `connectionTests.ts:270`, `:298`, `:441` の開始・進行中表示を `'updating'` にする。空メッセージで `success` を付けない（空なら `showStatus` を呼ばずクラス解除に留める）
- [ ] `exportLogsPanel.ts:28,38,48,58` の `onStart` も同様に直す
- [ ] `focusTrap.ts` の `FOCUSABLE_SELECTOR` に `:not([disabled])` を付け、`getFocusableElements` の filter に disabled 除外を足して `confirmDialog` と一致させる（selector を 1 本に統合するのが最小）
- [ ] `trap()` の first/last 固定取得をやめ、`handleFocusCycle` の doc コメント（`:30-31`）どおり keydown ごとに再取得する（開いた後に disabled 化された要素に追随するため）
- [ ] `focusTrap.test.ts:200-217` の pin テストを「disabled を除外する」期待に書き換える
- [ ] `confirmDialog.ts:125` の初期フォーカスを非破壊的なボタン（キャンセル側）にする
- [ ] Escape 処理・Tab/Shift+Tab の折り返し・復帰フォーカス・`role="dialog"` / `aria-modal` / `aria-labelledby` / `aria-describedby` に退行がない
- [ ] `npm run validate` が green

## テスト戦略

- unit: `settingsUiHelper.showStatus` が `'updating'` 型で `.status-message.updating` を付け、空メッセージで `success` 枠を描画しないこと
- unit: `connectionTests` / `exportLogsPanel` の開始時に `'updating'` が渡ること
- unit: `focusTrap` が disabled 要素を除外し、末尾が disabled でも Tab 折り返しが成立すること
- unit: `confirmDialog` の初期フォーカスがキャンセル側になること
- 回帰: `focusTrap` / `confirmDialog` の既存テスト（Escape・復帰フォーカス・aria）が green
- 手動: master password 保存中に Tab を押してモーダル外へ抜けないこと、接続テスト中の見た目が success 色でないこと

## 見積もり

1.5 SP（status 型 0.5 + focusTrap 0.75 + confirmDialog 0.25）

## 技術的考慮事項

- `StatusType` に `'updating'` を足すと `showStatus` の実装（クラス付与と aria 属性）も追随が必要。`role="status"` / `aria-live` の扱いを壊さない
- CSS は既に `.status-message.updating` を持つため、CSS 追加は不要（あれば差分最小化のため使う）
- focusTrap の selector 統合は `confirmDialog` 側の期待値も変えうる。両方のテストを同時に更新する
- `trap()` の再取得化は呼び出し回数が増える（keydown ごと）。フォーカス可能要素が数百ある画面は無いため実害は無いが、`querySelectorAll` の呼び出し箇所をイベントハンドラ内に閉じる

## 実装者向け注記

### 実装手順

1. `focusTrap.ts` の disabled ケース、`showStatus` の空メッセージケースの失敗テストを先に書く（Red）
2. `StatusType` 拡張 → `showStatus` 実装 → 呼び出し側 2 ファイル
3. focusTrap の selector 統合と first/last 再取得化、pin テストの書き換え
4. confirmDialog の初期フォーカス
5. `npm run validate`

### 落とし穴

- `focusTrap.test.ts:200-217` は「差異を固定する」テストなので、書き換えずに残すと実装と矛盾する
- 空メッセージで `showStatus` を呼ばない変更は、呼び出し側の「前回のステータスを消す」意図を壊さないようクラス解除を明示する
- テストで実時間待ちを入れない

## Definition of Done

- [ ] disabled 末尾でもフォーカスがモーダル外へ抜けないテストが green
- [ ] 進行中・空メッセージで success 枠が出ないテストが green
- [ ] confirmDialog の初期フォーカスが非破壊的なボタンになるテストが green
- [ ] `npm run validate` が green
- [ ] 手動確認項目（キーボード操作・見た目）を PBI に記録
- [ ] 検証結果（コマンドと結果）を PBI に記録し、アーカイブする
