# PBI: SqliteClient 深掘り — 20メソッドの shallow interface を deep に集約

## ユーザーストーリー
開発者として、SqliteClient の 20メソッドの浅い interface を深い module に集約したい、なぜなら各メソッドが `this.call(TYPE, payload, transform)` の1行ラッパーで、deps が1:1で再マップされ、新しい操作を追加するたびに3箇所（interface / 実装 / deps）に名前を足す必要があるから

## 優先度
- 順位: 3 / 5
- RICEスコア: 160（Reach=200 / Impact=2 / Confidence=80% / Effort=2人週）
- 根拠: SQLite を使う全呼び出し（dashboard / background sync / audit log）に影響。Impact 2（interface 縮小、error categorization の locality 向上）。Confidence 80%（グルーピング設計の合意が必要）。Effort 2週（SqliteRpcClient interface 再設計、deps の3ドメイン集約、テスト更新）。PBI 01/02 完了後に着手すると seam の理解が深まる。

## ビジネス価値
- 新しい SQLite 操作（例: 新しい maintenance op）を追加する際の変更箇所が1 seam に集中し、interface を学ぶコストが下がる（leverage）
- error categorization と transform のバグが1 module に局在し、呼び出し元に散らない（locality）
- 測定: `SqliteRpcClient` の公開メソッド数が 20→3–4 に減り、`createSqliteClientDeps` の 1:1 マップが消えること

## BDD受け入れシナリオ

```gherkin
Scenario: 単一 call seam 越しに query が成功する
  Given SqliteClient が ChromeOffscreenTransport を adapter とする deep module である
  When query({ text: "hello", limit: 10 }) を呼ぶ
  Then transport の call(TYPE, payload, transform) が1回呼ばれ、SqliteRpcResult<{ rows, total }> が返る

Scenario: 3ドメインにグルーピングされた interface で全操作が賄える
  Given SqliteRpcClient が query / mutate / maintain の3ドメインに集約されている
  When insert / update / delete / toggleStar / purge / backup / restore のいずれかを呼ぶ
  Then 対応する domain メソッド経由で同じ transport seam を通り、error categorization が一貫する

Scenario: error categorization が一貫する
  Given offscreen が "timed out" エラーを返す
  When query / mutate のいずれかが失敗する
  Then categorizeError が retriable=true の SqliteError を返し、呼び出し元で同一の message と retry hint が得られる

Scenario: 後方互換 — 旧メソッド名が残っていない
  Given SqliteClient の旧 20メソッド名（insertResult / queryResult / toggleStarResult など）を grep する
  When src/background/sqliteClient.ts と src/messaging/sqliteRpcClient.ts を検索する
  Then 旧メソッド名は存在せず、呼び出し元は新 domain メソッド経由でのみアクセスする

Scenario: 境界 — transform が細粒度な型変換を隠蔽する
  Given queryResult が BrowsingLogRecord の rows/total を返す
  When 新しい StorageQuery フィールドが追加される
  Then transform は内部 seam に留まり、公開 interface のシグネチャは変わらない
```

## 受け入れ基準
- [ ] `SqliteRpcClient` interface の公開メソッドが 3–4 の domain メソッド（例: `query` / `mutate` / `maintain` / `getStatus`）または単一 `call<T,R>` seam に集約されている（20メソッドの1:1ラッパーが存在しない）
- [ ] `src/background/sqliteClient.ts` の各旧メソッド（`insertResult` / `queryResult` など）が削除され、domain メソッド内部で `private call` を呼ぶ形に集約されている
- [ ] `src/background/handlers/dashboardSqlite/deps.ts` の `createSqliteClientDeps` が 20の1:1マップではなく 3ドメインの deps（`ReadOnlyDeps` / `CoreCrudDeps` / `MaintenanceBatchDeps` は維持しつつ内部で新 interface に委譲）に更新されている
- [ ] `categorizeError` と `SqliteRpcResult<T>` の分類が全 domain で一貫し、旧 `categorizeError` の呼び出しが SqliteClient 内部に集約されている
- [ ] 既存の `sqliteClient.test.ts` / `sqliteClient-queue.test.ts` 相当のテストが新 seam 越しにパスする
- [ ] `npm run type-check` と `npm run validate` がパスする

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- ダッシュボードで query → toggleStar → delete → purge の一連が新 interface 越しに成功するシナリオ

