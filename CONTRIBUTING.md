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
npm test              # 全テスト実行（Jest）
npm run test:watch    # ウォッチモードでの実行（Jest）
npm run test:coverage # カバレッジレポート付き実行（Jest）
npm run test:e2e      # E2Eテスト実行（Playwright）
npm run test:e2e:ui   # E2EテストUIモード（Playwright）
npm run test:e2e:debug # E2Eテストデバッグモード（Playwright）
npm run test:e2e:headed # E2Eテストヘッドフルモード（Playwright）
```

#### テストの種類

このプロジェクトでは2種類のテストを使用しています：

1. **Jest テスト**: ユニットテスト、統合テスト
   - 位置: `src/**/__tests__/`
   - 用途: 個別の関数、クラス、モジュールのテスト

2. **Playwright テスト**: E2E（エンドツーエンド）テスト
   - 位置: `e2e/`
   - 用途: 拡張機能のポップアップUI、コンテンツスクリプトの統合テスト

#### テストの追加

**Jest テスト**:
新しいテストは、対応するソースファイルと同じディレクトリの`__tests__`サブディレクトリに配置してください。

```
src/
  popup/
    utils/
      focusTrap.js
      __tests__/
        focusTrap.test.js
```

**Playwright テスト**:
E2Eテストは `e2e/` ディレクトリに配置してください。

```
e2e/
  extension.spec.ts
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

### セキュリティとAIプロバイダーの追加

この拡張機能は、ユーザー設定のURLへのアクセスを制限する動的URL検証機能を備えています。新しいAIプロバイダーを追加する場合は、以下の **4つのファイル** を同時に更新してください。1つでも漏れると、そのプロバイダーへの通信がブロックされます。

#### 追加手順

1. **ドメインのホワイトリスト追加** (`src/utils/storage.ts`):
   - `ALLOWED_AI_PROVIDER_DOMAINS` 配列に許可するドメインを追加します。
   - コメントにプロバイダー名を記載してください。

   ```typescript
   // 例: DeepSeek
   'deepseek.com',  // DeepSeek
   ```

2. **CSPの更新** (`manifest.json`):
   - `content_security_policy.extension_pages` 内の `connect-src` にドメインを追加します。

   ```json
   "connect-src": "... https://deepseek.com ..."
   ```

3. **host_permissionsの更新** (`manifest.json`):
   - `host_permissions` 配列にワイルドカードURLを追加します。

   ```json
   "https://deepseek.com/*"
   ```

4. **ドキュメントの更新** (`SETUP_GUIDE.md`):
   - 日英両方の「💡 サポートされているAIプロバイダー」テーブルに行を追加します。

   ```markdown
   | **DeepSeek** | `deepseek.com` |
   ```

#### テストの追加

- `src/utils/__tests__/storage.test.ts` に新しいドメインが正しく検証されることを確認するテストケースを追加してください。

```typescript
test('deepseek.com が許可される', () => {
  expect(isDomainInWhitelist('https://deepseek.com/v1/chat/completions')).toBe(true);
});
```

#### 🙏 新しいAIプロバイダーの追加、お待ちしています！

OpenAI互換APIを提供するプロバイダーは多数あります。上記の手順に従ってPull Requestを送っていただければ、積極的にマージします。追加したいプロバイダーがある場合は、まずGitHub Issuesで提案していただくか、直接PRを作成してください。

対応プロバイダーの追加は比較的簡単な作業です。コントリビューション大歓迎です！

### プライバシーステータスコードの追加

この拡張機能は、プライベートページ検出理由を識別するためにプライバシーステータスコード (PSH-XXXX) を使用します。新しいプライバシーステータスコードを追加する場合は、以下の **6つのファイル** を同時に更新してください。1つでも漏れると、コードとドキュメントの不一致が生じます。

#### 追加手順

1. **ステータスコード定数の更新** (`src/utils/privacyStatusCodes.ts`):
   - `PrivacyStatusCode` オブジェクトに新しい定数を追加します:
   ```typescript
   export const PrivacyStatusCode: Record<string, PrivacyStatusCodeValue> = {
       CACHE_CONTROL_PRIVATE: 'PSH-1001',
       SET_COOKIE: 'PSH-2001',
       AUTHORIZATION: 'PSH-3001',
       UNKNOWN: 'PSH-9001',
       NEW_REASON: 'PSH-4001',  // ここに追加
   };
   ```
   - `statusCodeToMessageKey()` 関数を更新します:
   ```typescript
   case 'PSH-4001':
       return 'privacyStatus_newReason';
   ```

