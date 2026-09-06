# アーカイブ機能 手動テストチェックリスト（優先度別）

> v6.7.114 / PBI 2026-09-06-01〜07、2026-09-07-01〜03 対応。
> 手動で維持する項目のみを優先度別に整理。R1〜R4・Y2〜Y6・G3〜G5・G8 および
> R5/R6/G6 のロジック検証は自動テストに移行した（下記「自動テスト カバレッジ対応表」）。
> **準備**: `npm run build` → `chrome://extensions` で Load unpacked（dist/chromium-mv3）→ 閲覧履歴がある状態でテスト開始。

---

## 🔴 必須（リリース前・データ信頼性）

R1〜R4 は完全自動化済み、R5/R6 のロジックは vitest + E2E 1本でカバー（対応表参照）。
実環境の前提確認のみ下記 🟢 に残す。

---

## 🟡 推奨（ストア公開前・UX品質）

| # | 検証項目 | 手順 | 期待結果 | なぜE2Eで不可 |
|---|---------|------|---------|--------------|
| Y1 | ロケール切替（ja↔en） | ブラウザ言語を切替→Archiveパネル再表示→全文言が切替わることを確認 | 表示中の言語に対応した文言が表示される | `chrome.i18n.getMessage` の言語は拡張起動時のブラウザ UI 言語で固定。Playwright の `locale` は `navigator.language` を変えるが `chrome.i18n` には効かない。拡張再ロードが必要で1コンテキスト内では不可 |
| Y5 | 再読み込み後のセッション再接続（file://） | ダウンロード済み .db を file:// で開いた復元セッションの検証 | セッションが復元され、検索・一覧が使える（保存は再DL制限） | 拡張ページ外の file:// では拡張 JS が走らない。※拡張ページ内 reload → STATUS 再接続は別途 E2E 化可能（Y5' として検討） |

---

## 🟢 任意（細部の確認）

| # | 検証項目 | 手順 | 期待結果 | なぜE2Eで不可 |
|---|---------|------|---------|--------------|
| G1 | トークン失効（60秒） | フェーズA確認ダイアログで60秒以上待つ→実行 | 拒否される→再発行して成功する | 60秒待ちがE2Eタイムアウトと衝突。`Date.now` モックはSW/worker内に届かない。トークンTTLのロジック自体は `confirmTokenManager` のユニットテストでカバー済み |
| G2 | モーダルの実キーボード操作 | Tab循環・Esc・起動要素へのフォーカス復帰を実キーボードで確認 | jsdom の focus/keydown 挙動と実ブラウザで一致する | Playwright の `keyboard.press` は合成イベントで実キーボード担保にならない。フォーカストラップのロジックは `focusTrapManager` のユニットと `archive-edit-modal` のテストでカバー済み |
| G6' | 孤児ステージング掃除の通し | オプションを強制終了（プロセスキル）→再起動→Archiveパネルを開く | `archive_incoming_*` / `archive_outgoing_*` が掃除されている | プロセスキルはE2Eで再現困難（掃除ロジック自体は `archiveStaging.test.ts` でカバー） |
| G7 | quota 不足の実環境拒否 | ディスク残量を意図的に減らしてフェーズBを実行 | 拒否＋日付分割案内が表示される | 実ディスクquota枯渇の再現。プレフライトのロジックは `archivePurgeHandlers.test.ts` の quota モックでカバー済み |
| R5' | VACUUM 領域解放の実環境確認 | `chrome://settings` のサイトデータ総量をフェーズB前後で目視比較 | OPFS 使用量が減少している | ブラウザUI表示はE2Eから取得不可（freelist 減少自体は自動テストでカバー） |

---

## 自動テスト カバレッジ対応表

### 🔴 必須（全項目自動化済み — 手動チェックリストから削除）

