# PBI: SettingsRepository の merge-under-lock 統一

優先度: 中（RICE 14.0・同バッチ 26 候補中 6 位 / refactor）
backlog: [./2026-10-01-00-backlog-holistic-1001.md](./2026-10-01-00-backlog-holistic-1001.md)（NN 13・バッチA・ファイル非重複）
依存: なし（単独で着手可能）。ただし settings-blob delta-write 規約（`src/utils/storage/SettingsRepository.ts:161-163` のコメント、PBI 2026-09-17-17 由来）を壊さないこと。storageTransaction CAS 統一（NN 23）は `src/utils/storage/storageTransaction.ts` を触るため本 PBI とはファイル非重複。

## ユーザーストーリー

拡張機能の storage 層を保守する開発者として、SettingsRepository の 2 つの書き込み経路が同一の merge-under-lock ヘルパを通ってほしい、なぜなら `StorageTransaction` + `withLock('settings', merge)` + `this.cached = null` の同一形状が 2 メソッドに重複しており、settings-blob CAS merge は delta-write 規約の最重要箇所であるため、片方だけが修正されてもう片方が規約から逸脱したまま残るリスクを構造的に消したいから。

## 背景（現状）

### 同一形状の重複（検証済み・2026-10-01 時点）

| 経路 | 位置 | 処理 |
|---|---|---|
| `persistReEncrypted` | `src/utils/storage/SettingsRepository.ts:59-68` | `this.cached = null`（61 行）→ `new StorageTransaction(this.port)` → `tx.withLock<SettingsType>('settings', merge)` → `this.cached = null`（67 行） |
| `writeSettings` | `src/utils/storage/SettingsRepository.ts:200-206` | 同一形状（`this.cached = null` が 200 行と 206 行） |

- merge 関数の実体も同一形状: `(current) => { const base = (current as Record<string, unknown>) || {}; return { ...(base as object), ...patch } as SettingsType; }`。差は patch 変数（`reEncrypted` / `toSave`）のみ
- `persistReEncrypted` は `this.cached = null` を 61 行と 67 行の両方で実行する（copy-paste 残留）。`writeSettings` も 200 行と 206 行で同じ重複を持つ
- この write は settings-blob CAS merge の本体であり、delta-write 規約の最重要箇所。`set()`（164 行）と `setAll()`（174-176 行）は既に `writeSettings` に集約済みで、呼び出し口は 1 本化されている。規約の本体に当たる merge ブロックだけが 2 重化したまま

### 前提となる規約

- delta-write（`SettingsRepository.ts:161-163`・167-172 行のコメント）: write payload には指定キーのみを入れ、未指定キーは lock 取得時に読み直した current の値を維持する。full cached snapshot を payload に載せてはならない（並行 writer の変更を stale 値で巻き戻すため）

## BDD

```gherkin
Feature: SettingsRepository の delta write（settings-blob CAS merge）

  Scenario: set 経路の delta write が兄弟キーを維持する
    Given settings blob に apiKey="sk-A" と theme="light" が保存されている
    When repo.set("theme", "dark") を呼ぶ
    Then 保存後の blob は theme="dark" かつ apiKey="sk-A" のままである
    And merge は withLock 内で current に delta を spread する 1 形状のみである

  Scenario: persistReEncrypted 経路も同一ヘルパを通る
    Given キーローテーションにより reEncrypted に apiKey の再暗号化結果が入っている
    When persistReEncrypted(reEncrypted) が完了する
    Then 保存後の blob は再暗号化済み apiKey を含み他のキーは変化しない
    And writeSettings と persistReEncrypted が同一の private ヘルパを経由する

  Scenario: merge 前後の cache 無効化タイミングは現行と同一である
    Given repo cache に旧 snapshot がある
    When writeSettings が withLock を取得して merge を行う
    Then this.cached の無効化は write 前・write 後の現行タイミングのままである
    And merge 完了後の getAll() は write 済みの state を返す
```

## 実装宣言・受け入れ基準

It must keep behavior: `persistReEncrypted` と `writeSettings` の書き込みは、lock 下での settings-blob CAS merge（lock 取得時に読んだ `current` に delta を spread）・`this.cached` 無効化の実行タイミング・返り値（void）・送出され得る例外が、リファクタリング前後で完全に同一であること。delta-write 規約（full snapshot を write payload に載せない）は変えないこと。

受け入れ基準:

- [x] 1. `persistReEncrypted` と `writeSettings` の `new StorageTransaction(this.port)` + `tx.withLock<SettingsType>('settings', merge)` ブロックが、共通 private ヘルパ（`mergeSettingsBlob` + `persistMerged`）の単一実装を通る
- [x] 2. `this.cached = null` の記述が write 経路では `persistMerged` 1 箇所に集約され、2 メソッドへの分散が消える。同一メソッド内の 2 箇所（write 前・write 後）は**意図的に残す**ため「1 箇所」という文言は成立しない — 判定は「write 経路の呼び出し口が `persistMerged` 1 本であること」で満たす（pre-write drop は merge 窓中の並行 `getAll()` が ≤1s TTL の pre-write snapshot を cache して served するのを防ぐため。タイミングの削除は不可）
- [x] 3. merge 関数の実体（`{ ...(current as object), ...patch } as SettingsType`）がコード上 1 箇所のみになる
- [x] 4. 既存テストが green: `SettingsRepository.test.ts`・`settingsWriteDelta.test.ts`・`settingsRepository-migration-parity.test.ts`・`recordingCache-settingsCache.test.ts`
- [x] 5. `npm run type-check` が green