2. **英語翻訳の追加** (`_locales/en/messages.json`):
   - 国際化キーを追加します:
   ```json
   "privacyStatus_newReason": {
       "message": "New detection reason",
       "description": "Privacy status message for new reason"
   }
   ```

3. **日本語翻訳の追加** (`_locales/ja/messages.json`):
   - 対応する日本語の翻訳を追加します:
   ```json
   "privacyStatus_newReason": {
       "message": "新しい検出理由",
       "description": "新しい検出理由のプライバシーステータスメッセージ"
   }
   ```

4. **検出ロジックの追加** (`src/utils/privacyChecker.ts`):
   - `PrivacyInfo.reason` 型を更新します:
   ```typescript
   reason?: 'cache-control' | 'set-cookie' | 'authorization' | 'new-reason';
   ```
   - `checkPrivacy()` 関数に検出ロジックを追加します:
   ```typescript
   // 検出条件を追加
   if (/* あなたの条件 */) {
       return {
           isPrivate: true,
           reason: 'new-reason',
           // ...
       };
   }
   ```

5. **日本語ドキュメントの更新** (`PRIVACY.md`):
   - 日本語セクションのPrivacy Status Codesテーブルに行を追加します:
   ```markdown
   | PSH-4001 | 新しい検出理由 | 検出対象の説明 |
   ```

6. **英語ドキュメントの更新** (`PRIVACY.md`):
   - 英語セクションのPrivacy Status Codesテーブルに行を追加します:
   ```markdown
   | PSH-4001 | New detection reason | Detection target description |
   ```

#### 重要な注意点

- ステータスコードは `PSH-XXXX` のパターンに従い、最初の桁がカテゴリーを示します:
  - 1xxx: Cache-Control ヘッダー
  - 2xxx: Cookie/セッション関連
  - 3xxx: 認証関連
  - 9xxx: 不明/その他の理由
- 既存のコードと競合しない適切なコード番号を選択してください
- 必ず日本語と英語の両方のドキュメントセクションを更新してください
- `privacyChecker.ts` の検出ロジックは、`reasonToStatusCode()` を経由してステータスコードにマッピングされる `reason` 文字列を返す必要があります

### プロジェクト構造

```
obsidian-smart-history/
├── src/
│   ├── background/    # Service Worker
│   ├── content/       # Content Scripts
│   ├── popup/         # Popup UI
│   └── utils/         # 共通ユーティリティ
├── e2e/               # E2Eテスト（Playwright）
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

- [ ] テストが通っている (`npm test` および `npm run test:e2e`)
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
npm test              # Run all tests (Jest)
npm run test:watch    # Run in watch mode (Jest)
npm run test:coverage # Run with coverage report (Jest)
npm run test:e2e      # Run E2E tests (Playwright)
npm run test:e2e:ui   # Run E2E tests in UI mode (Playwright)
npm run test:e2e:debug # Run E2E tests in debug mode (Playwright)
npm run test:e2e:headed # Run E2E tests in headed mode (Playwright)
```

#### Test Types

This project uses two types of tests:

1. **Jest Tests**: Unit tests, integration tests
   - Location: `src/**/__tests__/`
   - Purpose: Test individual functions, classes, and modules

2. **Playwright Tests**: E2E (End-to-End) tests
   - Location: `e2e/`
   - Purpose: Test extension popup UI, content script integration

#### Adding Tests

**Jest Tests**:
Place new tests in a `__tests__` subdirectory alongside the corresponding source file.

```
src/
  popup/
    utils/
      focusTrap.js
      __tests__/
        focusTrap.test.js
```

**Playwright Tests**:
Place E2E tests in the `e2e/` directory.

