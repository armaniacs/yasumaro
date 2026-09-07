# PBI: dashboard の英語ハードコード文字列を i18n 化（第2弾）

## ユーザーストーリー
日本語環境の利用者として、dashboard の接続テスト・モデル取得ダイアログ・プライバシー表示の文言も日本語で統一してほしい、なぜなら設定画面の一部だけ英語のままだと状態やエラーの意味を読み違えて操作に迷うから

とくにプライバシー表示の「同意済み」状態は現状 i18n キーが未定義で、日本語ロケールでも常に英語（`Consented (...)`）で表示される実バグになっている。

## 優先度
- 順位: 01 / 7（2026-09-07 architecture review round の候補群）
- RICEスコア: 563（Reach=500 / Impact=0.5 / Confidence=0.9 / Effort=0.4人週）
- 根拠: 日本語UIユーザー全員に届く。`consented` キー未定義で常時英語表示になる実バグを含む。i18n カバレッジはリリース必須項目。PBI 2026-09-05-24（第1弾・RICE 500）が「残存の直書き英語は別 PBI 候補」と明示的に繰り越した残作業であり、対象箇所も調査済みで Confidence が高い。

## BDD受け入れシナリオ

```gherkin
Scenario: 日本語ロケールで接続テスト結果が日本語で表示される
  Given ブラウザロケールが日本語の状態
  When  dashboard の一般設定で接続テストを実行する
  Then  テスト対象ラベルと結果メッセージが日本語で表示される

Scenario: 日本語ロケールでモデル取得ダイアログのエラーが日本語で表示される
  Given ブラウザロケールが日本語の状態
  And   API キー未入力などの入力不備がある
  When  モデル取得ダイアログで取得や保存を試みる
  Then  エラー内容が日本語で表示される

Scenario: 同意済みのプライバシー状態が日本語で表示される
  Given ブラウザロケールが日本語の状態
  And   利用者がプライバシー同意済みで同意日が記録されている
  When  dashboard のプライバシー設定パネルを開く
  Then  「同意済み」と同意日が日本語表記で表示される

Scenario: 同意日が未記録でも表示が破綻しない
  Given ブラウザロケールが日本語の状態
  And   プライバシー同意済みだが同意日が記録されていない
  When  dashboard のプライバシー設定パネルを開く
  Then  日付を欠いた自然な日本語表記で「同意済み」が表示される

Scenario: 英語ロケールでは従来の英語表示が維持される
  Given ブラウザロケールが英語の状態
  When  dashboard の該当画面（接続テスト・モデル取得ダイアログ・プライバシー設定）を開く
  Then  対象文字列が英語メッセージとして表示される
```

## 受け入れ基準
- [x] 下記 (a)〜(c) の直書き英語が `getMessage` / `chrome.i18n.getMessage` 経由になる
- [x] `consented` 相当のキー（同意日プレースホルダー付き）が en/ja 双方に新規追加され、同意済み状態が日本語ロケールで日本語表示される
- [x] `public/_locales/en/messages.json` と `public/_locales/ja/messages.json` のキー数が一致し、`npm run check-i18n` が PASS する
- [x] `'No response'` 文字列にハードコード依存している既存テストが新方式に合わせて更新され、`npm run type-check` と dashboard 関連テストがパスする
- [x] `docs/i18n-guide.md` のキー数記載が実態に合わせて更新される
- [x] (d) `cleansingFeedbackView.ts` のテーブル見出しを含めるかの判断が本 PBI 内で結論付けられ、含める場合は同様に i18n 化される

## テスト戦略
- E2E: 日本語ロケールで dashboard を開き、接続テスト実行時のラベル・結果、モデル取得ダイアログのエラー、プライバシー設定パネルの同意済み表示がいずれも日本語であることを確認する（Playwright、`state: 'hidden'` 等の既知の注意点に留意）
- 統合: プライバシー設定パネルのレンダリング関数に「同意済み・同意日あり／なし」の状態を与え、参照メッセージキーと最終表示文字列を検証する
- 単体: `connectionTests.ts` / `models-dev-dialog.ts` の各表示関数をロケール切替下で呼び、対応するメッセージキーが参照されること、`_locales` の en/ja に当該キーが存在することを検証する。`'No response'` 依存テストはキー参照ベースの検証に置き換える

