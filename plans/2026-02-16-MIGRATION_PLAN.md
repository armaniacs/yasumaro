# TypeScriptマイグレーション完了実行計画

## 現状サマリー

- **実装コード**: ✅ 完全移行済み（70ファイル）
- **テストコード**: ❌ 未移行（45ファイル中44ファイルが`.js`のまま）
- **移行完了率**: 実装100% / テスト2.2% / **総合61%**

## 問題点

### 1. テストファイルがJavaScriptのまま
```
src/popup/__tests__/*.test.js    (21ファイル)
src/utils/__tests__/*.test.js    (23ファイル)
src/background/__tests__/*.test.ts (1ファイルのみ移行済み)
```

### 2. 型安全性の欠如
- テストコードに型チェックが適用されていない
- モック・スタブに型定義がない
- テストデータの型検証ができない

### 3. 設定の不整合
- `tsconfig.json`がテストファイルを`exclude`している
- インポートパスに`.ts`拡張子が明示されている（非標準）

## 実行計画

### フェーズ1: 準備と設定調整（優先度: 高）

#### タスク1.1: テスト用TypeScript設定の作成
**ファイル**: `tsconfig.test.json`

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": true,
    "types": ["jest", "node", "chrome"]
  },
  "include": [
    "src/**/__tests__/**/*",
    "src/**/*.test.ts",
    "src/**/*.spec.ts",
    "jest.setup.js"
  ],
  "exclude": ["node_modules", "dist"]
}
```

**所要時間**: 10分

#### タスク1.2: tsconfig.jsonの調整
**変更箇所**: `exclude`セクション

```json
"exclude": [
  "node_modules",
  "dist",
  "jest.setup.js",
  "jest.config.cjs",
  "babel.config.cjs",
  "build.js"
]
```

**所要時間**: 5分

#### タスク1.3: package.jsonへのテスト型チェックスクリプト追加

```json
"scripts": {
  "type-check": "tsc --noEmit",
  "type-check:test": "tsc --project tsconfig.test.json --noEmit",
  "test": "jest",
  "test:type-safe": "npm run type-check:test && jest"
}
```

**所要時間**: 5分

---

### フェーズ2: テストファイルの段階的移行（優先度: 高）

#### 戦略: ディレクトリ単位で移行

**順序**:
1. `src/background/__tests__/` (参考実装が既にある)
2. `src/utils/__tests__/` (23ファイル - ユーティリティは依存が少ない)
3. `src/popup/__tests__/` (21ファイル - UI関連は依存が多い)

#### タスク2.1: src/background/__tests__/ の移行
**対象**: 既存の`.js`ファイル（もしあれば）

**手順**:
1. ファイル拡張子を`.js` → `.test.ts`に変更
2. インポートパスから`.ts`拡張子を削除
3. モックの型定義を追加
4. `npm run type-check:test`で検証
5. `npm test`で動作確認

**所要時間**: 30分

#### タスク2.2: src/utils/__tests__/ の移行（23ファイル）

**優先順位**: 依存の少ないファイルから
1. 独立したユーティリティ（crypto, logger, urlUtils等）
2. 相互依存のあるファイル（storage, migration等）
3. 複雑なロジック（piiSanitizer, ublockParser等）

**移行手順（各ファイル）**:
```bash
# 1. ファイル名変更
mv src/utils/__tests__/crypto.test.js src/utils/__tests__/crypto.test.ts

# 2. インポート修正（エディタで一括置換）
# Before: import { ... } from '../crypto.ts';
# After:  import { ... } from '../crypto';

# 3. 型定義追加
# - モックの型
# - テストデータの型
# - アサーションの型

# 4. 検証
npm run type-check:test
npm test -- crypto.test.ts
```

**サンプル移行例（crypto.test.js → crypto.test.ts）**:

```typescript
// Before (JavaScript)
import { encryptData, decryptData } from '../crypto.ts';

const testData = { apiKey: 'test123' };

test('暗号化と復号化', async () => {
  const encrypted = await encryptData(testData);
  expect(encrypted).toBeDefined();
});

// After (TypeScript)
import { encryptData, decryptData } from '../crypto';
import type { EncryptedData } from '../crypto';

interface TestData {
  apiKey: string;
}

const testData: TestData = { apiKey: 'test123' };

