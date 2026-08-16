# logCritical通知サニタイズ 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `logCritical()`がOS通知（`chrome.notifications`）に渡すメッセージを、既存のPIIマスキング関数`sanitizeRegex`でサニタイズしてから渡すようにし、APIキー等の機密情報が通知に生で表示される事故を防ぐ。

**Architecture:** `src/utils/logger/api.ts`の`logCritical`内で、既存の`sanitizeRegex`（`src/utils/piiSanitizer.ts`）を`message`に適用してから`sink.raise(...)`に渡す。`src/utils/logger/core.ts`の`addLog`が既に同じ関数を同じパターンで使っているため、そのパターンをそのまま踏襲する。

**Tech Stack:** TypeScript, Vitest（`environment: 'node'`, `globals: true`）

---

## 事前に必ず読むこと

1. **テストランナーはVitestです。** `describe`/`it`/`expect`/`vi`はグローバルに使えます。
2. **`sanitizeRegex`は非同期関数です。** `await`を忘れると`Promise`オブジェクトがそのまま文字列として扱われてしまうバグになります。
3. **`sanitizeRegex`の戻り値は`{ text: string, maskedItems: MaskedItem[], error?: string }`という形のオブジェクトです。** マスキングが何も発生しなかった場合、`maskedItems`は空配列になり、`text`は入力と同じ内容になります。

---

## Task 1: 既存の`logCritical`実装とテストを確認する

**Files:**
- Read（変更しない）: `src/utils/logger/api.ts:179-202`
- Read（変更しない）: `src/utils/__tests__/logCritical.test.ts`

- [ ] **Step 1: 現在の`logCritical`実装を確認する**

```bash
sed -n '179,202p' src/utils/logger/api.ts
```

以下のような内容が表示されます:

```typescript
export async function logCritical<T extends object = Record<string, unknown>>(
    message: string,
    details: T = {} as T,
    errorCode: ErrorCodeValues = ErrorCode.UNKNOWN_ERROR,
    source?: string,
    sink: CriticalAlertSink = defaultCriticalSink,
): Promise<void> {
    const entry = createStructuredLog(LogType.ERROR, message, details, errorCode, source);
    await writeStructuredLog(entry);
    await flushLogs(true);

    console.error(`[CRITICAL:${errorCode}] ${message} ${JSON.stringify(details, ...)}`);

    sink.raise(message, details as Record<string, unknown>, errorCode);
}
```

**問題点**: 最後の`sink.raise(message, ...)`が、関数の引数としてそのまま渡された`message`（サニタイズされていない生の文字列）を使っています。

- [ ] **Step 2: `addLog`が同じ`sanitizeRegex`をどう使っているか確認する**

```bash
grep -n "sanitizeRegex" src/utils/logger/core.ts
```

`src/utils/logger/core.ts`の60行目付近に以下のようなコードがあるはずです（このパターンを`logCritical`でも踏襲します）:

```typescript
const sanitizedMessage = await sanitizeRegex(message);
// ...
message: sanitizedMessage.maskedItems.length > 0 ? sanitizedMessage.text : message,
```

**なぜこのパターンを踏襲するか**: プロジェクト内で既に確立されているサニタイズの使い方に合わせることで、コードの一貫性を保ちます。`maskedItems.length > 0`のときだけサニタイズ後の`text`を使うのは、何もマスキングされなかった場合は元の`message`をそのまま使っても安全なためです（`sanitizeRegex`はマスキングが発生しない場合、入力と同じ内容を`text`に返します）。

- [ ] **Step 3: 既存テストファイルの中身を確認する**

```bash
cat src/utils/__tests__/logCritical.test.ts
```

以下の内容が表示されます:

```typescript
import * as logger from '../logger.js';
import { FakeCriticalSink } from '../logger/criticalAlertSink.js';
import { ErrorCode } from '../logger/types.js';

describe('logCritical', () => {
  it('records and raises via injected sink', async () => {
    const sink = new FakeCriticalSink();
    await logger.logCritical('disk full', { x: 1 }, ErrorCode.STORAGE_WRITE_FAILURE, 'test', sink);
    expect(sink.raised).toHaveLength(1);
    expect(sink.raised[0].message).toBe('disk full');
  });

  it('works without a sink (uses default no-op in test env)', async () => {
    await logger.logCritical('noop', {}, ErrorCode.UNKNOWN_ERROR, 'test');
  });
});
```

