# PBI-24: `.db` バイナリエクスポート・インポート 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** SQLite データベースのバイナリ `.db` エクスポートと、重複排除付きインポートを実装する

**Architecture:** OPFS Worker 経由でデータベースファイルに直接アクセスし、`createSyncAccessHandle` でバイナリコピーを取得する。インポート時は既存の `INSERT OR IGNORE` バッチインサートを活用する。IDB/FallbackStorage パスでは JSON エクスポートにフォールバックする。

**Tech Stack:** TypeScript, @subframe7536/sqlite-wasm, OPFS API, Vitest

---

## ファイル構成

| ファイル | 役割 | 変更種別 |
|---------|------|---------|
| `src/offscreen/opfsWorker.ts` | `DB_BACKUP` メッセージハンドラ追加 | 変更 |
| `src/offscreen/sqlite.ts` | `backupDatabase()` 関数追加 | 変更 |
| `src/offscreen/offscreen.ts` | `SQLITE_BACKUP` メッセージルーティング追加 | 変更 |
| `src/background/sqliteClient.ts` | `backupDb()` メソッド追加 | 変更 |
| `src/dashboard/exportImport.ts` | `.db` エクスポート/インポート UI 追加 | 変更 |
| `src/dashboard/exportImportService.ts` | エクスポート/インポートサービス追加 | 新規 |
| `src/dashboard/__tests__/exportImportService.test.ts` | サービステスト | 新規 |

---

## 技術的制約

1. **OPFS パス**: `@subframe7536/sqlite-wasm` + OPFSCoopSyncVFS で使用中のデータベースファイルは `createSyncAccessHandle` で読み取り可能
2. **IDB パス**: wa-sqlite の `sqlite3_serialize` はサポートされていない → JSON エクスポートにフォールバック
3. **FallbackStorage パス**: `chrome.storage.local` のデータを JSON としてエクスポート
4. **インポート**: 全パスで `INSERT OR IGNORE`（`UNIQUE(url, created_at)` 制約）を使用

---

### Task 1: OPFS Worker に DB_BACKUP メッセージハンドラを追加

**Files:**
- Modify: `src/offscreen/opfsWorker.ts` (ハンドラ追加)

- [ ] **Step 1: テストを書く — DB_BACKUP の応答形式**

```typescript
// src/offscreen/__tests__/opfsWorker-backup.test.ts を新規作成
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('OPFS Worker DB_BACKUP', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return Uint8Array when DB_BACKUP message is received', async () => {
    // OPFS Worker のモック
    const mockSyncAccessHandle = {
      read: vi.fn().mockImplementation((buffer) => {
        // ダミーデータを書き込む
        const view = new Uint8Array(buffer);
        view[0] = 0x53; // 'S' (SQLite header magic)
        view[1] = 0x51;
        view[2] = 0x4c;
        view[3] = 0x69;
        view[4] = 0x74;
        view[5] = 0x65;
        view[6] = 0x20;
        view[7] = 0x66;
        view[8] = 0x6f;
        view[9] = 0x72;
        view[10] = 0x6d;
        view[11] = 0x61;
        view[12] = 0x74;
        view[13] = 0x20;
        view[14] = 0x33;
        view[15] = 0x00;
        return 16;
      }),
      getSize: vi.fn().mockReturnValue(16),
      close: vi.fn(),
    };

    // OPFS ディレクトリのモック
    const mockDirectory = {
      getFileHandle: vi.fn().mockResolvedValue({
        createSyncAccessHandle: vi.fn().mockReturnValue(mockSyncAccessHandle),
      }),
    };

    // navigator.storage.getDirectory のモック
    Object.defineProperty(navigator, 'storage', {
      value: {
        getDirectory: vi.fn().mockResolvedValue(mockDirectory),
      },
      writable: true,
    });

    // DB_BACKUP メッセージを送信
    const result = await sendToOpfsWorker({
      type: 'DB_BACKUP',
      payload: { dbName: 'yasumaro.db' },
    });

    expect(result.success).toBe(true);
    expect(result.data).toBeInstanceOf(Uint8Array);
    expect(result.data.length).toBe(16);
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npx vitest run src/offscreen/__tests__/opfsWorker-backup.test.ts`
Expected: FAIL (DB_BACKUP ハンドラが未定義)

- [ ] **Step 3: OPFS Worker に DB_BACKUP ハンドラを追加**

