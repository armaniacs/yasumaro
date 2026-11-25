# ESLint Rule Testing Guideline

ESLintカスタムルール開発時のテストケース生成ガイドライン。
過去のインシデント（偽陽性・偽陰性・パフォーマンス問題）を基にしたチェックリストを提供する。

## 現在の位置付け（2026-11 時点）

本番 lint は oxlint が実行する。`npm run lint` は `node scripts/gen-oxlintrc.mjs` で `.oxlintrc.json` を生成してから `oxlint -c .oxlintrc.json` を実行する。`eslint.config.js` は ESLint としては実行されず、ルール意図の SSOT として残っている。`files` / `ignores` / `rules` の変更は生成処理を通じて oxlint 側に反映される。

`eslint/rules/*.mjs` の各ルールは `meta` + `create` 形式のままとし、`eslint/oxlint-plugin.mjs` 経由で oxlint から読み込む。ESLint 側の定義は `eslint/plugin.mjs` にある。`eslint.config.js` の `no-restricted-syntax` による SettingsRepository 直接生成禁止は、oxlint 側では `local/no-settings-repository-direct` として移植されている。

単体テストは引き続き ESLint の RuleTester で行う。`eslint` パッケージは RuleTester 実行のために残している。TypeScript 構文の解析には `@typescript-eslint` ではなく `eslint/oxc-parser-adapter.mjs` を使う。新規テストは `new RuleTester` ではなく `eslint/__tests__/repeatSafeRuleTester.ts` の `createRepeatSafeRuleTester` を使うこと。`vitest --repeats` での重複登録エラーを避けるためである。

## テストケース生成チェックリスト

### 1. ハッピーパス

ルールが正しく動作する基本的なケースを網羅する。

- [ ] ルールが意図通り違反を検出するケース
- [ ] 典型的な使用パターン（最も一般的なコード形式）
- [ ] 複数のバリエーション（異なる変数名、異なるメソッド呼び出し）

### 2. 偽陽性テスト（検出されるべきでないケース）

ルールが誤って警告を出力してはいけないケース。

- [ ] コメント内のキーワードはチェックとして扱われないことの確認
  ```javascript
  // content-length チェックが必要
  response.text(); // Should trigger (comments are NOT AST nodes)
  ```
- [ ] 文字列リテラル内のキーワード
  ```javascript
  const key = "content-length";
  response.text(); // Should NOT trigger
  ```
- [ ] 無関係なメソッド呼び出し
  ```javascript
  const data = await response.json(); // Should NOT trigger
  ```
- [ ] テストファイル（ファイル名に `__tests__` / `.test.` を含むもの）
- [ ] モックファイル（ファイル名に `__mocks__` / `mock` を含むもの）

### 3. 偽陰性テスト（検出されるべきケース）

ルールが違反を見逃してはいけないケース。

- [ ] 直接的な違反パターン
  ```javascript
  response.text(); // Should trigger if no size check
  ```
- [ ] 複数の違反呼び出し
  ```javascript
  response.text(); // Should trigger (first call, no check)
  const size = response.headers.get('content-length');
  response.text(); // Should NOT trigger (after check)
  ```
- [ ] 深いネスト内の違反
  ```javascript
  async function outer() {
    function inner() {
      response.text(); // Should trigger
    }
  }
  ```
- [ ] アロー関数内の違反
  ```javascript
  const handler = async (response) => {
    const text = await response.text(); // Should trigger
  };
  ```
- [ ] 条件分岐内でのみチェックがある場合
  ```javascript
  async function handler(response) {
    if (someCondition) {
      const cl = response.headers.get('content-length');
      if (cl > 1024) throw new Error();
    }
    response.text(); // May or may not be protected (depends on code analysis depth)
  }
  ```

### 4. エッジケース

境界値や特殊なコード構造に対するテスト。

- [ ] 空のコード（ただし構文エラーにならない範囲）
- [ ] 最小限のコード（1行のみ）
- [ ] 非常に長いコード（数千行、パフォーマンス影響確認）
- [ ] Unicode識別子・文字列
  ```javascript
  const 応答 = { text: () => '' };
  const text = await 応答.text(); // Unicode variable name
  ```
- [ ] 特殊文字を含むコード
- [ ] アロー関数 vs 通常の関数（両方で動作確認）
- [ ] async/await の有無
- [ ] コールバック形式
  ```javascript
  fetch(url).then(response => response.text());
  ```
- [ ] 異なる response 変数名（`res`, `resp`, `result` 等）
- [ ] 同一ブロック内での複数 `response.text()` 呼び出し

### 5. パフォーマンステスト

大規模コードベースでのルール動作確認。

- [ ] 大量のコード（1000行以上、かつ多数の関数呼び出しを含む）
- [ ] 深いネスト（10段階以上のネスト）
- [ ] 多数の `response.text()` 呼び出し（100回以上）
- [ ] 巨大なオブジェクトリテラルを含むコード
- [ ] ループ内の `response.text()` 呼び出し

