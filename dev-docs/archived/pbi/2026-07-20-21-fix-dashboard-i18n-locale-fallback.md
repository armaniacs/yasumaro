# PBI: Dashboard ハードコード日本語の i18n 化とロケールフォールバック修正

元指摘: Checking Team (High: i18n Expert; Medium: UI Expert, Ethics & Bias Auditor)

## 実装状況（完了日: 2026-07-21、状態: ✅ 完了）

## ユーザーストーリー

開発チームとして、Dashboard の「テキスト品質設定」セクションに `data-i18n` を追加し、中国語話者のロケールフォールバックを日本語ではなく英語に変更し、`<title>` を動的に設定したい。なぜなら、現在は英語ユーザーに日本語の固定文字列が表示され、中国語話者に日本語プロンプトが強制されており、プロジェクトの i18n 規約と公平性に反するから。

## ビジネス価値

- 国際化対応の完成度向上
- 多言語ユーザーへの公平なサービス提供
- Chrome Web Store レビュー時の品質向上

## 前提・制約

- `entrypoints/options/index.html:801-835` にハードコードされた日本語ラベル・説明文が存在
- `src/utils/customPromptUtils.ts:81-87` の `resolveLocaleWithFallback` で `zh` → `ja`
- `<title>` は `entrypoints/popup/index.html` と `entrypoints/options/index.html` でハードコード
- `_locales/ja/messages.json` と `_locales/en/messages.json` が存在
- `getMessage()` は `src/utils/i18n.ts` で提供

## BDD受け入れシナリオ

```gherkin
Feature: Dashboard i18n and locale fallback

  Scenario: Text quality settings section uses i18n keys
    Given the dashboard is opened in English
    When the text quality section is rendered
    Then all labels are in English

  Scenario: Chinese users fall back to English
    Given the browser locale is zh-CN
    When the prompt locale is resolved
    Then it returns "en" not "ja"

  Scenario: Page title is localized
    Given the dashboard is opened
    When the locale is Japanese
    Then the document title is "Yasumaro ダッシュボード"
```

## 受け入れ基準

- [ ] `entrypoints/options/index.html:801-835` の全表示文字列に `data-i18n` 属性を追加
- [ ] `public/_locales/ja/messages.json` と `public/_locales/en/messages.json` に対応キーを追加
- [ ] `src/utils/customPromptUtils.ts:84` の `zh` フォールバックを `en` に変更
- [ ] popup/dashboard の `<title>` を JS で `getMessage('popupTitle')` / `getMessage('dashboardTitle')` に動的設定
- [ ] `npm run type-check` / `npm test` が成功

## テスト戦略

### 単体テスト
- `customPromptUtils.test.ts` に `zh` → `en` のテストを追加
- `i18n.test.ts` に新規キーの存在確認

### 統合テスト
- Playwright E2E で Dashboard の言語切り替え時の表示確認

## 実装アプローチ

- **Outside-In**: HTML の `data-i18n` 追加 → messages.json 更新 → `customPromptUtils` 修正 → title 動的化
- title の動的設定は各 entrypoint の `main.ts` で行う

## 見積もり
2pt（HTML i18n + messages.json + locale fallback + title 動的化 + テスト）

## 副作用
🟢 なし — 既存の日本語ユーザーには変更不要。英語/中国語ユーザー向けの改善。

## 落とし穴
- `data-i18n` 追加時に既存のキーと重複しないよう注意（`confirmImport` の重複を参考に）
- `zh` フォールバック変更は、中国語話者にとって日本語プロンプトより英語が適切かどうかの仮定に基づく。将来的にユーザー明示言語設定を検討。

## Definition of Done
- [ ] すべての受け入れ基準を満たす
- [ ] テストが追加されパスする
- [ ] `npm run type-check` / `npm test` が成功
- [ ] コードレビュー完了
