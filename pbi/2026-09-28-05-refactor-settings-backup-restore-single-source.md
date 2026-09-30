# PBI: settings バックアップ復元の単一実装化

## ユーザーストーリー

保守者として、settings バックアップからの復元を 1 つの実装に統一したい。なぜなら同一アルゴリズムが 2 ファイルに存在し、片方だけが定数をハードコードして drift しているからだ。

## ビジネス価値

- 復元ロジックの二重管理を解消し、片側だけの修正が反映されない状態を無くす。
- バックアップキーのリテラル直書きを無くし、キー定義の SSOT（`LEGACY_SETTINGS_BACKUP_KEY`）への参照に一本化する。
- 既知キー判定の重複実装を 1 つの集合判定へ寄せ、復元時に取り込まれるキーの仕様を一意にする。
- 2 系統の復元結果の一致を parity テストで固定し、将来の片側修正による silent drift を検出できるようにする。
- 移行ステートマシン（`settingsMigration`）と repository 経路のどちらから呼んでも同一結果になることが、移行中インストールでのデータ復旧を保証する。

## 優先度

- 種別: refactor
- 順位: 5 / 17
- RICEスコア: 12.0（Reach=3 / Impact=2 / Confidence=100% / Effort=0.5 SP）

## BDD受け入れシナリオ

```gherkin
Scenario: 2 つの復元入口が同一の結果を返す
  Given legacy_settings_backup_1 と legacy_settings_backup_2 の 2 世代分のバックアップが保存されている
  And バックアップ 2 に Settings キーが含まれ、バックアップ 1 に含まれないキーが混在している
  When 移行ステートマシン経由の復元と repository 経由の復元をそれぞれ実行する
  Then 両者が選ぶバックアップ世代が同じであり
  And 復元されるキーと値の集合が一致する
  And 未知のキー（StorageKeys に含まれないキー）はどちらの経路でも取り込まれない

Scenario: バックアップキーのリテラル直書きが production から消える
  Given バックアップキーの定義が export 定数 LEGACY_SETTINGS_BACKUP_KEY に 1 箇所だけ存在する
  When 生産コードを走査する
  Then 'legacy_settings_backup' のリテラル直書きが SettingsRepository 側に残っていない
  And 候補キーの前方一致（startsWith）が 1 節所の定数参照で定義されている

Scenario: backup キーの suffix 変種が同じ意味論で扱われる
  Given legacy_settings_backup_1700000000000 のような suffix 付きキーが保存されている
  And 単独の legacy_settings_backup キーも存在しうる
  When 復元が候補キーを列挙する
  Then 前方一致で全変種が候補に含まれ
  And 復数が存在する場合は降順ソート後に先頭が選ばれる

Scenario: 既知キー判定が 1 つの集合定義に統一される
  Given SettingsRepository の既知キー判定が 3 箇所、settingsMigration 側が 2 箇所存在する
  When 復元後の既知キー判定をすべて共通関数へ置き換える
  Then 判定は StorageKeys から導出した 1 つの集合のみを参照する
  And 毎回配列を生成して線形走査する実装が残っていない

Scenario: 復元結果の等価性を維持する
  Given 復元対象の値が検証ミスを伴う型で保存されている
  When 統合後の復元が走る
  Then 復元結果は移行前の parity テストの期待値と等価である
  And 復元値は型付き書き込み経路を通る（生インデックス書き込みに落ちない）
```

## 受け入れ基準

- [ ] 復元アルゴリズムが 1 実装に統合され、port ベースの実装（`tryRestoreFromBackupViaPort`）を正とする。`chrome.storage.local` 直参照の復元は残さない。
- [ ] 移行ステートマシン側の復元は port または共通関数へ委譲し、候補列挙・最新世代選択・既知キーフィルタのロジックを重複させない。
- [ ] バックアップキー判定に export 定数 `LEGACY_SETTINGS_BACKUP_KEY` を使用し、`SettingsRepository` に `'legacy_settings_backup'` のリテラル直書きを残さない。
- [ ] 既知キー判定を `STORAGE_KEY_VALUES` 相当の集合 1 箇所へ統一し、`Object.values(StorageKeys)` の毎回の配列生成 + `.includes()` 線形走査を残さない。
- [ ] 復元値の書き込み検証水準を 1 つに決める。`assignSettingValue`（型付き）水準を正とし、生インデックス書き込みへ落とさない。
- [ ] 挙動の pin は byte 同一ではなく復元結果の等価性（同じ世代選択・同じキー集合・同じ検証結果）で行う。
- [ ] 静的 pin として、production コードに `'legacy_settings_backup'` の直書きが 0 件であることを検証するテストを追加する。
- [ ] 既存の復元テスト（`settingsMigration` 側と `SettingsRepository` 側）を parity として維持し、`npm run validate` が成功する。

