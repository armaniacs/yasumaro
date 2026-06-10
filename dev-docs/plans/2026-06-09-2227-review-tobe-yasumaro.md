# Checking Team 総合レビューレポート

**実行日時**: 2026-06-09 22:27
**レビュー対象ブランチ**: `tobe-yasumaro`
**比較ブランチ**: `main`
**変更規模**: 51ファイル、+5585/-70行

---

## 総合評価: 78/100 (ランク: B)

| ランク | スコア範囲 | 評価 |
|:-----:|:---------:|:----|
| **B** | **70-79** | 一部に修正必須の課題があるが、全体的な品質は許容範囲 |

### エージェント別スコア

| Wave | エージェント | スコア | 指摘 |
|:----:|-----------|:-----:|:----:|
| 1 | Red Team Leader | 75 | High 1, Medium 1 |
| 1 | Blue Team Leader | 95 | Medium 1, Low 2 |
| 1 | System Architect | 85 | Medium 3, Low 1 |
| 1 | Maintainability Guardian | 70 | High 1, Medium 2 |
| 1 | Legacy Bridge Architect | 95 | Medium 1, Low 1 |
| 2 | UI Expert | 90 | Medium 2, Low 1 |
| 2 | Tuning Expert | 75 | Medium 2, Low 1 |
| 2 | SRE/Ops Specialist | 70 | High 1, Medium 2 |
| 2 | Domain Logic Expert | 55 | High 2, Medium 1 |
| 2 | Compliance & Privacy Guard | 55 | High 2, Medium 1 |
| 2 | i18n Expert | 70 | High 1, Medium 2 |
| 2 | Accessibility Advocate | 55 | High 2, Medium 1 |
| 2 | Documentation Architect | 95 | Medium 1, Low 2 |
| 2 | Data Integrity Expert | 70 | High 1, Medium 2 |
| 2 | FinOps Consultant | 90 | Medium 2, Low 1 |
| 2 | Edge & Mobile Strategist | 65 | High 2, Medium 1 |
| 2 | Refactoring Evangelist | 85 | Medium 2, Low 1 |
| 2 | Ethics & Bias Auditor | 90 | Medium 2, Low 1 |
| 2 | Supply Chain Sentinel | 85 | Medium 2, Low 1 |
| 2 | API & Contract Negotiator | 83 | Medium 2, Low 1 |
| 2 | DX Advocate | 90 | Medium 2, Low 1 |
| 3 | Test Experts | 78 | 🔧 2件修正 + 指摘4件 |

---

## 修正済み項目（Wave 3 Test Experts が対応）

### [High] DASHBOARD_SQLITE 送信元検証の欠如 (Red Team Leader)
- **修正**: `src/background/service-worker.ts` の `DASHBOARD_SQLITE` ハンドラに `sender.tab` チェックを追加。コンテンツスクリプトからのSQLite操作をブロック
- **テスト**: 回帰テスト2件追加（content script → Forbidden / SW → 許可）

### [High] スキーマ初期化時の必須カラム不足 (Data Integrity Expert)
- **修正**: `src/offscreen/sqlite.ts` の `SCHEMA_SQL` から `idx_logs_obsidian` インデックス定義を削除し、`ALTER TABLE ADD COLUMN obsidian_synced` の後に移動
- **テスト**: スキーマ不整合を永続的に防止するテスト追加

---

## 重要指摘事項（未修正・優先度順）

### [High] MigrationService: エラー発生時の進捗計上ミスによるデータ喪失リスク
- **指摘者**: Domain Logic Expert, System Architect (Medium), Test Experts
- **場所**: `src/background/migrationService.ts:106-107`
- **影響**: バッチ内で一部のinsertが失敗しても進捗カウンタがバッチサイズ分だけ進む。再起動時のリトライでは失敗したエントリがスキップされ、データが**永久的に消失**する。
- **対処**: 各エントリの成功/失敗を個別追跡し、失敗エントリのみ再試行する。またはバッチをトランザクションでatomicにする。

### [High] 「全データ削除」がSQLiteデータベースを消去しない（GDPR Art.17非対応）
- **指摘者**: Compliance & Privacy Guard
- **場所**: `src/dashboard/dashboard.ts:590-600`
- **影響**: "Delete All Data" ボタンは `chrome.storage.local.clear()` のみ実行し、OPFS上のSQLiteデータベースの履歴を削除しない。GDPR第17条（忘れられる権利）に違反する可能性がある。
- **対処**: `DELETE FROM browsing_logs` または `DROP TABLE browsing_logs` をoffscreenに指示するメッセージを追加する。

### [High] オフスクリーン文書ライフサイクル未対処 — モバイルで頻繁に切断
- **指摘者**: Edge & Mobile Strategist
- **場所**: `src/background/sqliteClient.ts:89-116`, `src/offscreen/sqlite.ts:134-136`
- **影響**: Chrome Androidがメモリ逼迫時にオフスクリーン文書を切断。WALモードで未フラッシュトランザクションが失われる。
- **対処**: アイドル監視による生存確認、モバイルではWAL無効化、切断時の完全再初期化パスの実装。

