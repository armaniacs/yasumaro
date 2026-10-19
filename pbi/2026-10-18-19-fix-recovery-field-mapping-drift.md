# PBI: OPFS 復旧移行のフィールド対応漏れで fallback_reason が静かに NULL 化され、元データごと消える問題の修正

## ユーザーストーリー

OPFS が書き込みに失敗してフォールバックストレージに溜まった閲覧履歴を、SQLite が復旧したときに拡張機能の実行コンテキスト側へ取り込む利用者として、**復旧後も各行が「なぜフォールバックに落ちたのか」を保ったまま SQLite へ入ること**がほしい、なぜなら `fallback_reason`（`short_content` / `over_cleansed` / `content_overcut` / `candidate_too_small`）は自動保存が本文を採用しなかった理由を後から検証するための唯一の証拠であり、background の復旧移行がこれを落としたまま元の行を削除すると（`opfsRecovery.ts:159`）、**ユーザーは理由の記録を永久に失い**、「なぜこのページの要約が保存されていないのか」を製品側も利用者も説明できなくなるから。加えて、同じ fallback データを offscreen 側の移行が処理すると同じ値が保存されるという**経路依存の乖離**は、記録の追跡可能性とデータ移行の再現性を両方壊す。

## 優先度

- 順位: 19 / 25
- RICE: 600（Reach=100 / Impact=0.5 / Confidence=100% / Effort=0.1）
- 根拠: 監査19位。`convertFallbackRecord` は `InsertRecordFields` の全項目を列挙せず `fallback_reason` を落としているため、background の復旧移行がその列を NULL で永続化し、元の行は `opfsRecovery.ts:159` で削除される。兄弟の offscreen 側移行は生レコードを渡してフィールドを保つため、同じデータに対して 2 つの復旧経路が乖離した行を生む。対応表のドキュメントコメントは「全項目と同期」を主張しながら項目数が古い（`"all 31 fields"`）ため、このドリフトが放置された。
  - 到達範囲（cohort）: OPFS 書き込みが失敗し `FALLBACK_STORAGE_DATA` に `fallback_reason` を持つ行が蓄積し、その後 SQLite（OPFS/IDB）が利用可能へ戻って deferred migration が走るプロファイル。`deferredMigrations.ts:62-65` の復旧ゲートを通過する必要があるが、その条件自体は通常の復旧手順である。
- 種別: 🔧非機能追加（fix）
- 難易度: 🟢低
- 副作用: 🟡軽微（保存される値が NULL から実値に変わる。旧 DB の行に値が無い場合は同じ）

## 背景（監査の出典）

security-audit run-2 の needs_validation リード。fingerprint: `opfsRecovery.convertFallbackRecord:fallback-reason-field-drift`。監査成果物: /Users/yaar/security-audit-skill/obsidian-smart-history/run-2/（`findings.json` の該当レコード / `NEEDS-VALIDATION.md:465`〜「## 16. Background recovery migration silently NULLs fallback_reason for every migrated row」）。

判定は `needs_validation`。source-only 実行のため、NULL が永続化される決定的な局所挙動は稼働プロファイルで観測されていない。**外部事実は一切不要**で、後述の mock vitest 1 回で確定する。

### 再現経路（trace・行番号は実ファイルで確認済み）

1. `src/background/deferredMigrations.ts:62-71` ― `needsOpfsRecoveryMigration()` が真なら `:65` で `migrateOpfsRecovery()` を呼ぶ。
2. `src/background/migration/opfsRecovery.ts:134` ― `records.slice(i, i + BATCH_SIZE).map(convertFallbackRecord)` でバッチ変換。
3. `src/background/migration/opfsRecovery.ts:28-67` ― `convertFallbackRecord` が 34 項目を列挙し `fallback_reason` を落とす（**:61 `fallback_triggered` の次が :64 `nav_source_url`** ― この間が抜けている）。
4. `src/offscreen/schema.ts:302` ― `buildInsertParams` は `record.fallback_reason ?? null` を適用し、欠落した値は NULL として永続化される。
5. `src/background/migration/opfsRecovery.ts:159` ― `chrome.storage.local.remove(FALLBACK_STORAGE_KEY)` が元の行を削除し、落ちた値は復元不能になる。

### 兄弟経路との非対称（乖離の実体）

