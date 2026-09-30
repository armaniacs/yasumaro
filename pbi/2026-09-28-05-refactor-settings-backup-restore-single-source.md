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
  And 候補キーの前方一致（startsWith）が 1 箇所の定数参照で定義されている

Scenario: backup キーの suffix 変種が同じ意味論で扱われる
  Given legacy_settings_backup_1700000000000 のような suffix 付きキーが保存されている
  And 単独の legacy_settings_backup キーも存在しうる
  When 復元が候補キーを列挙する
  Then 前方一致で全変種が候補に含まれ
  And 複数存在する場合はキー文字列の降順ソート後に先頭が選ばれる

Scenario: 既知キー判定が 1 つの集合定義に統一される
  Given SettingsRepository の毎回配列生成の既知キー判定が 3 箇所、settingsMigration の同判定が 1 箇所存在する
  When 復元後の既知キー判定をすべて共通の集合判定へ置き換える
  Then 判定は StorageKeys から導出した 1 つの集合のみを参照する
  And 毎回配列を生成して線形走査する実装が残っていない

Scenario: 復元結果の等価性を維持する
  Given 復元対象の値が文字列・オブジェクト・null など様々な型で保存されている
  When 統合後の復元が走る
  Then 復元結果は統合前の parity テストの期待値と等価である
  And 値は変換も検証もされずそのまま書き込まれる（両実装とも現状そう振る舞う）