test('暗号化と復号化', async () => {
  const encrypted: EncryptedData = await encryptData(testData);
  expect(encrypted).toBeDefined();
});
```

**所要時間**: 2-3時間（23ファイル × 5-8分/ファイル）

#### タスク2.3: src/popup/__tests__/ の移行（21ファイル）

**注意点**:
- UI関連のテストはDOM操作が多い
- モックが複雑（chrome API、i18n等）
- 相互依存が多い

**移行手順**: タスク2.2と同様

**所要時間**: 2-3時間（21ファイル × 6-10分/ファイル）

---

### フェーズ3: 型定義の強化（優先度: 中）

#### タスク3.1: テスト共通型定義ファイルの作成
**ファイル**: `src/__tests__/types/index.ts`

```typescript
// Jest型定義の拡張
import type { Mock } from 'jest-mock';

// Chrome API モックの型
export interface ChromeStorageMock {
  local: {
    get: Mock;
    set: Mock;
    remove: Mock;
    clear: Mock;
  };
}

// テストユーティリティ型
export interface TestSettings {
  obsidianUrl: string;
  obsidianApiKey: string;
  aiProvider: 'openai' | 'gemini' | 'local';
  // ... その他の設定
}

// アサーションヘルパー型
export type AsyncMatcher<T> = (
  expected: T
) => Promise<jest.CustomMatcherResult>;
```

**所要時間**: 1時間

#### タスク3.2: モック定義の型安全化
**対象**: `jest.setup.js` → `jest.setup.ts`への移行

```typescript
// jest.setup.ts
import { ChromeStorageMock } from './src/__tests__/types';

const mockStorage: ChromeStorageMock = {
  local: {
    get: jest.fn(),
    set: jest.fn(),
    remove: jest.fn(),
    clear: jest.fn(),
  }
};

global.chrome = {
  storage: mockStorage,
  // ... その他のモック
} as typeof chrome;
```

**所要時間**: 1時間

---

### フェーズ4: 検証とクリーンアップ（優先度: 中）

#### タスク4.1: 全体の型チェック
```bash
npm run type-check        # 実装コード
npm run type-check:test   # テストコード
```

**所要時間**: 30分（エラー修正含む）

#### タスク4.2: テストスイートの全体実行
```bash
npm test                  # 全テスト実行
npm run test:coverage     # カバレッジ確認
```

**所要時間**: 30分（失敗したテストの修正含む）

#### タスク4.3: 不要な設定の削除
- `jest.resolver.cjs`のカスタムリゾルバーが不要になる可能性を検証
- `.ts`拡張子を明示的に書いていた部分の削除確認

**所要時間**: 30分

---

### フェーズ5: ドキュメント更新（優先度: 低）

#### タスク5.1: CHANGELOG.mdの更新
```markdown
## [Unreleased]

### Changed
- すべてのテストファイルをTypeScriptに移行
- テストコードに型安全性を適用
- tsconfig.test.jsonを追加してテスト専用の型チェックを実装
```

**所要時間**: 10分

#### タスク5.2: README.mdの更新
開発者向けセクションに型チェックコマンドを追加

**所要時間**: 10分

#### タスク5.3: MEMORY.mdの更新
```markdown
## Testing
- すべてのテストファイルは`.test.ts`形式
- `npm run type-check:test`でテストコードの型チェック実行
- モック定義は`src/__tests__/types/`に集約
```

**所要時間**: 5分

---

## スケジュール

### 集中作業プラン（推奨）
**総所要時間**: 6-8時間（1日で完了可能）

| フェーズ | 作業内容 | 所要時間 | 累計 |
|---------|---------|---------|------|
| フェーズ1 | 準備と設定調整 | 20分 | 0:20 |
| フェーズ2.1 | background テスト移行 | 30分 | 0:50 |
| フェーズ2.2 | utils テスト移行（23ファイル） | 2.5時間 | 3:20 |
| 休憩 | - | 20分 | 3:40 |
| フェーズ2.3 | popup テスト移行（21ファイル） | 2.5時間 | 6:10 |
| 休憩 | - | 20分 | 6:30 |
| フェーズ3 | 型定義強化 | 2時間 | 8:30 |
| フェーズ4 | 検証とクリーンアップ | 1.5時間 | 10:00 |
| フェーズ5 | ドキュメント更新 | 25分 | 10:25 |

### 段階的作業プラン（代替案）
**期間**: 3日間（1日3-4時間）

**1日目**: フェーズ1 + フェーズ2.1-2.2
**2日目**: フェーズ2.3 + フェーズ3
**3日目**: フェーズ4 + フェーズ5

---

## リスクと対策

### リスク1: 移行中のテスト失敗
**対策**:
- 1ファイルずつ移行してコミット
- 失敗したら即座にロールバック可能

### リスク2: 型エラーの大量発生
**対策**:
- 初期は`// @ts-ignore`で一時的に回避
- 段階的に型を追加