- `src/offscreen/sqliteEngineContext/fallbackMigration.ts:45` ― 兄弟経路は `buildInsertParams(record, domain)` へ **生レコードをそのまま渡す**ため、`fallback_reason` は保持される。
- `src/offscreen/storageFallback.ts:118`（および `:162`）― 蓄えられた fallback 行は `{ id, ...buildInsertRecordFields(record, domain) }` で生成されるため、**保存済みの行は `fallback_reason` を実際に保持している**（`:393`）。落ちているのは移行側の写しだけ。

### 既存テスト（現状のカバー状況）

- `src/background/migration/__tests__/` に `legacyMigration.test.ts` / `legacyResync.test.ts` / `migrationState-coverage.test.ts` はあるが、**`opfsRecovery` / `OpfsRecoveryService` / `convertFallbackRecord` を参照するテストはリポジトリ全体で 1 件も存在しない**（`find . -name "*.test.ts" | xargs grep -l` で 0 件）。このドリフトを検出できるテストが存在しないことが放置の直接原因。
- `src/offscreen/sqliteEngineContext/__tests__/fallbackMigration.test.ts` ― 兄弟経路のテスト。`vi.mock` で FallbackStorage と `execWithCache` を差し替え、`globalThis.chrome` を自前で組み立てるパターンが存在し、今回の単体テストはこれに倣える。
- `src/offscreen/__tests__/schema-insertParams.test.ts` ― `buildInsertParams` の列挙 pin がある。

### なぜコンパイラが黙るのか（実装上の要点）

`src/utils/sqlite-types.ts:46`（および `:137`）で `fallback_reason?: string | null;` は **省略可能**である。したがってこのフィールドをオブジェクトリテラルから取り除いても、TypeScript は余分なプロパティや欠落プロパティのエラーを出さない。これがドキュメントコメントの古い件数が気づかれなかった構造的な原因であり、テストを 1 本足すだけでは**同種の将来ドリフトが再発する**ため、コンパイル時点のガードを併せて入れること。

## BDD受け入れシナリオ

```gherkin
Scenario: 1. fallback_reason を持つ fallback 行が background 復旧移行後も値を保つ
  Given OPFS 復旧ゲート（OPFS_FALLBACK_MODE=true かつ SQLite が利用可能）が通り、
  And   FALLBACK_STORAGE_DATA に fallback_reason='short_content' の行が 1 件以上蓄積している
  When  OpfsRecoveryService.migrate() が実行される
  Then  sqliteClient.insertBatch に渡される全レコードの fallback_reason は NULL ではなく 'short_content' である
  And   他の全フィールド（特に fallback_triggered / nav_source_url / search_query）が従来と同じ既定値で埋められる
  And   移行完了後に FALLBACK_STORAGE_DATA は削除される（既存の削除順序は変更しない）

Scenario: 2. 兄弟の offscreen 側移行と同じ行から同じ値が保存される（経路間の乖離が解消される）
  Given 同一内容の fallback 行（fallback_reason='over_cleansed'）が storage にある
  When  background の OpfsRecoveryService.migrate() と offscreen の tryMigrateFallbackToSqlite() の両方で移行する
  Then  両経路が永続化する fallback_reason が一致する（'over_cleansed'）
  And   fallback_reason 以外のフィールドも両経路で同値になる

Scenario: 3. 旧行に fallback_reason が無い場合は NULL のまま（後方互換）
  Given 光学オプトイン導入前に書き込まれた fallback_reason を持たない行がある
  When  background 復旧移行を実行する
  Then  その行の fallback_reason は NULL として保存され、他のフィールドは従来と変わらない
  And   移行は失敗しない（undefined を 'null' 文字列や空文字に変換しない）

Scenario: 4. COLUMN_NAMES に列が追加されたらコンパイルエラーまたはテスト失敗になる（将来ドリフトの検知）
  Given schema.ts の COLUMN_NAMES / InsertRecordFields に新しい列 c を追加する
  When  型チェックまたはテストを実行する
  Then  convertFallbackRecord が c を列挙していない場合はコンパイルエラー、または網羅性テストの失敗として検出される
  And   「コメントを直すだけ」でドリフトが再発しない
```

## 受け入れ基準

