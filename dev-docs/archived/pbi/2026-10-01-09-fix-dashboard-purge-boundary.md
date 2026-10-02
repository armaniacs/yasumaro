# PBI: dashboard purge ハンドラのエラー境界追加

## 優先度・backlog 出所・依存

- **優先度**: RICE 36.0（R=6 / I=3 / C=1.0 / Eff=0.5）、backlog 順位 2、NN09
- **出所**: [backlog: holistic-1001](./2026-10-01-00-backlog-holistic-1001.md)
- **依存**: なし。ただし同一ファイル `settingsForm.ts` チェーン（本 PBI → NN21 死んだシーム撤去 → NN22 足場抽出）の起点であり、バッチBの先頭として直列実行する。`generalSettingsPanel.ts` は NN17 / NN20 と同一ファイルのため、本 PBI 完了後は直列
- **種別**: fix

## ユーザーストーリー

ユーザーとして、保持ポリシーの手動削除（今すぐ削除）が失敗したときに失敗理由を画面で見たい。なぜなら、ステータス領域が空のままボタンだけ無言で戻ると、削除が失敗したのか、そもそも走ったのかすら分からないから。

## 背景（現状）

settingsForm の 2 つの purge ハンドラが finally まで書かれて catch を書き忘れた結果、service 呼び出しの拒否が unhandled rejection になり、ステータス領域が空のまま残る。

- `src/dashboard/generalSettings/settingsForm.ts:188-208` — `handlePurgeNow()`: `statusEl`（`#purgeNowStatus`）を :194 でクリア → try で `await purgeOldRecordsNow()`（:196）→ `isServiceError` 分岐で結果表示 → finally で button 再 enable のみ。catch がないため、service 呼び出しが reject すると unhandled rejection になり `statusEl` は空のまま
- `src/dashboard/generalSettings/settingsForm.ts:210-230` — `handleContentPurgeNow()`: 同構造（try :217 / finally :227-229）。`purgeContentNow()` reject 時に `#contentPurgeNowStatus` は :216 でクリアされたまま
- `src/dashboard/panels/staticForm/generalSettingsPanel.ts:330-331` — `#purgeNowBtn` / `#contentPurgeNowBtn` の click に async ハンドラを直接渡しており、ハンドラの reject がそのまま unhandled rejection として漏れる
- 呼び出し先は `dashboardSqliteService` 経由の `ServiceResult`（error を戻り値に持つ、settingsForm.ts:20 で import）だが、gateway 拒否など `ServiceResult` 外の例外は reject として届く。現状その経路に境界がない
- 兄妹ハンドラの統一パターン: `src/dashboard/panels/diagnostic/diagnosticsActions.ts:56` — 「disable button → "Working..." → try/catch → result text → re-enable in finally」。catch で result 要素に失敗テキストを出す（:86-91、:148-153 等）。`src/dashboard/encryptedBackupPanel.ts:60-62` も `setStatus(...errorMessage(error), true)` の同型

## BDDシナリオ

### Scenario: service 拒否時に unhandled rejection にならず失敗メッセージが出る

```gherkin
Given 設定ページが開いており purge ハンドラが wire されている
When `purgeOldRecordsNow()` が reject する
Then unhandled rejection にならず、`#purgeNowStatus` に失敗メッセージが表示される
```

### Scenario: 成功時の表示と button 挙動は現状維持

```gherkin
Given 設定ページが開いている
When 削除が成功する
Then 従来どおり `purgeNowSuccess` の複数形キーで件数が表示され、button は finally で再 enable される
```

### Scenario: content purge も同一の境界を持つ

```gherkin
Given 設定ページが開いている
When `purgeContentNow()` が reject する
Then unhandled rejection にならず、`#contentPurgeNowStatus` に失敗メッセージが表示される
```

## 実装戦略

**It must keep behavior**: 成功系・skip 系（`purgeNowSkipped` / `contentPurgeNowSkipped`）・`isServiceError` 表示は一切変わらない。button の disable → finally で再 enable も現状維持。追加は catch 節とステータス表示のみ。

両ハンドラに catch を追加し、`errorMessage(error)` で `statusEl` に失敗メッセージを表示する（diagnosticsActions と同じパターン）。`generalSettingsPanel.ts` の listen 側にも catch を付与し、async ハンドラの reject が漏れないようにする。

### 受け入れ基準

1. `purgeOldRecordsNow()` / `purgeContentNow()` の拒否時でも unhandled rejection にならない
2. 拒否時に `#purgeNowStatus` / `#contentPurgeNowStatus` に失敗メッセージが表示される
3. button は finally で再 enable される（現状維持）
4. 成功時・skip 時の表示文言と i18n キーは現状のまま
5. `generalSettingsPanel.ts` の listen 側に catch が付与されている
6. 既存テストが green