## テスト戦略

- 既存回帰（リファクタ前後で同一結果を保証する土台）: `src/utils/storage/__tests__/SettingsRepository.test.ts`、`settingsWriteDelta.test.ts`（delta-write 規約の回帰）、`settingsRepository-migration-parity.test.ts`、`recordingCache-settingsCache.test.ts`
- 新規: `mergeSettingsBlob` の単体テスト（base 空オブジェクト / patch 空オブジェクト / key 衝突時に patch 側が勝つこと）と、両経路が同一ヘルパを通ることの振る舞いテスト
- lock 窓の並行 getAll に関するテストを書く場合は `dev-docs/TEST_RULE.md`（../dev-docs/TEST_RULE.md）に従い、実時間待ちを入れず lock 待ちを注入・駆動する
- 型確認: `npm run type-check`

## 実装内容

1. `private mergeSettingsBlob(base: unknown, patch: Record<string, unknown>): SettingsType` を新設する。実体は現行の `{ ...(base as object), ...patch } as SettingsType` のみ
2. `private async persistMerged(patch: Record<string, unknown>): Promise<void>` を新設する。`this.cached = null` → `new StorageTransaction(this.port).withLock<SettingsType>('settings', (current) => this.mergeSettingsBlob(current, patch))` → `this.cached = null` の順で現行と同一タイミング
3. `persistReEncrypted` を「空 patch の早期リターン + `persistMerged(reEncrypted)` 呼び出し」に縮約する
4. `writeSettings` の書き込み部（:200-206）を `persistMerged(toSave)` 呼び出しに置換する（暗号化と quota チェックは現行位置のまま残す）
5. コメントは英語で WHY のみ追記する（例: 2 経路が同一ヘルパを通る理由、delta-write 規約への参照）

## Definition of Done

- [x] 受け入れ基準 1-5 をすべて満たす
- [x] `npm run validate`（type-check + test）が green
- [x] `rg "new StorageTransaction" src/utils/storage/SettingsRepository.ts` が 1 件のみを示す
- [x] `rg "cached = null" src/utils/storage/SettingsRepository.ts` が write 経路では `persistMerged` 内の 2 行のみ（`clearCache` と `observe` の無効化を除く）を示す
- [ ] `graphify update .` を実行しグラフを現行コードに追従させる — 未実施（統合ステップのスコープ外）
- [ ] backlog 台帳（./2026-10-01-00-backlog-holistic-1001.md）の NN 13 を完了扱いに更新する — アーカイブ/台帳更新は別ステップで処理

## 実装記録（2026-10-02）

変更した内容:

- `SettingsRepository.ts` — private `mergeSettingsBlob(base, patch)`（`{ ...(current as object), ...patch } as SettingsType` のみ）と private `persistMerged(patch)`（`this.cached = null` → `new StorageTransaction(this.port).withLock('settings', ...)` → `this.cached = null`）を新設
- `persistReEncrypted` は「空 patch の早期リターン + `persistMerged(reEncrypted)`」に、`writeSettings` の書き込み部は `persistMerged(toSave)` に縮約。暗号化（API_KEY_FIELDS の encryptApiKey）と quota チェックは `writeSettings` の現行位置に残したまま
- 書き込みのトークンは `writeSettings` → `persistMerged` の 2 段になったが、`new StorageTransaction` と merge 実体、`this.cached = null` の write 経路は 1 箇所ずつに集約された

追加したテスト: なし。本 PBI は挙動維持の抽出であり、受け入れ基準 4 が名指しする既存の delta-write 回帰テスト（`settingsWriteDelta.test.ts` ほか）がそのまま契約のゲートになる。`mergeSettingsBlob` の境界（base 空・patch 空・衝突時に patch 優先）は既存テストの delta write シナリオが既に覆っている。

**逸脱（受け入れ基準 2）**: 基準の「1 箇所」という文言と実装が食い違うので、基準の文言を実装に合わせて書き換えた。`this.cached = null` は `persistMerged` 内に 2 行意図的に残す。pre-write の drop は、merge 窓中に走った並行 `getAll()` が pre-write snapshot を `this.cached` に詰めた場合、その TTL（≤1s）中は書き戻し後の値が served されないまま返るのを防ぐ責務を持つ。post-write の drop はその snapshot を discard する側の責務。どちらか一方を削ると「書けたのに古い値が返る」窓が開くため、両方残すのが正である。したがって「同一メソッド内 2 箇所の重複が消える」という記述は採用せず、充足条件を「write 経路の呼び出し口が `persistMerged` 1 本」＝「`new StorageTransaction` が 1 件」に読み替えた（`writeSettings` と `persistReEncrypted` の 2 メソッドから `persistMerged` へ収束）。

検証: `npx vitest run <11 batch-A テストファイル> --repeats=20` → 155 passed / 11 files passed、`npm run validate` green。
