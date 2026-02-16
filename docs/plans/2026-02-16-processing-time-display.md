# 処理時間表示機能 実装計画

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 「Obsidianに保存しました」メッセージに処理時間（全体とAI処理）を表示する

**Architecture:** フロントエンド（main.ts）で全体時間を測定、バックグラウンド（recordingLogic.ts）でAI処理時間を測定し、結果に含めて返す。errorUtils.tsに時間フォーマット関数を追加。

**Tech Stack:** TypeScript, Jest, Chrome Extension (Manifest V3)

---

## Task 1: 時間フォーマット関数の実装

**Files:**
- Modify: `src/popup/errorUtils.ts`
- Test: `src/popup/__tests__/errorUtils.test.ts`

**Step 1: Write the failing test**

`src/popup/__tests__/errorUtils.test.ts` に以下のテストを追加:

```typescript
describe('formatDuration', () => {
  it('should format milliseconds when less than 1 second', () => {
    expect(formatDuration(500)).toBe('500ms');
    expect(formatDuration(0)).toBe('0ms');
    expect(formatDuration(999)).toBe('999ms');
  });

  it('should format seconds when 1 second or more', () => {
    expect(formatDuration(1000)).toBe('1.0秒');
    expect(formatDuration(1234)).toBe('1.2秒');
    expect(formatDuration(5678)).toBe('5.7秒');
  });

  it('should round milliseconds to nearest integer', () => {
    expect(formatDuration(123.4)).toBe('123ms');
    expect(formatDuration(123.6)).toBe('124ms');
  });

  it('should round seconds to 1 decimal place', () => {
    expect(formatDuration(1234)).toBe('1.2秒');
    expect(formatDuration(1289)).toBe('1.3秒');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- errorUtils.test.ts`
Expected: FAIL with "formatDuration is not defined" or similar

**Step 3: Write minimal implementation**

`src/popup/errorUtils.ts` に以下の関数を追加（ファイル末尾のexport前に追加）:

```typescript
/**
 * 処理時間をフォーマット
 * @param ms - ミリ秒単位の時間
 * @returns フォーマットされた文字列 (例: "850ms" or "1.2秒")
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  return `${(ms / 1000).toFixed(1)}秒`;
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- errorUtils.test.ts`
Expected: All formatDuration tests PASS

**Step 5: Commit**

