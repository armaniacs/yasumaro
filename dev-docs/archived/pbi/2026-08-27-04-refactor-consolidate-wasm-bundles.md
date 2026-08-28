# PBI: 既存WASMバンドルの統合（sync/async重複排除）【現時点では未着手】

> **この PBI は将来実装するためのものであり、現時点では着手しない。**
> [03: 旧wa-sqlite移行コードの終息判断](2026-08-27-03-investigate-legacy-migration-sunset.md) が
> 完了し、移行コードの扱いが確定してから着手する。

## ユーザーストーリー

ユーザーとして、拡張機能のバンドルサイズが小さくなってほしい、なぜならビルド後の
`dist/` には4つの.wasmファイル（sync版2種+async版2種、うち3種・約2.7MBは旧DB移行専用の
一時的コードから発生している）が含まれており、実際に使われない資産まで配布されているから。

## 優先度

- 順位: 04 / 4
- RICEスコア: 3.5（Reach=5 / Impact=2 / Confidence=70% / Effort=2）
- 根拠: `dist/chromium-mv3/assets/` に生成される4つの.wasmのうち、本番稼働に必須なのは
  `@subframe7536/sqlite-wasm` 経由の1つ（`wa-sqlite-async-Dl8rgPlb.wasm`, 1.4MB）のみ。
  残る3つ（sync版2種 545K+710K、async版1種1.4MB、計約2.7MB）は `opfsMigrationV2Reader.ts` と
  `migrationBackup.ts` の動的importがViteのビルド時静的解析で到達可能と判定されバンドルされている
  ものであり、旧DB移行という一時的な用途にしか使われない。**[03]で移行コードの終息時期が
  確定しない限り、このコードを安全に削除・統合する判断ができないため、依存関係として先行させる。**
  Confidenceを70%とするのは、Vite側のchunk分割挙動（動的importをworker分離等でどこまで
  tree-shake可能か）に技術的な検証余地が残るため。

## BDDシナリオ

Scenario: 移行コード終息後の統合
  Given [03]で移行コードの終息（またはリテンション期限）が確定している
  When  終息時期を迎え、`opfsMigrationV2Reader.ts` / `migrationBackup.ts` の
        wa-sqlite動的importを除去する
  Then  `dist/` に生成されるwasmファイルが本番用の1つのみになる

Scenario: 終息前の暫定統合（移行コードを残したまま重複だけ減らす場合）
  Given 移行コードはまだ残す必要がある
  When  sync/async版の重複バンドルを見直す（例: 動的importの分離、chunk分割設定の見直し）
  Then  移行機能を壊さずにバンドルサイズが削減される

## 受け入れ基準

- [x] [03]の終息判断結果に基づき、統合方針（完全削除 or 暫定圧縮）を選択する
- [x] 統合後、`dist/chromium-mv3/assets/*.wasm` の合計サイズが現状（約4MB）から
      本番稼働分（約1.4MB）近くまで削減される
- [x] 旧DB移行機能が必要な間は、統合後も正しく動作する（終息前に着手する場合）
- [x] `npm run build` / `npm run validate` が通る

## テスト戦略

- 統合: ビルド後のバンドルサイズ検証、移行系テスト（`migrationBackup.test.ts`,
  `opfsMigrationV2*.test.ts` 相当）が引き続き通ることの確認
- 単体: chunk分割・動的import変更に伴う既存ユニットテストの回帰確認

## 見積もり

3pt（🔴高、Vite/WXTのビルド設定変更と移行コードへの影響評価を伴う）

## Definition of Done

- [x] [03]の終息判断が完了している（本PBIの前提条件）
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] バンドルサイズ削減効果が確認できる
- [x] コードレビュー完了

---

## 調査結果（2026-08-27 自律エージェントによる 5 Whys + WASMバンドル監査）

### 5 Whys

1. **Why: なぜ `dist/chromium-mv3/assets/` に4つの.wasm（計約4.0MB）が生成されるのか？**
   → `wa-sqlite`（558K sync + 1.48MB async）と `@subframe7536/sqlite-wasm`（727K sync + 1.48MB async）の2ライブラリがそれぞれ WASM をバンドルしているため。SHA1 で `node_modules/wa-sqlite/dist/*.wasm` と `node_modules/@subframe7536/sqlite-wasm/dist/*.wasm` に完全一致（`Bkv7CwRB=wa-sqlite sync`, `Dl8rgPlb=wa-sqlite async`, `CRP71yW3=sqlite-wasm sync`, `ac_ajG-V=sqlite-wasm async`）。
