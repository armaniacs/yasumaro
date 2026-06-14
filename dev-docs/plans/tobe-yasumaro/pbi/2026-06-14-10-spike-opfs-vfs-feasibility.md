# PBI: OPFS VFS 実現性スパイク（MV3 offscreen 内）

> 種別: スパイク（技術的不確実性の解消）
> 関連設計: `dev-docs/specs/2026-06-14-sqlite-opfs-persistence-design.md`
> 進め方: **TDD 必須**（スパイクの検証コードも自動テスト化できる範囲はテスト先行）

## ユーザーストーリー

開発チームとして、MV3 offscreen 環境で OPFS ベースの wa-sqlite VFS が動作するかを確証したい、なぜなら本実装（IndexedDB VFS からの差し替え）の方式を確定し、手戻りを防ぎたいからだ。

## ビジネス価値

- OPFS 採用の技術リスクを着手前に潰す。後続 PBI（OPFS 実装）の見積もり精度が上がる
- 測定: 「案A/案B の動作可否」と「採用方式の決定メモ」が成果物として残る

## 背景（現状確認済み）

- 現状の VFS は `IDBBatchAtomicVFS`（IndexedDB ベース、`src/offscreen/sqlite.ts:136`）。OPFS は未使用
- `src/` に `new Worker` の利用は**ゼロ**（offscreen は main thread のみ）
- wa-sqlite v1.0.0 npm 版には既知の互換 shim 問題あり（`registerVFS`→`vfs_register`、`hasAsyncMethod` 欠如。`sqlite.ts:128-143` 参照）

## 検証対象（2案）

- **案A**: offscreen 内 Worker で OPFS **SyncAccessHandle VFS**（同期・高性能・wa-sqlite 推奨）
- **案B**: offscreen 直で OPFS **AccessHandlePool VFS**（Worker 不要・並行性弱い）

## BDD 受け入れシナリオ

```gherkin
Scenario: OPFS 環境が利用可能で案A が動作する
  Given Chrome の offscreen ドキュメントが起動している
  And   navigator.storage.getDirectory() と createSyncAccessHandle が利用できる
  When  offscreen 内 Worker で wa-sqlite を OPFS SyncAccessHandle VFS で初期化し、テーブル作成・INSERT・SELECT・FTS5 検索を実行する
  Then  全操作が成功し、ドキュメント再起動後もデータが永続化されている

Scenario: Worker 生成が MV3 制約で不可な場合に案B へ切り替えられる
  Given offscreen 内で new Worker が CSP / バンドル制約により失敗する
  When  案B（AccessHandlePool VFS, main thread）で同じ操作を試す
  Then  動作可否が記録され、採用判断メモに反映される
```

## 受け入れ基準

- [ ] 案A・案B それぞれについて「初期化／CRUD／FTS5／永続化（再起動後 read）」の可否が記録されている
- [ ] MV3 制約（offscreen 内 Worker 生成可否、CSP、bundler でのワーカー出力）の検証結果が残っている
- [ ] wa-sqlite v1.0.0 の OPFS VFS 互換 shim が必要かどうか判明している
- [ ] **採用方式（A or B）と理由**を設計仕様 or 本 PBI に追記している

## テスト戦略（t_wada スタイル）

スパイクだが、再利用可能な検証は自動テスト化する。

### 統合テスト
- offscreen ⇄ Worker メッセージ往復（案A）のモック検証
- VFS 初期化〜FTS5 検索のラウンドトリップ

### 単体テスト
- OPFS 機能検出ロジック（`getDirectory` / `createSyncAccessHandle` 有無）
- 案A 不可時に案B へフォールバックする分岐

### 手動検証（必須）
- 実 Chrome での OPFS 永続化（ドキュメント再起動後の read）
- DevTools → Application → OPFS で `yasumaro.db` の存在確認

## 実装アプローチ

- Outside-In: 「offscreen から OPFS 上の DB に書いて読める」E2E を先に失敗させ、内側へ
- スパイクのコードは破棄可能。ただし機能検出とフォールバック分岐は本実装へ引き継ぐ

## 見積もり

3〜5 pt（要チーム見積もり。不確実性が高いため上振れ前提）

## 技術的考慮事項

- 依存: なし（最初の PBI）。後続「OPFS 実装」PBI をブロックする
- wa-sqlite の OPFS VFS は `wa-sqlite/src/examples/` 配下に複数実装あり。どれが v1.0.0 で動くか要確認
- バンドラ（現状の build 設定）で Worker チャンクを出力できるか要確認

## 実装者向け注記

### 現状コードの確認（着手前に必ず実行）

```bash
grep -rn "IDBBatchAtomicVFS\|vfs_register\|new Worker" src/offscreen/ src/
ls node_modules/wa-sqlite/src/examples/   # OPFS 系 VFS 実装の確認
```

### 落とし穴

- OPFS SyncAccessHandle は **Worker 内でのみ同期利用可**。main thread では使えない（案A が Worker 前提なのはこのため）
- wa-sqlite v1.0.0 npm の VFS は upstream と API がずれている（既存 shim 参照）
- MV3 の offscreen は単一インスタンス・ライフサイクル制限あり。長時間ハンドル保持に注意

## Definition of Done

- [ ] 案A/案B の検証結果が文書化されている
- [ ] 採用方式が決定し、後続 PBI に引き継げる状態
- [ ] 引き継ぐ検証コード（機能検出・フォールバック）は自動テスト付き
- [ ] レビュー完了
