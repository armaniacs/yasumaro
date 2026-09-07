# テストダブルの意図的乖離一覧

テストダブル（InMemoryTransport など）が製品バックエンドと意図的に異なる挙動をする箇所を、観点別の影響とあわせて記録するレジストリ。

「暗黙の乖離」を「明示された乖離」に変えることが目的。ここに載っている挙動は仕様であり、
統一する場合は意識的な設計変更として本ドキュメントと該当ガードテストを更新すること。

各エントリの形式:

- 対象ダブルと製品側の実体
- 乖離の内容と「統一しない方針」の理由
- 観点別影響表（テストを書くときにどの観点が乖離するか）
- 製品側挙動の検証先（その観点はどのテストで担保されているか）

---

## 1. InMemoryTransport — DELETE: ソフトデリート近似 vs 製品ハードデリート

- **ダブル**: `src/background/inMemoryTransport.ts` — `SQLITE_DELETE` は `is_deleted = 1` を立てるだけ（行は配列に残る）
- **製品側の実体**（すべてハードデリート）:
  - `src/offscreen/FallbackStorageAdapter.ts` — `delete(id)` → `hardDelete(id)`
  - `src/offscreen/storageFallback.ts` — `hardDelete(id)` → `records.filter(r => r.id !== id)`
  - `src/offscreen/opfsWorker/crudHandlers.ts` — `handleHardDelete`: `DELETE FROM browsing_logs WHERE id = ?`
  - メッセージ層 `src/offscreen/sqliteMessageHandlers.ts` — `handleDelete` → `sqliteHardDelete(id)`
- **統一しない方針の理由**: InMemoryTransport は SQL エンジンを積まない方針。製品挙動（物理削除）に寄せるとダブルが重くなる。ソフトデリート近似で軽さを保ち、乖離は本レジストリで固定する
- **ガードテスト**: `src/background/__tests__/inMemoryTransport.test.ts` の `DELETE divergence pinned as spec` describe（乖離を仕様として固定するアサート）

### 観点別影響表

| 観点 | InMemory | 製品 | 乖離 |
|---|---|---|---|
| 削除後の再取得（QUERY / COUNT） | 除外（`is_deleted` フィルタ） | 除外（行消失） | なし（表面一致。気付きにくいのが乖離の危うさ） |
| `getRecords()` アサーション | 削除済み行が `is_deleted=1` で残る | 該当行は存在しない | **乖離**（ガードテストで固定） |
| 削除済みレコードへの再 UPDATE | `find` 成功、`Object.assign` が通る | no-op | **乖離**（ガードテストで固定） |
| 削除→再 INSERT の重複検出 | 旧行が残り全行アサートで 2 件見える | 旧行消滅 | **乖離**（ガードテストで固定） |
| `SQLITE_CLEAR_ALL` | `records = []` で物理削除 | 全行物理削除 | DELETE と CLEAR_ALL の非対称は InMemory 側のみの内部差。表面（QUERY/COUNT）は一致 |

### 製品側挙動の検証先

- DELETE 経路（ハードデリート）: `opfsWorker.test.ts`、`testDir/e2e/dashboard-*` の削除系シナリオ
- VACUUM / freelist（`archiveDeleteByStaging` の `freelistBefore` / `freelistAfter`）: `opfsWorker.test.ts`、`testDir/e2e/dashboard-archive.spec.ts` — **InMemoryTransport では検証不能**（`SQLITE_ARCHIVE_DELETE_BY_STAGING` は未実装で `success: false` を返す）

### `is_deleted` カラムの正しい用途（DELETE とは無関係）

製品スキーマ（`src/offscreen/schema.ts`）の `is_deleted INTEGER DEFAULT 0` はローカル DELETE 経路では
**一切書き換わらない**。製品コードに `SET is_deleted = 1` は存在しない。このカラムが使われるのは:

1. **Gist 同期経由の論理削除受信** — 他デバイスで論理削除されたレコードが `is_deleted=1` の行としてそのまま受信・保存される
2. **アーカイブの includeDeleted フィルタ** — `archiveCreateHandlers.ts`（削除済み行の集計）、`archivePurgeHandlers.ts`（includeDeleted）、`archiveRestoreHandlers.ts`（`restoredDeleted`）

テストダブルの DELETE はこの用途と無関係な近似である。混同しないこと。

---

## 2. InMemoryTransport — アーカイブ系: 全面非対応

- **ダブル**: `SQLITE_ARCHIVE_*` すべて `success: false` を返す
- **統一しない方針の理由**: アーカイブ系は専用 engine 参照・single-flight・quota プレフライトなど重い機構のテストであり、InMemory で再現する価値がない。e2e と `opfsWorker.test.ts` が受け皿
- **検証先**: `testDir/e2e/dashboard-archive.spec.ts`、`opfsWorker.test.ts`（archiveCreate/Restore/Purge/Session handlers）

---

## 追加手順（将来の乖離）

1. ダブルの該当箇所に WHY コメントを追加（製品側の実体と統一しない理由）
2. 本ドキュメントにエントリを追加（観点別影響表 + 検証先）
3. 乖離を仕様として固定するガードテストを該当ダブルのテストに追加する