## 実装アプローチ
第1弾（PBI 2026-09-05-24）と同じく、直書きリテラルを `getMessage('新規キー') || '英語フォールバック'` 形式（`connectionTests.ts` 既存パターン）に置き換え、en/ja へ同数のキーを追加する。プレースホルダーを含む文言（同意日）は Chrome i18n の `placeholders` 定義を用いる。製品名（Obsidian / AI）は翻訳対象とせず整形処理のみ i18n 化するか、ラベル書式ごとキー化するかを実装時に決める。スコープは dashboard の通常 UI に限り、`throw new Error(...)` 等の開発者向け例外は対象外とする。

## 見積もり
3ポイント（0.4人週相当：対象は (a)〜(c) の実置換とキー追加、`consented` のプレースホルダー対応、`'No response'` 依存テストの更新、i18n ガイドのキー数更新が中心）

## 実装者向け注記

### このリポジトリの i18n 方式（`docs/i18n-guide.md`）
- Chrome Extension i18n API を使用。メッセージ定義は `public/_locales/{en,ja}/messages.json`（本対応後は各 1324 キー）。日英は完全同期が原則で、`npm run check-i18n` の PASS が必須
- HTML 静的要素: `data-i18n` 属性 + `applyI18n()`
- JS 動的テキスト: `getMessage('key') || '日本語フォールバック'` 形式
- 編集対象は `public/_locales/` のみ（`dist/` は生成物）

### 対象箇所（file:line、テスト除く）

(a) `src/dashboard/generalSettings/connectionTests.ts`
- `:53` ラベル書式 `${label}: `
- `:149` `'Obsidian'` リテラル渡し
- `:84` と `:95` の `message: 'No response'`（2 箇所）
- 依存テスト（文字列 `'No response'` にハードコード依存、i18n 化時に更新必要）: `connectionTests.test.ts:196,203,245,252`、`dashboard.test.ts:636,702`

(b) `src/dashboard/models-dev-dialog.ts` の `showError()` 群（`private showError` は `:493`、`errorEl.textContent = message` で直表示）
- `:291` `'Failed to load providers. Please try again.'`
- `:440` `'Please select a provider'`
- `:452` `'Please enter your API key'`
- `:459` `'Selected provider has an invalid API endpoint'`
- `:486` `'Failed to save settings'`

(c) `src/dashboard/panels/staticForm/privacySettingsPanel.ts:23`
- `chrome.i18n.getMessage('consented') || \`Consented (${state.consentDate || ''})\``
- `consented` キーが en/ja とも未定義（`notConsented` のみ定義済み・`:4100` / `:4090`）
- 日付を含むためプレースホルダー `{date}` 付きキーが必要
- 現状は常にフォールバックの英語が表示される実バグ

(d) 任意・スコープ判断
- `src/dashboard/cleansingFeedbackView.ts:36` の `thead.innerHTML` に Domain / Snippet / Reason / Date / Action の 5 語が直書き
- 対比: `cleansingStatsView.ts:313` は `t('cleansingRule')` 済みで、対比が目立つ

### 対象外
- 開発者向け例外で通常 UI 非表示: `throw new Error('...')` 系（`dashboardSqliteService.ts:202,334,361,382,411,423` 等 9 箇所）
- ただし `models-dev-dialog.ts:280` は `showError` 経由で可視化される可能性があるため要確認

### 制約
- `_locales/en` と `_locales/ja` は完全同期原則。キー追加は両方に同数。`npm run check-i18n` PASS 必須
- `'No response'` 依存テストの同時更新が必要
- `docs/i18n-guide.md` のキー数記載更新を検討
- PRIVACY.md 同期のような副作用はなし（`consented` は文言追加のみ、同意ロジックは不変）
- 編集対象は `public/_locales/` のみ（`dist/` は生成物）

## 未解決事項
1. `throw new Error` 系（開発者向け）はスコープに含めるか。除外が妥当だが `models-dev-dialog.ts:280` は `showError` 経由で可視化されるため個別確認が要る
2. `cleansingFeedbackView.ts:36` のテーブル見出しを本 PBI に含めるか
3. `consented` の文言。`"同意済み（{date}）"` でよいか。`consentDate` 空時のフォーマット（例: `"同意済み"` のみにフォールバックするか）
4. `'Obsidian'` / `'AI'` は製品名なので翻訳不要としラベル整形のみ i18n 化するか、ラベル書式ごとキー化するか