- [ ] `convertFallbackRecord`（`opfsRecovery.ts:28-67`）が `fallback_reason` を含め、`InsertRecordFields` の **35 項目すべて**を列挙している（`fallback_triggered` の直後 = `COLUMN_NAMES` の並び順 `fallback_triggered` → `fallback_reason` → `nav_source_url` に合わせる）
- [ ] 決定コメント（`opfsRecovery.ts:21-27`）の `"Must stay in sync with all 31 fields"` が実数（35）に直され、さらに件数を**二重管理しない**仕組み（COLUMN_NAMES 起点の生成、または網羅性アサーションのいずれか）に差し替えられている
- [ ] `fallback_reason` を持たない旧行で `fallback_reason` が `null` になること（`undefined` → `'null'` や空文字への変換をしない）が pin されている
- [ ] 新規単体テスト `src/background/migration/__tests__/opfsRecovery.test.ts` が `chrome.storage.local` の mock と `sqliteClient` の mock（`insertBatch` payload の捕捉）で、移行後のレコードの `fallback_reason` が NULL でないことを検証している
- [ ] 網羅性テストが `convertFallbackRecord` の出力キーを `COLUMN_NAMES` と集合比較し、差分があれば失敗する（将来ドリフトを 1 つ残らず検知）
- [ ] `SCHEMA_SQL` の `browsing_logs` 定義、`rowCodec.ts`、`storageFallback.ts` に**別の同種ドリフトが latent として残っていない**ことを確認済みである（結果を残し、残っていれば別 PBI とする）
- [ ] `npm run validate`（type-check + lint + 全テスト）が緑

## テスト戦略

- 単体: `src/background/migration/__tests__/opfsRecovery.test.ts` を新規追加。`vi.mock('../../sqlite/offscreenGateway.js')` で `SqliteClient` を差し替え、`globalThis.chrome = { storage: { local: { get, remove } } }` を自前で組み立てる（既存 `fallbackMigration.test.ts` のパターンを踏襲）。`FALLBACK_STORAGE_DATA` に `fallback_reason: 'short_content'` を持つ行を seed し、`mutate({ type: 'insertBatch', records })` の payload を捕まえて、渡された全レコードで `fallback_reason` が `'short_content'` のままであることを pin する。あわせて `fallback_reason` を持たない行で `null` になることも pin する。
- 統合: `src/offscreen/sqliteEngineContext/__tests__/fallbackMigration.test.ts` に、兄弟経路が `fallback_reason` を保つことの対照 pin（既に `buildInsertParams` を直接呼ぶ形なので実害はないが、Scenario 2 の両経路一致を担保する）。加えて `schema-insertParams.test.ts` 側で `buildInsertParams(record).fallback_reason` の値が `record.fallback_reason` に一致することを再確認。
- 網羅性: 「COLUMN_NAMES に列を追加したら失敗する」ことは、`COLUMN_NAMES` を 1 要素だけ増やした配列に対する網羅性アサーション（あるいは型レベルの網羅性マッピング）を 1 本のテストとして pin する。これにより将来ドリフトが CI で確実に落ちる。
- E2E: 不要（決定的な局所挙動。ブラウザをまたぐ外部事実はない）

## 実装メモ（実装者向け）

### 対象ファイルと該当行（実ファイルで確認済み）

| ファイル | 行 | 内容 |
|---|---|---|
| `src/background/migration/opfsRecovery.ts` | 21-27 | 決定コメント。`:26` が `"Must stay in sync with all 31 fields of InsertRecordFields/schema.ts."`（stale） |
| `src/background/migration/opfsRecovery.ts` | 28-67 | `convertFallbackRecord`。`:61 fallback_triggered` → `:64 nav_source_url` の間に `fallback_reason` が欠落 |
| `src/background/migration/opfsRecovery.ts` | 134 | `map(convertFallbackRecord)`（batch conversion） |
| `src/background/migration/opfsRecovery.ts` | 159 | `chrome.storage.local.remove(FALLBACK_STORAGE_KEY)`（元行削除＝不可逆の sink） |
| `src/offscreen/schema.ts` | 72-108 | `COLUMN_NAMES`（SSOT、35 項目） |
| `src/offscreen/schema.ts` | 270-305 | `buildInsertParams`（位置引数 35 項目）。`:302` が `record.fallback_reason ?? null` |
| `src/offscreen/schema.ts` | 313-349 | `InsertRecordFields`（35 項目） |
| `src/offscreen/schema.ts` | 356-397 | `buildInsertRecordFields`（35 項目）。`:393` が `record.fallback_reason ?? null` |
| `src/offscreen/sqliteEngineContext/fallbackMigration.ts` | 45 | 兄弟経路。生レコードを `buildInsertParams` へ渡す |
| `src/offscreen/storageFallback.ts` | 118 / 162 | 蓄えられた行が `buildInsertRecordFields` 経由で `fallback_reason` を持つ |
| `src/background/deferredMigrations.ts` | 62-71 | 復旧ゲートの入口。`:65` で `migrateOpfsRecovery()` |
| `src/utils/sqlite-types.ts` | 46 / 137 | `fallback_reason?: string \| null;`（省略可能 → 欠落がコンパイルエラーにならない原因） |