```typescript
// src/offscreen/opfsWorker.ts の handleBackup 関数を追加

async function handleBackup(payload: { dbName: string }): Promise<Uint8Array> {
  const { dbName } = payload;

  // OPFS ディレクトリを取得
  const root = await navigator.storage.getDirectory();
  const fileHandle = await root.getFileHandle(dbName);
  const accessHandle = await fileHandle.createSyncAccessHandle();

  try {
    // ファイルサイズを取得
    const fileSize = accessHandle.getSize();

    // バッファを確保して読み込み
    const buffer = new ArrayBuffer(fileSize);
    const dataView = new DataView(buffer);
    let totalRead = 0;

    // チャンク単位で読み込み（大きなファイル対応）
    const CHUNK_SIZE = 1024 * 1024; // 1MB
    while (totalRead < fileSize) {
      const remaining = fileSize - totalRead;
      const readSize = Math.min(CHUNK_SIZE, remaining);
      const readBuffer = new ArrayBuffer(readSize);
      const bytesRead = accessHandle.read(readBuffer, { at: totalRead });

      // バッファにコピー
      const srcView = new Uint8Array(readBuffer);
      const dstView = new Uint8Array(buffer, totalRead, bytesRead);
      dstView.set(srcView.slice(0, bytesRead));

      totalRead += bytesRead;

      if (bytesRead === 0) break; // EOF
    }

    return new Uint8Array(buffer);
  } finally {
    accessHandle.close();
  }
}

// message handler に追加
case 'DB_BACKUP':
  const backupData = await handleBackup(message.payload);
  self.postMessage({
    id: message.id,
    success: true,
    result: backupData,
  });
  break;
```

- [ ] **Step 4: テストを実行してパスを確認**

Run: `npx vitest run src/offscreen/__tests__/opfsWorker-backup.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/offscreen/opfsWorker.ts src/offscreen/__tests__/opfsWorker-backup.test.ts
git commit -m "feat(opfs): add DB_BACKUP message handler"
```

---

### Task 2: sqlite.ts に backupDatabase() 関数を追加

**Files:**
- Modify: `src/offscreen/sqlite.ts`

- [ ] **Step 1: テストを書く — backupDatabase の動作**

```typescript
// src/offscreen/__tests__/sqlite-backup.test.ts を新規作成
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { backupDatabase } from '../sqlite';

describe('backupDatabase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return Uint8Array from OPFS Worker when available', async () => {
    const mockData = new Uint8Array([0x53, 0x51, 0x4c]);
    vi.mock('../opfsWorker', () => ({
      tryOpfsProxy: vi.fn().mockResolvedValue({
        success: true,
        data: mockData,
      }),
    }));

    const result = await backupDatabase();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBeInstanceOf(Uint8Array);
      expect(result.data).toEqual(mockData);
    }
  });

  it('should fall back to JSON export when OPFS is unavailable', async () => {
    vi.mock('../opfsWorker', () => ({
      tryOpfsProxy: vi.fn().mockRejectedValue(new Error('OPFS unavailable')),
    }));

    // serialize 関数のモック
    vi.mock('../sqlite', async (importOriginal) => {
      const mod = await importOriginal();
      return {
        ...mod,
        serialize: vi.fn().mockResolvedValue({
          success: true,
          data: new Uint8Array([0x7b, 0x22, 0x76]), // JSON ヘッダー
        }),
      };
    });

    const result = await backupDatabase();

    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npx vitest run src/offscreen/__tests__/sqlite-backup.test.ts`
Expected: FAIL (backupDatabase が未定義)

- [ ] **Step 3: backupDatabase 関数を追加**

```typescript
// src/offscreen/sqlite.ts に追加

export async function backupDatabase(): Promise<
  { success: true; data: Uint8Array; format: 'sqlite' | 'json' } |
  { success: false; error: string }
> {
  try {
    // Tier 1: OPFS Worker でバイナリバックアップを試行
    if (usingOpfsWorker) {
      try {
        const result = await tryOpfsProxy<Uint8Array>('DB_BACKUP', {
          dbName: 'yasumaro.db',
        });
        if (result.success && result.data) {
          return { success: true, data: result.data, format: 'sqlite' };
        }
      } catch (opfsError) {
        console.warn('OPFS backup failed, falling back to JSON:', opfsError);
      }
    }

    // Tier 2: JSON エクスポートにフォールバック
    const serializeResult = await serialize();
    if (serializeResult.success) {
      return { success: true, data: serializeResult.data, format: 'json' };
    }

    return { success: false, error: 'All backup methods failed' };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
```

