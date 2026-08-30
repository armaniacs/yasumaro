# PBI: CAS verify→write 区間の直列化 — fake-timer 互換の Mutex 設計（VULN-003/005/012/050）

> `2026-08-29-04-fix-storage-rmw-serialization.md` から分離。29-04 の PR #74 では
> `persistentRetryQueue` と `notificationHandlers` の 2 サイトのみ着地した。
> 残る 4 サイトは `withOptimisticLock`/`withAtomicKeys` の verify→write 区間を
> 直列化する必要があり、その設計自体が本 PBI の主眼。

## ユーザーストーリー
利用者として、複数の拡張コンテキスト（SW/popup/dashboard）が同時に動いても録画バッファ・保留ページ・ログが CAS の verify→write 窓で失われないようにしたい、なぜなら `withOptimisticLock` の「バージョン確認 → 書き込み」の間に他コンテキストが自分の確認+書き込みを差し込むと、バージョンチェックが素通りして片方の書き込みが消えるから（TOCTOU 残窓）

## 背景

### 29-04 で見送った理由
`withOptimisticLock` / `withAtomicKeys` は「get → updater → 再 get で verify → set」の CAS。
verify と set の間に `await` があり、別実行コンテキストがその窓に自分の CAS を完了させると、
両者が同じバージョンを読んで両方 set し、後勝ちで片方が消える（VULN-012）。

CAS のみでは決定的インターリーブテスト（`set()` をゲートして第 2 の書き込みを先に通す）が
RED のまま。verify→set を process-wide Mutex で直列化すると解決するが、
**`vi.useFakeTimers()` を使う既存テスト 15+ 件が `Mutex.acquire()` の待機が
タイマー前進まで解決しないため RED になる**（例: `logger-enhanced.test.ts`、
`recordingPipeline-impl.test.ts`、`RecordingPipeline.test.ts`、`stepExecutor.test.ts`）。

### 課題の本質
- `Mutex` の待機解決が microtask ではなく timer に依存している（または Mutex を使う経路が fake timer 下で進まない）
- process-wide 単一 Mutex は無関係キーの CAS まで直列化する（性能・テスト隔離の両面で不適）

## BDD受け入れシナリオ

```gherkin
Scenario: 並行 CAS の verify→write が直列化される
  Given 同一キーに対する 2 つの withOptimisticLock 呼び出しが同じ base version を読む
  When 両者が verify→set を実行する
  Then key 粒度の直列化により、後発の writer は ConflictError でリトライし、両方の意図が反映される

Scenario: 無関係キーの CAS は互いに待たない
  Given キー A とキー B にそれぞれ CAS が走る
  When 両者が同時に実行される
  Then A の CAS は B の verify→write の完了を待たない

Scenario: fake timer 下の既存テストが緑のまま
  Given vi.useFakeTimers() を使うテストが withOptimisticLock 経由の処理を呼ぶ
  When そのテストを実行する
  Then Mutex の待機は microtask で解決し、タイマー前進なしで完了する

Scenario: MarkdownBufferManager の並行 flush でエントリが消えない
  Given SW と dashboard がそれぞれ E1/E2 をバッファし、set() が第 1 flush で park される
  When 第 2 flush が get→merge を先に走らせる
  Then 直列化により最終状態が [E1, E2] になる

Scenario: logger の並行 append でログが消えない
  Given 2 コンテキストが同時に append() する
  When 両者が read→append→prune→write を実行する
  Then 直列化により両方のエントリが残る
```