### 6. 相互運用性テスト（今後の拡張）

他のルールや設定との組み合わせテスト。

- [ ] TypeScriptファイル（`.ts` / `.tsx`）での動作
- [ ] JSX / TSX 内のJavaScript式
- [ ] モジュールシステム（ESM）での import/export
- [ ] 複数のカスタムルールが同時に有効な状態
- [ ] 異なる ESLint 設定（ecmaVersion, sourceType 等）

## テストケースの書き方

### RuleTester（推奨）

ESLint 9+ の flat config API に対応した RuleTester を使用する。新規テストは `new RuleTester` を直接作らず、`eslint/__tests__/repeatSafeRuleTester.ts` の `createRepeatSafeRuleTester` を使う。`vitest --repeats` で再実行しても重複登録エラーにならない。TypeScript 構文が必要な場合は `eslint/oxc-parser-adapter.mjs` をパーサとして渡す。

```typescript
import { createRepeatSafeRuleTester } from './repeatSafeRuleTester.js';
import rule from '../rules/my-rule.mjs';

const ruleTester = createRepeatSafeRuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
});

ruleTester.run('my-rule', rule, {
  valid: [
    // ハッピーパス / 偽陽性テスト
    {
      name: 'descriptive test name',
      code: `
        // comment with keyword
        targetFunction();
      `.trim(),
    },
  ],
  invalid: [
    // 偽陰性テスト
    {
      name: 'descriptive test name',
      code: `
        targetFunction();
      `.trim(),
      errors: [{ messageId: 'errorMessageId' }],
    },
  ],
});
```

**重要:** RuleTester の `valid` / `invalid` 配列内のコード文字列は、構文として有効である必要がある。コメントは含めても問題ないが、不正な構文（閉じ括弧不足等）はテスト失敗の原因となる。

### テストケースの命名規則

```typescript
ruleTester.run('my-rule', rule, {
  valid: [
    {
      name: 'should not trigger on comments containing keywords',
      code: '...',
    },
    {
      name: 'should not trigger on string literals containing keywords',
      code: '...',
    },
  ],
  invalid: [
    {
      name: 'should trigger on direct call without check',
      code: '...',
      errors: [{ messageId: 'errorId' }],
    },
    {
      name: 'should trigger on nested call without check',
      code: '...',
      errors: [{ messageId: 'errorId' }],
    },
  ],
});
```

命名規則:
- `valid` ケース: `should not trigger on <condition>`
- `invalid` ケース: `should trigger on <condition>`
- エッジケース: `should handle <edge case>`

## 既存ルールへの適用例

### require-response-size-limit

`eslint/rules/require-response-size-limit.mjs` のテストケース例。

#### 有効なケース（警告を出力しない）

```javascript
// サイズチェックあり（content-length + if文）
async function handler(response) {
  const contentLength = response.headers.get('content-length');
  if (contentLength > 5 * 1024 * 1024) throw new Error('too large');
  const text = await response.text();
}

// maxSize 変数を使用
async function handler(response) {
  const maxSize = 1024 * 1024;
  if (response.headers.get('content-length') > maxSize) return;
  const text = await response.text();
}

// byteLength チェック
async function handler(response) {
  const data = await response.arrayBuffer();
  if (data.byteLength > 1024 * 1024) throw new Error('too large');
  const text = await response.text();
}

// コメント内の content-length はチェックとして扱われない（AST上、コメントはノードではない）
// このコードは警告が出力される（`response.text()` の前に実質的なサイズチェックがないため）
async function handler(response) {
  // content-length のチェックを忘れずに
  const text = await response.text();
}

// 文字列リテラル内の content-length（偽陽性防止）
async function handler(response) {
  const key = "content-length";
  response.text();
}

// テストファイル（除外される: ファイル名に __tests__ / .test. を含む）
// filename: /path/to/__tests__/some.test.ts
const text = await response.text();

// ファイル名に .test. を含むファイルも除外される
// filename: /path/to/handlers.test.ts
const text = await response.text();

// モックファイル（除外される: ファイル名に __mocks__ / mock を含む）
// filename: /path/to/__mocks__/some.ts
const text = await response.text();
```

#### 無効なケース（警告を出力する）

```javascript
// サイズチェックなし
const text = await response.text();

// 深いネスト内でのサイズチェックなし
async function outer() {
  async function inner() {
    const text = await response.text();
  }
}

// アロー関数内でのサイズチェックなし
const handler = async (response) => {
  const text = await response.text();
};
```

#### 注意点

- **ヘルパー関数パターン**: `validateResponseSize(response)` のようなヘルパー関数呼び出しの検出は、現在の実装ではサポートされていない（将来の拡張予定）。そのため、ヘルパー関数を使用するケースのテストは現時点では無効（警告が出力される）となる。
- **条件付きチェック**: `if` ブロック内でのみサイズチェックが行われている場合、その `if` ブロックの外で `response.text()` が呼ばれると検出されない（現在の実装では `if` 文全体をサイズパターンとして認識しない）。

