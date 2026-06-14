# PBI: 診断パネルの SQLite ケイパビリティ・マトリクス

> 種別: feat/改善（既存 diagnosticsPanel の拡張）
> 関連設計: `dev-docs/specs/2026-06-14-sqlite-opfs-persistence-design.md`
> 深掘り結果: `dev-docs/plans/tobe-yasumaro/pbi/dig-findings-PBI-13.md`
> 進め方: **TDD 必須**

## ⚠️ 既実装あり（フェーズ0 確認結果）

`src/dashboard/diagnosticsPanel.ts` は既に SQLite の status / path / fallback / fts5 を表示している（`diagnosticsPanel.ts:165-202`）。
**未実装の部分:**
- 環境判定（OPFS API 有無、SyncAccessHandle 有無、Worker 可否）→ なし
- 「全機能を有効化するために何が足りないか」の不足診断と対処提示 → なし
- `PRAGMA compile_options` の UI 表示 → なし（console.log のみ）
- dashboard/offscreen 間の環境判定乖離検出 → なし
- デバッグ詳細情報の表示/非表示切替 → なし

本 PBI はこの 5 点の追加。

## ユーザーストーリー

拡張機能のユーザー（およびデバッグする開発者）として、診断画面で「SQLite が使えるか／何が使えるか／全機能を有効にするには何が足りないか」を一目で知りたい、なぜなら不具合時に自分の環境の制約と対処を理解したいからだ。

## ビジネス価値

- 環境起因の問題（OPFS 不可・FTS5 なし）をユーザー自身が把握でき、サポート負荷を下げる
- 測定: 診断パネルに 3 層（環境判定／DB 状態／不足診断）が表示される

## 深掘りで確定した設計方針

深掘りセッション（2026-06-15）で以下の設計方針が確定した。詳細は `dig-findings-PBI-13.md` 参照。

### 1. compile_options の経路とキャッシュ

- `getStatus()` の戻り値に `compileOptions: string[]` フィールドを追加
- **コードパスごとに独立**してキャッシュ:
  - IDB パス: `_doInit()` 内で `PRAGMA compile_options` を実行し、モジュールレベル変数 `cachedCompileOptions` に保持
  - OPFS Worker パス: `initSqlite()` で `PRAGMA compile_options` を**新規実行**し、Worker 内でキャッシュ
  - Fallback パス: compile_options なし（DB が存在しないため）
- `compileOptionsSource: 'opfs-worker' | 'idb' | 'fallback'` フィールドでどのコードパスから取得したかを明示
- キャッシュはセッション内有効（offscreen document のライフサイクルと一致）。永続化は不要
- **重要**: OPFS Worker は同期ビルド（FTS5 非同梱）、IDB は非同期ビルド（FTS5 有効の場合あり）。compile_options の内容が**異なる**ため、コードパスの区別が必須

### 2. 不足診断の状態マッピング（9パターン）

純粋関数 `diagnoseDeficiencies(input: DiagnosticInput): DeficiencyItem[]` として実装。

```typescript
interface DiagnosticInput {
  opfsDirectory: boolean;      // detectLiveVfsStrategy() 結果
  syncAccessHandle: boolean;
  worker: boolean;
  initialized: boolean;        // getStatus() 結果
  fallback: boolean;
  fts5: boolean;
  initError?: string;
  vfsStrategy: VfsStrategy;
}

interface DeficiencyItem {
  id: string;                  // 'no-opfs', 'no-fts5', etc.
  severity: 'none' | 'low' | 'medium' | 'high';
  summaryKey: string;          // i18n key (サマリー)
  detailKey: string;           // i18n key (詳細)
  recommendedActionKey: string; // i18n key (対処)
}
```

| 条件 | 不足 ID | 重要度 |
|------|---------|--------|
| 全環境 OK + 初期化済み + FTS5 有り | なし | — |
| opfsDirectory=false | `no-opfs` | high |
| syncAccessHandle=false && opfsDirectory=true | `no-sync-access-handle` | medium |
| worker=false && opfsDirectory=true | `no-worker` | medium |
| fts5=false && initialized=true | `no-fts5` | low |
| fts5=false && vfsStrategy='opfs-sync-worker' | `opfs-no-fts5` | low |
| initialized=false && initError あり | `init-failed` | high |
| initialized=false && initError なし | `not-initialized` | medium |
| fallback=true | `fallback-mode` | high |

### 3. 乖離検出

- dashboard 側で `detectLiveVfsStrategy()` を直接呼び、offscreen 側の status 結果と比較
- 乖離がある場合（例: dashboard は OPFS 判定、offscreen は fallback）に警告表示
- offscreen 未起動時は既存の `diagSqliteCheckFailed` キーで対応（特別な表示は不要）