### [High] 全行一括シリアライズでモバイルメモリプレッシャー
- **指摘者**: Edge & Mobile Strategist
- **場所**: `src/offscreen/sqlite.ts:586-628`
- **影響**: `serialize()` が全行を `JSON.stringify` で一括処理し、モバイル端末でOOMクラッシュの原因になる。
- **対処**: ストリーミング/チャンク単位のシリアライズ、または `sqlite3_serialize` APIの使用。

### [High] オフスクリーンドキュメントの構造化ログ未統合
- **指摘者**: SRE/Ops Specialist
- **場所**: `src/offscreen/sqlite.ts`, `src/offscreen/offscreen.ts`（全console.* 使用箇所）
- **影響**: SQLite CRUD/AI要約のエラーが `console.*` にのみ出力され、拡張機能の構造化ログシステム (`addLog`) に送られない。SWサスペンド時にログが消失。
- **対処**: Offscreenドキュメントからも `addLog` / `logError` を使用するか、メッセージ応答時にSW側でログ記録。

### [High] 新規パネルのi18n定義欠落 — 15+キーが未定義
- **指摘者**: i18n Expert
- **場所**: `public/_locales/{en,ja}/messages.json`, `entrypoints/options/index.html:1290-1328`
- **影響**: Recording Triggers、Export Logs、SQLite Historyの全キーがmessages.jsonに未定義 → UI要素が空欄になる。
- **対処**: 不足キーを日英両方のmessages.jsonに追加。Export Logsボタンに `data-i18n` 属性を付与。

### [High] ポップアップのステータス詳細パネルが常にスクリーンリーダーから隠蔽
- **指摘者**: Accessibility Advocate
- **場所**: `entrypoints/popup/index.html:71`
- **影響**: `aria-hidden="true"` が静的に設定され、パネル展開後もスクリーンリーダーが情報を読み取れない。
- **対処**: `aria-hidden` を `hidden` クラスのトグルと同期させる、または削除してCSS `display: none` のみで制御。

### [High] SQLite履歴カレンダーの日付セルがキーボード操作不可
- **指摘者**: Accessibility Advocate
- **場所**: `src/dashboard/sqliteHistoryPanel.ts:337-346`
- **影響**: カレンダー日付が `<span>` でレンダリングされ、キーボードユーザーが選択不可（WCAG 2.1.1違反）。
- **対処**: `<button>` に変更するか、`tabindex="0"` + `role="button"` + キーボードハンドラを追加。

### [High] 型定義が3層に重複（BrowsingLogRecord, QueryOptions, SearchResult）
- **指摘者**: Maintainability Guardian, Refactoring Evangelist, DX Advocate, Test Experts
- **場所**: `src/offscreen/sqlite.ts:80` / `src/background/sqliteClient.ts:18` / `src/dashboard/dashboardSqliteService.ts:45`
- **影響**: スキーマ変更時に3ファイルすべての修正が必要。変更漏れによる実行時エラーを誘発。
- **対処**: `src/utils/sqlite-types.ts` に共有型定義を集約。

### [High] Dashboardからのトリガー設定保存がキャッシュとスナップショットに反映されない
- **指摘者**: Domain Logic Expert
- **場所**: `src/dashboard/recordingTriggerSettings.ts:140-155` → `service-worker.ts:668-688`
- **影響**: Dashboardでトリガー設定変更後、SWの `cachedTriggers` が無効化されず、SW再起動まで古い設定が使われる。
- **対処**: 保存時に `RecordingTriggerManager.invalidateCache()` を呼び出すメッセージを追加。`setupSnapshotAlarm()` を再実行。

### [High] SQLite browsing_logsにデータ保持期間ポリシーが未定義
- **指摘者**: Compliance & Privacy Guard
- **場所**: `src/offscreen/sqlite.ts:28-72`
- **影響**: データを無制限に蓄積。GDPR Art.5(1)(e)（保存制限の原則）に抵触する可能性。
- **対処**: 保持期間設定（デフォルト90日）と自動パージジョブを追加。

---

### [Medium] 重要指摘一覧