| # | 検証項目 | カバー方法 |
|---|---------|-----------|
| R1 | 退避 .db の内容照合（メタ/件数/FTS非存在） | E2E `testDir/e2e/archive-required-verification.spec.ts` R1（exportバイト列→better-sqlite3で照合）＋ `src/offscreen/__tests__/archiveSchemaNoFts.test.ts`（スキーマ定数にFTS/トリガーを含めない静的assert） |
| R2 | 境界日のタイムゾーン | 同 spec R2（固定epoch seed + 文字列cutoffDate の相対判定を Asia/Tokyo・Pacific/Kiritimati・America/Los_Angeles の3 TZで検証） |
| R3 | フェーズA後の本体不変 | 同 spec R3（`get_count` 差分 0。UI行数比較は行わない） |
| R4 | single-flight（2タブ競合） | vitest `src/offscreen/__tests__/archiveCreateHandlers.test.ts` — `blocks a second concurrent create (single-flight)`（worker層でin-flight中の2回目が `ARC_ALR_001` で拒否されることを検証） |
| R5 | VACUUM 領域解放 | vitest `archivePurgeHandlers.test.ts`（freelist before/after・`vacuumOk=false`）＋ E2E `dashboard-archive.spec.ts` R5（実OPFSエンジンで `freelistAfter < freelistBefore`・`vacuumOk:true`） |
| R6 | レジストリ消失時のfail-closed | vitest `archivePurgeHandlers.test.ts` — `fails closed when the staging is not registered` / `fails closed when the file meta disagrees with the registry` / `fails closed on incoming staging` / `rejects before the DELETE when quota is insufficient` / `blocks a second concurrent purge (single-flight)`（いずれも本体DB無傷をassert） |

### 🟡 推奨（自動化済み or 既存カバレッジ明文化）

| # | 検証項目 | カバー方法 |
|---|---------|-----------|
| Y2 | IDB フォールバック環境での拒否 | vitest `src/offscreen/__tests__/archiveFallbackRejection.test.ts`（`FallbackStorageAdapter` / `IdbVfsBackend` の全 archive メソッドが `Archive requires OPFS storage.` で拒否。UIの事前disabledガードは存在しない — 操作時拒否が仕様） |
| Y3 | 編集→保存→ファイルへの書き戻し | E2E `archive-recommended-verification.spec.ts` Y3（一時オープン→タイトル編集→保存→export→SQLite照合。downloadイベントに依存しない） |
| Y4 | 復元後のレコード内容照合 | 同 spec Y4（title/url/is_starred を値レベルで照合） |
| Y6 | 削除済みレコードを含めた復元 | 同 spec Y6（`restoredDeleted` 集計 assert） |

### 🟢 任意（自動化済み or 自動化できない理由を更新）

| # | 検証項目 | カバー方法 / 理由 |
|---|---------|------------------|
| G3 | 検索語のワイルドカードエスケープ | E2E `archive-recommended-verification.spec.ts` G3（`archive_query` の `%`/`_` リテラル扱い。`search` subtype は FTS5/trigram 経路で別物 — 対象外） |
| G4 | レガシーストア残存 | 同 spec G4（Phase B 後に `chrome.storage.local.savedUrlsWithTimestamps` を直接読んで assert。診断パネルUIの目視は任意） |
| G5 | 録画との並行動作 | 同 spec G5（実録画を発生させつつ archive_create → 両方成功。workerのキュー直列化） |
| G6 | 孤児ステージング掃除 | vitest `archiveStaging.test.ts` — `sweepOrphanStagings`（孤児削除・除外セット保護・incoming/outgoing混在）。実プロセスキル→再起動の通しのみ手動（E2Eでプロセスキルは再現困難） |
| G8 | VACUUM 失敗時の注記 | vitest `archivePurgeHandlers.test.ts` — `keeps the main DB intact when VACUUM fails (vacuumOk=false)`。E2E は R5 ケースで `vacuumOk` フィールドの存在を確認済み。実エンジンでのVACUUM失敗注入は `__setEngineForTesting` がoffscreen worker内でE2Eから呼べないため不可 |

### 不可理由の補足（削除せず残す項目の根拠）

- **Y1**: `chrome.i18n.getMessage` の言語は拡張起動時のブラウザ UI 言語で固定。Playwright の `locale` は効かない
- **Y5**: file:// では拡張 JS が実行されない
- **G1**: 60秒待ちはE2Eタイムアウトと衝突。TTLロジックは `confirmTokenManager` のユニットテストで担保
- **G2**: 実キーボードと合成イベントの差は E2E では担保不可。ロジックは `focusTrapManager` のユニットと `archive-edit-modal` のテストでカバー
- **G6'**: プロセスキル→再起動の通しは E2E で再現困難。掃除ロジックは `archiveStaging.test.ts` でカバー
- **G7**: `navigator.storage.estimate()` のモックは実 quota 不足の担保にならない。プレフライトは `archivePurgeHandlers.test.ts` の quota モックでカバー
- **R5'**: `chrome://settings` のUI表示は E2E から取得不可。freelist 減少は vitest + E2E R5 ケースでカバー

---

## 実施ログ（テスト実施後に記入）

| 日付 | 実施者 | 環境 | 結果 | 備考 |
|------|--------|------|------|------|
| | | | | |
