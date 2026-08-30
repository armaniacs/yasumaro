# PBI: chrome.storage 読み書きの直列化 — RMW・単一実行・CAS（VULN-003/005/009/012/050/056, CWE-362/367）

## ユーザーストーリー
利用者として、複数の拡張コンテキスト（SW/popup/dashboard）が同時に動いても録画バッファ・保留ページ・ログ・リトライジョブが失われないようにしたい、なぜなら get→mutate→set の RMW がロックなしで並行実行され、stale スナップショットで他方の書き込みが消えるから

## ビジネス価値
- 6 指摘の解消: バッファエントリ消失（003 実証: final=['E2']）、保留ページ消失/重複（005）、通知の二重記録（009）、optimisticLock の TOCTOU 残窓（012）、ログ消失（050）、リトライジョブロスト（056 実証: ['A','B']→['A']）
- 攻撃不要の通常 MV3 運用で発生するデータ完全性問題を構造的に封鎖
- 測定方法: 6 サイトの変異テスト（インターリーブ再現）が全て lock 付きで防がれること

## 優先度
- 順位: 4 / 14
- RICEスコア: 1440（Reach=800 / Impact=0.4 / Confidence=90% / Effort=0.2人月）
  - Reach 800: 攻撃不要の通常並行動作で発火しうる全利用者のデータ完全性
  - Impact 0.4: Medium 級のデータ消失（ただし揮発性バッファ・ログ・ジョブが中心）
  - Confidence 90%: 正解パターン（withCounterLock/single-flight/CAS）が codebase 内に実証済みで存在
  - Effort 0.2: 6 サイトへの既存パターン適用＋optimisticLock の Mutex 直列化
- 根拠: スイープで「52 ファイル中 RMW 形状 20 サイト、うち 16 は正当理由付きで緩和済み」が確認済み。残る 4 確認＋1 新規＋lock 内部の 1 件に絞って適用する

## BDD受け入れシナリオ

```gherkin
Scenario: 並行 flush でバッファエントリが消えない
  Given SW と dashboard がそれぞれエントリ E1/E2 をバッファしている
  When 2 つの flush がインターリーブする
  Then CAS/lock 経由で最終状態が [E1, E2] になり、消失しない

Scenario: 通知の二重クリックで重複記録が生まれない
  Given 同一 URL の保留通知が 2 回高速にクリックされる
  When onClicked ハンドラが並行実行される
  Then 単一実行（single-flight）ガードにより録画は 1 件のみ

Scenario: optimisticLock の verify→set 間で他書き込みが割り込まない
  Given 同一 base version を持つ 2 writer が同一キーに書く
  When 両者が withOptimisticLock を実行する
  Then lock 内部の Mutex により verify→set が不可視化され、後続 writer がリトライで反映される

Scenario: enqueue と flush が重なってもジョブが失われない
  Given flush 中に新規ジョブ B が enqueue される
  When persistState が走る
  Then enqueue が lock を経由し、最終キューが ['A','B'] になる
```

## 受け入れ基準
- [ ] `src/background/pipeline/buffers/MarkdownBufferManager.ts:35-39` の flush() が `withAtomicKeys`（または Mutex）を経由する
- [ ] `src/utils/pendingStorage.ts:127-154` の add/removePendingPages が `withOptimisticLock(PENDING_PAGES_KEY, …)` を経由する
- [ ] `src/utils/logger/storageAdapter.ts:20-27` の append が CAS/Mutex を経由する（`withAtomicKeys` ロガー版を検討）
- [ ] `src/background/persistentRetryQueue.ts`（enqueue/flush/flushBatch）が lock 経由に統一され、3 本番キューが網羅される
- [ ] `src/background/handlers/notificationHandlers.ts:64-78` に `contextMenuHandlers.ts:38-100` 型の single-flight ガードが追加されている
- [ ] `src/utils/optimisticLock.ts:240-266` の verify→write 区間が `Mutex` で直列化され、二重読みは防御深度として維持される
- [ ] 変異テスト（インターリーブ再現）6 件が追加され、全て lock なしでは RED / lock 付きで GREEN
- [ ] `npm run type-check` と `npm run validate` が成功する

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 対象なし（マルチコンテキスト並行は InMemoryStorage＋インターリーブで検証）

### 統合テスト
- `PersistentRetryQueue` × `stepExecutor` × alarm モック: flush 中 enqueue のジョブ保全
- `notificationHandlers` × pending store: 二重クリックでの単一記録

### 単体テスト
- 更新: インターリーブ再現テストを Jest 化（RED→GREEN 検証用に「lock を外せる注入ポイント」を持たせる）。想定シナリオは `2026-08-29-00-backlog-vulnhunt-audit.md` の C4 節（例: バッファ `final=['E2']`、リトライキュー `['A','B']→['A']`）
- 新規: `src/background/handlers/__tests__/notificationSingleFlight.test.ts`

## 実装アプローチ
- **Outside-In**: 各サイトの変異テスト（RED）→ 既存パターン適用（GREEN）→ 重複整理
- **Red-Green-Refactor**: `optimisticLock` の Mutex 直列化は最後に実施（全呼び出しサイトが受益し、回帰は既存 34 テスト）

## 見積もり
2pt（要チームでの見積もり — 6 サイト＋lock 内部強化＋変異テスト）

## 技術的考慮事項
- 依存関係: PBI 07（lock-cas-correctness）と理論上相互作用 — 本 PBI 先着手推奨（Wave 2）
- テスタビリティ: インターリーブは `Mutex`/`withOptimisticLock` の注入モックで決定的に再現する
- 非機能要件: lock 待ちによる UI 遅延は Mutex timeout（既存）で_bound_。queue-full は既存の throw 挙動を維持
- 注意: `storageFallback.ts` は PBI 11 のスコープ（触れない）。スイープで「緩和済み16サイト」に触れない
- 行番号は監査時点（2026-08-29）のもの。着手時に該当シンボルで再確認すること

## 実装者向け注記

### 現状コードの確認
```bash
sed -n '30,45p' src/background/pipeline/buffers/MarkdownBufferManager.ts
sed -n '120,160p' src/utils/pendingStorage.ts
sed -n '15,30p' src/utils/logger/storageAdapter.ts
sed -n '78,120p' src/background/persistentRetryQueue.ts
sed -n '235,270p' src/utils/optimisticLock.ts
sed -n '38,100p' src/background/handlers/contextMenuHandlers.ts   # single-flight の正解パターン
```

### 実装手順
1. `MarkdownBufferManager` → `pendingStorage` → `storageAdapter` → `persistentRetryQueue` の順に CAS/lock 適用
2. `notificationHandlers` に single-flight（URL キーの in-flight promise）
3. `optimisticLock` に Mutex 直列化（PBI 07 の trustDb 修正と競合しないよう先に完了）
4. 変異テスト 6 件、`npm run validate`

### 落とし穴
- `withOptimisticLock` の Mutex をグローバル単一にすると無関係キーまで直列化される — lock 内部でのみ共有する Mutex インスタンスにすること（キー粒度は以後の改善）
- `persistentRetryQueue` は per-item `persistPerItem:true` の経路も stale snapshot を書く — flush 全体の persist も lock 経由に
- ロガーは全コンテキスト共有キーのため、コンテキスト内 `isFlushing` ガードだけでは不十分（VULN-050 の根拠）— storage CAS 必須

## Definition of Done
- [ ] 全 BDD シナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす
- [ ] コードレビュー完了
- [ ] リファクタリング完了（グリーン後）
- [ ] VulnHunter 再スキャンで VULN-003/005/009/012/050/056 が解消されること
