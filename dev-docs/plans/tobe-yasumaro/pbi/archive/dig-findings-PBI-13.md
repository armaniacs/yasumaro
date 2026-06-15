# 深掘りセッション — PBI-13: 診断パネルの SQLite ケイパビリティ・マトリクス

> 日付: 2026-06-15
> 対象: `dev-docs/plans/tobe-yasumaro/pbi/2026-06-14-13-feat-diagnostics-capability-matrix.md`

---

## 挑戦した仮定

| 仮定 | リスク | 発見 | 決定 |
|------|--------|------|------|
| PRAGMA compile_options を offscreen → background → dashboard 経路で取得できる | 高 | 現状は console.log のみ。UI に表示するには status レスポンスに追加が必要。数十項目ありフィルタリングの要否が問題 | **getStatus() の戻り値に全 compile_options を追加**。診断パネル開時のみ呼び出されるため頻度は低い。表示は FTS/VFS 関連をハイライトし、他は折りたたみ |
| dashboard 側と offscreen 側の環境判定が乖離しない | 高 | PBI-13 の落とし穴として明記済み。dashboard 側の `detectLiveVfsStrategy()` と offscreen 側の結果が乖離しうる | **両方検出＋比較**。dashboard 側で `detectLiveVfsStrategy()` を直接呼び、status 経由の offscreen 結果と比較。乖離があれば警告表示 |
| 不足診断の対処提示をユーザーが理解できる | 高 | 対象は開発者・テスター。一般ユーザーには混乱を与える可能性 | **開発者・テスター専用**。リリース版では詳細を隠す（折りたたみセクション） |
| PBI-12 完了前でも VFS 種別の表示が意味を持つ | 中 | PBI-12 前は fallback/native 区別、PBI-12 後は OPFS 種別が表示される。同じ環境でも表示が変わる | **並行着手**。PBI-13 は現状の fallback/native 区別で開始。PBI-12 完了後に VFS 種別の表示を更新する手戻りは許容 |
| 「デバッグ詳細情報」の表示範囲 | 中 | リリース後に絞る前提だが基準が曖昧 | **折りたたみセクション**で段階的に表示。デフォルトは閉じている |
| PBI-12 との依存関係 | 中 | PBI-13 は「依存: なし」と書かれているが、VFS 種別の表示精度に影響 | **並行着手可**。compile_options 取得・不足診断ロジックは PBI-12 に依存しない |

---

## 新たに発見したリスク

1. **compile_options の応答サイズ**: 全数十項目を getStatus() に追加すると、status レスポンスが大きく成為りうる。診断パネル開時のみ呼び出されるため頻度は低いが、パフォーマンスへの影響を考慮すべき
2. **offscreen 未起動時の乖離検出**: dashboard 側で直接 `detectLiveVfsStrategy()` を呼べるが、offscreen 側の結果が得られない場合（offscreen 未起動）に乖離検出が不能になる
3. **i18n キーの増加**: compile_options 表示・乖離警告・不足診断の折りたたみに新しい i18n キーが多数必要になる
4. **PBI-12 完了後の表示更新**: VFS 種別の表示ロジックを PBI-12 完了後に更新する手する手戻りが発生する。PBI-13 の実装時に「PBI-12 後の拡張」を考慮したコード設計が必要

---

## 未解決の疑問（調査結果付き）

### Q1. compile_options のパフォーマンス

> getStatus() に数十項目を追加した場合、offscreen 側の PRAGMA 実行コストはどの程度か？キャッシュする価値はあるか？

**調査結果:**
- `PRAGMA compile_options` は `_doInit()` 内で**1回のみ実行**され、結果は console.log にのみ出力後に破棄される（`sqlite.ts:314-319`）
- 戻り件数は **25〜40 項目**（标准的な SQLite WASM ビルド）
- PRAGMA は SQLite のメタデータクエリ（インメモリ配列から読み出し）。WASM ↔ JS 境界 crossing のコストのみで、実行コストは**極めて低い**
- 結果キャッシュ用のモジュールレベル変数は**存在しない**。`preparedStmtCache` はステートメントハンドルのキャッシュのみ
- **OPFS Worker パス**（`opfsWorker.ts`）では `PRAGMA compile_options` を**一切実行していない**（`initSqlite():123`、`handleGetStatus():345` に該当コードなし）
- `getStatus()` の呼び出し頻度は**極めて低い**（診断パネル開時、テストボタン押下時のみ）