## テスト戦略（t_wadaスタイル）

### E2Eテスト

- 外部からは「バックアップが存在するインストールで設定が復旧され、復旧結果が 2 系統の入口で同じである」観測点を確認する。
- 新しいユーザー機能は追加しない。既存の復旧導線が結果を変えないことを Outside-In の観測点とする。
- 複数世代のバックアップ、未知キー混在、バックアップなしの各状態で復旧が同じ結果になることを外部から確認する。

### 統合テスト

- port 経由で書き込んだバックアップを、移行ステートマシン側復元と repository 側復元の両方で読み、復元結果が等価であることを検証する（既存 parity テストの拡張）。
- `InMemoryStorageAdapter` 経路で復元が機能し、`chrome.storage` への直接操作に依存しないことを確認する。
- 復元が `StorageTransaction` / optimistic lock の write seam を通ることを確認し、blob とマージされる既存挙動を保つ。
- 静的 pin テスト（production に `'legacy_settings_backup'` のリテラル 0 件）を、utils/storage 配下の静的解析テストとして追加する。

### 単体テスト

- 候補キー列挙（prefix 一致、suffix 変種、複数世代の降順選択、先頭なし）を純粋関数として検証する。
- 既知キー判定が `STORAGE_KEY_VALUES` 集合を通り、未知キーが除外されることを検証する。
- 復元値の型付き書き込みと、検証水準を落とした場合の変化（drop / 変換）を区別して検証する。
- 既存の復元テストは現行挙動の pin として維持する。期待値を変更する場合は、意図した等価性が保たれることを証明して更新する。

## 実装アプローチ

- **Outside-In**: まず「2 系統の復元が同一結果になる」parity テストを failing として用意し、その green を通して統合を進める。
- **Red-Green-Refactor**: リテラル直書きの静的 pin を Red として追加し、定数参照と集合判定への置換で Green にする。最後に重複を排除し、共通関数へ畳む。
- **正となる実装の選択**: port ベースの実装を正とし、port を持たない呼び出し側は同一の共通関数を既定 port で呼ぶ形に委譲する。
- **検証水準の明示**: 2 実装で異なる書き込み水準（型付き / 生インデックス）を選べるよう、統合時に 1 水準へ寄せる。水準の選択は決定事項として記録する。
- **スコープの限定**: `TOP_LEVEL_ONLY_KEYS`（`settingsMigration` 固有の許可リスト）、`BACKUP_RETENTION_DAYS` によるバックアップ削除経路、移行ステージ順序は本 PBI の変更対象外とする。

## 見積もり

**0.5 SP**

1. 復元共通関数の抽出と 2 実装の委譲化（`tryRestoreFromBackupViaPort` を正とする）が 0.2 SP。既知キー判定の集合統一（`SettingsRepository` 3 箇所 + `settingsMigration` 1 箇所）が 0.15 SP。静的 pin テストと parity テストの追加・更新が 0.15 SP。storage 構造・メッセージ契約・移行ステージ順序の変更は含まない。

## 技術的考慮事項