- [ ] **Step 4: テストを実行してパスを確認**

Run: `npx vitest run src/offscreen/__tests__/sqlite-backup.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/offscreen/sqlite.ts src/offscreen/__tests__/sqlite-backup.test.ts
git commit -m "feat(sqlite): add backupDatabase function"
```

---

### Task 3: offscreen.ts に SQLITE_BACKUP メッセージルーティングを追加

**Files:**
- Modify: `src/offscreen/offscreen.ts`

- [ ] **Step 1: メッセージルーティングを追加**

```typescript
// src/offscreen/offscreen.ts の SQLITE_* ハンドラセクションに追加

case 'SQLITE_BACKUP':
  // コンテンツスクリプトからの呼び出しをブロック
  if (sender.tab) {
    sendResponse({ success: false, error: 'SQLite operations from content scripts are not allowed' });
    return false;
  }
  // 外部拡張からの呼び出しをブロック
  if (sender.id !== chrome.runtime.id) {
    sendResponse({ success: false, error: 'Unauthorized sender' });
    return false;
  }
  const backupResult = await backupDatabase();
  sendResponse(backupResult);
  return false;
```

- [ ] **Step 2: セキュリティテストを追加**

```typescript
// src/offscreen/__tests__/sqlite-security-integrity.test.ts に追加
describe('SQLITE_BACKUP security', () => {
  it('should block backup from content scripts', async () => {
    const sender = { tab: { id: 1 } };
    const result = await handleMessage(
      { type: 'SQLITE_BACKUP', target: 'offscreen' },
      sender
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('content scripts');
  });

  it('should block backup from external extensions', async () => {
    const sender = { id: 'external-extension-id' };
    const result = await handleMessage(
      { type: 'SQLITE_BACKUP', target: 'offscreen' },
      sender
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unauthorized');
  });
});
```

- [ ] **Step 3: テストを実行してパスを確認**

Run: `npx vitest run src/offscreen/__tests__/sqlite-security-integrity.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/offscreen/offscreen.ts src/offscreen/__tests__/sqlite-security-integrity.test.ts
git commit -m "feat(offscreen): add SQLITE_BACKUP message routing"
```

---

### Task 4: SqliteClient に backupDb() メソッドを追加

**Files:**
- Modify: `src/background/sqliteClient.ts`

- [ ] **Step 1: メソッドを追加**

```typescript
// src/background/sqliteClient.ts に追加

async backupDb(): Promise<{ success: boolean; data?: Uint8Array; format?: string; error?: string }> {
  const response = await this.msgOffscreen('SQLITE_BACKUP');
  if (response.success) {
    return {
      success: true,
      data: response.data as Uint8Array,
      format: response.format as string,
    };
  }
  return { success: false, error: response.error as string };
}
```

- [ ] **Step 2: テストを追加**

```typescript
// src/background/__tests__/sqliteClient.test.ts に追加
describe('backupDb', () => {
  it('should call msgOffscreen with SQLITE_BACKUP type', async () => {
    const mockResponse = {
      success: true,
      data: new Uint8Array([0x53, 0x51, 0x4c]),
      format: 'sqlite',
    };
    vi.spyOn(client, 'msgOffscreen').mockResolvedValue(mockResponse);

    const result = await client.backupDb();

    expect(result.success).toBe(true);
    expect(result.data).toBeInstanceOf(Uint8Array);
    expect(result.format).toBe('sqlite');
    expect(client.msgOffscreen).toHaveBeenCalledWith('SQLITE_BACKUP');
  });
});
```

- [ ] **Step 3: テストを実行してパスを確認**

Run: `npx vitest run src/background/__tests__/sqliteClient.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/background/sqliteClient.ts src/background/__tests__/sqliteClient.test.ts
git commit -m "feat(sqlite-client): add backupDb method"
```

---

### Task 5: Dashboard に .db エクスポート/インポート UI を追加

**Files:**
- Create: `src/dashboard/exportImportService.ts`
- Modify: `src/dashboard/exportImport.ts`

- [ ] **Step 1: exportImportService.ts を作成**

