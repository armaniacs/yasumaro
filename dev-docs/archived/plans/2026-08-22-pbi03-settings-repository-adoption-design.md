# SettingsRepository 採用 設計（getMany 追加とコア3ファイル移行）

- **日付**: 2026-08-22
- **状態**: 承認済み（ブレインストーミング合意）
- **対象**: `pbi/2026-08-22-03-refactor-settings-repository-adoption.md`
- **スコープ**: コアのみ（本ラウンド）。残り6ファイルはフォローアップ（§7）

## 1. 目的と受け入れ基準

ダッシュボードの設定読み取りを `SettingsRepository` 経由に統一し、`(settings[StorageKeys.X] as string) || 'default'` のキャストとインラインデフォルトの複製を解消する。デフォルト値は DEFAULT_SETTINGS の単一ソースに集約する。

受け入れ基準:

1. `SettingsRepository.getMany` が追加され、InMemory adapter 越しの単体テストがある
2. DiagnosticsCollector / generalSettings(settingsForm) / connectionTests が repository 経由に移行される
3. 移行済みファイルで settings 関連キャスト（StorageKeys インデックス + as string|number|boolean）が0件、インラインフォールバックも0件
4. デフォルト値は DEFAULT_SETTINGS の一元ソースのみを参照する
5. `npm run type-check` / `npm test` がパスし、既存 settingsStore 系テストは無傷

## 2. 取得パターン: singleton + optional 後置パラメータ

- `SettingsRepository.ts` が module-level シングルトンを export する:
  `export const settingsRepository = new SettingsRepository();`
- 移行先の入手は後置 optional パラメータ `repo: SettingsReader = settingsRepository` に統一する。
  `SettingsReader = Pick<SettingsRepository, 'getMany' | 'getAll'>`
- collector は既存 `DiagnosticsCollectorDeps` に `getMany?: SettingsReader['getMany']` を追加する形で注入シームを維持する
- テストは `new SettingsRepository(new InMemoryStorageAdapter())` を生成して注入し、chrome.storage モックに依存しない
- 既存 `get()/getAll()` の instanceof 二重経路は踏襲する（port 化は §7 フォローアップ）

## 3. getMany 仕様

```typescript
async getMany<K extends StorageKey>(keys: K[]): Promise<Pick<SettingsType, K>> {
  const unique = [...new Set(keys)];
  if (unique.length === 0) return {} as Pick<SettingsType, K>;
  // InMemory path: adapter の 'settings' blob + DEFAULT_SETTINGS マージ → pick
  // Chrome path:   getSettings() を1回だけ呼ぶ（30s TTL キャッシュを保持）
  //                → 欠損キーのみ DEFAULT_SETTINGS で補完 → pick
}
```

セマンティクス:

| 項目 | 規約 |
|---|---|
| 重複キー | Set で解消 |
| 空配列 | `{}` を返す（storage に触れない） |
| 欠損キー | DEFAULT_SETTINGS の値で補完（両パス共通） |
| エラー伝播 | getSettings の rejection をそのまま伝播（呼び出し側 catch 構造を不変に保つ） |
| API_KEY_FIELDS | getSettings 経由のため復号済みで返る（独自 storage 直読みは禁止） |

## 4. 既定ペア訂正（https + 27124 への統一）

既定値の正を「protocol='https' × port='27124'」の整合ペアに統一する。明示設定ユーザーの保存値は常に尊重され、本変更では一切変わらない。

| ファイル | 変更 |
|---|---|
| `src/utils/storage/defaults.ts` | `OBSIDIAN_PORT: '27123'` → `'27124'` |
| `src/utils/allowedUrls.ts` | フォールバック `'27123'` → `'27124'` |
| `src/utils/storage/urlWhitelist.ts` | フォールバック `'27123'` → `'27124'` |
| `src/utils/obsidianConfigValidator.ts` | `DEFAULT_PORT = '27124'` |

影響:

- フレッシュインストールの seed 値が壊れた組（https+27123）から正しい組へ変わる
- キー欠損ユーザーの一部サイトのフォールバック先が 27124 に揃う（collector は元々 27124 なので不変）
- テストフィクスチャ内の `OBSIDIAN_PORT: '27123'`（保存値シミュレーション）は変更禁止
- `AI_PROVIDER` はスキーマ `'openai'` を正とする。dashboard 側の `|| 'gemini'` は削除する

CHANGELOG に Fixed エントリ（既定ポートペア訂正）を記録する。

## 5. ファイル別移行マップ

### DiagnosticsCollector.ts（キャスト22件 → 0件）

- deps: `getSettings?: typeof getSettings` を削除し `getMany?: SettingsReader['getMany']` を追加
- collect(): 必要キー約19個（OBSIDIAN_* 4、AI_PROVIDER_PRIORITY_LIST、AI_PROVIDER、各プロバイダの BASE_URL/MODEL/API_KEY）を単一 getMany 呼び出しで取得
- 失敗時: reject → `settingsLoadFailed = true` + DEFAULT_SETTINGS から同キー群を取得（静的 import、storage 不要）→ 描画側の意味論は現行どおり
- 既存テスト: deps モックを getSettings → getMany に置換。`'27124'`/`'openai'` 補完の回帰断言を追加

### generalSettings/settingsForm.ts

- `loadGeneralSettings(repo: SettingsReader = settingsRepository)` に後置パラメータ追加
- `await getSettings()` → `await repo.getAll()`（フォーム全体ロードのため getAll が自然）
- `(settings[K] as ProviderSlot[]) ?? []`、`as string` のキャスト撤去
- 呼び出し側（dashboard wiring）は無引数のまま変更不要

### generalSettings/connectionTests.ts

- 保存値を読む関数（LOCAL_MARKDOWN_EXPORT_ENABLED/PATH の取得箇所）に後置パラメータ追加
- `repo.getMany([LOCAL_MARKDOWN_EXPORT_ENABLED, LOCAL_MARKDOWN_EXPORT_PATH])` に置換
- `|| 'Yasumaro'` インラインフォールバック削除（schema 既定 `'Yasumaro'` と一致済み）
- フォーム input の現在値を読む経路は DOM のまま変更しない

## 6. テスト戦略

| レベル | 内容 |
|---|---|
| 単体（SettingsRepository） | getMany 境界: 空配列→`{}`、重複キー de-dup、欠損キー DEFAULT_SETTINGS 補完、保存値優先、Chrome パスで getSettings が1回だけ呼ばれること、InMemory seed 部分blob |
| 単体（defaults） | `storage-defaults.test.ts` の port 断言を 27124 へ更新 |
| 統合（collector） | deps 置換 + 補完値回帰断言 + settingsLoadFailed 経路 |
| view model（form/connectionTests） | 注入 InMemory リポジトリでのテスト（chrome.storage モック不要） |
| ゲート | type-check / lint / test / build 全パス |

ドキュメント:

- DESIGN_SPECIFICATIONS §5 に設定アクセス指針を追記:「既定値の単一ソースは DEFAULT_SETTINGS。呼び出し側フォールバックリテラル禁止。部分読み=getMany／全量=getAll」
- CHANGELOG Fixed エントリ追記

## 7. スコープ外（フォローアップ記録）

1. 残り6ファイルの移行: domainSearchPanel / cspSettings / tagsPanel / gistSettings / markdownExport / recordingConditionsSettings
2. background 側の読み取り移行（RemoteAIService の `|| 'gemini'` 含む）
3. SettingsRepository の instanceof 二重経路の port 化（adapter に読み取り戦略を持たせる再設計）
