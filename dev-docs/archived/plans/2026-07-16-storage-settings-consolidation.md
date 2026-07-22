# storageSettings.ts 廃止 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 旧 `src/utils/storageSettings.ts`（設定管理の旧系統・実質デッドコード）を削除し、`Settings` 型と `API_KEY_FIELDS` 定数の単一ソースを `src/utils/storage/` 配下に統一する。副次的に `redaction.ts`（ログマスキング）と `settingsExportImport.ts`（エクスポート時のAPIキー除外）が見落としていた `provider_api_key`/`github_pat` の2フィールドを保護対象に加える。

**Architecture:** `src/utils/storage.ts` は既に `storage/settingsStore.ts` 等への再エクスポート層として機能している。旧 `storageSettings.ts` に依存する4ファイル（`tagUtils.ts`/`allowedUrls.ts`/`redaction.ts`/`settingsExportImport.ts`）のimport元を `storage.ts` 経由の新系統に切り替え、`API_KEY_FIELDS` を新系統側で公開してから旧ファイルとその専用テストを削除する。

**Tech Stack:** TypeScript (ESM, `.js` 拡張子import), Vitest, Chrome Extension Manifest V3

---

## 前提知識

- ESM importは `.ts` ソースでも `.js` 拡張子で書く（TypeScript ESM解決仕様）: `import { X } from './storage.js'`
- テストは Vitest。個別実行は `npx vitest run <path>`
- `npm run validate` = `npm run type-check && npm test`（コミット前ゲート）
- Edit/Read/Glob ツールは `file_path` パラメータを使う（`path` ではない）
- ファイル編集には Edit ツールのみ使用する（sed/awk/head/tail等は禁止）

## 設計ドキュメント

本計画は [docs/superpowers/specs/2026-07-16-storage-settings-consolidation-design.md](../specs/2026-07-16-storage-settings-consolidation-design.md) に基づく。

---

### Task 1: `API_KEY_FIELDS` を新系統側で公開する

**Files:**
- Modify: `src/utils/storage/settingsStore.ts:23-30`
- Modify: `src/utils/storage.ts:43-55`
- Test: `src/utils/storage/__tests__/settingsStore-apiKeyFields.test.ts`（新規作成）

- [ ] **Step 1: 失敗するテストを書く**

`src/utils/storage/__tests__/settingsStore-apiKeyFields.test.ts` を新規作成:

```ts
import { describe, it, expect } from 'vitest';
import { API_KEY_FIELDS } from '../settingsStore.js';

describe('settingsStore API_KEY_FIELDS', () => {
  it('6つのAPIキーフィールドをエクスポートしている', () => {
    expect(API_KEY_FIELDS).toEqual([
      'obsidian_api_key',
      'gemini_api_key',
      'openai_api_key',
      'openai_2_api_key',
      'provider_api_key',
      'github_pat',
    ]);
  });

  it('storage.js バレル経由でも同じ値をエクスポートしている', async () => {
    const { API_KEY_FIELDS: fromBarrel } = await import('../../storage.js');
    expect(fromBarrel).toEqual(API_KEY_FIELDS);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/utils/storage/__tests__/settingsStore-apiKeyFields.test.ts`
Expected: FAIL — `API_KEY_FIELDS` is not exported from `settingsStore.ts`（`const` のため）、および `storage.js` にも存在しない

- [ ] **Step 3: `settingsStore.ts` で `API_KEY_FIELDS` を公開する**

`src/utils/storage/settingsStore.ts:23` を変更:

```ts
// Before
const API_KEY_FIELDS: StorageKey[] = [

// After
export const API_KEY_FIELDS: StorageKey[] = [
```

- [ ] **Step 4: `storage.ts` バレルの再エクスポートに追加する**

`src/utils/storage.ts:43-55` を変更:

```ts
// Before
export {
    ALLOWED_AI_PROVIDER_DOMAINS,
    isDomainInWhitelist,
    migrateToSingleSettingsObject,
    getSettings,
    clearSettingsCache,
    saveSettings,
    buildAllowedUrls,
    computeUrlsHash,
    saveSettingsWithAllowedUrls,
    getAllowedUrls,
    purgeLegacyStorage,
} from './storage/settingsStore.js';

// After
export {
    ALLOWED_AI_PROVIDER_DOMAINS,
    API_KEY_FIELDS,
    isDomainInWhitelist,
    migrateToSingleSettingsObject,
    getSettings,
    clearSettingsCache,
    saveSettings,
    buildAllowedUrls,
    computeUrlsHash,
    saveSettingsWithAllowedUrls,
    getAllowedUrls,
    purgeLegacyStorage,
} from './storage/settingsStore.js';
```