## 受け入れ基準
- [ ] `src/utils/optimisticLock.ts` の verify→write 区間が **key 粒度の Mutex**（`Map<key, Mutex>` またはキー毎の promise-chain）で直列化される
- [ ] その待機解決が microtask ベースで、`vi.useFakeTimers()` 下でもタイマー前進なしに進む（`Mutex` 実装がタイマー依存なら microtask 版に差し替えるか、CAS 専用の軽量 chain を新設）
- [ ] `withAtomicKeys`（複数キー）も同様に直列化される（複数キーの場合はデッドロック回避のためキーをソートして順に取得、または全キーを 1 つの複合ロックキーで保護）
- [ ] `src/background/pipeline/buffers/MarkdownBufferManager.ts` の `flush()` が `withAtomicKeys` 経由になり、バッファはフラッシュ前にキャプチャ・クリア、失敗時は再バッファ（VULN-003）
- [ ] `src/utils/pendingStorage.ts` の `addPendingPage` / `removePendingPages` が `withOptimisticLock(PENDING_PAGES_KEY, …)` 経由で、dedup 再チェックがロック内で走る（VULN-005）。**PR #75（29-08）の `PENDING_PAGES_PRUNE_THRESHOLD` 剪定ロジックと統合すること**（剪定を updater 内に移す）
- [ ] `src/utils/logger/storageAdapter.ts` の `append` が CAS 経由（logger→optimisticLock→Mutex→logger の import 循環に注意。動的 import か、Mutex を logger 非依存に）（VULN-050）
- [ ] 決定的インターリーブ再現テスト 4 件（buffer / pending / logger / 無関係キー非直列化）が追加され、直列化なしで RED / 付きで GREEN
- [ ] 既存 `optimisticLock` 系 34 テスト + fake-timer を使う 15+ 件が全てグリーン
- [ ] `npm run type-check` と `npm run validate` が成功する

## テスト戦略（t_wadaスタイル）

### 統合テスト
- `MarkdownBufferManager` × gated `chrome.storage.local.set`: 決定的インターリーブ
- `ChromeStorageLogAdapter` × 並行 append: エントリ保全
- fake-timer を使う既存テスト（`logger-enhanced` 等）が回帰しないこと

### 単体テスト
- 新規: `src/utils/__tests__/optimisticLockSerialization.test.ts`
  - key 粒度直列化: 同一キーは待つ / 別キーは待たない
  - fake timer 下で `withOptimisticLock` が完了する
  - `withAtomicKeys` 複数キーのデッドロック非発生

## 実装アプローチ
- **調査先行**: 現行 `Mutex.ts` の待機解決機構を確認。タイマー依存なら microtask 版（`Promise` チェーン）を CAS 専用に新設
- **Outside-In**: fake-timer 回帰テスト（RED になる既存テストの再現）→ 直列化機構の設計 → 4 サイト適用
- **Red-Green-Refactor**: key 粒度 Mutex を先に確立し、その上で 4 サイトを 1 つずつ

## 見積もり
3pt（要チームでの見積もり — 直列化機構の設計・実装 1.5 + 4 サイト適用 1 + 回帰テスト 0.5）

## 技術的考慮事項
- 依存関係: PBI 07（lock-cas-correctness）と `optimisticLock.ts` を共有 — 本 PBI を先に完了推奨
- PR #75（29-08）の `pendingStorage.ts` 剪定ロジックとマージ順に注意（剪定を CAS updater 内へ）
- key 粒度 Mutex の Map はメモリリークに注意（使い終わったキーのエントリを削除、または WeakRef 不可のため参照カウント）
- 行番号は監査時点（2026-08-29）のもの。着手時に該当シンボルで再確認すること

## 実装者向け注記

### 現状コードの確認
```bash
rg -n "verify|再.*get|performCasUpdate|_postWriteVerification" src/utils/optimisticLock.ts
rg -n "acquire|release|new Promise|setTimeout" src/background/Mutex.ts src/utils/Mutex.ts 2>/dev/null
rg -ln "useFakeTimers" src --include='*.test.ts' | head
```

### 実装手順
1. `Mutex` の待機解決を調査。タイマー依存なら CAS 専用の microtask chain（`Map<string, Promise<void>>`）を新設
2. `optimisticLock.ts` の `performCasUpdate` / `withAtomicKeys` の verify→write を key 粒度 chain で bracket
3. fake-timer を使う既存テストを実行し回帰ゼロを確認
4. `MarkdownBufferManager` → `pendingStorage`（#75 剪定統合）→ `storageAdapter` の順に CAS 適用
5. 決定的インターリーブテスト 4 件、`npm run validate`

### 落とし穴
- `finally` 内でロック解放を保証（例外経路）
- 複数キー（`withAtomicKeys`）はキーをソートして取得しデッドロック回避
- logger の import 循環: `optimisticLock → Mutex → logger barrel → logger/core → storageAdapter`。動的 import か Mutex を logger 非依存に
- `pendingStorage` の dedup 再チェックは必ずロック内（updater 引数の `current` を使う）

## Definition of Done
- [ ] 全 BDD シナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす
- [ ] コードレビュー完了
- [ ] リファクタリング完了（グリーン後）
- [ ] VulnHunter 再スキャンで VULN-003/005/012/050 が解消されること