## 実装メモ（実装時に結論付け・2026-09-07）

- 事項1: 結論＝ `throw` 自体は対象外、`showError` 呼び出しのみ i18n 化。`models-dev-dialog.ts:280` の `throw new Error('Failed to load provider data')` は同関数 `loadProviders()` 内で catch され、開発者向けは `console.error`、利用者向けは `showError`（`:291`）に分岐する。利用者に見えるのは `showError` 経由の文言だけなので、`:291` を `modelsDevLoadProvidersError` キー化することで BDD（エラー内容が日本語で表示される）を満たす。`dashboardSqliteService.ts` の 9 箇所は通常 UI 非表示のため対象外のまま。
- 事項2: 結論＝含める。`cleansingStatsView.ts:313` が `t('cleansingRule')` 済みで対比が目立つため。`cleansingFeedbackDomain/Snippet/Reason/Date/Action` の 5 キーを新設し、`thead.innerHTML` 直書きを th 要素組み立て＋ `textContent` に変更（innerHTML 排除の副次効果あり）。タイトル行の ``Cleansing Feedback (${n})`` は本 PBI の (d) スコープ（`:36`）外のため残置し、フォローアップ候補とする。
- 事項3: 結論＝推奨通り。ja `"同意済み（$DATE$）"`／en `"Consented ($DATE$)"` に `placeholders: { date: { content: "$1" } }` を付け、呼び出しは `chrome.i18n.getMessage('consented', [date])`（当該パネルはラッパーでなく `chrome.i18n` を直接使うためネイティブ形式）。`consentDate` 空時は `consentedNoDate`（ja `同意済み`／en `Consented`）を使い、空括弧表示を避ける。
- 事項4: 結論＝製品名は翻訳せずラベル書式のみキー化。`connectionStatusLabel`（`"{label}: "`、`src/utils/i18n.ts` の named substitution `{label}` 対応）を新設し、`createConnectionStatusElement` 内の `` `${label}: ` `` を置換。`'Obsidian'`／`'AI'` リテラル自体は呼び出し側が渡す製品名として残す。
- 新規キー 14（en/ja 同数・同順、追加後 1310 → 1324、`check-i18n` PASS）: `connectionStatusLabel`, `connectionNoResponse`, `modelsDevLoadProvidersError`, `modelsDevSelectProviderError`, `modelsDevApiKeyRequiredError`, `modelsDevInvalidEndpointError`, `modelsDevSaveSettingsError`, `consented`, `consentedNoDate`, `cleansingFeedbackDomain`, `cleansingFeedbackSnippet`, `cleansingFeedbackReason`, `cleansingFeedbackDate`, `cleansingFeedbackAction`
- BDD シナリオと自動テストの対応: 接続テスト日本語表示→ `connectionTests.test.ts`（キー参照・英語フォールバック・ラベル書式の 3 系統）、ダイアログエラー日本語表示→ `models-dev-dialog.test.ts`（5 キー＋フォールバック）、同意済み日本語表示／日付なし破綻なし→ `privacySettingsPanel.test.ts`（`consented`／`consentedNoDate`／`notConsented`／フォールバック）、英語維持→各フォールバックテスト（キー未定義時は従来英語）。E2E（Playwright 実機確認）は未実施のため手動確認項目として残す。
- 5 Whys 分析: `/var/folders/b_/fzr253l50g58s5p7d94nxjmc0000gn/T/kilo/whywhy/pbi13-i18n.md` に保存（worktree 外）。

## Definition of Done
- [x] 全 BDD シナリオが自動テストとして実装されパスする
- [x] `npm run check-i18n` / `npm run type-check` / dashboard 関連テストがすべて PASS
- [ ] コードレビュー完了（未実施のため残す）
- [x] `docs/i18n-guide.md` のキー数記載を更新済み
- [x] 未解決事項 1〜4 が本 PBI 内または実装時に結論付けられ、記録されている
