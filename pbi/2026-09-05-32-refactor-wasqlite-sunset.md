# PBI: wa-sqlite レガシー・サンセット実行（ADR-014 ゲート後）

優先度: スパイク推奨 Option A（S・低リスク） / RICE: ゲート条件付きのため参考値なし
backlog: [dev-docs/dig-findings-2026-09-05-sqlite-backend-consolidation.md](../dev-docs/dig-findings-2026-09-05-sqlite-backend-consolidation.md)（PBI-A 切り出し案）
依存: **ADR-014 サンセットゲート（2026-12-17）到達＋ゲート条件成立**（診断パネルで未完了報告ゼロ）を確認してから着手すること。ゲート前の着手は禁止（未移行ユーザーのデータ参照経路を消すため）。

## ユーザーストーリー
拡張機能の配布物を保守する開発者として、サンセットゲート後に旧 wa-sqlite 移行経路と依存を削除してほしい、なぜなら ~2.7MB の依存削減と移行系ファイルの消滅により保守面が単純化する一方、ゲート前に削除すると未移行ユーザーのデータ参照が永久に失われるから。

---

## 実装ガイド（2026-09-14 再調査済み）

### ⚠️ 着手前に必ずゲート条件を確認すること

このPBIは **2026-12-17 まで着手禁止**。ゲート到達後、診断パネルで「移行未完了の報告がゼロ」であることを確認・記録してから作業を始める。

### 削除対象ファイル（実在確認済み・2026-09-14時点）

| ファイル | wa-sqlite 実 import | 備考 |
|---|---|---|
| `src/offscreen/sqliteEngineContext/migrationBackup.ts` | あり（181-183行目） | **後述の注意あり** |
| `src/offscreen/opfsMigrationV2Reader.ts` | あり（57-59行目） | |
| `src/offscreen/opfsMigrationV2.ts` | なし（Reader経由） | |
| `src/offscreen/opfsWorker/migrationV2.ts` | なし（上記2つを呼ぶ） | |
| `src/offscreen/wa-sqlite.d.ts` | 型宣言のみ（10箇所） | **PBIの旧版で漏れていた。これも削除対象** |

`wa-sqlite` パッケージへの**実際の import は2ファイルのみ**（`migrationBackup.ts` と `opfsMigrationV2Reader.ts` の動的 import）。`src/` 全体の `wa-sqlite` 文字列69件のうち大半はコメント（`sqliteEngine.ts`・`migrations.ts`・`recordsRepo.ts`・`opfsWorker.ts`・`sqliteEngineHost.ts` 等）で、削除対象ではない。

### 🔴 最重要の落とし穴: `extractDomain` の re-export

`migrationBackup.ts:130` に以下がある:

```typescript
export { extractDomain } from '../../utils/domainUtils.js';
```

これは**単なる re-export だが、現役コードが依存している**:
- `src/offscreen/sqliteEngineContext/fallbackMigration.ts:14` → `import { extractDomain } from './migrationBackup.js';`

`migrationBackup.ts` を削除する前に、`fallbackMigration.ts:14` の import 元を本体（`../../utils/domainUtils.js`）に付け替えること。付け替えを忘れると type-check が落ちる。

関数本体は `src/utils/domainUtils.ts:37` にあり、削除対象ではない。`sqliteEngineHost.ts:60` にも同じ re-export があるが、そちらは削除対象ファイルではないので触らない。

### 削除対象ファイルを import している側（先に修正が必要）

```
src/offscreen/opfsWorker.ts:51                     → opfsWorker/migrationV2.js の runMigrationV2 / MigrationContext
src/offscreen/sqliteEngineHost.ts:42               → migrationBackup.js の runMigrationBackup / runMigrationRestore / MigrationBackupState
src/offscreen/sqliteEngineContext/fallbackMigration.ts:14 → migrationBackup.js の extractDomain（上記の落とし穴）
src/offscreen/opfsWorker/migrationV2.ts:7-8        → opfsMigrationV2.js / opfsMigrationV2Reader.js（削除対象同士なので同時消滅でよい）
```

`opfsWorker.ts` と `sqliteEngineHost.ts` からは、移行ルーチン呼び出しごと削除することになる。呼び出し箇所の前後にある初期化フローが壊れないか（移行スキップ時のフォールバック経路が残っているか）を確認すること。

### STATUS 公開部について（PBIの旧記述は誤り）

旧版は「`sqliteMessageHandlers.ts` の `OPFS_MIGRATION_V2_*` STATUS 公開部」と書いていたが、**`sqliteMessageHandlers.ts` に該当箇所はない**。実際の参照箇所:

```
src/offscreen/sqliteStatus.ts:78-82, 99-103   ← 診断パネルへ返す extras の組み立て
src/offscreen/opfsWorker/migrationV2.ts       ← 削除対象ファイル自体
src/utils/storage/defaults.ts                 ← StorageKeys のデフォルト値
src/utils/storage/types.ts:244-245            ← StorageKeys 定義とコメント
```

**判断が必要**: `sqliteStatus.ts` の extras（`opfsMigrationV2Done` 等）は診断パネルの移行状態表示に使われている。移行経路を消すなら表示も不要になるが、以下の連鎖がある:

- `src/dashboard/panels/diagnostic/diagnosticsPanel.ts` の `deriveMigrationStatus` / `renderMigrationSection`
- `src/dashboard/panels/diagnostic/__tests__/deriveMigrationStatus.test.ts`（10件以上）
- `src/messaging/sqliteMessages.ts:177,204` / `sqliteValidators.ts:123-124` の型とバリデータ