### 実際に数えた項目数とドキュメントコメントの主張の乖離（重要）

自力で数え直した結果（正規表現でオブジェクトリテラルのキーを抽出して機械的に確認）:

- `InsertRecordFields`（`schema.ts:313-349`）: **35 項目**
- `COLUMN_NAMES`（`schema.ts:72-108`）: **35 項目**
- `buildInsertParams` の位置引数（`schema.ts:270-305`）: **35 項目**
- `buildInsertRecordFields`（`schema.ts:356-397`）: **35 項目**
- `convertFallbackRecord`（`opfsRecovery.ts:29-66`）: **34 項目**

**乖離は二重に発生している。** ドキュメントコメント（`:26`）は「31 項目」と主張しているが、実際の列挙は 34、正準は 35。つまり:

```
ドキュメントコメントの主張 : 31   ← 4 つ少なく古い
実際の列挙                 : 34   ← fallback_reason が 1 つ欠落
正準                       : 35
```

したがって **35 対 34**（監査記録どおり）であり、加えてドキュメントコメントの 31 という数字も既に陳腐化している。1 項目追加ではなく「ドキュメントコメントの数字が古く、かつ列挙自体に穴がある」という二重のドリフトとして扱うこと。

### 最小変更の選択肢

1. **`convertFallbackRecord` に `fallback_reason` を追加し、ドキュメントコメントの項目数を正しく直す（最小・推奨の第一候補）**
   - `:61` の `fallback_triggered` の直後に `fallback_reason: record.fallback_reason ?? null,` を 1 行挿入し、`:26` の "all 31 fields" を "all 35 fields"（または数値を書かない形）に直す。
   - 影響範囲は 1 ファイル 2 行。ただし**同じ穴が将来再発する**ため、単独では受け入れ基準の網羅性ガードを満たさない。

2. **列の列挙を `schema.ts` の `COLUMN_NAMES` から生成する（将来ドリフトをコンパイルエラーにする）**
   - `COLUMN_NAMES` を唯一の列挙元にして `convertFallbackRecord` を組み直す。責務の混在を避けるため、既定値の対応表（`0` を入れるフィールド = `is_starred` / `is_deleted` / `obsidian_synced` / `gist_synced` / `fallback_triggered`、それ以外は `null`）を `schema.ts` に単一の正準として切り出して共有するのが素直。
   - 注意点: `COLUMN_NAMES` は `readonly` 配列であり、既定値は列ごとに異なるため、単純な変換だけでは `is_starred ?? 0` と `title ?? null` を区別できない。**既定値マップを別定義として持つ**必要がある。
   - また `url` / `created_at` は非 null 必須（`InsertableRecord`）で、単に `?? null` を適用すると型を壊す。

3. **兄弟経路と同様に、生レコードをそのまま渡す形（`buildInsertParams` が既定値で埋める）に統一**
   - `convertFallbackRecord` を削除し、`:134` で `records.slice(...)` をそのまま `insertBatch` に渡す。
   - 一見すると最も単純だが、background 側から `src/offscreen/schema.ts` の既定値ロジックに依存することになり、`buildInsertParams` は `domain` を別の引数で要求する（`schema.ts:260` 付近）ため、`domain` の解決責務を background 側へ持ち込む必要がある。`fallbackMigration.ts:44` は `record.domain || extractDomain(record.url)` で賄っている。**両移行経路の完全統一は責務の移動を伴うため、本 PBI のスコープ外**。将来 PBI の候補とする。

**推奨**: 選択肢 1 を実装したうえで、受け入れ基準の網羅性ガード（選択肢 2 の意図だけを型の形で取る）を**必ず**併入する。「1 行の追加」だけでは検証手順自体の陳腐化が残り、次回以降の列追加で同じ不具合が再発する。

### 網羅性ガードの実装案（コンパイルエラーにする）

`BrowsingLogRecord.fallback_reason` は省略可能（`sqlite-types.ts:46`）なので、オブジェクトリテラルの欠落は型エラーにならない。網羅性は**キー集合を別途 pin する**必要がある:

```ts
// schema.ts に追加する候補
export type ColumnName = (typeof COLUMN_NAMES)[number];

/** InsertRecordFields とキー集合が一致することをコンパイル時に強制する。 */
export function assertColumnCoverage(fields: Record<ColumnName, unknown>): void {
  // 実装で COLUMN_NAMES と fields のキー差分を開発時に throw する
}
```

