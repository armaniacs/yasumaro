# i18n ガイド / i18n Guide

[日本語](#日本語) | [English](#english)

---

## 日本語

### 概要

Obsidian Weaveは、Chrome Extensionのi18n APIを使用した多言語対応アーキテクチャを採用しています。本ガイドでは、翻訳キーの命名規則、データ属性の使い方、新しい翻訳の追加手順について説明します。

### サポートされる言語

| 言語コード | ロケールファイル | ステータス |
|-----------|----------------|----------|
| `ja` | `_locales/ja/messages.json` | ✅ 100% (162キー) |
| `en` | `_locales/en/messages.json` | ✅ 100% (162キー) |

### アーキテクチャ

#### ファイル構造

```
_locales/
├── en/
│   └── messages.json    # 英語翻訳
└── ja/
    └── messages.json    # 日本語翻訳
src/popup/
├── i18n.js              # i18nヘルパー関数
└── utils/
    └── localeUtils.js   # ロケール関連ユーティリティ
```

#### i18n.jsの役割

i18n.jsは、HTML上の`data-*`属性に基づいて自動的に翻訳を適用します。

主要エクスポート:
- `getMessage(key, substitutions)` - 翻訳文字列を取得
- `applyI18n(element)` - 指定要素以下の翻訳を適用
- `translatePageTitle(key)` - ページタイトルを翻訳
- `getUserLocale()` - 現在のロケールを取得

### 翻訳キーの命名規則

#### 基本規則

1. **camelCase**: 使用する（例: `domainList`, `errorPrefix`）
2. **シンプルかつ記述的**: 文脈が明確になる名前
3. **接頭辞によるグループ化**: カテゴリごとに接頭辞を使用

#### 例

| カテゴリ | 例 | 説明 |
|---------|-----|------|
| 基本 | `save`, `cancel`, `close` | 操作系基本単語 |
| フィルター | `filterDisabled`, `filterWhitelist`, `filterBlacklist` | ドメインフィルター関連 |
| ドメイン | `domainList`, `addCurrentDomain` | ドメイン操作 |
| uBlock | `ublockFilter`, `ublockHelp` | uBlock機能 |
| エラー | `errorPrefix`, `saveError`, `connectionError` | エラーメッセージ |
| ステータス | `testingConnection`, `successConnected` | 進捗・結果メッセージ |

#### プレースホルダー

変数を含む翻訳にはプレースホルダーを使用します：

```json
{
  "domainAdded": {
    "message": "ドメイン \"{domain}\" を追加しました",
    "description": "ドメイン追加成功メッセージ"
  },
  "ruleCount": {
    "message": "{count}件のルール",
    "description": "ルール数表示"
  }
}
```

- プレースホルダーは `{variableName}` 形式
- 変数名はcamelCase

### HTMLでのi18n

#### 基本的なテキスト

`data-i18n`属性を使用：

```html
<div data-i18n="dropFileHere">Drop file here</div>
<p data-i18n="noSourcesRegistered">No sources registered</p>
```

#### 入力フィールドのプレースホルダー

`data-i18n-input-placeholder`属性を使用：

```html
<input type="text"
       data-i18n-input-placeholder="apiKeyPlaceholder">
<textarea rows="8"
          data-i18n-input-placeholder="domainListPlaceholder"></textarea>
```

#### ARIAラベル（アクセシビリティ）

`data-i18n-aria-label`属性を使用：

```html
<button class="icon-btn"
        data-i18n-aria-label="closeModal">×</button>
<div id="uBlockDropZone"
     class="drop-zone"
     role="region"
     data-i18n-aria-label="dropZoneLabel">
</div>
```

#### プレースホルダー付き

`data-i18n-args`属性でJSON形式で値を渡します：

```html
<p data-i18n="domainAdded"
   data-i18n-args='{"domain": "example.com"}'>
  Domain "example.com" added
</p>
```

#### オプション要素（selectタグ内）

`data-i18n-opt`属性を使用：

```html
<select id="aiProvider">
  <option value="gemini"
          data-i18n-opt="googleGemini">Google Gemini</option>
  <option value="openai"
          data-i18n-opt="openaiCompatible">OpenAI Compatible</option>
  <option value="openai2"
          data-i18n-opt="openaiCompatible2">OpenAI Compatible 2</option>
</select>
```

#### ボタンラベル（主に使用方法）

`data-i18n-label`属性を使用：

```html
<button id="recordBtn"
        class="primary-btn"
        data-i18n-label="recordNow">
  📝 Record Now
</button>
```

#### ヘルプテキスト

クラス`.help-text`を持ち`data-i18n`属性を持つ要素：

```html
<div class="help-text"
     data-i18n="filterDisabledDesc">
  Record all visited websites regardless of domain.
</div>
```

### 新しい翻訳の追加手順

1. **翻訳キーを選択** - 命名規則を考慮
2. **messages.jsonに追加** - すべての言語ファイルに追加
3. **HTMLに属性を追加** - 適切な`data-*`属性を使用
4. **テスト** - 両言語で表示を確認

#### 例: 新しいボタンを追加

**1. messages.json追加**

`_locales/en/messages.json`:
```json
{
  "newFeature": {
    "message": "New Feature",
    "description": "新しい機能のボタンラベル"
  }
}
```

`_locales/ja/messages.json`:
```json
{
  "newFeature": {
    "message": "新しい機能",
    "description": "新機能のボタンラベル"
  }
}
```

**2. HTMLに追加**

```html
<button class="secondary-btn"
        data-i18n="newFeature">
  New Feature
</button>
```

### テスト方法

#### 手動テスト

1. ブラウザで拡張機能を読み込む
2. Language Settingsで言語を変更
3. 各UI要素の翻訳を確認

#### 自動テスト

```javascript
// 使用例
import { getMessage } from '../utils/i18n.js';

test('翻訳取得', () => {
  // プレースホルダーなし
  expect(getMessage('save')).toBe('保存');

  // プレースホルダーあり
  expect(getMessage('domainAdded', { domain: 'example.com' }))
    .toBe('ドメイン "example.com" を追加しました');
});
```

### 既知の問題と制限

1. **実行時の言語切り替え**: Chrome拡張機能の言語は、Chromeの言語設定を変更して拡張機能を再読み込みすることでのみ変更可能

2. **動的コンテンツ**: `applyI18n()`関数を使用して、動的に追加された要素に翻訳を適用する必要があります

   ```javascript
   // 新しい要素を追加した後
   document.body.appendChild(newElement);
   applyI18n(newElement);
   ```

3. **複数のプレースホルダー**: メッセージ内に複数のプレースホルダーがある場合、正しく順序を維持してください

### トラブルシューティング

| 問題 | 原因 | 解決策 |
|------|------|--------|
| 翻訳が表示されない | キー名のタイプミス/Messages.jsonに未登録 | キー名を確認しmessages.jsonに追加 |
| プレースホルダーが置換されない | `data-i18n-args`を省略/JSONエラー | 正しいJSON形式で値を渡す |
| ARIAラベルが翻訳されない | `data-i18n-aria-label`未使用 | 適切な属性を使用 |

---

## English

### Overview

Obsidian Weave uses a multi-language architecture based on Chrome Extension i18n API. This guide covers translation key naming conventions, data attribute usage, and procedures for adding new translations.

### Supported Languages

| Language Code | Locale File | Status |
|---------------|-------------|--------|
| `ja` | `_locales/ja/messages.json` | ✅ 100% (162 keys) |
| `en` | `_locales/en/messages.json` | ✅ 100% (162 keys) |

### Architecture

#### File Structure

```
_locales/
├── en/
│   └── messages.json    # English translations
└── ja/
    └── messages.json    # Japanese translations
src/popup/
├── i18n.js              # i18n helper functions
└── utils/
    └── localeUtils.js   # Locale utilities
```

#### Role of i18n.js

i18n.js automatically applies translations based on `data-*` attributes in HTML.

Key exports:
- `getMessage(key, substitutions)` - Get translation string
- `applyI18n(element)` - Apply translations under specified element
- `translatePageTitle(key)` - Translate page title
- `getUserLocale()` - Get current locale

### Translation Key Naming Conventions

#### Basic Rules

1. **camelCase**: Use (e.g., `domainList`, `errorPrefix`)
2. **Simple and descriptive**: Names should clearly indicate context
3. **Prefix grouping**: Use prefixes for categories

#### Examples

| Category | Example | Description |
|----------|---------|-------------|
| Basic | `save`, `cancel`, `close` | Basic operation words |
| Filter | `filterDisabled`, `filterWhitelist`, `filterBlacklist` | Domain filter related |
| Domain | `domainList`, `addCurrentDomain` | Domain operations |
| uBlock | `ublockFilter`, `ublockHelp` | uBlock features |
| Error | `errorPrefix`, `saveError`, `connectionError` | Error messages |
| Status | `testingConnection`, `successConnected` | Progress/result messages |

#### Placeholders

For translations with variables, use placeholders:

```json
{
  "domainAdded": {
    "message": "Added domain \"{domain}\"",
    "description": "Domain added success message"
  },
  "ruleCount": {
    "message": "{count} rules",
    "description": "Rule count display"
  }
}
```

- Placeholders use `{variableName}` format
- Variable names use camelCase

### i18n in HTML

#### Basic Text

Use `data-i18n` attribute:

```html
<div data-i18n="dropFileHere">Drop file here</div>
<p data-i18n="noSourcesRegistered">No sources registered</p>
```

#### Input Field Placeholders

Use `data-i18n-input-placeholder` attribute:

```html
<input type="text"
       data-i18n-input-placeholder="apiKeyPlaceholder">
<textarea rows="8"
          data-i18n-input-placeholder="domainListPlaceholder"></textarea>
```

#### ARIA Labels (Accessibility)

Use `data-i18n-aria-label` attribute:

```html
<button class="icon-btn"
        data-i18n-aria-label="closeModal">×</button>
<div id="uBlockDropZone"
     class="drop-zone"
     role="region"
     data-i18n-aria-label="dropZoneLabel">
</div>
```

#### With Placeholders

Pass values in JSON format using `data-i18n-args` attribute:

```html
<p data-i18n="domainAdded"
   data-i18n-args='{"domain": "example.com"}'>
  Domain "example.com" added
</p>
```

#### Option Elements (Inside select tags)

Use `data-i18n-opt` attribute:

```html
<select id="aiProvider">
  <option value="gemini"
          data-i18n-opt="googleGemini">Google Gemini</option>
  <option value="openai"
          data-i18n-opt="openaiCompatible">OpenAI Compatible</option>
  <option value="openai2"
          data-i18n-opt="openaiCompatible2">OpenAI Compatible 2</option>
</select>
```

#### Button Labels

Use `data-i18n-label` attribute:

```html
<button id="recordBtn"
        class="primary-btn"
        data-i18n-label="recordNow">
  📝 Record Now
</button>
```

#### Help Text

Elements with class `.help-text` and `data-i18n` attribute:

```html
<div class="help-text"
     data-i18n="filterDisabledDesc">
  Record all visited websites regardless of domain.
</div>
```

### Adding New Translations

1. **Select translation key** - Follow naming conventions
2. **Add to messages.json** - Add to all language files
3. **Add attribute to HTML** - Use appropriate `data-*` attribute
4. **Test** - Verify display in both languages

#### Example: Adding a New Button

**1. Add to messages.json**

`_locales/en/messages.json`:
```json
{
  "newFeature": {
    "message": "New Feature",
    "description": "Button label for new feature"
  }
}
```

`_locales/ja/messages.json`:
```json
{
  "newFeature": {
    "message": "新しい機能",
    "description": "新機能のボタンラベル"
  }
}
```

**2. Add to HTML**

```html
<button class="secondary-btn"
        data-i18n="newFeature">
  New Feature
</button>
```

### Testing Methods

#### Manual Testing

1. Load extension in browser
2. Change language in Language Settings
3. Verify each UI element's translation

#### Automated Testing

```javascript
// Example usage
import { getMessage } from '../utils/i18n.js';

test('get translation', () => {
  // Without placeholders
  expect(getMessage('save')).toBe('保存');

  // With placeholders
  expect(getMessage('domainAdded', { domain: 'example.com' }))
    .toBe('ドメイン "example.com" を追加しました');
});
```

### Known Issues and Limitations

1. **Runtime language switching**: Chrome extension language can only be changed by changing Chrome's language setting and reloading the extension

2. **Dynamic content**: After adding new elements dynamically, use `applyI18n()` function to apply translations

   ```javascript
   // After adding new element
   document.body.appendChild(newElement);
   applyI18n(newElement);
   ```

3. **Multiple placeholders**: When a message contains multiple placeholders, ensure correct order is maintained

### Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| Translation not displayed | Typo in key name/Not registered in messages.json | Check key name and add to messages.json |
| Placeholder not replaced | Missing `data-i18n-args`/JSON error | Pass values in correct JSON format |
| ARIA label not translated | Missing `data-i18n-aria-label` | Use appropriate attribute |