```typescript
// src/dashboard/exportImportService.ts を新規作成

import { sendDashboardMessage } from './dashboardMessage';

export interface BackupResult {
  success: boolean;
  filename?: string;
  format?: string;
  error?: string;
}

/**
 * SQLite データベースをバイナリでエクスポート
 */
export async function exportDatabase(): Promise<BackupResult> {
  try {
    const response = await sendDashboardMessage({
      type: 'DASHBOARD_SQLITE',
      subtype: 'backup',
    });

    if (!response.success) {
      return { success: false, error: response.error as string };
    }

    const data = response.data as Uint8Array;
    const format = response.format as string;

    // ファイル名を生成
    const date = new Date().toISOString().split('T')[0];
    const ext = format === 'sqlite' ? 'db' : 'json';
    const filename = `yasumaro-${date}.${ext}`;

    // ダウンロードを実行
    const mimeType = format === 'sqlite' ? 'application/x-sqlite3' : 'application/json';
    const blob = new Blob([data], { type: mimeType });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    return { success: true, filename, format };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Export failed',
    };
  }
}

/**
 * SQLite データベースをインポート（JSON 形式）
 */
export async function importDatabase(
  file: File
): Promise<{ success: boolean; imported?: number; skipped?: number; error?: string }> {
  try {
    const text = await file.text();
    const data = JSON.parse(text);

    // JSON 形式の検証
    if (!data.table || !Array.isArray(data.rows)) {
      return { success: false, error: 'Invalid import file format' };
    }

    // バッチインサート（重複排除）
    let imported = 0;
    let skipped = 0;
    const BATCH_SIZE = 200;

    for (let i = 0; i < data.rows.length; i += BATCH_SIZE) {
      const batch = data.rows.slice(i, i + BATCH_SIZE);
      const result = await sendDashboardMessage({
        type: 'DASHBOARD_SQLITE',
        subtype: 'import',
        records: batch,
      });

      if (result.success) {
        imported += (result.imported as number) || 0;
        skipped += (result.skipped as number) || 0;
      }
    }

    return { success: true, imported, skipped };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Import failed',
    };
  }
}
```

- [ ] **Step 2: テストを追加**

```typescript
// src/dashboard/__tests__/exportImportService.test.ts を新規作成
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { exportDatabase, importDatabase } from '../exportImportService';

describe('exportDatabase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // DOM のモック
    document.body.appendChild = vi.fn();
    document.body.removeChild = vi.fn();
  });

  it('should create download link with correct filename', async () => {
    const mockData = new Uint8Array([0x53, 0x51, 0x4c]);
    vi.mock('../dashboardMessage', () => ({
      sendDashboardMessage: vi.fn().mockResolvedValue({
        success: true,
        data: mockData,
        format: 'sqlite',
      }),
    }));

    const result = await exportDatabase();

    expect(result.success).toBe(true);
    expect(result.filename).toMatch(/^yasumaro-\d{4}-\d{2}-\d{2}\.db$/);
    expect(result.format).toBe('sqlite');
  });
});

describe('importDatabase', () => {
  it('should import JSON format with deduplication', async () => {
    const mockFile = new File(
      [JSON.stringify({ table: 'browsing_logs', rows: [{ url: 'test', created_at: 123 }] })],
      'test.json',
      { type: 'application/json' }
    );

    vi.mock('../dashboardMessage', () => ({
      sendDashboardMessage: vi.fn().mockResolvedValue({
        success: true,
        imported: 1,
        skipped: 0,
      }),
    }));

    const result = await importDatabase(mockFile);

    expect(result.success).toBe(true);
    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(0);
  });

  it('should reject invalid file format', async () => {
    const mockFile = new File(
      [JSON.stringify({ invalid: true })],
      'test.json',
      { type: 'application/json' }
    );

    const result = await importDatabase(mockFile);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid');
  });
});
```

- [ ] **Step 3: テストを実行してパスを確認**

Run: `npx vitest run src/dashboard/__tests__/exportImportService.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/dashboard/exportImportService.ts src/dashboard/__tests__/exportImportService.test.ts
git commit -m "feat(dashboard): add database backup/restore service"
```

---

### Task 6: Dashboard UI に .db エクスポート/インポートボタンを追加

**Files:**
- Modify: `src/dashboard/exportImport.ts`

- [ ] **Step 1: HTML にボタンを追加**

```html
<!-- src/dashboard/exportImport.ts 内のエクスポートセクションに追加 -->

<div class="export-section">
  <h3 data-i18n="exportDatabase">データベースバックアップ</h3>
  <p data-i18n="exportDatabaseDescription">
    SQLite データベースをバイナリ形式でエクスポートします。
    別のデバイスにデータを移行する場合に使用してください。
  </p>
  <button id="exportDbBtn" class="btn btn-primary" data-i18n="exportDb">
    .db エクスポート
  </button>
  <button id="importDbBtn" class="btn btn-secondary" data-i18n="importDb">
    .db インポート
  </button>
  <input type="file" id="importDbFileInput" accept=".db,.json" style="display: none" />
</div>
```

