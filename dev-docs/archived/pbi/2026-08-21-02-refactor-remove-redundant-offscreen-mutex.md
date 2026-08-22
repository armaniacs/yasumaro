# PBI: 冗長な offscreen SqliteWriteMutex の削除 — transport Mutex への集約

## ユーザーストーリー
開発者として、offscreen の手作り `SqliteWriteMutex` を削除し transport の `Mutex` に集約したい、なぜなら同一パスで二重に直列化され、timeout / maxQueueSize のない弱い Mutex が本当の back-pressure を隠しているから

## 優先度
- 順位: 2 / 5
- RICEスコア: 640（Reach=200 / Impact=2 / Confidence=80% / Effort=0.5人週）
- 根拠: 全 SQLite 操作（insert / query / search / maintenance）に影響。Impact 2（二重直列化の解消、timeout 付与、hand-rolled queue 削除）。Confidence 80%（transport Mutex が既に one-in-flight を保証することはコード確認済み）。Effort 0.5週（offscreen.ts 20行削除、transport の振る舞い検証のみ）。PBI 01 と同パスで同時レビュー可能。

## ビジネス価値
- オフライン時の大量書き込みや mobile での offscreen サスペンド時の挙動が、timeout と bounded queue で可視化される（無限に詰む hand-rolled queue ではなく）
- 保守者が「どちらの Mutex が SQLite を守っているか」を迷わない — locality が1箇所に集中
- 測定: `src/offscreen/offscreen.ts` の `SqliteWriteMutex` クラスが0件、`ChromeOffscreenTransport.requestQueue` のみが序列化を担うこと

## BDD受け入れシナリオ

```gherkin
Scenario: 単一 Mutex で直列化される
  Given ChromeOffscreenTransport の requestQueue Mutex が maxQueueSize と timeout を持つ
  When 複数タブから同時に SQLITE_INSERT / SQLITE_QUERY を送信する
  Then transport が1リクエストずつ直列化し、offscreen 側に追加の queue なく順に処理される

Scenario: timeout が可視化される
  Given offscreen document が応答しない（WASM 初期化遅延など）
  When messageTimeoutMs（desktop 10s / mobile 5s）を超過する
  Then transport が timeout エラーを返し、呼び出し元で categorizeError が retriable=true として扱う

Scenario: 冗長 Mutex が存在しない
  Given src/offscreen/offscreen.ts を grep する
  When "class SqliteWriteMutex" を検索する
  Then ヒットが0件であり、handleOffscreenMessage が acquire/release を呼ばない

Scenario: 境界 — queue 上限超過時の挙動
  Given requestQueue が maxQueueSize に達している
  When さらに msgOffscreen を呼ぶ
  Then Mutex が timeout または queue-full エラーで失敗し、offscreen 側で無限に積まれない
```

## 受け入れ基準
- [x] `src/offscreen/offscreen.ts` の `SqliteWriteMutex` クラス（41–63行相当）と `sqliteWriteMutex` インスタンスが削除されている
- [x] `handleOffscreenMessage` の `await sqliteWriteMutex.acquire()` / `release()` 呼び出しが存在しない（`dispatchSqliteMessage` が直接呼ばれる）
- [x] `src/background/offscreenTransport.ts` の `ChromeOffscreenTransport.requestQueue: Mutex` が唯一の直列化 seam として残り、maxQueueSize（desktop 200 / mobile 50）と timeout（10s / 5s）が維持される
- [x] SQLite WASM が Worker 内で単一スレッドであることを前提に、同時書き込みの競合テストが transport seam 越しにパスする
- [x] `npm run type-check` と `npm run validate` がパスする

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- ダッシュボードで大量 import（5000行）中に別タブで VALID_VISIT を発火し、両方が成功するシナリオ（transport の直列化で競合しないこと）

### 統合テスト
- ChromeOffscreenTransport の Mutex 統合テスト（concurrent msgOffscreen 呼び出しが順に解決される、timeout 時に offscreenAlive がリセットされる）
- offscreen handleOffscreenMessage の sender 検証（tab あり / 外部 extension id）が Mutex 削除後も維持されること