**このテストで分かること**: `FakeCriticalSink`というテスト用の`sink`実装が既に用意されており、`sink.raised`配列で`raise()`に渡された引数を記録・検証できます。今回追加するテストもこのパターンをそのまま使います。

（このタスクは調査のみです。コミット不要です。）

---

## Task 2: 失敗するテストを書く

**Files:**
- Modify: `src/utils/__tests__/logCritical.test.ts`

- [ ] **Step 1: 機密情報を含むメッセージのテストケースを追加する**

`src/utils/__tests__/logCritical.test.ts`の`describe('logCritical', () => { ... });`ブロックの中、既存の2つの`it`の後に以下を追加してください。

```typescript
  it('sanitizes API-key-like content in the message before raising it to the sink', async () => {
    const sink = new FakeCriticalSink();
    // メールアドレスはこのプロジェクトのPIIパターン（piiSanitizer.ts）で
    // 確実に検出・マスキングされる代表的なパターンなので、これを使う。
    const messageWithPii = 'Failed to sync for user test@example.com';
    await logger.logCritical(messageWithPii, {}, ErrorCode.UNKNOWN_ERROR, 'test', sink);

    expect(sink.raised).toHaveLength(1);
    expect(sink.raised[0].message).not.toBe(messageWithPii);
    expect(sink.raised[0].message).not.toContain('test@example.com');
  });

  it('leaves messages without sensitive content unchanged when raising to the sink', async () => {
    const sink = new FakeCriticalSink();
    const plainMessage = 'SQLite sync failed';
    await logger.logCritical(plainMessage, {}, ErrorCode.UNKNOWN_ERROR, 'test', sink);

    expect(sink.raised).toHaveLength(1);
    expect(sink.raised[0].message).toBe(plainMessage);
  });
```

**なぜメールアドレスをテストデータに選んだか**: `src/utils/piiSanitizer.ts`のPIIパターンの中で、メールアドレスは最も確実に検出される代表的なパターンです（正規表現の詳細を調べなくても、"@"を含む文字列は高確率でマスキング対象になります）。APIキーのパターンを使うことも可能ですが、パターンの正確な形式（プレフィックスなど）を調べる手間が省けるため、まずメールアドレスで検証します。

- [ ] **Step 2: テストを実行し、1つ目の新規テストが失敗することを確認する**

```bash
npx vitest run src/utils/__tests__/logCritical.test.ts
```

**期待される結果**: `sanitizes API-key-like content in the message before raising it to the sink`というテストが失敗する（`sink.raised[0].message`が`messageWithPii`と一致してしまっている、つまり`not.toBe`のアサーションが満たされない）。2つ目の`leaves messages without sensitive content unchanged`テストは、まだ実装を変えていないので既にパスするはずです（サニタイズなしでも元の文字列がそのまま使われるため）。

- [ ] **Step 3: コミットする**

```bash
git add src/utils/__tests__/logCritical.test.ts
git commit -m "test(logger): add failing test for unsanitized message in critical notifications"
```

---

## Task 3: `logCritical`にサニタイズを実装する

**Files:**
- Modify: `src/utils/logger/api.ts`

- [ ] **Step 1: `sanitizeRegex`をimportする**

`src/utils/logger/api.ts`の先頭付近、既存のimport群を確認してください。

```bash
sed -n '1,15p' src/utils/logger/api.ts
```

`import { addLog, flushLogs, isDevelopment } from './core.js';`のような行の近くに、以下のimportを追加してください。

```typescript
import { sanitizeRegex } from '../piiSanitizer.js';
```

**なぜこのパスか**: `src/utils/logger/api.ts`から見て`src/utils/piiSanitizer.ts`への相対パスは`../piiSanitizer.js`です（`logger/`ディレクトリから1つ上がる）。