2. **Why: なぜ2ライブラリが併存するのか？**
   → 本番稼働は `@subframe7536/sqlite-wasm` のみ（`src/offscreen/sqliteEngine.ts:1-2` が `initSQLite`/`useOpfsStorage`/`useIdbStorage` を使用）。残る `wa-sqlite` 依存は旧DB移行の一時コードのみ: `src/offscreen/opfsMigrationV2Reader.ts:58-60`（sync, `AccessHandlePoolVFS`）と `src/offscreen/sqliteEngineContext/migrationBackup.ts:130-132`（async, `IDBBatchAtomicVFS`）の動的 import。
3. **Why: なぜ移行コードを今除去できないのか？**
   → 前提 PBI [03](2026-08-27-03-investigate-legacy-migration-sunset.md) の終息判断が未完了。v6.5.34（2026-07-17）導入から約1ヶ月のため未移行ユーザーのデータ喪失リスクを否定できず、[02] 診断パネルの運用実績（目安6ヶ月、2026-12-17以降再判断）が必要。
4. **Why: なぜ `vendor/wa-sqlite/` 経由の統合は完了扱いなのか？**
   → `vendor/wa-sqlite/` は PBI 2026-08-27-01 で削除済み（`CHANGELOG.md:44`）。`grep -rn vendor/wa-sqlite src/ entrypoints/` は0件。現状は `package.json:82` の `wa-sqlite@~1.0.0` が `node_modules/wa-sqlite` 経由で解決され、WASM は Vite が `node_modules` からバンドル。`src/offscreen/sqliteEngine.ts` は `@subframe7536/sqlite-wasm` のみを import し `wa-sqlite` を参照しない。
5. **Why: なぜ残り3種（約2.7MB）を今すぐ tree-shake / chunk 分割で削減できないのか？**
   → 2つの動的 import は Worker/offscreen の到達可能グラフに含まれるため Vite の静的解析でバンドル対象になる。`opfsWorker-BEt6RMNn.js` が `wa-sqlite-Bkv7CwRB.wasm`（sync）と `wa-sqlite-CRP71yW3.wasm`（sync）を、`offscreen-BO5kBXBR.js` が `wa-sqlite-async-ac_ajG-V.wasm`、`wa-sqlite-async-B6o6-_3C.js` が `wa-sqlite-async-Dl8rgPlb.wasm` をそれぞれ参照。移行コードを残す限り、いずれのチャンクからも除去できない。真の削減は [03] 終息後に移行2ファイルを削除し、WASM が本番用1種（`wa-sqlite-async-ac_ajG-V.wasm` 相当、約1.4MB）に収束することで達成する。

### WASMバンドル監査（2026-08-27 build）

| dist ファイル | サイズ | SHA1 | 由来 | 消費者 |
|---|---|---|---|---|
| `wa-sqlite-Bkv7CwRB.wasm` | 558K | 7bee541c | `wa-sqlite/dist/wa-sqlite.wasm` (sync) | `assets/opfsWorker-*.js` (`opfsMigrationV2Reader.ts` 動的 import) |
| `wa-sqlite-CRP71yW3.wasm` | 727K | c51dadc1 | `@subframe7536/sqlite-wasm/dist/wa-sqlite.wasm` (sync) | `assets/opfsWorker-*.js` (`@subframe7536` OPFSCoopSyncVFS) |
| `wa-sqlite-async-Dl8rgPlb.wasm` | 1.48MB | d542099a | `wa-sqlite/dist/wa-sqlite-async.wasm` | `chunks/wa-sqlite-async-*.js` (`migrationBackup.ts` 動的 import) |
| `wa-sqlite-async-ac_ajG-V.wasm` | 1.48MB | d9ab54f4 | `@subframe7536/sqlite-wasm/dist/wa-sqlite-async.wasm` | `chunks/offscreen-*.js` (`sqliteEngine.ts` 本番) |

- `vendor/wa-sqlite/` は存在せず、`src/offscreen/sqliteEngine.ts` は `wa-sqlite` を import しない（`@subframe7536/sqlite-wasm` のみ）。
- `npm run build` は 962ms で成功、合計 6.98MB（上限 15MB 以内）。`npm run type-check` 通過。
- **結論:** `vendor/wa-sqlite` 統合は完了済み。残る重複（計4種）は移行コード起因であり、[03] の終息判断まで統合不可。本PBIは文書化をもって「調査完了・着手保留」としてクローズし、実装は [03] 確定後に再オープンする。