### リスク3: モックの型定義が困難
**対策**:
- `jest.MockedFunction<typeof originalFunc>`を活用
- `@types/jest`の型定義を参照

---

## 成功基準

### 必須条件
- [ ] すべてのテストファイルが`.test.ts`拡張子
- [ ] `npm run type-check:test`がエラーなく完了
- [ ] `npm test`がすべてパス（既存の6つの失敗を除く）
- [ ] インポートパスから`.ts`拡張子が削除されている

### 推奨条件
- [ ] テスト共通型定義が整備されている
- [ ] モックに適切な型定義がある
- [ ] `jest.setup.js`が`jest.setup.ts`に移行されている

### 理想条件
- [ ] テストカバレッジが維持または向上
- [ ] 型エラーによって潜在的なバグが発見される
- [ ] 新規テスト作成時のDXが向上

---

## チェックリスト

### 開始前
- [ ] 現在のブランチ: `feature/typescript-migration`
- [ ] すべてのテストがパス（既存失敗除く）: `npm test`
- [ ] 変更をコミット済み
- [ ] バックアップ作成（オプション）

### フェーズ1完了
- [ ] `tsconfig.test.json`作成完了
- [ ] `tsconfig.json`の`exclude`修正完了
- [ ] `package.json`のスクリプト追加完了
- [ ] `npm run type-check:test`が実行可能

### フェーズ2完了
- [ ] 45個のテストファイルすべてが`.test.ts`
- [ ] インポートパスから`.ts`拡張子削除完了
- [ ] すべてのテストがパス
- [ ] 型エラーなし（または文書化された例外のみ）

### フェーズ3完了
- [ ] テスト共通型定義ファイル作成完了
- [ ] 主要なモックに型定義追加完了
- [ ] `jest.setup.ts`移行完了（オプション）

### フェーズ4完了
- [ ] `npm run type-check`成功
- [ ] `npm run type-check:test`成功
- [ ] `npm test`成功（既存失敗除く）
- [ ] カバレッジ低下なし

### フェーズ5完了
- [ ] `CHANGELOG.md`更新完了
- [ ] `README.md`更新完了
- [ ] `MEMORY.md`更新完了

---

## 参考リソース

### TypeScript + Jest
- [Jest TypeScript Deep Dive](https://kulshekhar.github.io/ts-jest/)
- [Testing with TypeScript](https://jestjs.io/docs/getting-started#using-typescript)

### 型定義のベストプラクティス
- [TypeScript Deep Dive - Testing](https://basarat.gitbook.io/typescript/intro-1/jest)
- [Effective TypeScript - Item 52: Be Aware of the Pitfalls of Testing Types](https://effectivetypescript.com/)

### Chrome Extension TypeScript
- [@types/chrome documentation](https://www.npmjs.com/package/@types/chrome)

---

## 付録: 自動化スクリプト（オプション）

### ファイル一括リネームスクリプト
```bash
#!/bin/bash
# rename-tests.sh

find src -name "*.test.js" -type f | while read file; do
  new_file="${file%.test.js}.test.ts"
  git mv "$file" "$new_file"
  echo "Renamed: $file -> $new_file"
done
```

### インポートパス修正スクリプト
```bash
#!/bin/bash
# fix-imports.sh

find src -name "*.test.ts" -type f | while read file; do
  # .ts 拡張子を削除
  sed -i '' "s/from '\(.*\)\.ts'/from '\1'/g" "$file"
  sed -i '' 's/from "\(.*\)\.ts"/from "\1"/g' "$file"
  echo "Fixed imports in: $file"
done
```

**使用方法**:
```bash
chmod +x rename-tests.sh fix-imports.sh
./rename-tests.sh
./fix-imports.sh
npm run type-check:test
```

---

**作成日**: 2026-02-16
**最終更新**: 2026-02-16
**担当**: TypeScript Migration Team
**ステータス**: Ready for Execution
