# コントリビューションガイド / Contributing Guide

[日本語](#日本語) | [English](#english)

---

## 日本語

### 概要

Obsidian Smart Historyへのコントリビューションに感謝します。このガイドでは、開発環境のセットアップ、コーディング規約、テスト手順、プルリクエストのフローについて説明します。

### 開発環境のセットアップ

#### 前提条件

- Node.js (LTS推奨)
- Chromeブラウザ (またはChromium派生ブラウザ)
- Git

#### 手順

1. プロジェクトをクローン
```bash
git clone https://github.com/your-username/obsidian-smart-history.git
cd obsidian-smart-history
```

2. 依存関係をインストール
```bash
npm install
```

3. テスト環境の確認
```bash
npm test
```

### テスト

#### テストの実行

```bash
npm test              # 全テスト実行
npm run test:watch    # ウォッチモードでの実行
npm run test:coverage # カバレッジレポート付き実行
```

#### テストの追加

新しいテストは、対応するソースファイルと同じディレクトリの`__tests__`サブディレクトリに配置してください。

```
src/
  popup/
    utils/
      focusTrap.js
      __tests__/
        focusTrap.test.js
```

#### テストの命名規則

- テストファイル: `{filename}.test.js`
- テストスイート: 関数名やモジュール名を記述
- 個別テスト: テスト内容を簡潔に記述（日本語可）

```javascript
describe('FocusTrapManager', () => {
  describe('trap', () => {
    test('ESCキーで閉じる', () => {
      // test implementation
    });
  });
});
```

### コーディング規約

#### JavaScript/ES Modules

- ES6+のみを使用（CommonJSは避ける）
- アロー関数、const/let、テンプレートリテラルを使用
- インポート順: ライブラリ → ローカルモジュール

```javascript
// Good
import { getMessage } from '../utils/i18n.js';
import { focusTrapManager } from './utils/focusTrap.js';
```

#### 命名規則

- クラス: PascalCase (e.g., `FocusTrapManager`)
- 関数・変数: camelCase (e.g., `loadDomainSettings`)
- 定数: UPPER_SNAKE_CASE (e.g., `StorageKeys`)
- プライベート: 先頭にアンダースコア (e.g., `_internalHandler`)

#### アクセシビリティ

WCAG 2.1 Level AA準拠を目指してください：

- フォーム要素には`aria-label`またはラベルを付与
- アイコンボタンには`aria-label`を付与
- 動的コンテンツには`aria-live="polite"`を使用
- キーボードナビゲーションをサポート

```html
<button class="icon-btn"
        aria-label="設定"
        data-i18n-aria-label="settings">
  ⚙
</button>
```

#### i18n（国際化）

- すべてのユーザー向けテキストはi18n化
- data属性を使用: `data-i18n`, `data-i18n-aria-label`, `data-i18n-input-placeholder`

```html
<!-- Good -->
<div data-i18n="dropFileHere">Drop file here</div>
<input data-i18n-input-placeholder="apiKeyPlaceholder">
<button data-i18n-aria-label="closeModal">×</button>

<!-- Bad -->
<div>Drop file here</div>
```

### プロジェクト構造

```
obsidian-smart-history/
├── src/
│   ├── background/    # Service Worker
│   ├── content/       # Content Scripts
│   ├── popup/         # Popup UI
│   └── utils/         # 共通ユーティリティ
├── _locales/          # 翻訳キー
│   ├── en/
│   │   └── messages.json
│   └── ja/
│       └── messages.json
├── docs/              # ドキュメント
├── manifest.json      # Chrome拡張機能マニフェスト
└── package.json       # npm設定
```

### プルリクエストのフロー

1. ブランチの作成
```bash
git checkout -b feature/your-feature-name
```

2. 変更をコミット
```bash
git add .
git commit -m "feat: 功能の説明"
```

3. テストを実行
```bash
npm test
```

4. プッシュ
```bash
git push origin feature/your-feature-name
```

5. プルリクエストを作成

#### コミットメッセージ規約

Conventional Commitsに従ってください：

```
<type>(<scope>): <subject>

<body>

<footer>
```

- type: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`
- subject: 簡潔な説明（50文字以内）
- body: 詳細な説明（必要な場合）

例：
```
feat(domainFilter): uBlock形式のフィルターインポート機能

- ファイルからの読み込み
- URLからのインポート
- ドラッグ＆ドロップ対応
```

### コードレビュー

レビューの時は以下を確認してください：

- [ ] テストが通っている (`npm test`)
- [ ] 新しいコードにテストが含まれている
- [ ] i18nが適切に実装されている
- [ ] アクセシビリティ要件を満たしている
- [ ] ドキュメントが更新されている

### バグ報告と機能リクエスト

バグ報告や機能リクエストはGitHub Issuesを使用してください。

バグ報告には以下を含めてください：
- 再現手順
- 期待される挙動
- 実際の挙動
- スクリーンショット（可能であれば）
- 使用環境（ブラウザバージョンなど）

---

## English

### Overview

Thank you for contributing to Obsidian Smart History. This guide covers development environment setup, coding conventions, testing procedures, and pull request workflows.

### Development Environment Setup

#### Prerequisites

- Node.js (LTS recommended)
- Chrome browser (or Chromium-based browser)
- Git

#### Steps

1. Clone the repository
```bash
git clone https://github.com/your-username/obsidian-smart-history.git
cd obsidian-smart-history
```

2. Install dependencies
```bash
npm install
```

3. Verify test environment
```bash
npm test
```

### Testing

#### Running Tests

```bash
npm test              # Run all tests
npm run test:watch    # Run in watch mode
npm run test:coverage # Run with coverage report
```

#### Adding Tests

Place new tests in a `__tests__` subdirectory alongside the corresponding source file.

```
src/
  popup/
    utils/
      focusTrap.js
      __tests__/
        focusTrap.test.js
```

#### Test Naming Conventions

- Test files: `{filename}.test.js`
- Test suites: Describe function or module name
- Individual tests: Describe test content briefly

```javascript
describe('FocusTrapManager', () => {
  describe('trap', () => {
    test('closes on ESC key', () => {
      // test implementation
    });
  });
});
```

### Coding Standards

#### JavaScript/ES Modules

- Use ES6+ only (avoid CommonJS)
- Use arrow functions, const/let, template literals
- Import order: Libraries → Local modules

```javascript
// Good
import { getMessage } from '../utils/i18n.js';
import { focusTrapManager } from './utils/focusTrap.js';
```

#### Naming Conventions

- Classes: PascalCase (e.g., `FocusTrapManager`)
- Functions/Variables: camelCase (e.g., `loadDomainSettings`)
- Constants: UPPER_SNAKE_CASE (e.g., `StorageKeys`)
- Private: Prefix with underscore (e.g., `_internalHandler`)

#### Accessibility

Aim for WCAG 2.1 Level AA compliance:

- Use `aria-label` or labels for form elements
- Add `aria-label` for icon-only buttons
- Use `aria-live="polite"` for dynamic content
- Support keyboard navigation

```html
<button class="icon-btn"
        aria-label="Settings"
        data-i18n-aria-label="settings">
  ⚙
</button>
```

#### i18n (Internationalization)

- Internationalize all user-facing text
- Use data attributes: `data-i18n`, `data-i18n-aria-label`, `data-i18n-input-placeholder`

```html
<!-- Good -->
<div data-i18n="dropFileHere">Drop file here</div>
<input data-i18n-input-placeholder="apiKeyPlaceholder">
<button data-i18n-aria-label="closeModal">×</button>

<!-- Bad -->
<div>Drop file here</div>
```

### Project Structure

```
obsidian-smart-history/
├── src/
│   ├── background/    # Service Worker
│   ├── content/       # Content Scripts
│   ├── popup/         # Popup UI
│   └── utils/         # Shared Utilities
├── _locales/          # Translation keys
│   ├── en/
│   │   └── messages.json
│   └── ja/
│       └── messages.json
├── docs/              # Documentation
├── manifest.json      # Chrome extension manifest
└── package.json       # npm configuration
```

### Pull Request Workflow

1. Create a branch
```bash
git checkout -b feature/your-feature-name
```

2. Commit changes
```bash
git add .
git commit -m "feat: description of feature"
```

3. Run tests
```bash
npm test
```

4. Push
```bash
git push origin feature/your-feature-name
```

5. Create a pull request

#### Commit Message Convention

Follow Conventional Commits:

```
<type>(<scope>): <subject>

<body>

<footer>
```

- type: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`
- subject: Concise description (under 50 characters)
- body: Detailed description (when needed)

Example:
```
feat(domainFilter): uBlock format filter import feature

- Import from file
- Import from URL
- Drag and drop support
```

### Code Review Checklist

When reviewing code, check for:

- [ ] Tests pass (`npm test`)
- [ ] New code includes tests
- [ ] i18n is properly implemented
- [ ] Accessibility requirements are met
- [ ] Documentation is updated

### Bug Reports and Feature Requests

Use GitHub Issues for bug reports and feature requests.

Include for bug reports:
- Steps to reproduce
- Expected behavior
- Actual behavior
- Screenshots (if possible)
- Environment details (browser version, etc.)