### 4. debugMode ランタイムフラグ

- `chrome.storage.local` に `debugMode: boolean` キーを保存
- 診断パネルの最上部にトグル配置（既存の `toggle-switch` コンポーネント再利用）
- `debugMode: true` の場合のみ折りたたみセクション（compile_options、不足診断詳細）を表示
- ビルド分岐なし。リリース版でもユーザーが任意に切り替え可能

### 5. 不足診断メッセージの2段階設計

- **サマリーレベル**（折りたたみの見出し）: 「FTS5: 不足」「OPFS: 利用不可」
- **詳細レベル**（折りたたみの中身）: 開発者向けに具体的な対処パスを含む
  - 例: `vendor/wa-sqlite/build-wasm.sh` に同期ビルドターゲットを追加して WASM を再ビルド
  - 例: Chrome のバージョンを確認（OPFS は Chrome 102+）

## BDD 受け入れシナリオ

```gherkin
Scenario: 全機能が使える環境
  Given OPFS と FTS5 が利用可能な環境
  When  診断パネルを開く
  Then  環境判定に「OPFS: ✓ / SyncAccessHandle: ✓ / Worker: ✓」が表示される
  And   DB 状態に VFS 種別 OPFS・FTS5 有効・件数・DB パスが表示される
  And   不足診断は「不足なし（全機能有効）」と表示される

Scenario: FTS5 が無く fallback 動作の環境
  Given FTS5 を含まない WASM ビルド、または OPFS 不可の環境
  When  診断パネルを開く
  Then  DB 状態に「FTS5: ✗（LIKE 検索で代替）」「VFS: fallback」が表示される
  And   不足診断に「FTS5 なし → FTS5 付き WASM の再ビルドが必要」「OPFS 不可 → fallback 動作中（理由）」と対処が示される

Scenario: debugMode が OFF の場合
  Given debugMode が false
  When  診断パネルを開く
  Then  基本情報（Status / Path / Fallback / FTS5）のみ表示される
  And   compile_options / 不足診断詳細は非表示

Scenario: debugMode が ON の場合
  Given debugMode が true
  When  診断パネルを開く
  Then  基本情報に加えて compile_options（FTS/VFS ハイライト）が表示される
  And   不足診断の詳細セクションが展開される

Scenario: dashboard と offscreen の環境判定が乖離している
  Given dashboard 側は OPFS 可能と判定、offscreen 側は fallback を使用
  When  診断パネルを開く
  Then  「環境判定に乖離があります」と警告が表示される

Scenario: getStatus() が null を返す
  Given offscreen document が作成できない
  When  診断パネルを開く
  Then  「SQLite 状態の確認に失敗しました」と表示される
```

## 受け入れ基準

- [ ] **環境判定**層: `navigator.storage.getDirectory` 有無、`createSyncAccessHandle` 有無、Worker 生成可否を表示
- [ ] **DB 状態**層: 初期化成否 / VFS 種別（OPFS / IndexedDB / fallback）/ FTS5 有無 / レコード件数 / DB パス
- [ ] **compile_options**: `PRAGMA compile_options` の全項目を表示（FTS/VFS 関連をハイライト、他は折りたたみ）。`compileOptionsSource` でコードパスを明示
- [ ] **不足診断**層: 9パターンの純粋関数。全機能有効化に足りない項目と具体的対処を提示
- [ ] **乖離検出**: dashboard 側と offscreen 側の環境判定が乖離していた場合に警告表示
- [ ] **debugMode**: `chrome.storage.local` の `debugMode` キーで折りたたみセクションの表示/非表示を制御。診断パネル内にトグル配置
- [ ] 既存の status/path/fallback/fts5 表示と統合され重複しない
- [ ] getStatus() の戻り値に `compileOptions: string[]` と `compileOptionsSource` が追加されている
- [ ] OPFS Worker の `handleGetStatus()` が compile_options を含んでいる
- [ ] 不足診断ロジックが純粋関数（副作用なし）として切り出されている

## テスト戦略（t_wada スタイル）

### 統合テスト
- offscreen status レスポンス（VFS 種別・fts5・initError・compileOptions）→ パネル描画
- compile_options / FTS インデックス件数取得の往復
- debugMode ON/OFF での表示切替

### 単体テスト
- **不足診断ロジック**: `diagnoseDeficiencies(input)` の全9パターンをカバー（jsdom でモック）
- **環境判定ロジック**: `detectOpfsCapabilities()` の8パターン（OPFS Worker 用 / IDB 用の結果差異を含む）
- **compile_options キャッシュ**: IDB パスと OPFS Worker パスで異なる結果が返されることの検証
- **乖離検出**: dashboard 側と offscreen 側の結果が異なる場合に警告が出ることの検証
- i18n キーの存在確認

