# PBI: opfsWorker のゴッドモジュールを分割し、Worker プロトコルを型付けする

## ユーザーストーリー
開発者として、`opfsWorker.ts`（945行）がスキーマ初期化・V2マイグレーション・CRUD・検索・バックアップ・パージ・メッセージディスパッチの7責務を単一ファイルに抱え、20分岐の switch を `type: string` のペイロードで駆動している状態を解消したい。なぜなら、プロトコルのタイプミスがコンパイル時に検出できず、UPDATE パスが `UPDATABLE_FIELDS` ホワイトリストを迂回しているから。

## ビジネス価値
- 各関心事を1ファイルに分割し、変更影響範囲を局所化する
- Worker プロトコルを判別可能ユニオン型にし、送受信のドリフトを型エラーで検出する
- ホワイトリスト迂回というセキュリティ上の分岐を閉じる

## BDD受け入れシナリオ

```gherkin
Scenario: Worker の責務がモジュールに分割される
  Given opfsWorker.ts が薄いルーターになっている
  When 各操作（CRUD/検索/バックアップ/パージ）が実行される
  Then 専用のハンドラモジュールが処理する
  And opfsWorker.ts 自体はキューとルーターのみを持つ

Scenario: プロトコルのタイプミスが型エラーになる
  Given WorkerMessage 判別可能ユニオン型が定義されている
  When OpfsWorkerBackend が不正なメッセージ型を送信しようとする
  Then コンパイルが失敗する

Scenario: UPDATE がホワイトリストを遵守する
  Given UPDATABLE_FIELDS 外のカラムを含む update 要求がある
  When OPFS パスで update を実行する
  Then IDB パスと同じく対象カラムが拒否される
```

## 受け入れ基準
- [ ] `opfsWorker.ts` から CRUD / 検索 / バックアップ / パージ / 監査 / ステータスの各ハンドラが専用モジュールへ抽出されている
- [ ] `opfsWorker.ts` の本体がキュー＋ルーターのみ（目安150行以下）になっている
- [ ] `RequestMessage.type` が `string` から判別可能ユニオン型になっている
- [ ] `OpfsWorkerBackend` と `opfsWorker` が同じユニオン型を参照している
- [ ] OPFS の UPDATE が `UPDATABLE_FIELDS`（`schema.ts`）を遵守する
- [ ] 既存の OPFS Worker テスト（`opfsWorker.test.ts`, `opfsWorker-search-sort.test.ts` 等）がすべてパスする

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- Dashboard からの SQLite 操作が OPFS 環境で既存通り動作する

### 統合テスト
- `OpfsWorkerBackend` ↔ Worker のプロトコル往復（成功/失敗/タイムアウト）
- 分割後のルーターが全メッセージ型を正しくディスパッチする網羅テスト

### 単体テスト
- 各ハンドラモジュール（CRUD / search / backup / purge / audit）の単体テスト
- `WorkerMessage` ユニオンの全ケースに対するルーターの網羅性

## 実装アプローチ
- **Outside-In**: まず既存 `opfsWorker.test.ts` が green のまま、`handleRequest` のディスパッチをハンドラモジュールへ委譲する形で機械的に分割
- **Red-Green-Refactor**: `type: string` をユニオン型へ置換し、型エラーを逐次解消

## 見積もり
3ポイント

## 技術的考慮事項
- 依存関係: なし（独立して実装可能）。PBI-29（読み取りシーム崩壊）の前提として実施すると作業が軽減される
- テスタビリティ: ハンドラを純関数に寄せ、Worker 環境なしで単体テスト可能にする
- 副作用: SQLite 永続化層のため動作変更は許容しない。分割は純粋な構造変更に留める

## 実装者向け注記

### 現状コードの確認
```bash
# 型付けされていないプロトコルを確認
grep -n "type: string\|type RequestMessage\|handleRequest" src/offscreen/opfsWorker.ts
# 20分岐 switch を確認
sed -n '783,901p' src/offscreen/opfsWorker.ts
# ホワイトリスト迂回を確認
grep -n "Object.entries(changes)\|UPDATABLE_FIELDS" src/offscreen/opfsWorker.ts src/offscreen/IdbVfsBackend.ts
```

### 現状（2026-08-17 確認済み）
- `opfsWorker.ts:40` の `RequestMessage.type` は `string`。`handleRequest`（783行〜）が20ケースの switch
- `opfsWorker.ts:355` の `for (const [key, val] of Object.entries(changes))` が任意カラムを受け付ける一方、`IdbVfsBackend.ts:211` は `UPDATABLE_FIELDS` で検証しており、OPFS パスだけホワイトリストが効いていない
- 親側 `sqliteEngineContext/` は既に PBI-01 で分割済みだが、Worker 本体は未分割
- 既実装の重複: なし（この PBI は未実装）

### 実装手順
1. `opfsWorkerHandlers/` ディレクトリを新設し、`crudHandlers.ts` / `searchHandlers.ts` / `backupHandlers.ts` / `purgeHandlers.ts` / `auditHandlers.ts` / `statusHandlers.ts` に各ハンドラを移動（関数シグネチャは現状維持）
2. `opfsWorker.ts` の `handleRequest` を「ハンドラモジュールへのルーター」へ書き換え
3. `RequestMessage.type` を判別可能ユニオン型にし、`OpfsWorkerBackend.ts` と共有する
4. OPFS の `handleUpdate` を `UPDATABLE_FIELDS` 検証に変更
5. 分割後の各ハンドラに単体テストを追加

### 落とし穴
- `opfsWorker.ts` は Web Worker コンテキストで動く。`chrome.*` API や Service Worker 依存の import をハンドラに持ち込まないこと
- `__log` 判定付きのログ中継チャネル（`self.onmessage`）は現状維持。ルーター分割時に壊さないこと
- `handleUpdate` を `UPDATABLE_FIELDS` 検証に変えると、既存の gist_synced 等の更新カラムが拒否されないか確認すること（`schema.ts` の `UPDATABLE_FIELDS` に不足があれば追記してから適用）
- SQL_EXEC / SQL_QUERY はマイグレーション専用の escape hatch。ユニオン型に含めるが、一般操作からは隔離を維持すること

## Definition of Done
- [ ] `opfsWorker.ts` がキュー＋ルーターのみ（目安150行以下）になっている
- [ ] 各ハンドラが専用モジュールに分割され、単体テストが追加されている
- [ ] Worker プロトコルが判別可能ユニオン型になり、`OpfsWorkerBackend` と共有されている
- [ ] OPFS の UPDATE が `UPDATABLE_FIELDS` を遵守している
- [ ] 全テストがパスし `npm run validate` が通過している
- [ ] コードレビュー完了