- [ ] **Step 2: イベントハンドラを追加**

```typescript
// src/dashboard/exportImport.ts に追加

import { exportDatabase, importDatabase } from './exportImportService';

export function setupDatabaseBackupHandlers(): void {
  const exportBtn = document.getElementById('exportDbBtn');
  const importBtn = document.getElementById('importDbBtn');
  const fileInput = document.getElementById('importDbFileInput') as HTMLInputElement;

  exportBtn?.addEventListener('click', async () => {
    exportBtn.textContent = chrome.i18n.getMessage('exporting');
    exportBtn.setAttribute('disabled', 'true');

    try {
      const result = await exportDatabase();
      if (result.success) {
        showNotification(
          chrome.i18n.getMessage('exportSuccess', [result.filename || '']),
          'success'
        );
      } else {
        showNotification(
          chrome.i18n.getMessage('exportFailed', [result.error || '']),
          'error'
        );
      }
    } finally {
      exportBtn.textContent = chrome.i18n.getMessage('exportDb');
      exportBtn.removeAttribute('disabled');
    }
  });

  importBtn?.addEventListener('click', () => {
    fileInput?.click();
  });

  fileInput?.addEventListener('change', async (event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;

    importBtn.textContent = chrome.i18n.getMessage('importing');
    importBtn.setAttribute('disabled', 'true');

    try {
      const result = await importDatabase(file);
      if (result.success) {
        showNotification(
          chrome.i18n.getMessage('importSuccess', [
            String(result.imported || 0),
            String(result.skipped || 0),
          ]),
          'success'
        );
      } else {
        showNotification(
          chrome.i18n.getMessage('importFailed', [result.error || '']),
          'error'
        );
      }
    } finally {
      importBtn.textContent = chrome.i18n.getMessage('importDb');
      importBtn.removeAttribute('disabled');
      fileInput.value = '';
    }
  });
}
```

- [ ] **Step 3: i18n キーを追加**

```json
// public/_locales/en/messages.json に追加
{
  "exportDatabase": { "message": "Database Backup" },
  "exportDatabaseDescription": { "message": "Export the SQLite database in binary format. Use this to migrate data to another device." },
  "exportDb": { "message": ".db Export" },
  "importDb": { "message": ".db Import" },
  "exporting": { "message": "Exporting..." },
  "importing": { "message": "Importing..." },
  "exportSuccess": { "message": "Exported as $1$" },
  "exportFailed": { "message": "Export failed: $1$" },
  "importSuccess": { "message": "Imported $1$ records ($2$ skipped)" },
  "importFailed": { "message": "Import failed: $1$" }
}

// public/_locales/ja/messages.json に追加
{
  "exportDatabase": { "message": "データベースバックアップ" },
  "exportDatabaseDescription": { "message": "SQLite データベースをバイナリ形式でエクスポートします。別のデバイスにデータを移行する場合に使用してください。" },
  "exportDb": { "message": ".db エクスポート" },
  "importDb": { "message": ".db インポート" },
  "exporting": { "message": "エクスポート中..." },
  "importing": { "message": "インポート中..." },
  "exportSuccess": { "message": "$1$ としてエクスポートしました" },
  "exportFailed": { "message": "エクスポート失敗: $1$" },
  "importSuccess": { "message": "$1$ 件インポートしました（$2$ 件スキップ）" },
  "importFailed": { "message": "インポート失敗: $1$" }
}
```

- [ ] **Step 4: テストを実行**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/exportImport.ts public/_locales/en/messages.json public/_locales/ja/messages.json
git commit -m "feat(dashboard): add .db export/import UI with i18n"
```

---

## Definition of Done

- [ ] OPFS Worker で `DB_BACKUP` メッセージが動作する
- [ ] `backupDatabase()` が OPFS パスで `.db` バイナリを返す
- [ ] `backupDatabase()` が IDB/FallbackStorage パスで JSON にフォールバックする
- [ ] Dashboard で `.db` エクスポートボタンが動作する
- [ ] Dashboard で `.db` インポートボタンが動作する
- [ ] インポート時に重複排除（`INSERT OR IGNORE`）が機能する
- [ ] i18n（ja/en）が対応している
- [ ] セキュリティチェック（外部拡張・コンテンツスクリプトからのブロック）が動作する
- [ ] 全テストがパスする