- [ ] **Step 5: テストが通ることを確認する**

Run: `npx vitest run src/utils/storage/__tests__/settingsStore-apiKeyFields.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: 型チェックを実行する**

Run: `npm run type-check`
Expected: エラーなし

- [ ] **Step 7: コミット**

```bash
git add src/utils/storage/settingsStore.ts src/utils/storage.ts src/utils/storage/__tests__/settingsStore-apiKeyFields.test.ts
git commit -m "feat(storage): API_KEY_FIELDS を settingsStore.ts で公開する"
```

---

### Task 2: `redaction.ts` を新系統の `API_KEY_FIELDS` に切り替える（セキュリティ修正）

**Files:**
- Modify: `src/utils/redaction.ts:7`
- Test: `src/utils/__tests__/redaction.test.ts`

背景: 現状の `redaction.ts` は旧 `storageSettings.ts` の `API_KEY_FIELDS`（4フィールド）を使っており、`provider_api_key`/`github_pat` がログマスキング対象から漏れている。新系統（6フィールド）に切り替えることでこの漏れを修正する。

- [ ] **Step 1: 失敗するテストを書く**

`src/utils/__tests__/redaction.test.ts` の `describe('redactSensitiveData', ...)` ブロック内、`it('hmac_secret フィールドを検出する', ...)` の直後（108行目と118行目の間）に追加:

```ts
  it('provider_api_key フィールドを検出する', () => {
    const data = { provider_api_key: 'dynamic_secret', normal: 'value' };
    const result = redactSensitiveData(data) as Record<string, unknown>;
    expect(result.provider_api_key).toBe('[REDACTED]');
    expect(result.normal).toBe('value');
  });

  it('github_pat フィールドを検出する', () => {
    const data = { github_pat: 'ghp_secret123', normal: 'value' };
    const result = redactSensitiveData(data) as Record<string, unknown>;
    expect(result.github_pat).toBe('[REDACTED]');
    expect(result.normal).toBe('value');
  });
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/utils/__tests__/redaction.test.ts`
Expected: FAIL — `result.provider_api_key` and `result.github_pat` は `'[REDACTED]'` ではなく元の値のまま

- [ ] **Step 3: import元を切り替える**

`src/utils/redaction.ts:7` を変更:

```ts
// Before
import { API_KEY_FIELDS } from './storageSettings.js';

// After
import { API_KEY_FIELDS } from './storage.js';
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run src/utils/__tests__/redaction.test.ts`
Expected: PASS (全19テスト)

- [ ] **Step 5: 型チェックを実行する**

Run: `npm run type-check`
Expected: エラーなし

- [ ] **Step 6: コミット**

```bash
git add src/utils/redaction.ts src/utils/__tests__/redaction.test.ts
git commit -m "fix(redaction): provider_api_key/github_pat をログマスキング対象に追加"
```

---

### Task 3: `settingsExportImport.ts` を新系統の `API_KEY_FIELDS` に切り替える（セキュリティ修正）

**Files:**
- Modify: `src/utils/settingsExportImport.ts:6-9`
- Test: `src/utils/__tests__/settingsExportImport.test.ts`

背景: `sanitizeSettingsForExport()`（APIキー除外エクスポート）と `mergeWithExistingApiKeys()`（APIキー除外インポート時のマージ）が旧4フィールド版の `API_KEY_FIELDS` を使っており、`provider_api_key`/`github_pat` がエクスポートファイルに残ってしまう。新系統に切り替えて修正する。

実測した既存コードの制約:
- `exportSettings()`（245行目）は引数なし・戻り値 `void` の副作用関数（`document.createElement('a')` でBlobをダウンロードさせる）。JSON文字列を直接返さないためAPIキー除外の検証には不向き。
- `exportEncryptedSettings(masterPassword)`（87行目）は `{success, encryptedData}` を返す公開関数で、常に `apiKeyExcluded: true` で `sanitizeSettingsForExport()` を通す（94行目）。`encryptedData.ciphertext` を復号すれば中身を直接検証できる。
- テストファイルの `vi.mock('../crypto.js', ...)`（87-100行目）で `encrypt`/`decryptData` は base64エンコードのラウンドトリップとしてモックされている（`encrypt` は `'enc_' + base64(plaintext)`、`decryptData` はそれを剥がして復元）。
- テストファイルの `vi.mock('../storage.js', ...)`（53-84行目）は `getSettings`/`saveSettings`/`getOrCreateHmacSecret`/`Settings` のみを返す。`settingsExportImport.ts` が `storage.js` から `API_KEY_FIELDS` もimportするようになるため、**このモックに `API_KEY_FIELDS` を追加しないと実装後に `API_KEY_FIELDS` が `undefined` になり全テストが壊れる**。

- [ ] **Step 1: 失敗するテストを書く**

`src/utils/__tests__/settingsExportImport.test.ts:53-84` の `vi.mock('../storage.js', ...)` に `API_KEY_FIELDS` を追加する（この時点では新系統の6フィールド版の値を先に定義しておく。実装をimport元切り替え後も動かすための準備）:

```ts
// Before (53-84行目)
vi.mock('../storage.js', () => ({
    getSettings: vi.fn(async () => ({
        ai_provider: 'gemini',
        // ...(既存のフィールド群はそのまま)
        obsidian_api_key: 'obs_key',
        gemini_api_key: 'gem_key',
        openai_api_key: 'oai_key',
        openai_2_api_key: 'oai2_key'
    })),
    saveSettings: vi.fn(async () => {}),
    getOrCreateHmacSecret: vi.fn(async () => 'test_hmac_secret'),
    Settings: {}
}));