診断パネルの移行セクションごと削除するか、「移行機能は廃止済み」と表示するだけに縮退させるかは、着手時にUX判断が要る。**このPBIのスコープに含めるか別PBIに切るかを最初に決めること。**

### 作業順序（推奨）

1. ゲート条件の確認と記録
2. `fallbackMigration.ts:14` の import を `utils/domainUtils.js` に付け替え（先に単独でコミットできる）
3. `opfsWorker.ts` / `sqliteEngineHost.ts` から移行ルーチン呼び出しを削除
4. 対象5ファイルを削除（`wa-sqlite.d.ts` を忘れない）
5. 関連テストの削除（`migrationBackup` / `opfsMigrationV2` 系）
6. `package.json` から `wa-sqlite`（103行目 `"wa-sqlite": "~1.0.0"`）を削除し `npm install`
7. 診断パネル側の扱いを決めて実施（上記「判断が必要」）
8. 全検証

### 検証コマンド

```bash
npm run type-check
npm run lint
npm test
npm run build          # バンドルサイズの減少を記録する（~2.7MB 削減が期待値）
grep -rn "wa-sqlite" src/ package.json    # 残存確認（コメントのみになるはず）
```

`npm run build` の出力に `wa-sqlite-*.wasm` が消えていることを確認する（現在は `wa-sqlite-async.wasm` 1.48MB×2、`wa-sqlite.wasm` 558KB/727KB がバンドルされている）。

### 触ってはいけないもの

- `src/utils/domainUtils.ts` の `extractDomain` 本体 — 現役の汎用ユーティリティ
- `src/offscreen/migrations.ts` — ファイル冒頭に「This file is NOT part of the wa-sqlite legacy sunset investigated in PBI 03」と明記されている
- `backfillMetadata` — レガシー（非 SQLite）ストアの別機能。混同しないこと
- `src/background/offscreenTransport.ts:97` の permission justification 文言 — ユーザーに見える文字列。削除ではなく文言修正の要否を別途判断する
- `@subframe7536/sqlite-wasm` — 現行エンジン。wa-sqlite とは別物

---

## BDD受け入れシナリオ
```gherkin
Scenario: ゲート条件の確認が済んでいる
  Given 2026-12-17 以降である
  When  診断パネルの移行状態表示を確認する
  Then  未完了（legacy 残留）の報告がゼロであることを記録している

Scenario: extractDomain の参照付け替えが済んでいる
  Given migrationBackup.ts の削除前である
  When  fallbackMigration.ts の import 元を utils/domainUtils.js へ変更する
  Then  type-check が green のままである

Scenario: 旧経路の削除後も通常起動が成立する
  Given wa-sqlite 依存と移行系ファイルを削除した状態
  When  オフスクリーンの SQLite 初期化を実行する
  Then  OPFS / IDB / fallback のいずれかで通常初期化が完走し、全テストが green である
```

## 受け入れ基準
- [ ] ゲート条件（2026-12-17 到達＋診断パネルで未完了報告ゼロ）を確認し記録した
- [ ] `fallbackMigration.ts:14` の `extractDomain` import 元を `utils/domainUtils.js` に付け替えた
- [ ] 対象5ファイル（`migrationBackup.ts` / `opfsMigrationV2.ts` / `opfsMigrationV2Reader.ts` / `opfsWorker/migrationV2.ts` / **`wa-sqlite.d.ts`**）が削除されている
- [ ] `opfsWorker.ts` / `sqliteEngineHost.ts` から移行ルーチン呼び出しが削除され、初期化フローが壊れていない
- [ ] `package.json` から `wa-sqlite` 依存が削除され `package-lock.json` が更新されている
- [ ] 診断パネルの移行セクションの扱い（削除 or 縮退）を決定し実施した（別PBIに切る判断でも可・その場合は起票する）
- [ ] `grep -rn "wa-sqlite" src/ package.json` の残存がコメントのみである（notices/SBOM の表記は除く）
- [ ] `npm run type-check` / `npm run lint` / `npm test` / `npm run build` が green
- [ ] 起動経路（OPFS → IDB → fallback → none）の選択テストが green のまま
- [ ] バンドルから `wa-sqlite-*.wasm` が消えたことを build 出力で確認した

## テスト戦略
- 移行系テストの削除と、通常起動経路テストの維持（削除で壊れるテストは移行系のみであること）
- build 成功（wa-sqlite 削除でバンドルサイズが減ることを記録）

## 見積もり
2〜3 日（S）。診断パネル側の扱いを同一PBIに含める場合は +1 日。

## 実装者向け注記
- ゲート根拠: ADR-014（`dev-docs/ADR/2026-06-17-opfs-fts5-coexistence.md`）＋意思決定 PBI `dev-docs/archived/pbi/2026-07-16-07-decide-opfs-migration-v2-removal.md`（6 ヶ月経過＋診断パネル表示が前提）
- 調査: スパイク `dev-docs/dig-findings-2026-09-05-sqlite-backend-consolidation.md`
- 2026-09-14 再調査で判明した差分: `wa-sqlite.d.ts` が対象リストから漏れていた／STATUS 公開部は `sqliteMessageHandlers.ts` ではなく `sqliteStatus.ts`／`migrationBackup.ts` の `extractDomain` re-export に現役依存がある

## Definition of Done
- [ ] ゲート条件確認の記録（診断パネル確認日・結果）
- [ ] 全BDDシナリオがパスし、削除対象の消失を grep で確認
- [ ] コードレビュー完了
- [ ] ドキュメント更新（ADR-014 に実施記録を追記）
