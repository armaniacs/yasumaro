# PBI: wa-sqlite レガシー・サンセット実行（ADR-014 ゲート後）

優先度: スパイク推奨 Option A（S・低リスク） / RICE: ゲート条件付きのため参考値なし
backlog: [dev-docs/dig-findings-2026-09-05-sqlite-backend-consolidation.md](../dev-docs/dig-findings-2026-09-05-sqlite-backend-consolidation.md)（PBI-A 切り出し案）
依存: **ADR-014 サンセットゲート（2026-12-17）到達＋ゲート条件成立**（診断パネルで未完了報告ゼロ）を確認してから着手すること。ゲート前の着手は禁止（未移行ユーザーのデータ参照経路を消すため）。

## ユーザーストーリー
拡張機能の配布物を保守する開発者として、サンセットゲート後に旧 wa-sqlite 移行経路と依存を削除してほしい、なぜなら ~2.7MB の依存削減と移行系ファイルの消滅により保守面が単純化する一方、ゲート前に削除すると未移行ユーザーのデータ参照が永久に失われるから。

## 対象（スパイク PBI-A 切り出し案どおり）
- `src/offscreen/sqliteEngineContext/migrationBackup.ts`（旧 wa-sqlite IDB backup）
- `src/offscreen/opfsMigrationV2.ts` / `src/offscreen/opfsMigrationV2Reader.ts` / `src/offscreen/opfsWorker/migrationV2.ts`（旧 wa-sqlite OPFS 移行リーダ）
- `sqliteMessageHandlers.ts` の `OPFS_MIGRATION_V2_*` STATUS 公開部
- `package.json` の `wa-sqlite` 依存（削除後 `npm install` で lock 更新）
- 関連テスト（migrationBackup / opfsMigrationV2 系）

## BDD受け入れシナリオ
```gherkin
Scenario: ゲート条件の確認が済んでいる
  Given 2026-12-17 以降である
  When  診断パネルの移行状態表示を確認する
  Then  未完了（legacy 残留）の報告がゼロであることを記録している

Scenario: 旧経路の削除後も通常起動が成立する
  Given wa-sqlite 依存と移行系ファイルを削除した状態
  When  オフスクリーンの SQLite 初期化を実行する
  Then  OPFS / IDB / fallback のいずれかで通常初期化が完走し、全テストが green である
```

## 受け入れ基準
- [ ] 上記対象ファイル・依存・STATUS 公開部が削除されている
- [ ] `rg -n "wa-sqlite" src/ package.json` が 0 件（notices/SBOM の表記は除く）
- [ ] `npm run type-check` / `npm run lint` / `npm test` / `npm run build` が green
- [ ] 起動経路（OPFS → IDB → fallback → none）の選択テストが green のまま

## テスト戦略
- 移行系テストの削除と、通常起動経路テストの維持（削除で壊れるテストは移行系のみであること）
- build 成功（wa-sqlite 削除でバンドルサイズが減ることを記録）

## 見積もり
2〜3 日（S）

## 実装者向け注記
- ゲート根拠: ADR-014（`dev-docs/ADR/2026-06-17-opfs-fts5-coexistence.md`）＋意思決定 PBI `dev-docs/archived/pbi/2026-07-16-07-decide-opfs-migration-v2-removal.md`（6 ヶ月経過＋診断パネル表示が前提）
- 調査: スパイク `dev-docs/dig-findings-2026-09-05-sqlite-backend-consolidation.md`（現役参照は `migrationBackup.ts` の動的 import と `opfsMigrationV2Reader.ts` のみ）
- 注意: `backfillMetadata` はレガシー（非 SQLite）ストアの別機能であり本対象外。混同しないこと

## Definition of Done
- [ ] ゲート条件確認の記録（診断パネル確認日・結果）
- [ ] 全BDDシナリオがパスし、削除対象の消失を grep で確認
- [ ] コードレビュー完了
- [ ] ドキュメント更新（ADR-014 に実施記録を追記）
