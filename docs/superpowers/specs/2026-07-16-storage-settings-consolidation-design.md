# Design: storageSettings.ts 廃止による設定モジュール統合

**Date:** 2026-07-16
**PBI:** [2026-07-16-02-fix-architecture-knowledge-graph-findings](../../../pbi/2026-07-16-02-fix-architecture-knowledge-graph-findings.md) （PBI-1のみ）
**Status:** Draft
**Depends on:** ADR [2026-03-20-default-settings-single-source](../../../dev-docs/ADR/2026-03-20-default-settings-single-source.md)

---

## Architecture Overview

### Current State (Problem)

PBI記載の想定（`getSettings`/`saveSettings` の二重実装が並行稼働し回帰リスクがある）は、調査の結果より軽微であることが判明した。

- `src/utils/storage.ts` は既に整理済みの再エクスポート層。実装は `storage/{settingsStore,defaults,types,encryptionSession,savedUrlStore,domainFilterCache,quota}.ts` に分割済みで、130以上のファイルがこのバレル経由で新系統を利用している。
- 旧 `src/utils/storageSettings.ts` に直接依存しているのは4ファイルのみ：`tagUtils.ts`、`redaction.ts`、`allowedUrls.ts`、`settingsExportImport.ts`。
- この4ファイルが実際に使っているのは `Settings` 型（2ファイル）と `API_KEY_FIELDS` 定数（2ファイル）のみ。`getSettings`/`saveSettings`/`migrateToSingleSettingsObject`/`clearSettingsCache`（`storageSettings.ts` 側の実装）は、プロダクションコードのどこからも呼ばれていない。専用テスト `storageSettings.test.ts` のみがこれらを直接テストしている。

```
Before:
  src/utils/storageSettings.ts (333行)
    ├── export const API_KEY_FIELDS         ← redaction.ts, settingsExportImport.ts が使用
    ├── export interface SettingsValue       ← 手書きの限定フィールド一覧（新型の劣化コピー）
    ├── export type Settings                 ← tagUtils.ts, allowedUrls.ts が使用
    ├── export const DEFAULT_SETTINGS        ← storage.ts から re-export（ADR済み対応）
    ├── export async function getSettings    ← 呼び出し元なし（デッドコード）
    ├── export async function saveSettings   ← 呼び出し元なし（デッドコード）
    ├── export function migrateToSingleSettingsObject ← 呼び出し元なし
    └── export function clearSettingsCache   ← 呼び出し元なし

  src/utils/storage/settingsStore.ts
    └── const API_KEY_FIELDS (非公開・重複定義)

After:
  src/utils/storage/settingsStore.ts
    └── export const API_KEY_FIELDS  ← 公開化、単一ソース化

  src/utils/storage.ts (バレル)
    └── API_KEY_FIELDS を re-export に追加

  4ファイル: import元を storage.ts に統一
  storageSettings.ts + storageSettings.test.ts: 削除
```

### Target State

`Settings` 型と `API_KEY_FIELDS` の単一ソースを `src/utils/storage/` 配下に統一し、旧 `storageSettings.ts` を削除する。`storage.ts` バレル自体の構造（後方互換の再エクスポート層としての役割）は変更しない。

副次効果として、新系統の `API_KEY_FIELDS`（6フィールド）に統一することで、旧4フィールド版では対象外だった `provider_api_key`/`github_pat` がログマスキングとエクスポート除外の対象に加わり、既存のセキュリティギャップが修正される（詳細は Changes #2 を参照）。

---

## Changes

### 1. `API_KEY_FIELDS` を新系統側で公開

`src/utils/storage/settingsStore.ts`:
```ts
// Before
const API_KEY_FIELDS: StorageKey[] = [...];

// After
export const API_KEY_FIELDS: StorageKey[] = [...];
```

`src/utils/storage.ts`（バレル）の再エクスポートリストに追加:
```ts
export {
    ALLOWED_AI_PROVIDER_DOMAINS,
    API_KEY_FIELDS,   // 追加
    isDomainInWhitelist,
    ...
} from './storage/settingsStore.js';
```

### 2. 4ファイルのimport切り替え

| ファイル | 変更前 | 変更後 |
|---|---|---|
| `src/utils/tagUtils.ts` | `import type { Settings } from './storageSettings.js'` | `import type { Settings } from './storage.js'` |
| `src/utils/allowedUrls.ts` | `import type { Settings } from './storageSettings.js'` | `import type { Settings } from './storage.js'` |
| `src/utils/redaction.ts` | `import { API_KEY_FIELDS } from './storageSettings.js'` | `import { API_KEY_FIELDS } from './storage.js'` |
| `src/utils/settingsExportImport.ts` | `import { getSettings, saveSettings, getOrCreateHmacSecret, Settings } from './storage.js';`<br>`import { API_KEY_FIELDS } from './storageSettings.js';`（2行） | `storage.js` からの1つのimportに統合し `API_KEY_FIELDS` を追加 |

