# PBI: ダッシュボードUIの「Obsidian API Key」フィールド付近にガイドリンクを追加

## ユーザーストーリー

Obsidianとの連携を初めて設定するユーザーとして、ダッシュボードの「Obsidian API Key」フィールドの近くに設定ガイドへのリンクがほしい、なぜなら APIキーをどこから取得するか分からず詰まるユーザーが、画面を離れずにガイドへ辿り着ける動線が必要だからだ。

## ビジネス価値

- 初期設定の離脱率低下（画面を離れてドキュメントを探すコストの削減）
- サポート問合せ削減（「APIキーはどこで取得できますか?」への予防的対応）

## 依存関係

**PBI 01（Obsidian連携ガイドドキュメント作成）が完了・マージ済みであることが前提条件。**
PBI 01未完了の状態でこのPBIをマージしないこと（存在しないURLへのリンクが製品UIに入り込む）。

## BDD受け入れシナリオ

```gherkin
Scenario: 初めてAPIキーを入力しようとするユーザーがガイドへ進める
  Given ユーザーがダッシュボードの「初期設定」パネルを開いている
  And 「Obsidian を使う」チェックボックスがオンである
  When ユーザーが「Obsidian API Key」ラベル付近に目を向ける
  Then ガイドへのリンク（"Obsidian設定ガイドを見る（新しいタブで開きます）"）が表示されている
  And リンクをクリックすると新しいタブでガイドドキュメントが開く

Scenario: 英語ロケールでも同じリンクが表示される
  Given ブラウザのロケールが英語である
  When ユーザーが「Obsidian API Key」フィールドを表示する
  Then リンクテキストが英語（"View Obsidian Setup Guide (opens in new tab)"）で表示される

Scenario: Obsidianが無効化されている場合はリンクも非表示
  Given 「Obsidian を使う」チェックボックスがオフである
  When ダッシュボードを表示する
  Then 「Obsidian API Key」フィールドが非表示であり
  And ガイドリンクも表示されない（同一 form-group 内に配置されているため）
```

## 受け入れ基準

- [ ] `entrypoints/options/index.html` の `#apiKey` フォームグループ（`<div class="form-group">` 内）にガイドリンクを追加する
  - **DOM配置**: `<input id="apiKey">` の直後、同一 `.form-group` 内に配置すること（既存のObsidian無効時の表示制御に自動的に含まれる）
- [ ] リンクは `target="_blank" rel="noopener noreferrer"` で別タブで開く
- [ ] リンクテキストは `data-i18n` 属性でローカライズ対応する
  - 日本語: `Obsidian設定ガイドを見る（新しいタブで開きます）`
  - 英語: `View Obsidian Setup Guide (opens in new tab)`
  - ※「設定方法はこちら →」ではなく、リンク先が何か・新タブで開くことが分かるテキストにする
- [ ] `aria-label` は不要（リンクテキスト自体にコンテキストが含まれているため）
- [ ] `public/_locales/ja/messages.json` と `public/_locales/en/messages.json` に i18n キーを追加する
  - キー名: `obsidianSetupGuideLink`
  - **追加前に既存キー確認**: `grep "obsidian" public/_locales/ja/messages.json` で重複がないことを確認すること
- [ ] Obsidian無効時（チェックボックスオフ）にリンクが非表示になること（`.form-group` 内配置により既存制御で対応）
- [ ] 既存テスト `src/dashboard/__tests__/dashboard-obsidian-enabled.test.ts` のモックHTMLに新規リンク要素を追加し、以下のテストケースを追加する

## テスト戦略

### 単体テスト（既存テストの拡張）

`src/dashboard/__tests__/dashboard-obsidian-enabled.test.ts` を以下のように更新：

```typescript
// 1. モックHTML更新 — テスト内の document.body.innerHTML に以下を追加
// <div class="form-group">
//   <label for="apiKey">Obsidian API Key</label>
//   <input type="password" id="apiKey">
//   <div class="help-text">
//     <a id="obsidianSetupGuideLink" href="..." target="_blank">設定ガイド</a>
//   </div>
// </div>

// 2. 追加するテストケース
it('Obsidian有効時にガイドリンクが表示されていること', () => {
  const link = document.querySelector('#apiKey')?.closest('.form-group')?.querySelector('a');
  expect(link).not.toBeNull();
});

it('Obsidian無効時にAPIキーform-groupが非表示になること', () => {
  // obsidianEnabled チェックボックスをオフにする操作後
  const formGroup = document.querySelector('#apiKey')?.closest('.form-group');
  expect(formGroup).toHaveStyle('display: none'); // 既存制御に依存
});
```

### 手動テスト

- [ ] `npm run build && npx wxt` でダッシュボードを開き、「Obsidian API Key」付近にリンクが表示されること
- [ ] クリックで新しいタブが開き、正しいURLに遷移すること（PBI 01完了後にURLを確定させること）
- [ ] 英語ロケール（Chrome設定→言語→英語）時にリンクテキストが英語になること
- [ ] 「Obsidian を使う」チェックボックスをオフにしてリンクが見えなくなること

