# 設定エクスポート/インポートUI統合 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `popup/settingsExportImportUi.ts` と `dashboard/exportImport.ts` の重複UIオーケストレーションを `src/utils/settingsExportImportUiCore.ts` に抽出する

**Architecture:** 共有コアモジュールにエクスポート/インポートのUIハンドラロジックを抽出。各UIはDOM要素の参照とモーダル開閉の差異分のみを提供するアダプター。既存の `settingsExportImport.ts`（ビジネスロジック）は変更しない。

**Tech Stack:** TypeScript, Vitest, 既存の `settingsExportImport.ts`

---

## ファイルマッピング

| 操作 | ファイル |
|------|---------|
| 作成 | `src/utils/settingsExportImportUiCore.ts` |
| 変更 | `src/popup/settingsExportImportUi.ts` |
| 変更 | `src/dashboard/exportImport.ts` |

---

### Task 1: `settingsExportImportUiCore.ts` に共有ハンドラを抽出

**Files:**
- Create: `src/utils/settingsExportImportUiCore.ts`

- [ ] **Step 1: 実装を書く**

`src/utils/settingsExportImportUiCore.ts` を作成:

```typescript
/**
 * settingsExportImportUiCore.ts
 * 設定エクスポート/インポートUIの共有ロジック
 */

import { getSettings, Settings } from './storage.js';
import { errorMessage } from './errorUtils.js';
import {
    exportSettings,
    importSettings,
    validateExportData,
    exportEncryptedSettings,
    importEncryptedSettings,
    saveEncryptedExportToFile,
    isEncryptedExport,
    ExportFileData,
    SettingsExportData
} from './settingsExportImport.js';

export interface ImportContext {
    /** インポート完了後のリロード関数 */
    reloadFn: () => Promise<void>;
    /** ステータス表示関数 */
    showStatus: (message: string, type: 'success' | 'error') => void;
    /** ドメイン設定再読み込み */
    loadDomainSettings?: () => Promise<void>;
    /** プライバシー設定再読み込み */
    loadPrivacySettings?: () => Promise<void>;
    /** コンテンツ設定再読み込み */
    loadContentSettings?: () => Promise<void>;
    /** 信頼設定再読み込み */
    loadTrustSettings?: () => Promise<void>;
}

/**
 * エクスポートボタンクリックハンドラ
 */
export async function handleExport(
    showPasswordAuthModal: (actionType: 'export' | 'import', action: (password: string) => Promise<void>) => void
): Promise<void> {
    const settings = await getSettings();
    if (settings.master_password_enabled) {
        showPasswordAuthModal('export', async (password: string) => {
            try {
                const data = await exportSettings();
                const encrypted = await exportEncryptedSettings(data, password);
                saveEncryptedExportToFile(encrypted);
            } catch (error) {
                // showStatus is called by the caller
                throw error;
            }
        });
    } else {
        try {
            const data = await exportSettings();
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `yasumaro-settings-${new Date().toISOString().split('T')[0]}.json`;
            a.click();
            URL.revokeObjectURL(url);
        } catch (error) {
            throw error;
        }
    }
}

/**
 * ファイル入力 change ハンドラ
 */
export function handleFileImport(
    file: File,
    ctx: ImportContext,
    showPasswordAuthModal: (actionType: 'export' | 'import', action: (password: string) => Promise<void>) => void
): void {
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const content = e.target?.result as string;
            if (isEncryptedExport(content)) {
                showPasswordAuthModal('import', async (password: string) => {
                    try {
                        const settings = await importEncryptedSettings(content, password);
                        await importSettings(settings);
                        await ctx.reloadFn();
                        if (ctx.loadDomainSettings) await ctx.loadDomainSettings();
                        if (ctx.loadPrivacySettings) await ctx.loadPrivacySettings();
                        if (ctx.loadContentSettings) await ctx.loadContentSettings();
                        if (ctx.loadTrustSettings) await ctx.loadTrustSettings();
                        ctx.showStatus('Settings imported successfully.', 'success');
                    } catch (error) {
                        ctx.showStatus(`Import failed: ${errorMessage(error)}`, 'error');
                    }
                });
            } else {
                const data = JSON.parse(content) as SettingsExportData;
                const errors = validateExportData(data);
                if (errors.length > 0) {
                    ctx.showStatus(`Invalid file: ${errors.join(', ')}`, 'error');
                    return;
                }
                // Show preview and confirm (caller handles modal)
                await importSettings(data.settings);
                await ctx.reloadFn();
                if (ctx.loadDomainSettings) await ctx.loadDomainSettings();
                if (ctx.loadPrivacySettings) await ctx.loadPrivacySettings();
                if (ctx.loadContentSettings) await ctx.loadContentSettings();
                if (ctx.loadTrustSettings) await ctx.loadTrustSettings();
                ctx.showStatus('Settings imported successfully.', 'success');
            }
        } catch (error) {
            ctx.showStatus(`Import failed: ${errorMessage(error)}`, 'error');
        }
    };
    reader.readAsText(file);
}
```

