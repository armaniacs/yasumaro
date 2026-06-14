# PBI: 診断パネルの SQLite ケイパビリティ・マトリクス

> 種別: feat/改善（既存 diagnosticsPanel の拡張）
> 関連設計: `dev-docs/specs/2026-06-14-sqlite-opfs-persistence-design.md`
> 進め方: **TDD 必須**

## ⚠️ 既実装あり（フェーズ0 確認結果）

`src/dashboard/diagnosticsPanel.ts` は既に SQLite の status / path / fallback / fts5 を表示している（`diagnosticsPanel.ts:165-202`）。
**未実装の部分:**
- 環境判定（OPFS API 有無、SyncAccessHandle 有無、Worker 可否）→ なし
- 「全機能を有効化するために何が足りないか」の不足診断と対処提示 → なし

本 PBI はこの 2 点の追加。

## ユーザーストーリー

拡張機能のユーザー（およびデバッグする開発者）として、診断画面で「SQLite が使えるか／何が使えるか／全機能を有効にするには何が足りないか」を一目で知りたい、なぜなら不具合時に自分の環境の制約と対処を理解したいからだ。

## ビジネス価値

- 環境起因の問題（OPFS 不可・FTS5 なし）をユーザー自身が把握でき、サポート負荷を下げる
- 測定: 診断パネルに 3 層（環境判定／DB 状態／不足診断）が表示される

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
```

## 受け入れ基準

- [ ] **環境判定**層: `navigator.storage.getDirectory` 有無、`createSyncAccessHandle` 有無、Worker 生成可否を表示
- [ ] **DB 状態**層: 初期化成否 / VFS 種別（OPFS / IndexedDB / fallback）/ FTS5 有無 / レコード件数 / DB パス
- [ ] **不足診断**層: 全機能有効化に足りない項目と具体的対処を提示
- [ ] デバッグ期間用に詳細情報（`PRAGMA compile_options`、初期化エラー全文、FTS インデックス件数）を表示
- [ ] 既存の status/path/fallback/fts5 表示と統合され重複しない

## テスト戦略（t_wada スタイル）

### 統合テスト
- offscreen status レスポンス（VFS 種別・fts5・initError）→ パネル描画
- compile_options / FTS インデックス件数取得の往復

### 単体テスト
- 環境判定ロジック（API 有無の検出。jsdom でモック）
- 不足診断ロジック：状態 → 不足項目・対処メッセージのマッピング（FTS5 なし / OPFS 不可 / 初期化失敗の各分岐）
- i18n キーの存在

### 手動
- OPFS 環境・fallback 環境それぞれで表示確認

## 実装アプローチ

- Outside-In: 「fallback 環境で不足診断に対処が出る」テストを先に失敗させる
- `getStatus()`（`sqlite.ts:746`）が返す `fallback` / `fts5` / `initError` を活用。必要なら VFS 種別フィールドを status に追加（PBI-12 と整合）
- 不足診断は「状態オブジェクト → 診断項目配列」の純粋関数として切り出し、テスト容易性を確保

## 見積もり

3 pt（要チーム見積もり）

## 技術的考慮事項

- 依存: VFS 種別を status で返せること（PBI-12 で `OPFS` 種別が入る）。先行実装する場合は現状の fallback/native 区別で開始可
- i18n: 全表示文言を data-i18n / getMessage 経由に（既存パネル方針に従う）
- アクセシビリティ: 状態を色だけで伝えない（✓/✗ 記号併用、既存実装踏襲）

## 実装者向け注記

### 現状コードの確認（着手前に必ず実行）

```bash
sed -n '165,202p' src/dashboard/diagnosticsPanel.ts   # 既存 SQLite 表示
grep -n "getStatus\|fts5\|initError\|fallback" src/offscreen/sqlite.ts src/background/sqliteClient.ts
grep -rn "compile_options" src/offscreen/sqlite.ts     # 既に取得しているが console のみ
```

### 落とし穴

- `PRAGMA compile_options` は現状 console.log のみ（`sqlite.ts:174-178`）。UI へ出すには offscreen → background → dashboard の status 経路に追加が必要
- 環境判定（OPFS/Worker）は dashboard 側 window でも検出可だが、実際に DB が使う offscreen 側の結果と乖離しうる。**offscreen 側の実測**を正とする
- デバッグ詳細はリリース後に絞る前提。表示量の出し分け方針を残す

## Definition of Done

- [ ] 全 BDD シナリオが自動テスト化されパス
- [ ] 不足診断ロジックの単体テストが各分岐をカバー
- [ ] OPFS / fallback 両環境で手動表示確認
- [ ] i18n（ja/en）整備
- [ ] レビュー・リファクタリング完了