**決定:**
- モジュールレベル変数（例: `let cachedCompileOptions: string[] | null = null`）で `PRAGMA compile_options` の結果を保持する
- `getStatus()` では既存のキャッシュから返す（再実行しない）
- OPFS Worker パスでも同等のキャッシュ機構を追加する（`opfsWorker.ts` の `initSqlite()` に `PRAGMA compile_options` を追加）
- キャッシュはセッション内有効（offscreen document のライフサイクルと一致）。永続化は不要

### Q2. offscreen 未起動時の対応

> offscreen が未起動の場合に dashboard 側の検出のみで表示するか、それとも「offscreen 未起動」と表示するか？

**調査結果:**
- offscreen document は**オンデマンド生成**（`sqliteClient.ts:55-82` の `ensureOffscreenDocument()`）
- `getStatus()` 呼び出し時に自動的に offscreen が作成される（`call()` → `msgOffscreen()` → `ensureOffscreenDocument()`）
- offscreen が作成できない場合（エラー・タイムアウト）は `getStatus()` が **`null` を返す**
- dashboard 側（`dashboardSqliteService.ts:250-266`）は `null` を安全にハンドリングする
- `offscreenAlive` フラグ（`sqliteClient.ts:48`）でリトライ機構あり

**決定:**
- 「offscreen 未起動」は**表示しない**。`getStatus()` が `null` を返す場合、既存の `diagSqliteCheckFailed` キーで「SQLite 状態の確認に失敗しました」と表示する
- 理由: offscreen は自動作成されるため、「未起動」はユーザーが対処できる問題ではない。エラーメッセージで十分
- ただし、`null` の場合に dashboard 側の `detectLiveVfsStrategy()` 結果のみ表示するオプションも検討可能（乖離検出の精度は落ちる）

### Q3. リリース後の絞り込み基準

> デバッグ詳細情報の表示範囲をリリース後にどう絞るか？compile_options は完全に非表示にするか、FTS/VFS 関連のみ残すか？

**調査結果:**
- **デバッグ用のビルドフラグ・ランタイムフラグは存在しない**。`isDevelopment()`（`logger.ts:118-137`）は DEBUG ログのフィルタリングにのみ使用
- WXT の `import.meta.env.DEV` は `dev` スクリプト時のみ `true`。本番ビルドでは `false`
- 診断パネルは**常に表示**。条件付きガーディングなし（`dashboard.ts:721` で無条件初期化）
- i18n キーは既に **38 個**存在（`_locales/en/messages.json:1130-1313`、`_locales/ja/messages.json`）

**決定:**
- **ランタイムフラグ方式**を採用: `chrome.storage.local` に `debugMode` キーを保存
- 診断パネルの折りたたみセクション（compile_options、不足診断詳細）は `debugMode: true` の場合のみ表示
- `debugMode` の切り替え方法: 診断パネル内に「詳細モード」トグルボタンを配置（点击で `chrome.storage.local.set({ debugMode: !current })`）
- 理由: ビルド分岐なし。ユーザーが任意に切り替え可能。リリース版でもデバッグ可能
- **代替案**: `import.meta.env.DEV` で判断し、dev モード時のみ表示。ただし本番環境でのデバッグが不可になるため非推奨

### Q4. 不足診断のメッセージ設計

> 開発者向けの対処メッセージはどの程度具体的にするか？

**調査結果:**
- PBI-13 の BDD シナリオでは「FTS5 なし → FTS5 付き WASM の再ビルドが必要」「OPFS 不可 → fallback 動作中（理由）」のような表現が想定されている
- 対象は開発者・テスター（前述の決定済み）
- 診断情報は `PRAGMA compile_options`、初期化エラー全文、FTS インデックス件数を含む

**決定:**
- **2段階のメッセージ粒度**:
  - **サマリーレベル**（折りたたみセクションの見出し）: 「FTS5: 不足」「OPFS: 利用不可」
  - **詳細レベル**（折りたたみの中身）: 具体的な対処パスを含む
    - 例: 「FTS5 が利用できません。`vendor/wa-sqlite/build-wasm.sh` に同期ビルドターゲットを追加して WASM を再ビルドしてください。」
    - 例: 「OPFS SyncAccessHandle が利用できません。Chrome のバージョンを確認してください（OPFS は Chrome 102+）。」
- 理由: 開発者向けなので具体的なコマンドパスを含める。ただしサマリーは简洁に保つ

---

## 決定事項