- [ ] **Step 2: 型チェックを実行**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: コミット**

```bash
git add src/utils/settingsExportImportUiCore.ts
git commit -m "refactor(ui): add settingsExportImportUiCore.ts with shared handlers"
```

---

### Task 2: popup/settingsExportImportUi.ts を共有コアに書き換え

**Files:**
- Modify: `src/popup/settingsExportImportUi.ts`

- [ ] **Step 1: 共有関数をインポートし、重複ハンドラを置換**

`settingsExportImportUi.ts` のインポートに追加:

```typescript
import { handleExport, handleFileImport, ImportContext } from '../utils/settingsExportImportUiCore.js';
```

エクスポートボタンハンドラを `handleExport` に委譲:

```typescript
// 既存のエクスポートハンドラを以下に置換
if (exportSettingsBtn) {
    exportSettingsBtn.addEventListener('click', async () => {
        try {
            await handleExport(showPasswordAuthModal);
            showStatus('Settings exported successfully.', 'success');
        } catch (error) {
            showStatus(`Export failed: ${errorMessage(error)}`, 'error');
        }
    });
}
```

ファイル入力ハンドラを `handleFileImport` に委譲:

```typescript
if (importFileInput) {
    importFileInput.addEventListener('change', (e: Event) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;
        const ctx: ImportContext = {
            reloadFn,
            showStatus: (msg, type) => showStatus('exportImportStatus', msg, type),
            loadDomainSettings,
            loadPrivacySettings,
        };
        handleFileImport(file, ctx, showPasswordAuthModal);
    });
}
```

- [ ] **Step 2: 型チェックを実行**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: コミット**

```bash
git add src/popup/settingsExportImportUi.ts
git commit -m "refactor(ui): use settingsExportImportUiCore in popup"
```

---

### Task 3: dashboard/exportImport.ts を共有コアに書き換え

**Files:**
- Modify: `src/dashboard/exportImport.ts`

- [ ] **Step 1: 共有関数をインポートし、重複ハンドラを置換**

`exportImport.ts` のインポートに追加:

```typescript
import { handleExport, handleFileImport, ImportContext } from '../utils/settingsExportImportUiCore.js';
```

エクスポート/インポートハンドラを共有関数に委譲（dashboard固有のログインポート機能は維持）。

- [ ] **Step 2: 型チェックを実行**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: コミット**

```bash
git add src/dashboard/exportImport.ts
git commit -m "refactor(ui): use settingsExportImportUiCore in dashboard"
```

---

### Task 4: 全テスト実行

- [ ] **Step 1:** `npx tsc --noEmit` → PASS
- [ ] **Step 2:** `npx vitest run` → PASS
- [ ] **Step 3:** 手動テスト（popup + dashboard のエクスポート/インポートフロー確認）

---

## 検証チェックリスト

- [ ] `settingsExportImportUiCore.ts` に `handleExport`, `handleFileImport` が存在する
- [ ] popup が共有関数を使用している
- [ ] dashboard が共有関数を使用している
- [ ] dashboard のログインポート機能は維持されている
- [ ] 既存テストが全てパスする
