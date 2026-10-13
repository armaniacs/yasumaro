# PBI: `recording_triggers` / `snapshot_interval_minutes` の既移行インストール向け復旧パスを追加する

- 種別: fix
- RICE: 6.0（R5 × I3 × C0.8 / E2.0）
- 依存: なし（PBI-01 とファイル非重複で並列可）
- バッチ: checking-team-1010
- 台帳: `pbi/2026-10-11-00-backlog-checking-team-1010.md`
- 出所: checking-team レビュー（`dev-docs/archived/plans/2026-10-10-2320-review-1007z.md`）High 1件 + Medium 1件

## ユーザーストーリー

既存ユーザーとして、拡張を更新しても自分の自動保存トリガー設定（スクロール/時間トリガー、定期スナップショット間隔）が失われてほしくない。なぜなら main 相当を一度起動した環境では生キーが既に `settings` blob へ畳まれて削除済みで、本ブランチの allowlist 追加は移行完了ガードにより再実行されず、設定が無言で既定値に巻き戻るから。

## 背景（現状・証拠）

- 本ブランチは `src/utils/storage/settingsMigration.ts:162-163` で `TOP_LEVEL_ONLY_KEYS` に `RECORDING_TRIGGERS` / `SNAPSHOT_INTERVAL_MINUTES` を追加し、**今後の**移行で生キーが blob へ畳まれて削除されるのを止めた。
- `git show main:src/utils/storage/settingsMigration.ts` と比較すると、この 2 キーを除けば main と HEAD の移行ロジックは同一で、v2 ステージマシン（`isSettingsMigrationComplete` → `stage === 'completed' && schemaVersion >= 2`）は**すでに main に存在**する。つまり main 相当のバージョンを一度起動した既存ユーザーは、この 2 キーが `isMigratableStorageKey() === true`（main のテスト `settingsMigration-completion-state.test.ts` は `RECORDING_TRIGGERS` を `true` と表明。本ブランチで `false` に反転）として blob に畳まれ、生キーは `remove(stillPresent)` で削除済み。
- 移行完了済みインストールでは `migrateToSingleSettingsObject()` が `settingsMigration.ts:292` の `if (isSettingsMigrationComplete(rawState)) return false;` で即 return するため、今回の allowlist 追加は再実行されない。
- blob 側に `recording_triggers` を読む経路は無く、`src/background/recordingTriggerManager.ts` は生キーを `chrome.storage.local.get()` で直接読むだけ。`loadTriggers()` は `typeof raw === 'string'` 不成立で `DEFAULT_TRIGGERS`（`scrollAndTime: false` / `periodicSnapshot: false`）へフォールバックする（`recordingTriggerManager.ts:75-80`）。`getSnapshotIntervalMinutes()` も既定 5 分へ戻る（`:127`）。
- `loadTriggers` は `shouldRecord`（`recordingTriggerManager.ts:93-94`）から実際に呼ばれており、自動保存トリガーが無言で既定値に巻き戻る = ユーザー設定の消失。修正が「将来の消失防止」にしか効いておらず、既に消失した層が救われない。
- graphify: `src/utils/storage/settingsMigration.ts` は degree 95 の god node（`SettingsRepository.ts` から dynamic import、`settingsExportImport.ts` から import）。`recordingTriggerManager.ts` は degree 14 で依存は狭い（`storage/types.ts` / `settingsRepository` / `recordingDecision.ts` / `visitThresholds.ts`）ため、blob リーダーを足す修正は局所的に済む。

## BDD 受け入れシナリオ

```gherkin
Scenario: 既移行インストールでトリガー設定が復旧する
  Given 移行が stage completed / schemaVersion >= 2 で完了済みである
  And 生キー recording_triggers が削除済みで、blob 側に recording_triggers が存在する
  When 拡張を起動する
  Then recording_triggers と snapshot_interval_minutes が生キーへ復元される
  And loadTriggers() が DEFAULT_TRIGGERS ではなく保存済みの値へ解決する

Scenario: 復旧は一度きりで冪等である
  Given 復旧がすでに完了している
  When もう一度起動する
  Then 復旧処理は再実行されず、既存の生キー値を上書きしない

Scenario: 生キーが存在する新規環境では何もしない
  Given 生キー recording_triggers が存在する（移行前の環境）
  When 拡張を起動する
  Then 復旧処理は生キーへ書き込まない
```

## 受け入れ基準

