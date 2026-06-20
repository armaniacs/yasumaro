# コントリビューションガイド / Contributing Guide

[日本語](#日本語) | [English](#english)

---

## 日本語

### 概要

Yasumaroへのコントリビューションに感謝します。このガイドでは、開発環境のセットアップ、コーディング規約、テスト手順、プルリクエストのフローについて説明します。

### 開発環境のセットアップ

#### 前提条件

- Node.js (LTS推奨)
- Chromeブラウザ (またはChromium派生ブラウザ)
- Git

#### 手順

1. プロジェクトをクローン
```bash
git clone https://github.com/your-username/yasumaro.git
cd yasumaro
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
npm test              # 全テスト実行（Vitest）
npm run test:watch    # ウォッチモードでの実行（Vitest）
npm run test:coverage # カバレッジレポート付き実行（Vitest）
npm run test:e2e      # E2Eテスト実行（Playwright）
npm run test:e2e:ui   # E2EテストUIモード（Playwright）
npm run test:e2e:debug # E2Eテストデバッグモード（Playwright）
npm run test:e2e:headed # E2Eテストヘッドフルモード（Playwright）
```

#### テストの種類

このプロジェクトでは2種類のテストを使用しています：

1. **Vitest テスト**: ユニットテスト、統合テスト
   - 位置: `src/**/__tests__/`
   - 用途: 個別の関数、クラス、モジュールのテスト

2. **Playwright テスト**: E2E（エンドツーエンド）テスト
   - 位置: `e2e/`
   - 用途: 拡張機能のポップアップUI、コンテンツスクリプトの統合テスト

#### テストの追加

**Vitest テスト**:
新しいテストは、対応するソースファイルと同じディレクトリの`__tests__`サブディレクトリに配置してください。

```
src/
  popup/
    utils/
      focusTrap.ts
      __tests__/
        focusTrap.test.ts
```

**Playwright テスト**:
E2Eテストは `e2e/` ディレクトリに配置してください。

```
e2e/
  extension.spec.ts
```

#### テストの命名規則

- テストファイル: `{filename}.test.ts`
- テストスイート: 関数名やモジュール名を記述
- 個別テスト: テスト内容を簡潔に記述（日本語可）

```typescript
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

#### TypeScript / ES Modules

このプロジェクトは TypeScript で書かれており、ESM（ECMAScript Modules）を使用しています。

**インポート構文**:
- ソースコードのファイル拡張子は `.ts` または `.test.ts` です
- しかし、TypeScript は ESM モジュール解決のためにインポート文に `.js` 拡張子を使用します

```typescript
// ファイル: src/popup/main.ts
import { getMessage } from '../utils/i18n.js';  // i18n.ts を参照
import { focusTrapManager } from './utils/focusTrap.js';  // focusTrap.ts を参照
```

**重要なルール**:
- インポート文の拡張子は常に `.js` を使用してください
- 実際のファイルは `.ts` または `.test.ts` です
- これは TypeScript ESM の仕様で、ビルド時に `.js` ファイルが生成されるため

**テストファイル**:
- テストは `.test.ts` 拡張子を使用します
- 同様にインポート時は `.js` を使用します

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

2. **CSPの更新** (`wxt.config.ts`):
    - `content_security_policy.extension_pages` 内の `connect-src` にドメインを追加します。

    ```typescript
    // wxt.config.ts の content_security_policy.extension_pages
    "connect-src": "... https://deepseek.com ..."
    ```

3. **host_permissionsの更新** (`wxt.config.ts`):
    - `host_permissions` 配列にワイルドカードURLを追加します。

    ```typescript
    // wxt.config.ts の host_permissions
    "https://deepseek.com/*"
    ```

4. **ドキュメントの更新** (`docs/SETUP_GUIDE.md`):
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

2. **英語翻訳の追加** (`public/_locales/en/messages.json`):
   - 国際化キーを追加します:
   ```json
   "privacyStatus_newReason": {
       "message": "New detection reason",
       "description": "Privacy status message for new reason"
   }
   ```

3. **日本語翻訳の追加** (`public/_locales/ja/messages.json`):
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

5. **日本語ドキュメントの更新** (`docs/PRIVACY.md`):
   - 日本語セクションのPrivacy Status Codesテーブルに行を追加します:
   ```markdown
   | PSH-4001 | 新しい検出理由 | 検出対象の説明 |
   ```

6. **英語ドキュメントの更新** (`docs/PRIVACY.md`):
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
yasumaro/
├── entrypoints/       # WXT エントリポイント（popup, options, background 等）
├── src/
│   ├── background/    # Service Worker
│   ├── content/       # Content Scripts
│   ├── popup/         # Popup UI
│   ├── dashboard/     # Dashboard UI
│   └── utils/         # 共通ユーティリティ
├── public/
│   └── _locales/      # 翻訳キー
│       ├── en/
│       │   └── messages.json
│       └── ja/
│           └── messages.json
├── e2e/               # E2Eテスト（Playwright）
├── docs/              # 公開ドキュメント (GitHub Pages)
├── dev-docs/          # 開発者内部ドキュメント
├── wxt.config.ts      # WXT 設定（マニフェスト生成）
└── package.json       # npm設定
```

### プルリクエストのフロー

1. ブランチの作成
```bash
git checkout -b feature/your-feature-name
```
   - バグ修正の場合は `feature/` の代わりに `fix/` または `hotfix/` を、ドキュメント更新の場合は `docs/` を選択します。

2. 変更をコミット
```bash
git add -p
git commit -m "feat: 功能の説明"
```

3. テストと型チェックを実行
```bash
npm run validate
```

4. プッシュ
```bash
git push origin {ブランチ名}
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

#### ブランチ命名規則

本プロジェクトではシンプルなブランチ運用を採用しています。`CHANGELOG.md` のバージョニングポリシーに従い、v6.偶数.x はバグ修正のみ、v6.奇数.x は新機能実装となります。

- `main` — 現在の偶数安定系列。バグ修正のみ受け入れます。
- `feature/<名前>` — 新機能開発用ブランチ。例: `feature/ai-provider-improvements`
- `fix/<名前>` — 通常のバグ修正用ブランチ。例: `fix/notification-crash`
- `hotfix/<名前>` — 緊急のバグ修正用ブランチ。例: `hotfix/critical-security-patch`
- `docs/<名前>` — ドキュメント更新用ブランチ。例: `docs/api-guide`
- `refactor/<名前>` — リファクタリング用ブランチ。例: `refactor/extractor-cleanup`

新機能は `feature/` ブランチで開発し、準備ができたら `main` へマージしてリリースします。v6.偶数.x はバグ修正のみを予定しています。プルリクエストやコミットメッセージは各ブランチ種別に応じた Conventional Commits タイプを使用してください。

### コードレビュー

レビューの時は以下を確認してください：

- [ ] テストが通っている (`npm run validate`)
- [ ] 新しいコードにテストが含まれている
- [ ] セキュリティレビューを実施した（CSP・入力検証・機密情報の露出がないか）
- [ ] i18nが適切に実装されている
- [ ] アクセシビリティ要件を満たしている
- [ ] モバイル端末でのメモリ使用量・パフォーマンスへの影響が評価されている
- [ ] オフライン/低速回線での動作が検証されている
- [ ] ドキュメントが更新されている

### バグ報告と機能リクエスト

バグ報告や機能リクエストはGitHub Issuesを使用してください。

バグ報告には以下を含めてください：
- 再現手順
- 期待される挙動
- 実際の挙動
- スクリーンショット（可能であれば）
- 使用環境（ブラウザバージョンなど）

### リリースフロー

GitHub Release を作成する際は、`CHANGELOG.md` の該当セクションをリリースノートとして使用し、冒頭には `CHANGELOG.md` 先頭に記載の Yasumaro ブランド案内を含めてください。

---

## English

### Overview

Thank you for contributing to Yasumaro. This guide covers development environment setup, coding conventions, testing procedures, and pull request workflows.

### Development Environment Setup

#### Prerequisites

- Node.js (LTS recommended)
- Chrome browser (or Chromium-based browser)
- Git

#### Steps

1. Clone the repository
```bash
git clone https://github.com/your-username/yasumaro.git
cd yasumaro
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
npm test              # Run all tests (Vitest)
npm run test:watch    # Run in watch mode (Vitest)
npm run test:coverage # Run with coverage report (Vitest)
npm run test:e2e      # Run E2E tests (Playwright)
npm run test:e2e:ui   # Run E2E tests in UI mode (Playwright)
npm run test:e2e:debug # Run E2E tests in debug mode (Playwright)
npm run test:e2e:headed # Run E2E tests in headed mode (Playwright)
```

#### Test Types

This project uses two types of tests:

1. **Vitest Tests**: Unit tests, integration tests
   - Location: `src/**/__tests__/`
   - Purpose: Test individual functions, classes, and modules

2. **Playwright Tests**: E2E (End-to-End) tests
   - Location: `e2e/`
   - Purpose: Test extension popup UI, content script integration

#### Adding Tests

**Vitest Tests**:
Place new tests in a `__tests__` subdirectory alongside the corresponding source file.

```
src/
  popup/
    utils/
      focusTrap.ts
      __tests__/
        focusTrap.test.ts
```

**Playwright Tests**:
Place E2E tests in the `e2e/` directory.

```
e2e/
  extension.spec.ts
```

#### Test Naming Conventions

- Test files: `{filename}.test.ts`
- Test suites: Describe function or module name
- Individual tests: Describe test content briefly

```typescript
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

#### TypeScript / ES Modules

This project is written in TypeScript and uses ESM (ECMAScript Modules).

**Import Syntax**:
- Source files use `.ts` or `.test.ts` extensions
- However, TypeScript imports must use `.js` extension for ESM module resolution

```typescript
// File: src/popup/main.ts
import { getMessage } from '../utils/i18n.js';  // References i18n.ts
import { focusTrapManager } from './utils/focusTrap.js';  // References focusTrap.ts
```

**Important Rules**:
- Always use `.js` extension in import statements
- Actual files are `.ts` or `.test.ts`
- This is TypeScript ESM specification - `.js` files are generated during build

**Test Files**:
- Tests use `.test.ts` extension
- Likewise, use `.js` in imports

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

2. **Update CSP** (`wxt.config.ts`):
    - Add the domain to `connect-src` in `content_security_policy.extension_pages`.

    ```typescript
    // wxt.config.ts content_security_policy.extension_pages
    "connect-src": "... https://deepseek.com ..."
    ```

3. **Update host_permissions** (`wxt.config.ts`):
    - Add a wildcard URL to the `host_permissions` array.

    ```typescript
    // wxt.config.ts host_permissions
    "https://deepseek.com/*"
    ```

4. **Update Documentation** (`docs/SETUP_GUIDE.md`):
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

2. **Add English Translation** (`public/_locales/en/messages.json`):
   - Add the internationalization key:
   ```json
   "privacyStatus_newReason": {
       "message": "New detection reason",
       "description": "Privacy status message for new reason"
   }
   ```

3. **Add Japanese Translation** (`public/_locales/ja/messages.json`):
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

5. **Update Japanese Documentation** (`docs/PRIVACY.md`):
   - Add a row to the Privacy Status Codes table in the Japanese section:
   ```markdown
   | PSH-4001 | 新しい検出理由 | 検出対象の説明 |
   ```

6. **Update English Documentation** (`docs/PRIVACY.md`):
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
yasumaro/
├── entrypoints/       # WXT entrypoints (popup, options, background, etc.)
├── src/
│   ├── background/    # Service Worker
│   ├── content/       # Content Scripts
│   ├── popup/         # Popup UI
│   ├── dashboard/     # Dashboard UI
│   └── utils/         # Shared Utilities
├── public/
│   └── _locales/      # Translation keys
│       ├── en/
│       │   └── messages.json
│       └── ja/
│           └── messages.json
├── e2e/               # E2E tests (Playwright)
├── docs/              # Public docs (GitHub Pages)
├── dev-docs/          # Internal developer docs
├── wxt.config.ts      # WXT configuration (manifest generation)
└── package.json       # npm configuration
```

### Pull Request Workflow

1. Create a branch
```bash
git checkout -b feature/your-feature-name
```
   - Use `fix/` or `hotfix/` for bug fixes, `docs/` for documentation updates.

2. Commit changes
```bash
git add -p
git commit -m "feat: description of feature"
```

3. Run tests and type-check
```bash
npm run validate
```

4. Push
```bash
git push origin {branch-name}
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

#### Branch Naming Convention

This project uses a simple branch workflow aligned with the versioning policy in `CHANGELOG.md` (v6.even.x = bug fixes only, v6.odd.x = new features).

- `main` — The current even stable release line. Accepts bug fixes only.
- `feature/<name>` — New feature branches. Example: `feature/ai-provider-improvements`
- `fix/<name>` — Regular bug fix branches. Example: `fix/notification-crash`
- `hotfix/<name>` — Urgent bug fix branches. Example: `hotfix/critical-security-patch`
- `docs/<name>` — Documentation update branches. Example: `docs/api-guide`
- `refactor/<name>` — Refactoring branches. Example: `refactor/extractor-cleanup`

Develop new features in `feature/` branches and merge them into `main` when ready for release. The v6.even.x line is intended for bug fixes only. Use the appropriate Conventional Commits type for each branch type.

### Code Review Checklist

When reviewing code, check for:

- [ ] Tests pass (`npm run validate`)
- [ ] New code includes tests
- [ ] Security review completed (CSP, input validation, no sensitive data exposure)
- [ ] i18n is properly implemented
- [ ] Accessibility requirements are met
- [ ] Mobile memory/performance impact has been evaluated
- [ ] Offline/slow-network behavior has been verified
- [ ] Documentation is updated

### Bug Reports and Feature Requests

Use GitHub Issues for bug reports and feature requests.

Include for bug reports:
- Steps to reproduce
- Expected behavior
- Actual behavior
- Screenshots (if possible)
- Environment details (browser version, etc.)

### Release Process

When creating a GitHub Release, use the corresponding section in `CHANGELOG.md` as the release notes and include the Yasumaro brand notice from the top of `CHANGELOG.md` at the top.