- [ ] **Step 2: `logCritical`内でサニタイズしてから`sink.raise`に渡す**

`src/utils/logger/api.ts`の`logCritical`関数を以下のように書き換えてください。

変更前:

```typescript
export async function logCritical<T extends object = Record<string, unknown>>(
    message: string,
    details: T = {} as T,
    errorCode: ErrorCodeValues = ErrorCode.UNKNOWN_ERROR,
    source?: string,
    sink: CriticalAlertSink = defaultCriticalSink,
): Promise<void> {
    const entry = createStructuredLog(LogType.ERROR, message, details, errorCode, source);
    await writeStructuredLog(entry);
    // Critical logs are flushed immediately so they are not lost on SW termination.
    await flushLogs(true);

    console.error(`[CRITICAL:${errorCode}] ${message} ${JSON.stringify(details, (key, value) => {
        if (typeof value === 'string' && value.length > 128) {
            return value.slice(0, 128) + '...[truncated]';
        }
        if (typeof value === 'string' && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value) && value.length > 40) {
            return value.slice(0, 8) + '...[redacted]';
        }
        return value;
    })}`);

    sink.raise(message, details as Record<string, unknown>, errorCode);
}
```

変更後:

```typescript
export async function logCritical<T extends object = Record<string, unknown>>(
    message: string,
    details: T = {} as T,
    errorCode: ErrorCodeValues = ErrorCode.UNKNOWN_ERROR,
    source?: string,
    sink: CriticalAlertSink = defaultCriticalSink,
): Promise<void> {
    const entry = createStructuredLog(LogType.ERROR, message, details, errorCode, source);
    await writeStructuredLog(entry);
    // Critical logs are flushed immediately so they are not lost on SW termination.
    await flushLogs(true);

    console.error(`[CRITICAL:${errorCode}] ${message} ${JSON.stringify(details, (key, value) => {
        if (typeof value === 'string' && value.length > 128) {
            return value.slice(0, 128) + '...[truncated]';
        }
        if (typeof value === 'string' && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value) && value.length > 40) {
            return value.slice(0, 8) + '...[redacted]';
        }
        return value;
    })}`);

    // OS通知は chrome.storage への保存経路（addLog）とは別経路のため、
    // ここでも明示的にサニタイズする。addLog内のサニタイズは通知には効かない。
    const sanitizedMessage = await sanitizeRegex(message);
    const notificationMessage = sanitizedMessage.maskedItems.length > 0 ? sanitizedMessage.text : message;
    sink.raise(notificationMessage, details as Record<string, unknown>, errorCode);
}
```

**変更点**: `sink.raise`に渡す直前に`sanitizeRegex`で`message`をサニタイズし、その結果（`notificationMessage`）を使うようにしました。`console.error`と`writeStructuredLog`への`message`渡しは変更していません（`console.error`はこのPBIのスコープ外、`writeStructuredLog`経由の`addLog`は既に内部でサニタイズしています）。

- [ ] **Step 3: 型チェックを実行する**

```bash
npm run type-check
```

**期待される結果**: エラーなく終了すること。

- [ ] **Step 4: テストを実行し、グリーンになることを確認する**

```bash
npx vitest run src/utils/__tests__/logCritical.test.ts
```

**期待される結果**: 4つのテスト全てが成功すること（既存2つ＋Task 2で追加した2つ）。

- [ ] **Step 5: コミットする**

```bash
git add src/utils/logger/api.ts
git commit -m "fix(logger): sanitize logCritical message before raising OS notification"
```

---

## Task 4: 関連する既存コード・テストへの影響を確認する

**Files:**
- Read（変更しない）: `src/background/sqliteAlert.ts:41-54`
- Read/Run（変更しない）: `src/utils/__tests__/criticalAlertSink.test.ts`

**確認済みの事実**: プロジェクト内で`logCritical`を実際に呼び出しているのは`src/background/sqliteAlert.ts`の1箇所のみです（`grep -rln "logCritical" src --include="*.ts" | grep -v __tests__`で確認済み、他は`logger.ts`/`logger/criticalAlertSink.ts`/`logger/api.ts`という定義側のファイルのみ）。この`sqliteAlert.ts`専用のテストファイル（`sqliteAlert.test.ts`）は現時点でこのプロジェクトに存在しません。そのため、このタスクでは実行すべき既存テストはなく、コードを読んで影響がないことを確認するだけで十分です。