1. **compile_options 経路**: getStatus() の戻り値に compileOptions フィールドを追加（全数十項目）
2. **compile_options キャッシュ**: モジュールレベル変数で保持。再実行しない。OPFS Worker パスにも同等追加
3. **不足診断の対象**: 開発者・テスター専用。リリース版では詳細を隠す
4. **不足診断の表示**: 折りたたみセクション（デフォルトは閉じている）
5. **不足診断のメッセージ**: 2段階（サマリー + 詳細）。開発者向けに具体的な対処パスを含む
6. **compile_options の表示**: FTS/VFS 関連をハイライト表示し、他は折りたたみ
7. **乖離検出**: dashboard 側で `detectLiveVfsStrategy()` を直接呼び、status 経由の offscreen 結果と比較。乖離があれば警告表示
8. **offscreen 未起動時**: 既存のエラーメッセージで対応。特別な表示は不要
9. **リリース後の絞り込み**: ランタイムフラグ方式（`debugMode` in `chrome.storage.local`）。診断パネル内トグルで切替
10. **PBI-12 との依存**: 並行着手可。PBI-13 は現状の fallback/native 区別で開始。PBI-12 完了後に VFS 種別を更新

---

## 追加深掘り — 未解決疑問の掘り下げ（2026-06-15）

前回解決した4つの疑問について、コードベース調査でさらに詳細な発見がありました。

### 追加発見 1: OPFS Worker と IDB パスの compile_options ギャップ

**重要な事実:**
- OPFS Worker（`opfsWorker.ts`）は**同期ビルド**（`wa-sqlite.mjs`、558KB）を使用
- IDB パス（`sqlite.ts`）は**非同期ビルド**（`wa-sqlite-async.mjs`、1.4MB）を使用
- 同期ビルドには **FTS5 が同梱されていない**（`opfsWorker.ts:8-9`、`opfsWorker.ts:315`、`opfsWorker.ts:357`）
- OPFS Worker の `handleGetStatus()` は `fts5: false` を**ハードコード**で返す（`opfsWorker.ts:357`）
- OPFS Worker では `PRAGMA compile_options` を**一切実行しない**（`initSqlite():123`、`handleGetStatus():345` に該当コードなし）

**影響:**
- `cachedCompileOptions` は **2つのコードパスで異なる結果を持つ可能性がある**
  - OPFS Worker パス: `ENABLE_FTS5` が**含まれない**（同期ビルドのため）
  - IDB パス: `ENABLE_FTS5` が**含まれる**場合がある（非同期ビルド、FTS5 有効時）
- getStatus() に compile_options を追加する場合、OPFS Worker パスでも `PRAGMA compile_options` を**新規実行する必要がある**
- ただし同期ビルドの PRAGMA compile_options は FTS5 を含まないため、結果は IDB パスと**異なる**

**決定の修正:**
- `cachedCompileOptions` は**コードパスごとに独立**して保持する（OPFS Worker 用 / IDB 用）
- getStatus() の戻り値に `compileOptionsSource: 'opfs-worker' | 'idb' | 'fallback'` を追加し、どのコードパスから取得したかを明示する
- OPFS Worker の `handleGetStatus()` に `PRAGMA compile_options` を追加し、結果を status レスポンスに含める

### 追加発見 2: 不足診断の完全な状態マッピング

**環境能力状態（3ブール → 8パターン）:**

| # | opfsDirectory | syncAccessHandle | worker | VFS 戦略 |
|---|---|---|---|---|
| 1 | ✓ | ✓ | ✓ | opfs-sync-worker（案A） |
| 2 | ✓ | ✓ | ✗ | opfs-async-main（案B） |
| 3 | ✓ | ✗ | ✓ | opfs-async-main（案B） |
| 4 | ✓ | ✗ | ✗ | opfs-async-main（案B） |
| 5 | ✗ | ✓ | ✓ | fallback |
| 6 | ✗ | ✓ | ✗ | fallback |
| 7 | ✗ | ✗ | ✓ | fallback |
| 8 | ✗ | ✗ | ✗ | fallback |

**DB 状態（6パターン）:**

| 状態 | opfsWorker | dbHandle | fallback | fts5 | バックエンド |
|------|-----------|----------|----------|------|------------|
| A: OPFS Worker OK | Worker | null | false | false（同期ビルド） | opfs |
| B: IDB OK + FTS5 | null | number | false | true | idb |
| C: IDB OK no FTS5 | null | number | false | false | idb |
| D: Fallback | null | null | true | false | fallback |
| E: 未初期化 | null | null | false | false | none |
| F: 初期化失敗→fallback | null | null | true | false | fallback |

