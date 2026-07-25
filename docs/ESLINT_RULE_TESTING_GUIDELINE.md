# ESLint Rule Testing Guideline

ESLintカスタムルール開発時のテストケース生成ガイドライン。
過去のインシデント（偽陽性・偽陰性・パフォーマンス問題）を基にしたチェックリストを提供する。

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
- [ ] テストファイル（`__tests__/` 配下）
- [ ] モックファイル（`__mocks__/` 配下）

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

ESLint 9+ の flat config API に対応した RuleTester を使用する。

```typescript
import { RuleTester } from 'eslint';
import rule from '../rules/my-rule.js';

const ruleTester = new RuleTester({
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

// テストファイル（除外される）
// filename: /path/to/__tests__/some.test.ts
const text = await response.text();

// モックファイル（除外される）
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

- **内部変数**: `timestamp`, `date`, `domain` 等の内部変数は常にスキップされる
- **import 欠落**: markdown テンプレートがあるが `sanitizeForObsidian` の import がない場合、`missingImport` エラーが追加で報告される
- **テストファイル**: テストファイル（`__tests__/` 配下）では `missingImport` エラーは報告されない

## テストケース追加のワークフロー

1. **ルールの動作を理解する**: ルールの `meta.messages` と `create()` 関数を読み、どのようなパターンを検出するか把握する
2. **チェックリストと照合**: 本ガイドラインのチェックリストを参照し、該当するカテゴリのテストケースを洗い出す
3. **偽陽性ケースを列挙**: コメント、文字列リテラル、無関係なコードなど、誤検出される可能性があるパターンを列挙する
4. **偽陰性ケースを列挙**: 見逃される可能性があるパターン（異なる構文、ネスト、コールバック等）を列挙する
5. **エッジケースを列挙**: 空コード、Unicode、特殊構文などを列挙する
6. **実装してテスト**: RuleTester を使用してテストケースを記述し、全てパスすることを確認する
7. **既存テストの回帰確認**: 既存のテストケースも全てパスすることを確認する

## 参考資料

- [ESLint RuleTester ドキュメント](https://eslint.org/docs/latest/integrate/nodejs-api#ruletester)
- [eslint/rules/](https://github.com/armaniacs/yasumaro/tree/main/eslint/rules/) - カスタムルール実装
- [eslint/__tests__/](https://github.com/armaniacs/yasumaro/tree/main/eslint/__tests__/) - テストケース実装例