```

## 受け入れ基準

- [ ] 復元アルゴリズムが 1 実装に統合され、port ベースの実装（`tryRestoreFromBackupViaPort`）を正とする。`chrome.storage.local` 直参照の復元は残さない。
- [ ] 移行ステートマシン側の復元は port または共通関数へ委譲し、候補列挙・最新世代選択・既知キーフィルタのロジックを重複させない。
- [ ] バックアップキー判定に export 定数 `LEGACY_SETTINGS_BACKUP_KEY` を使用し、`SettingsRepository` に `'legacy_settings_backup'` のリテラル直書きを残さない。
- [ ] 既知キー判定を `STORAGE_KEY_VALUES` 相当の集合 1 箇所へ統一し、`Object.values(StorageKeys)` の毎回の配列生成 + `.includes()` 線形走査を残さない。
- [ ] 復元値の書き込みを共通の型付き代入（`assignSettingValue`）1 箇所に統一し、`as Record<string, unknown>` による生インデックス書き込みを残さない。両者とも検証や変換を行わない単純代入なので、値は統合前後で同一である。
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
- 復元値が変換されず同一のまま書き込まれること（文字列・オブジェクト・null）を検証する。
- 既存の復元テストは現行挙動の pin として維持する。期待値を変更する場合は、意図した等価性が保たれることを証明して更新する。

## 実装ガイド(低コストモデル向け)

このガイドだけで実装できるように書いてある。振る舞いを変えないリファクタなので、順序は「parity テストを先に書き、リファクタ前の現行コードで green を確認する → コードを動かす → 同じテストが green のまま」である。フェーズごとに green でコミットできる状態で終える。フェーズごとに別コミットにする。

### 作業ルール(固定)

- ファイルは Read ツールの `offset` / `limit` で読む。`sed` / `awk` / `head` / `tail` / `cat` で読まない。検索は `grep -n` を使う。
- コードとコメントは英語。コメントは非自明な WHY のみ。WHAT や変更履歴や PBI 番号は書かない。
- production コードで `any` / `unknown` を使わない(既存の `unknown` の移設は可。新規に増やさない)。ESM の import は `.js` 拡張子で終える。
- 固定時間の待機(`setTimeout` の sleep、`waitForTimeout`)を入れない。retry 回数も増やさない。待つときは Promise を await するか `testDir/waitPolicy.ts` の `waitForMock` を使う。`vi.useFakeTimers()` を既定オプションで呼ばない。
- 編集前に `file <path>` で改行を確認し、CRLF のファイルは CRLF を保つ。
- ツール呼び出しが権限で拒否されたら、回避せず停止して報告する。
- ファイル編集は Edit ツールで行う。`rtk` が grep 出力を省略する場合は `rtk proxy grep -n ...` を使う。

### 1. 前提と着手前チェック

この PBI は 09-30 ラウンド(06, 08, 09, 10, 11)が landing した後に実行する。それらは `src/utils/storage/*` の暗号周辺を変えるが、復元コードは触らない想定である。以下を実行し、期待どおりでなければ「2. 変更対象」に進まず、差分を報告する。行番号は approx. であり、関数名と引用で照合する。

```bash
cd /Users/yaar/Playground/obsidian-smart-history
git status --short                       # expect: empty
rtk proxy grep -n "^export async function tryRestoreFromBackup\|^export const LEGACY_SETTINGS_BACKUP_KEY\|^const STORAGE_KEY_VALUES\|^function assignSettingValue" src/utils/storage/settingsMigration.ts
# expect 4 lines (approx. :24, :123, :169, :509)
rtk proxy grep -n "^async function tryRestoreFromBackupViaPort\|legacy_settings_backup'\|Object.values(StorageKeys)" src/utils/storage/SettingsRepository.ts
# expect: function (approx. :36), literal (approx. :38), 3 Object.values lines (approx. :47, :141, :170)
rtk proxy grep -n "Object.values(StorageKeys)" src/utils/storage/settingsMigration.ts
# expect 2 lines: STORAGE_KEY_VALUES definition (approx. :123) and the restore filter (approx. :520)
rtk proxy grep -rn "tryRestoreFromBackup\b" src --include='*.ts' | grep -v __tests__
# expect only the definition in settingsMigration.ts (no production caller)
```

現状の事実(このガイドの前提):

- `tryRestoreFromBackup()`(`settingsMigration.ts`)は production の呼び出し元を持たず、テストだけが呼ぶ export である。production で復元が走るのは `SettingsRepository.getAll()` の `tryRestoreFromBackupViaPort(this.port)` だけである。
- 2 実装の差分は 3 点だけである。(a) 読み書きの port が `chrome.storage.local` 直(`withOptimisticLock` は既定の `ChromeStoragePort` に束縛)か、引数の port か。(b) 復元キーが空のとき、migration 側は `withOptimisticLock('settings', ...)` を呼び続け、repository 側は書き込みを省略する。(c) 書き込みが `assignSettingValue` か `(restored as Record<string, unknown>)[key] = value` か。(c) は両方とも単純代入で、検証も変換もない。
- `SettingsRepository.ts` は `settingsMigration.js` を動的 import でしか読まない(循環回避)。したがって共通関数を `settingsMigration.ts` に置いて repository から静的 import してはならない。共通関数は新規ファイルに置く。

### 2. 変更対象ファイル

- 作成: `src/utils/storage/settingsBackup.ts`(共通の復元実装と定数)。
- 作成: `src/utils/storage/__tests__/settingsBackupRestoreParity.test.ts`(parity/golden)。
- 作成: `src/utils/storage/__tests__/settingsBackupLiteralPin.test.ts`(静的 pin。フェーズ 2 のコミットに含める)。
- 編集: `src/utils/storage/settingsMigration.ts`、`src/utils/storage/SettingsRepository.ts`。
- 編集(必要なら): `src/utils/storage/__tests__/settingsMigration-completion-state.test.ts`(`tryRestoreFromBackup` の pin コメント)。
- 削除: なし。触らない: `TOP_LEVEL_ONLY_KEYS`、`BACKUP_RETENTION_DAYS` と `cleanupExpiredSettingsBackups` の削除ロジック、`migrateToSingleSettingsObject` のステージ順序、`SETTINGS_MIGRATION_SCHEMA_VERSION`、`MAX_REMOVE_ATTEMPTS`、`src/utils/settingsExportImport.ts` と暗号関連(`encryptionSession.ts`、`apiKeyTransition.ts`、`crypto/*`)。他の PBI ファイルも触らない。
- レジストリ: `wxt.config.ts` の `web_accessible_resources` は `content-extractor.js` と `icons/icon48.png` のみで、`src/utils/storage/*` は content script から fetch されない(`grep -rn "settingsMigration\|SettingsRepository" src/content` はテストのみ)ため更新不要。`manifest.json` はリポジトリに存在しない。確認: `rtk proxy grep -n "web_accessible_resources" -A 24 wxt.config.ts`。`src/content` 配下から新ファイルを import することになったら、その時点で停止して報告する。
- レイヤー: `eslint/rules/utils-layer-boundary.mjs` の `LAYER1_FILES` に `settingsMigration.ts` も `SettingsRepository.ts` も無い(未分類)。新ファイルも未分類のままにし、`dev-docs/LAYERS.md` と eslint ルールは変更しない。新ファイルには `// @layer` ヘッダを付けない。`npm run lint:layers-docs` が新ファイルで失敗したら、失敗メッセージに従う(`scripts/lint-layers-docs.mjs` の `DOCS_ONLY_ALLOWLIST` は docs 側にだけ存在するファイル用なので、原則触らない)。
- import 方向: 新ファイルは `./types.js`、`./storagePort.js`(型のみ)、`./storageTransaction.js` だけを import する。`settingsMigration.js` / `SettingsRepository.js` / `encryptionSession.js` を import しない(循環になる)。

### 3. 手順(フェーズ)

フェーズ 0 はテストだけ、フェーズ 1 以降はコード変更である。各フェーズ末で「6. 検証コマンド」の 1 から 4 を通し、green でコミットする。

#### フェーズ 0: parity/golden テストを先に書く(コード変更なし)

「4. テスト先行」の `settingsBackupRestoreParity.test.ts` を作り、現行コードで `npx vitest run src/utils/storage/__tests__/settingsBackupRestoreParity.test.ts` が全 green であることを確認する。静的 pin(`settingsBackupLiteralPin.test.ts`)もここで書いて現行コードで red(リテラルが `SettingsRepository.ts` と `settingsMigration.ts` にある)を確認するが、コミットには含めず、フェーズ 2 のコミットで green にして一緒に入れる。コミット: `test(storage): 設定バックアップ復元の parity テストを追加する`。

#### フェーズ 1: 共通実装を新設し、既知キー判定と定数を寄せる

1. `src/utils/storage/settingsBackup.ts` を作る。`STORAGE_KEY_VALUES` と `LEGACY_SETTINGS_BACKUP_KEY` は `settingsMigration.ts` から移設する(定義を 1 箇所にするため)。

```ts
import { StorageKeys } from './types.js';
import type { Settings, StorageKey } from './types.js';
import type { StoragePort } from './storagePort.js';
import { StorageTransaction } from './storageTransaction.js';

export const LEGACY_SETTINGS_BACKUP_KEY = 'legacy_settings_backup';

export const STORAGE_KEY_VALUES: ReadonlySet<string> = new Set<string>(Object.values(StorageKeys) as string[]);

export function isStorageKeyValue(key: string): key is StorageKey {
    return STORAGE_KEY_VALUES.has(key);
}

export function assignSettingValue(settings: Settings, key: StorageKey, value: unknown): void {
    const target = settings as Record<StorageKey, unknown>;
    target[key] = value;
}

// Prefix match on purpose: generations are stored as `${LEGACY_SETTINGS_BACKUP_KEY}_${createdAt}`.
export function listSettingsBackupKeys(all: Record<string, unknown>): string[] {
    return Object.keys(all).filter((k) => k.startsWith(LEGACY_SETTINGS_BACKUP_KEY));
}

// Lexicographic on the key string, not numeric: `_9` outranks `_10`. Kept as-is to preserve behavior.
export function selectLatestSettingsBackupKey(keys: readonly string[]): string | null {
    return [...keys].sort().reverse()[0] ?? null;
}

export async function restoreLatestSettingsBackup(port: StoragePort): Promise<Settings | null> {
    const all = await port.get(null);
    const firstKey = selectLatestSettingsBackupKey(listSettingsBackupKeys(all));
    if (!firstKey) return null;
    const latest = all[firstKey] as { data: Record<string, unknown>; createdAt: number } | undefined;
    if (!latest?.data) return null;
    const restored: Settings = {};
    for (const [key, value] of Object.entries(latest.data)) {
        if (isStorageKeyValue(key)) assignSettingValue(restored, key, value);
    }
    if (Object.keys(restored).length > 0) {
        const tx = new StorageTransaction(port);
        await tx.withLock<Settings>('settings', (current) => ({ ...(current ?? {}), ...restored }));
    }
    return restored;
}
```

2. `settingsMigration.ts`: 先頭の `export const LEGACY_SETTINGS_BACKUP_KEY = ...` と `const STORAGE_KEY_VALUES ...` と `function assignSettingValue` を削除し、import に置き換える。既存 import(テストが `settingsMigration.js` から読む)を壊さないよう再 export する。

```ts
import { LEGACY_SETTINGS_BACKUP_KEY, STORAGE_KEY_VALUES, assignSettingValue } from './settingsBackup.js';
export { LEGACY_SETTINGS_BACKUP_KEY };
```

3. 同ファイルの `hasCoveringBackup` と `cleanupExpiredSettingsBackups` の `Object.keys(all).filter((k) => k.startsWith(LEGACY_SETTINGS_BACKUP_KEY))` は `listSettingsBackupKeys(all)` へ置換する(`cleanupExpiredSettingsBackups` は削除ロジックを変えず、候補列挙の 1 行だけ置換する。元が `filter` 内で `startsWith` 判定後に期限を見る形なら、そのまま `listSettingsBackupKeys(all).filter(...)` で期限だけ判定する)。`import { ..., listSettingsBackupKeys } from './settingsBackup.js'` に足す。
4. `SettingsRepository.ts` の 141 行付近(`getAll` 内 `validKeys`)と 170 行付近(`__getAllScatteredFallback` 内 `keysToGet`)を置換する。

```ts
// before
const validKeys: string[] = Object.values(StorageKeys) as string[];
...
if (validKeys.includes(k)) (filtered as Record<string, unknown>)[k] = v;
// after
if (STORAGE_KEY_VALUES.has(k)) (filtered as Record<string, unknown>)[k] = v;

// before
const keysToGet: string[] = Object.values(StorageKeys) as string[];
// after
const keysToGet: string[] = [...STORAGE_KEY_VALUES];
```

`import { STORAGE_KEY_VALUES } from './settingsBackup.js';` を足し、`StorageKeys` が未使用になったら import から外す(`grep -n "StorageKeys" src/utils/storage/SettingsRepository.ts` で確認)。Set の順序は `Object.values` と同じ挿入順なので `port.get(keysToGet)` の引数は同一である。コミット: `refactor(storage): 既知キー集合とバックアップキー定義を settingsBackup に集約する`。

#### フェーズ 2: 復元アルゴリズムを 1 実装にする

5. `SettingsRepository.ts` の `tryRestoreFromBackupViaPort` 関数本体を削除し、呼び出しを置換する。`import { restoreLatestSettingsBackup } from './settingsBackup.js';`

```ts
// before
const recovered = await tryRestoreFromBackupViaPort(this.port);
// after
const recovered = await restoreLatestSettingsBackup(this.port);
```

`StorageTransaction` は `persistReEncrypted` でまだ使うので import は残す。
6. `settingsMigration.ts` の `tryRestoreFromBackup` を 1 行に委譲する。`ChromeStoragePort` は既に import 済みである。

```ts
export async function tryRestoreFromBackup(): Promise<Settings | null> {
    return restoreLatestSettingsBackup(new ChromeStoragePort());
}
```

`withOptimisticLock` の他の使用箇所は残るので import は外さない(`grep -n "withOptimisticLock" src/utils/storage/settingsMigration.ts` で確認)。書き込みの直列化は `storageTransaction.ts` のモジュールレベルのキュー(キー単位)を共有するため、`new StorageTransaction(port)` と `withOptimisticLock` の間でも順序は保たれる。
7. `settingsBackupLiteralPin.test.ts` が green になったことを確認する。コミット: `refactor(storage): 設定バックアップ復元を restoreLatestSettingsBackup に一本化する`。本文に、`tryRestoreFromBackup` に production の呼び出し元が無いこと、空復元時は書き込みを省略する挙動へ揃えたこと(no-op の merge なので blob の内容は変わらない)を書く。

### 4. テスト先行

fixture は `settingsStore-backup.test.ts` の `store` + `chrome.storage.local.get/set` 差し替えパターンと、`SettingsRepository.test.ts` の `InMemoryStorageAdapter` + `adapter.seed(...)` パターンを組み合わせる。先頭は `import { describe, it, expect, beforeEach, afterEach } from 'vitest';`、`installTestSecretKek`(`../../crypto/__tests__/secretKekHelper.js`)を `beforeEach` で await する。

`settingsBackupRestoreParity.test.ts`(`describe('settings backup restore parity')`)。同一の store 内容を 2 経路に流し、結果を比べる。

- 経路 A(migration): `InMemoryStoragePort` を作り `seed`、`chrome.storage.local.get = (k) => port.get(k)` と `.set = (items) => port.set(items)` を代入して `tryRestoreFromBackup()` を呼ぶ。`afterEach` で元の関数に戻す。未実装のメソッドが呼ばれたらその都度 port へ委譲を足す。
- 経路 B(repository): 別の `InMemoryStorageAdapter` に `seed({ settings: {}, settings_migrated: true, ...backups })`(`settings_migrated: true` は `isSettingsMigrationComplete(true) === true` であり `settingsStore-backup.test.ts` と同じ)し、`new SettingsRepository(adapter, { keyProvider })`(`keyProvider` は `settingsRepository-migration-parity.test.ts` の手法を写す。写せなければ `settingsStore-backup.test.ts` のように `settingsRepository.getAll()` を使う)で `await repo.getAll()` を呼び、`(await adapter.get('settings'))['settings']` の永続 blob を取る。
- 比較は「A が返した復元オブジェクト」と「B の永続 blob(復元後)」で行う。B は `getAll()` の戻り値でなく blob を見る(戻り値は復号・defaults を通る)。

ケース(すべて `it.each` か個別 `it`。キーは `StorageKeys.OBSIDIAN_PORT` / `StorageKeys.OBSIDIAN_HOST` を使う):

1. 2 世代: `legacy_settings_backup_1750000000000`(port `'1111'`, host `'old-host'`)と `legacy_settings_backup_1750000000001`(port `'2222'`)。A と B ともに新しい世代の port `'2222'` を採る。host は新世代に無いので復元されない。
2. 未知キー: バックアップに `not_a_storage_key: 'x'` を混ぜる。A の戻りにも B の blob にも含まれない。
3. 辞書順: `legacy_settings_backup_9` と `legacy_settings_backup_10` では `_9` が選ばれる(数値順ではない現行仕様の pin)。
4. 素のキー: `legacy_settings_backup` と `legacy_settings_backup_1` が併存すると `_1` が選ばれる。
5. 値の素通し: 文字列・オブジェクト(`{ a: 1 }`)・`null` が同一値で復元される(`toEqual`)。
6. マージ(経路 A のみ。B の `getAll()` は blob が空のときしか復元しないため): blob に `{ [OBSIDIAN_HOST]: 'keep', [OBSIDIAN_PORT]: 'old' }` がある状態で `tryRestoreFromBackup()` を呼ぶと、blob の host は `'keep'` のまま port はバックアップ値になる。戻り値はバックアップ由来のキーだけ(blob 全体ではない)。テスト名に `(migration path only)` を含める。
7. バックアップ無し / `data` 無しのエントリ: A は `null`。B は復元が起きず blob が `{}` のまま。
8. 空復元: `data` に未知キーしか無い。A の戻りは `{}`、blob は書き換わらない(deepEqual)。`settings_version` の増減は assert しない(統合で書き込み省略に揃うため)。
9. 静的な API pin: `isMigratableStorageKey('legacy_settings_backup_1750000000000')` が `false`、`isMigratableStorageKey(StorageKeys.OBSIDIAN_PORT)` が `true`(フェーズ 1 の移設で壊さない)。

`settingsBackupLiteralPin.test.ts`(`lockKeyBypassContract.test.ts` の `readdirSync` / `readFileSync` / `resolve` パターンを写す): `src` 配下の production `.ts`(`__tests__`、`*.test.ts` を除く)を走査し、正規表現 `/(['"])legacy_settings_backup\1/` に一致するファイルが `src/utils/storage/settingsBackup.ts` の 1 件だけであることを `expect(hits).toEqual(['src/utils/storage/settingsBackup.ts'])` で確認する。加えて `SettingsRepository.ts` が `settingsBackup.js` を import していることを `toContain` で確認する。コメント内の `` `legacy_settings_backup_*` `` は引用符のバッククォートに一致しないので拾わない。

実行コマンド(リファクタ前後で同じ。ケース 1 から 9 は前後とも green、静的 pin だけは前 red / 後 green):

```bash
npx vitest run src/utils/storage/__tests__/settingsBackupRestoreParity.test.ts
npx vitest run src/utils/storage/__tests__/settingsBackupRestoreParity.test.ts --repeats=20
```

### 5. 既存テストへの影響

- `vi.mock` factory で `settingsMigration.js` を丸ごと置換しているのは `src/background/__tests__/deferredMigrations.test.ts` だけで、export の集合を変えない(`LEGACY_SETTINGS_BACKUP_KEY` は再 export する)ため変更不要。`recordingCache-instance.test.ts` / `recordingCache-session.test.ts` は `importOriginal` を使うので影響なし。確認: `rtk proxy grep -rn "vi.mock(.*settingsMigration" src`。
- `SettingsRepository.js` を mock する多数のテスト(`importOriginal` 型)は `SettingsRepository.ts` の export を増減しないので影響なし。`SettingsRepository.ts` に新しい export を足さない。
- `vi.mock('.../settingsBackup.js', ...)` を新たに書くテストを作らない。書く場合は factory に上記 7 個の export を全て入れる(欠けると `No "X" export is defined on the mock`)。
- `crypto.subtle` を空の `vi.fn()` で stub するテスト(例: `src/utils/__tests__/storage-locking.test.ts`)は空文字列を返す。復元経路は暗号を呼ばないが、`SettingsRepository.getAll()` 経由のテストは復号を通るので、失敗したら復元でなく stub の問題として切り分ける。
- `settingsMigration-completion-state.test.ts` の `tryRestoreFromBackup()` pin(`harness.data['settings'] = {}` の後に復元)は、委譲後も同じ store(`chrome.storage.local` のグローバル mock)を `ChromeStoragePort` 経由で読むので green のまま。テストヘッダのコメントが「default `ChromeStoragePort`, `withOptimisticLock` and `tryRestoreFromBackup()` が同じ store」と述べており、なお正しい。変更不要のはずだが、赤ければ期待値でなく委譲の実装側を疑う。
- `dailyPurgeHandler.test.ts` と `aiUsageTracker.test.ts` はバックアップキー文字列を fixture に持つだけで、production の import に依存しない。

### 6. 検証コマンド(順番どおり)

```bash
npm run type-check
npm run lint                        # 0 errors
npm run lint:layers-docs
npx vitest run src/utils src/dashboard src/background src/popup
npx vitest run src/utils/storage/__tests__/settingsBackupRestoreParity.test.ts --repeats=20
npx vitest run src/utils/storage/__tests__/settingsBackupLiteralPin.test.ts --repeats=20
npm run build
```

### 7. 落とし穴

- 共通関数を `settingsMigration.ts` に置き、`SettingsRepository.ts` から静的 import すると循環する。新ファイル `settingsBackup.ts` に置く。
- `startsWith` を `===` にしない。ソートを数値順や `createdAt` 順にしない(`_9` と `_10` の pin が落ちる。仕様変更は本 PBI の範囲外)。
- 空復元で書き込みを省略する挙動へ揃える点だけが migration 側の観測可能な差(blob の内容は変わらず CAS のバージョン番号だけ増えなくなる)。テストでバージョン番号を assert しない。
- `STORAGE_KEY_VALUES` を `SettingsRepository.ts` に複製しない。`isMigratableStorageKey` は `settingsMigration.ts` に残し、`STORAGE_KEY_VALUES` を import して使う。
- `tryRestoreFromBackup` の export 名と戻り値型 `Promise<Settings | null>` を変えない(テストが参照)。
- `assignSettingValue` を移設したら、`settingsMigration.ts` 内の他の 3 呼び出し(`migrateToSingleSettingsObject` 系)が import で解決されることを type-check で確認する。
- 静的 pin は実行コードだけを対象にする。テストファイルとコメントは含めない。

### 8. コミットとアーカイブ手順

(a) 受け入れ基準と Definition of Done のチェックボックスを `[x]` にする。`コードレビューが完了している。` だけは `[ ]` のままにする。
(b)(c) フェーズごとにコミットする。`git add -A` / `git add .` は使わず、パスを配列で明示する。zsh なので配列を使う。

```bash
files=(
  src/utils/storage/settingsBackup.ts
  src/utils/storage/settingsMigration.ts
  src/utils/storage/SettingsRepository.ts
  src/utils/storage/__tests__/settingsBackupRestoreParity.test.ts
  src/utils/storage/__tests__/settingsBackupLiteralPin.test.ts
)
git add "${files[@]}"
git commit -m "refactor(storage): 設定バックアップ復元を単一実装にする" \
  -m "復元アルゴリズムが 2 ファイルに分かれ、片方がキー定数を直書きして drift していたため、共通関数へ統合した。振る舞いは parity テストで固定している。" -- "${files[@]}"
```

(d) アーカイブ。最後のコミットの後、PBI ファイルだけを別コミットにする。

```bash
pbi=pbi/2026-09-28-05-refactor-settings-backup-restore-single-source.md
git add "$pbi"
git mv "$pbi" dev-docs/archived/pbi/
archived=(dev-docs/archived/pbi/2026-09-28-05-refactor-settings-backup-restore-single-source.md)
git commit -m "docs(pbi): 09-28 PBI 05(設定バックアップ復元の単一実装化)をアーカイブする" -- "$pbi" "${archived[@]}"
```

### 9. 完了条件

- 「6. 検証コマンド」がすべて成功し、parity テストが `--repeats=20` で毎回 green である。
- `rtk proxy grep -rn "legacy_settings_backup'" src --include='*.ts' | grep -v __tests__` の出力が `settingsBackup.ts` の 1 行だけである。
- `rtk proxy grep -n "Object.values(StorageKeys)" src/utils/storage/SettingsRepository.ts src/utils/storage/settingsMigration.ts` が 0 件、`tryRestoreFromBackupViaPort` が 0 件である。
- 受け入れ基準と DoD が `[x]`(`コードレビュー完了` を除く)、PBI が `dev-docs/archived/pbi/` に移動済みである。

## 見積もり

**0.5 SP**

1. 復元共通関数の抽出と 2 実装の委譲化（`tryRestoreFromBackupViaPort` を正とする）が 0.2 SP。既知キー判定の集合統一（`SettingsRepository` 3 箇所 + `settingsMigration` 1 箇所）が 0.15 SP。静的 pin テストと parity テストの追加・更新が 0.15 SP。storage 構造・メッセージ契約・移行ステージ順序の変更は含まない。

## 技術的考慮事項

行番号は approx. であり、関数名と引用で照合する。

- 復元アルゴリズムの二重実装は、`settingsMigration.ts` の `tryRestoreFromBackup`（approx. :509-526）と `SettingsRepository.ts` の `tryRestoreFromBackupViaPort`（approx. :36-57）である。差分は port 経由か `chrome.storage.local` 直か、空復元時に書き込みを省略するか、書き込みが `assignSettingValue` か生インデックス代入か（どちらも検証・変換なしの単純代入）のみである。
- `tryRestoreFromBackup` は production の呼び出し元を持たず、テストからのみ呼ばれる。production の復元経路は `SettingsRepository.getAll()`（blob が空のとき）だけである。
- バックアップキーの正は `settingsMigration.ts` の `LEGACY_SETTINGS_BACKUP_KEY`（approx. :24）で、使用箇所は `writeAndVerifyBackup`、`hasCoveringBackup`、`tryRestoreFromBackup`、`cleanupExpiredSettingsBackups` である。`SettingsRepository.ts` の `tryRestoreFromBackupViaPort` は同値を `'legacy_settings_backup'` とリテラルで直書きしている。
- 既知キー判定は production で 4 箇所が毎回配列を生成している（`SettingsRepository.ts` の復元フィルタ・`getAll` の `validKeys`・`__getAllScatteredFallback` の `keysToGet`、`settingsMigration.ts` の `tryRestoreFromBackup` 内 `Object.values(StorageKeys).includes(...)`）。`settingsMigration.ts` の `STORAGE_KEY_VALUES: ReadonlySet<string>`（approx. :123）は `isMigratableStorageKey` だけが使っている。
- 候補キーの前方一致（`legacy_settings_backup*`）は、`writeAndVerifyBackup` が `${LEGACY_SETTINGS_BACKUP_KEY}_${createdAt}` を生成するため意味論である。完全一致へ狭めると既存バックアップが読めなくなる。
- 世代選択はキー文字列の辞書順の降順で先頭を取る（数値順ではない。`_9` が `_10` より優先される）。この 3 段（filter → sort → 先頭）は同一アルゴリズムとして共通化し、順序は変えない。
- 復元は既存 settings へマージされるため write seam への依存が契約である。repository 側は `new StorageTransaction(port).withLock('settings', ...)`、migration 側は `withOptimisticLock('settings', ...)`（既定の `ChromeStoragePort` に束縛）を使う。キー単位の直列化キューはモジュールで共有される。
- 移行ステートマシン（`SETTINGS_MIGRATION_SCHEMA_VERSION`、ステージ順序、`MAX_REMOVE_ATTEMPTS`）は中断再開の契約であり、変更しない。
- 既存の復元テストは現行挙動を pin している。`settingsMigration-completion-state.test.ts` はバックアップが `tryRestoreFromBackup()` で消費可能であることを検証し、`settingsStore-backup.test.ts` は `getAll()` の復元を検証する。
- UI 契約・i18n・storage スキーマは変更しない。

## 決定事項

1. 復元アルゴリズムが 2 実装に分裂した理由は、移行ステートマシン用の直接 storage 版と、repository 経路の port 版が別々に追加され、共通部分（候補列挙と世代選択）を抽出していなかったためである。
2. 片方だけが定数を使わずにいた理由は、repository 側が移行の `LEGACY_SETTINGS_BACKUP_KEY` を import せず、文字列で同じ意味を表現したためである。
3. 既存テストで drift が検出されなかった理由は、両者の復元結果を比較する parity テストが存在せず、各経路がそれぞれの期待値を持っていたためである。
4. 今是正する必要が立っている理由は、実害ではなく、キー 定義の SSOT 外れと検証水準の乖離という発見的な保守性負債であり、是正期限がないためである。
5. port ベースの実装（`tryRestoreFromBackupViaPort`）を正とし、`tryRestoreFromBackup` は共通関数へ委譲する。逆方向には統合しない。
6. 復元値の書き込みは共通の `assignSettingValue` 1 箇所に統一し、生インデックス書き込みを残さない（両者とも検証・変換なしの単純代入で、値は変わらない）。
7. バックアップキーの判定は `LEGACY_SETTINGS_BACKUP_KEY` の前方一致（suffix 変種を含む）を保持する。完全一致化しない。
8. 既知キー判定は `STORAGE_KEY_VALUES` 相当の集合 1 箇所を SSOT とし、`Object.values(StorageKeys)` の毎回生成を残さない。
9. 挙動の pin は byte 同一ではなく復元結果の等価性で行う。加えて production のリテラル直書き 0 件を静的 pin として固定する。

## Definition of Done

- [ ] 復元アルゴリズムが 1 実装に統合され、port ベースの実装が正になっている。
- [ ] 移行ステートマシン側の復元が共通関数へ委譲され、`chrome.storage.local` 直参照の復元ロジックが残っていない。
- [ ] `LEGACY_SETTINGS_BACKUP_KEY` を import しており、production に `'legacy_settings_backup'` のリテラル直書きが 0 件である。
- [ ] 既知キー判定が集合 1 箇所に統一され、毎回の配列生成 + 線形走査が残っていない。
- [ ] 復元値の書き込みが `assignSettingValue` 1 箇所に統一され、生インデックス書き込みが排除されている。
- [ ] バックアップキーの前方一致（suffix 変種）意味論が保持されている。
- [ ] 2 系統の復元結果の parity テストが green であり、既存復元テストが pin として維持されている。
- [ ] `npm run validate` が成功し、既存テストに回帰がない。
- [ ] BDD 受け入れシナリオとテスト戦略の検証が完了している。
- [ ] コードレビューが完了している。