**不足診断の完全マッピング（9パターン）:**

| 条件 | 不足 ID | 重要度 | 対処 |
|------|---------|--------|------|
| 全環境 OK + 初期化済み + FTS5 有り | なし | — | — |
| opfsDirectory=false | no-opfs | high | Chrome 102以上にアップグレード |
| syncAccessHandle=false && opfsDirectory=true | no-sync-access-handle | medium | Worker コンテキストで利用可能 |
| worker=false && opfsDirectory=true | no-worker | medium | CSP 設定を確認 |
| fts5=false && initialized=true | no-fts5 | low | WASM を再ビルド |
| fts5=false && vfsStrategy='opfs-sync-worker' | opfs-no-fts5 | low | 同期ビルドの既知の制限 |
| initialized=false && initError あり | init-failed | high | ブラウザバージョン確認、データクリア |
| initialized=false && initError なし | not-initialized | medium | 再読み込み |
| fallback=true | fallback-mode | high | OPFS/IDB が利用不可 |

### 追加発見 3: debugMode の UX 実装

**既存の UI パターン:**
- `<details>`/`<summary>` 折りたたみセクションが**2箇所に既存**（`advanced-details`（line 172）、`ublock-details`（line 372））
- 既存の CSS クラス `advanced-details` / `advanced-details-summary` / `advanced-details-content` を**再利用可能**
- 既存のトグル/スイッチコンポーネントあり（`domain-toggle-row` / `toggle-switch` / `toggle-slider`）（line 1793-1848）
- `role="switch"` + `aria-checked` によるアクセシビリティ対応済み

**実装方針:**
- HTML: 診断パネルの**最上部**にトグル配置（`panel-description` の直後、Storage セクションの前）
- CSS: 既存の `advanced-details` クラスを再利用
- i18n キー: **最小2個**追加（`diagDebugMode`、`diagDebugDescription`）
- JS: トグル変更時に `chrome.storage.local.set({ debugMode })` を呼び、折りたたみセクションの表示/非表示を制御

---

## 決定事項（更新版）

1. **compile_options 経路**: getStatus() の戻り値に compileOptions フィールドを追加（全数十項目）
2. **compile_options キャッシュ**: コードパスごとに独立して保持（OPFS Worker 用 / IDB 用）。`compileOptionsSource` フィールドで区別
3. **OPFS Worker に PRAGMA compile_options 追加**: `initSqlite()` で実行し、`handleGetStatus()` の戻り値に含める
4. **不足診断の対象**: 開発者・テスター専用。リリース版では詳細を隠す
5. **不足診断の表示**: 折りたたみセクション（デフォルトは閉じている）
6. **不足診断のメッセージ**: 2段階（サマリー + 詳細）。開発者向けに具体的な対処パスを含む
7. **compile_options の表示**: FTS/VFS 関連をハイライト表示し、他は折りたたみ
8. **乖離検出**: dashboard 側で `detectLiveVfsStrategy()` を直接呼び、status 経由の offscreen 結果と比較。乖離があれば警告表示
9. **offscreen 未起動時**: 既存のエラーメッセージで対応。特別な表示は不要
10. **リリース後の絞り込み**: ランタイムフラグ方式（`debugMode` in `chrome.storage.local`）。診断パネル内トグルで切替
11. **PBI-12 との依存**: 並行着手可。PBI-13 は現状の fallback/native 区別で開始。PBI-12 完了後に VFS 種別を更新
12. **不足診断の状態数**: 9パターン（上記マッピング参照）。純粋関数として実装
13. **debugMode UI**: 既存の `advanced-details` + `toggle-switch` パターンを再利用。i18n キーは2個追加のみ

---

## 完全性チェック

- [x] 高リスク仮定がすべて調査された（compile_options 経路、乖離検出、不足診断の対象）
- [x] 各主要トピックで2段階以上深掘りした（compile_options: 経路→フィルタリング→表示形式→キャッシュ→OPFS Worker ギャップ、不足診断: 対象→表示設計→メッセージ粒度→状態マッピング、debugMode: フラグ方式→UX→i18n）
- [x] すべての決定が記録された（13件）
- [x] 新たに浮かんだリスクが追跡された（4件 + OPFS Worker ギャップ）
- [x] 未解決の疑問がすべて解決された（4件 → 13件の決定事項に変換）
- [x] 不足診断の完全な状態マッピングが作成された（9パターン）
- [x] debugMode の UX 実装方針が確定した（既存パターン再利用）