### 手動
- OPFS 環境・fallback 環境それぞれで表示確認
- debugMode トグルの動作確認

## 実装アプローチ

- Outside-In: 「fallback 環境で不足診断に対処が出る」テストを先に失敗させる
- `getStatus()`（`sqlite.ts:1003`）の戻り値に `compileOptions` と `compileOptionsSource` を追加
- OPFS Worker の `handleGetStatus()`（`opfsWorker.ts:345`）に `PRAGMA compile_options` を追加
- 不足診断は `diagnoseDeficiencies()` 純粋関数として切り出し
- 乖離検出は `detectLiveVfsStrategy()` 結果と status 結果の比較ロジックを diagnosticsPanel に追加
- debugMode は既存の `toggle-switch` コンポーネントを再利用

## 見積もり

5 pt（要チーム見積もり。深掘りでスコープが拡大: compile_options 追加 + OPFS Worker 対応 + 乖離検出 + debugMode）

## 技術的考慮事項

- **依存**: PBI-12 と並行着手可。VFS 種別は現状の fallback/native 区別で開始。PBI-12 完了後に `OPFS` 種別を追加
- **i18n**: 新規追加は最小限（`diagDebugMode`、`diagDebugDescription` の2個）。不足診断のメッセージは既存の `diagSqlite*` キーの拡張
- **アクセシビリティ**: 状態を色だけで伝えない（✓/✗ 記号併用）。`role="switch"` + `aria-checked` でトグル対応
- **パフォーマンス**: compile_options は診断パネル開時のみ取得。キャッシュで再実行を防止
- **PBI-12 後の拡張**: VFS 種別の表示ロジックを PBI-12 完了後に更新する手戻りを考慮し、VFS 種別表示を関数化して切り出す

## 実装者向け注記

### 現状コードの確認（着手前に必ず実行）

```bash
sed -n '165,202p' src/dashboard/diagnosticsPanel.ts   # 既存 SQLite 表示
grep -n "getStatus\|fts5\|initError\|fallback" src/offscreen/sqlite.ts src/background/sqliteClient.ts
grep -rn "compile_options" src/offscreen/sqlite.ts     # 既に取得しているが console のみ
grep -n "handleGetStatus\|initSqlite" src/offscreen/opfsWorker.ts  # OPFS Worker の status
grep -n "detectLiveVfsStrategy\|detectOpfsCapabilities" src/offscreen/opfsCapabilities.ts
```

### 落とし穴

- `PRAGMA compile_options` は現状 console.log のみ（`sqlite.ts:314-319`）。UI へ出すには offscreen → background → dashboard の status 経路に追加が必要
- **OPFS Worker は同期ビルド**（FTS5 非同梱）。IDB は非同期ビルド（FTS5 有効の場合あり）。compile_options の内容が**異なる**
- OPFS Worker の `handleGetStatus()` は `fts5: false` をハードコード（`opfsWorker.ts:357`）。PRAGMA で動的に判定する必要がある
- 環境判定（OPFS/Worker）は dashboard 側 window でも検出可だが、実際に DB が使う offscreen 側の結果と乖離しうる。**offscreen 側の実測**を正とする
- デバッグ詳細はリリース後に絞る前提。`debugMode` ランタイムフラグで制御
- `<details>`/`<summary>` 折りたたみは既存（`advanced-details`、`ublock-details`）。CSS クラスを再利用

### コードパス別の compile_options 取得

| パス | ファイル | compile_options 取得方法 |
|------|---------|------------------------|
| IDB | `sqlite.ts:_doInit()` | `PRAGMA compile_options` → `cachedCompileOptions` に保持 |
| OPFS Worker | `opfsWorker.ts:initSqlite()` | `PRAGMA compile_options` → Worker 内キャッシュに保持 |
| Fallback | `storageFallback.ts` | 取得なし（DB が存在しないため） |

## Definition of Done

- [ ] 全 BDD シナリオが自動テスト化されパス
- [ ] 不足診断ロジックの単体テストが9パターンをカバー
- [ ] compile_options の IDB/OPFS Worker パス別取得が動作
- [ ] debugMode トグルが ON/OFF で表示を切り替える
- [ ] 乖離検出が dashboard/offscreen 結果異なる場合に警告を表示
- [ ] OPFS / fallback 両環境で手動表示確認
- [ ] i18n（ja/en）整備（新規2個 + 不足診断メッセージ）
- [ ] レビュー・リファクタリング完了