## テスト戦略

- `src/dashboard/generalSettings/__tests__/settingsForm.test.ts` / `settingsForm.coverage.test.ts` に reject ケースを追加: service モックを reject させ、(1) `statusEl.textContent` が失敗メッセージになる (2) button の `disabled` が false に戻る (3) テスト自身が unhandled rejection を起こさない（Vitest は unhandled rejection を報告する）
- fallback 文言のアサーション: i18n キーが無い環境でも `getMessageOr` の fallback でメッセージが出ることを確認
- 繰り返しゲート: `npx vitest run src/dashboard/generalSettings/__tests__/settingsForm.test.ts --repeats=20` 全回 green
- コミット前ゲート: `npm run validate`

## 実装内容

1. `src/dashboard/generalSettings/settingsForm.ts` — `handlePurgeNow()` に catch を追加し、`statusEl.textContent` に `getMessageOr` で i18n キー + fallback（`errorMessage(error)` 整形）を表示。`handleContentPurgeNow()` に同型の catch を追加。finally の button 再 enable は現状のまま
2. `src/dashboard/panels/staticForm/generalSettingsPanel.ts:330-331` — listen を catch 付きに変更。表示はハンドラ内 catch が所有するため、listen 側は `console.error` の記録口とする防御境界（二重表示を避ける）
3. メッセージ整形は `errorMessage`（`src/utils/errorUtils.ts`）、i18n は `getMessageOr` で fallback を用意

## Definition of Done

- [x] 受け入れ基準 1-6 をすべて満たす
- [x] service 拒否時に unhandled rejection が発生しないテストが存在する
- [x] `npx vitest run src/dashboard/generalSettings/__tests__/settingsForm.test.ts --repeats=20` 全回 green
- [x] `npm run validate` green
- [x] 成功系・skip 系の表示に変更がない（既存アサーションが無変更で green）

## 実装記録（2026-10-02）

### 変更点

- `src/dashboard/generalSettings/settingsForm.ts` — `handlePurgeNow()` と `handleContentPurgeNow()` に catch を追加。`statusEl.textContent` に `errorMessage(error)`（`src/utils/errorUtils.ts`）を代入する形にした。`finally` の button 再 enable・成功/skip/`isServiceError` の各分岐は未変更。
- `src/dashboard/panels/staticForm/generalSettingsPanel.ts` — `#purgeNowBtn` / `#contentPurgeNowBtn` の click を `onPurgeClick(handler)` ラッパ経由に変更。表示はハンドラ内 catch が所有するため、ラッパは `console.error` の記録口に留めた（二重表示を避ける）。
- 受け入れ基準 3・4（finally の再 enable・成功/skip 文言）はいずれも無変更で満たされている。

### 追加・更新したテスト

- `src/dashboard/generalSettings/__tests__/settingsForm.coverage.test.ts` — 2 つの既存テストが旧挙動（`rejects.toThrow('boom')` かつ status 空）をアサートしていたため、新挙動（`resolves.toBeUndefined()` かつ status に `'boom'`）へ書き換えた。あわせて各ハンドラに「非 Error の reject 値を `errorMessage` が文字列化する」ケースを 1 件ずつ追加。これは本 PBI が意図した変更そのもの（拒否が unhandled になる旧挙動を固定していたアサーションを直した）。
- `src/dashboard/panels/staticForm/__tests__/generalSettingsPanel-purge.test.ts`（新規）— click 経由で unhandled rejection が上がらないことを検証。
- `npx vitest run <batch-B の 11 ファイル> --repeats=20` → 11 files / 301 tests 全回 green。

### 逸脱

- **i18n キーを追加していない。** `public/_locales/` が本 PBI の許可ファイル範囲外だったため、失敗表示は既存の `errorMessage(error)` の整形（例外メッセージをそのまま出す）に頼っている。ローカライズされた文言にするなら `purgeNowFailed` / `contentPurgeNowFailed` を `public/_locales/ja/messages.json` と `public/_locales/en/messages.json` の両方に追加する必要がある。別項目として切り出すこと。
- 旧挙動を固定していた既存テスト 2 件（`handlePurgeNow` の `disables button and restores even on error thrown` と `handleContentPurgeNow` の `disables button and restores on throw`）を書き換えた。テスト名も `disables button and renders the rejection instead of escaping it` に変更。これは PBI が意図した変更であり、ハンドラの挙動を巻き戻してはいない。