- 復元アルゴリズムの二重実装は、`src/utils/storage/settingsMigration.ts:504-521`（`tryRestoreFromBackup`）と `src/utils/storage/SettingsRepository.ts:36-57`（`tryRestoreFromBackupViaPort`）である。差分は port 経由か `chrome.storage.local` 直か、書き込みが型付きか生かのみである。
- バックアップキーの正は `src/utils/storage/settingsMigration.ts:24` の `LEGACY_SETTINGS_BACKUP_KEY` であり、使用箇所は `:238`、`:260`、`:506`、`:527` である。`src/utils/storage/SettingsRepository.ts:38` は同値をリテラルで直書きしており、キー定義の SSOT を外れている。
- 復元値の書き込み差は `src/utils/storage/SettingsRepository.ts:48`（`as Record<string, unknown>` による生インデックス書き込み）と、`src/utils/storage/settingsMigration.ts:516` の `assignSettingValue` である。`assignSettingValue` は `src/utils/storage/settingsMigration.ts:165-168` で型付き代入を行う。
- 既知キー判定の重複は production で 5 箇所ある（`src/utils/storage/SettingsRepository.ts:47`、`:141`、`:170`、`src/utils/storage/settingsMigration.ts:123`、`:515`）。`src/utils/storage/settingsMigration.ts:123` は既に `STORAGE_KEY_VALUES: ReadonlySet<string>` として SSOT 化済みだが、`:515` は依然として毎回 `Object.values(StorageKeys)` を生成している。`SettingsRepository` 3 箇所は毎回配列生成 + `.includes()` 線形走査である。
- 候補キーの前方一致（`legacy_settings_backup*`）は、suffix に時刻を持つ世代別キーが存在するため意味論である（`src/utils/storage/settingsMigration.ts:238` が `${LEGACY_SETTINGS_BACKUP_KEY}_${createdAt}` を生成する）。完全一致へ狭めると既存バックアップが読めなくなる。
- 世代選択は候補を降順ソートして先頭を取る（`src/utils/storage/settingsMigration.ts:508-510`、`src/utils/storage/SettingsRepository.ts:40-42`）。この 2 段（filter → sort → 先頭）は同一アルゴリズムの一部として共通化する。
- 復元は既存 settings へマージされるため write seam への依存が契約である。`src/utils/storage/SettingsRepository.ts:53-54` は `StorageTransaction`、`:519` 相当は `withOptimisticLock('settings', ...)` を使う。統合時に seam を入れ替えない。
- 移行ステートマシン（`SETTINGS_MIGRATION_SCHEMA_VERSION`、ステージ順序、`MAX_REMOVE_ATTEMPTS`）は中断再開の契約であり、復元共通関数の抽出で順序や再実行条件を変えない。
- 既存の復元テストは現行挙動を pin している。`src/utils/storage/__tests__/settingsMigration-completion-state.test.ts:271-274` はバックアップが `tryRestoreFromBackup()` で消費可能であることを検証し、`:15` は移行と復元が同じ store を観測することを明記している。統合時にこの pin を意味を明示した検証へ更新する。
- 復元の呼び出し元は service worker 側からのみであり、UI 契約・i18n・storage スキーマは変更しない。

## 実装者向け注記

### 現状コードの確認

- `src/utils/storage/settingsMigration.ts:504-521` は `chrome.storage.local.get(null)` を直接呼び、`assignSettingValue`（`:165-168`）で復元値を書き込み、`withOptimisticLock` でマージする。
- `src/utils/storage/SettingsRepository.ts:36-57` は `port.get(null)` を使い、`new StorageTransaction(port)`（`:53`）でマージするが、復元値は `:48` で生インデックス書き込みになる。
- `src/utils/storage/SettingsRepository.ts:38` は `'legacy_settings_backup'` をリテラル直書きしている。production コードの同リテラル直書きはここ 1 箇所だけである（定義側は `src/utils/storage/settingsMigration.ts:24`）。
- `src/utils/storage/SettingsRepository.ts:141` と `:170` は復元とは別責務で `Object.values(StorageKeys)` を配列生成し、`:47` は復元フィルタとして毎回生成している。集合化の対象はこの 3 箇所である。
- `src/utils/storage/settingsMigration.ts:515` は `STORAGE_KEY_VALUES`（`:123`）が同ファイルに存在するにもかかわらず使われていない。同一ファイル内の不整合である。
- 既存テストは `src/utils/storage/__tests__/settingsMigration-completion-state.test.ts`（復元結果の pin）と `src/utils/storage/__tests__/settingsRepository-migration-parity.test.ts`（port 経路の parity、復元そのものは対象外）が該当する。

### 実装手順

1. parity テストを書く。同一バックアップに対し、repository 経路の復元と移行経路の復元の結果が等価であることを failing として確認する。
2. 候補列挙（`LEGACY_SETTINGS_BACKUP_KEY` の前方一致 → 降順ソート → 先頭取り）と既知キーフィルタ（`STORAGE_KEY_VALUES`）を共通関数として切り出す。
3. `tryRestoreFromBackupViaPort` を共通関数を呼ぶ形へ書き換える。書き込みを `assignSettingValue` 水準へ揃え、生インデックス書き込みを残さない。
4. `tryRestoreFromBackup` を共通関数の直接呼び出しへ委譲させ、`chrome.storage.local` 直参照の復元ロジックを削除する。port が必要なら既定 port を注入する。
5. `SettingsRepository` の `:47`、`:141`、`:170` と `settingsMigration` の `:515` を共通集合判定へ置換する。
6. `'legacy_settings_backup'` のリテラル直書きが production に 0 件であることを検証する静的 pin テストを追加する。
7. 既存テスト（`settingsMigration-completion-state.test.ts` を含む）の期待値が意図どおりか確認し、意図不符の場合のみ等価性を示す形へ更新する。
8. `npm run validate` を実行して型とテストを確認する。