| # | 指摘 | 指摘者 | 場所 |
|:-:|------|--------|------|
| 1 | Obsidian同期失敗時にURLがPIIを含む形でログ記録 | Blue Team | `obsidianSyncService.ts:53-56` |
| 2 | スキーママイグレーションがバージョン管理されていない | System Architect, SRE/Ops | `sqlite.ts:175-179` |
| 3 | DASHBOARD_SQLITEが型安全でない文字列ディスパッチ | System Architect, API Contract | `messageTypes.ts:110-113` |
| 4 | offscreen.tsがSRP違反（SQLite+Prompt APIの2責務） | Maintainability Guardian | `offscreen/offscreen.ts` |
| 5 | バッチINSERT不在—移行処理がO(n) IPCラウンドトリップ | Tuning Expert | `migrationService.ts:68-103` |
| 6 | クエリ結果のキャッシュ不在—全操作が2-hop IPC | Tuning Expert | `sqliteHistoryPanel.ts:59-106` |
| 7 | SqliteClientのエラー全面飲み込み—リトライ機構欠如 | SRE/Ops | `sqliteClient.ts:167-178` |
| 8 | Obsidian同期がプライバシー同意状態を確認せず送信 | Compliance & Privacy | `obsidianSyncService.ts:39-58` |
| 9 | 旧製品名"Obsidian Weave"が4つのmessage値に残存 | i18n Expert, Ethics | `_locales/*/messages.json:567,897,1125,1404` |
| 10 | applyI18nに空文字戻り値のガードがない | i18n Expert | `popup/i18n.ts:104-114` |
| 11 | 録画トリガーのチェックボックスに説明文未関連付け | Accessibility Advocate | `recordingTriggerSettings.ts:54-61` |
| 12 | 移行再開時に重複エントリが発生する | Data Integrity Expert | `migrationService.ts:56-107` |
| 13 | AI API呼び出しのレート制限が欠如 | FinOps | `service-worker.ts:319-347` |
| 14 | 累積コストトラッキングと予算アラートがない | FinOps | `saveMetadataStep.ts:108` |
| 15 | ダッシュボード二重ホップメッセージングのレイテンシ | Edge & Mobile | `dashboardSqliteService.ts:22-39` |
| 16 | wa-sqlite内部サブパスの直接import | Supply Chain Sentinel | `sqlite.ts:7-9`, `package.json:64` |
| 17 | wa-sqlite npmライセンス情報未設定 | Supply Chain Sentinel | `package-lock.json:7512-7516` |
| 18 | Offscreenメッセージプロトコルが無バージョン | API & Contract | `sqliteClient.ts:121-148` |
| 19 | SQLiteコアロジックに実動作のテストがない | DX Advocate | `offscreen-sqlite.test.ts`, `sqliteClient.test.ts` |
| 20 | デフォルト全ブラウジング記録と同意のわかりやすさ | Ethics & Bias | `recordingTriggerManager.ts:21-26` |
| 21 | トラスト評価システムが持つ文化的バイアス | Ethics & Bias | `_locales/en/messages.json:1697-1708` |
| 22 | Dashboard CSSで--font-monoが未定義 | UI Expert | `dashboard.css:1526,1648,1932` |
| 23 | .btn-primaryクラスが未定義 | UI Expert | `recordingTriggerSettings.ts:101` |
| 24 | README英語版インストール手順のパス誤り | Documentation Architect | `README.md:224` |
| 25 | 新規録画データがSQLiteに書き込まれない | Legacy Bridge Architect | `RecordingPipeline` |
| 26 | serialize()がDBバイナリではなくJSONを返す | 8エージェントが指摘 | `sqlite.ts:586-628` |

---

## 重複指摘（同じ問題を複数エージェントが指摘）

| 問題 | 指摘エージェント数 | 重複元 |
|:----|:-----------------:|:--------|
| `serialize()` 関数名と実装の乖離 | **8** | Blue Team, System Architect, Maintainability, Tuning, Data Integrity, API Contract, DX Advocate, Test Experts |
| 型定義の3層重複 | **4** | Maintainability, Refactoring, DX Advocate, Test Experts |
| MigrationService 進捗管理のバグ | **3** | Domain Logic, System Architect, Test Experts |
| DASHBOARD_SQLITE 型安全でない設計 | **2** | System Architect, API & Contract Negotiator |
| 旧製品名残存 | **2** | i18n Expert, Ethics & Bias |
| スキーマバージョン管理欠如 | **2** | System Architect, SRE/Ops |

**コンフリクト調整結果**: 上記重複はすべて整合性のある指摘であり、System Architectの判断と矛盾するものはありません。

---

## 未完了エージェント
なし（全22名完了）

---

## 修正アクション

Test Experts (Wave 3) が以下を修正済み:
1. 🔧 `src/offscreen/sqlite.ts` — スキーマ初期化バグ修正（`CREATE INDEX` を `ALTER TABLE` 後に移動）
2. 🔧 `src/background/service-worker.ts` — DASHBOARD_SQLITE 送信元検証追加

### 安全に自動修正可能な項目

以下の Low/Medium 項目については即時修正可能:
- READMEのパス誤り (`dist` → `dist/chromium-mv3`)
- CSS `--font-mono` 未定義の追加
- `.btn-primary` クラス定義の追加（または `.btn-action` への置換）
- 旧製品名残存の一括置換（messages.json 4箇所）
- `serialize()` 関数名の修正（JSDoc更新）
- `error instanceof Error` パターンの共通化

### 設計判断が必要な項目（ユーザー確認推奨）

以下の項目はアーキテクチャ判断や設計変更を伴うため、ユーザーとの確認を推奨:
- MigrationService 進捗管理の抜本的修正（データ損失リスク）
- GDPR「全データ削除」のSQLite対応（メッセージ設計）
- オフスクリーン文書ライフサイクル管理（モバイル対応）
- スキーマバージョン管理システムの導入
- i18nキー追加設計（翻訳方針の確認）
- アクセシビリティ対応（UIデザインとの整合）
