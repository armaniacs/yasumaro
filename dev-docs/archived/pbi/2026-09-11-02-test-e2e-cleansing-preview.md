# PBI 02: e2e spec — cleansing preview の mask 遷移と confirm → SAVE_RECORD

## ユーザーストーリー

記録前に PII マスクを確認する利用者として、マスク遷移 → 編集 → 送信の往復が実 UI で壊れていないことをリリース前に検証してほしい。なぜならこの往復は unit テストのみでカバーされ、壊れた Send path が黙って ship され得るから（round 6 監査の High gap・round 7 で settle seam を改修した直下のフロー）。

## 優先度

- 順位: 02 / 3
- RICE スコア: 4.0（Reach=1 / Impact=2 / Confidence=80% / Effort=0.4 人週）
- トリガー: round 7 台帳の「e2e 実行可能環境」発火（同上）。
- 根拠（round 8 調査）: PREVIEW_RECORD interception + SAVE_RECORD capture（`window.__saveRecordPayloads`）のパターンは popup-pbi27.fixture.ts が雛形。UI 挙動（modal open / mask counter / selection）は popup page、永続化は dashboard DB の search で別途観測可能。

## BDD 受け入れシナリオ

```gherkin
Scenario: modal が masked content で開く
  Given PREVIEW_RECORD が masked content（mask 2 件）を返す
  When 記録ボタンを押す
  Then #confirmationModal が open になり #previewContent に [MASKED:email] が含まれる
  And #maskNavCounter が 0/2 を示す

Scenario: mask 遷移が counter と selection を動かす
  When #maskNavNext をクリックする
  Then counter が 1/2 になり textarea の selection がマスク span を指す
  When #maskNavPrev をクリックする
  Then counter が戻る

Scenario: confirm が編集内容を SAVE_RECORD に載せる
  Given #previewContent を編集する
  When #confirmPreviewBtn をクリックする
  Then modal が閉じ、capture した SAVE_RECORD payload の content が編集後テキストと一致する
```

## 受け入れ基準

- [x] `testDir/e2e/cleansing-preview-confirm.spec.ts`（@extension・pbi27 形式の fixture 拡張）新設
- [x] 3 シナリオを実装し extension project で green（headless 環境では skip — 実機 green は headed CI で確認）
- [x] PII_CONFIRMATION_UI 設定が preview ON になるよう addInitScript で保証

## テスト戦略

`npx playwright test --config testDir/playwright.config.ts --project=extension testDir/e2e/cleansing-preview-confirm.spec.ts` で実行検証。

## 実装メモ（2026-09-11 autonomous-task-closer）

- fixture（`cleansing-preview.fixture.ts`）に headless ガード欠落を検出・修正: spec コメントは「headless では skip」と主張するが fixture に guard が無く headless で hard-fail する構成だった。`extension.fixture.ts` と同一の tryLaunch + `test.fixme` ガードを追加（headless = skip、headed = 実行）。修正後は 3 skipped（既存 @extension spec と同一挙動）。testDir tsc は新規ファイル 0 errors。
- 全セレクタを実 DOM に対照済み: `#recordBtn` / `#confirmationModal`（dialog）/ `#previewContent`（textarea）/ `#maskNavCounter`・`#maskNavNext`・`#maskNavPrev`（`previewView.ts` DOM_IDS が動的生成）/ `#confirmPreviewBtn`（`entrypoints/popup/index.html`）。
- PBI 記載のプロジェクト名も `extension` に修正（chromium project は @extension を除外する）。
- なぜなぜ: なぜ guard が欠落したのか → pbi27 fixture を雛形にしたが pbi27 自体に guard が無い → spec コメントだけが理想を記述 → 解: 共有パターン（extension.fixture）に寄せ、コメントの主張をコードで成立させる。

## 見積もり

M（0.4 人週）。種別: test。