## 実装アプローチ

### 1. HTMLの変更（`entrypoints/options/index.html`）

現在の181〜184行付近を以下に置き換える：

```html
<div class="form-group">
  <label for="apiKey" data-i18n="obsidianApiKey">Obsidian API Key</label>
  <input type="password" id="apiKey" data-i18n-input-placeholder="apiKeyPlaceholder">
  <div class="help-text">
    <a href="https://github.com/armaniacs/yasumaro/blob/main/docs/OBSIDIAN_SETUP_GUIDE.md"
       target="_blank"
       rel="noopener noreferrer"
       data-i18n="obsidianSetupGuideLink">Obsidian設定ガイドを見る（新しいタブで開きます）</a>
  </div>
</div>
```

**注意**: リンクURLは `https://github.com/armaniacs/yasumaro/blob/main/docs/OBSIDIAN_SETUP_GUIDE.md` を使用する（PBI 01完了後、ファイルが存在することを確認してからマージすること）。

### 2. i18nキーの追加

**`public/_locales/ja/messages.json`**（追加前に `grep "obsidianSetupGuide" public/_locales/ja/messages.json` で重複がないことを確認）
```json
"obsidianSetupGuideLink": {
  "message": "Obsidian設定ガイドを見る（新しいタブで開きます）"
}
```

**`public/_locales/en/messages.json`**（同様に重複確認）
```json
"obsidianSetupGuideLink": {
  "message": "View Obsidian Setup Guide (opens in new tab)"
}
```

### 3. 表示制御の確認

`entrypoints/options/index.html` を確認し、`obsidianEnabled` チェックボックスのON/OFFで `#apiKey` の `.form-group` が表示/非表示になるロジックが `dashboard.ts` に存在することを確認する。

```bash
# 確認コマンド
grep -n "obsidianEnabled\|apiKey\|form-group" src/dashboard/dashboard.ts | head -20
```

ガイドリンクは `#apiKey` と同じ `.form-group` 内に配置するため、既存ロジックで自動的に制御される。

## 見積もり

1pt（HTML変更 + i18n追加 + 既存テスト拡張）

## 技術的考慮事項

- **依存関係**: PBI 01（ガイドドキュメント作成）が完了・マージ済みであること。未完了状態でマージ禁止
- **リンクURL**: `https://github.com/armaniacs/yasumaro/blob/main/docs/OBSIDIAN_SETUP_GUIDE.md` を使用（GitHub blob URLは安定しているが、リポジトリ移転時は更新が必要）
- **GeminiのAPIキー作成リンク参考**: 233行付近の `apiKeyCreateLink` パターンに倣う
- **data-i18n属性の動作確認**: `entrypoints/options/i18n.ts` でリンク要素の `textContent` が上書きされる実装かを事前確認すること

## 実装者向け注記

### 現状コードの確認

```bash
# APIキーフィールド周辺のHTML確認
grep -n "apiKey\|obsidianApiKey" entrypoints/options/index.html

# 既存のリンク例（GeminiのAPIキー作成リンク）を参照
grep -n "apiKeyCreateLink" entrypoints/options/index.html

# Obsidian有効/無効制御のロジック確認
grep -n "obsidianEnabled\|apiKey" src/dashboard/dashboard.ts | head -20

# i18nキーの重複確認（追加前に必ず実行）
grep "obsidianSetupGuide" public/_locales/ja/messages.json
grep "obsidianSetupGuide" public/_locales/en/messages.json
```

### 落とし穴
- `data-i18n` 属性はリンク要素に使うと `textContent` が上書きされるため、リンクのhref属性には影響しない（i18n.tsの処理を確認）
- リンクが `.form-group` 外に配置されると、Obsidian無効時に常時表示されてしまう。必ず `#apiKey` と同じ `.form-group` 内に配置すること
- テストのモックHTMLを更新しないと `TypeError` が発生する可能性あり（L2指摘）

## Definition of Done

- [ ] **PBI 01が完了・マージ済みであること**（前提条件）
- [ ] `entrypoints/options/index.html` にリンクが追加されている（`.form-group` 内の正しい位置）
- [ ] リンクテキストが「リンク先が何か・新タブで開く」ことを明示した内容になっている
- [ ] i18nキー `obsidianSetupGuideLink`（日英）が両ロケールファイルに追加されている
- [ ] 既存キーとの重複がないことを grep で確認済み
- [ ] `src/dashboard/__tests__/dashboard-obsidian-enabled.test.ts` のモックHTMLが更新されており、リンク表示テストが追加・パスしている
- [ ] `npm validate` （型チェック + テスト）がパスしている
- [ ] 手動テストでリンクの表示・非表示・クリック動作を確認済み
- [ ] コードレビュー完了