// After
vi.mock('../storage.js', () => ({
    getSettings: vi.fn(async () => ({
        ai_provider: 'gemini',
        // ...(既存のフィールド群はそのまま)
        obsidian_api_key: 'obs_key',
        gemini_api_key: 'gem_key',
        openai_api_key: 'oai_key',
        openai_2_api_key: 'oai2_key',
        provider_api_key: 'provider_key',
        github_pat: 'ghp_test_pat'
    })),
    saveSettings: vi.fn(async () => {}),
    getOrCreateHmacSecret: vi.fn(async () => 'test_hmac_secret'),
    API_KEY_FIELDS: [
        'obsidian_api_key',
        'gemini_api_key',
        'openai_api_key',
        'openai_2_api_key',
        'provider_api_key',
        'github_pat'
    ],
    Settings: {}
}));
```

続けて、`describe('exportEncryptedSettings', ...)` ブロック（470-494行目）内、既存の `test('暗号化データを返す', ...)` の直後に追加:

```ts
        test('provider_api_key と github_pat がエクスポートから除外される', async () => {
            const result = await exportEncryptedSettings('master_password');

            expect(result.success).toBe(true);
            const ciphertext = result.encryptedData!.ciphertext;
            const decrypted = JSON.parse(
                Buffer.from(ciphertext.substring(4), 'base64').toString()
            );

            expect(decrypted.settings.provider_api_key).toBeUndefined();
            expect(decrypted.settings.github_pat).toBeUndefined();
            expect(decrypted.settings.obsidian_api_key).toBeUndefined();
            expect(decrypted.settings.gemini_api_key).toBeUndefined();
        });
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/utils/__tests__/settingsExportImport.test.ts -t "provider_api_key と github_pat"`
Expected: FAIL — `decrypted.settings.provider_api_key` と `decrypted.settings.github_pat` が `undefined` ではなく `'provider_key'`/`'ghp_test_pat'` のまま（旧4フィールド版の `API_KEY_FIELDS` がまだ使われているため除外されない）

- [ ] **Step 3: import元を切り替える**

`src/utils/settingsExportImport.ts:6-9` を変更:

```ts
// Before
import { getSettings, saveSettings, getOrCreateHmacSecret, Settings } from './storage.js';
import { computeHMAC, encrypt, decryptData, deriveKey } from './crypto.js';
import { generateSalt } from './crypto.js';
import { API_KEY_FIELDS } from './storageSettings.js';

// After
import { getSettings, saveSettings, getOrCreateHmacSecret, Settings, API_KEY_FIELDS } from './storage.js';
import { computeHMAC, encrypt, decryptData, deriveKey } from './crypto.js';
import { generateSalt } from './crypto.js';
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run src/utils/__tests__/settingsExportImport.test.ts`
Expected: PASS（全テスト、新規追加分含む）

- [ ] **Step 5: 型チェックを実行する**

Run: `npm run type-check`
Expected: エラーなし

- [ ] **Step 6: コミット**

```bash
git add src/utils/settingsExportImport.ts src/utils/__tests__/settingsExportImport.test.ts
git commit -m "fix(settingsExportImport): provider_api_key/github_pat をAPIキー除外エクスポート対象に追加"
```

---

### Task 4: `tagUtils.ts` と `allowedUrls.ts` の型importを切り替える

**Files:**
- Modify: `src/utils/tagUtils.ts:8`
- Modify: `src/utils/allowedUrls.ts:9`
- Test: `src/utils/__tests__/tagUtils.test.ts`（存在すれば）, `src/utils/__tests__/allowedUrls.test.ts`（存在すれば）

これは型のみのimportで実行時の挙動変化はない。既存テストが通ることの確認のみ行う（新規テスト追加は不要）。

- [ ] **Step 1: 既存テストの現状を確認する**

Run: `npx vitest run src/utils/__tests__/tagUtils.test.ts src/utils/__tests__/allowedUrls.test.ts 2>&1 || echo "one or both files may not exist"`
Expected: 現状 PASS（変更前のベースライン確認）

- [ ] **Step 2: `tagUtils.ts` のimportを切り替える**

`src/utils/tagUtils.ts:8` を変更:

```ts
// Before
import type { Settings } from './storageSettings.js';