- 型レベルの確実性が要るなら、`Record<ColumnName, true>` 型の定数オブジェクトを `convertFallbackRecord` の隣に置き、キー追加時に「その定数にも追加しないと型エラーになる」形にする。
- 実行時でよいなら、`Object.keys(convertFallbackRecord(sample)).sort()` と `[...COLUMN_NAMES].sort()` の集合比較を 1 本のテストとして pin する（Scenario 4 の実装）。
- **両方やらない**こと。コメントだけの更新で終わらせないことが本 PBI の実質的な価値。

### ブロッカー（needs_validation: 決定的な局所挙動で、外部事実は不要。mock vitest 1 回で確定）

監査 `blockers[0]` は「source-only 実行のため bounded な観測結果が確立できておらず、`fallback_reason` 設定済みの fallback 行を seed して `insertBatch` payload を捕捉する mocked-chrome.storage.local の vitest 1 回が決定的欠落事実である」というもの。**着手前に潰すべき検証**として、以下を最初に行うこと:

1. `OpfsRecoveryService` を mock した `SqliteClient` と組み合わせて組み立て、`FALLBACK_STORAGE_DATA` に `fallback_reason: 'short_content'` を持つ行を投入する。
2. `migrate()` を実行し、`insertBatch` に渡る payload の `records[0].fallback_reason` が **`undefined` / `null`** であることを観測する（＝バグの実挙動）。
3. `fallbackMigration.ts` 側を同じ行で走らせ、同じフィールドが `'short_content'` のまま保たれることを対照観測する。

この 3 ステップで Red が確定すれば、修正内容は明白であり、外部・展開先の事実は一切必要ない。**この Red の観測結果は、実装着手前に記録しておくこと。**

### ロールバック手順

- 本変更は保存値の**補正**であり、スキーマ変更・保存キー変更・移行順序変更を含まない。したがってロールバックは通常の `git revert` で安全。
- 既に本 PBI の実装で移行済みのユーザーの行には `fallback_reason` が実値で入っている。revert しても既存 DB の値は残る（消えない）。
- ロールバック後もう一度 `migrate()` を走らせても、削除済みの `FALLBACK_STORAGE_DATA` からは復元できないため影響はない。
- 「NULL で永続化する」旧挙動へ意図的に戻す必要はなく、戻す理由もない。

## 見積もり

1 SP（🟢低）。1 ファイル 2 行の最小修正（選択肢 1）＋ 網羅性ガード 1 本（型 1 本かテスト 1 本）＋ 新規単体テストファイル 1 本。難点は実装量ではなく「重複列挙のドリフトを 1 手で終えるか」にあり、これは受け入れ基準で担保する。Effort 0.1 人日の前提と整合する。

## Definition of Done

- [ ] BDDシナリオ（4 件）が自動テストで実装されパス
- [ ] `npm run validate` が緑
- [ ] 監査 fingerprint `opfsRecovery.convertFallbackRecord:fallback-reason-field-drift` を完了記録に残す
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み（`opfsRecovery.ts` の対応表ドキュメントコメントを実数 35 に合わせる。加えて `dev-docs/` 内の移行経路の記述に「2 経路の乖離」についての記載がないことを確認し、必要なら追記する）

## 調査結果（2026-10-18）

- 判定: **CONFIRMED**（局所再現）
- 決め手: `fallback_reason='short_content'` を持つ fallback 行を seed して `OpfsRecoveryService.migrate()` を実行すると、`migrateResult {success:true, migrated:1}` で **insertBatch payload の `fallback_reason` が `undefined`（NULL 化）**。`fallback_triggered:1`・`title`・`url` は保持され、移行後に `FALLBACK_STORAGE_DATA` が削除される（復元不能）
- 影響: ドリフトが実測で確定。網羅性ガード（型で欠落を防ぐ）の併入を推奨

## 関連

- pbi/00-INDEX.md
- 同じ移行領域の PBI 09（`2026-10-18-09-fix-fallback-migration-partial-wipe.md`・fallback partial wipe）、10（legacy count）、17（rec snapshot）と方針の整合を確認
- `src/offscreen/sqliteEngineContext/fallbackMigration.ts:45`（兄弟経路）
- `src/offscreen/schema.ts:72-108` / `:270-305` / `:313-349` / `:356-397`（列定義の正準）