- [ ] **Step 1: `sqliteAlert.ts`の呼び出し内容を確認する（確認済みの内容）**

`src/background/sqliteAlert.ts:47-53`は以下の内容です。

```typescript
void logCritical(
    `SQLite persistent failure in ${component}`,
    { component, totalFailures: ALERT_THRESHOLD, lastError: error },
    ErrorCode.STORAGE_READ_FAILURE,
    'sqliteAlert',
    criticalSink
);
```

`message`は`` `SQLite persistent failure in ${component}` ``というテンプレート文字列で、`component`は呼び出し元から渡される変数です。この`component`にメールアドレスや電話番号のようなPIIパターンに偶然マッチする文字列が入る可能性は低い（通常は`"dashboardSqliteService"`のような固定のコンポーネント名文字列のはずです）が、念のため`component`が実際にどんな値を取りうるか確認してください。

```bash
grep -rn "sqliteAlert\|reportSqliteFailure" src/background/*.ts | grep -v __tests__ | grep -v "sqliteAlert.ts:"
```

このコマンドで`sqliteAlert.ts`内の関数を呼び出している箇所が見つかります。渡されている`component`引数の値（文字列リテラルのはず）を確認し、PIIパターンに偶然マッチしそうな値でないことを目視で確認してください。

- [ ] **Step 2: `criticalAlertSink.test.ts`を実行する**

```bash
npx vitest run src/utils/__tests__/criticalAlertSink.test.ts
```

**期待される結果**: 全て成功すること。このファイルは`logCritical`を直接呼んでおらず`ChromeNotificationCriticalSink`/`FakeCriticalSink`単体のテストのため、Task 3の変更（`logCritical`内部のサニタイズ追加）による影響を受けません。念のため実行して確認します。

- [ ] **Step 3: プロジェクト全体のテストと型チェックを実行する**

```bash
npm run validate
```

**期待される結果**: 型チェック・テストの両方が成功すること。もし何らかのテストが失敗した場合、そのテストが「`logCritical`や`sink.raise`に渡される`message`が特定の文字列と完全一致すること」を検証しているのに、その文字列がたまたまPIIパターンに偶然マッチしてマスキングされてしまった可能性があります。その場合はテストデータの文字列を変更するのではなく、まず失敗したテストの内容を読み、意図と合わない場合のみ判断に迷わず立ち止まって確認してください。

---

## Task 5: PBIをDONEとしてアーカイブする

**Files:**
- Modify: `pbi/00-INDEX.md`
- Move: `pbi/2026-08-13-02-fix-log-critical-sanitize-notification.md` → `dev-docs/archived/pbi/`

- [ ] **Step 1: PBIファイルをアーカイブディレクトリへ移動する**

```bash
mkdir -p dev-docs/archived/pbi
git mv pbi/2026-08-13-02-fix-log-critical-sanitize-notification.md dev-docs/archived/pbi/
```

- [ ] **Step 2: `pbi/00-INDEX.md`を更新する**

「進行中」テーブルから該当行を削除し、「アーカイブ履歴」セクションに追記してください。

```markdown
- 2026-08-13-02-fix-log-critical-sanitize-notification.md (logCriticalのOS通知にsanitizeRegex適用、PII/APIキー漏洩を防止)
```

- [ ] **Step 3: コミットする**

```bash
git add pbi/00-INDEX.md dev-docs/archived/pbi/2026-08-13-02-fix-log-critical-sanitize-notification.md
git commit -m "docs(pbi): archive completed log-critical-sanitize-notification PBI"
```

---

## 完了チェックリスト

- [ ] `npx vitest run src/utils/__tests__/logCritical.test.ts` がグリーン（4テスト）
- [ ] `npm run validate`（型チェック＋全テスト）がグリーン
- [ ] `pbi/00-INDEX.md`が更新され、PBIがアーカイブされている