### require-sanitized-markdown

`eslint/rules/require-sanitized-markdown.mjs` のテストケース例。

#### 有効なケース（警告を出力しない）

```javascript
import { sanitizeForObsidian } from '../utils/markdownSanitizer.js';
const safe = sanitizeForObsidian(title);
const md = `- [${safe}](https://example.com)`;
```

#### 無効なケース（警告を出力する）

```javascript
import { sanitizeForObsidian } from '../utils/markdownSanitizer.js';
const md = `- [${title}](https://example.com)`;
```

#### 注意点

- **サニタイズ関数**: 認識されるサニタイズ関数は `sanitizeForObsidian` / `sanitizeUrlForMarkdownTarget` / `sanitizeForMarkdownLinkText` の 3 つ（`SANITIZE_FUNCTIONS`）。いずれかでサニタイズ済みの変数は警告されない
- **内部変数**: 内部変数は常にスキップされる。完全な一覧は `eslint/rules/require-sanitized-markdown.mjs` の `INTERNAL_VARS` を参照（例: `timestamp`、`dateStr`、`periodLabel`）
- **import 欠落**: markdown テンプレートがあるがサニタイズ関数の import がない場合、`missingImport` エラーが追加で報告される
- **テストファイル**: テストファイル（ファイル名に `__tests__` / `.test.` を含む）では `missingImport` エラーは報告されない

### その他の登録ルール

本ガイドは上記 2 ルールを中心に解説する。ルール本体は `eslint/rules/` にあり、ESLint 側の登録は `eslint/plugin.mjs`、oxlint 側の登録は `eslint/oxlint-plugin.mjs` にある。oxlint 側には `eslint.config.js` の `no-restricted-syntax` 制限を移植した `no-settings-repository-direct` が1件追加される。

- `require-sanitized-markdown`: markdown 生成時のサニタイズ漏れを検出する
- `require-response-size-limit`: response 読み取り前のサイズ検査漏れを検出する
- `no-tautology-expect`: 自明に真となる expect アサーションを検出する
- `no-test-sleep`: テスト内の固定時間待ちを検出する
- `no-greedy-fake-timers`: 範囲の広い fake timers を検出する
- `no-fixed-wait`: E2E / bench 内の固定時間待ちを検出する
- `no-vacuous-negative-wait`: 空振りする否定条件待ちを検出する
- `no-manual-protocol-version`: protocolVersion の手動付与を検出する
- `no-dead-test-skip`: 実行されない skip 宣言を検出する
- `utils-layer-boundary`: `src/utils/` のレイヤ境界違反を検出する（本番ゲートで有効）
- `no-raw-storage`: `chrome.storage.local` の直接利用を検出する（本番ゲートで有効）
- `no-direct-console-log`: 直接の `console.*` 出力を検出する（本番ゲートで有効）
- `no-settings-repository-direct`: `new SettingsRepository()` の直接生成を検出する（oxlint 側の名称。本番ゲートで有効）

## テストケース追加のワークフロー

1. **ルールの動作を理解する**: ルールの `meta.messages` と `create()` 関数を読み、どのようなパターンを検出するか把握する
2. **チェックリストと照合**: 本ガイドラインのチェックリストを参照し、該当するカテゴリのテストケースを洗い出す
3. **偽陽性ケースを列挙**: コメント、文字列リテラル、無関係なコードなど、誤検出される可能性があるパターンを列挙する
4. **偽陰性ケースを列挙**: 見逃される可能性があるパターン（異なる構文、ネスト、コールバック等）を列挙する
5. **エッジケースを列挙**: 空コード、Unicode、特殊構文などを列挙する
6. **実装してテスト**: `createRepeatSafeRuleTester` を使用してテストケースを記述し、全てパスすることを確認する。TypeScript 構文が必要な場合は `oxc-parser-adapter` を使う
7. **既存テストの回帰確認**: 既存のテストケースも全てパスすることを確認する。`eslint.config.js` の `files` / `rules` を変えた場合は `npm run lint` で生成後の oxlint 実行も確認する

## 参考資料

- [ESLint RuleTester ドキュメント](https://eslint.org/docs/latest/integrate/nodejs-api#ruletester)
- [eslint/rules/](https://github.com/armaniacs/yasumaro/tree/main/eslint/rules/) - カスタムルール実装
- [eslint/__tests__/](https://github.com/armaniacs/yasumaro/tree/main/eslint/__tests__/) - テストケース実装例
- `eslint.config.js` - ルール意図の SSOT（ESLint としては実行されない）
- `eslint/plugin.mjs` - ESLint 側のルール登録
- `eslint/oxlint-plugin.mjs` - oxlint 側のルール登録
- `eslint/oxc-parser-adapter.mjs` - RuleTester 用 TypeScript パーサ
- `eslint/__tests__/repeatSafeRuleTester.ts` - `vitest --repeats` 対応の RuleTester 生成
- `scripts/gen-oxlintrc.mjs` - SSOT から `.oxlintrc.json` を生成する処理