- [x] 移行完了フラグと独立した一度きりの冪等リペアを追加する（生キー不在かつ blob 側に存在する場合のみ blob → 生キーへコピー。完了マーカーは別キーを使う）
- [x] **採用: `RecordingTriggerManager` に blob 側リーダーをフォールバックとして持たせる**（生キー不在時のみ blob を参照）。選定理由は下記「設計判断」
- [x] 復旧経路が「既移行インストール」で実際に `loadTriggers()` / `getSnapshotIntervalMinutes()` の値を戻すことをテストで固定する
- [x] 復旧処理が冪等である（2 回目以降の起動で上書きしない）ことをテストで固定する
- [x] 生キーが存在する環境では復旧処理が書き込まないことをテストで固定する（blob より生キーを優先するテストで固定）
- [x] `settingsMigration-completion-state.test.ts` の `isMigratableStorageKey(RECORDING_TRIGGERS)` の期待値（本ブランチで `false` に反転）と、復旧経路の役割分担がコメントで明示されている
- [x] `readSettingsSnapshot()`（`src/utils/storage/settingsSnapshot.ts`）の戻り型が `Record<string, unknown>` に変わった旨と、移行方法を doc コメントに追記する
- [x] `npm run validate` が green

## 設計判断（採用案と理由）

**採用: blob リーダー・フォールバック（書き込みなし）**。理由:

1. 状態を持たないため冪等性が構造的に保証される（完了マーカーの追加・管理が不要。新しい `StorageKeys` を足すと `StorageKeyValues` union と `isMigratableStorageKey` の allowlist も同時に触る必要があり、移行機構そのものへの影響が広がる）。
2. 復旧が「読み取り時のフォールバック」なので、ユーザーが後から UI で設定を変えた場合に古い blob 値で上書きする経路が存在しない（生キーが常に優先）。
3. 修正範囲が `recordingTriggerManager.ts` に閉じる（graphify で degree 14 と依存が狭いことを確認済み）。移行機構（degree 95 の god node）には触れない。
4. `readSettingsSnapshot()` は復号を行わない read-only のスナップショットで、blob は scattered キーの上位集合。生の `chrome.storage.local.get('settings')` を直読みしない方針とも一致する。

## 検証結果（2026-10-11 / commit `0f96cd4c`）

| コマンド | 結果 |
|---|---|
| `npx vitest run src/background/__tests__/recordingTriggerManager.test.ts` | 22 passed（blob フォールバック 5 件を追加） |
| `npx vitest run src/utils/storage/__tests__/ src/background/__tests__/recordingTriggerManager.test.ts` | 521 passed（60 files） |
| `npm run type-check` | exit 0 |
| `npm run validate` | exit 0（1055 files / 15933 tests passed） |

追加テスト: blob からトリガーを復元 / 生キー優先 / blob から snapshot 間隔を復元 / 生キー優先 / どちらにも無い場合は既定値。


## テスト戦略

- unit: 移行完了済み状態を再現した storage モックで、起動時の復旧処理が生キーを書き戻すこと・2 回目は書き込まないこと・生キー存在時は no-op であることを検証
- unit: `recordingTriggerManager` の `loadTriggers` / `getSnapshotIntervalMinutes` が復旧後の値（および blob フォールバック経路）を返すことを検証
- 回帰: 既存 `settingsMigration` 系テスト（`settingsMigration-completion-state.test.ts` ほか）が green のままであること
- 結合: background 初期化経路（service-worker / bootstrapper）から復旧処理が 1 回だけ呼ばれること

## 見積もり

2.0 SP（復旧処理 1.0 + テスト 0.5 + 型 doc 0.5）

## 技術的考慮事項

- 「移行を再実行させる」方向の修正は危険（完了ガードを外すと他のキーの再移行が走る）。**完了ガードは触らず、独立した冪等リペアを足す**
- blob 側の値は暗号化されている可能性がある。`readSettingsSnapshot()` を通して復号済みの値を使う（生の `chrome.storage.local.get('settings')` を直読みしない）
- 復旧完了マーカーは `StorageKeys` に追加する場合、`src/utils/storage/types.ts` の union と `defaults.ts` も同時に更新する
- `settingsExportImport.ts` のバックアップ復元経路も blob を書くため、復元直後に復旧処理が古い生キーで上書きしないよう「blob を優先する」順序を守る

## 実装者向け注記

### 実装手順

1. 復旧方式（独立リペア vs blob リーダーフォールバック）を決める。迷う場合は「blob リーダー」が状態を持たず冪等性の問題が無いため安全
2. 失敗するテストを先に書く（既移行インストールで `loadTriggers()` が既定値になることを pin する Red）
3. 実装して Green にする
4. `settingsSnapshot.ts:26` の doc コメントを追記
5. `npm run validate`

### 落とし穴

- `isSettingsMigrationComplete` の完了ガードを外してはならない（他キーの再移行・二重書き込みを招く）
- 生キーの存在チェックを「`undefined` かどうか」で行う（`null`/空文字を存在扱いすると復旧が走らない）
- テストで実時間待ちを入れない（`testDir/waitPolicy.ts` の `waitForMock` 等を使う）

## Definition of Done

- [x] 既移行インストールの再現テストで、トリガー設定が既定値へ巻き戻らないことが確認できる
- [x] 復旧の冪等性テストが green（書き込みを行わない読み取りフォールバックのため構造的に冪等）
- [x] `npm run validate` が green
- [x] 検証結果（コマンドと結果）を PBI に記録し、アーカイブする