// After
import type { Settings } from './storage.js';
```

- [ ] **Step 3: `allowedUrls.ts` のimportを切り替える**

`src/utils/allowedUrls.ts:9` を変更:

```ts
// Before
import type { Settings } from './storageSettings.js';

// After
import type { Settings } from './storage.js';
```

- [ ] **Step 4: 型チェックを実行する**

Run: `npm run type-check`
Expected: エラーなし（新系統 `Settings` 型は旧型の上位互換のため、プロパティアクセスのみの使用箇所ではエラーが出ない）

- [ ] **Step 5: 関連テストが通ることを確認する**

Run: `npx vitest run src/utils/__tests__/tagUtils.test.ts src/utils/__tests__/allowedUrls.test.ts`
Expected: PASS（Step 1 と同じ結果）

- [ ] **Step 6: コミット**

```bash
git add src/utils/tagUtils.ts src/utils/allowedUrls.ts
git commit -m "refactor(storage): tagUtils/allowedUrls の Settings 型importを新系統に切り替え"
```

---

### Task 5: `storageSettings.test.ts` のカバレッジが新系統側に存在することを確認する

**Files:**
- Read only: `src/utils/__tests__/storageSettings.test.ts`
- Read only: `src/utils/__tests__/storage-extra.test.ts`
- Read only: `src/utils/__tests__/storage-locking.test.ts`
- Read only: `src/utils/__tests__/storage-keys.test.ts`
- Read only: `src/utils/__tests__/storage-provider-priority-migration.test.ts`

このタスクはコード変更を行わない。`storageSettings.test.ts` を削除する前に、そのテストケースが新系統側で同等にカバーされているか確認する調査タスク。

- [ ] **Step 1: `storageSettings.test.ts` の全テストケース一覧を取得する**

Run: `grep -n "test(\|it(" src/utils/__tests__/storageSettings.test.ts`

- [ ] **Step 2: 各テストケースが新系統側テストでカバーされているか照合する**

以下の観点で `storage-extra.test.ts` / `storage-locking.test.ts` / `storage-keys.test.ts` / `storage-provider-priority-migration.test.ts` を読み、対応するテストが存在するか確認する:

- API_KEY_FIELDS が4つ（新系統は6つ）のフィールドを含む → Task 1 で新規カバー済み
- DEFAULT_SETTINGS がエクスポートされている → `storage-keys.test.ts` 等で確認
- 移行済み判定（migrateToSingleSettingsObject の true/false 分岐） → `storage-locking.test.ts:185-` の `describe('migrateToSingleSettingsObject', ...)` でカバー済み
- ストレージが空の場合のデフォルト初期化 → 新系統テストで同等ケースを検索
- キャッシュ有効時の挙動 → `storage-extra.test.ts:194-` の `describe('clearSettingsCache', ...)` 付近を確認
- 暗号化されたAPIキーの復号・復号失敗時のフォールバック → 新系統テストで同等ケースを検索
- 旧方式（個別キー）でのマイグレーション優先順位 → `storage-provider-priority-migration.test.ts` を確認
- APIキーの暗号化保存・空APIキーは暗号化しない → `storage-locking.test.ts:78-` の `describe('saveSettings - 楽観的ロック', ...)` を確認

- [ ] **Step 3: カバレッジが欠けているケースを記録する**

照合の結果、新系統側でカバーされていないテストケースがあれば、そのテストコードを該当する新系統テストファイル（例: `storage-extra.test.ts`）に移植する。カバー漏れがなければこのステップはスキップする。

- [ ] **Step 4: （カバー漏れがあった場合のみ）移植したテストが通ることを確認する**

Run: `npx vitest run <移植先ファイルパス>`
Expected: PASS

- [ ] **Step 5: （カバー漏れがあった場合のみ）コミット**

```bash
git add <移植先ファイルパス>
git commit -m "test(storage): storageSettings.test.ts から新系統未カバーのケースを移植"
```

---

### Task 6: `storageSettings.ts` と専用テストを削除する

**Files:**
- Delete: `src/utils/storageSettings.ts`
- Delete: `src/utils/__tests__/storageSettings.test.ts`

- [ ] **Step 1: 削除前に呼び出し元がゼロであることを最終確認する**

Run: `grep -rln "storageSettings" src/ --include="*.ts"`
Expected: `src/utils/storageSettings.ts` と `src/utils/__tests__/storageSettings.test.ts` の2件のみが出力される（他の参照が残っていないこと）

- [ ] **Step 2: ファイルを削除する**

```bash
git rm src/utils/storageSettings.ts src/utils/__tests__/storageSettings.test.ts
```

- [ ] **Step 3: 型チェックを実行する**

Run: `npm run type-check`
Expected: エラーなし

- [ ] **Step 4: 全テストスイートを実行する**

Run: `npm test`
Expected: 全テスト PASS（削除前のテスト数からstorageSettings.test.ts分が減った件数で全件成功）

- [ ] **Step 5: コミット**

```bash
git commit -m "refactor(storage): 旧 storageSettings.ts と専用テストを削除"
```

---

### Task 7: ADRのステータスを更新する

**Files:**
- Modify: `dev-docs/ADR/2026-03-20-default-settings-single-source.md`

- [ ] **Step 1: Implementation Steps のチェックボックスを更新する**

`dev-docs/ADR/2026-03-20-default-settings-single-source.md` の Implementation Steps セクション（67-85行目付近）で、以下の未完了項目にチェックを入れる:

```markdown
// Before
- [ ] Linkage: `storageSettings.ts`使用コード修正

