# 翻訳同期ガイド / Translation Sync Guide

`docs/index.html` は GitHub Pages 用の静的ページであり、Chrome 拡張の `public/_locales/*/messages.json` とは別に `TRANSLATIONS` オブジェクトを保持しています。

`docs/index.html` の `TRANSLATIONS` オブジェクトは `scripts/sync-docs-translations.mjs` によって生成・更新されます。

## 使い方

```bash
npm run build:docs-i18n
```

このコマンドは以下を行います。

1. `public/_locales/ja/messages.json` と `en/messages.json` を読み込む
2. `scripts/translation-key-map.json` に基づいて `messages.json` の値を `TRANSLATIONS` に反映
3. `docs/index.html` を上書き保存

## キーマッピング

`scripts/translation-key-map.json` に、以下の形式でマッピングを追加します。

```json
{
  "ja": {
    "messagesJsonKey": "docsTranslationsKey"
  },
  "en": {
    "messagesJsonKey": "docsTranslationsKey"
  }
}
```

マッピングに含まれるキーのみが自動同期の対象になります。 docs 固有の翻訳は `docs/index.html` 内の `TRANSLATIONS` オブジェクトを直接編集してください。編集後は `npm run build:docs-i18n` を再実行すると、messages.json の変更が反映されます。

## リリース手順

リリース前には必ず以下を実行してください。

```bash
npm run build:docs-i18n
```

生成された `docs/index.html` の差分を確認し、意図しない変更がないことを確認してからコミットします。

---

`docs/index.html` is a static page for GitHub Pages and keeps its own `TRANSLATIONS` object, separate from the Chrome extension's `public/_locales/*/messages.json`.

The `TRANSLATIONS` object in `docs/index.html` is generated and updated by `scripts/sync-docs-translations.mjs`.

## Usage

```bash
npm run build:docs-i18n
```

This command does the following:

1. Reads `public/_locales/ja/messages.json` and `en/messages.json`
2. Applies values from `messages.json` to `TRANSLATIONS` based on `scripts/translation-key-map.json`
3. Overwrites `docs/index.html`

## Key Mapping

Add mappings to `scripts/translation-key-map.json` in the following format:

```json
{
  "ja": {
    "messagesJsonKey": "docsTranslationsKey"
  },
  "en": {
    "messagesJsonKey": "docsTranslationsKey"
  }
}
```

Only keys listed in the mapping are synced automatically. Docs-specific translations should be edited directly in the `TRANSLATIONS` object inside `docs/index.html`. After editing, run `npm run build:docs-i18n` again to re-apply changes from `messages.json`.

## Release Procedure

Before each release, run:

```bash
npm run build:docs-i18n
```

Review the resulting diff in `docs/index.html` and commit once you have confirmed there are no unintended changes.