```bash
git add src/popup/errorUtils.ts src/popup/__tests__/errorUtils.test.ts
git commit -m "feat: add formatDuration function for time display

処理時間を人間が読みやすい形式でフォーマットする関数を追加。
1秒未満はミリ秒、1秒以上は秒（小数第1位）で表示。

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 2: 成功メッセージフォーマット関数の実装

**Files:**
- Modify: `src/popup/errorUtils.ts`
- Test: `src/popup/__tests__/errorUtils.test.ts`

**Step 1: Write the failing test**

`src/popup/__tests__/errorUtils.test.ts` に以下のテストを追加:

```typescript
describe('formatSuccessMessage', () => {
  beforeEach(() => {
    // getMessage('success') のモック
    (global as any).chrome = {
      i18n: {
        getMessage: jest.fn((key: string) => {
          if (key === 'success') return '✓ Obsidianに保存しました';
          return key;
        })
      }
    };
  });

  it('should format message with total time only', () => {
    const message = formatSuccessMessage(1234);
    expect(message).toBe('✓ Obsidianに保存しました (1.2秒)');
  });

  it('should format message with total and AI time', () => {
    const message = formatSuccessMessage(2000, 850);
    expect(message).toBe('✓ Obsidianに保存しました (2.0秒 / AI: 850ms)');
  });

  it('should not show AI time when undefined', () => {
    const message = formatSuccessMessage(1500, undefined);
    expect(message).toBe('✓ Obsidianに保存しました (1.5秒)');
  });

  it('should not show AI time when zero', () => {
    const message = formatSuccessMessage(1500, 0);
    expect(message).toBe('✓ Obsidianに保存しました (1.5秒)');
  });

  it('should handle both times in milliseconds', () => {
    const message = formatSuccessMessage(800, 300);
    expect(message).toBe('✓ Obsidianに保存しました (800ms / AI: 300ms)');
  });

  it('should handle both times in seconds', () => {
    const message = formatSuccessMessage(3456, 1234);
    expect(message).toBe('✓ Obsidianに保存しました (3.5秒 / AI: 1.2秒)');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- errorUtils.test.ts`
Expected: FAIL with "formatSuccessMessage is not defined"

**Step 3: Write minimal implementation**

`src/popup/errorUtils.ts` に以下の関数を追加:

```typescript
/**
 * 処理時間付き成功メッセージを生成
 * @param totalDuration - 全体処理時間 (ms)
 * @param aiDuration - AI処理時間 (ms, optional)
 * @returns フォーマットされたメッセージ
 */
export function formatSuccessMessage(
  totalDuration: number,
  aiDuration?: number
): string {
  const baseMessage = getMessage('success'); // "✓ Obsidianに保存しました"
  const totalTime = formatDuration(totalDuration);

  if (aiDuration !== undefined && aiDuration > 0) {
    const aiTime = formatDuration(aiDuration);
    return `${baseMessage} (${totalTime} / AI: ${aiTime})`;
  }

  return `${baseMessage} (${totalTime})`;
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- errorUtils.test.ts`
Expected: All formatSuccessMessage tests PASS

**Step 5: Commit**

```bash
git add src/popup/errorUtils.ts src/popup/__tests__/errorUtils.test.ts
git commit -m "feat: add formatSuccessMessage for time-enhanced success display

処理時間を含む成功メッセージを生成する関数を追加。
全体時間とAI時間（オプション）を表示可能。

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 3: RecordingResult型の拡張

**Files:**
- Modify: `src/background/recordingLogic.ts`

**Step 1: Add aiDuration field to interface**

`src/background/recordingLogic.ts` の `RecordingResult` interface（34-47行目付近）に `aiDuration` フィールドを追加:

```typescript
export interface RecordingResult {
  success: boolean;
  error?: string;
  skipped?: boolean;
  reason?: string;
  summary?: string;
  title?: string;
  url?: string;
  preview?: boolean;
  processedContent?: string;
  mode?: string;
  maskedCount?: number;
  maskedItems?: any[];
  aiDuration?: number; // 🆕 AI処理時間 (ms)
}
```

**Step 2: Verify TypeScript compilation**

Run: `npm run type-check`
Expected: No type errors

**Step 3: Commit**

```bash
git add src/background/recordingLogic.ts
git commit -m "feat: add aiDuration to RecordingResult interface

AI処理時間を結果に含められるよう型定義を拡張。

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 4: recordingLogic.tsでAI処理時間を測定

**Files:**
- Modify: `src/background/recordingLogic.ts`

**Step 1: Locate AI processing code**

`src/background/recordingLogic.ts` の `record()` メソッド内でAI処理を呼び出している箇所を特定。
`privacyPipeline.process()` 呼び出しの前後で時間を測定する必要がある。

**Step 2: Add time measurement around AI processing**

`record()` メソッド内の該当箇所を以下のように修正:

AI処理を含むフロー（`previewOnly` または通常の記録）で、`privacyPipeline.process()` の呼び出し前後に時間測定を追加:

```typescript
// AI処理開始時刻を記録
let aiDuration: number | undefined;

// プライバシーパイプライン処理（L1, L2, L3）
const aiStartTime = performance.now(); // 🆕

const pipelineResult: PrivacyPipelineResult = await privacyPipeline.process({
  content,
  mode: settings[StorageKeys.PRIVACY_MODE] || 'A',
  previewOnly,
  geminiApiKey: settings[StorageKeys.GEMINI_API_KEY],
  openaiApiKey: settings[StorageKeys.OPENAI_API_KEY],
  openai2ApiKey: settings[StorageKeys.OPENAI_2_API_KEY],
  aiProvider: settings[StorageKeys.AI_PROVIDER],
  geminiModel: settings[StorageKeys.GEMINI_MODEL],
  openaiModel: settings[StorageKeys.OPENAI_MODEL],
  openai2Model: settings[StorageKeys.OPENAI_2_MODEL],
  openaiBaseUrl: settings[StorageKeys.OPENAI_BASE_URL],
  openai2BaseUrl: settings[StorageKeys.OPENAI_2_BASE_URL],
  locale
});

const aiEndTime = performance.now(); // 🆕
aiDuration = aiEndTime - aiStartTime; // 🆕
```

そして、返却する `RecordingResult` に `aiDuration` を含める:

```typescript
return {
  success: true,
  processedContent: pipelineResult.processedContent,
  mode: pipelineResult.mode,
  maskedCount: pipelineResult.maskedCount,
  maskedItems: pipelineResult.maskedItems,
  preview: previewOnly,
  aiDuration: aiDuration // 🆕
};
```

**注意**: AI処理をスキップする場合（例: `alreadyProcessed` が true）は `aiDuration` を含めない。

**Step 3: Verify TypeScript compilation**

Run: `npm run type-check`
Expected: No type errors

**Step 4: Build and verify no runtime errors**

Run: `npm run build`
Expected: Build succeeds

**Step 5: Commit**

```bash
git add src/background/recordingLogic.ts
git commit -m "feat: measure AI processing time in recordingLogic

privacyPipeline.process()の処理時間を測定し、結果に含める。
AI処理がスキップされた場合はaiDurationを含めない。

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 5: main.tsで全体時間を測定して表示

**Files:**
- Modify: `src/popup/main.ts`

**Step 1: Import new functions**

`src/popup/main.ts` の冒頭のimport文に `formatSuccessMessage` を追加:

```typescript
import { showError, showSuccess, ErrorMessages, isDomainBlockedError, isConnectionError, formatSuccessMessage } from './errorUtils.js';
```

**Step 2: Add time measurement in recordCurrentPage**

`recordCurrentPage()` 関数（67行目付近）の開始時に時間測定を追加:

```typescript
export async function recordCurrentPage(force: boolean = false): Promise<void> {
  const startTime = performance.now(); // 🆕 開始時刻を記録
  const statusDiv = document.getElementById('mainStatus');
  const recordBtn = document.getElementById('recordBtn') as HTMLButtonElement | null;

  // ... 既存のコード ...
}
```

**Step 3: Replace success message with time-enhanced version**

`recordCurrentPage()` 関数内の成功時処理（181-188行目付近）を修正:

```typescript
if (result && result.success) {
  hideSpinner();

  // 🆕 処理時間を計算してメッセージ表示
  const totalDuration = performance.now() - startTime;
  const message = formatSuccessMessage(totalDuration, result.aiDuration);

  if (statusDiv) {
    statusDiv.textContent = message;
    statusDiv.className = 'success';
  }

  // 【自動クローズ起動】: 記録成功後に自動クローズタイマーを起動 🟢
  // 【処理方針】: 画面状態が'main'なら2秒後にポップアップを閉じる
  // 【テスト対応】: テストケース「startAutoCloseTimerでタイマーが起動し、2000ms後にwindow.closeが呼ばれる」
  startAutoCloseTimer();
} else {
  throw new Error(result.error || 'Save failed');
}
```

**Step 4: Verify TypeScript compilation**

Run: `npm run type-check`
Expected: No type errors

**Step 5: Build and verify**

Run: `npm run build`
Expected: Build succeeds

**Step 6: Commit**

```bash
git add src/popup/main.ts
git commit -m "feat: display processing time in success message

recordCurrentPage()で全体処理時間を測定し、
formatSuccessMessage()を使用して時間付きメッセージを表示。

表示例: "✓ Obsidianに保存しました (1.2秒 / AI: 850ms)"

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 6: 統合テストと手動検証

**Files:**
- Test: Manual verification in Chrome extension

**Step 1: Build the extension**

Run: `npm run build`
Expected: Build succeeds without errors

**Step 2: Load extension in Chrome**

1. Chrome で `chrome://extensions/` を開く
2. 「デベロッパーモード」を有効化
3. 「パッケージ化されていない拡張機能を読み込む」
4. `dist/` ディレクトリを選択

**Step 3: Test with AI processing**

1. 適当なWebページを開く
2. 拡張機能のポップアップを開く
3. 「📝 Record Now」ボタンをクリック
4. 成功メッセージに処理時間が表示されることを確認
5. AI処理時間も表示されることを確認（例: "✓ Obsidianに保存しました (2.3秒 / AI: 1.5秒)"）

**Step 4: Test without AI processing (if applicable)**

Privacy Modeを変更してAI処理をスキップする設定にした場合、AI時間が表示されないことを確認。

**Step 5: Verify time format**

- 1秒未満の処理の場合、ミリ秒表示されることを確認（例: "850ms"）
- 1秒以上の処理の場合、秒表示されることを確認（例: "1.2秒"）

**Step 6: Run all tests**

Run: `npm test`
Expected: All tests pass

**Step 7: Final commit**

```bash
git add .
git commit -m "test: verify processing time display in Chrome extension

手動検証完了:
- 全体処理時間が正しく表示される
- AI処理時間が正しく表示される
- 時間フォーマットが正しい (ms/秒の切り替え)
- 全自動テストが通過

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 7: ドキュメント更新

**Files:**
- Modify: `CHANGELOG.md`

**Step 1: Update CHANGELOG.md**

`CHANGELOG.md` の `[Unreleased]` セクションまたは次のバージョンセクションに以下を追加:

```markdown
### Added
- **処理時間表示**: 保存成功メッセージに処理時間を表示する機能を追加
  - ボタンクリックから保存完了までの全体時間を表示
  - AI処理時間を別途表示（例: "✓ Obsidianに保存しました (1.2秒 / AI: 850ms)"）
  - 1秒未満はミリ秒、1秒以上は秒（小数第1位）で自動切り替え
```

**Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: update CHANGELOG for processing time display feature

処理時間表示機能の追加をCHANGELOGに記載。

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 8: 最終確認とクリーンアップ

**Step 1: Run full test suite**

Run: `npm test`
Expected: All tests pass

**Step 2: Run type checking**

Run: `npm run type-check`
Expected: No type errors

**Step 3: Build for production**

Run: `npm run build`
Expected: Build succeeds

**Step 4: Verify git status**

Run: `git status`
Expected: Working directory clean

**Step 5: Review commit history**

Run: `git log --oneline -10`
Expected: All commits follow conventional commit format

---

## 完了条件

- [x] `formatDuration()` 関数が実装され、テストが通る
- [x] `formatSuccessMessage()` 関数が実装され、テストが通る
- [x] `RecordingResult` interfaceに `aiDuration` フィールドが追加される
- [x] `recordingLogic.ts` でAI処理時間が測定される
- [ ] `main.ts` で全体時間が測定され、時間付きメッセージが表示される
- [ ] 全テストが通過する
- [ ] TypeScriptコンパイルエラーがない
- [ ] Chrome拡張機能として動作確認できる
- [ ] CHANGELOGが更新される

## 実装状況 (2026-02-15 更新)

### ✅ 完了済み

| Task | ステータス | 詳細 |
|------|----------|------|
| Task 1 | ✅ 完了 | `formatDuration()` が `src/popup/errorUtils.ts` (329-339行目) に実装済み |
| Task 2 | ✅ 完了 | `formatSuccessMessage()` が `src/popup/errorUtils.ts` (347-360行目) に実装済み |
| Task 3 | ✅ 完了 | `RecordingResult` interface に `aiDuration` フィールドが追加済み (47-48行目) |
| Task 4 | ✅ 完了 | AI処理時間の測定が `src/background/recordingLogic.ts` (246-257行目) に実装済み |

### ❌ 未完了

| Task | ステータス | 詳細 |
|------|----------|------|
| Task 5 | ❌ 未完了 | `main.ts` で `formatSuccessMessage` が import されていない、全体時間測定未実装 |
| Task 6 | ❌ 未完了 | テストファイル `src/popup/__tests__/errorUtils.test.ts` が存在しない |
| Task 7 | ❌ 未完了 | CHANGELOG.md に処理時間表示機能の記載がない |
| Task 8 | ❌ 未完了 | 最終確認とクリーンアップ未実施 |

## 次にやること

### 優先度1: Task 5の実装（main.tsの修正）

`src/popup/main.ts` で以下の変更が必要：

1. **import文の追加** (7行目付近):
   ```typescript
   import { showError, showSuccess, ErrorMessages, isDomainBlockedError, isConnectionError, formatSuccessMessage } from './errorUtils.js';
   ```

2. **全体時間の測定** (67行目の `recordCurrentPage()` 関数の開始時):
   ```typescript
   const startTime = performance.now();
   ```

3. **成功メッセージの置換** (181-183行目付近):
   ```typescript
   if (result && result.success) {
     hideSpinner();
     const totalDuration = performance.now() - startTime;
     const message = formatSuccessMessage(totalDuration, result.aiDuration);
     showSuccess(statusDiv, message);
     startAutoCloseTimer();
   }
   ```

### 優先度2: テストファイルの作成

`src/popup/__tests__/errorUtils.test.ts` を作成し、以下のテストを追加：

- `formatDuration()` のテスト（ミリ秒表示、秒表示、丸め処理）
- `formatSuccessMessage()` のテスト（全体時間のみ、AI時間付き、AI時間なしの場合）

### 優先度3: CHANGELOGの更新

`CHANGELOG.md` の `[Unreleased]` セクションまたは次のバージョンセクションに以下を追加：

```markdown
### Added
- **処理時間表示**: 保存成功メッセージに処理時間を表示する機能を追加
  - ボタンクリックから保存完了までの全体時間を表示
  - AI処理時間を別途表示（例: "✓ Obsidianに保存しました (1.2秒 / AI: 850ms)"）
  - 1秒未満はミリ秒、1秒以上は秒（小数第1位）で自動切り替え
```

### 優先度4: 最終確認とクリーンアップ

- 全テストの実行
- TypeScriptコンパイルチェック
- ビルド確認
- Chrome拡張機能としての手動検証

## 参考資料

- 設計書: `docs/plans/2026-02-16-processing-time-display-design.md`
- TypeScript公式ドキュメント: https://www.typescriptlang.org/docs/
- Chrome Extension API: https://developer.chrome.com/docs/extensions/reference/