// After
- [x] Linkage: `storageSettings.ts`使用コード修正
```

- [ ] **Step 2: Status セクションを更新する**

`## Status` セクション（87-92行目付近）を変更:

```markdown
// Before
- **Implemented**: Phase 2（単一ソース化 - 完了） / Phase 3（マイグレーション強化 - 待機中）

// After
- **Implemented**: Phase 2（単一ソース化 - 完了） / Phase 3（storageSettings.ts 廃止・API_KEY_FIELDS 6フィールド化 - 完了、2026-07-16） / マイグレーション強化 - 待機中
```

- [ ] **Step 3: コミット**

```bash
git add dev-docs/ADR/2026-03-20-default-settings-single-source.md
git commit -m "docs(adr): storageSettings.ts 廃止完了を反映"
```

---

### Task 8: 最終検証

**Files:** なし（検証のみ）

- [ ] **Step 1: 全体の型チェックを実行する**

Run: `npm run type-check`
Expected: エラーなし

- [ ] **Step 2: 全テストスイートを実行する**

Run: `npm test`
Expected: 全テスト PASS

- [ ] **Step 3: `storageSettings` への参照が完全に消えていることを確認する**

Run: `grep -rn "storageSettings" src/ --include="*.ts"`
Expected: 出力なし（0件）

- [ ] **Step 4: `npm run validate` を実行する**

Run: `npm run validate`
Expected: PASS（type-check + test の両方成功）

- [ ] **Step 5: 変更ファイル一覧を確認する**

Run: `git log --oneline main..HEAD`
Expected: Task 1〜7 のコミットが積み上がっている（8コミット前後、Task 5でカバー漏れがなければ7コミット）

---

## Self-Review Notes（作成者記録）

- **Spec coverage:** 設計書の Changes #1〜4（API_KEY_FIELDS公開/4ファイルimport切替/storageSettings削除/ADR更新）は Task 1, 2+3+4, 5+6, 7 にそれぞれ対応。設計書で追記した「API_KEY_FIELDS内容差分によるセキュリティギャップ」は Task 2/3 で明示的にリグレッションテスト付きで対応。
- **Placeholder scan:** 全ステップに実コード・実コマンドを記載。Task 3 Step 1 のみ「既存テストのモックパターンに合わせて調整」という指示を含むが、これは実装時に読むべき既存コードの参照先を明示しており、プレースホルダーではなく実装者への具体的な調査指示。
- **Type consistency:** `API_KEY_FIELDS`（Task 1で定義）→ Task 2/3 で同名のままimport元のみ変更。`Settings` 型（Task 4）も同様に同名のままimport元のみ変更。関数名・シグネチャの変更は本計画に含まれない（既存関数はそのまま、import元の付け替えのみ）。