### 落とし穴

- 検証水準の選択を放置すると、統合先が `SettingsRepository` 側（生インデックス書き込み）へ寄せられ、`settingsMigration` 側の型付き書き込みが失われる。型付き水準を正とする。
- 候補一致を `===` へ変更すると `${LEGACY_SETTINGS_BACKUP_KEY}_${createdAt}` 形式（`src/utils/storage/settingsMigration.ts:238`）の世代別キーが読めなくなり、既存バックアップから復旧できなくなる。前方一致を保持する。
- `STORAGE_KEY_VALUES` を SettingsRepository 側へ複製すると、SSOT が 2 箇所に戻る。共通定義を再利用し、複製を作らない。
- 復元共通関数の抽出でマージ先（blob へのマージと write seam）を変えると、既存設定とのマージ挙動が失われる。seam は変更しない。
- 移行ステートマシンからの委譲化で restore の呼び出し位置（ステージ順序）を変えると、中断再開の契約が壊れる。復元は既存のステージ位置から呼ばれたままにする。
- parity テストを「両経路が例外なく完了する」だけで成立させると、片側が空結果を返しても通ってしまう。複数世代・未知キー混在の両方を fixture に入れる。
- 静的 pin テストを production 全体のリテラル検索にすると、コメント（`src/utils/storage/settingsMigration.ts:157`、`:252`）や定義自体 `:24` を拾う。production の実行コードに限定する。

## 決定事項

1. 復元アルゴリズムが 2 実装に分裂した理由は、移行ステートマシン用の直接 storage 版と、repository 経路の port 版が別々に追加され、共通部分（候補列挙と世代選択）を抽出していなかったためである。
2. 片方だけが定数を使わずにいた理由は、repository 側が移行の `LEGACY_SETTINGS_BACKUP_KEY` を import せず、文字列で同じ意味を表現したためである。
3. 既存テストで drift が検出されなかった理由は、両者の復元結果を比較する parity テストが存在せず、各経路がそれぞれの期待値を持っていたためである。
4. 今是正する必要が立っている理由は、実害ではなく、キー 定義の SSOT 外れと検証水準の乖離という発見的な保守性負債であり、是正期限がないためである。
5. port ベースの実装（`tryRestoreFromBackupViaPort`）を正とし、`tryRestoreFromBackup` は共通関数へ委譲する。逆方向には統合しない。
6. 復元値の書き込みは型付き（`assignSettingValue`）水準を正とし、生インデックス書き込みへ落とさない。
7. バックアップキーの判定は `LEGACY_SETTINGS_BACKUP_KEY` の前方一致（suffix 変種を含む）を保持する。完全一致化しない。
8. 既知キー判定は `STORAGE_KEY_VALUES` 相当の集合 1 箇所を SSOT とし、`Object.values(StorageKeys)` の毎回生成を残さない。
9. 挙動の pin は byte 同一ではなく復元結果の等価性で行う。加えて production のリテラル直書き 0 件を静的 pin として固定する。

## Definition of Done

- [ ] 復元アルゴリズムが 1 実装に統合され、port ベースの実装が正になっている。
- [ ] 移行ステートマシン側の復元が共通関数へ委譲され、`chrome.storage.local` 直参照の復元ロジックが残っていない。
- [ ] `LEGACY_SETTINGS_BACKUP_KEY` を import しており、production に `'legacy_settings_backup'` のリテラル直書きが 0 件である。
- [ ] 既知キー判定が集合 1 箇所に統一され、毎回の配列生成 + 線形走査が残っていない。
- [ ] 復元値の書き込みが型付き水準に統一され、生インデックス書き込みが排除されている。
- [ ] バックアップキーの前方一致（suffix 変種）意味論が保持されている。
- [ ] 2 系統の復元結果の parity テストが green であり、既存復元テストが pin として維持されている。
- [ ] `npm run validate` が成功し、既存テストに回帰がない。
- [ ] BDD 受け入れシナリオとテスト戦略の検証が完了している。
- [ ] コードレビューが完了している。