### 統合テスト
- SqliteClient + InMemory OffscreenTransport（fake adapter）で query / mutate / maintain の各 domain が正しい SQLITE_* type と transform で transport を呼ぶ契約テスト
- createSqliteClientDeps が新 SqliteClient interface に正しく委譲し、旧 1:1 マップが消えていることのテスト

### 単体テスト
- call の transform が BrowsingLogRecord ↔ OffscreenResponse の型変換を正しく行うテスト
- categorizeError の retriable 分岐（timeout / offscreen_lost / quota / sqlite_error / unknown）
- StorageQuery の新フィールド追加時に interface が変わらないことのテスト（internal seam の検証）

## 実装アプローチ
- **Outside-In**: まず新しい `SqliteRpcClient` interface（3 domain）を定義し、InMemory adapter でテストを RED にする → SqliteClient 実装を新 interface に合わせて GREEN にする → 呼び出し元（deps / dashboard）を新 interface に移行 → 旧 20メソッドを削除して Refactor
- **Red-Green-Refactor**: 各 domain ごとに 1つずつ移行し、都度 `npm run type-check`

## 見積もり
3pt（要チームでの見積もり）— interface 再設計、deps 更新、テスト更新、レビューでの合意形成が必要
- **確認**: sqliteClient.ts は 319行、20メソッドの shallow interface が実在

## 技術的考慮事項
- 依存関係: PBI 02（offscreen Mutex 削除）完了後に着手すると transport seam の理解が深まるが、必須依存ではない。PBI 04（barrel 削除）とは独立
- テスタビリティ: ChromeOffscreenTransport を InMemoryTransport adapter に差し替えて seam 越しにテスト。2つの adapter が seam の実在を証明する（one adapter = hypothetical, two = real）
- 非機能要件: `traceId` の伝播と `recordSqliteFailure` / `recordSqliteSuccess` の呼び出しは新 interface でも維持

## 実装者向け注記

### 現状コードの確認
```bash
# 20メソッドの実態
grep -n "async.*Result\|async.*getStatus\|async.*isSqliteHealthy" src/background/sqliteClient.ts
# 1:1 で再マップしている deps
grep -n "sqliteClient\.\|=> sqliteClient" src/background/handlers/dashboardSqlite/deps.ts
# interface が1:1でミラーしている箇所
grep -n "interface SqliteRpcClient" src/messaging/sqliteRpcClient.ts -A 30
# 唯一の深い実装
grep -n "private async call" src/background/sqliteClient.ts -A 15
```
未実装ではなく「interface が implementation と同じ幅」な状態。集約が目的。

### 実装手順
1. 新 `SqliteRpcClient` interface を設計（案: `query(q: StorageQuery)` / `mutate(op, payload)` / `maintain(op, payload)` / `getStatus()` の4つ、または `call<T,R>(type, payload, transform?)` の1つ）。チームで合意
2. InMemoryTransport adapter を用意し、新 interface 越しの契約テストを RED で書く
3. `SqliteClient` 内部の `private call` を活かしつつ、新 domain メソッドを実装（旧メソッドは一旦残し委譲）
4. `createSqliteClientDeps` を新 interface に合わせて更新（1:1マップを domain 委譲に置換）
5. 呼び出し元（`dashboardSqliteService.ts` / `obsidianSyncService.ts` など）を新 interface に移行
6. 旧 20メソッドと `SqliteRpcClient` の旧定義を削除し、不要な re-export を整理
7. `npm run type-check` と `npm run validate` で確認

### 落とし穴
- `SqliteRpcClient` は `src/messaging/sqliteRpcClient.ts` で定義され background と dashboard の両方から import される中立 module。interface を変えると dashboard 側の `dashboardSqliteService.ts` も同時に壊れる — 両 side を同じ PR で移行すること
- `searchResult(query, limit, offset, options)` は `queryResult({ text, limit, offset, ... })` の薄いラッパー。削除時に呼び出し元の `searchResult("hello", 10, 0)` を `query({ text:"hello", limit:10, offset:0 })` に機械的に置換すると、orderBy のデフォルト挙動が変わらないか確認が必要
- `transform` が細粒度な型変換（`res.rows as T[]` / `new Uint8Array(res.data)` など）を隠蔽しているため、新 domain メソッドでも transform を内部 seam に留め、公開 interface に漏らさないこと

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす（call の transform / error 分岐）
- [ ] コードレビュー完了
- [ ] リファクタリング完了（旧20メソッド削除、1:1マップ削除）
- [ ] ドキュメント更新済み（DESIGN_SPECIFICATIONS.md の SQLite 3-tier fallback / Shared RPC types の記述を新 interface に更新）
