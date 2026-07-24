# PBI 07: ESLintルール開発のテストケース生成プロセス確立 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ESLintカスタムルール開発時のテストケース生成プロセスを確立する

**Architecture:** 過去のインシデントからテストパターンを抽出し、エッジケースの網羅的检查リストを作成。既存ルールへの適用例を文書化。

**Tech Stack:** Markdown, TypeScript, ESLint

---

## タスク概要

1. **Task 1: インシデント分析** - 過去のESLintルール関連インシデントを洗い出し
2. **Task 2: ガイドライン作成** - テストケース生成プロセスを文書化
3. **Task 3: 既存ルールへの適用** - サンプルテストケースを生成
4. **Task 4: 検証** - ガイドラインの完全性を確認

---

### Task 1: インシデント分析

**Files:**
- Analyze: `pbi/2026-07-22-02-refactor-response-size-limit-detection.md`
- Analyze: `eslint/rules/require-response-size-limit.mjs`

- [ ] **Step 1: 過去のインシデントをリスト化**

以下のインシデントからテストパターンを抽出:
1. 偽陽性: コメント内の文字列に反応
2. 偽陰性: ヘルパー関数経由のチェックを検出できない
3. パフォーマンス: O(n²)の計算量

- [ ] **Step 2: テストパターンを分類**

カテゴリ:
- ハッピーパス
- 偽陽性テスト
- 偽陰性テスト
- エッジケース
- パフォーマンステスト

- [ ] **Step 3: Commit analysis**

```bash
git commit --allow-empty -m "docs: analyze past ESLint rule testing incidents"
```

---

### Task 2: ガイドライン作成

**Files:**
- Create: `docs/ESLINT_RULE_TESTING_GUIDELINE.md`

- [ ] **Step 1: ガイドラインの骨格を作成**

```markdown
# ESLint Rule Testing Guideline

ESLintカスタムルール開発時のテストケース生成ガイドライン。

## テストケース生成チェックリスト

### 1. ハッピーパス
- [ ] ルールが正しく検出するケース
- [ ] 典型的な使用パターン
- [ ] 複数のバリエーション

### 2. 偽陽性テスト（検出されるべきでないケース）
- [ ] コメント内の文字列
  ```javascript
  // content-length チェック
  response.text(); // Should NOT trigger
  ```
- [ ] 文字列リテラル内の文字列
  ```javascript
  const key = "content-length";
  response.text(); // Should NOT trigger
  ```
- [ ] 無関係なコード
  ```javascript
  const data = await response.json(); // Should NOT trigger
  ```

### 3. 偽陰性テスト（検出されるべきケース）
- [ ] 直接的なパターン
  ```javascript
  response.text(); // Should trigger if no size check
  ```
- [ ] ヘルパー関数経由
  ```javascript
  validateResponseSize(response);
  response.text(); // Should NOT trigger
  ```
- [ ] 複雑な制御フロー
  ```javascript
  if (condition) {
    checkSize(response);
  }
  response.text(); // Should NOT trigger
  ```

### 4. エッジケース
- [ ] 空のコード
- [ ] 最小限のコード
- [ ] 非常に長いコード
- [ ] Unicode文字
- [ ] 特殊文字
- [ ] ネストされた関数
- [ ] アロー関数 vs 通常の関数
- [ ] async/await
- [ ] コールバック

### 5. パフォーマンステスト
- [ ] 大量のコード（1000行以上）
- [ ] 深いネスト
- [ ] 多数の関数呼び出し

## テストケースの書き方

### RuleTesterの使用
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
    // 偽陽性テスト
    {
      code: `
        // content-length
        response.text();
      `,
    },
  ],
  invalid: [
    // 偽陰性テスト
    {
      code: `
        response.text();
      `,
      errors: [{ messageId: 'missingSizeCheck' }],
    },
  ],
});
```

### テストケースの命名
```typescript
describe('my-rule', () => {
  describe('valid cases', () => {
    it('should not trigger on comments', () => { ... });
    it('should not trigger on string literals', () => { ... });
  });
  
  describe('invalid cases', () => {
    it('should trigger on direct call', () => { ... });
    it('should trigger on nested call', () => { ... });
  });
  
  describe('edge cases', () => {
    it('should handle empty code', () => { ... });
    it('should handle unicode', () => { ... });
  });
});
```

## 既存ルールへの適用例

### require-response-size-limit

#### 有効なケース
```javascript
// サイズチェックあり
const size = response.headers.get('content-length');
if (size > MAX_SIZE) throw new Error('Too large');
const text = await response.text();

// ヘルパー関数使用
validateResponseSize(response);
const text = await response.text();
```

#### 無効なケース
```javascript
// サイズチェックなし
const text = await response.text();

// チェックが不十分
const size = response.headers.get('content-length');
// sizeを使用していない
const text = await response.text();
```

#### エッジケース
```javascript
// コメント内の文字列（有効）
// content-length
const text = await response.text();

// 文字列リテラル（有効）
const key = "content-length";
const text = await response.text();

// ネストされた関数（無効）
async function process() {
  const text = await response.text();
}
```
```

- [ ] **Step 2: Commit guideline creation**

```bash
git add docs/ESLINT_RULE_TESTING_GUIDELINE.md
git commit -m "docs: create ESLint rule testing guideline"
```

---

### Task 3: 既存ルールへの適用

**Files:**
- Analyze: `eslint/__tests__/require-response-size-limit.test.ts`

- [ ] **Step 1: 既存のテストケースを確認**

Run:
```bash
cat eslint/__tests__/require-response-size-limit.test.ts
```

- [ ] **Step 2: 不足しているテストケースを特定**

ガイドラインのチェックリストと照合し、不足しているテストケースをリスト化。

- [ ] **Step 3: 追加テストケースを作成**

ガイドラインに基づいて追加テストケースを作成。

- [ ] **Step 4: Commit additional tests**

```bash
git add eslint/__tests__/
git commit -m "test(eslint): add comprehensive test cases for require-response-size-limit"
```

---

### Task 4: 検証

**Files:**
- Test: `docs/ESLINT_RULE_TESTING_GUIDELINE.md`

- [ ] **Step 1: ガイドラインの完全性を確認**

Run:
```bash
cat docs/ESLINT_RULE_TESTING_GUIDELINE.md | grep -c "^###"
```

Expected: At least 5 sections (ハッピーパス、偽陽性、偽陰性、エッジケース、パフォーマンス)

- [ ] **Step 2: テストケースのカバレッジを確認**

Run:
```bash
npm test -- require-response-size-limit.test.ts --coverage
```

Expected: Coverage > 90%

- [ ] **Step 3: Final commit**

```bash
git commit --allow-empty -m "test: verify ESLint rule testing guideline completeness"
```

---

## 実装計画の完了

実装計画を`docs/superpowers/plans/2026-07-25-pbi-07-eslint-rule-testing-guideline.md`に保存しました。