```
e2e/
  extension.spec.ts
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

### Security and Adding AI Providers

This extension features dynamic URL validation to restrict access to user-configured URLs. To add a new AI provider, you must update **4 files simultaneously**. Missing any one of them will cause connections to that provider to be blocked.

#### Steps to Add a Provider

1. **Add to Domain Whitelist** (`src/utils/storage.ts`):
   - Add the domain to the `ALLOWED_AI_PROVIDER_DOMAINS` array.
   - Include a comment with the provider name.

   ```typescript
   // Example: DeepSeek
   'deepseek.com',  // DeepSeek
   ```

2. **Update CSP** (`manifest.json`):
   - Add the domain to `connect-src` in `content_security_policy.extension_pages`.

   ```json
   "connect-src": "... https://deepseek.com ..."
   ```

3. **Update host_permissions** (`manifest.json`):
   - Add a wildcard URL to the `host_permissions` array.

   ```json
   "https://deepseek.com/*"
   ```

4. **Update Documentation** (`SETUP_GUIDE.md`):
   - Add a row to the "Supported AI Providers" table in both the Japanese and English sections.

   ```markdown
   | **DeepSeek** | `deepseek.com` |
   ```

#### Adding Tests

Add a test case to `src/utils/__tests__/storage.test.ts` to verify the new domain is correctly validated:

```typescript
test('deepseek.com is allowed', () => {
  expect(isDomainInWhitelist('https://deepseek.com/v1/chat/completions')).toBe(true);
});
```

#### 🙏 Pull Requests for New AI Providers Are Welcome!

There are many providers offering OpenAI-compatible APIs. If you follow the steps above and send a Pull Request, we'll be happy to merge it. Feel free to open a GitHub Issue to propose a new provider, or submit a PR directly.

Adding support for a new provider is a straightforward contribution — we'd love your help!

### Adding Privacy Status Codes

This extension uses Privacy Status Codes (PSH-XXXX) to identify different privacy detection reasons. To add a new Privacy Status Code, you must update **6 files simultaneously**. Missing any one will cause inconsistencies between code and documentation.

#### Steps to Add a Status Code

1. **Update Status Code Constants** (`src/utils/privacyStatusCodes.ts`):
   - Add the new constant to the `PrivacyStatusCode` object:
   ```typescript
   export const PrivacyStatusCode: Record<string, PrivacyStatusCodeValue> = {
       CACHE_CONTROL_PRIVATE: 'PSH-1001',
       SET_COOKIE: 'PSH-2001',
       AUTHORIZATION: 'PSH-3001',
       UNKNOWN: 'PSH-9001',
       NEW_REASON: 'PSH-4001',  // Add here
   };
   ```
   - Update the `statusCodeToMessageKey()` function:
   ```typescript
   case 'PSH-4001':
       return 'privacyStatus_newReason';
   ```

2. **Add English Translation** (`_locales/en/messages.json`):
   - Add the internationalization key:
   ```json
   "privacyStatus_newReason": {
       "message": "New detection reason",
       "description": "Privacy status message for new reason"
   }
   ```

3. **Add Japanese Translation** (`_locales/ja/messages.json`):
   - Add the corresponding Japanese translation:
   ```json
   "privacyStatus_newReason": {
       "message": "新しい検出理由",
       "description": "新しい検出理由のプライバシーステータスメッセージ"
   }
   ```

4. **Add Detection Logic** (`src/utils/privacyChecker.ts`):
   - Update the `PrivacyInfo.reason` type:
   ```typescript
   reason?: 'cache-control' | 'set-cookie' | 'authorization' | 'new-reason';
   ```
   - Add detection logic in the `checkPrivacy()` function:
   ```typescript
   // Add your detection condition
   if (/* your condition */) {
       return {
           isPrivate: true,
           reason: 'new-reason',
           // ...
       };
   }
   ```

5. **Update Japanese Documentation** (`PRIVACY.md`):
   - Add a row to the Privacy Status Codes table in the Japanese section:
   ```markdown
   | PSH-4001 | 新しい検出理由 | 検出対象の説明 |
   ```

6. **Update English Documentation** (`PRIVACY.md`):
   - Add a row to the Privacy Status Codes table in the English section:
   ```markdown
   | PSH-4001 | New detection reason | Detection target description |
   ```

#### Important Notes

- Status codes follow the pattern `PSH-XXXX` where the first digit indicates the category:
  - 1xxx: Cache-Control headers
  - 2xxx: Cookie/session related
  - 3xxx: Authentication related
  - 9xxx: Unknown/other reasons
- Choose an appropriate code number that doesn't conflict with existing codes
- Always update both Japanese and English documentation sections
- The detection logic in `privacyChecker.ts` must return a matching `reason` string that maps to the status code via `reasonToStatusCode()`

### Project Structure

```
obsidian-smart-history/
├── src/
│   ├── background/    # Service Worker
│   ├── content/       # Content Scripts
│   ├── popup/         # Popup UI
│   └── utils/         # Shared Utilities
├── e2e/               # E2E tests (Playwright)
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

- [ ] Tests pass (`npm test` and `npm run test:e2e`)
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