型の互換性: 新系統 `Settings`（`storage/types.ts`）は `Partial<StorageKeyValues> & {[key: string]: unknown}` で `StorageKeys` enum を全網羅する。旧 `SettingsValue`（`storageSettings.ts`）は手書きの限定サブセットで、新型の方が上位互換。4ファイルでの使われ方はプロパティアクセスのみのため型置換に伴う実装変更は不要。

**重要: `API_KEY_FIELDS` の内容差分（セキュリティ上の意味を持つ）**

新旧の `API_KEY_FIELDS` は一致していない。

| 旧（`storageSettings.ts`、4フィールド） | 新（`storage/settingsStore.ts`、6フィールド） |
|---|---|
| `obsidian_api_key` | `obsidian_api_key` |
| `gemini_api_key` | `gemini_api_key` |
| `openai_api_key` | `openai_api_key` |
| `openai_2_api_key` | `openai_2_api_key` |
| — | `provider_api_key`（`StorageKeys.PROVIDER_API_KEY`） |
| — | `github_pat`（`StorageKeys.GITHUB_PAT`） |

この差分は2箇所で実害を持つセキュリティギャップになっている:

1. **`redaction.ts`**: `SENSITIVE_KEYS` を `API_KEY_FIELDS` から構築してログをマスクしているが、旧4フィールド版では `provider_api_key`/`github_pat` がマスク対象外になっている。
2. **`settingsExportImport.ts`**: `sanitizeSettingsForExport()`（APIキー除外エクスポート）と `mergeWithExistingApiKeys()`（APIキー除外インポート時のマージ）が旧4フィールド版を使っており、`provider_api_key`/`github_pat` がエクスポートファイルに平文/暗号化データのまま残ってしまう。

新系統の6フィールド版に切り替えることで、この2つの漏れが同時に修正される。`API_KEY_FIELDS` の型は `StorageKey[]`（`StorageKeys` の値のユニオン型）で、`redaction.ts`/`settingsExportImport.ts` 側は `string` として扱っているため構造的に互換であり、置き換えに伴うコード変更は不要。

### 3. `storageSettings.ts` と専用テストの削除

- `src/utils/storageSettings.ts` を削除
- `src/utils/__tests__/storageSettings.test.ts` を削除

削除前に、このテストがカバーしていた挙動（APIキー暗号化復号のフォールバック、旧方式マイグレーションでの個別キー優先順位、キャッシュクリア等）が新系統側の既存テスト（`storage-extra.test.ts`、`storage-locking.test.ts`、`storage-keys.test.ts`、`storage-provider-priority-migration.test.ts`）で同等にカバーされているか確認する。カバレッジに欠けがあれば、該当ケースを新系統側のテストに移植してから削除する。

### 4. ADR更新

`dev-docs/ADR/2026-03-20-default-settings-single-source.md` の Implementation Steps のうち未完了だった「Linkage: `storageSettings.ts`使用コード修正」にチェックを入れ、`## Status` セクションの `Implemented` 行を更新する。

---

## Risk Assessment

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| `storageSettings.ts` の関数に想定外の呼び出し元が存在する | Low | grep で全プロダクションコードを走査し呼び出し元ゼロを確認済み。削除前に再度 `grep -rn "storageSettings"` で最終確認 |
| 新旧 `Settings` 型の非互換によるコンパイルエラー | Low | `npm run type-check` で検出可能。新型は旧型の上位互換のため実質的なエラーは想定しにくい |
| `storageSettings.test.ts` 削除でテストカバレッジが低下する | Medium | 削除前に新系統側テストとのカバレッジ差分を確認し、欠けがあれば移植 |
| `API_KEY_FIELDS` を6フィールド版に切り替えると `redaction.ts`/`settingsExportImport.ts` の既存テストのスナップショット・アサーションが変化する | Medium | 既存テストで `provider_api_key`/`github_pat` を含むケースがあれば期待値を更新。含むテストが無ければ新規にリグレッションテストを追加する（実装計画のTask 5/6で対応） |

---

## Rollback

`storageSettings.ts` と `storageSettings.test.ts` を git 履歴から復元し、4ファイルのimportを元に戻す。データやストレージスキーマの変更を伴わないため、コードレベルの取り消しのみで完全に復旧可能。

---

## Dependencies

- **Blocks**: PBI-2（ADR↔コード逆リンク）が本ADRの実装完了を参照する可能性がある
- **Blocked by**: なし
- **Out of scope**: PBI-2/3/4（ドキュメント↔コード逆リンク、content script注入経路可視化、logger→PII依存可視化）は別セッションで個別に設計する