### 単体テスト
- Mutex の timeout / maxQueueSize の境界値テスト（queue-full 時の acquire 失敗）
- categorizeError が timeout を retriable=true で分類すること
- SqliteWriteMutex 削除後に `handleOffscreenMessage` が例外時も sendResponse を漏らさないこと

## 実装アプローチ
- **Outside-In**: transport の Mutex テストを固定 → offscreen の acquire/release を削除（RED: 削除後に concurrent テストが依然パスすることを確認）→ リファクタで offscreen の不要な import（Mutex 型）を削除
- **Red-Green-Refactor**: 削除後に `npm run validate` で offscreen の未使用 import エラーを解消

## 見積もり
1pt（要チームでの見積もり）— 削除のみ、手順は短いが mobile timeout の検証が必要
- **確認**: offscreen.ts に SqliteWriteMutex（41行相当）が実在し、41–63行、65行、401行、409行で使用中

## 技術的考慮事項
- 依存関係: PBI 01 と同パスだが依存なし。PBI 01 と同時着手・同時レビュー推奨（両方ともメッセージング周りの seam 整理）
- テスタビリティ: InMemory transport（test 用の OffscreenTransport fake）で Mutex の振る舞いを seam 越しに検証。offscreen 側は chrome.runtime.sendMessage の mock で sender 検証を維持
- 非機能要件: mobile での offscreen サスペンド時の retry（msgOffscreen の1回リトライ）は transport に残るため、offscreen Mutex 削除後も再接続ロジックは維持される

## 実装者向け注記

### 現状コードの確認
```bash
# 二重直列化の実態
grep -n "SqliteWriteMutex\|sqliteWriteMutex" src/offscreen/offscreen.ts
grep -n "requestQueue.*Mutex\|new Mutex" src/background/offscreenTransport.ts src/utils/Mutex.ts
# transport が既に one-in-flight を保証しているか
grep -n "requestQueue.acquire\|requestQueue.release\|offscreenAlive" src/background/offscreenTransport.ts
# offscreen が WASM を同期的に扱うため Worker 内で単一スレッドであること
grep -n "createSyncAccessHandle\|OPFSCoopSyncVFS" src/offscreen/
```
未実装ではなく「二重に守っている」状態。削除が目的。

### 実装手順
1. `ChromeOffscreenTransport` の `requestQueue` が `src/utils/Mutex.ts` の bounded Mutex であることをテストで固定（maxQueueSize と timeout の assertion）
2. `src/offscreen/offscreen.ts` から `class SqliteWriteMutex` と `const sqliteWriteMutex = new SqliteWriteMutex()` を削除
3. `handleOffscreenMessage` の `await sqliteWriteMutex.acquire()` / `try { ... } finally { release() }` を削除し、`await dispatchSqliteMessage(authorizedSender, msg as SqliteMessage, sendResponse)` を直接呼ぶ形に
4. 不要になった `SqliteWriteMutex` の import や型参照を削除し `npm run type-check` で確認
5. `npm run validate` と `msgOffscreen` の concurrent テストで直列化が保たれることを確認

### 落とし穴
- transport の Mutex は `chrome.runtime.sendMessage` の非同期（request → response 待ち）全体を囲むが、offscreen の Mutex は `dispatchSqliteMessage` の同期実行のみを囲んでいた。両者は囲む範囲が異なるが、transport が既に response 待ちまで含めて直列化するため offscreen 側の追加囲みは不要という前提を、concurrent テストで明示的に検証すること
- mobile での `offscreenAlive` リセットと1回リトライは transport 側に残るため、offscreen 側で「再作成を待つ」ロジックを追加しないこと（二重リトライになる）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] テストカバレッジが基準を満たす（transport Mutex の timeout / queue-full 分岐）
- [x] コードレビュー完了
- [x] リファクタリング完了（hand-rolled queue 削除、不要 import 削除）
- [x] ドキュメント更新済み（DESIGN_SPECIFICATIONS.md の SQLite 3-tier fallback 記述に直列化が transport に集約された旨を追記）
