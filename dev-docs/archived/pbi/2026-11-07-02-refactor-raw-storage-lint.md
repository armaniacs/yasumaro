# PBI 2026-11-07-02: raw storage bypass を lint で検出する

## ヘッダ

- rank: 2/9
- RICE: 4.0 (Reach 5 / Impact 2 / Confidence 0.8 / Effort 2)
- 依存: なし
- テーマ: SettingsRepository を設定永続化の SSOT にする
- 見積: 2SP

## ユーザーストーリ

保守担当者として、設定用途の `chrome.storage.local` 直接利用を lint で検出したい。`SettingsRepository` と `StoragePort` が設定永続化の SSOT であることが、コードで守られるから。

## 背景

現在は設定系の読み書きが `SettingsRepository` に集約されつつある。一方で、個別モジュールが `chrome.storage.local.get` / `set` を直接呼ぶ箇所が残っている。これらはレビュー時の見落としで増える傾向がある。lint による機械的な検出が無いため、SSOT への集約が後戻りする。

SSOT の宣言は `src/utils/storage/SettingsRepository.ts:3-7` で確認済み。`StoragePort` が唯一の seam であり、`SettingsRepository` が defaults と migration と encryption と quota を所有する。

直接利用の代表例は下記の通りで、いずれも実コードで確認済みである。

- `src/background/recordingPause.ts:68-73`: `createChromePauseStorage` が `chrome.storage.local.get` / `set` を直接呼ぶ。一時停止時刻の永続化が対象。
- `src/background/migration/migrationState.ts:37-60`: `ChromeMigrationStateAdapter` の status / progress / retryCount の取得と保存が `chrome.storage.local.get` / `set` を直接呼ぶ。
- `src/background/sessionStore.ts:385,403,433`: emergency flush の `set`、単一キー移行の `get`、起動時一括移行の `get(null)` が直接利用である。
- `src/background/webhookExport/webhookExportSettings.ts:41-46`: `chromeLocalWebhookExportStore` の `get` / `set` が `chrome.storage.local` を直接呼ぶ。
- `src/background/queueStorageAdapter.ts:27-33`: `ChromeStorageAdapter` の `load` / `save` が `chrome.storage.local.get` / `set` を直接呼ぶ。

なお、`sessionStore.ts` の `migrateFromLocalStorage` 系と `queueStorageAdapter.ts` は session 系や queue 系の基盤であり、設定用途と基盤用途の境界整理が必要である。この境界整理自体は本 PBI の移行作業ではなく、lint の許可リスト設計に含める。

## BDD シナリオ

### シナリオ 1: 新規の直接利用は lint で落ちる

```gherkin
Given 設定用途の新規モジュールが `chrome.storage.local.get` を直接呼ぶ
When `npm run lint` を実行する
Then 該当箇所がエラーとして報告され、ゲートが失敗する
```

### シナリオ 2: 既存の直接利用は台帳に載る

```gherkin
Given 既存の直接利用が許可リストまたは台帳に登録されている
When `npm run lint` を実行する
Then 登録済みの箇所は警告または許容として区別され、新規追加だけがエラーになる
```

### シナリオ 3: SSOT 経由の利用は lint を通過する

```gherkin
Given モジュールが `SettingsRepository` または `StoragePort` 経由で読み書きする
When `npm run lint` を実行する
Then エラーは報告されない
```

## 受け入れ条件

1. 新規の `chrome.storage.local` 直接利用が lint ルールで拒否されること。対象は少なくとも `get` と `set` とする。
2. 背景に記載した既存の直接利用が全件台帳化され、許可リストまたは移行対象として区分されること。
3. `SettingsRepository` と `StoragePort` を経由する正規の読み書きが lint で誤検出されないこと。
4. session 移行や queue 永続化など設定用途以外の正当な直接利用は、理由付きで許可されること。
5. `npm run lint` がゲートとして機能し、CI と同じコマンドで再現すること。
6. 振る舞いを変えないこと。ロジック変更や保存形式の変更を含まないこと。

## テスト戦略

- ゲート: `npm run lint` が成功すること。新規の直接利用を追加した場合は失敗することを確認する。
- 振る舞い保持: 本 PBI は検出基盤の追加であり、ロジック変更は行わない。既存の単体テストの振る舞いを変えない。
- 確認観点: 許可リスト登録済みの既存箇所は通過し、未登録の新規箇所だけが落ちること。
- 回帰: 設定系の既存テストに影響が無いこと。

## DoD

- [x] 新規の直接利用が lint で拒否される
- [x] 既存の直接利用が全件台帳化されている
- [x] `npm run lint` が通過する
- [x] 振る舞い変更が無い
- [x] レビューが完了している
